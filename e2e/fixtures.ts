import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, expect, type ElectronApplication, type Page } from '@playwright/test';

/** A throwaway Windows-style home so the app never touches the real ~/.enclavemail or profile. */
export function makeTempHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'enclave-e2e-'));
  // Electron exits with code 3 if these are missing
  for (const dir of ['AppData/Roaming', 'AppData/Local', '.enclavemail']) fs.mkdirSync(path.join(home, dir), { recursive: true });
  return home;
}

export const SEED_ACCOUNT = 'seed_acct';

export interface SeedMessage {
  uid: number;
  subject: string;
  from: { name: string; address: string };
  html?: string;
  text?: string;
}

const SEED_FOLDERS = [
  { id: 'inbox', name: 'Inbox', path: 'INBOX', iconName: 'Inbox' },
  { id: 'starred', name: 'Starred', path: 'Starred', iconName: 'Star' },
  { id: 'sent', name: 'Sent', path: 'Sent', iconName: 'Send' },
  { id: 'drafts', name: 'Drafts', path: 'Drafts', iconName: 'FileText' },
  { id: 'archive', name: 'Archive', path: 'Archive', iconName: 'Archive' },
];

/**
 * Writes an offline account straight into the app's storage. It has no server config, so the app never
 * tries to sync it. The highest uid is the newest letter, which the app opens on launch.
 */
export function seedAccount(home: string, messages: SeedMessage[]): string {
  const base = path.join(home, '.enclavemail');
  const dir = path.join(base, 'providers', SEED_ACCOUNT);
  fs.mkdirSync(path.join(dir, 'bodies'), { recursive: true });
  const now = Date.now();
  const headers = messages.map((m) => ({
    id: `inbox_1_${m.uid}`,
    uid: m.uid,
    providerId: SEED_ACCOUNT,
    folderId: 'inbox',
    from: m.from,
    to: [{ name: 'Seed Tester', address: 'me@seed.test' }],
    subject: m.subject,
    date: new Date(now - (1000 - m.uid) * 60_000).toUTCString(),
    timestamp: now - (1000 - m.uid) * 60_000,
    messageId: `<seed-${m.uid}@seed.test>`,
    snippet: (m.text ?? m.subject).slice(0, 80),
    isRead: false,
    isStarred: false,
    tags: [],
    attachments: [],
  }));
  for (const m of messages) {
    fs.writeFileSync(path.join(dir, 'bodies', `inbox_1_${m.uid}.json`), JSON.stringify({ bodyHtml: m.html, bodyText: m.text }));
  }
  fs.writeFileSync(path.join(dir, 'messages.json'), JSON.stringify(headers));
  fs.writeFileSync(
    path.join(dir, 'folders.json'),
    JSON.stringify(SEED_FOLDERS.map((f) => ({ ...f, totalCount: f.id === 'inbox' ? messages.length : 0, unreadCount: f.id === 'inbox' ? messages.length : 0 })))
  );
  fs.writeFileSync(path.join(dir, 'associations.json'), '[]');
  fs.writeFileSync(
    path.join(base, 'providers.json'),
    JSON.stringify([
      {
        id: SEED_ACCOUNT,
        name: 'Seed Tester',
        email: 'me@seed.test',
        avatarColor: '#C2410C',
        type: 'custom_imap',
        unreadTotal: messages.length,
        storagePath: dir,
        status: 'mock',
        // Recent, so the app does not try a sync on open
        lastSyncedAt: now,
      },
    ])
  );
  return dir;
}

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  home: string;
  /** Links the app handed to the OS (shell.openExternal is stubbed so no real browser opens). */
  opened: () => Promise<string[]>;
  /** Console lines from the app window that mention a Content Security Policy violation. */
  cspViolations: string[];
  close: () => Promise<void>;
}

export async function launchApp(seed?: (home: string) => void): Promise<LaunchedApp> {
  const home = makeTempHome();
  seed?.(home);
  const { VITE_DEV_SERVER_URL: _dev, ...env } = process.env;
  const app = await _electron.launch({
    args: ['.'],
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      ...env,
      USERPROFILE: home,
      HOME: home,
      APPDATA: path.join(home, 'AppData', 'Roaming'),
      LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    } as Record<string, string>,
  });
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as { __opened?: string[] }).__opened = opened;
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
  const cspViolations: string[] = [];
  app.context().on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) cspViolations.push(message.text());
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // The boot splash covers the window for ~1.5 s; raw mouse clicks would land on it
  await expect(page.getByRole('status', { name: 'Starting Enclave Mail' })).toHaveCount(0, { timeout: 15_000 });
  return {
    app,
    page,
    home,
    cspViolations,
    opened: () => app.evaluate(() => [...((globalThis as { __opened?: string[] }).__opened ?? [])]),
    close: async () => {
      await app.close();
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

export interface FixtureServer {
  url: (pathname: string) => string;
  /** Paths requested so far. */
  hits: string[];
  close: () => Promise<void>;
}

/** A local stand-in for a remote website that records every request it gets. */
export async function startFixtureServer(): Promise<FixtureServer> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url ?? '');
    res.setHeader('content-type', 'text/html');
    res.end('<p>remote page</p>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: (pathname) => `http://127.0.0.1:${port}${pathname}`,
    hits,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
