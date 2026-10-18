import { AddAccountInput, EmailMessage, MailServerConfig, ProviderEnclave, SendEmailInput, SendOutcome, SyncProgress } from '../../renderer/types/index';
import { StorageService } from './storage-service';
import { CredentialStore } from './credential-store';
import { BACKFILL_BATCH_SIZE, FolderSnapshot, ImapService, RemoteFolder } from './imap-service';
import { SmtpService } from './smtp-service';
import { ImapSessions, type AccountAccess } from './imap-sessions';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const PROVIDER_TYPES = ['gmail', 'outlook', 'custom_imap'];
// History lands on disk in chunks; rewriting the header file per 40-letter batch would be wasteful
const BACKFILL_FLUSH_SIZE = 200;
// While history downloads, the open list refreshes at most this often (each refresh re-sends the open folder)
const BACKFILL_REFRESH_MS = 12_000;
const BACKFILL_MAX_RETRIES = 3;

function isPort(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) <= 65535;
}

function validateServer(server: MailServerConfig | undefined): string | null {
  if (!server) return 'Server settings are missing.';
  if (!server.username?.trim()) return 'Username is required.';
  if (!HOST_PATTERN.test(server.imapHost ?? '')) return 'Incoming (IMAP) server name is not valid.';
  if (!HOST_PATTERN.test(server.smtpHost ?? '')) return 'Outgoing (SMTP) server name is not valid.';
  if (!isPort(server.imapPort) || !isPort(server.smtpPort)) return 'Ports must be numbers between 1 and 65535.';
  return null;
}

function validateAccount(input: AddAccountInput): string | null {
  if (!input?.name?.trim()) return 'Display name is required.';
  if (!EMAIL_PATTERN.test(input.email ?? '')) return 'Email address is not valid.';
  if (!PROVIDER_TYPES.includes(input.type)) return 'Unknown provider type.';
  if (!input.password) return 'Password is required.';
  return validateServer(input.server);
}

