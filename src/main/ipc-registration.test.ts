import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MAIN_DIR = path.resolve('src/main');
const RAW_IPC = /ipcMain\s*\.\s*(handle|handleOnce|on|once|addListener|prependListener)\s*\(/;

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [full] : [];
  });
}

describe('IPC registration', () => {
  // A channel registered straight on ipcMain would skip the sender check in guardIpc
  it('never registers a channel on ipcMain directly', () => {
    const offenders = sources(MAIN_DIR).filter((file) => RAW_IPC.test(fs.readFileSync(file, 'utf-8')));
    expect(offenders.map((file) => path.relative(MAIN_DIR, file))).toEqual([]);
  });
});
