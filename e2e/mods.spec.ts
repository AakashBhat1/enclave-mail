import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator } from '@playwright/test';
import { launchApp, seedAccount, SEED_ACCOUNT, type LaunchedApp, type SeedMessage } from './fixtures';

let launched: LaunchedApp;

// The highest uid opens on launch
const LETTERS: SeedMessage[] = [
  { uid: 1, subject: 'Invoice 7 for October', from: { name: 'Billing', address: 'billing@acme.test' }, text: 'Amount due: 10 EUR' },
  { uid: 2, subject: 'The Pragmatic weekly', from: { name: 'Newsletter', address: 'news@pragmatic.test' }, text: 'This week: queues.' },
  { uid: 3, subject: 'Lunch on Friday', from: { name: 'Bo', address: 'bo@acme.test' }, text: 'Noon?' },
];

test.beforeEach(async () => {
  launched = await launchApp((home) => seedAccount(home, LETTERS));
});

test.afterEach(async () => {
  await launched.close();
});

const runMod = (page: LaunchedApp['page']): Locator => page.locator('button[title="Run automation mods on this email"]');

async function openLetter(page: LaunchedApp['page'], subject: string) {
  const row = page.getByRole('button', { name: new RegExp(subject) }).first();
  await row.click();
  await expect(row).toHaveAttribute('aria-current', 'true');
}

function storedTags(home: string, uid: number): string[] {
  const file = path.join(home, '.enclavemail', 'providers', SEED_ACCOUNT, 'messages.json');
  const all = JSON.parse(fs.readFileSync(file, 'utf-8')) as { uid: number; tags: string[] }[];
  return all.find((m) => m.uid === uid)?.tags ?? [];
}

test('"Run mod" tags the letter, shows it and saves it', async () => {
  const { page, home } = launched;
  await openLetter(page, 'Invoice 7 for October');
  await runMod(page).click();

  await expect(page.getByRole('status').filter({ hasText: 'Mod applied' })).toBeVisible();
  await expect(page.getByText('Tax-Deductible').first()).toBeVisible();
  expect(storedTags(home, 1)).toEqual(['Tax-Deductible']);
});

test('an export rule writes its note inside the exports folder only', async () => {
  const { page, home } = launched;
  await openLetter(page, 'The Pragmatic weekly');
  await runMod(page).click();

  await expect(page.getByRole('status').filter({ hasText: 'Saved a note' })).toBeVisible();
  const note = path.join(home, 'EnclaveMail', 'exports', 'Notes', 'TechReadings', 'The_Pragmatic_weekly--inbox_1_2.md');
  expect(fs.readFileSync(note, 'utf-8')).toContain('This week: queues.');
});

test('a letter no rule matches says so and changes nothing', async () => {
  const { page, home } = launched;
  await openLetter(page, 'Lunch on Friday');
  await runMod(page).click();

  await expect(page.getByRole('status').filter({ hasText: 'No rule matched' })).toBeVisible();
  expect(storedTags(home, 3)).toEqual([]);
});
