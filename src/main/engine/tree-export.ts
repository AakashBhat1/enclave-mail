import type { AgendaNode, AssociationNode, EmailMessage } from '../../renderer/types/index';

// Pure helpers only (type imports): the export/import format for "let an AI design my tree"

export const EXPORT_FORMAT = 'enclave-mail-export/v1';
export const TREE_FORMAT = 'enclave-tree/v1';

const MAX_BRANCHES = 100;
const MAX_CHILDREN = 100;
const MAX_KEYWORDS = 50;
const MAX_NAME = 80;
const MAX_KEYWORD = 80;
const CATEGORIES: AgendaNode['category'][] = ['project', 'financial', 'operations', 'legal', 'custom'];

export interface ImportedChild {
  name: string;
  keywords: string[];
  category: AgendaNode['category'];
}

export interface ImportedBranch {
  name: string;
  icon?: string;
  keywords: string[];
  children: ImportedChild[];
}

interface ExportedMessage {
  id: string;
  folder: string;
  date: string;
  fromName: string;
  fromAddress: string;
  to: string;
  subject: string;
  preview: string;
  read: boolean;
  starred: boolean;
  attachments: number;
}

export interface MailExport {
  format: typeof EXPORT_FORMAT;
  exportedAt: string;
  account: string;
  instructions: string;
  matchingRules: string[];
  expectedOutput: { format: typeof TREE_FORMAT; branches: ImportedBranch[] };
  currentTree: ImportedBranch[];
  stats: { messages: number; byFolder: Record<string, number> };
  messages: ExportedMessage[];
}

const INSTRUCTIONS = [
  'You are helping organise one email account into a two-level tree of branches and sub-branches.',
  'Read every message below (mainly subject, sender and preview), find the real recurring themes, clients, projects, vendors and',
  'kinds of mail, and design a tree that would file them well. For every branch and sub-branch give the keywords the app should',
  'match. Prefer specific, distinctive words and phrases taken from the actual subjects/senders over generic ones. Use "-word" to',
  'exclude noise (e.g. "-newsletter"). It is fine and expected that one message matches several branches.',
  'Reply with ONLY a JSON object in exactly the shape of "expectedOutput" (format "enclave-tree/v1"), no prose around it.',
  'Keep currentTree branch names where they still make sense, so the import merges into them instead of duplicating.',
].join(' ');

const MATCHING_RULES = [
  'Keywords are case-insensitive.',
  'Default match is word-start: "invoice" matches "Invoices" and "#invoice-42" but not "reinvoice".',
  'By default only the subject is checked; the user can also turn on sender (name + address) and preview text.',
  'A keyword starting with "-" excludes: a message mentioning it is kept out of that branch. A branch exclusion also applies to its sub-branches.',
  'A message is filed into EVERY branch and sub-branch whose keywords it matches.',
  'A branch with no keywords of its own only groups its sub-branches.',
  'Sender keywords work well for domains, e.g. "acme.com" (needs the sender field on).',
];

const EXAMPLE_OUTPUT: ImportedBranch[] = [
  {
    name: 'Clients',
    icon: '🤝',
    keywords: [],
    children: [
      { name: 'Acme', category: 'project', keywords: ['acme', 'acme corp'] },
      { name: 'Globex', category: 'project', keywords: ['globex'] },
    ],
  },
  { name: 'Finance', icon: '💰', keywords: ['invoice', 'receipt', 'payment', '-newsletter'], children: [{ name: 'Tax', category: 'financial', keywords: ['gst', 'tds'] }] },
];

function treeOf(associations: AssociationNode[]): ImportedBranch[] {
  return associations.map((a) => ({
    name: a.name,
    icon: a.icon,
    keywords: a.keywords ?? [],
    children: a.agendas.map((ag) => ({ name: ag.name, category: ag.category, keywords: ag.keywords ?? [] })),
  }));
}

