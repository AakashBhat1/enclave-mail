import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createAppUrlCheck, externalTarget, guardIpc, hardenWebContents, isPermissionAllowed, isTrustedSender, throttleOpens, type HardenableContents } from './security';

const INDEX = path.resolve('dist', 'index.html');
const INDEX_URL = pathToFileURL(INDEX).href;
const packaged = createAppUrlCheck({ indexHtml: INDEX });
const dev = createAppUrlCheck({ devServerUrl: 'http://localhost:5173/', indexHtml: INDEX });

describe('createAppUrlCheck', () => {
  it('accepts only the bundled index page when packaged', () => {
    expect(packaged(INDEX_URL)).toBe(true);
    expect(packaged(`${INDEX_URL}#inbox`)).toBe(true);
    expect(packaged(pathToFileURL(path.resolve('dist', 'other.html')).href)).toBe(false);
    expect(packaged(pathToFileURL(path.resolve('index.html')).href)).toBe(false);
    expect(packaged('http://localhost:5173/')).toBe(false);
  });

  it('accepts only the dev server origin in development', () => {
    expect(dev('http://localhost:5173/')).toBe(true);
    expect(dev('http://localhost:5173/src/renderer/main.tsx')).toBe(true);
    expect(dev('http://localhost:5174/')).toBe(false);
    expect(dev('http://127.0.0.1:5173/')).toBe(false);
    expect(dev(INDEX_URL)).toBe(false);
  });

  it('rejects junk and opaque urls', () => {
    for (const url of ['', 'not a url', 'about:blank', 'about:srcdoc', 'data:text/html,hi', 'javascript:alert(1)']) {
      expect(packaged(url)).toBe(false);
      expect(dev(url)).toBe(false);
    }
  });
});

