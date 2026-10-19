import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type FrameLocator, type Locator } from '@playwright/test';
import { launchApp, seedAccount, startFixtureServer, SEED_ACCOUNT, type FixtureServer, type LaunchedApp, type SeedMessage } from './fixtures';

let launched: LaunchedApp;
let remote: FixtureServer;

const TRACKER = { name: 'Weekly Digest', address: 'digest@tracker.test' };
const NEWSLETTER = { name: 'Trusted News', address: 'news@trusted.test' };

// Hostile and ordinary letters; the highest uid (the tracker) is the one the app opens on launch
function seedMessages(server: FixtureServer): SeedMessage[] {
  const paragraphs = Array.from({ length: 40 }, (_, i) => `<p>Paragraph ${i + 1} of the weekly digest.</p>`).join('');
  return [
    { uid: 1, subject: 'Plain text letter', from: { name: 'Ana', address: 'ana@acme.test' }, text: 'Just words, no HTML at all.' },
    {
      uid: 2,
      subject: 'Trusted newsletter',
      from: NEWSLETTER,
      html: `<h1>News</h1><img alt="hero" src="${server.url('/newsletter-hero.png')}">`,
    },
    {
      uid: 3,
      subject: 'Hijack attempt',
      from: { name: 'Security Team', address: 'security@phish.test' },
      html:
        '<p>Hello</p><style>#root{display:none!important} body{background:red!important}</style>' +
        '<div style="position:fixed;inset:0;z-index:2147483647;background:#fff">Sign in again to keep your account</div>' +
        '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" onerror="parent.document.title=\'pwned\'">',
    },
    {
      uid: 4,
      subject: 'Full screen promo',
      from: { name: 'Promo', address: 'promo@shop.test' },
      // Sized from the frame: these would make a frame that grows to fit its letter grow forever
      html:
        '<style>html,body{height:100%} body{min-height:100vh;padding:20px} .hero{height:100vh;padding-bottom:40px}</style>' +
        '<div class="hero">Big sale</div><p>Terms apply</p>',
    },
    {
      uid: 5,
      subject: 'Weekly tracker digest',
      from: TRACKER,
      html:
        `<p>Hi there</p><img src="${server.url('/pixel.png?id=seed')}" width="1" height="1">` +
        `<div style="background:url(${server.url('/bg.png')})">Featured</div>` +
        `<p><a id="read-online" href="${server.url('/clicked')}">Read online</a></p>${paragraphs}`,
    },
  ];
}

test.beforeEach(async () => {
  remote = await startFixtureServer();
  launched = await launchApp((home) => seedAccount(home, seedMessages(remote)));
});

test.afterEach(async () => {
  const violations = [...launched.cspViolations];
  await launched.close();
  await remote.close();
  // Nothing should ever reach the CSP: the sanitiser removes remote references before the frame sees them
  expect(violations).toEqual([]);
});

const reader = (page: LaunchedApp['page']): Locator => page.locator('iframe[title^="Email:"]');
const frame = (page: LaunchedApp['page']): FrameLocator => page.frameLocator('iframe[title^="Email:"]');
const settle = (page: LaunchedApp['page']) => page.waitForTimeout(800);

// The letter slides in and the frame grows after load, so wait until the element stops moving
async function settledBox(target: Locator) {
  let last = '';
  await expect
    .poll(async () => {
      const box = JSON.stringify(await target.boundingBox());
      const stable = box === last && box !== 'null';
      last = box;
      return stable;
    }, { intervals: [150] })
    .toBe(true);
  return JSON.parse(last) as { x: number; y: number; width: number; height: number };
}

async function openLetter(page: LaunchedApp['page'], subject: string, { html = true } = {}) {
  const row = page.getByRole('button', { name: new RegExp(subject) }).first();
  await row.click();
  await expect(row).toHaveAttribute('aria-current', 'true');
  if (html) await expect(reader(page)).toHaveAttribute('title', `Email: ${subject}`);
}

test('an HTML letter opens in a sealed frame with tracking blocked', async () => {
  const { page } = launched;
  await expect(frame(page).getByText('Hi there')).toBeVisible();

  const sandbox = (await reader(page).getAttribute('sandbox')) ?? '';
  expect(sandbox.split(/\s+/)).not.toContain('allow-scripts');
  await expect(page.getByRole('status').filter({ hasText: '2 remote images blocked' })).toBeVisible();
  await settle(page);
  expect(remote.hits).toEqual([]);
});

