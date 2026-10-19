import fs from 'node:fs';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessage, ProviderEnclave } from '../../renderer/types/index';
import type { FolderSnapshot, ServerFlags } from './imap-service';

const home = vi.hoisted(() => ({ dir: `${process.env.TEMP ?? process.env.TMPDIR ?? '/tmp'}/enclave-acctflags-test-${process.pid}` }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, default: { ...actual, homedir: () => home.dir } };
});

// One fake IMAP connection per test; no network
const fakeSession = vi.hoisted(() => ({ discard: vi.fn() }));
vi.mock('./imap-sessions', () => ({
  ImapSessions: class {
    acquire = async () => ({ client: {}, folders: [{ id: 'inbox', path: 'INBOX' }], inboxCount: 0 });
    discard = fakeSession.discard;
    markSynced = () => {};
    isWatched = () => true;
    close = async () => {};
    closeAll = async () => {};
  },
}));

const { StorageService } = await import('./storage-service');
const { AccountService } = await import('./account-service');
const { ImapService } = await import('./imap-service');
type CredentialStore = import('./credential-store').CredentialStore;

const PROVIDER = 'prov_acct';
const SERVER = { username: 'me', imapHost: 'imap.test', imapPort: 993, smtpHost: 'smtp.test', smtpPort: 465 };

function provider(): ProviderEnclave {
  return { id: PROVIDER, name: 'T', email: 'me@t.io', avatarColor: '#000', type: 'custom_imap', unreadTotal: 0, storagePath: '', status: 'connected', server: SERVER };
}

function letter(uid: number): EmailMessage {
  return {
    id: `inbox_7_${uid}`,
    uid,
    providerId: PROVIDER,
    folderId: 'inbox',
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

function snapshot(flags: Record<number, ServerFlags> = {}, newMessages: EmailMessage[] = []): FolderSnapshot {
  return { folder: { id: 'inbox', path: 'INBOX' }, uidValidity: '7', serverUids: [1, 2], flags, newMessages, pendingUids: [] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

type Storage = InstanceType<typeof StorageService>;
let storage: Storage;
let accounts: InstanceType<typeof AccountService>;
const isRead = (id: string) => storage.getEmails(PROVIDER, 'inbox').find((m) => m.id === id)?.isRead;

beforeEach(() => {
  fs.rmSync(home.dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  fakeSession.discard.mockReset();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  storage = new StorageService();
  storage.addProvider(provider());
  storage.saveSyncedMessages(PROVIDER, [snapshot({}, [letter(1), letter(2)])]);
  accounts = new AccountService(storage, { getPassword: () => 'secret' } as unknown as CredentialStore);
});

afterEach(() => vi.restoreAllMocks());
afterAll(() => fs.rmSync(home.dir, { recursive: true, force: true }));

describe('AccountService read/star sync', () => {
  it('a sync sends queued changes before it reads the server flags', async () => {
    const order: string[] = [];
    storage.markEmailRead(PROVIDER, 'inbox_7_1', true);
    vi.spyOn(ImapService, 'storeFlag').mockImplementation(async () => {
      order.push('store');
      return 'stored';
    });
    vi.spyOn(ImapService, 'syncFolders').mockImplementation(async () => {
      order.push('fetch');
      return [snapshot({ 1: { seen: true, flagged: false }, 2: { seen: false, flagged: false } })];
    });

    await accounts.sync(PROVIDER);
    expect(order).toEqual(['store', 'fetch']);
    expect(storage.getPendingFlags(PROVIDER)).toEqual([]);
    expect(isRead('inbox_7_1')).toBe(true);
  });

  it('a change made while a sync runs is sent only after that sync saved, and is not undone by it', async () => {
    const fetched = deferred<FolderSnapshot[]>();
    vi.spyOn(ImapService, 'syncFolders').mockReturnValue(fetched.promise);
    const store = vi.spyOn(ImapService, 'storeFlag').mockResolvedValue('stored');

    const syncing = accounts.sync(PROVIDER);
    await vi.waitFor(() => expect(ImapService.syncFolders).toHaveBeenCalled());
    storage.markEmailRead(PROVIDER, 'inbox_7_2', true);
    accounts.pushFlagsSoon(PROVIDER);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store).not.toHaveBeenCalled();

    // The server's flags were read before the change reached it
    fetched.resolve([snapshot({ 1: { seen: false, flagged: false }, 2: { seen: false, flagged: false } })]);
    await syncing;
    expect(isRead('inbox_7_2')).toBe(true);
    await vi.waitFor(() => expect(storage.getPendingFlags(PROVIDER)).toEqual([]));
    expect(store).toHaveBeenCalledWith({}, { id: 'inbox', path: 'INBOX' }, '7', [2], '\\Seen', true);
  });

  it('retries once on a fresh login when the connection dropped mid-push', async () => {
    storage.toggleStar(PROVIDER, 'inbox_7_1');
    vi.spyOn(ImapService, 'storeFlag').mockRejectedValueOnce(new Error('socket closed')).mockResolvedValueOnce('stored');
    accounts.pushFlagsSoon(PROVIDER);
    await vi.waitFor(() => expect(storage.getPendingFlags(PROVIDER)).toEqual([]));
    expect(fakeSession.discard).toHaveBeenCalledWith(PROVIDER);
  });

  it('keeps the change queued when the server cannot be reached', async () => {
    storage.toggleStar(PROVIDER, 'inbox_7_1');
    vi.spyOn(ImapService, 'storeFlag').mockRejectedValue(new Error('socket closed'));
    accounts.pushFlagsSoon(PROVIDER);
    await vi.waitFor(() => expect(ImapService.storeFlag).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(storage.getPendingFlags(PROVIDER)).toMatchObject([{ emailId: 'inbox_7_1', flag: 'flagged', value: true }]);
  });
});
