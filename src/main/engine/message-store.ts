import fs from 'node:fs';
import path from 'node:path';
import type { EmailMessage } from '../../renderer/types/index';

// Ids become file and folder names, so anything that could climb out of the providers dir is refused
const SAFE_ID = /^[\w-]{1,128}$/;

export function assertSafeId(id: string, what: string): string {
  if (typeof id !== 'string' || !SAFE_ID.test(id)) throw new Error(`Invalid ${what}.`);
  return id;
}

interface StoredBody {
  bodyText?: string;
  bodyHtml?: string;
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  messages: EmailMessage[];
}

function stripBody(message: EmailMessage): { header: EmailMessage; body: StoredBody | null } {
  const { bodyText, bodyHtml, treeMatches: _derived, ...header } = message;
  if (bodyText === undefined && bodyHtml === undefined) return { header, body: null };
  return { header, body: { bodyText, bodyHtml } };
}

/**
 * Message headers for one account live in messages.json; bodies live one file each under bodies/.
 * With full-history sync a mailbox can hold thousands of letters, so lists never carry bodies and the
 * parsed header list is cached in memory until the file changes on disk.
 */
export class MessageStore {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly providersDir: string) {}

  public providerDir(providerId: string): string {
    return path.join(this.providersDir, assertSafeId(providerId, 'account id'));
  }

  private messagesPath(providerId: string): string {
    return path.join(this.providerDir(providerId), 'messages.json');
  }

  private bodiesDir(providerId: string): string {
    return path.join(this.providerDir(providerId), 'bodies');
  }

  private bodyPath(providerId: string, messageId: string): string {
    return path.join(this.bodiesDir(providerId), `${assertSafeId(messageId, 'message id')}.json`);
  }

  public read(providerId: string): EmailMessage[] {
    const file = this.messagesPath(providerId);
    if (!fs.existsSync(file)) return [];
    const { mtimeMs, size } = fs.statSync(file);
    const cached = this.cache.get(providerId);
    // Size as well as mtime: two writes inside one clock tick would otherwise look unchanged
    if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached.messages;

    const parsed: EmailMessage[] = JSON.parse(fs.readFileSync(file, 'utf-8'));
    // Older versions kept bodies inline; move them out once so every later read stays small
    if (parsed.some((m) => m.bodyText !== undefined || m.bodyHtml !== undefined)) return this.write(providerId, parsed);
    this.cache.set(providerId, { mtimeMs, size, messages: parsed });
    return parsed;
  }

  /** Persists headers; any bodies on the given messages are written to their own files first. */
  public write(providerId: string, messages: EmailMessage[]): EmailMessage[] {
    const headers = messages.map((message) => {
      const { header, body } = stripBody(message);
      if (body) this.writeBody(providerId, header.id, body);
      return header;
    });
    const file = this.messagesPath(providerId);
    fs.writeFileSync(file, JSON.stringify(headers), 'utf-8');
    const stat = fs.statSync(file);
    this.cache.set(providerId, { mtimeMs: stat.mtimeMs, size: stat.size, messages: headers });
    return headers;
  }

  public readBody(providerId: string, messageId: string): StoredBody {
    const file = this.bodyPath(providerId, messageId);
    if (!fs.existsSync(file)) return {};
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (err) {
      console.error(`Unreadable body for ${messageId}:`, err instanceof Error ? err.message : err);
      return {};
    }
  }

  private writeBody(providerId: string, messageId: string, body: StoredBody): void {
    fs.mkdirSync(this.bodiesDir(providerId), { recursive: true });
    fs.writeFileSync(this.bodyPath(providerId, messageId), JSON.stringify(body), 'utf-8');
  }

  public removeBodies(providerId: string, messageIds: string[]): void {
    for (const id of messageIds) {
      if (!SAFE_ID.test(id)) continue;
      fs.rmSync(this.bodyPath(providerId, id), { force: true });
    }
  }

  public forget(providerId: string): void {
    this.cache.delete(providerId);
  }
}