test('the frame grows to fit a long letter', async () => {
  const { page } = launched;
  await expect(frame(page).getByText('Paragraph 40 of the weekly digest.')).toBeAttached();
  await expect.poll(async () => (await reader(page).boundingBox())?.height ?? 0).toBeGreaterThan(900);
});

test('a letter sized from the frame settles instead of growing forever', async () => {
  const { page } = launched;
  await openLetter(page, 'Full screen promo');
  await expect(frame(page).getByText('Terms apply')).toBeAttached();
  // A runaway frame never stops moving, so settledBox would time out; a fixed one settles and stays put
  const first = await settledBox(reader(page));
  await settle(page);
  expect((await reader(page).boundingBox())?.height).toBe(first.height);
  expect(first.height).toBeLessThan(5000);
});

test('"Load images" fetches them for this letter only', async () => {
  const { page } = launched;
  await page.getByRole('button', { name: 'Load images' }).click();

  await expect.poll(() => remote.hits).toEqual(expect.arrayContaining(['/pixel.png?id=seed', '/bg.png']));
  await expect(page.getByRole('status').filter({ hasText: 'remote images blocked' })).toHaveCount(0);

  await openLetter(page, 'Trusted newsletter');
  await expect(page.getByRole('status').filter({ hasText: '1 remote image blocked' })).toBeVisible();
  await settle(page);
  expect(remote.hits).not.toContain('/newsletter-hero.png');
});

test('a link in a letter opens in the browser, not in the app', async () => {
  const { page } = launched;
  const appUrl = page.url();
  const link = frame(page).locator('#read-online');
  await link.scrollIntoViewIfNeeded();
  const box = await settledBox(link);
  // A raw click: Playwright's click would wait on the navigation the app cancels
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await expect.poll(launched.opened).toEqual([remote.url('/clicked')]);
  expect(page.url()).toBe(appUrl);
  expect(launched.app.windows()).toHaveLength(1);
  expect(remote.hits).not.toContain('/clicked');
});

test("a letter's styles and overlays stay inside its frame", async () => {
  const { page } = launched;
  await openLetter(page, 'Hijack attempt');
  await expect(frame(page).getByText('Sign in again to keep your account')).toBeVisible();

  const outside = await page.evaluate(() => {
    const row = [...document.querySelectorAll('[role="button"]')].find((el) => el.textContent?.includes('Plain text letter'))!;
    const rect = row.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      rootDisplay: getComputedStyle(document.getElementById('root')!).display,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      title: document.title,
      overlayInApp: document.body.innerText.includes('Sign in again'),
      rowStillOnTop: !!hit && row.contains(hit),
    };
  });
  expect(outside.rootDisplay).not.toBe('none');
  expect(outside.bodyBackground).not.toBe('rgb(255, 0, 0)');
  expect(outside.title).toBe('Enclave Mail');
  expect(outside.overlayInApp).toBe(false);
  expect(outside.rowStillOnTop).toBe(true);
});

test('"Always for this sender" is remembered for the account', async () => {
  const { page } = launched;
  await openLetter(page, 'Trusted newsletter');
  await page.getByRole('button', { name: `Always for ${NEWSLETTER.address}` }).click();

  await expect.poll(() => remote.hits).toContain('/newsletter-hero.png');
  const stored = JSON.parse(fs.readFileSync(path.join(launched.home, '.enclavemail', 'providers', SEED_ACCOUNT, 'trusted-senders.json'), 'utf-8'));
  expect(stored).toEqual([NEWSLETTER.address]);

  // Leaving and coming back loads straight away, with no banner
  await openLetter(page, 'Plain text letter', { html: false });
  await openLetter(page, 'Trusted newsletter');
  await expect(frame(page).getByAltText('hero')).toHaveAttribute('src', remote.url('/newsletter-hero.png'));
  await expect(page.getByRole('status').filter({ hasText: 'remote image' })).toHaveCount(0);
});

test('plain-text letters still render as text', async () => {
  const { page } = launched;
  await openLetter(page, 'Plain text letter', { html: false });
  await expect(page.getByText('Just words, no HTML at all.').last()).toBeVisible();
  await expect(reader(page)).toHaveCount(0);
});

test('the app boots under its CSP without violations', async () => {
  const { page } = launched;
  await page.reload();
  await expect(frame(page).getByText('Hi there')).toBeVisible();
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  // The built app never needs inline scripts; only the dev server's policy allows them
  expect(policy?.match(/script-src[^;]*/)?.[0]).toBe("script-src 'self'");
});
