import { describe, expect, it } from 'vitest';
import { ImapService, planDownloads } from './imap-service';

describe('planDownloads', () => {
  it('downloads the newest missing letters now and leaves the rest for the history backfill', () => {
    const plan = planDownloads([1, 2, 3, 4, 5, 6], new Set([6, 3]), 2);
    expect(plan).toEqual({ now: [5, 4], later: [2, 1] });
  });

  it('has nothing to do when everything is cached', () => {
    expect(planDownloads([1, 2], new Set([1, 2]), 50)).toEqual({ now: [], later: [] });
  });

  it('does not depend on the server returning UIDs in order', () => {
    expect(planDownloads([3, 10, 7], new Set(), 1)).toEqual({ now: [10], later: [7, 3] });
  });
});

describe('ImapService.storeFlag', () => {
  const folder = { id: 'archive' as const, path: 'Archive' };
  const inboxLock = { release: () => {} };

  // A stand-in for the parts of ImapFlow that storeFlag touches
  function fakeClient({ lock = 'ok', uidValidity = '7', answer = true, usable = true }: { lock?: 'ok' | 'fail'; uidValidity?: string; answer?: boolean; usable?: boolean }) {
    const calls: string[] = [];
    const client = {
      usable,
      mailbox: { uidValidity: BigInt(uidValidity) },
      getMailboxLock: async (path: string) => {
        if (path === 'INBOX') return inboxLock;
        if (lock === 'fail') throw new Error('NO Mailbox does not exist');
        return { release: () => {} };
      },
      messageFlagsAdd: async (range: string, flags: string[]) => {
        calls.push(`+${flags[0]} ${range}`);
        return answer;
      },
      messageFlagsRemove: async (range: string, flags: string[]) => {
        calls.push(`-${flags[0]} ${range}`);
        return answer;
      },
    };
    return { client: client as unknown as Parameters<typeof ImapService.storeFlag>[0], calls };
  }

  it('sends one compact UID STORE and reports it stored', async () => {
    const { client, calls } = fakeClient({});
    expect(await ImapService.storeFlag(client, folder, '7', [3, 1, 2, 9], '\Seen', true)).toBe('stored');
    expect(await ImapService.storeFlag(client, folder, '7', [4], '\Flagged', false)).toBe('stored');
    expect(calls).toEqual(['+\Seen 1:3,9', '-\Flagged 4']);
  });

  it('touches nothing in a renumbered folder', async () => {
    const { client, calls } = fakeClient({ uidValidity: '8' });
    expect(await ImapService.storeFlag(client, folder, '7', [1], '\Seen', true)).toBe('renumbered');
    expect(calls).toEqual([]);
  });

  it('reports a server refusal, or a folder it can no longer open, as refused', async () => {
    expect(await ImapService.storeFlag(fakeClient({ answer: false }).client, folder, '7', [1], '\Seen', true)).toBe('refused');
    expect(await ImapService.storeFlag(fakeClient({ lock: 'fail' }).client, folder, '7', [1], '\Seen', true)).toBe('refused');
  });

  it('throws when the connection is gone, so the change stays queued', async () => {
    await expect(ImapService.storeFlag(fakeClient({ answer: false, usable: false }).client, folder, '7', [1], '\Seen', true)).rejects.toThrow();
    await expect(ImapService.storeFlag(fakeClient({ lock: 'fail', usable: false }).client, folder, '7', [1], '\Seen', true)).rejects.toThrow();
  });
});