describe('externalTarget', () => {
  it('passes web and mail links through', () => {
    expect(externalTarget('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(externalTarget('http://example.com')).toBe('http://example.com/');
    expect(externalTarget('mailto:ana@acme.com')).toBe('mailto:ana@acme.com');
  });

  it('never hands other schemes to the OS', () => {
    for (const url of ['javascript:alert(1)', 'file:///C:/Windows/System32/calc.exe', 'data:text/html,x', 'ms-settings:', 'smb://host/share', 'garbage']) {
      expect(externalTarget(url)).toBeNull();
    }
  });
});

describe('isTrustedSender', () => {
  it('trusts only frames showing the app page', () => {
    expect(isTrustedSender({ url: INDEX_URL }, packaged)).toBe(true);
    expect(isTrustedSender({ url: 'https://evil.example/' }, packaged)).toBe(false);
    expect(isTrustedSender({ url: 'about:srcdoc' }, packaged)).toBe(false);
    expect(isTrustedSender(null, packaged)).toBe(false);
    expect(isTrustedSender(undefined, packaged)).toBe(false);
  });
});

describe('isPermissionAllowed', () => {
  it('lets the app page use the microphone and nothing else', () => {
    expect(isPermissionAllowed('media', INDEX_URL, packaged)).toBe(true);
    expect(isPermissionAllowed('media', 'https://evil.example/', packaged)).toBe(false);
    for (const permission of ['geolocation', 'notifications', 'clipboard-read', 'openExternal', 'display-capture']) {
      expect(isPermissionAllowed(permission, INDEX_URL, packaged)).toBe(false);
    }
  });
});

type Listener = (details: { url: string; isMainFrame: boolean; preventDefault: () => void }) => void;

function fakeContents() {
  const listeners = new Map<string, Listener>();
  let openHandler: ((details: { url: string }) => { action: 'allow' | 'deny' }) | null = null;
  const contents: HardenableContents = {
    on: (event: string, listener: Listener) => {
      listeners.set(event, listener);
      return contents;
    },
    setWindowOpenHandler: (handler) => {
      openHandler = handler as typeof openHandler;
    },
  } as HardenableContents;
  const openExternal = vi.fn();
  hardenWebContents(contents, { isAppUrl: packaged, openExternal });

  const fire = (event: string, url: string, isMainFrame = true) => {
    const preventDefault = vi.fn();
    listeners.get(event)?.({ url, isMainFrame, preventDefault });
    return preventDefault.mock.calls.length > 0;
  };
  return { fire, openExternal, open: (url: string) => openHandler?.({ url }) };
}

describe('hardenWebContents', () => {
  it('lets the main frame load the app page', () => {
    const { fire, openExternal } = fakeContents();
    expect(fire('will-frame-navigate', INDEX_URL)).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('keeps a clicked web link out of the app and opens it in the browser', () => {
    const { fire, openExternal } = fakeContents();
    expect(fire('will-frame-navigate', 'https://evil.example/login')).toBe(true);
    expect(openExternal).toHaveBeenCalledWith('https://evil.example/login');
  });

  it('blocks other schemes without handing them to the OS', () => {
    const { fire, openExternal } = fakeContents();
    for (const url of ['javascript:alert(1)', 'file:///C:/Windows/System32/calc.exe', 'data:text/html,x']) {
      expect(fire('will-frame-navigate', url)).toBe(true);
    }
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('lets an email frame start blank but never browse away', () => {
    const { fire, openExternal } = fakeContents();
    expect(fire('will-frame-navigate', 'about:srcdoc', false)).toBe(false);
    expect(fire('will-frame-navigate', 'about:blank', false)).toBe(false);
    expect(fire('will-frame-navigate', 'https://evil.example/', false)).toBe(true);
    expect(fire('will-frame-navigate', INDEX_URL, false)).toBe(true);
    expect(openExternal).toHaveBeenCalledTimes(1);
  });

  it('stops redirects away from the app without opening them', () => {
    const { fire, openExternal } = fakeContents();
    expect(fire('will-redirect', 'https://evil.example/')).toBe(true);
    expect(fire('will-redirect', INDEX_URL)).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('never opens a new app window', () => {
    const { open, openExternal } = fakeContents();
    expect(open('https://example.com/')).toEqual({ action: 'deny' });
    expect(open('file:///C:/x.html')).toEqual({ action: 'deny' });
    expect(open(INDEX_URL)).toEqual({ action: 'deny' });
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith('https://example.com/');
  });
});

type SenderEvent = { senderFrame: { url: string } | null };

function fakeIpc() {
  const handlers = new Map<string, (event: SenderEvent, ...args: unknown[]) => unknown>();
  const listeners = new Map<string, (event: SenderEvent, ...args: unknown[]) => void>();
  return {
    ipc: {
      handle: (channel: string, fn: (event: SenderEvent, ...args: unknown[]) => unknown) => void handlers.set(channel, fn),
      on: (channel: string, fn: (event: SenderEvent, ...args: unknown[]) => void) => void listeners.set(channel, fn),
    },
    invoke: (channel: string, event: SenderEvent, ...args: unknown[]) => handlers.get(channel)!(event, ...args),
    send: (channel: string, event: SenderEvent, ...args: unknown[]) => listeners.get(channel)!(event, ...args),
  };
}

const fromApp: SenderEvent = { senderFrame: { url: INDEX_URL } };
const fromRemote: SenderEvent = { senderFrame: { url: 'https://evil.example/' } };
// A frame torn down mid-call: Electron may hand over null or a frame whose properties throw
const destroyed: SenderEvent = {
  get senderFrame(): { url: string } {
    throw new Error('Render frame was disposed before WebFrameMain could be accessed');
  },
};

describe('guardIpc', () => {
  it('answers the app page and refuses everyone else', () => {
    const { ipc, invoke } = fakeIpc();
    const listener = vi.fn((_event: SenderEvent, a: number, b: number) => a + b);
    guardIpc(ipc, packaged).handle('add', listener);

    expect(invoke('add', fromApp, 2, 3)).toBe(5);
    for (const event of [fromRemote, { senderFrame: { url: 'about:srcdoc' } }, { senderFrame: null }, destroyed]) {
      expect(() => invoke('add', event, 2, 3)).toThrow(/Refused/);
    }
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('drops one-way messages from anyone but the app page without throwing', () => {
    const { ipc, send } = fakeIpc();
    const listener = vi.fn();
    guardIpc(ipc, packaged).on('window-close', listener);

    send('window-close', fromApp);
    expect(() => send('window-close', fromRemote)).not.toThrow();
    expect(() => send('window-close', destroyed)).not.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('throttleOpens', () => {
  it('ignores a repeat of the same link and bursts of links', () => {
    let clock = 0;
    const open = vi.fn();
    const throttled = throttleOpens(open, { limit: 3, windowMs: 3000, now: () => clock });

    throttled('https://a.example/');
    throttled('https://a.example/'); // double click
    throttled('https://b.example/');
    throttled('https://c.example/');
    throttled('https://d.example/'); // fourth inside the window
    expect(open.mock.calls.map(([url]) => url)).toEqual(['https://a.example/', 'https://b.example/', 'https://c.example/']);

    clock = 3000;
    throttled('https://a.example/');
    expect(open).toHaveBeenLastCalledWith('https://a.example/');
  });
});