export function buildMailExport(account: string, messages: EmailMessage[], associations: AssociationNode[], now = new Date()): MailExport {
  const rows = [...messages]
    .filter((m) => m.folderId !== 'drafts')
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
    .map(
      (m): ExportedMessage => ({
        id: m.id,
        folder: m.folderId,
        date: m.timestamp ? new Date(m.timestamp).toISOString() : m.date,
        fromName: m.from.name,
        fromAddress: m.from.address,
        to: m.to.map((t) => t.address || t.name).join(', '),
        subject: m.subject,
        preview: m.snippet,
        read: m.isRead,
        starred: m.isStarred,
        attachments: m.attachments.length,
      })
    );
  const byFolder = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.folder]: (acc[r.folder] ?? 0) + 1 }), {});
  return {
    format: EXPORT_FORMAT,
    exportedAt: now.toISOString(),
    account,
    instructions: INSTRUCTIONS,
    matchingRules: MATCHING_RULES,
    expectedOutput: { format: TREE_FORMAT, branches: EXAMPLE_OUTPUT },
    currentTree: treeOf(associations),
    stats: { messages: rows.length, byFolder },
    messages: rows,
  };
}

function csvCell(value: string | number | boolean): string {
  const text = String(value);
  // Leading = + - @ would run as a formula in Excel; a quote prefix keeps it plain text
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Spreadsheet-friendly version of the same list (no instructions; use the JSON for an AI). */
export function toCsv(data: MailExport): string {
  const header = ['date', 'folder', 'fromName', 'fromAddress', 'subject', 'preview', 'read', 'starred', 'attachments'];
  const lines = data.messages.map((m) =>
    [m.date, m.folder, m.fromName, m.fromAddress, m.subject, m.preview, m.read, m.starred, m.attachments].map(csvCell).join(',')
  );
  // BOM so Excel opens UTF-8 (Hindi names, emoji) correctly
  return `﻿${header.join(',')}\r\n${lines.join('\r\n')}\r\n`;
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function keywordsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((k) => text(k, MAX_KEYWORD).toLowerCase()).filter((k) => k.replace(/^-/, '').trim().length > 0).slice(0, MAX_KEYWORDS);
}

/** Pulls the JSON object out of an AI reply, tolerating a ```json fence or prose around it. */
export function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object found in the file.');
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new Error('The file is not valid JSON.');
  }
}

/**
 * Validates an AI-made tree. Accepts {format, branches}, {expectedOutput:{branches}}, or a bare
 * branches array; drops anything malformed rather than trusting the file.
 */
export function parseTreeImport(input: unknown): ImportedBranch[] {
  const root = input as { branches?: unknown; expectedOutput?: { branches?: unknown }; tree?: { branches?: unknown } } | unknown[];
  const list = Array.isArray(root) ? root : root?.branches ?? root?.tree?.branches ?? root?.expectedOutput?.branches;
  if (!Array.isArray(list)) throw new Error('Expected a "branches" list (format enclave-tree/v1).');

  const branches = list.slice(0, MAX_BRANCHES).flatMap((b): ImportedBranch[] => {
    const node = b as { name?: unknown; icon?: unknown; keywords?: unknown; children?: unknown };
    const name = text(node?.name, MAX_NAME);
    if (!name) return [];
    const children = (Array.isArray(node.children) ? node.children : []).slice(0, MAX_CHILDREN).flatMap((c): ImportedChild[] => {
      const child = c as { name?: unknown; keywords?: unknown; category?: unknown };
      const childName = text(child?.name, MAX_NAME);
      if (!childName) return [];
      const category = CATEGORIES.includes(child.category as AgendaNode['category']) ? (child.category as AgendaNode['category']) : 'custom';
      return [{ name: childName, category, keywords: keywordsOf(child.keywords) }];
    });
    const icon = text(node.icon, 8) || undefined;
    return [{ name, icon, keywords: keywordsOf(node.keywords), children }];
  });
  if (branches.length === 0) throw new Error('The file has no usable branches.');
  return branches;
}
