import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, seedAccount, SEED_ACCOUNT, type LaunchedApp } from './fixtures';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp((home) =>
    seedAccount(home, [
      { uid: 1, subject: 'Older letter', from: { name: 'Ana', address: 'ana@acme.test' }, text: 'one' },
      { uid: 2, subject: 'Newest letter', from: { name: 'Bo', address: 'bo@acme.test' }, text: 'two' },
    ])
  );
});

test.afterEach(async () => {
  await launched.close();
});

function pendingFlags(home: string): { emailId: string; flag: string; value: boolean }[] {
  const file = path.join(home, '.enclavemail', 'providers', SEED_ACCOUNT, 'pending-flags.json');
  if (!fs.existsSync(file)) return [];
  return (JSON.parse(fs.readFileSync(file, 'utf-8')) as { emailId: string; flag: string; value: boolean }[]).map(({ emailId, flag, value }) => ({
    emailId,
    flag,
    value,
  }));
}

test('reading and starring a letter are kept for the server until it confirms them', async () => {
  const { page, home } = launched;
  // The newest letter opens, and is marked read, on launch
  await expect.poll(() => pendingFlags(home)).toEqual([{ emailId: 'inbox_1_2', flag: 'seen', value: true }]);

  await page.locator('button.size-8[aria-label="Star"]').click();
  await expect(page.locator('button.size-8[aria-label="Unstar"]')).toBeVisible();
  await expect
    .poll(() => pendingFlags(home))
    .toEqual([
      { emailId: 'inbox_1_2', flag: 'seen', value: true },
      { emailId: 'inbox_1_2', flag: 'flagged', value: true },
    ]);
});
