import { expect, test } from '@playwright/test';
import { launchApp, startFixtureServer, type FixtureServer, type LaunchedApp } from './fixtures';

let launched: LaunchedApp;
let remote: FixtureServer;

test.beforeEach(async () => {
  remote = await startFixtureServer();
  launched = await launchApp();
});

test.afterEach(async () => {
  await launched.close();
  await remote.close();
});

// What an email link would be once rendered; the reader shows email HTML as ordinary anchors
async function clickLink(page: LaunchedApp['page'], href: string, target?: string, clicks = 1) {
  await page.evaluate(
    ({ href, target }) => {
      document.getElementById('probe-link')?.remove();
      const a = document.createElement('a');
      a.id = 'probe-link';
      a.href = href;
      if (target) a.target = target;
      a.textContent = 'probe';
      a.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647';
      document.body.append(a);
    },
    { href, target }
  );
  // A raw mouse click: page.click would wait forever for the navigation the app cancels
  const box = await page.locator('#probe-link').boundingBox();
  if (!box) throw new Error('probe link is not visible');
  for (let i = 0; i < clicks; i++) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

// Only for "nothing happened" checks, which have no event to wait on
const settle = (page: LaunchedApp['page']) => page.waitForTimeout(800);

test('the window runs sandboxed and still has the bridge', async () => {
  // getLastWebPreferences exists at runtime but is missing from Electron's typings
  const sandboxed = await launched.app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents as unknown as { getLastWebPreferences(): { sandbox?: boolean } | null };
    return contents.getLastWebPreferences()?.sandbox;
  });
  expect(sandboxed).toBe(true);
  expect(await launched.page.evaluate(() => typeof window.electronAPI)).toBe('object');
  expect(await launched.page.evaluate(() => typeof (window as { require?: unknown }).require)).toBe('undefined');
  // The sender check must still recognise the app's own page, or every call would be refused
  expect(await launched.page.evaluate(() => window.electronAPI.getProviders())).toEqual([]);
});

test('a clicked web link opens in the browser and never replaces the app', async () => {
  const appUrl = launched.page.url();
  const link = remote.url('/phish');
  await clickLink(launched.page, link);

  await expect.poll(launched.opened).toEqual([link]);
  expect(launched.page.url()).toBe(appUrl);
  expect(remote.hits).toEqual([]);
  expect(await launched.page.evaluate(() => typeof window.electronAPI)).toBe('object');
});

test('a double click opens the link once', async () => {
  const link = remote.url('/twice');
  await clickLink(launched.page, link, undefined, 2);

  await expect.poll(launched.opened).toEqual([link]);
  await settle(launched.page);
  expect(await launched.opened()).toEqual([link]);
});

test('a target=_blank link opens no app window', async () => {
  const link = remote.url('/blank');
  await clickLink(launched.page, link, '_blank');

  await expect.poll(launched.opened).toEqual([link]);
  expect(launched.app.windows()).toHaveLength(1);
  expect(remote.hits).toEqual([]);
});

test('a scripted window.open is denied too', async () => {
  const link = remote.url('/popup');
  await launched.page.evaluate((url) => void window.open(url), link);

  await expect.poll(launched.opened).toEqual([link]);
  expect(launched.app.windows()).toHaveLength(1);
  expect(remote.hits).toEqual([]);
});

test('non-web links are blocked without reaching the OS', async () => {
  const appUrl = launched.page.url();
  await clickLink(launched.page, 'file:///C:/Windows/System32/drivers/etc/hosts');
  await settle(launched.page);

  expect(launched.page.url()).toBe(appUrl);
  expect(await launched.opened()).toEqual([]);
});

test('a frame can never load a remote page', async () => {
  await launched.page.evaluate((src) => {
    const frame = document.createElement('iframe');
    frame.src = src;
    document.body.append(frame);
  }, remote.url('/framed'));
  await settle(launched.page);

  expect(remote.hits).toEqual([]);
});

test('only the microphone is granted', async () => {
  const states = await launched.page.evaluate(async () => {
    const query = async (name: string) => (await navigator.permissions.query({ name: name as PermissionName })).state;
    return { microphone: await query('microphone'), geolocation: await query('geolocation'), notifications: await query('notifications') };
  });
  expect(states).toEqual({ microphone: 'granted', geolocation: 'denied', notifications: 'denied' });
});
