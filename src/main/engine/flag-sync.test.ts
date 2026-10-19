import fs from 'node:fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessage, ProviderEnclave } from '../../renderer/types/index';
import type { FolderSnapshot } from './imap-service';
import type { FlagBatch } from './pending-flags';

const home = vi.hoisted(() => ({ dir: `${process.env.TEMP ?? process.env.TMPDIR ?? '/tmp'}/enclave-flagsync-test-${process.pid}` }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, default: { ...actual, homedir: () => home.dir } };
});

const { StorageService } = await import('./storage-service');
const { pushPendingFlags, IMAP_FLAG } = await import('./flag-sync');

const PROVIDER = 'prov_flags';

function provider(): ProviderEnclave {
  return { id: PROVIDER, name: 'T', email: 'me@t.io', avatarColor: '#000', type: 'custom_imap', unreadTotal: 0, storagePath: '', status: 'connected' };
}

function letter(folderId: string, uid: number): EmailMessage {
  return {
    id: `${folderId}_7_${uid}`,
    uid,
    providerId: PROVIDER,
    folderId,
    from: { name: 'Ana', address: 'ana@acme.com' },
    to: [],
    subject: `Letter ${uid}`,
    date: '',
    timestamp: uid,
    snippet: '',
    isRead: false,
    isStarred: false,
    tags: [],
    attachments: [],
  };
}

function snapshot(folderId: 'inbox' | 'archive', uids: number[]): FolderSnapshot {
  const path = folderId === 'inbox' ? 'INBOX' : 'Archive';
  return { folder: { id: folderId, path }, uidValidity: '7', serverUids: uids, flags: {}, newMessages: uids.map((uid) => letter(folderId, uid)), pendingUids: [] };
}

type Storage = InstanceType<typeof StorageService>;
let storage: Storage;

beforeEach(() => {
  fs.rmSync(home.dir, { recursive: true, force: true });
  storage = new StorageService();
  storage.addProvider(provider());
  storage.saveSyncedMessages(PROVIDER, [snapshot('inbox', [1, 2, 3]), snapshot('archive', [9])]);
});

afterAll(() => fs.rmSync(home.dir, { recursive: true, force: true }));

const summary = (batches: FlagBatch[]) => batches.map(({ folderId, uids, flag, value }) => ({ folderId, uids, flag, value }));

describe('pushPendingFlags', () => {
  it('sends the queue after a restart and empties it once the server confirms', async () => {
    storage.markEmailRead(PROVIDER, 'inbox_7_1', true);
    storage.markEmailRead(PROVIDER, 'inbox_7_2', true);
    storage.toggleStar(PROVIDER, 'archive_7_9');

    const restarted = new StorageService();
    const sent: FlagBatch[] = [];
    const result = await pushPendingFlags(restarted, PROVIDER, async (batch) => {
      sent.push(batch);
      return 'stored';
    });

    expect(summary(sent)).toEqual([
      { folderId: 'inbox', uids: [1, 2], flag: 'seen', value: true },
      { folderId: 'archive', uids: [9], flag: 'flagged', value: true },
    ]);
    expect(result).toEqual({ sent: 3, dropped: 0, waiting: 0 });
    expect(restarted.getPendingFlags(PROVIDER)).toEqual([]);
  });

  it('maps stars to \\Flagged and reads to \\Seen', () => {
    expect(IMAP_FLAG).toEqual({ seen: '\\Seen', flagged: '\\Flagged' });
  });

  it('keeps what the server did not confirm, and drops what it did', async () => {
    storage.markEmailRead(PROVIDER, 'inbox_7_1', true);
    storage.toggleStar(PROVIDER, 'archive_7_9');
    await expect(
      pushPendingFlags(storage, PROVIDER, async (batch) => {
        if (batch.folderId === 'archive') throw new Error('connection lost');
        return 'stored';
      })
    ).rejects.toThrow('connection lost');
    expect(storage.getPendingFlags(PROVIDER)).toMatchObject([{ emailId: 'archive_7_9', flag: 'flagged', value: true }]);
  });

  it('keeps a change the user made while the old value was on its way', async () => {
    storage.markEmailRead(PROVIDER, 'inbox_7_1', true);
    await pushPendingFlags(storage, PROVIDER, async () => {
      storage.markEmailRead(PROVIDER, 'inbox_7_1', false);
      return 'stored';
    });
    expect(storage.getPendingFlags(PROVIDER)).toMatchObject([{ emailId: 'inbox_7_1', flag: 'seen', value: false }]);
  });

  it('drops changes the server refuses, and changes for letters deleted since', async () => {
    storage.markEmailRead(PROVIDER, 'inbox_7_1', true);
    storage.markEmailRead(PROVIDER, 'inbox_7_3', true);
    // Deleted on the server since: the next sync removes it, and its change with it
    storage.saveSyncedMessages(PROVIDER, [snapshot('inbox', [1, 2]), snapshot('archive', [9])]);
    storage.toggleStar(PROVIDER, 'archive_7_9');
    const result = await pushPendingFlags(storage, PROVIDER, async (batch) => (batch.folderId === 'archive' ? 'refused' : 'stored'));
    expect(result).toEqual({ sent: 1, dropped: 1, waiting: 0 });
    expect(storage.getPendingFlags(PROVIDER)).toEqual([]);
  });

  it('keeps changes for a renumbered folder so the next sync can move them to the new UIDs', async () => {
    storage.markEmailRead(PROVIDER, 'inbox_7_1', true);
    storage.toggleStar(PROVIDER, 'archive_7_9');
    const result = await pushPendingFlags(storage, PROVIDER, async (batch) => (batch.folderId === 'inbox' ? 'renumbered' : 'stored'));
    expect(result).toEqual({ sent: 1, dropped: 0, waiting: 1 });
    expect(storage.getPendingFlags(PROVIDER)).toMatchObject([{ emailId: 'inbox_7_1', flag: 'seen', value: true }]);
  });

  it('a refused batch does not hold back the batches after it', async () => {
    storage.toggleStar(PROVIDER, 'archive_7_9');
    storage.markEmailRead(PROVIDER, 'inbox_7_1', true);
    const sent: string[] = [];
    await pushPendingFlags(storage, PROVIDER, async (batch) => {
      sent.push(batch.folderId);
      return batch.folderId === 'archive' ? 'refused' : 'stored';
    });
    expect(sent).toEqual(['archive', 'inbox']);
    expect(storage.getPendingFlags(PROVIDER)).toEqual([]);
  });

  it('does nothing when no change is waiting', async () => {
    const store = vi.fn();
    expect(await pushPendingFlags(storage, PROVIDER, store)).toEqual({ sent: 0, dropped: 0, waiting: 0 });
    expect(store).not.toHaveBeenCalled();
  });
});
