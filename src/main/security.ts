import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type AppUrlCheck = (url: string) => boolean;

export interface AppLocation {
  /** Set in development: the Vite server origin is the app. */
  devServerUrl?: string;
  /** The bundled page that is the app once packaged. */
  indexHtml: string;
}

interface NavigationDetails {
  url: string;
  isMainFrame: boolean;
  preventDefault: () => void;
}

/** The slice of Electron's WebContents this module touches, so it can be tested without Electron. */
export interface HardenableContents {
  on(event: 'will-frame-navigate' | 'will-redirect', listener: (details: NavigationDetails) => void): unknown;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void;
}

export interface HardenOptions {
  isAppUrl: AppUrlCheck;
  /** Hands a link to the user's browser or mail app. */
  openExternal: (url: string) => void;
}

// Only these leave the app, and only through the OS default handler; file:, data:, custom protocols never do
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
// A sandboxed email frame starts on one of these and must never navigate anywhere else
const BLANK_FRAME_URLS = new Set(['about:blank', 'about:srcdoc']);
// The microphone, for voice search; every other browser permission is refused
const ALLOWED_PERMISSIONS = new Set(['media']);

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(a) === norm(b);
}

export function createAppUrlCheck({ devServerUrl, indexHtml }: AppLocation): AppUrlCheck {
  const devOrigin = devServerUrl ? parseUrl(devServerUrl)?.origin : undefined;
  return (raw) => {
    const url = parseUrl(raw);
    if (!url) return false;
    if (devOrigin) return url.origin === devOrigin;
    if (url.protocol !== 'file:') return false;
    try {
      return samePath(fileURLToPath(url), indexHtml);
    } catch {
      return false;
    }
  };
}

/** The link to hand to the OS, or null when it must not leave the app at all. */
export function externalTarget(raw: string): string | null {
  const url = parseUrl(raw);
  return url && EXTERNAL_PROTOCOLS.has(url.protocol) ? url.href : null;
}

/** IPC is answered only for the app's own page, never for a remote page or an email frame. */
export function isTrustedSender(frame: { url: string } | null | undefined, isAppUrl: AppUrlCheck): boolean {
  return !!frame && isAppUrl(frame.url);
}

interface SenderEvent {
  readonly senderFrame: { readonly url: string } | null;
}

/** The two ipcMain methods guardIpc wraps; Electron's ipcMain satisfies it. */
export interface GuardableIpc<InvokeEvent extends SenderEvent, SendEvent extends SenderEvent> {
  handle(channel: string, listener: (event: InvokeEvent, ...args: any[]) => unknown): void;
  on(channel: string, listener: (event: SendEvent, ...args: any[]) => void): unknown;
}

// A frame torn down mid-call can be null or throw on access; either way it is not the app
function cameFromApp(event: SenderEvent, isAppUrl: AppUrlCheck): boolean {
  try {
    return isTrustedSender(event.senderFrame, isAppUrl);
  } catch {
    return false;
  }
}

/** Registers IPC channels that answer only the app's own page. Register every channel through this. */
export function guardIpc<InvokeEvent extends SenderEvent, SendEvent extends SenderEvent>(
  ipc: GuardableIpc<InvokeEvent, SendEvent>,
  isAppUrl: AppUrlCheck
) {
  return {
    handle(channel: string, listener: (event: InvokeEvent, ...args: any[]) => unknown): void {
      ipc.handle(channel, (event, ...args) => {
        if (!cameFromApp(event, isAppUrl)) throw new Error('Refused: this request did not come from Enclave Mail.');
        return listener(event, ...args);
      });
    },
    // One-way messages have no caller to reject, so anything untrusted is dropped silently
    on(channel: string, listener: (event: SendEvent, ...args: any[]) => void): void {
      ipc.on(channel, (event, ...args) => {
        if (cameFromApp(event, isAppUrl)) listener(event, ...args);
      });
    },
  };
}

export interface ThrottleOptions {
  limit?: number;
  windowMs?: number;
  now?: () => number;
}

/**
 * Caps how often links reach the OS: a double click opens one tab, and a burst (a page looping
 * window.open) opens at most `limit` per window instead of flooding the browser.
 */
export function throttleOpens(open: (url: string) => void, { limit = 3, windowMs = 3000, now = Date.now }: ThrottleOptions = {}) {
  let recent: { url: string; at: number }[] = [];
  return (url: string): void => {
    const at = now();
    recent = recent.filter((entry) => at - entry.at < windowMs);
    if (recent.length >= limit || recent.some((entry) => entry.url === url)) return;
    recent = [...recent, { url, at }];
    open(url);
  };
}

export function isPermissionAllowed(permission: string, requestingUrl: string, isAppUrl: AppUrlCheck): boolean {
  return ALLOWED_PERMISSIONS.has(permission) && isAppUrl(requestingUrl);
}

function isAllowedNavigation(url: string, isMainFrame: boolean, isAppUrl: AppUrlCheck): boolean {
  return isMainFrame ? isAppUrl(url) : BLANK_FRAME_URLS.has(url);
}

/**
 * Keeps every window on the app page: a clicked link opens in the user's browser instead of replacing the
 * app (a replaced page would inherit the preload bridge), and no page can open a new app window.
 */
export function hardenWebContents(contents: HardenableContents, { isAppUrl, openExternal }: HardenOptions): void {
  const leave = (url: string) => {
    const target = externalTarget(url);
    if (target) openExternal(target);
  };

  contents.on('will-frame-navigate', (details) => {
    if (isAllowedNavigation(details.url, details.isMainFrame, isAppUrl)) return;
    details.preventDefault();
    leave(details.url);
  });

  // A redirect is never something the user clicked, so it is stopped without opening anything
  contents.on('will-redirect', (details) => {
    if (!isAllowedNavigation(details.url, details.isMainFrame, isAppUrl)) details.preventDefault();
  });

  contents.setWindowOpenHandler(({ url }) => {
    leave(url);
    return { action: 'deny' };
  });
}
