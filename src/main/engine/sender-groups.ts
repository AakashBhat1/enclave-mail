import type { EmailMessage, SenderGroup, SenderGroupMode } from '../../renderer/types/index';

// Mail the user wrote is not "from" anyone else, so it never forms a sender group
const OUTGOING_FOLDERS = new Set(['sent', 'drafts']);

export const SENDER_PREFIX = 'sender:';
export const DOMAIN_PREFIX = 'domain:';

type GroupableMessage = Pick<EmailMessage, 'folderId' | 'from' | 'subject' | 'timestamp' | 'isRead' | 'isStarred'>;

export function senderKey(address: string): string {
  return address.trim().toLowerCase();
}

export function domainOf(address: string): string {
  const at = address.lastIndexOf('@');
  return at >= 0 ? senderKey(address.slice(at + 1)) : '';
}

/** True when the message belongs to the group a `sender:` / `domain:` filter id points at. */
export function matchesSenderFilter(message: GroupableMessage, filterId: string): boolean {
  if (OUTGOING_FOLDERS.has(message.folderId)) return false;
  if (filterId.startsWith(SENDER_PREFIX)) return senderKey(message.from.address) === filterId.slice(SENDER_PREFIX.length);
  if (filterId.startsWith(DOMAIN_PREFIX)) return domainOf(message.from.address) === filterId.slice(DOMAIN_PREFIX.length);
  return false;
}

export function isSenderFilter(filterId: string): boolean {
  return filterId.startsWith(SENDER_PREFIX) || filterId.startsWith(DOMAIN_PREFIX);
}

interface Tally {
  key: string;
  count: number;
  unread: number;
  starred: number;
  latestTimestamp: number;
  latestSubject: string;
  latestName: string;
  senders: Set<string>;
}

/** Received mail grouped by who sent it (or by their domain), busiest correspondents first. */
export function groupBySender(messages: GroupableMessage[], mode: SenderGroupMode): SenderGroup[] {
  // Private accumulator: counting in place keeps this linear for mailboxes with thousands of letters
  const tallies = new Map<string, Tally>();
  for (const message of messages) {
    if (OUTGOING_FOLDERS.has(message.folderId)) continue;
    const key = mode === 'domain' ? domainOf(message.from.address) : senderKey(message.from.address);
    if (!key) continue;
    const tally = tallies.get(key) ?? { key, count: 0, unread: 0, starred: 0, latestTimestamp: -1, latestSubject: '', latestName: '', senders: new Set<string>() };
    const timestamp = message.timestamp ?? 0;
    tally.count += 1;
    if (!message.isRead) tally.unread += 1;
    if (message.isStarred) tally.starred += 1;
    tally.senders.add(senderKey(message.from.address));
    if (timestamp > tally.latestTimestamp) {
      tally.latestTimestamp = timestamp;
      tally.latestSubject = message.subject;
      tally.latestName = message.from.name;
    }
    tallies.set(key, tally);
  }

  return [...tallies.values()]
    .map(
      (t): SenderGroup => ({
        id: `${mode === 'domain' ? DOMAIN_PREFIX : SENDER_PREFIX}${t.key}`,
        // People read better by name; domains keep the domain itself as the label
        label: mode === 'sender' && t.latestName && senderKey(t.latestName) !== t.key ? t.latestName : t.key,
        address: t.key,
        count: t.count,
        unread: t.unread,
        starred: t.starred,
        latestTimestamp: Math.max(t.latestTimestamp, 0),
        latestSubject: t.latestSubject,
        members: t.senders.size,
      })
    )
    .sort((a, b) => b.count - a.count || b.latestTimestamp - a.latestTimestamp);
}
