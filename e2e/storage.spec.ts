import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, seedAccount, SEED_ACCOUNT, type LaunchedApp, type SeedMessage } from './fixtures';

let launched: LaunchedApp;

const LETTERS: SeedMessage[] = [
  { uid: 1, subject: 'Quarterly numbers', from: { name: 'Ana', address: 'ana@acme.test' }, text: 'See attached.' },
  { uid: 2, subject: 'Lunch on Friday', from: { name: 'Bo', address: 'bo@acme.test' }, text: 'Noon?' },
];

const messagesFile = (home: string) => path.join(home, '.enclavemail', 'providers', SEED_ACCOUNT, 'messages.json');

// What a crash halfway through saving the message list leaves on disk
function seedCrashedAccount(home: string, { withBackup }: { withBackup: boolean }) {
  seedAccount(home, LETTERS);
  const file = messagesFile(home);
  if (withBackup) fs.copyFileSync(file, `${file}.bak`);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf-8').slice(0, 60));
}

test.afterEach(async () => {
  await launched.close();
});

test('a message list cut off by a crash comes back from its backup', async () => {
  launched = await launchApp((home) => seedCrashedAccount(home, { withBackup: true }));
  const { page, home } = launched;

  await expect(page.getByRole('status').filter({ hasText: 'Recovered a damaged file' })).toBeVisible();
  for (const { subject } of LETTERS) await expect(page.getByRole('button', { name: new RegExp(subject) }).first()).toBeVisible();

  const dir = path.dirname(messagesFile(home));
  expect(JSON.parse(fs.readFileSync(messagesFile(home), 'utf-8'))).toHaveLength(LETTERS.length);
  expect(fs.readdirSync(dir).filter((name) => name.startsWith('messages.json.corrupt-'))).toHaveLength(1);
});

test('with no backup the app still opens, says so once, and keeps the damaged file', async () => {
  launched = await launchApp((home) => seedCrashedAccount(home, { withBackup: false }));
  const { page, home } = launched;

  await expect(page.getByRole('alert').filter({ hasText: 'Could not recover a damaged file' })).toHaveCount(1);
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.getByRole('button', { name: /Quarterly numbers/ })).toHaveCount(0);

  const dir = path.dirname(messagesFile(home));
  expect(fs.readdirSync(dir).filter((name) => name.startsWith('messages.json.corrupt-'))).toHaveLength(1);
});
