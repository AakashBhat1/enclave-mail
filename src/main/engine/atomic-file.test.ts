import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onStorageRecovered, readJsonSafe, writeFileAtomic, writeJsonAtomic, type StorageRecovery } from './atomic-file';

const isList = (value: unknown): value is unknown[] => Array.isArray(value);

let dir: string;
let file: string;
let recoveries: StorageRecovery[];
let unsubscribe: () => void;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enclave-atomic-'));
  file = path.join(dir, 'messages.json');
  recoveries = [];
  unsubscribe = onStorageRecovered((r) => recoveries.push(r));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  unsubscribe();
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

const siblings = () => fs.readdirSync(dir).sort();

describe('writeJsonAtomic', () => {
  it('writes the data and leaves no temp file behind', () => {
    writeJsonAtomic(file, [1, 2]);
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual([1, 2]);
    expect(siblings()).toEqual(['messages.json']);
  });

  it('keeps the previous version as .bak', () => {
    writeJsonAtomic(file, ['old']);
    writeJsonAtomic(file, ['new']);
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual(['new']);
    expect(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf-8'))).toEqual(['old']);
  });

  it('skips the backup when asked', () => {
    writeJsonAtomic(file, ['old'], { backup: false });
    writeJsonAtomic(file, ['new'], { backup: false });
    expect(siblings()).toEqual(['messages.json']);
  });

  it('creates the folder when it does not exist yet', () => {
    const nested = path.join(dir, 'bodies', 'a.json');
    writeJsonAtomic(nested, { bodyText: 'hi' });
    expect(JSON.parse(fs.readFileSync(nested, 'utf-8'))).toEqual({ bodyText: 'hi' });
  });

  it('pretty-prints only when given an indent', () => {
    writeJsonAtomic(file, { a: 1 }, { space: 2 });
    expect(fs.readFileSync(file, 'utf-8')).toBe('{\n  "a": 1\n}');
  });

  it('retries a rename that Windows briefly refuses', () => {
    const rename = fs.renameSync;
    let refusals = 2;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(from).endsWith('.tmp') && refusals-- > 0) throw Object.assign(new Error('busy'), { code: 'EPERM' });
      return rename(from, to);
    });
    writeJsonAtomic(file, ['ok']);
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual(['ok']);
  });

  it('gives up on a rename that keeps failing and keeps the old file readable', () => {
    writeJsonAtomic(file, ['old']);
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(from).endsWith('.tmp')) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      return rename(from, to);
    });
    expect(() => writeJsonAtomic(file, ['new'])).toThrow('busy');
    vi.restoreAllMocks();
    expect(readJsonSafe(file, [], isList)).toEqual(['old']);
  });
});

describe('writeFileAtomic', () => {
  it('writes raw bytes', () => {
    const bin = path.join(dir, 'credential.bin');
    writeFileAtomic(bin, Buffer.from([0, 1, 2, 255]), { backup: false });
    expect([...fs.readFileSync(bin)]).toEqual([0, 1, 2, 255]);
  });
});

