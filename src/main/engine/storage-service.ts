import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  ProviderEnclave,
  Folder,
  EmailMessage,
  AssociationNode,
  AgendaNode,
  SenderGroup,
  SenderGroupMode,
  TreeMatch,
  TreeScanReport,
  TreeSorterSettings,
} from '../../renderer/types/index';
import type { FolderSnapshot, KnownFolder } from './imap-service';
import { MessageStore, assertSafeId } from './message-store';
import { isJsonArray, isJsonObject, readJsonSafe, writeJsonAtomic } from './atomic-file';
import { groupBySender, isSenderFilter, matchesSenderFilter } from './sender-groups';
import { DEFAULT_SORTER_SETTINGS, normalizeKeywords, sanitizeSorterSettings } from './tree-classifier';
import { isReorderableFilter } from '../../renderer/lib/filters';
import { ackFlags, isPendingFlag, parseServerId, pendingValue, queueFlags, type FlagKind, type PendingFlag } from './pending-flags';
import type { ImportedBranch } from './tree-export';

/** 'merge' unions keywords into existing nodes; 'replace' makes the file the source of truth for keywords. */
export type TreeImportMode = 'merge' | 'replace';

export interface TreeImportSummary {
  createdBranches: number;
  createdSubBranches: number;
  updatedNodes: number;
  /** Replace mode: existing nodes the file did not mention, whose keywords were removed ("Parent › Child"). */
  clearedNodes: string[];
}

const BASE_DIR = path.join(os.homedir(), '.enclavemail');
export const PROVIDERS_DIR = path.join(BASE_DIR, 'providers');
const PROVIDERS_FILE = path.join(BASE_DIR, 'providers.json');

const SERVER_FOLDERS = new Set(['inbox', 'sent', 'drafts', 'archive']);
const MAX_NODE_NAME = 80;
const MAX_KEYWORDS_PER_NODE = 50;
// local@domain, no spaces, within RFC 5321 length limits
const PLAIN_ADDRESS = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

const DEFAULT_FOLDERS: Folder[] = [
  { id: 'inbox', name: 'Inbox', path: 'INBOX', unreadCount: 0, totalCount: 0, iconName: 'Inbox' },
  { id: 'starred', name: 'Starred', path: 'Starred', unreadCount: 0, totalCount: 0, iconName: 'Star' },
  { id: 'sent', name: 'Sent', path: 'Sent', unreadCount: 0, totalCount: 0, iconName: 'Send' },
  { id: 'drafts', name: 'Drafts', path: 'Drafts', unreadCount: 0, totalCount: 0, iconName: 'FileText' },
  { id: 'archive', name: 'Archive', path: 'Archive', unreadCount: 0, totalCount: 0, iconName: 'Archive' },
];

/** What the Tree Sorter keeps per account: its settings, the last scan summary, and which branches each email fell into. */
export interface TreeSorterFile {
  settings: TreeSorterSettings;
  lastScan: TreeScanReport | null;
  matches: Record<string, TreeMatch[]>;
}

const EMPTY_SORTER: TreeSorterFile = { settings: DEFAULT_SORTER_SETTINGS, lastScan: null, matches: {} };

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function cleanName(name: string): string {
  const trimmed = typeof name === 'string' ? name.trim().slice(0, MAX_NODE_NAME) : '';
  if (!trimmed) throw new Error('A name is required.');
  return trimmed;
}

function byPositionThenNewest(a: EmailMessage, b: EmailMessage): number {
  return (a.position ?? Infinity) - (b.position ?? Infinity) || (b.timestamp ?? 0) - (a.timestamp ?? 0);
}

export class StorageService {
  private baseDir: string;
  private readonly messages = new MessageStore(PROVIDERS_DIR);
  private readonly sorterCache = new Map<string, TreeSorterFile>();
  private lastFlagStamp = 0;

  constructor() {
    this.baseDir = BASE_DIR;
    this.ensureBaseDirectories();
  }

