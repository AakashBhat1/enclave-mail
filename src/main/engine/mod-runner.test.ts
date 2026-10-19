import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessage, ProviderEnclave } from '../../renderer/types/index';
import type { FolderSnapshot } from './imap-service';

const home = vi.hoisted(() => ({ dir: `${process.env.TEMP ?? process.env.TMPDIR ?? '/tmp'}/enclave-modrun-test-${process.pid}` }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, default: { ...actual, homedir: () => home.dir } };
});

const { StorageService } = await import('./storage-service');
const { ModEngine, EXPORT_ROOT } = await import('./mod-engine');
const { runModsOnEmail, tagNewMail } = await import('./mod-runner');

const PROVIDER = 'prov_mods';

function provider(): ProviderEnclave {
  return { id: PROVIDER, name: 'T', email: 'me@t.io', avatarColor: '#000', type: 'custom_imap', unreadTotal: 0, storagePath: '', status: 'connected' };
}

function letter(uid: number, subject: string, extra: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id: `inbox_7_${uid}`,
    uid,
    providerId: PROVIDER,
    folderId: 'inbox',
    from: { name: 'Ana', address: 'ana@acme.com' },
    to: [],
    subject,
    date: '',
    timestamp: uid,
    snippet: '',
    bodyText: `body ${uid}`,
    isRead: false,
    isStarred: false,
    tags: [],
    attachments: [],
    ...extra,
  };
}

function snapshot(messages: EmailMessage[]): FolderSnapshot {
  return { folder: { id: 'inbox', path: 'INBOX' }, uidValidity: '7', serverUids: messages.map((m) => m.uid ?? 0), flags: {}, newMessages: messages, pendingUids: [] };
}

const tagsOf = (storage: InstanceType<typeof StorageService>, id: string) => storage.getEmails(PROVIDER, 'inbox').find((m) => m.id === id)?.tags;

let storage: InstanceType<typeof StorageService>;
let engine: InstanceType<typeof ModEngine>;

