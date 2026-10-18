import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessage, ProviderEnclave } from '../../renderer/types/index';
import type { FolderSnapshot } from './imap-service';

// The service resolves ~/.enclavemail at import time, so point the home dir at a throwaway folder first
const home = vi.hoisted(() => ({ dir: `${process.env.TEMP ?? process.env.TMPDIR ?? '/tmp'}/enclave-storage-test-${process.pid}` }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, default: { ...actual, homedir: () => home.dir } };
});

const { StorageService } = await import('./storage-service');

const PROVIDER = 'prov_test';

function provider(): ProviderEnclave {
  return { id: PROVIDER, name: 'Test', email: 'me@test.io', avatarColor: '#000', type: 'custom_imap', unreadTotal: 0, storagePath: '', status: 'connected' };
}

function email(folderId: string, uidValidity: string, uid: number, extra: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id: `${folderId}_${uidValidity}_${uid}`,
    uid,
    providerId: PROVIDER,
    folderId,
    from: { name: 'Ana', address: 'ana@acme.com' },
    to: [],
    subject: `Letter ${uid}`,
    date: '',
    timestamp: uid * 1000,
    snippet: '',
    bodyText: `body ${uid}`,
    isRead: false,
    isStarred: false,
    tags: [],
    attachments: [],
    ...extra,
  };
}

function snapshot(serverUids: number[], newMessages: EmailMessage[], extra: Partial<FolderSnapshot> = {}): FolderSnapshot {
  return { folder: { id: 'inbox', path: 'INBOX' }, uidValidity: '7', serverUids, seen: {}, newMessages, pendingUids: [], ...extra };
}

