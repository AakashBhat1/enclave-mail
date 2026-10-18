import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProviderEnclave, Folder, EmailMessage, AssociationNode, AgendaNode } from '../../renderer/types/index';
import type { FolderSnapshot, KnownFolder } from './imap-service';

const BASE_DIR = path.join(os.homedir(), '.enclavemail');
export const PROVIDERS_DIR = path.join(BASE_DIR, 'providers');
const PROVIDERS_FILE = path.join(BASE_DIR, 'providers.json');

const DEFAULT_FOLDERS: Folder[] = [
  { id: 'inbox', name: 'Inbox', path: 'INBOX', unreadCount: 0, totalCount: 0, iconName: 'Inbox' },
  { id: 'starred', name: 'Starred', path: 'Starred', unreadCount: 0, totalCount: 0, iconName: 'Star' },
  { id: 'sent', name: 'Sent', path: 'Sent', unreadCount: 0, totalCount: 0, iconName: 'Send' },
  { id: 'drafts', name: 'Drafts', path: 'Drafts', unreadCount: 0, totalCount: 0, iconName: 'FileText' },
  { id: 'archive', name: 'Archive', path: 'Archive', unreadCount: 0, totalCount: 0, iconName: 'Archive' },
];

export class StorageService {
  private baseDir: string;

  constructor() {
    this.baseDir = BASE_DIR;
    this.ensureBaseDirectories();
  }

