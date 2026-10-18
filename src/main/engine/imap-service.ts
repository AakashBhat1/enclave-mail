import { ImapFlow, ListResponse } from 'imapflow';
import { simpleParser, AddressObject, ParsedMail } from 'mailparser';
import { EmailMessage, MailServerConfig } from '../../renderer/types/index';

const RECENT_MESSAGE_LIMIT = 50;
const SNIPPET_LENGTH = 120;
const IMPLICIT_TLS_PORT = 993;

export type LocalFolderId = 'inbox' | 'sent' | 'drafts' | 'archive';

export interface RemoteFolder {
  id: LocalFolderId;
  path: string;
}

/** What the app already holds for one folder, so a sync only downloads what is new. */
export interface KnownFolder {
  uidValidity: string;
  uids: Set<number>;
}

export interface FolderSnapshot {
  folder: RemoteFolder;
  uidValidity: string;
  /** UIDs currently inside the newest-N window on the server. */
  windowUids: number[];
  /** Server \Seen state for every UID in the window. */
  seen: Record<number, boolean>;
  /** Full messages, only for UIDs the app did not have yet. */
  newMessages: EmailMessage[];
}

const SPECIAL_USE_MAP: Record<string, LocalFolderId> = {
  '\\Inbox': 'inbox',
  '\\Sent': 'sent',
  '\\Drafts': 'drafts',
  '\\Archive': 'archive',
};

// Many cPanel/Dovecot servers do not advertise special-use flags, so fall back to common folder names
const NAME_FALLBACKS: Record<Exclude<LocalFolderId, 'inbox'>, string[]> = {
  sent: ['sent', 'sent items', 'sent messages', 'sent mail'],
  drafts: ['drafts', 'draft'],
  archive: ['archive', 'archives'],
};

export function createClient(config: MailServerConfig, password: string): ImapFlow {
  const client = new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    // 993 is implicit TLS; other ports (143) must upgrade with STARTTLS
    secure: config.imapPort === IMPLICIT_TLS_PORT,
    doSTARTTLS: config.imapPort === IMPLICIT_TLS_PORT ? undefined : true,
    auth: { user: config.username, pass: password },
    logger: false,
  });
  // Socket drops after connect are emitted as events; without a listener they crash the main process
  client.on('error', (err: Error) => console.error('IMAP connection error:', err.message));
  return client;
}