describe('StorageService', () => {
  let storage: InstanceType<typeof StorageService>;

  beforeEach(() => {
    fs.rmSync(home.dir, { recursive: true, force: true });
    storage = new StorageService();
    storage.addProvider(provider());
  });

  afterAll(() => fs.rmSync(home.dir, { recursive: true, force: true }));

  it('keeps bodies out of lists and serves them on detail', () => {
    storage.saveSyncedMessages(PROVIDER, [snapshot([1], [email('inbox', '7', 1)])]);
    const [listed] = storage.getEmails(PROVIDER, 'inbox');
    expect(listed.bodyText).toBeUndefined();
    expect(storage.getEmailDetail(PROVIDER, listed.id)?.bodyText).toBe('body 1');
  });

  it('keeps local filing across syncs and drops letters deleted on the server', () => {
    storage.saveSyncedMessages(PROVIDER, [snapshot([1, 2], [email('inbox', '7', 1), email('inbox', '7', 2)])]);
    storage.reassignEmailTree(PROVIDER, 'inbox_7_1', 'assoc_a', 'agenda_a');
    storage.saveSyncedMessages(PROVIDER, [snapshot([1], [])]);
    const all = storage.getEmails(PROVIDER, 'inbox');
    expect(all.map((m) => m.id)).toEqual(['inbox_7_1']);
    expect(all[0]).toMatchObject({ associationId: 'assoc_a', agendaId: 'agenda_a' });
    expect(fs.existsSync(path.join(home.dir, '.enclavemail', 'providers', PROVIDER, 'bodies', 'inbox_7_2.json'))).toBe(false);
  });

  it('carries filing to the same letter after the server renumbers the folder', () => {
    storage.saveSyncedMessages(PROVIDER, [snapshot([1], [email('inbox', '7', 1, { messageId: '<a@x>' })])]);
    storage.toggleStar(PROVIDER, 'inbox_7_1');
    storage.saveSyncedMessages(PROVIDER, [snapshot([40], [email('inbox', '8', 40, { messageId: '<a@x>' })], { uidValidity: '8' })]);
    expect(storage.getEmails(PROVIDER, 'inbox')).toMatchObject([{ id: 'inbox_8_40', isStarred: true }]);
  });

  it('never un-reads a letter the user opened, and takes server read state for the window', () => {
    storage.saveSyncedMessages(PROVIDER, [snapshot([1, 2], [email('inbox', '7', 1), email('inbox', '7', 2)])]);
    storage.markEmailRead(PROVIDER, 'inbox_7_1', true);
    storage.saveSyncedMessages(PROVIDER, [snapshot([1, 2], [], { seen: { 1: false, 2: true } })]);
    expect(storage.getEmails(PROVIDER, 'inbox').every((m) => m.isRead)).toBe(true);
  });

  it('appends history without duplicates and keeps folder counts right', () => {
    storage.saveSyncedMessages(PROVIDER, [snapshot([1, 2, 3], [email('inbox', '7', 3)], { pendingUids: [2, 1] })]);
    expect(storage.appendMessages(PROVIDER, [email('inbox', '7', 2), email('inbox', '7', 1), email('inbox', '7', 3)])).toBe(2);
    expect(storage.getFolders(PROVIDER).find((f) => f.id === 'inbox')).toMatchObject({ totalCount: 3, unreadCount: 3 });
    expect(storage.getEmails(PROVIDER, 'inbox').map((m) => m.uid)).toEqual([3, 2, 1]);
  });

  it('keeps folders newest first even after a hand-made order, but honours that order in Tree views', () => {
    storage.saveSyncedMessages(PROVIDER, [snapshot([1, 2], [email('inbox', '7', 1), email('inbox', '7', 2)])]);
    storage.reorderEmails(PROVIDER, ['inbox_7_1', 'inbox_7_2']);
    // New mail arrives after the reorder; it must still be on top of the inbox
    storage.saveSyncedMessages(PROVIDER, [snapshot([1, 2, 3], [email('inbox', '7', 3)])]);
    expect(storage.getEmails(PROVIDER, 'inbox').map((m) => m.uid)).toEqual([3, 2, 1]);

    storage.reassignEmailTree(PROVIDER, 'inbox_7_1', 'assoc_x', 'agenda_x');
    storage.reassignEmailTree(PROVIDER, 'inbox_7_2', 'assoc_x', 'agenda_x');
    expect(storage.getEmails(PROVIDER, 'assoc_x').map((m) => m.uid)).toEqual([1, 2]);
  });

  it('filters by sender and marks a whole group read', () => {
    storage.saveSyncedMessages(PROVIDER, [
      snapshot([1, 2], [email('inbox', '7', 1), email('inbox', '7', 2, { from: { name: 'Bob', address: 'bob@other.io' } })]),
    ]);
    expect(storage.getEmails(PROVIDER, 'sender:ana@acme.com').map((m) => m.uid)).toEqual([1]);
    expect(storage.markFilterRead(PROVIDER, 'domain:acme.com')).toBe(1);
    expect(storage.getSenderGroups(PROVIDER, 'sender').find((g) => g.address === 'ana@acme.com')?.unread).toBe(0);
  });

  it('shows auto-filed letters under their branches, with counts, and un-files them when a branch is deleted', () => {
    storage.saveSyncedMessages(PROVIDER, [snapshot([1], [email('inbox', '7', 1)])]);
    const assoc = storage.addAssociation(PROVIDER, 'Clients', '🌿', false);
    const agenda = storage.addAgenda(PROVIDER, assoc.id, 'Acme', 'custom');
    storage.saveTreeSorter(PROVIDER, {
      ...storage.getTreeSorter(PROVIDER),
      matches: { inbox_7_1: [{ associationId: assoc.id, agendaId: agenda!.id, keyword: 'acme' }] },
    });
    expect(storage.getEmails(PROVIDER, agenda!.id)[0].treeMatches).toHaveLength(1);
    expect(storage.getAssociations(PROVIDER)[0]).toMatchObject({ totalCount: 1, unreadCount: 1, agendas: [{ totalCount: 1 }] });

    storage.deleteTreeNode(PROVIDER, agenda!.id);
    expect(storage.getTreeSorter(PROVIDER).matches).toEqual({});
    expect(storage.getAssociations(PROVIDER)[0].agendas).toEqual([]);
  });

  it('moves inline bodies from older versions into body files on first read', () => {
    const file = path.join(home.dir, '.enclavemail', 'providers', PROVIDER, 'messages.json');
    fs.writeFileSync(file, JSON.stringify([email('inbox', '7', 9, { bodyHtml: '<p>hi</p>' })]));
    expect(storage.getEmails(PROVIDER, 'inbox')[0].bodyHtml).toBeUndefined();
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))[0].bodyText).toBeUndefined();
    expect(storage.getEmailDetail(PROVIDER, 'inbox_7_9')).toMatchObject({ bodyText: 'body 9', bodyHtml: '<p>hi</p>' });
  });

  it('drops Tree Sorter matches for letters deleted on the server', () => {
    storage.saveSyncedMessages(PROVIDER, [snapshot([1, 2], [email('inbox', '7', 1), email('inbox', '7', 2)])]);
    const t = { associationId: 'a', keyword: 'k' };
    storage.saveTreeSorter(PROVIDER, { ...storage.getTreeSorter(PROVIDER), matches: { inbox_7_1: [t], inbox_7_2: [t] } });
    storage.saveSyncedMessages(PROVIDER, [snapshot([1], [])]);
    expect(Object.keys(storage.getTreeSorter(PROVIDER).matches)).toEqual(['inbox_7_1']);
  });

  it('ignores history that arrives after the account was removed', () => {
    storage.removeProvider(PROVIDER);
    expect(storage.appendMessages(PROVIDER, [email('inbox', '7', 1)])).toBe(0);
    expect(fs.existsSync(path.join(home.dir, '.enclavemail', 'providers', PROVIDER))).toBe(false);
  });

  it('merges an imported tree by name: unions keywords, adds new nodes, never duplicates', () => {
    const existing = storage.addAssociation(PROVIDER, 'Finance', '💰', false, ['invoice']);
    storage.addAgenda(PROVIDER, existing.id, 'Tax', 'financial', ['gst']);
    const summary = storage.importTree(PROVIDER, [
      { name: 'finance', keywords: ['receipt', 'invoice'], children: [{ name: 'TAX', category: 'financial', keywords: ['tds'] }, { name: 'Payroll', category: 'financial', keywords: ['salary'] }] },
      { name: 'Clients', icon: '🤝', keywords: [], children: [{ name: 'Acme', category: 'project', keywords: ['acme'] }] },
    ]);
    expect(summary).toEqual({ createdBranches: 1, createdSubBranches: 2, updatedNodes: 2, clearedNodes: [] });
    const [finance, clients] = storage.getAssociations(PROVIDER);
    expect(finance).toMatchObject({ name: 'Finance', icon: '💰', keywords: ['invoice', 'receipt'] });
    expect(finance.agendas.map((a) => [a.name, a.keywords])).toEqual([
      ['Tax', ['gst', 'tds']],
      ['Payroll', ['salary']],
    ]);
    expect(clients).toMatchObject({ name: 'Clients', icon: '🤝', agendas: [{ name: 'Acme', keywords: ['acme'] }] });
  });

  it('replace import: named nodes get exactly the file keywords, unmentioned nodes stop auto-filing but survive', () => {
    const acme = storage.addAssociation(PROVIDER, 'Acme', '🛡️', false, ['acme corp']);
    const hiring = storage.addAgenda(PROVIDER, acme.id, 'Hiring', 'custom', ['hiring', 'application']);
    storage.addAgenda(PROVIDER, acme.id, 'Tenders', 'custom', ['tender', 'bid']);
    storage.addAgenda(PROVIDER, acme.id, 'General', 'custom', []);
    storage.saveSyncedMessages(PROVIDER, [snapshot([1], [email('inbox', '7', 1)])]);
    storage.reassignEmailTree(PROVIDER, 'inbox_7_1', acme.id, hiring!.id);

    const summary = storage.importTree(PROVIDER, [{ name: 'Acme', keywords: [], children: [{ name: 'Tenders', category: 'project', keywords: ['tender', '-bid meeting'] }] }], 'replace');

    expect(summary.clearedNodes).toEqual(['Acme › Hiring']);
    const [tree] = storage.getAssociations(PROVIDER);
    expect(tree.keywords).toEqual([]);
    expect(tree.agendas.map((a) => [a.name, a.keywords])).toEqual([
      ['Hiring', []],
      ['Tenders', ['tender', '-bid meeting']],
      ['General', []],
    ]);
    // Hand filing into the cleared branch is untouched
    expect(storage.getEmails(PROVIDER, hiring!.id).map((m) => m.id)).toEqual(['inbox_7_1']);
  });

  it('refuses ids that could escape the account folder', () => {
    expect(() => storage.getEmails('../..', 'inbox')).toThrow('Invalid account id');
    storage.saveSyncedMessages(PROVIDER, [snapshot([1], [email('inbox', '7', 1)])]);
    expect(storage.getEmailDetail(PROVIDER, '../../providers')).toBeNull();
  });
});
