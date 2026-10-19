import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessage, ProviderEnclave } from '../../renderer/types/index';
import type { FolderSnapshot } from './imap-service';

// The service resolves ~/.enclavemail at import time, so point the home dir at a throwaway folder first
const home = vi.hoisted(() => ({ dir: `${process.env.TEMP ?? process.env.TMPDIR ?? '/tmp'}/enclave-storage-test-${process.pid}` }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, default: { ...actual, homedir: () => home.dir } };
});

const { StorageService } = await import('./storage-service');
const { onStorageRecovered } = await import('./atomic-file');
type StorageRecovery = import('./atomic-file').StorageRecovery;

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
  return { folder: { id: 'inbox', path: 'INBOX' }, uidValidity: '7', serverUids, flags: {}, newMessages, pendingUids: [], ...extra };
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

  it('carries a pending flag change over to the renumbered letter', () => {
    storage.saveSyncedMessages(PROVIDER, [snapshot([1], [email('inbox', '7', 1, { messageId: '<a@x>' })])]);
    storage.markEmailRead(PROVIDER, 'inbox_7_1', true);
    storage.saveSyncedMessages(PROVIDER, [snapshot([40], [email('inbox', '8', 40, { messageId: '<a@x>' })], { uidValidity: '8' })]);
    expect(storage.getEmails(PROVIDER, 'inbox')).toMatchObject([{ id: 'inbox_8_40', isRead: true }]);
    expect(storage.getPendingFlags(PROVIDER)).toMatchObject([{ emailId: 'inbox_8_40', flag: 'seen', value: true }]);
  });

  describe('two-way flags', () => {
    const server = (seen: boolean, flagged = false) => ({ seen, flagged });
    const byId = (id: string) => storage.getEmails(PROVIDER, 'inbox').find((m) => m.id === id);
    // What a successful push to the server leaves behind
    const pushAll = () => storage.ackPendingFlags(PROVIDER, storage.getPendingFlags(PROVIDER));

    beforeEach(() => {
      storage.saveSyncedMessages(PROVIDER, [snapshot([1, 2], [email('inbox', '7', 1), email('inbox', '7', 2)])]);
    });

    it('keeps a letter read while that change still waits to reach the server', () => {
      storage.markEmailRead(PROVIDER, 'inbox_7_1', true);
      storage.saveSyncedMessages(PROVIDER, [snapshot([1, 2], [], { flags: { 1: server(false), 2: server(true) } })]);
      expect(byId('inbox_7_1')?.isRead).toBe(true);
      expect(byId('inbox_7_2')?.isRead).toBe(true);
    });

    it('takes "unread" from the server once nothing is pending (marked unread on another device)', () => {
      storage.markEmailRead(PROVIDER, 'inbox_7_1', true);
      pushAll();
      storage.saveSyncedMessages(PROVIDER, [snapshot([1, 2], [], { flags: { 1: server(false), 2: server(false) } })]);
      expect(byId('inbox_7_1')?.isRead).toBe(false);
      expect(storage.getFolders(PROVIDER).find((f) => f.id === 'inbox')?.unreadCount).toBe(2);
    });

    it('keeps the local value for letters outside the window the server reported', () => {
      storage.markEmailRead(PROVIDER, 'inbox_7_1', true);
      pushAll();
      storage.saveSyncedMessages(PROVIDER, [snapshot([1, 2], [], { flags: { 2: server(false) } })]);
      expect(byId('inbox_7_1')?.isRead).toBe(true);
    });

    it('takes stars from the server as \\Flagged, unless a local star change is pending', () => {
      storage.saveSyncedMessages(PROVIDER, [snapshot([1, 2], [], { flags: { 1: server(false, true), 2: server(false) } })]);
      expect(byId('inbox_7_1')?.isStarred).toBe(true);

      expect(storage.toggleStar(PROVIDER, 'inbox_7_1')).toBe(false);
      storage.saveSyncedMessages(PROVIDER, [snapshot([1, 2], [], { flags: { 1: server(false, true), 2: server(false) } })]);
      expect(byId('inbox_7_1')?.isStarred).toBe(false);
    });

    it('queues \\Seen for read changes and \\Flagged for stars, but not for no-op or local-only letters', () => {
      storage.markEmailRead(PROVIDER, 'inbox_7_1', true);
      storage.markEmailRead(PROVIDER, 'inbox_7_1', true);
      storage.toggleStar(PROVIDER, 'inbox_7_2');
      storage.saveSentEmail(provider(), { to: 'bo@x.io', subject: 'Hi', body: 'yo', html: '<p>yo</p>', messageId: '<s@x>' });
      const sentId = storage.getEmails(PROVIDER, 'sent')[0].id;
      storage.toggleStar(PROVIDER, sentId);
      expect(storage.getPendingFlags(PROVIDER).map(({ emailId, flag, value }) => ({ emailId, flag, value }))).toEqual([
        { emailId: 'inbox_7_1', flag: 'seen', value: true },
        { emailId: 'inbox_7_2', flag: 'flagged', value: true },
      ]);
    });

    it('queues a read change for every letter "mark all read" touches', () => {
      expect(storage.markFilterRead(PROVIDER, 'inbox')).toBe(2);
      expect(storage.getPendingFlags(PROVIDER).map((c) => c.emailId).sort()).toEqual(['inbox_7_1', 'inbox_7_2']);
    });

    it('keeps the queue across a restart', () => {
      storage.toggleStar(PROVIDER, 'inbox_7_1');
      expect(new StorageService().getPendingFlags(PROVIDER)).toMatchObject([{ emailId: 'inbox_7_1', flag: 'flagged', value: true }]);
    });

    it('drops pending changes for letters deleted on the server', () => {
      storage.markEmailRead(PROVIDER, 'inbox_7_2', true);
      storage.saveSyncedMessages(PROVIDER, [snapshot([1], [])]);
      expect(storage.getPendingFlags(PROVIDER)).toEqual([]);
    });

    it('ignores a damaged or hand-edited queue entry', () => {
      const file = path.join(home.dir, '.enclavemail', 'providers', PROVIDER, 'pending-flags.json');
      fs.writeFileSync(file, JSON.stringify([{ emailId: 'inbox_7_1', flag: '\\Deleted', value: true, queuedAt: 1 }, 'junk']));
      expect(storage.getPendingFlags(PROVIDER)).toEqual([]);
    });

    it('on the first two-way sync, keeps local reads and stars the server never heard of and queues them', () => {
      storage.markEmailRead(PROVIDER, 'inbox_7_1', true);
      storage.toggleStar(PROVIDER, 'inbox_7_2');
      pushAll();
      // An account from before two-way flags: its local state was never sent
      storage.updateProvider(PROVIDER, { twoWayFolders: undefined });

      storage.saveSyncedMessages(PROVIDER, [snapshot([1, 2], [], { flags: { 1: server(false), 2: server(true, false) } })]);
      expect(byId('inbox_7_1')?.isRead).toBe(true);
      expect(byId('inbox_7_2')).toMatchObject({ isRead: true, isStarred: true });
      expect(storage.getPendingFlags(PROVIDER).map(({ emailId, flag, value }) => ({ emailId, flag, value }))).toEqual([
        { emailId: 'inbox_7_1', flag: 'seen', value: true },
        { emailId: 'inbox_7_2', flag: 'flagged', value: true },
      ]);
      expect(storage.getProvider(PROVIDER)?.twoWayFolders).toEqual(['inbox']);
    });

    it('migrates each folder on its own first sync, not when another folder synced', () => {
      const archived = { ...snapshot([5], [email('archive', '3', 5)]), folder: { id: 'archive' as const, path: 'Archive' }, uidValidity: '3' };
      storage.saveSyncedMessages(PROVIDER, [archived]);
      storage.markEmailRead(PROVIDER, 'archive_3_5', true);
      pushAll();
      // Archive was synced before two-way flags existed; the inbox was synced since
      storage.updateProvider(PROVIDER, { twoWayFolders: ['inbox'] });

      storage.saveSyncedMessages(PROVIDER, [{ ...archived, newMessages: [], flags: { 5: server(false) } }]);
      expect(storage.getEmails(PROVIDER, 'archive')[0].isRead).toBe(true);
      expect(storage.getPendingFlags(PROVIDER)).toMatchObject([{ emailId: 'archive_3_5', flag: 'seen', value: true }]);
      expect(storage.getProvider(PROVIDER)?.twoWayFolders?.sort()).toEqual(['archive', 'inbox']);
    });

    it('keeps a pending change on its own letter when a copy with the same Message-ID lands in another folder', () => {
      storage.saveSyncedMessages(PROVIDER, [snapshot([1, 2, 3], [email('inbox', '7', 3, { messageId: '<self@x>' })])]);
      storage.markEmailRead(PROVIDER, 'inbox_7_3', true);
      const sentCopy = { ...snapshot([8], [email('sent', '4', 8, { messageId: '<self@x>' })]), folder: { id: 'sent' as const, path: 'Sent' }, uidValidity: '4' };
      storage.saveSyncedMessages(PROVIDER, [snapshot([1, 2, 3], [], { flags: { 3: server(false) } }), sentCopy]);

      expect(byId('inbox_7_3')?.isRead).toBe(true);
      expect(storage.getEmails(PROVIDER, 'sent')[0].isRead).toBe(false);
      expect(storage.getPendingFlags(PROVIDER)).toMatchObject([{ emailId: 'inbox_7_3', flag: 'seen', value: true }]);
    });
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

  it('remembers senders whose remote images the user allowed, normalised and once each', () => {
    expect(storage.getTrustedSenders(PROVIDER)).toEqual([]);
    storage.trustSender(PROVIDER, '  News@Acme.com ');
    expect(storage.trustSender(PROVIDER, 'news@acme.com')).toEqual(['news@acme.com']);
    expect(storage.trustSender(PROVIDER, 'ana@acme.com')).toEqual(['news@acme.com', 'ana@acme.com']);
  });

  it('refuses anything that is not a plain address as a trusted sender', () => {
    for (const bad of ['', 'not-an-address', 'a@b c.com', 'x'.repeat(300) + '@acme.com', 42 as unknown as string]) {
      expect(() => storage.trustSender(PROVIDER, bad)).toThrow('Invalid sender address');
    }
    expect(storage.getTrustedSenders(PROVIDER)).toEqual([]);
  });
});