beforeEach(() => {
  fs.rmSync(home.dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  storage = new StorageService();
  storage.addProvider(provider());
  engine = new ModEngine();
  storage.saveSyncedMessages(PROVIDER, [
    snapshot([
      letter(1, 'Invoice 12', { from: { name: 'GitHub', address: 'noreply@github.com' } }),
      letter(2, 'The Pragmatic Engineer weekly'),
      letter(3, 'Lunch?'),
    ]),
  ]);
});

afterAll(() => fs.rmSync(home.dir, { recursive: true, force: true }));

describe('runModsOnEmail', () => {
  it('saves the tags it applies, so they survive a restart', () => {
    const result = runModsOnEmail(storage, engine, PROVIDER, 'inbox_7_1');
    expect(result.appliedMods).toEqual(['Auto-File Finance Invoices & Receipts', 'GitHub & CI/CD Fast Tagger']);
    expect(result.tagsAdded).toEqual(['Tax-Deductible', 'DevOps-Pipeline']);
    expect(tagsOf(new StorageService(), 'inbox_7_1')).toEqual(['Tax-Deductible', 'DevOps-Pipeline']);
  });

  it('is idempotent', () => {
    runModsOnEmail(storage, engine, PROVIDER, 'inbox_7_1');
    expect(runModsOnEmail(storage, engine, PROVIDER, 'inbox_7_1').tagsAdded).toEqual([]);
    expect(tagsOf(storage, 'inbox_7_1')).toEqual(['Tax-Deductible', 'DevOps-Pipeline']);
  });

  it('runs only the named rule when asked', () => {
    expect(runModsOnEmail(storage, engine, PROVIDER, 'inbox_7_1', 'rule_devops_tagger').appliedMods).toEqual(['GitHub & CI/CD Fast Tagger']);
    expect(tagsOf(storage, 'inbox_7_1')).toEqual(['DevOps-Pipeline']);
  });

  it('writes a manual export inside the export root', () => {
    const result = runModsOnEmail(storage, engine, PROVIDER, 'inbox_7_2');
    expect(result.exported).toEqual([path.join(EXPORT_ROOT, 'Notes', 'TechReadings', 'The_Pragmatic_Engineer_weekly--inbox_7_2.md')]);
    expect(fs.readFileSync(result.exported[0], 'utf-8')).toContain('body 2');
  });

  it('refuses a malformed mod id instead of running every rule', () => {
    expect(() => runModsOnEmail(storage, engine, PROVIDER, 'inbox_7_1', 42 as unknown as string)).toThrow('Invalid mod id.');
    expect(() => runModsOnEmail(storage, engine, PROVIDER, 'inbox_7_1', '')).toThrow('Invalid mod id.');
    expect(tagsOf(storage, 'inbox_7_1')).toEqual([]);
  });

  it('keeps the tags when an export fails, and says so', () => {
    engine.saveRule({
      id: 'rule_tag_pragmatic',
      name: 'Tag newsletters',
      enabled: true,
      providerId: 'all',
      condition: { field: 'subject', operator: 'contains', value: 'Pragmatic' },
      action: { type: 'applyTag', targetValue: 'Reading' },
    });
    vi.spyOn(engine, 'writeExports').mockImplementation(() => {
      throw new Error('disk full');
    });
    expect(() => runModsOnEmail(storage, engine, PROVIDER, 'inbox_7_2')).toThrow(/tags were applied.*disk full/i);
    expect(tagsOf(storage, 'inbox_7_2')).toEqual(['Reading']);
  });

  it('refuses a letter that does not exist', () => {
    expect(() => runModsOnEmail(storage, engine, PROVIDER, 'inbox_7_99')).toThrow('Email not found.');
  });
});

describe('tagNewMail', () => {
  it('tags incoming letters before they are stored, never exports and never changes its input', () => {
    const incoming = [
      Object.freeze(letter(11, 'Invoice 99', { tags: Object.freeze(['Kept']) as string[] })),
      Object.freeze(letter(12, 'The Pragmatic weekly')),
      Object.freeze(letter(13, 'From GitHub', { from: { name: 'GH', address: 'ci@github.com' } })),
    ];
    const tagged = tagNewMail(engine, incoming);
    expect(tagged.map((m) => m.tags)).toEqual([['Kept', 'Tax-Deductible'], [], ['DevOps-Pipeline']]);
    expect(tagged[1]).toBe(incoming[1]);
    expect(incoming[0].tags).toEqual(['Kept']);
    expect(fs.existsSync(EXPORT_ROOT)).toBe(false);
  });

  it('matches body rules against the downloaded body', () => {
    engine.saveRule({
      id: 'rule_body',
      name: 'Body',
      enabled: true,
      providerId: 'all',
      condition: { field: 'body', operator: 'contains', value: 'secret word' },
      action: { type: 'applyTag', targetValue: 'Found' },
    });
    expect(tagNewMail(engine, [letter(14, 'Hi', { bodyText: 'the secret word is here' })])[0].tags).toEqual(['Found']);
  });

  it('costs nothing when no tag rule is enabled', () => {
    for (const r of engine.getRules()) if (r.enabled) engine.toggleRule(r.id);
    const incoming = [letter(15, 'Invoice')];
    expect(tagNewMail(engine, incoming)).toBe(incoming);
  });
});

describe('getEmailDetail', () => {
  it('hands out a copy, so a caller can never write into the cached list', () => {
    const detail = storage.getEmailDetail(PROVIDER, 'inbox_7_3')!;
    detail.tags.push('Leaked');
    detail.from.address = 'changed@x.io';
    expect(tagsOf(storage, 'inbox_7_3')).toEqual([]);
    // An unrelated write must not persist the stray tag either
    storage.toggleStar(PROVIDER, 'inbox_7_3');
    expect(tagsOf(new StorageService(), 'inbox_7_3')).toEqual([]);
    expect(storage.getEmails(PROVIDER, 'inbox').find((m) => m.id === 'inbox_7_3')?.from.address).toBe('ana@acme.com');
  });
});