// Turn raw IMAP/SMTP library errors into something a person can act on
export function describeMailError(err: unknown, stage: 'IMAP' | 'SMTP'): string {
  const e = err as { message?: string; code?: string; authenticationFailed?: boolean; responseText?: string };
  const server = stage === 'IMAP' ? 'incoming (IMAP)' : 'outgoing (SMTP)';
  if (e?.authenticationFailed || e?.code === 'EAUTH') {
    return `The ${server} server rejected the username or password. Gmail needs an App Password, not your normal password.`;
  }
  if (e?.code === 'ENOTFOUND' || e?.code === 'EDNS') return `The ${server} server name could not be found. Check the spelling.`;
  if (['ECONNREFUSED', 'ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'ECONNRESET'].includes(e?.code ?? '')) {
    return `Could not reach the ${server} server. Check the server name, port, and your internet connection.`;
  }
  if (e?.code === 'ETLS' || /certificate|self.signed|altname/i.test(e?.message ?? '')) {
    return `The ${server} server's security certificate does not match its name. Ask your email host for the exact server name.`;
  }
  return `${stage} error: ${e?.responseText || e?.message || 'unknown error'}`;
}

// Library error objects can carry connection details; log only the fields needed to debug
export function summarizeError(err: unknown): string {
  const e = err as { code?: string; message?: string; responseText?: string };
  return [e?.code, e?.message, e?.responseText].filter(Boolean).join(' | ') || 'unknown error';
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface SyncResult {
  provider: ProviderEnclave;
  newInbox: number;
}

/** Fired after a background sync (server push, reconnect, startup) so the UI can refresh. */
export type MailUpdateListener = (providerId: string, newInbox: number) => void;
export type SyncProgressListener = (progress: SyncProgress) => void;

interface BackfillJob {
  folder: RemoteFolder;
  uidValidity: string;
  uids: number[];
}

function backfillJobs(snapshots: FolderSnapshot[]): BackfillJob[] {
  return (
    snapshots
      .filter((s) => s.pendingUids.length > 0)
      .map((s) => ({ folder: s.folder, uidValidity: s.uidValidity, uids: s.pendingUids }))
      // The inbox is what people scroll first, so its history comes first
      .sort((a, b) => Number(b.folder.id === 'inbox') - Number(a.folder.id === 'inbox'))
  );
}

export class AccountService {
  private readonly sessions: ImapSessions;
  // Overlapping requests for the same account (UI + push + startup) share one sync
  private readonly inflight = new Map<string, Promise<SyncResult>>();
  private readonly backfilling = new Set<string>();
  // A sync that found missing history while a backfill was already running; it is re-planned once that ends
  private readonly backfillRequested = new Set<string>();

  constructor(
    private readonly storage: StorageService,
    private readonly credentials: CredentialStore,
    private readonly onMailUpdate: MailUpdateListener = () => {},
    private readonly onProgress: SyncProgressListener = () => {},
    /** Runs after new mail is stored (e.g. the Tree Sorter's auto-run). */
    private readonly afterMailStored: (providerId: string) => void = () => {}
  ) {
    this.sessions = new ImapSessions(
      (id) => this.tryLoadAccess(id),
      (id) => void this.backgroundSync(id)
    );
  }

  /** Sync every account once at launch; that also opens the IDLE connection that delivers new mail live. */
  public async startWatching(): Promise<void> {
    for (const provider of this.storage.getProviders()) {
      if (provider.server) await this.backgroundSync(provider.id);
    }
  }

  public async forget(providerId: string): Promise<void> {
    await this.sessions.close(providerId);
  }

  public async shutdown(): Promise<void> {
    await this.sessions.closeAll();
  }

  public async addAccount(input: AddAccountInput): Promise<ProviderEnclave> {
    const invalid = validateAccount(input);
    if (invalid) throw new Error(invalid);
    const email = input.email.trim().toLowerCase();
    if (this.storage.getProviders().some((p) => p.email.toLowerCase() === email)) {
      throw new Error(`${input.email.trim()} is already added.`);
    }

    const server: MailServerConfig = {
      username: input.server.username.trim(),
      imapHost: input.server.imapHost.trim().toLowerCase(),
      imapPort: input.server.imapPort,
      smtpHost: input.server.smtpHost.trim().toLowerCase(),
      smtpPort: input.server.smtpPort,
    };

    // Prove both logins work before anything is written to disk
    await ImapService.testConnection(server, input.password).catch((err) => {
      throw new Error(describeMailError(err, 'IMAP'));
    });
    await SmtpService.verify(server, input.password).catch((err) => {
      throw new Error(describeMailError(err, 'SMTP'));
    });

    const id = `prov_${Date.now()}`;
    this.credentials.savePassword(id, input.password);
    const provider = this.storage.addProvider({
      id,
      name: input.name.trim(),
      email: input.email.trim(),
      avatarColor: input.avatarColor,
      type: input.type,
      unreadTotal: 0,
      storagePath: '',
      server,
      status: 'connected',
    });

    // Login already succeeded, so keep the account even if the first download fails; the next sync retries
    try {
      return await this.sync(id);
    } catch (err) {
      console.error('Initial sync failed:', summarizeError(err));
      return this.storage.getProvider(id) ?? provider;
    }
  }

  public async sync(providerId: string): Promise<ProviderEnclave> {
    return (await this.syncOnce(providerId)).provider;
  }

  private async backgroundSync(providerId: string): Promise<void> {
    try {
      const { newInbox } = await this.syncOnce(providerId);
      this.onMailUpdate(providerId, newInbox);
    } catch (err) {
      console.error('Background sync failed:', err instanceof Error ? err.message : summarizeError(err));
    }
  }

  private syncOnce(providerId: string): Promise<SyncResult> {
    const running = this.inflight.get(providerId);
    if (running) return running;
    const sync = this.runSync(providerId).finally(() => this.inflight.delete(providerId));
    this.inflight.set(providerId, sync);
    return sync;
  }

  private async runSync(providerId: string): Promise<SyncResult> {
    const { provider } = this.loadAccount(providerId);
    const started = Date.now();
    const known = this.storage.getKnownFolders(provider.id);
    const attempt = async () => {
      const session = await this.sessions.acquire(provider.id);
      return ImapService.syncFolders(session.client, session.folders, provider.id, known);
    };

    let snapshots;
    try {
      snapshots = await attempt();
    } catch {
      // A long-idle connection can die silently; one retry on a fresh login covers that
      this.sessions.discard(provider.id);
      try {
        snapshots = await attempt();
      } catch (err) {
        this.storage.updateProvider(provider.id, { status: 'offline' });
        throw new Error(describeMailError(err, 'IMAP'));
      }
    }

    this.sessions.markSynced(provider.id);
    this.storage.saveSyncedMessages(provider.id, snapshots);
    this.runAfterStore(provider.id);
    const downloaded = snapshots.reduce((n, s) => n + s.newMessages.length, 0);
    const pending = snapshots.reduce((n, s) => n + s.pendingUids.length, 0);
    // On the very first sync everything downloaded is history, not news, so it raises no "new letters" toast
    const newInbox = provider.lastSyncedAt ? snapshots.find((s) => s.folder.id === 'inbox')?.newMessages.length ?? 0 : 0;
    console.info(`[sync] ${provider.email}: ${downloaded} new message(s), ${pending} older pending, in ${Date.now() - started} ms`);
    this.startBackfill(provider.id, snapshots);
    return { provider: this.storage.getProvider(provider.id) ?? provider, newInbox };
  }

  private runAfterStore(providerId: string): void {
    try {
      this.afterMailStored(providerId);
    } catch (err) {
      console.error('Post-sync hook failed:', err instanceof Error ? err.message : summarizeError(err));
    }
  }

  /** Pulls every older letter in the background, newest first, so the first screenful never waits on history. */
  private startBackfill(providerId: string, snapshots: FolderSnapshot[]): void {
    const jobs = backfillJobs(snapshots);
    if (jobs.length === 0) return;
    if (this.backfilling.has(providerId)) {
      this.backfillRequested.add(providerId);
      return;
    }
    this.backfilling.add(providerId);
    void this.runBackfill(providerId, jobs)
      .catch((err) => console.error('History download stopped:', err instanceof Error ? err.message : summarizeError(err)))
      .finally(() => {
        this.backfilling.delete(providerId);
        // Mail that arrived mid-download may have left new gaps; one more sync plans them
        if (this.backfillRequested.delete(providerId) && this.sessions.isWatched(providerId)) void this.backgroundSync(providerId);
      });
  }

  private async runBackfill(providerId: string, jobs: BackfillJob[]): Promise<void> {
    const total = jobs.reduce((n, j) => n + j.uids.length, 0);
    const started = Date.now();
    let done = 0;
    let buffered: EmailMessage[] = [];
    let lastRefresh = Date.now();
    const stillWanted = () => this.sessions.isWatched(providerId) && this.storage.getProvider(providerId) !== null;

    const flush = (force: boolean) => {
      if (buffered.length === 0 || (!force && buffered.length < BACKFILL_FLUSH_SIZE)) return;
      // The account may have been removed while the batch was downloading; never recreate its folder
      if (!stillWanted()) return;
      this.storage.appendMessages(providerId, buffered);
      buffered = [];
      if (Date.now() - lastRefresh >= BACKFILL_REFRESH_MS) {
        lastRefresh = Date.now();
        this.onMailUpdate(providerId, 0);
      }
    };

    this.onProgress({ providerId, phase: 'history', done, total, folderId: jobs[0].folder.id });
    try {
      for (const job of jobs) {
        for (let i = 0; i < job.uids.length; i += BACKFILL_BATCH_SIZE) {
          if (!stillWanted()) return;
          const batch = job.uids.slice(i, i + BACKFILL_BATCH_SIZE);
          const messages = await this.fetchBatchWithRetry(providerId, job, batch);
          // The folder was renumbered mid-way; the next sync plans again from scratch
          if (messages === null) break;
          buffered = [...buffered, ...messages];
          done += batch.length;
          flush(false);
          this.onProgress({ providerId, phase: 'history', done, total, folderId: job.folder.id });
        }
        flush(true);
      }
    } catch (err) {
      // Keep what already arrived, and let the UI drop its progress bar; the next sync resumes the gap
      flush(true);
      if (stillWanted()) this.onProgress({ providerId, phase: 'stopped', done, total });
      throw err;
    }
    if (!stillWanted()) return;
    // The Tree Sorter's auto-run is a full rescan, so it runs once over the finished history, not per chunk
    this.runAfterStore(providerId);
    console.info(`[backfill] ${done}/${total} older message(s) in ${Math.round((Date.now() - started) / 1000)} s`);
    this.onProgress({ providerId, phase: 'done', done, total });
    this.onMailUpdate(providerId, 0);
  }

  private async fetchBatchWithRetry(providerId: string, job: BackfillJob, uids: number[]): Promise<EmailMessage[] | null> {
    for (let attempt = 1; ; attempt++) {
      try {
        const session = await this.sessions.acquire(providerId);
        return await ImapService.fetchHistoryBatch(session.client, job.folder, providerId, job.uidValidity, uids);
      } catch (err) {
        if (attempt >= BACKFILL_MAX_RETRIES) throw err;
        // A dropped connection is the usual cause; a fresh login on the next attempt covers it
        this.sessions.discard(providerId);
        await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
      }
    }
  }

  public async send(input: SendEmailInput): Promise<SendOutcome> {
    if (!input?.to?.trim()) throw new Error('Add at least one recipient.');
    const { provider, server, password } = this.loadAccount(input.providerId);
    const html = `<div style="font-family: sans-serif; white-space: pre-wrap;">${escapeHtml(input.body)}</div>`;

    const started = Date.now();
    const { messageId, raw, serverResponse, rejected } = await SmtpService.send(server, password, {
      from: { name: provider.name, address: provider.email },
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      text: input.body,
      html,
    }).catch((err) => {
      throw new Error(describeMailError(err, 'SMTP'));
    });

    // The server's reply carries its queue id; it is what the host's delivery log (cPanel "Track Delivery") searches by
    console.info(`[smtp] ${provider.email} -> ${input.to}: "${serverResponse}" in ${Date.now() - started} ms`);
    this.storage.saveSentEmail(provider, { to: input.to, subject: input.subject, body: input.body, html, messageId });

    // Filing the Sent copy needs a second IMAP login; do it after replying so the send itself feels instant.
    // The local copy stays in Sent until the server copy shows up, so nothing is lost if this fails.
    if (!SmtpService.serverSavesSentCopy(server)) {
      this.sessions
        .acquire(provider.id)
        .then((session) => ImapService.appendToSent(session.client, session.folders, raw))
        .catch((err) => console.error('Could not save a copy to the server Sent folder:', summarizeError(err)));
    }

    const warning = rejected.length > 0 ? `The server refused these recipients: ${rejected.join(', ')}` : undefined;
    return { messageId, warning, serverResponse };
  }

  private tryLoadAccess(providerId: string): AccountAccess | null {
    try {
      const { server, password } = this.loadAccount(providerId);
      return { server, password };
    } catch {
      return null;
    }
  }

  private loadAccount(providerId: string) {
    const provider = this.storage.getProvider(providerId);
    if (!provider) throw new Error('Account not found.');
    if (!provider.server) throw new Error('This account has no server settings. Remove it and add it again.');
    return { provider, server: provider.server, password: this.credentials.getPassword(provider.id) };
  }
}