describe('StorageService after a crash', () => {
  const accountDir = () => path.join(home.dir, '.enclavemail', 'providers', PROVIDER);
  const messagesFile = () => path.join(accountDir(), 'messages.json');
  const providersFile = () => path.join(home.dir, '.enclavemail', 'providers.json');
  const leftovers = (dir: string, marker: string) => fs.readdirSync(dir).filter((name) => name.includes(marker));
  let recoveries: StorageRecovery[];
  let stopListening: () => void;

  beforeEach(() => {
    fs.rmSync(home.dir, { recursive: true, force: true });
    recoveries = [];
    stopListening = onStorageRecovered((r) => recoveries.push(r));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const storage = new StorageService();
    storage.addProvider(provider());
    storage.saveSyncedMessages(PROVIDER, [snapshot([1], [email('inbox', '7', 1)])]);
    storage.saveSyncedMessages(PROVIDER, [snapshot([1, 2], [email('inbox', '7', 2)])]);
  });

  afterEach(() => {
    stopListening();
    vi.restoreAllMocks();
  });

  it('leaves no temp files behind after ordinary writes', () => {
    expect(leftovers(accountDir(), '.tmp')).toEqual([]);
    expect(fs.existsSync(`${messagesFile()}.bak`)).toBe(true);
  });

  it('reads the last good copy when messages.json was cut off mid-write', () => {
    fs.writeFileSync(messagesFile(), '[{"id":"inbox_7_2","uid":2,"subj', 'utf-8');
    const reopened = new StorageService();
    expect(reopened.getEmails(PROVIDER, 'inbox').map((m) => m.uid)).toEqual([1]);
    expect(leftovers(accountDir(), 'messages.json.corrupt-')).toHaveLength(1);
    expect(recoveries).toEqual([{ file: messagesFile(), outcome: 'restored' }]);
  });

  it('starts the account empty, keeps the damaged file and stays usable when there is no backup', () => {
    fs.rmSync(`${messagesFile()}.bak`);
    fs.writeFileSync(messagesFile(), '[{"id":', 'utf-8');
    const reopened = new StorageService();
    expect(reopened.getEmails(PROVIDER, 'inbox')).toEqual([]);
    expect(() => reopened.getAssociations(PROVIDER)).not.toThrow();
    expect(leftovers(accountDir(), 'messages.json.corrupt-')).toHaveLength(1);
    expect(recoveries.map((r) => r.outcome)).toEqual(['reset']);
    // The next sync repopulates it
    reopened.saveSyncedMessages(PROVIDER, [snapshot([3], [email('inbox', '7', 3)])]);
    expect(reopened.getEmails(PROVIDER, 'inbox').map((m) => m.uid)).toEqual([3]);
  });

  it('keeps the original when a crash left only a half-written temp file', () => {
    fs.writeFileSync(`${messagesFile()}.tmp`, '[{"id":"inbox_7_9"', 'utf-8');
    expect(new StorageService().getEmails(PROVIDER, 'inbox').map((m) => m.uid)).toEqual([2, 1]);
    expect(recoveries).toEqual([]);
  });

  it('recovers the account list, folders and tree the same way', () => {
    const reopened = new StorageService();
    reopened.addAssociation(PROVIDER, 'Clients');
    reopened.addAssociation(PROVIDER, 'Finance');
    for (const file of [providersFile(), path.join(accountDir(), 'folders.json'), path.join(accountDir(), 'associations.json')]) {
      fs.writeFileSync(file, '{"broken', 'utf-8');
    }
    const fresh = new StorageService();
    expect(fresh.getProviders().map((p) => p.id)).toEqual([PROVIDER]);
    expect(fresh.getFolders(PROVIDER).map((f) => f.id)).toContain('inbox');
    expect(fresh.getAssociations(PROVIDER).map((a) => a.name)).toEqual(['Clients']);
    expect(recoveries.map((r) => path.basename(r.file)).sort()).toEqual(['associations.json', 'folders.json', 'providers.json']);
  });

  it('treats a messages file of the wrong shape as damaged', () => {
    fs.writeFileSync(messagesFile(), '{"not":"a list"}', 'utf-8');
    expect(new StorageService().getEmails(PROVIDER, 'inbox').map((m) => m.uid)).toEqual([1]);
  });
});
