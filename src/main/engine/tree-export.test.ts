import { describe, expect, it } from 'vitest';
import type { AssociationNode, EmailMessage } from '../../renderer/types/index';
import { buildMailExport, extractJson, parseTreeImport, toCsv } from './tree-export';

function mail(id: string, folderId: string, subject: string, timestamp: number): EmailMessage {
  return {
    id,
    providerId: 'p',
    folderId,
    from: { name: 'Ana', address: 'ana@acme.com' },
    to: [{ name: 'Me', address: 'me@x.io' }],
    subject,
    date: '',
    timestamp,
    snippet: 'preview',
    isRead: true,
    isStarred: false,
    tags: [],
    attachments: [],
  };
}

const TREE: AssociationNode[] = [
  { id: 'a', providerId: 'p', name: 'Finance', position: 1, keywords: ['invoice'], agendas: [{ id: 'g', name: 'Tax', category: 'financial', position: 1, unreadCount: 0, totalCount: 0, keywords: ['gst'] }] },
];

describe('buildMailExport', () => {
  it('lists every non-draft letter newest first, with instructions and the current tree', () => {
    const data = buildMailExport('me@x.io', [mail('1', 'inbox', 'Old', 1000), mail('2', 'sent', 'New', 5000), mail('3', 'drafts', 'Draft', 9000)], TREE);
    expect(data.messages.map((m) => m.subject)).toEqual(['New', 'Old']);
    expect(data.stats).toEqual({ messages: 2, byFolder: { sent: 1, inbox: 1 } });
    expect(data.instructions).toContain('enclave-tree/v1');
    expect(data.currentTree).toEqual([{ name: 'Finance', icon: undefined, keywords: ['invoice'], children: [{ name: 'Tax', category: 'financial', keywords: ['gst'] }] }]);
    // The example answer must itself be importable
    expect(parseTreeImport(data.expectedOutput)).toHaveLength(2);
  });
});

describe('toCsv', () => {
  it('quotes commas and quotes, and defuses spreadsheet formulas', () => {
    const data = buildMailExport('me@x.io', [mail('1', 'inbox', '=HYPERLINK("x"), hi', 1000)], []);
    const row = toCsv(data).split('\r\n')[1];
    expect(row).toContain(`"'=HYPERLINK(""x""), hi"`);
  });
});

describe('extractJson', () => {
  it('reads a JSON object wrapped in an AI reply with a code fence', () => {
    expect(extractJson('Here you go:\n```json\n{"branches": []}\n```\nEnjoy')).toEqual({ branches: [] });
  });

  it('explains when there is no JSON', () => {
    expect(() => extractJson('sorry, no idea')).toThrow('No JSON object');
  });
});

describe('parseTreeImport', () => {
  it('cleans names and keywords, defaults unknown categories, and drops nameless nodes', () => {
    const branches = parseTreeImport({
      format: 'enclave-tree/v1',
      branches: [
        { name: '  Clients ', keywords: [' Acme Corp ', '', 7, '-'], children: [{ name: 'Acme', category: 'weird', keywords: ['ACME'] }, { keywords: ['x'] }] },
        { keywords: ['orphan'] },
      ],
    });
    expect(branches).toEqual([{ name: 'Clients', icon: undefined, keywords: ['acme corp'], children: [{ name: 'Acme', category: 'custom', keywords: ['acme'] }] }]);
  });

  it('accepts a bare list of branches', () => {
    expect(parseTreeImport([{ name: 'Work', keywords: ['meeting'] }])).toHaveLength(1);
  });

  it('rejects files without branches', () => {
    expect(() => parseTreeImport({ hello: 1 })).toThrow('branches');
    expect(() => parseTreeImport({ branches: [{ nope: 1 }] })).toThrow('no usable branches');
  });
});
