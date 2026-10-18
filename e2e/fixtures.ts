import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, type ElectronApplication, type Page } from '@playwright/test';

/** A throwaway Windows-style home so the app never touches the real ~/.enclavemail or profile. */
export function makeTempHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'enclave-e2e-'));
  // Electron exits with code 3 if these are missing
  for (const dir of ['AppData/Roaming', 'AppData/Local', '.enclavemail']) fs.mkdirSync(path.join(home, dir), { recursive: true });
  return home;
}

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  /** Links the app handed to the OS (shell.openExternal is stubbed so no real browser opens). */
  opened: () => Promise<string[]>;
  close: () => Promise<void>;
}

export async function launchApp(): Promise<LaunchedApp> {
  const home = makeTempHome();
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
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return {
    app,
    page,
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
