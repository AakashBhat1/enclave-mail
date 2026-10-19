import type { StoreResult } from './imap-service';
import { planFlagPush, type FlagBatch, type FlagKind } from './pending-flags';
import type { StorageService } from './storage-service';

export const IMAP_FLAG: Readonly<Record<FlagKind, string>> = { seen: '\\Seen', flagged: '\\Flagged' };

/** Sends one batch. A missing server folder counts as 'refused'; a dropped connection throws. */
export type FlagStore = (batch: FlagBatch) => Promise<StoreResult>;

export interface FlagPushResult {
  sent: number;
  /** Refused by the server, or for letters that no longer exist: dropped for good. */
  dropped: number;
  /** In a renumbered folder: kept until the next sync moves them to the letters' new UIDs. */
  waiting: number;
}

type FlagQueue = Pick<StorageService, 'getPendingFlags' | 'ackPendingFlags' | 'getAllMessages'>;

/**
 * Sends every queued read/star change, one STORE per batch, and drops each batch from the queue as soon
 * as the server confirms it. A dropped connection stops the push and keeps the rest queued for the
 * next sync or reconnect; the error is rethrown.
 */
export async function pushPendingFlags(storage: FlagQueue, providerId: string, store: FlagStore): Promise<FlagPushResult> {
  const queue = storage.getPendingFlags(providerId);
  if (queue.length === 0) return { sent: 0, dropped: 0, waiting: 0 };
  const messages = new Map(storage.getAllMessages(providerId).map((m) => [m.id, m]));
  const { batches, stale } = planFlagPush(queue, messages);
  storage.ackPendingFlags(providerId, stale);

  const result = { sent: 0, dropped: stale.length, waiting: 0 };
  for (const batch of batches) {
    const outcome = await store(batch);
    if (outcome === 'renumbered') {
      result.waiting += batch.changes.length;
      continue;
    }
    // Acknowledged batch by batch, so a crash later on never re-sends what the server already has
    storage.ackPendingFlags(providerId, batch.changes);
    if (outcome === 'stored') result.sent += batch.changes.length;
    else result.dropped += batch.changes.length;
  }
  return result;
}