  private ensureBaseDirectories() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    const providersDir = path.join(this.baseDir, 'providers');
    if (!fs.existsSync(providersDir)) {
      fs.mkdirSync(providersDir, { recursive: true });
    }
    const modsDir = path.join(this.baseDir, 'mods');
    if (!fs.existsSync(modsDir)) {
      fs.mkdirSync(modsDir, { recursive: true });
    }
  }

  public getProviders(): ProviderEnclave[] {
    if (!fs.existsSync(PROVIDERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(PROVIDERS_FILE, 'utf-8'));
  }

  public getProvider(providerId: string): ProviderEnclave | null {
    return this.getProviders().find((p) => p.id === providerId) ?? null;
  }

  public removeProvider(providerId: string): void {
    const providers = this.getProviders();
    // Only ids already on the list are accepted, so a crafted id can never point rm outside the providers dir
    const target = providers.find((p) => p.id === providerId);
    if (!target) throw new Error('Account not found.');
    fs.rmSync(path.join(PROVIDERS_DIR, target.id), { recursive: true, force: true });
    const remaining = providers.filter((p) => p.id !== target.id);
    fs.writeFileSync(PROVIDERS_FILE, JSON.stringify(remaining, null, 2), 'utf-8');
  }

  public updateProvider(providerId: string, changes: Partial<ProviderEnclave>): ProviderEnclave | null {
    const providers = this.getProviders().map((p) => (p.id === providerId ? { ...p, ...changes } : p));
    fs.writeFileSync(PROVIDERS_FILE, JSON.stringify(providers, null, 2), 'utf-8');
    return providers.find((p) => p.id === providerId) ?? null;
  }

  /** UIDs already cached per folder (ids are `${folderId}_${uidValidity}_${uid}`), so sync can skip re-downloading them. */
  public getKnownFolders(providerId: string): Map<string, KnownFolder> {
    const mPath = path.join(this.baseDir, 'providers', providerId, 'messages.json');
    const existing: EmailMessage[] = fs.existsSync(mPath) ? JSON.parse(fs.readFileSync(mPath, 'utf-8')) : [];
    const known = new Map<string, KnownFolder>();
    for (const m of existing) {
      const [folderId, uidValidity, uid] = m.id.split('_');
      if (!uidValidity || !uid || !/^\d+$/.test(uid)) continue;
      const entry = known.get(folderId);
      // If a folder somehow holds two UIDVALIDITY epochs, trust the newest one seen last
      if (!entry || entry.uidValidity !== uidValidity) known.set(folderId, { uidValidity, uids: new Set([Number(uid)]) });
      else entry.uids.add(Number(uid));
    }
    return known;
  }

  // Rebuilds server-backed folders from the server window, reusing cached messages and keeping local-only state
  public saveSyncedMessages(providerId: string, snapshots: FolderSnapshot[]): void {
    const provDir = path.join(this.baseDir, 'providers', providerId);
    const mPath = path.join(provDir, 'messages.json');
    const existing: EmailMessage[] = fs.existsSync(mPath) ? JSON.parse(fs.readFileSync(mPath, 'utf-8')) : [];
    const previous = new Map(existing.map((m) => [m.id, m]));
    const syncedFolders = new Set(snapshots.map((s) => s.folder.id));

    const fresh = snapshots.flatMap((s) => {
      const downloaded = new Map(s.newMessages.map((m) => [m.id, m]));
      return s.windowUids.flatMap((uid): EmailMessage[] => {
        const id = `${s.folder.id}_${s.uidValidity}_${uid}`;
        const old = previous.get(id);
        const base = downloaded.get(id) ?? old;
        if (!base) return [];
        // Read state from the server, but never un-read something the user opened locally
        const isRead = s.seen[uid] || (old?.isRead ?? false);
        if (!old) return [{ ...base, isRead }];
        return [
          {
            ...base,
            associationId: old.associationId,
            agendaId: old.agendaId,
            position: old.position,
            tags: old.tags,
            isRead,
            isStarred: old.isStarred,
          },
        ];
      });
    });
    const freshIds = new Set(fresh.map((m) => m.id));
    const serverMessageIds = new Set(fresh.map((m) => m.messageId).filter(Boolean));
    const kept = existing.filter((m) => {
      if (freshIds.has(m.id)) return false;
      if (!(syncedFolders as Set<string>).has(m.folderId)) return true;
      // Just-sent copies stay until the server's copy (same Message-ID) shows up
      if (m.id.startsWith('local_sent_')) return !m.messageId || !serverMessageIds.has(m.messageId);
      // Older mail beyond the fetch window keeps the user's filing instead of silently vanishing
      return Boolean(m.associationId || m.agendaId || m.position !== undefined || m.isStarred || m.tags.length > 0);
    });
    const all = [...fresh, ...kept];
    fs.writeFileSync(mPath, JSON.stringify(all, null, 2), 'utf-8');

    const folders: Folder[] = DEFAULT_FOLDERS.map((f) => {
      const snap = snapshots.find((s) => s.folder.id === f.id);
      const inFolder = all.filter((m) => (f.id === 'starred' ? m.isStarred : m.folderId === f.id));
      return { ...f, path: snap?.folder.path ?? f.path, totalCount: inFolder.length, unreadCount: inFolder.filter((m) => !m.isRead).length };
    });
    fs.writeFileSync(path.join(provDir, 'folders.json'), JSON.stringify(folders, null, 2), 'utf-8');
    this.updateProvider(providerId, {
      unreadTotal: folders.find((f) => f.id === 'inbox')?.unreadCount ?? 0,
      lastSyncedAt: Date.now(),
      status: 'connected',
    });
  }

  public addProvider(newProvider: ProviderEnclave): ProviderEnclave {
    const providers = this.getProviders();
    newProvider.storagePath = path.join(this.baseDir, 'providers', newProvider.id);
    fs.mkdirSync(newProvider.storagePath, { recursive: true });
    fs.mkdirSync(path.join(newProvider.storagePath, 'attachments'), { recursive: true });

    fs.writeFileSync(path.join(newProvider.storagePath, 'folders.json'), JSON.stringify(DEFAULT_FOLDERS, null, 2), 'utf-8');
    fs.writeFileSync(path.join(newProvider.storagePath, 'associations.json'), JSON.stringify([], null, 2), 'utf-8');
    fs.writeFileSync(path.join(newProvider.storagePath, 'messages.json'), JSON.stringify([], null, 2), 'utf-8');

    providers.push(newProvider);
    fs.writeFileSync(PROVIDERS_FILE, JSON.stringify(providers, null, 2), 'utf-8');
    return newProvider;
  }

  public getFolders(providerId: string): Folder[] {
    const fPath = path.join(this.baseDir, 'providers', providerId, 'folders.json');
    if (!fs.existsSync(fPath)) return [];
    return JSON.parse(fs.readFileSync(fPath, 'utf-8'));
  }

  public getAssociations(providerId: string): AssociationNode[] {
    const aPath = path.join(this.baseDir, 'providers', providerId, 'associations.json');
    if (!fs.existsSync(aPath)) return [];
    const assocs: AssociationNode[] = JSON.parse(fs.readFileSync(aPath, 'utf-8'));
    return assocs.sort((a, b) => a.position - b.position);
  }

  public reorderAssociations(providerId: string, associationIds: string[]): AssociationNode[] {
    const aPath = path.join(this.baseDir, 'providers', providerId, 'associations.json');
    const assocs = this.getAssociations(providerId);

    associationIds.forEach((id, index) => {
      const match = assocs.find((a) => a.id === id);
      if (match) {
        match.position = index + 1;
      }
    });

    assocs.sort((a, b) => a.position - b.position);
    fs.writeFileSync(aPath, JSON.stringify(assocs, null, 2), 'utf-8');
    return assocs;
  }

  public getEmails(providerId: string, filterId: string): EmailMessage[] {
    const mPath = path.join(this.baseDir, 'providers', providerId, 'messages.json');
    if (!fs.existsSync(mPath)) return [];
    const all: EmailMessage[] = JSON.parse(fs.readFileSync(mPath, 'utf-8'));

    let filtered: EmailMessage[] = [];
    if (filterId === 'starred') {
      filtered = all.filter((m) => m.isStarred);
    } else if (filterId === 'inbox' || filterId === 'sent' || filterId === 'drafts' || filterId === 'archive') {
      filtered = all.filter((m) => m.folderId === filterId);
    } else {
      // Filter by Association or Agenda node ID
      filtered = all.filter((m) => m.associationId === filterId || m.agendaId === filterId);
    }

    // Manually positioned messages first, then newest first
    return filtered.sort(
      (a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || (b.timestamp ?? 0) - (a.timestamp ?? 0)
    );
  }

  public reorderEmails(providerId: string, emailIds: string[]): EmailMessage[] {
    const mPath = path.join(this.baseDir, 'providers', providerId, 'messages.json');
    if (!fs.existsSync(mPath)) return [];
    const all: EmailMessage[] = JSON.parse(fs.readFileSync(mPath, 'utf-8'));

    emailIds.forEach((id, index) => {
      const msg = all.find((m) => m.id === id);
      if (msg) {
        msg.position = index + 1;
      }
    });

    fs.writeFileSync(mPath, JSON.stringify(all, null, 2), 'utf-8');
    return all;
  }

  public addAssociation(providerId: string, name: string, icon = '📁'): AssociationNode {
    const aPath = path.join(this.baseDir, 'providers', providerId, 'associations.json');
    const assocs = this.getAssociations(providerId);

    const newAssoc: AssociationNode = {
      id: `assoc_${Date.now()}`,
      providerId,
      name,
      icon,
      position: assocs.length + 1,
      agendas: [
        { id: `agenda_${Date.now()}_gen`, name: 'General', category: 'custom', position: 1, unreadCount: 0, totalCount: 0 },
        { id: `agenda_${Date.now()}_proj`, name: 'Project', category: 'project', position: 2, unreadCount: 0, totalCount: 0 },
        { id: `agenda_${Date.now()}_fin`, name: 'Financial', category: 'financial', position: 3, unreadCount: 0, totalCount: 0 },
        { id: `agenda_${Date.now()}_pfin`, name: 'Project Financial', category: 'financial', position: 4, unreadCount: 0, totalCount: 0 },
      ],
    };

    assocs.push(newAssoc);
    fs.writeFileSync(aPath, JSON.stringify(assocs, null, 2), 'utf-8');
    return newAssoc;
  }

  public addAgenda(
    providerId: string,
    associationId: string,
    name: string,
    category: 'project' | 'financial' | 'operations' | 'legal' | 'custom' = 'custom'
  ): AgendaNode | null {
    const aPath = path.join(this.baseDir, 'providers', providerId, 'associations.json');
    const assocs = this.getAssociations(providerId);
    const assoc = assocs.find((a) => a.id === associationId);
    if (!assoc) return null;

    const newAgenda: AgendaNode = {
      id: `agenda_${Date.now()}`,
      name,
      category,
      position: assoc.agendas.length + 1,
      unreadCount: 0,
      totalCount: 0,
    };

    assoc.agendas.push(newAgenda);
    fs.writeFileSync(aPath, JSON.stringify(assocs, null, 2), 'utf-8');
    return newAgenda;
  }

  public getEmailDetail(providerId: string, emailId: string): EmailMessage | null {
    const mPath = path.join(this.baseDir, 'providers', providerId, 'messages.json');
    if (!fs.existsSync(mPath)) return null;
    const all: EmailMessage[] = JSON.parse(fs.readFileSync(mPath, 'utf-8'));
    return all.find((m) => m.id === emailId) || null;
  }

  public markEmailRead(providerId: string, emailId: string, isRead: boolean) {
    const mPath = path.join(this.baseDir, 'providers', providerId, 'messages.json');
    if (!fs.existsSync(mPath)) return;
    const all: EmailMessage[] = JSON.parse(fs.readFileSync(mPath, 'utf-8'));
    const msg = all.find((m) => m.id === emailId);
    if (msg) {
      msg.isRead = isRead;
      fs.writeFileSync(mPath, JSON.stringify(all, null, 2), 'utf-8');
    }
  }

  public toggleStar(providerId: string, emailId: string): boolean {
    const mPath = path.join(this.baseDir, 'providers', providerId, 'messages.json');
    if (!fs.existsSync(mPath)) return false;
    const all: EmailMessage[] = JSON.parse(fs.readFileSync(mPath, 'utf-8'));
    const msg = all.find((m) => m.id === emailId);
    if (msg) {
      msg.isStarred = !msg.isStarred;
      fs.writeFileSync(mPath, JSON.stringify(all, null, 2), 'utf-8');
      return msg.isStarred;
    }
    return false;
  }

  public reassignEmailTree(providerId: string, emailId: string, associationId: string, agendaId: string) {
    const mPath = path.join(this.baseDir, 'providers', providerId, 'messages.json');
    if (!fs.existsSync(mPath)) return;
    const all: EmailMessage[] = JSON.parse(fs.readFileSync(mPath, 'utf-8'));
    const msg = all.find((m) => m.id === emailId);
    if (msg) {
      msg.associationId = associationId;
      msg.agendaId = agendaId;
      fs.writeFileSync(mPath, JSON.stringify(all, null, 2), 'utf-8');
    }
  }

  public saveSentEmail(
    provider: ProviderEnclave,
    email: { to: string; subject: string; body: string; html: string; messageId: string }
  ) {
    const mPath = path.join(this.baseDir, 'providers', provider.id, 'messages.json');
    if (!fs.existsSync(mPath)) return;
    const all: EmailMessage[] = JSON.parse(fs.readFileSync(mPath, 'utf-8'));
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

    all.unshift(sentMessage);
    fs.writeFileSync(mPath, JSON.stringify(all, null, 2), 'utf-8');
    return sentMessage;
  }
}
