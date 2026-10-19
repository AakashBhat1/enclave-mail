import fs from 'node:fs';
import path from 'node:path';

/** 'restored': the file was damaged or missing and its backup took its place. 'reset': nothing was readable. */
export type RecoveryOutcome = 'restored' | 'reset';

export interface StorageRecovery {
  file: string;
  outcome: RecoveryOutcome;
}

export interface AtomicWriteOptions {
  /** Keep the replaced version as `<file>.bak` (default true). Off for files that are cheap to lose. */
  backup?: boolean;
}

export interface JsonWriteOptions extends AtomicWriteOptions {
  space?: number;
}

// Windows refuses access while an indexer or antivirus briefly holds a file. EACCES is a real
// permission problem (a read-only file), so it fails straight away instead of being retried.
const RETRY_CODES = new Set(['EPERM', 'EBUSY']);
const ATTEMPTS = 6;
const RETRY_DELAY_MS = 15;
// Damaged copies are kept for inspection, but a file that keeps breaking must not fill the disk
const KEEP_CORRUPT = 2;

const listeners = new Set<(recovery: StorageRecovery) => void>();
// Files already reported as reset that could not be set aside; reported again only after a good write
const reportedResets = new Set<string>();

/** Hears about every damaged file that was restored or reset; returns an unsubscribe function. */
export function onStorageRecovered(listener: (recovery: StorageRecovery) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function report(recovery: StorageRecovery): void {
  if (recovery.outcome === 'reset') {
    if (reportedResets.has(recovery.file)) return;
    reportedResets.add(recovery.file);
  }
  console.error(`Storage: ${recovery.file} was unreadable and has been ${recovery.outcome === 'restored' ? 'restored from its backup' : 'reset'}.`);
  for (const listener of listeners) listener(recovery);
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withRetry<T>(run: () => T): T {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return run();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (!RETRY_CODES.has(code) || attempt >= ATTEMPTS) throw err;
      sleepSync(RETRY_DELAY_MS * attempt);
    }
  }
}

const renameWithRetry = (from: string, to: string): void => withRetry(() => fs.renameSync(from, to));

/**
 * Replaces `file` so a crash at any point leaves either the old or the new content, never a mix:
 * write `<file>.tmp` and flush it to disk, move the old file to `<file>.bak`, then rename the temp file in.
 * A crash between the two renames leaves only the .bak, which readJsonSafe restores.
 */
export function writeFileAtomic(file: string, data: string | Uint8Array, { backup = true }: AtomicWriteOptions = {}): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    if (backup && fs.existsSync(file)) renameWithRetry(file, `${file}.bak`);
    renameWithRetry(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    restoreAfterFailedSwap(file, backup);
    throw err;
  }
  reportedResets.delete(file);
}

// Put the previous version back if it had already moved aside, so readers never see a gap
function restoreAfterFailedSwap(file: string, backup: boolean): void {
  if (!backup || fs.existsSync(file) || !fs.existsSync(`${file}.bak`)) return;
  try {
    fs.copyFileSync(`${file}.bak`, file);
  } catch (err) {
    // The .bak is still there and readJsonSafe falls back to it; the original error matters more
    console.error(`Storage: could not put back ${file}:`, err instanceof Error ? err.message : err);
  }
}

export function writeJsonAtomic(file: string, value: unknown, { space, ...options }: JsonWriteOptions = {}): void {
  writeFileAtomic(file, JSON.stringify(value, null, space), options);
}

/** Shape checks for readJsonSafe: the element types are trusted to the code that wrote the file. */
export function isJsonArray<T>(value: unknown): value is T[] {
  return Array.isArray(value);
}

export function isJsonObject<T extends object>(value: unknown): value is T {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type Parsed<T> = { kind: 'missing' } | { kind: 'damaged' } | { kind: 'ok'; value: T; text: string };

/**
 * Only bad content counts as damage. A missing file is missing; a file that stays locked or
 * unreadable throws, because replacing it with an older backup would silently lose newer changes.
 */
function parseFile<T>(file: string, isValid: (value: unknown) => value is T): Parsed<T> {
  let text: string;
  try {
    text = withRetry(() => fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    throw err;
  }
  try {
    const value: unknown = JSON.parse(text);
    return isValid(value) ? { kind: 'ok', value, text } : { kind: 'damaged' };
  } catch {
    return { kind: 'damaged' };
  }
}

function pruneCorrupt(file: string): void {
  const dir = path.dirname(file);
  const prefix = `${path.basename(file)}.corrupt-`;
  const stamp = (name: string) => Number(name.slice(prefix.length)) || 0;
  const old = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    .sort((a, b) => stamp(b) - stamp(a))
    .slice(KEEP_CORRUPT);
  for (const name of old) fs.rmSync(path.join(dir, name), { force: true });
}

// Kept rather than deleted, so a damaged file can still be inspected or recovered by hand
function quarantine(file: string): void {
  try {
    renameWithRetry(file, `${file}.corrupt-${Date.now()}`);
    pruneCorrupt(file);
  } catch (err) {
    console.error(`Storage: could not set aside ${file}:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Reads a JSON file written by writeJsonAtomic. A damaged or wrongly shaped file is set aside and its
 * backup restored; with no usable backup the fallback is returned. Bad content never throws; a file
 * that cannot be read at all does.
 */
export function readJsonSafe<T>(file: string, fallback: T, isValid: (value: unknown) => value is T): T {
  const primary = parseFile(file, isValid);
  if (primary.kind === 'ok') return primary.value;
  if (primary.kind === 'damaged') quarantine(file);

  const backup = `${file}.bak`;
  const fromBackup = parseFile(backup, isValid);
  if (fromBackup.kind === 'ok') {
    writeFileAtomic(file, fromBackup.text, { backup: false });
    report({ file, outcome: 'restored' });
    return fromBackup.value;
  }
  if (fromBackup.kind === 'damaged') quarantine(backup);
  // A file that was simply never written is not a recovery
  if (primary.kind === 'damaged' || fromBackup.kind === 'damaged') report({ file, outcome: 'reset' });
  return fallback;
}
