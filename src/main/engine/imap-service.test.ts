import { describe, expect, it } from 'vitest';
import { planDownloads } from './imap-service';

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