describe('readJsonSafe', () => {
  it('returns the fallback for a file that was never written, without a recovery', () => {
    expect(readJsonSafe(file, [], isList)).toEqual([]);
    expect(recoveries).toEqual([]);
    expect(siblings()).toEqual([]);
  });

  it('reads a healthy file', () => {
    writeJsonAtomic(file, [{ id: 'a' }]);
    expect(readJsonSafe(file, [], isList)).toEqual([{ id: 'a' }]);
    expect(recoveries).toEqual([]);
  });

  it('restores a truncated file from .bak and sets the damaged one aside', () => {
    writeJsonAtomic(file, ['good']);
    writeJsonAtomic(file, ['newer']);
    fs.writeFileSync(file, '["newe', 'utf-8');

    expect(readJsonSafe(file, [], isList)).toEqual(['good']);
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual(['good']);
    const corrupt = siblings().filter((name) => name.startsWith('messages.json.corrupt-'));
    expect(corrupt).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, corrupt[0]), 'utf-8')).toBe('["newe');
    expect(recoveries).toEqual([{ file, outcome: 'restored' }]);
  });

  it('falls back when both copies are damaged, sets both aside and does not throw', () => {
    fs.writeFileSync(file, '{', 'utf-8');
    fs.writeFileSync(`${file}.bak`, '', 'utf-8');

    expect(readJsonSafe(file, [], isList)).toEqual([]);
    expect(siblings().some((name) => name === 'messages.json' || name === 'messages.json.bak')).toBe(false);
    expect(siblings().filter((name) => name.includes('.corrupt-'))).toHaveLength(2);
    expect(recoveries).toEqual([{ file, outcome: 'reset' }]);
  });

  it('treats valid JSON of the wrong shape as damaged', () => {
    fs.writeFileSync(file, '{"not":"a list"}', 'utf-8');
    expect(readJsonSafe(file, [], isList)).toEqual([]);
    expect(recoveries).toEqual([{ file, outcome: 'reset' }]);
  });

  it('recovers from a crash after the old file became .bak but before the new one landed', () => {
    writeJsonAtomic(file, ['committed']);
    fs.renameSync(file, `${file}.bak`);
    fs.writeFileSync(`${file}.tmp`, '["half', 'utf-8');

    expect(readJsonSafe(file, [], isList)).toEqual(['committed']);
    expect(fs.existsSync(file)).toBe(true);
    expect(recoveries).toEqual([{ file, outcome: 'restored' }]);
  });

  it('ignores a leftover temp file from a crash before the rename', () => {
    writeJsonAtomic(file, ['original']);
    fs.writeFileSync(`${file}.tmp`, '["partial', 'utf-8');
    expect(readJsonSafe(file, [], isList)).toEqual(['original']);
    expect(recoveries).toEqual([]);
  });

  it('retries a file an indexer or antivirus briefly holds, and never mistakes it for damage', () => {
    writeJsonAtomic(file, ['newest']);
    writeJsonAtomic(file, ['newest', 'again']);
    const read = fs.readFileSync;
    let refusals = 2;
    vi.spyOn(fs, 'readFileSync').mockImplementation(((target: fs.PathOrFileDescriptor, options?: unknown) => {
      if (target === file && refusals-- > 0) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      return read(target, options as BufferEncoding);
    }) as typeof fs.readFileSync);
    expect(readJsonSafe(file, [], isList)).toEqual(['newest', 'again']);
    expect(siblings().some((name) => name.includes('.corrupt-'))).toBe(false);
    expect(recoveries).toEqual([]);
  });

  it('throws on a file that stays locked instead of replacing it with an older copy', () => {
    writeJsonAtomic(file, ['old']);
    writeJsonAtomic(file, ['newest']);
    const read = fs.readFileSync;
    vi.spyOn(fs, 'readFileSync').mockImplementation(((target: fs.PathOrFileDescriptor, options?: unknown) => {
      if (target === file) throw Object.assign(new Error('locked'), { code: 'EPERM' });
      return read(target, options as BufferEncoding);
    }) as typeof fs.readFileSync);
    expect(() => readJsonSafe(file, [], isList)).toThrow('locked');
    vi.restoreAllMocks();
    expect(readJsonSafe(file, [], isList)).toEqual(['newest']);
    expect(recoveries).toEqual([]);
  });

  it('keeps only the newest few damaged copies', () => {
    for (let i = 1; i <= 4; i++) fs.writeFileSync(`${file}.corrupt-${1000 + i}`, 'old damage', 'utf-8');
    fs.writeFileSync(file, '{', 'utf-8');
    readJsonSafe(file, [], isList);
    const kept = siblings().filter((name) => name.includes('.corrupt-'));
    expect(kept).toHaveLength(2);
    expect(kept).toContain('messages.json.corrupt-1004');
  });

  it('reports a file it cannot set aside only once, until it is written again', () => {
    fs.writeFileSync(file, '{', 'utf-8');
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(to).includes('.corrupt-')) throw Object.assign(new Error('denied'), { code: 'EPERM' });
      return rename(from, to);
    });
    expect(readJsonSafe(file, [], isList)).toEqual([]);
    expect(readJsonSafe(file, [], isList)).toEqual([]);
    expect(recoveries).toEqual([{ file, outcome: 'reset' }]);

    writeJsonAtomic(file, ['fixed'], { backup: false });
    fs.writeFileSync(file, '{', 'utf-8');
    readJsonSafe(file, [], isList);
    expect(recoveries).toHaveLength(2);
  });

  it('restores through a temp file, leaving nothing half-copied', () => {
    writeJsonAtomic(file, ['good']);
    writeJsonAtomic(file, ['newer']);
    fs.writeFileSync(file, '["ne', 'utf-8');
    readJsonSafe(file, [], isList);
    expect(siblings().filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf-8'))).toEqual(['good']);
  });

  it('does not retry a plain permission error', () => {
    writeJsonAtomic(file, ['old']);
    const rename = fs.renameSync;
    const calls = vi.fn();
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(from).endsWith('.tmp')) {
        calls();
        throw Object.assign(new Error('read-only'), { code: 'EACCES' });
      }
      return rename(from, to);
    });
    expect(() => writeJsonAtomic(file, ['new'])).toThrow('read-only');
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('stops notifying a listener once it unsubscribes', () => {
    unsubscribe();
    fs.writeFileSync(file, '{', 'utf-8');
    readJsonSafe(file, [], isList);
    expect(recoveries).toEqual([]);
  });
});
