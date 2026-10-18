import { describe, expect, it } from 'vitest';
import type { EmailMessage } from '../../renderer/types/index';
import { domainOf, groupBySender, isSenderFilter, matchesSenderFilter } from './sender-groups';

type Groupable = Pick<EmailMessage, 'folderId' | 'from' | 'subject' | 'timestamp' | 'isRead' | 'isStarred'>;

function mail(address: string, name: string, timestamp: number, extra: Partial<Groupable> = {}): Groupable {
  return { folderId: 'inbox', from: { name, address }, subject: `from ${name} @${timestamp}`, timestamp, isRead: true, isStarred: false, ...extra };
}

const MAIL: Groupable[] = [
  mail('Ana@Acme.com', 'Ana', 1, { isRead: false }),
  mail('ana@acme.com', 'Ana Pereira', 5, { isStarred: true }),
  mail('bob@acme.com', 'Bob', 3),
  mail('zed@gmail.com', 'Zed', 9, { isRead: false }),
  mail('me@mine.com', 'Me', 10, { folderId: 'sent' }),
];

describe('groupBySender', () => {
  it('groups received mail by address, case-insensitively, busiest first', () => {
    const groups = groupBySender(MAIL, 'sender');
    expect(groups.map((g) => g.id)).toEqual(['sender:ana@acme.com', 'sender:zed@gmail.com', 'sender:bob@acme.com']);
    expect(groups[0]).toMatchObject({ label: 'Ana Pereira', count: 2, unread: 1, starred: 1, latestTimestamp: 5, latestSubject: 'from Ana Pereira @5', members: 1 });
  });

  it('never groups the user’s own sent mail', () => {
    expect(groupBySender(MAIL, 'sender').some((g) => g.address === 'me@mine.com')).toBe(false);
  });

  it('groups by domain and counts distinct senders', () => {
    const groups = groupBySender(MAIL, 'domain');
    expect(groups[0]).toMatchObject({ id: 'domain:acme.com', label: 'acme.com', count: 3, members: 2 });
  });

  it('falls back to the address when a sender has no name', () => {
    expect(groupBySender([mail('x@y.io', '', 1)], 'sender')[0].label).toBe('x@y.io');
  });
});

describe('sender filters', () => {
  it('recognises sender and domain filter ids', () => {
    expect(isSenderFilter('sender:a@b.c')).toBe(true);
    expect(isSenderFilter('domain:b.c')).toBe(true);
    expect(isSenderFilter('inbox')).toBe(false);
  });

  it('matches messages to their group', () => {
    expect(matchesSenderFilter(MAIL[0], 'sender:ana@acme.com')).toBe(true);
    expect(matchesSenderFilter(MAIL[2], 'domain:acme.com')).toBe(true);
    expect(matchesSenderFilter(MAIL[3], 'domain:acme.com')).toBe(false);
    expect(matchesSenderFilter(MAIL[4], 'sender:me@mine.com')).toBe(false);
  });

  it('extracts domains', () => {
    expect(domainOf('A@Sub.Example.COM')).toBe('sub.example.com');
    expect(domainOf('no-at-sign')).toBe('');
  });
});
