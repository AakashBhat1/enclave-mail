import { describe, expect, it } from 'vitest';
import type { EmailMessage } from '../../renderer/types/index';
import { ackFlags, isPendingFlag, MAX_STORE_UIDS, parseServerId, pendingValue, planFlagPush, queueFlags, toUidSet, type PendingFlag } from './pending-flags';

const change = (emailId: string, flag: PendingFlag['flag'], value: boolean, queuedAt = 1): PendingFlag => ({ emailId, flag, value, queuedAt });

function header(id: string): Pick<EmailMessage, 'id'> {
  return { id };
}

describe('queueFlags', () => {
  it('keeps one entry per letter and flag, the latest wins', () => {
    const queue = queueFlags(queueFlags([], [change('inbox_7_1', 'seen', true, 1)]), [change('inbox_7_1', 'seen', false, 2)]);
    expect(queue).toEqual([change('inbox_7_1', 'seen', false, 2)]);
  });

  it('keeps only the last of several changes to the same letter in one call', () => {
    expect(queueFlags([], [change('inbox_7_1', 'seen', true, 1), change('inbox_7_1', 'seen', false, 2)])).toEqual([change('inbox_7_1', 'seen', false, 2)]);
  });

  it('keeps read and star changes for the same letter apart', () => {
    expect(queueFlags([], [change('inbox_7_1', 'seen', true), change('inbox_7_1', 'flagged', true)])).toHaveLength(2);
  });

  it('never changes the queue it was given', () => {
    const original = Object.freeze([change('inbox_7_1', 'seen', true)]) as PendingFlag[];
    queueFlags(original, [change('inbox_7_2', 'seen', true)]);
    expect(original).toHaveLength(1);
  });
});

describe('toUidSet', () => {
  it('compacts runs into ranges, sorted and without duplicates', () => {
    expect(toUidSet([9, 1, 2, 3, 4, 12, 13, 4])).toBe('1:4,9,12:13');
    expect(toUidSet([5])).toBe('5');
  });
});

describe('ackFlags', () => {
  it('drops only what the server confirmed, not a newer change made while it was sending', () => {
    const sent = [change('inbox_7_1', 'seen', true, 1)];
    const queue = [change('inbox_7_1', 'seen', false, 5), change('inbox_7_2', 'flagged', true, 1)];
    expect(ackFlags(queue, sent)).toEqual(queue);
    expect(ackFlags([...sent, change('inbox_7_2', 'flagged', true, 1)], sent)).toEqual([change('inbox_7_2', 'flagged', true, 1)]);
  });
});

describe('pendingValue', () => {
  it('finds the queued value for a letter and flag', () => {
    const queue = [change('inbox_7_1', 'seen', true)];
    expect(pendingValue(queue, 'inbox_7_1', 'seen')).toBe(true);
    expect(pendingValue(queue, 'inbox_7_1', 'flagged')).toBeUndefined();
  });
});

describe('isPendingFlag', () => {
  it('accepts a well-formed entry and refuses anything else from disk', () => {
    expect(isPendingFlag(change('inbox_7_1', 'seen', true))).toBe(true);
    expect(isPendingFlag({ ...change('inbox_7_1', 'seen', true), flag: '\\Deleted' })).toBe(false);
    expect(isPendingFlag({ ...change('inbox_7_1', 'seen', true), value: 'yes' })).toBe(false);
    expect(isPendingFlag(null)).toBe(false);
  });
});

describe('parseServerId', () => {
  it('reads folder, epoch and uid from a server letter id', () => {
    expect(parseServerId('archive_1700000000_42')).toEqual({ folderId: 'archive', uidValidity: '1700000000', uid: 42 });
  });

  it('refuses local-only letters and malformed ids', () => {
    expect(parseServerId('local_sent_1_abc')).toBeNull();
    expect(parseServerId('inbox_7_x')).toBeNull();
    expect(parseServerId('trash_7_1')).toBeNull();
  });
});

describe('planFlagPush', () => {
  it('groups changes per folder, epoch, flag and value so each group is one STORE', () => {
    const queue = [
      change('inbox_7_1', 'seen', true),
      change('inbox_7_2', 'seen', true),
      change('inbox_7_3', 'seen', false),
      change('archive_9_4', 'flagged', true),
    ];
    const messages = new Map(queue.map((c) => [c.emailId, header(c.emailId)]));
    const { batches, stale } = planFlagPush(queue, messages);
    expect(stale).toEqual([]);
    expect(batches.map(({ folderId, uidValidity, uids, flag, value }) => ({ folderId, uidValidity, uids, flag, value }))).toEqual([
      { folderId: 'inbox', uidValidity: '7', uids: [1, 2], flag: 'seen', value: true },
      { folderId: 'inbox', uidValidity: '7', uids: [3], flag: 'seen', value: false },
      { folderId: 'archive', uidValidity: '9', uids: [4], flag: 'flagged', value: true },
    ]);
    expect(batches[0].changes).toEqual(queue.slice(0, 2));
  });

  it('splits a large group so no single STORE carries more than the cap', () => {
    const queue = Array.from({ length: MAX_STORE_UIDS * 2 + 1 }, (_, i) => change(`inbox_7_${i + 1}`, 'seen', true));
    const { batches } = planFlagPush(queue, new Map(queue.map((c) => [c.emailId, header(c.emailId)])));
    expect(batches.map((b) => b.uids.length)).toEqual([MAX_STORE_UIDS, MAX_STORE_UIDS, 1]);
    expect(batches.flatMap((b) => b.changes)).toEqual(queue);
  });

  it('marks changes for letters that are gone, or only exist locally, as stale', () => {
    const queue = [change('inbox_7_1', 'seen', true), change('local_sent_5_x', 'flagged', true)];
    const { batches, stale } = planFlagPush(queue, new Map([['local_sent_5_x', header('local_sent_5_x')]]));
    expect(batches).toEqual([]);
    expect(stale).toEqual(queue);
  });
});
