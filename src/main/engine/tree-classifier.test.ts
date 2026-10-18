import { describe, expect, it } from 'vitest';
import type { AssociationNode, TreeSorterSettings } from '../../renderer/types/index';
import { classifyMessage, compileTree, normalizeKeywords, sanitizeSorterSettings, scanMessages, suggestKeywords, type ClassifiableMessage } from './tree-classifier';

const SETTINGS: TreeSorterSettings = { folders: ['inbox'], fields: ['subject'], matchMode: 'word', autoRun: false };

function msg(id: string, subject: string, extra: Partial<ClassifiableMessage> = {}): ClassifiableMessage {
  return { id, folderId: 'inbox', subject, from: { name: 'Ana', address: 'ana@acme.com' }, snippet: '', isRead: false, ...extra };
}

function tree(): AssociationNode[] {
  return [
    {
      id: 'finance',
      providerId: 'p',
      name: 'Finance',
      position: 1,
      keywords: ['invoice', '-newsletter'],
      agendas: [{ id: 'tax', name: 'Tax', category: 'financial', position: 1, unreadCount: 0, totalCount: 0, keywords: ['tax', 'gst'] }],
    },
    {
      id: 'clients',
      providerId: 'p',
      name: 'Clients',
      position: 2,
      keywords: [],
      agendas: [
        { id: 'acme', name: 'Acme', category: 'custom', position: 1, unreadCount: 0, totalCount: 0, keywords: ['acme'] },
        { id: 'globex', name: 'Globex', category: 'custom', position: 2, unreadCount: 0, totalCount: 0, keywords: ['globex'] },
      ],
    },
  ];
}

const classify = (subject: string, settings = SETTINGS, extra: Partial<ClassifiableMessage> = {}) =>
  classifyMessage(msg('m', subject, extra), compileTree(tree(), settings), settings);

describe('normalizeKeywords', () => {
  it('lowercases, trims, collapses spaces and drops blanks and duplicates', () => {
    expect(normalizeKeywords(['  Invoice ', 'invoice', '', '-', 'Pull   Request', 42])).toEqual(['invoice', 'pull request']);
  });

  it('keeps exclusions', () => {
    expect(normalizeKeywords(['-Newsletter'])).toEqual(['-newsletter']);
  });

  it('returns nothing for non-arrays', () => {
    expect(normalizeKeywords('invoice')).toEqual([]);
  });
});

describe('classifyMessage', () => {
  it('files into a branch when its keyword appears at the start of a word', () => {
    expect(classify('Your Invoices for October')).toEqual([{ associationId: 'finance', keyword: 'invoice' }]);
  });

  it('does not match inside a word in word mode', () => {
    expect(classify('Reinvoice request')).toEqual([]);
  });

  it('matches inside a word in anywhere mode', () => {
    expect(classify('Reinvoice request', { ...SETTINGS, matchMode: 'anywhere' })).toHaveLength(1);
  });

  it('puts one letter into every branch it is relevant to', () => {
    const found = classify('Acme and Globex: invoice + GST');
    expect(found.map((f) => f.agendaId ?? f.associationId).sort()).toEqual(['acme', 'finance', 'globex', 'tax']);
  });

  it('honours exclusions, including a parent exclusion on its sub-branches', () => {
    expect(classify('Invoice newsletter: GST changes')).toEqual([]);
  });

  it('only looks at the chosen fields', () => {
    const fromAcme = { from: { name: 'Billing', address: 'billing@acme.com' } };
    expect(classify('Hello', SETTINGS, fromAcme)).toEqual([]);
    expect(classify('Hello', { ...SETTINGS, fields: ['subject', 'from'] }, fromAcme)).toEqual([{ associationId: 'clients', agendaId: 'acme', keyword: 'acme' }]);
  });

  it('treats regex characters in keywords literally', () => {
    const t: AssociationNode[] = [{ id: 'a', providerId: 'p', name: 'A', position: 1, keywords: ['c++ (v2)'], agendas: [] }];
    const compiled = compileTree(t, SETTINGS);
    expect(classifyMessage(msg('1', 'New C++ (v2) release'), compiled, SETTINGS)).toHaveLength(1);
    expect(classifyMessage(msg('2', 'New C release'), compiled, SETTINGS)).toHaveLength(0);
  });
});

describe('scanMessages', () => {
  const messages = [
    msg('1', 'Invoice 42'),
    msg('2', 'Acme kickoff', { isRead: true }),
    msg('3', 'Acme invoice'),
    msg('4', 'Lunch?'),
    msg('5', 'Invoice from the past', { folderId: 'sent' }),
  ];

  it('reports scanned, matched, multi-branch and unmatched counts for the chosen folders only', () => {
    const { matches, report } = scanMessages(messages, tree(), SETTINGS, 1000);
    expect(report).toMatchObject({ scanned: 4, matched: 3, multiBranch: 1, unmatched: 1, applied: false, scannedAt: 1000 });
    expect(Object.keys(matches).sort()).toEqual(['1', '2', '3']);
  });

  it('tallies counts, unread and samples per node', () => {
    const { report } = scanMessages(messages, tree(), SETTINGS);
    const acme = report.nodes.find((n) => n.agendaId === 'acme');
    expect(acme).toMatchObject({ count: 2, unread: 1, samples: ['Acme kickoff', 'Acme invoice'] });
  });
});

describe('suggestKeywords', () => {
  it('offers frequent subject words that are not stopwords, numbers or already used', () => {
    const messages = [msg('1', 'Payroll for March'), msg('2', 'Payroll update 2026'), msg('3', 'Invoice payroll'), msg('4', 'Meeting notes'), msg('5', 'Meeting moved')];
    expect(suggestKeywords(messages, tree(), SETTINGS)).toEqual([
      { keyword: 'payroll', count: 3 },
      { keyword: 'meeting', count: 2 },
    ]);
  });
});

describe('sanitizeSorterSettings', () => {
  it('drops unknown values and falls back to safe defaults', () => {
    expect(sanitizeSorterSettings({ folders: ['../etc', 'inbox', 'inbox'] as string[], fields: [], matchMode: 'regex' as 'word', autoRun: 'yes' as unknown as boolean })).toEqual({
      folders: ['inbox'],
      fields: ['subject'],
      matchMode: 'word',
      autoRun: false,
    });
  });
});
