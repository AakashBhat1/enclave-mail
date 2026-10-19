import type { EmailMessage } from '../../renderer/types/index';

/** The two flags the app keeps in step with the server: read (\Seen) and starred (\Flagged). */
export type FlagKind = 'seen' | 'flagged';

/** A local read/star change the server has not confirmed yet. */
export interface PendingFlag {
  emailId: string;
  flag: FlagKind;
  value: boolean;
  queuedAt: number;
}

/** One STORE command: the same flag set to the same value on several letters of one folder epoch. */
export interface FlagBatch {
  folderId: string;
  uidValidity: string;
  uids: number[];
  flag: FlagKind;
  value: boolean;
  /** The queue entries this batch carries, acknowledged together once the server confirms. */
  changes: PendingFlag[];
}

export interface ServerLetter {
  folderId: string;
  uidValidity: string;
  uid: number;
}

const FLAG_KINDS: readonly string[] = ['seen', 'flagged'];
// Servers cap command length; "mark all read" on a big folder must not become one huge STORE
export const MAX_STORE_UIDS = 200;
// Only letters that came from a server folder have a UID to flag; `local_sent_…` copies do not
const SERVER_ID = /^(inbox|sent|drafts|archive)_(\d+)_(\d+)$/;

const sameTarget = (a: PendingFlag, b: Pick<PendingFlag, 'emailId' | 'flag'>) => a.emailId === b.emailId && a.flag === b.flag;
const sameChange = (a: PendingFlag, b: PendingFlag) => sameTarget(a, b) && a.value === b.value && a.queuedAt === b.queuedAt;

export function parseServerId(emailId: string): ServerLetter | null {
  const match = SERVER_ID.exec(emailId);
  return match ? { folderId: match[1], uidValidity: match[2], uid: Number(match[3]) } : null;
}

const targetKey = (c: Pick<PendingFlag, 'emailId' | 'flag'>) => `${c.flag}|${c.emailId}`;

/** Adds changes; a newer change to the same letter and flag replaces the older one (also within `changes`). */
export function queueFlags(queue: readonly PendingFlag[], changes: readonly PendingFlag[]): PendingFlag[] {
  const latest = new Map(changes.map((c) => [targetKey(c), c]));
  return [...queue.filter((c) => !latest.has(targetKey(c))), ...latest.values()];
}

/** Compacts UIDs into an IMAP sequence set ("1:4,9,12:13"), so a big batch stays a short command. */
export function toUidSet(uids: readonly number[]): string {
  const sorted = [...new Set(uids)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    ranges.push(start === sorted[i] ? String(start) : `${start}:${sorted[i]}`);
  }
  return ranges.join(',');
}

/** Removes the changes the server confirmed. A newer change queued while they were on their way stays. */
export function ackFlags(queue: readonly PendingFlag[], done: readonly PendingFlag[]): PendingFlag[] {
  return queue.filter((c) => !done.some((d) => sameChange(c, d)));
}

export function pendingValue(queue: readonly PendingFlag[], emailId: string, flag: FlagKind): boolean | undefined {
  return queue.find((c) => sameTarget(c, { emailId, flag }))?.value;
}

/** Shape check for entries read back from disk. */
export function isPendingFlag(value: unknown): value is PendingFlag {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.emailId === 'string' &&
    typeof entry.flag === 'string' &&
    FLAG_KINDS.includes(entry.flag) &&
    typeof entry.value === 'boolean' &&
    typeof entry.queuedAt === 'number'
  );
}

/**
 * Groups the queue into STORE commands. Changes for letters that no longer exist, or only exist locally,
 * come back as `stale`: there is nothing on the server to flag, so they are dropped.
 */
export function planFlagPush(
  queue: readonly PendingFlag[],
  messages: ReadonlyMap<string, Pick<EmailMessage, 'id'>>
): { batches: FlagBatch[]; stale: PendingFlag[] } {
  const groups = new Map<string, { uid: number; change: PendingFlag }[]>();
  const stale: PendingFlag[] = [];
  for (const change of queue) {
    const letter = messages.has(change.emailId) ? parseServerId(change.emailId) : null;
    if (!letter) {
      stale.push(change);
      continue;
    }
    const key = `${letter.folderId}|${letter.uidValidity}|${change.flag}|${change.value}`;
    const group = groups.get(key) ?? [];
    groups.set(key, [...group, { uid: letter.uid, change }]);
  }
  const batches = [...groups.values()].flatMap((entries) => {
    const first = parseServerId(entries[0].change.emailId) as ServerLetter;
    const { flag, value } = entries[0].change;
    const chunks: FlagBatch[] = [];
    for (let i = 0; i < entries.length; i += MAX_STORE_UIDS) {
      const chunk = entries.slice(i, i + MAX_STORE_UIDS);
      chunks.push({ folderId: first.folderId, uidValidity: first.uidValidity, uids: chunk.map((e) => e.uid), flag, value, changes: chunk.map((e) => e.change) });
    }
    return chunks;
  });
  return { batches, stale };
}
