import { ImapFlow, ListResponse } from 'imapflow';
import { simpleParser, AddressObject, ParsedMail } from 'mailparser';
import { EmailMessage, MailServerConfig } from '../../renderer/types/index';

// A sync downloads the newest letters straight away; older history arrives through the background backfill
const QUICK_DOWNLOAD_LIMIT = 50;
// Read state is refreshed for the newest letters only; flags on years-old mail rarely change
const SEEN_WINDOW = 500;
// History is fetched in batches so other IMAP work (IDLE, Sent copies) can interleave
export const BACKFILL_BATCH_SIZE = 40;
// Letters bigger than this are stored partially during backfill (the text usually comes first)
const BACKFILL_MAX_BYTES = 512 * 1024;
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
  /** Every UID currently in the folder on the server. */
  serverUids: number[];
  /** Server \Seen state for the newest SEEN_WINDOW letters. */
  seen: Record<number, boolean>;
  /** Full messages, only for the newest UIDs the app did not have yet. */
  newMessages: EmailMessage[];
  /** Older UIDs still missing locally, newest first; the history backfill fetches these. */
  pendingUids: number[];
}

/** Splits what is missing locally into "download now" (newest) and "backfill later", both newest first. */
export function planDownloads(serverUids: number[], cached: Set<number>, quickLimit = QUICK_DOWNLOAD_LIMIT): { now: number[]; later: number[] } {
  const missing = [...serverUids].sort((a, b) => b - a).filter((uid) => !cached.has(uid));
  return { now: missing.slice(0, quickLimit), later: missing.slice(quickLimit) };
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

function isValidDate(value: Date | undefined): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function toEmailMessage(
  parsed: ParsedMail,
  uidValidity: string,
  uid: number,
  flags: Set<string>,
  folderId: LocalFolderId,
  providerId: string,
  truncated = false,
  /** When the server received it; the fallback for letters with no Date header. */
  arrivedAt?: Date
): EmailMessage {
  // A letter with no (or a broken) Date header keeps its server arrival time, never "now",
  // or an old letter would jump to the top of the inbox every time it is downloaded
  const date = isValidDate(parsed.date) ? parsed.date : arrivedAt ?? new Date(0);
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
    ...(truncated ? { bodyTruncated: true } : {}),
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

interface RawMessage {
  uid: number;
  flags: Set<string>;
  source: Buffer;
  truncated: boolean;
  arrivedAt?: Date;
}

async function downloadSources(client: ImapFlow, uids: number[], maxBytes?: number): Promise<RawMessage[]> {
  if (uids.length === 0) return [];
  const raw: RawMessage[] = [];
  const source = maxBytes ? { maxLength: maxBytes } : true;
  for await (const msg of client.fetch(uids.join(','), { uid: true, flags: true, size: true, internalDate: true, source }, { uid: true })) {
    if (!msg.source) continue;
    raw.push({
      uid: msg.uid,
      flags: msg.flags ?? new Set(),
      source: msg.source,
      truncated: !!maxBytes && (msg.size ?? 0) > msg.source.length,
      arrivedAt: msg.internalDate ? new Date(msg.internalDate) : undefined,
    });
  }
  return raw;
}

// Parse after the fetch loop (other work mid-iteration can stall the IMAP stream), one at a time to cap memory
async function parseAll(raw: RawMessage[], uidValidity: string, folder: RemoteFolder, providerId: string): Promise<EmailMessage[]> {
  const parsed: EmailMessage[] = [];
  for (const r of raw) {
    try {
      parsed.push(toEmailMessage(await simpleParser(r.source), uidValidity, r.uid, r.flags, folder.id, providerId, r.truncated, r.arrivedAt));
    } catch (err) {
      console.error(`[imap] could not parse ${folder.id} uid ${r.uid}:`, err instanceof Error ? err.message : err);
    }
  }
  return parsed;
}

async function fetchFolder(client: ImapFlow, folder: RemoteFolder, providerId: string, known?: KnownFolder): Promise<FolderSnapshot> {
  const lock = await client.getMailboxLock(folder.path);
  let raw: RawMessage[] = [];
  let snapshot: FolderSnapshot;
  try {
    const exists = client.mailbox ? client.mailbox.exists : 0;
    const uidValidity = client.mailbox ? String(client.mailbox.uidValidity) : '0';
    snapshot = { folder, uidValidity, serverUids: [], seen: {}, newMessages: [], pendingUids: [] };
    if (exists === 0) return snapshot;

    // UID SEARCH ALL returns only numbers, so listing a mailbox of thousands stays cheap
    const uids = await client.search({ all: true }, { uid: true });
    // imapflow returns false on a server error; an empty list for a non-empty folder is just as wrong.
    // Treating either as "the folder is empty" would wipe every local letter in it, so fail the sync instead.
    if (!uids || uids.length === 0) throw new Error(`Could not list the messages in ${folder.path}.`);
    snapshot.serverUids = uids;
    for await (const msg of client.fetch(`${Math.max(1, exists - SEEN_WINDOW + 1)}:*`, { uid: true, flags: true })) {
      snapshot.seen[msg.uid] = msg.flags?.has('\\Seen') ?? false;
    }

    // A changed UIDVALIDITY means the server renumbered the folder, so nothing cached can be trusted
    const cached = known && known.uidValidity === uidValidity ? known.uids : new Set<number>();
    const plan = planDownloads(snapshot.serverUids, cached);
    snapshot.pendingUids = plan.later;
    raw = await downloadSources(client, plan.now);
  } finally {
    lock.release();
  }
  return { ...snapshot, newMessages: await parseAll(raw, snapshot.uidValidity, folder, providerId) };
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
      snapshots.push(await fetchFolder(client, folder, providerId, known.get(folder.id)));
      phases.push(`${folder.id} ${Date.now() - t}ms`);
    }
    console.info(`[imap] ${phases.join(', ')}, total ${Date.now() - started}ms`);
    return snapshots;
  }

  /**
   * Downloads one batch of older letters. Returns null when the folder was renumbered since the plan
   * was made (the next sync re-plans). INBOX is re-selected afterwards so IDLE keeps watching it.
   */
  public static async fetchHistoryBatch(
    client: ImapFlow,
    folder: RemoteFolder,
    providerId: string,
    uidValidity: string,
    uids: number[]
  ): Promise<EmailMessage[] | null> {
    let raw: RawMessage[] = [];
    try {
      const lock = await client.getMailboxLock(folder.path);
      try {
        if (!client.mailbox || String(client.mailbox.uidValidity) !== uidValidity) return null;
        raw = await downloadSources(client, uids, BACKFILL_MAX_BYTES);
      } finally {
        lock.release();
      }
    } finally {
      // Every exit path (renumbered folder, failed fetch) must hand INBOX back to IDLE, or live mail stops
      if (folder.id !== 'inbox' && client.usable) {
        await client
          .getMailboxLock('INBOX')
          .then((inbox) => inbox.release())
          .catch((err) => console.error('Could not reselect INBOX:', err instanceof Error ? err.message : err));
      }
    }
    return parseAll(raw, uidValidity, folder, providerId);
  }

  // Many hosts (cPanel, etc.) do not file SMTP-sent mail automatically, so store a copy ourselves
  public static async appendToSent(client: ImapFlow, folders: RemoteFolder[], rawMessage: Buffer): Promise<void> {
    const sent = folders.find((f) => f.id === 'sent');
    if (!sent) throw new Error('Server has no Sent folder');
    await client.append(sent.path, rawMessage, ['\\Seen']);
  }
}
