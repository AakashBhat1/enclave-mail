import { AddAccountInput, MailServerConfig, ProviderEnclave, SendEmailInput, SendOutcome } from '../../renderer/types/index';
import { StorageService } from './storage-service';
import { CredentialStore } from './credential-store';
import { ImapService } from './imap-service';
import { SmtpService } from './smtp-service';
import { ImapSessions, type AccountAccess } from './imap-sessions';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const PROVIDER_TYPES = ['gmail', 'outlook', 'custom_imap'];

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

export class AccountService {
  private readonly sessions: ImapSessions;
  // Overlapping requests for the same account (UI + push + startup) share one sync
  private readonly inflight = new Map<string, Promise<SyncResult>>();

  constructor(
    private readonly storage: StorageService,
    private readonly credentials: CredentialStore,
    private readonly onMailUpdate: MailUpdateListener = () => {}
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
    const downloaded = snapshots.reduce((n, s) => n + s.newMessages.length, 0);
    const newInbox = snapshots.find((s) => s.folder.id === 'inbox')?.newMessages.length ?? 0;
    console.info(`[sync] ${provider.email}: ${downloaded} new message(s) in ${Date.now() - started} ms`);
    return { provider: this.storage.getProvider(provider.id) ?? provider, newInbox };
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
