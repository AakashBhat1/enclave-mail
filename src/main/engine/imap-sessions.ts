import { ImapFlow } from 'imapflow';
import { MailServerConfig } from '../../renderer/types/index';
import { createClient, ImapService, RemoteFolder } from './imap-service';

export interface ImapSession {
  client: ImapFlow;
  folders: RemoteFolder[];
  /** INBOX message count at the end of the last sync; a push only counts if it goes above this. */
  inboxCount: number;
}

export interface AccountAccess {
  server: MailServerConfig;
  password: string;
}

const RECONNECT_MIN_MS = 5_000;
const RECONNECT_MAX_MS = 5 * 60_000;
// Bursts of EXISTS (e.g. a server delivering several messages) collapse into one sync
const NEW_MAIL_DEBOUNCE_MS = 1_500;

/**
 * One long-lived IMAP connection per account. Logging in costs ~3s on a shared host, so syncs reuse
 * the connection, and the selected INBOX sits in IDLE so the server pushes new mail as it arrives.
 */
export class ImapSessions {
  private readonly sessions = new Map<string, ImapSession>();
  private readonly connecting = new Map<string, Promise<ImapSession>>();
  private readonly watched = new Set<string>();
  private readonly reconnectTimers = new Map<string, NodeJS.Timeout>();
  private readonly backoff = new Map<string, number>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly access: (providerId: string) => AccountAccess | null,
    private readonly onNewMail: (providerId: string) => void
  ) {}

  public async acquire(providerId: string): Promise<ImapSession> {
    const live = this.sessions.get(providerId);
    if (live?.client.usable) return live;
    if (live) this.discard(providerId);
    const pending = this.connecting.get(providerId);
    if (pending) return pending;
    const opening = this.open(providerId).finally(() => this.connecting.delete(providerId));
    this.connecting.set(providerId, opening);
    return opening;
  }

  /** Drop a connection that misbehaved; the next acquire opens a fresh one. */
  public discard(providerId: string): void {
    const session = this.sessions.get(providerId);
    this.sessions.delete(providerId);
    session?.client.close();
  }

  /** False once the account was removed or the app is quitting; long-running work checks this to stop. */
  public isWatched(providerId: string): boolean {
    return this.watched.has(providerId);
  }

  public markSynced(providerId: string): void {
    const session = this.sessions.get(providerId);
    if (session) session.inboxCount = session.client.mailbox ? session.client.mailbox.exists : session.inboxCount;
  }

  /** Stop watching an account (removed, or app quitting) and log out politely. */
  public async close(providerId: string): Promise<void> {
    this.watched.delete(providerId);
    clearTimeout(this.reconnectTimers.get(providerId));
    clearTimeout(this.debounceTimers.get(providerId));
    this.reconnectTimers.delete(providerId);
    this.debounceTimers.delete(providerId);
    const session = this.sessions.get(providerId);
    this.sessions.delete(providerId);
    await session?.client.logout().catch(() => session.client.close());
  }

  public async closeAll(): Promise<void> {
    const ids = new Set([...this.sessions.keys(), ...this.watched]);
    await Promise.all([...ids].map((id) => this.close(id)));
  }

  private async open(providerId: string): Promise<ImapSession> {
    const account = this.access(providerId);
    if (!account) throw new Error('Account not found.');
    const started = Date.now();
    const client = createClient(account.server, account.password);
    try {
      await client.connect();
      const folders = await ImapService.resolveRemoteFolders(client);
      // Select INBOX straight away so auto-IDLE watches it even before the first sync finishes
      await client.mailboxOpen('INBOX');
      const session: ImapSession = { client, folders, inboxCount: client.mailbox ? client.mailbox.exists : 0 };
      this.attach(providerId, session);
      console.info(`[imap] session opened in ${Date.now() - started}ms`);
      return session;
    } catch (err) {
      client.close();
      throw err;
    }
  }

  private attach(providerId: string, session: ImapSession): void {
    const { client } = session;
    this.sessions.set(providerId, session);
    this.watched.add(providerId);
    this.backoff.delete(providerId);

    client.on('exists', (data: { path: string; count: number }) => {
      if (data.path === 'INBOX' && data.count > session.inboxCount) this.queueNewMail(providerId);
    });
    client.on('close', () => {
      // discard()/close() remove the session first, so only unexpected drops get here and reconnect
      if (this.sessions.get(providerId)?.client !== client) return;
      this.sessions.delete(providerId);
      if (this.watched.has(providerId)) this.scheduleReconnect(providerId);
    });
  }

  private queueNewMail(providerId: string): void {
    clearTimeout(this.debounceTimers.get(providerId));
    this.debounceTimers.set(
      providerId,
      setTimeout(() => {
        this.debounceTimers.delete(providerId);
        this.onNewMail(providerId);
      }, NEW_MAIL_DEBOUNCE_MS)
    );
  }

  private scheduleReconnect(providerId: string): void {
    if (this.reconnectTimers.has(providerId)) return;
    const delay = this.backoff.get(providerId) ?? RECONNECT_MIN_MS;
    this.backoff.set(providerId, Math.min(delay * 2, RECONNECT_MAX_MS));
    this.reconnectTimers.set(
      providerId,
      setTimeout(() => {
        this.reconnectTimers.delete(providerId);
        if (!this.watched.has(providerId)) return;
        // Mail may have arrived while we were offline, so treat a reconnect like a push
        this.acquire(providerId)
          .then(() => this.onNewMail(providerId))
          .catch(() => this.scheduleReconnect(providerId));
      }, delay)
    );
  }
}