  private ensureBaseDirectories() {
    for (const dir of [this.baseDir, PROVIDERS_DIR, path.join(this.baseDir, 'mods')]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
  }

  private providerFile(providerId: string, name: string): string {
    return path.join(this.messages.providerDir(providerId), name);
  }

  // ---------- Providers ----------

  public getProviders(): ProviderEnclave[] {
    return readJsonSafe<ProviderEnclave[]>(PROVIDERS_FILE, [], isJsonArray);
  }

  public getProvider(providerId: string): ProviderEnclave | null {
    return this.getProviders().find((p) => p.id === providerId) ?? null;
  }

  public removeProvider(providerId: string): void {
    const providers = this.getProviders();
    // Only ids already on the list are accepted, so a crafted id can never point rm outside the providers dir
    const target = providers.find((p) => p.id === providerId);
    if (!target) throw new Error('Account not found.');
    fs.rmSync(this.messages.providerDir(target.id), { recursive: true, force: true });
    this.messages.forget(target.id);
    this.sorterCache.delete(target.id);
    const remaining = providers.filter((p) => p.id !== target.id);
    writeJsonAtomic(PROVIDERS_FILE, remaining, { space: 2 });
  }

  public updateProvider(providerId: string, changes: Partial<ProviderEnclave>): ProviderEnclave | null {
    const providers = this.getProviders().map((p) => (p.id === providerId ? { ...p, ...changes } : p));
    writeJsonAtomic(PROVIDERS_FILE, providers, { space: 2 });
    return providers.find((p) => p.id === providerId) ?? null;
  }

  public addProvider(newProvider: ProviderEnclave): ProviderEnclave {
    const providers = this.getProviders();
    const storagePath = this.messages.providerDir(newProvider.id);
    fs.mkdirSync(path.join(storagePath, 'attachments'), { recursive: true });
    writeJsonAtomic(path.join(storagePath, 'folders.json'), DEFAULT_FOLDERS, { space: 2 });
    writeJsonAtomic(path.join(storagePath, 'associations.json'), [], { space: 2 });
    this.messages.write(newProvider.id, []);

    const saved = { ...newProvider, storagePath };
    writeJsonAtomic(PROVIDERS_FILE, [...providers, saved], { space: 2 });
    return saved;
  }

  // ---------- Sync ----------

  /** UIDs already cached per folder (ids are `${folderId}_${uidValidity}_${uid}`), so sync can skip re-downloading them. */
  public getKnownFolders(providerId: string): Map<string, KnownFolder> {
    const known = new Map<string, KnownFolder>();
    for (const m of this.messages.read(providerId)) {
      const [folderId, uidValidity, uid] = m.id.split('_');
      if (!uidValidity || !uid || !/^\d+$/.test(uid)) continue;
      const entry = known.get(folderId);
      // If a folder somehow holds two UIDVALIDITY epochs, trust the newest one seen last
      if (!entry || entry.uidValidity !== uidValidity) known.set(folderId, { uidValidity, uids: new Set([Number(uid)]) });
      else entry.uids.add(Number(uid));
    }
    return known;
  }

  // Rebuilds server-backed folders from the server's complete UID list, reusing cached messages and keeping local-only state
  public saveSyncedMessages(providerId: string, snapshots: FolderSnapshot[]): void {
    const existing = this.messages.read(providerId);
    const previous = new Map(existing.map((m) => [m.id, m]));
    // Local filing follows a letter the server renumbered or moved (same Message-ID, new UID)
    const previousByMessageId = new Map(existing.filter((m) => m.messageId).map((m) => [m.messageId as string, m]));
    const syncedFolders = new Set<string>(snapshots.map((s) => s.folder.id));
    const queue = this.getPendingFlags(providerId);
    // Folders from before two-way flags never sent their local reads and stars: their first sync keeps them and sends them
    const migrated = new Set(this.getProvider(providerId)?.twoWayFolders ?? []);
    const serverIds = new Set(snapshots.flatMap((s) => s.serverUids.map((uid) => `${s.folder.id}_${s.uidValidity}_${uid}`)));
    const renumbered = new Map<string, string>();
    const unsent: Omit<PendingFlag, 'queuedAt'>[] = [];

    const fresh = snapshots.flatMap((s) => {
      const downloaded = new Map(s.newMessages.map((m) => [m.id, m]));
      return s.serverUids.flatMap((uid): EmailMessage[] => {
        const id = `${s.folder.id}_${s.uidValidity}_${uid}`;
        const fetched = downloaded.get(id);
        const old = previous.get(id);
        const base = fetched ?? old;
        // Not downloaded yet: the history backfill will bring it in
        if (!base) return [];
        const carried = old ?? (fetched?.messageId ? previousByMessageId.get(fetched.messageId) : undefined);
        // Pending changes follow only the same letter under a new UID: same folder, old UID gone. A copy in
        // another folder (a letter sent to yourself sits in Inbox and Sent) keeps its own.
        const movedFrom = carried && carried.id !== id && carried.folderId === s.folder.id && !serverIds.has(carried.id) ? carried : undefined;
        if (movedFrom) renumbered.set(movedFrom.id, id);
        // Read/star likewise come only from the same letter; a fresh download carries the server's flags
        const local = old ?? movedFrom ?? base;
        const server = s.flags[uid];

        // The server's value wins, unless a local change is still on its way there. Letters outside the
        // window the server reported keep their local value.
        const resolve = (flag: FlagKind, serverValue: boolean | undefined, localValue: boolean): boolean => {
          const pending = pendingValue(queue, id, flag) ?? (movedFrom ? pendingValue(queue, movedFrom.id, flag) : undefined);
          if (pending !== undefined) return pending;
          if (serverValue === undefined) return localValue;
          if (!migrated.has(s.folder.id) && localValue && !serverValue) {
            unsent.push({ emailId: id, flag, value: true });
            return true;
          }
          return serverValue;
        };
        const isRead = resolve('seen', server?.seen, local.isRead);
        const isStarred = resolve('flagged', server?.flagged, local.isStarred);
        if (!carried) return [{ ...base, isRead, isStarred }];
        return [
          {
            ...base,
            associationId: carried.associationId,
            agendaId: carried.agendaId,
            position: old?.position,
            tags: carried.tags,
            isRead,
            isStarred,
          },
        ];
      });
    });
    const freshIds = new Set(fresh.map((m) => m.id));
    const serverMessageIds = new Set(fresh.map((m) => m.messageId).filter(Boolean));
    const kept = existing.filter((m) => {
      if (freshIds.has(m.id)) return false;
      if (!syncedFolders.has(m.folderId)) return true;
      // Just-sent copies stay until the server's copy (same Message-ID) shows up
      if (m.id.startsWith('local_sent_')) return !m.messageId || !serverMessageIds.has(m.messageId);
      // The server list is complete, so anything else missing from it was deleted or moved on the server
      return false;
    });
    const keptIds = new Set(kept.map((m) => m.id));
    const removedIds = existing.filter((m) => !freshIds.has(m.id) && !keptIds.has(m.id)).map((m) => m.id);
    this.messages.removeBodies(providerId, removedIds);
    this.pruneTreeMatches(providerId, removedIds);

    const all = this.messages.write(providerId, [...fresh, ...kept]);
    this.reconcilePendingFlags(providerId, queue, renumbered, new Set(removedIds), unsent);
    this.writeFolderCounts(providerId, all, snapshots);
    this.updateProvider(providerId, { lastSyncedAt: Date.now(), status: 'connected', twoWayFolders: [...new Set([...migrated, ...syncedFolders])] });
  }

  // Pending changes follow a renumbered letter to its new id, and go away with a letter deleted on the server
  private reconcilePendingFlags(
    providerId: string,
    queue: PendingFlag[],
    renumbered: ReadonlyMap<string, string>,
    removed: ReadonlySet<string>,
    unsent: Omit<PendingFlag, 'queuedAt'>[]
  ): void {
    if (queue.length === 0 && unsent.length === 0) return;
    const kept = queue
      .map((c) => (renumbered.has(c.emailId) ? { ...c, emailId: renumbered.get(c.emailId) as string } : c))
      .filter((c) => !removed.has(c.emailId));
    const unchanged = kept.length === queue.length && kept.every((c, i) => c === queue[i]);
    if (unchanged && unsent.length === 0) return;
    this.writePendingFlags(providerId, kept);
    if (unsent.length > 0) this.queueFlags(providerId, unsent);
  }

  /** Adds older letters fetched by the history backfill. Returns how many were new. */
  public appendMessages(providerId: string, incoming: EmailMessage[]): number {
    // A removed account must stay removed; writing bodies would recreate its folder
    if (!this.getProvider(providerId)) return 0;
    const existing = this.messages.read(providerId);
    const ids = new Set(existing.map((m) => m.id));
    const added = incoming.filter((m) => !ids.has(m.id));
    if (added.length === 0) return 0;
    const all = this.messages.write(providerId, [...existing, ...added]);
    this.writeFolderCounts(providerId, all);
    return added.length;
  }

  private writeFolderCounts(providerId: string, all: EmailMessage[], snapshots: FolderSnapshot[] = []): void {
    const current = this.getFolders(providerId);
    const folders: Folder[] = DEFAULT_FOLDERS.map((f) => {
      const serverPath = snapshots.find((s) => s.folder.id === f.id)?.folder.path ?? current.find((c) => c.id === f.id)?.path ?? f.path;
      const inFolder = all.filter((m) => (f.id === 'starred' ? m.isStarred : m.folderId === f.id));
      return { ...f, path: serverPath, totalCount: inFolder.length, unreadCount: inFolder.filter((m) => !m.isRead).length };
    });
    writeJsonAtomic(this.providerFile(providerId, 'folders.json'), folders, { space: 2 });
    this.updateProvider(providerId, { unreadTotal: folders.find((f) => f.id === 'inbox')?.unreadCount ?? 0 });
  }

  private refreshFolderCounts(providerId: string): void {
    this.writeFolderCounts(providerId, this.messages.read(providerId));
  }

  public getFolders(providerId: string): Folder[] {
    return readJsonSafe<Folder[]>(this.providerFile(providerId, 'folders.json'), [], isJsonArray);
  }

  // ---------- Reading mail ----------

  /** Every message (headers only) for the account; the Tree Sorter scans this. */
  public getAllMessages(providerId: string): EmailMessage[] {
    return this.messages.read(providerId);
  }

  public getEmails(providerId: string, filterId: string): EmailMessage[] {
    const all = this.messages.read(providerId);
    const { matches } = this.getTreeSorter(providerId);

    let filtered: EmailMessage[];
    if (filterId === 'starred') {
      filtered = all.filter((m) => m.isStarred);
    } else if (SERVER_FOLDERS.has(filterId)) {
      filtered = all.filter((m) => m.folderId === filterId);
    } else if (isSenderFilter(filterId)) {
      filtered = all.filter((m) => matchesSenderFilter(m, filterId));
    } else {
      // An association or agenda node: filed by hand, or auto-filed by the Tree Sorter
      filtered = all.filter(
        (m) =>
          m.associationId === filterId ||
          m.agendaId === filterId ||
          (matches[m.id] ?? []).some((t) => t.associationId === filterId || t.agendaId === filterId)
      );
    }

    const sorted = isReorderableFilter(filterId)
      ? [...filtered].sort(byPositionThenNewest)
      : [...filtered].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
    return sorted.map((m) => (matches[m.id] ? { ...m, treeMatches: matches[m.id] } : m));
  }

  public getSenderGroups(providerId: string, mode: SenderGroupMode): SenderGroup[] {
    return groupBySender(this.messages.read(providerId), mode === 'domain' ? 'domain' : 'sender');
  }

  public getEmailDetail(providerId: string, emailId: string): EmailMessage | null {
    const header = this.messages.read(providerId).find((m) => m.id === emailId);
    if (!header) return null;
    const treeMatches = this.getTreeSorter(providerId).matches[header.id];
    // A deep copy: the header is shared with the cached list, and a caller pushing into its tags once
    // made a change show in the UI that only some later, unrelated write put on disk
    return structuredClone({ ...header, ...this.messages.readBody(providerId, header.id), ...(treeMatches ? { treeMatches } : {}) });
  }

  // ---------- Local message state ----------

  private updateMessages(providerId: string, update: (m: EmailMessage) => EmailMessage | null): EmailMessage[] {
    let changed = false;
    const all = this.messages.read(providerId).map((m) => {
      const next = update(m);
      if (!next || next === m) return m;
      changed = true;
      return next;
    });
    return changed ? this.messages.write(providerId, all) : all;
  }

  /** Adds tags to many letters in a single write; returns how many letters changed. */
  public applyModTags(providerId: string, tagsById: ReadonlyMap<string, readonly string[]>): number {
    let changed = 0;
    this.updateMessages(providerId, (m) => {
      const extra = (tagsById.get(m.id) ?? []).filter((tag) => !m.tags.includes(tag));
      if (extra.length === 0) return null;
      changed += 1;
      return { ...m, tags: [...m.tags, ...extra] };
    });
    return changed;
  }

  /** Read/star changes are applied locally at once and queued here until the server confirms them. */
  public markEmailRead(providerId: string, emailId: string, isRead: boolean) {
    const target = this.messages.read(providerId).find((m) => m.id === emailId);
    if (!target || target.isRead === isRead) return;
    // Queued first: if the letter write then fails, the next sync still applies (and sends) the change
    this.queueFlags(providerId, [{ emailId, flag: 'seen', value: isRead }]);
    this.updateMessages(providerId, (m) => (m.id === emailId ? { ...m, isRead } : null));
    this.refreshFolderCounts(providerId);
  }

  /** Marks every unread letter behind a filter (folder, sender, domain or tree node) as read. */
  public markFilterRead(providerId: string, filterId: string): number {
    const targets = new Set(this.getEmails(providerId, filterId).filter((m) => !m.isRead).map((m) => m.id));
    if (targets.size === 0) return 0;
    this.queueFlags(providerId, [...targets].map((emailId) => ({ emailId, flag: 'seen' as const, value: true })));
    this.updateMessages(providerId, (m) => (targets.has(m.id) ? { ...m, isRead: true } : null));
    this.refreshFolderCounts(providerId);
    return targets.size;
  }

  public toggleStar(providerId: string, emailId: string): boolean {
    const target = this.messages.read(providerId).find((m) => m.id === emailId);
    if (!target) return false;
    const isStarred = !target.isStarred;
    this.queueFlags(providerId, [{ emailId, flag: 'flagged', value: isStarred }]);
    this.updateMessages(providerId, (m) => (m.id === emailId ? { ...m, isStarred } : null));
    this.refreshFolderCounts(providerId);
    return isStarred;
  }

  // ---------- Read/star changes waiting for the server ----------

  public getPendingFlags(providerId: string): PendingFlag[] {
    return readJsonSafe<unknown[]>(this.providerFile(providerId, 'pending-flags.json'), [], isJsonArray).filter(isPendingFlag);
  }

  /** Drops the changes the server confirmed. */
  public ackPendingFlags(providerId: string, done: readonly PendingFlag[]): void {
    // A removed account must stay removed; writing the queue would recreate its folder
    if (done.length === 0 || !this.getProvider(providerId)) return;
    const queue = this.getPendingFlags(providerId);
    const next = ackFlags(queue, done);
    if (next.length !== queue.length) this.writePendingFlags(providerId, next);
  }

  // Only letters with a server UID are queued; a just-sent local copy has nothing to flag yet
  private queueFlags(providerId: string, changes: Omit<PendingFlag, 'queuedAt'>[]): void {
    const forServer = changes.filter((c) => parseServerId(c.emailId) !== null);
    if (forServer.length === 0) return;
    const stamped = forServer.map((change) => ({ ...change, queuedAt: this.nextFlagStamp() }));
    this.writePendingFlags(providerId, queueFlags(this.getPendingFlags(providerId), stamped));
  }

  // Strictly increasing, so a change made while an older one is being sent is never mistaken for it
  private nextFlagStamp(): number {
    this.lastFlagStamp = Math.max(Date.now(), this.lastFlagStamp + 1);
    return this.lastFlagStamp;
  }

  private writePendingFlags(providerId: string, queue: PendingFlag[]): void {
    writeJsonAtomic(this.providerFile(providerId, 'pending-flags.json'), queue, { space: 2 });
  }

  /** Saves a hand-made order. Only Tree views use it; folders always sort newest first. */
  public reorderEmails(providerId: string, emailIds: string[]): EmailMessage[] {
    const rank = new Map(emailIds.map((id, index) => [id, index + 1]));
    return this.updateMessages(providerId, (m) => (rank.has(m.id) ? { ...m, position: rank.get(m.id) } : null));
  }

  public reassignEmailTree(providerId: string, emailId: string, associationId: string, agendaId: string) {
    this.updateMessages(providerId, (m) => (m.id === emailId ? { ...m, associationId, agendaId } : null));
  }

  public saveSentEmail(
    provider: ProviderEnclave,
    email: { to: string; subject: string; body: string; html: string; messageId: string }
  ) {
    const now = new Date();
    const sentMessage: EmailMessage = {
      id: `local_sent_${now.getTime()}`,
      providerId: provider.id,
      folderId: 'sent',
      from: { name: provider.name, address: provider.email },
      to: [{ name: email.to, address: email.to }],
      subject: email.subject,
      date: now.toLocaleString(),
      timestamp: now.getTime(),
      messageId: email.messageId,
      snippet: email.body.slice(0, 80),
      bodyText: email.body,
      bodyHtml: email.html,
      isRead: true,
      isStarred: false,
      tags: ['Outbound'],
      attachments: [],
    };
    this.messages.write(provider.id, [sentMessage, ...this.messages.read(provider.id)]);
    return sentMessage;
  }

  // ---------- Remote content ----------

  /** Senders whose remote images load without asking (the user chose "always" for them). */
  public getTrustedSenders(providerId: string): string[] {
    const raw = readJsonSafe<unknown[]>(this.providerFile(providerId, 'trusted-senders.json'), [], isJsonArray);
    return raw.filter((a): a is string => typeof a === 'string' && PLAIN_ADDRESS.test(a));
  }

  public trustSender(providerId: string, address: string): string[] {
    const clean = typeof address === 'string' ? address.trim().toLowerCase() : '';
    if (!PLAIN_ADDRESS.test(clean)) throw new Error('Invalid sender address.');
    const current = this.getTrustedSenders(providerId);
    if (current.includes(clean)) return current;
    const next = [...current, clean];
    writeJsonAtomic(this.providerFile(providerId, 'trusted-senders.json'), next, { space: 2 });
    return next;
  }

  // ---------- Association & agenda tree ----------

  private readAssociations(providerId: string): AssociationNode[] {
    const assocs = readJsonSafe<AssociationNode[]>(this.providerFile(providerId, 'associations.json'), [], isJsonArray);
    return [...assocs].sort((a, b) => a.position - b.position);
  }

  private writeAssociations(providerId: string, assocs: AssociationNode[]): void {
    // Counts are derived on every read, so they are never persisted
    const stored = assocs.map(({ unreadCount: _u, totalCount: _t, ...a }) => ({
      ...a,
      agendas: a.agendas.map((ag) => ({ ...ag, unreadCount: 0, totalCount: 0 })),
    }));
    writeJsonAtomic(this.providerFile(providerId, 'associations.json'), stored, { space: 2 });
  }

  /** The tree with live counts: letters filed by hand plus letters the Tree Sorter put there. */
  public getAssociations(providerId: string): AssociationNode[] {
    const assocs = this.readAssociations(providerId);
    const { matches } = this.getTreeSorter(providerId);
    const total = new Map<string, number>();
    const unread = new Map<string, number>();
    const bump = (nodeId: string, isRead: boolean) => {
      total.set(nodeId, (total.get(nodeId) ?? 0) + 1);
      if (!isRead) unread.set(nodeId, (unread.get(nodeId) ?? 0) + 1);
    };
    for (const m of this.messages.read(providerId)) {
      const nodes = new Set<string>();
      if (m.associationId) nodes.add(m.associationId);
      if (m.agendaId) nodes.add(m.agendaId);
      for (const t of matches[m.id] ?? []) {
        nodes.add(t.associationId);
        if (t.agendaId) nodes.add(t.agendaId);
      }
      nodes.forEach((id) => bump(id, m.isRead));
    }
    return assocs.map((a) => ({
      ...a,
      totalCount: total.get(a.id) ?? 0,
      unreadCount: unread.get(a.id) ?? 0,
      agendas: a.agendas.map((ag) => ({ ...ag, totalCount: total.get(ag.id) ?? 0, unreadCount: unread.get(ag.id) ?? 0 })),
    }));
  }

  public reorderAssociations(providerId: string, associationIds: string[]): AssociationNode[] {
    const rank = new Map(associationIds.map((id, index) => [id, index + 1]));
    const reordered = this.readAssociations(providerId)
      .map((a) => (rank.has(a.id) ? { ...a, position: rank.get(a.id) as number } : a))
      .sort((a, b) => a.position - b.position);
    this.writeAssociations(providerId, reordered);
    return this.getAssociations(providerId);
  }

  public addAssociation(providerId: string, name: string, icon = '📁', withDefaultAgendas = true, keywords: string[] = []): AssociationNode {
    const assocs = this.readAssociations(providerId);
    const agenda = (label: string, category: AgendaNode['category'], position: number): AgendaNode => ({
      id: newId('agenda'),
      name: label,
      category,
      position,
      unreadCount: 0,
      totalCount: 0,
    });
    const newAssoc: AssociationNode = {
      id: newId('assoc'),
      providerId,
      name: cleanName(name),
      icon,
      position: assocs.length + 1,
      keywords: normalizeKeywords(keywords).slice(0, MAX_KEYWORDS_PER_NODE),
      agendas: withDefaultAgendas
        ? [agenda('General', 'custom', 1), agenda('Project', 'project', 2), agenda('Financial', 'financial', 3), agenda('Project Financial', 'financial', 4)]
        : [],
    };
    this.writeAssociations(providerId, [...assocs, newAssoc]);
    return newAssoc;
  }

  public addAgenda(
    providerId: string,
    associationId: string,
    name: string,
    category: 'project' | 'financial' | 'operations' | 'legal' | 'custom' = 'custom',
    keywords: string[] = []
  ): AgendaNode | null {
    const assocs = this.readAssociations(providerId);
    const assoc = assocs.find((a) => a.id === associationId);
    if (!assoc) return null;

    const newAgenda: AgendaNode = {
      id: newId('agenda'),
      name: cleanName(name),
      category,
      position: assoc.agendas.length + 1,
      unreadCount: 0,
      totalCount: 0,
      keywords: normalizeKeywords(keywords).slice(0, MAX_KEYWORDS_PER_NODE),
    };
    this.writeAssociations(
      providerId,
      assocs.map((a) => (a.id === associationId ? { ...a, agendas: [...a.agendas, newAgenda] } : a))
    );
    return newAgenda;
  }

  /** Sets the Tree Sorter keywords on an association or agenda. */
  public setNodeKeywords(providerId: string, nodeId: string, keywords: string[]): AssociationNode[] {
    const clean = normalizeKeywords(keywords).slice(0, MAX_KEYWORDS_PER_NODE);
    const assocs = this.readAssociations(providerId).map((a) =>
      a.id === nodeId
        ? { ...a, keywords: clean }
        : { ...a, agendas: a.agendas.map((ag) => (ag.id === nodeId ? { ...ag, keywords: clean } : ag)) }
    );
    this.writeAssociations(providerId, assocs);
    return this.getAssociations(providerId);
  }

  /**
   * Brings an imported tree (e.g. designed by an AI from an export) into the existing one. Branches and
   * sub-branches are matched by name (case-insensitive); no node is ever deleted, so hand filing survives.
   * - 'merge': keywords are unioned.
   * - 'replace': named nodes get exactly the file's keywords, and nodes the file does not mention lose
   *   theirs (they stay, but stop auto-filing), so stale over-matching keywords cannot linger.
   */
  public importTree(providerId: string, branches: ImportedBranch[], mode: TreeImportMode = 'merge'): TreeImportSummary {
    const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    const clean = (keywords: string[]) => normalizeKeywords(keywords).slice(0, MAX_KEYWORDS_PER_NODE);
    const merge = (current: string[] | undefined, extra: string[]) => clean(mode === 'replace' ? extra : [...(current ?? []), ...extra]);
    const summary: TreeImportSummary = { createdBranches: 0, createdSubBranches: 0, updatedNodes: 0, clearedNodes: [] };
    // Every node the file names or creates; in replace mode everything else is cleared afterwards
    const touched = new Set<string>();

    const merged = branches.reduce<AssociationNode[]>((assocs, incoming) => {
      const existing = assocs.find((a) => sameName(a.name, incoming.name));
      const base: AssociationNode = existing ?? {
        id: newId('assoc'),
        providerId,
        name: cleanName(incoming.name),
        icon: incoming.icon || '🌿',
        position: assocs.length + 1,
        keywords: [],
        agendas: [],
      };
      if (existing) summary.updatedNodes += 1;
      else summary.createdBranches += 1;

      const agendas = incoming.children.reduce<AgendaNode[]>((list, child) => {
        const match = list.find((ag) => sameName(ag.name, child.name));
        if (match) {
          summary.updatedNodes += 1;
          touched.add(match.id);
          return list.map((ag) => (ag === match ? { ...ag, keywords: merge(ag.keywords, child.keywords) } : ag));
        }
        summary.createdSubBranches += 1;
        const created: AgendaNode = {
          id: newId('agenda'),
          name: cleanName(child.name),
          category: child.category,
          position: list.length + 1,
          unreadCount: 0,
          totalCount: 0,
          keywords: merge([], child.keywords),
        };
        touched.add(created.id);
        return [...list, created];
      }, base.agendas);

      const next: AssociationNode = { ...base, icon: existing?.icon || base.icon, keywords: merge(base.keywords, incoming.keywords), agendas };
      touched.add(next.id);
      return existing ? assocs.map((a) => (a.id === existing.id ? next : a)) : [...assocs, next];
    }, this.readAssociations(providerId));

    const result = mode === 'replace' ? this.clearUntouched(merged, touched, summary) : merged;
    this.writeAssociations(providerId, result);
    return summary;
  }

  private clearUntouched(assocs: AssociationNode[], touched: Set<string>, summary: TreeImportSummary): AssociationNode[] {
    const cleared = (label: string, keywords: string[] | undefined): string[] => {
      if (keywords?.length) summary.clearedNodes.push(label);
      return [];
    };
    return assocs.map((a) => ({
      ...a,
      keywords: touched.has(a.id) ? a.keywords : cleared(a.name, a.keywords),
      agendas: a.agendas.map((ag) => (touched.has(ag.id) ? ag : { ...ag, keywords: cleared(`${a.name} › ${ag.name}`, ag.keywords) })),
    }));
  }

  public renameNode(providerId: string, nodeId: string, name: string): AssociationNode[] {
    const clean = cleanName(name);
    const assocs = this.readAssociations(providerId).map((a) =>
      a.id === nodeId ? { ...a, name: clean } : { ...a, agendas: a.agendas.map((ag) => (ag.id === nodeId ? { ...ag, name: clean } : ag)) }
    );
    this.writeAssociations(providerId, assocs);
    return this.getAssociations(providerId);
  }

  /** Removes an association (with its agendas) or one agenda, and un-files every letter that pointed at it. */
  public deleteTreeNode(providerId: string, nodeId: string): AssociationNode[] {
    const assocs = this.readAssociations(providerId);
    const removedAssoc = assocs.find((a) => a.id === nodeId);
    const removed = new Set(removedAssoc ? [nodeId, ...removedAssoc.agendas.map((ag) => ag.id)] : [nodeId]);
    const next = assocs
      .filter((a) => a.id !== nodeId)
      .map((a, index) => ({ ...a, position: index + 1, agendas: a.agendas.filter((ag) => ag.id !== nodeId) }));
    this.writeAssociations(providerId, next);

    this.updateMessages(providerId, (m) => {
      const dropAssoc = !!m.associationId && removed.has(m.associationId);
      const dropAgenda = dropAssoc || (!!m.agendaId && removed.has(m.agendaId));
      if (!dropAssoc && !dropAgenda) return null;
      return { ...m, associationId: dropAssoc ? undefined : m.associationId, agendaId: undefined };
    });

    const sorter = this.getTreeSorter(providerId);
    const matches = Object.fromEntries(
      Object.entries(sorter.matches)
        .map(([id, found]) => [id, found.filter((t) => !removed.has(t.associationId) && !(t.agendaId && removed.has(t.agendaId)))] as const)
        .filter(([, found]) => found.length > 0)
    );
    this.saveTreeSorter(providerId, { ...sorter, matches, lastScan: null });
    return this.getAssociations(providerId);
  }

  // ---------- Tree Sorter state ----------

  /** Letters gone from the server leave the Tree Sorter index too, so it never grows stale entries. */
  private pruneTreeMatches(providerId: string, removedIds: string[]): void {
    const sorter = this.getTreeSorter(providerId);
    const stale = removedIds.filter((id) => sorter.matches[id]);
    if (stale.length === 0) return;
    const gone = new Set(stale);
    const matches = Object.fromEntries(Object.entries(sorter.matches).filter(([id]) => !gone.has(id)));
    this.saveTreeSorter(providerId, { ...sorter, matches });
  }

  public getTreeSorter(providerId: string): TreeSorterFile {
    const cached = this.sorterCache.get(providerId);
    if (cached) return cached;
    const raw = readJsonSafe<Partial<TreeSorterFile> | null>(this.providerFile(providerId, 'tree-sorter.json'), null, isJsonObject);
    const loaded: TreeSorterFile = raw
      ? { settings: sanitizeSorterSettings(raw.settings), lastScan: raw.lastScan ?? null, matches: raw.matches ?? {} }
      : EMPTY_SORTER;
    this.sorterCache.set(providerId, loaded);
    return loaded;
  }

  public saveTreeSorter(providerId: string, state: TreeSorterFile): TreeSorterFile {
    assertSafeId(providerId, 'account id');
    writeJsonAtomic(this.providerFile(providerId, 'tree-sorter.json'), state);
    this.sorterCache.set(providerId, state);
    return state;
  }
}