async function withClient<T>(config: MailServerConfig, password: string, run: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = createClient(config, password);
  try {
    await client.connect();
    return await run(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

function resolveFolders(list: ListResponse[]): RemoteFolder[] {
  const found = new Map<LocalFolderId, string>([['inbox', 'INBOX']]);
  for (const box of list) {
    const id = box.specialUse ? SPECIAL_USE_MAP[box.specialUse] : undefined;
    if (id && !found.has(id)) found.set(id, box.path);
  }
  for (const [id, names] of Object.entries(NAME_FALLBACKS) as [LocalFolderId, string[]][]) {
    if (found.has(id)) continue;
    const match = list.find((box) => names.includes(box.name.toLowerCase()));
    if (match) found.set(id, match.path);
  }
  return [...found.entries()].map(([id, path]) => ({ id, path }));
}

function firstAddress(field: AddressObject | AddressObject[] | undefined): { name: string; address: string }[] {
  const objects = Array.isArray(field) ? field : field ? [field] : [];
  return objects.flatMap((o) => o.value).map((a) => ({ name: a.name || a.address || '', address: a.address || '' }));
}

function toEmailMessage(parsed: ParsedMail, uidValidity: string, uid: number, flags: Set<string>, folderId: LocalFolderId, providerId: string): EmailMessage {
  const date = parsed.date ?? new Date();
  const text = parsed.text ?? '';
  const sender = firstAddress(parsed.from)[0] ?? { name: 'Unknown sender', address: '' };
  return {
    // UIDs are only unique within one UIDVALIDITY epoch of a mailbox
    id: `${folderId}_${uidValidity}_${uid}`,
    uid,
    messageId: parsed.messageId,
    providerId,
    folderId,
    from: sender,
    to: firstAddress(parsed.to),
    subject: parsed.subject || '(no subject)',
    date: date.toLocaleString(),
    timestamp: date.getTime(),
    snippet: text.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LENGTH),
    bodyText: text,
    bodyHtml: parsed.html || undefined,
    isRead: flags.has('\\Seen'),
    isStarred: flags.has('\\Flagged'),
    tags: [],
    attachments: parsed.attachments.map((a, i) => ({
      id: `${folderId}_${uidValidity}_${uid}_att${i}`,
      filename: a.filename || `attachment-${i + 1}`,
      contentType: a.contentType,
      size: a.size,
      contentId: a.contentId,
    })),
  };
}

async function fetchRecent(client: ImapFlow, folder: RemoteFolder, providerId: string, known?: KnownFolder): Promise<FolderSnapshot> {
  const lock = await client.getMailboxLock(folder.path);
  try {
    const exists = client.mailbox ? client.mailbox.exists : 0;
    const uidValidity = client.mailbox ? String(client.mailbox.uidValidity) : '0';
    const snapshot: FolderSnapshot = { folder, uidValidity, windowUids: [], seen: {}, newMessages: [] };
    if (exists === 0) return snapshot;

    // Pass 1 is flags only: a few hundred bytes per message, so it costs almost nothing
    const range = `${Math.max(1, exists - RECENT_MESSAGE_LIMIT + 1)}:*`;
    for await (const msg of client.fetch(range, { uid: true, flags: true })) {
      snapshot.windowUids.push(msg.uid);
      snapshot.seen[msg.uid] = msg.flags?.has('\\Seen') ?? false;
    }

    // A changed UIDVALIDITY means the server renumbered the folder, so nothing cached can be trusted
    const cached = known && known.uidValidity === uidValidity ? known.uids : new Set<number>();
    const missing = snapshot.windowUids.filter((uid) => !cached.has(uid));
    if (missing.length === 0) return snapshot;

    // Pass 2 downloads full sources, but only for messages we have never seen
    const raw: { uid: number; flags: Set<string>; source: Buffer }[] = [];
    for await (const msg of client.fetch(missing.join(','), { uid: true, flags: true, source: true }, { uid: true })) {
      if (msg.source) raw.push({ uid: msg.uid, flags: msg.flags ?? new Set(), source: msg.source });
    }
    // Parse after the fetch loop (other work mid-iteration can stall the IMAP stream), one at a time to cap memory
    for (const r of raw) {
      snapshot.newMessages.push(toEmailMessage(await simpleParser(r.source), uidValidity, r.uid, r.flags, folder.id, providerId));
    }
    return snapshot;
  } finally {
    lock.release();
  }
}

export class ImapService {
  public static async testConnection(config: MailServerConfig, password: string): Promise<void> {
    await withClient(config, password, async (client) => {
      await client.list();
    });
  }

  /** Lists folders once per session; where Sent/Drafts/Archive live rarely changes. */
  public static async resolveRemoteFolders(client: ImapFlow): Promise<RemoteFolder[]> {
    return resolveFolders(await client.list());
  }

  /** Incremental sync over an already-open client. INBOX goes last so it stays selected for IDLE. */
  public static async syncFolders(
    client: ImapFlow,
    folders: RemoteFolder[],
    providerId: string,
    known: Map<string, KnownFolder>
  ): Promise<FolderSnapshot[]> {
    const started = Date.now();
    const phases: string[] = [];
    const ordered = [...folders.filter((f) => f.id !== 'inbox'), ...folders.filter((f) => f.id === 'inbox')];
    const snapshots: FolderSnapshot[] = [];
    for (const folder of ordered) {
      const t = Date.now();
      snapshots.push(await fetchRecent(client, folder, providerId, known.get(folder.id)));
      phases.push(`${folder.id} ${Date.now() - t}ms`);
    }
    console.info(`[imap] ${phases.join(', ')}, total ${Date.now() - started}ms`);
    return snapshots;
  }

  // Many hosts (cPanel, etc.) do not file SMTP-sent mail automatically, so store a copy ourselves
  public static async appendToSent(client: ImapFlow, folders: RemoteFolder[], rawMessage: Buffer): Promise<void> {
    const sent = folders.find((f) => f.id === 'sent');
    if (!sent) throw new Error('Server has no Sent folder');
    await client.append(sent.path, rawMessage, ['\\Seen']);
  }
}
