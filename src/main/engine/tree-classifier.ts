import type {
  AssociationNode,
  EmailMessage,
  KeywordSuggestion,
  TreeMatch,
  TreeScanNodeResult,
  TreeScanReport,
  TreeSorterSettings,
} from '../../renderer/types/index';

const SAMPLE_LIMIT = 3;
const MAX_KEYWORD_LENGTH = 80;
const MIN_SUGGESTION_LENGTH = 4;
const MIN_SUGGESTION_COUNT = 2;

// Words that show up in every inbox and say nothing about what a letter is for
const STOPWORDS = new Set(
  (
    'this that with from your have will what when where which about there their them they then than these those ' +
    'been were here just more only some such into over after before very also please thanks thank hello dear ' +
    'regards update updates info information today tomorrow week weekly month monthly year your yours ours ' +
    're fwd fw sent reply message mail email letter news notification notifications reminder important ' +
    'new now get got can could would should may might must does done make made need needs want wants ' +
    'how why who all any not out off our you are was has had its it’s let’s'
  ).split(' ')
);

export const DEFAULT_SORTER_SETTINGS: TreeSorterSettings = {
  folders: ['inbox'],
  fields: ['subject'],
  matchMode: 'word',
  autoRun: false,
};

type Matcher = (haystack: string) => boolean;

interface KeywordSet {
  include: Array<{ keyword: string; test: Matcher }>;
  exclude: Matcher[];
}

interface CompiledNode {
  associationId: string;
  agendaId?: string;
  keywords: KeywordSet;
  /** Exclusions inherited from the parent association. */
  inheritedExclude: Matcher[];
}

export type ClassifiableMessage = Pick<EmailMessage, 'id' | 'folderId' | 'subject' | 'from' | 'snippet' | 'isRead'>;

/** Trim, lowercase, drop blanks and duplicates; a leading "-" marks an exclusion and is kept. */
export function normalizeKeywords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const cleaned = raw
    .filter((k): k is string => typeof k === 'string')
    .map((k) => k.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, MAX_KEYWORD_LENGTH))
    .filter((k) => k.replace(/^-/, '').trim().length > 0);
  return [...new Set(cleaned)];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMatcher(keyword: string, mode: TreeSorterSettings['matchMode']): Matcher {
  if (mode === 'anywhere') return (haystack) => haystack.includes(keyword);
  // Word-start: "invoice" hits "Invoices" and "#invoice-42" but not "reinvoice"
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(keyword)}`, 'u');
  return (haystack) => pattern.test(haystack);
}

function compileKeywords(raw: string[] | undefined, mode: TreeSorterSettings['matchMode']): KeywordSet {
  const include: KeywordSet['include'] = [];
  const exclude: Matcher[] = [];
  for (const keyword of normalizeKeywords(raw)) {
    if (keyword.startsWith('-')) exclude.push(buildMatcher(keyword.slice(1).trim(), mode));
    else include.push({ keyword, test: buildMatcher(keyword, mode) });
  }
  return { include, exclude };
}

export function compileTree(associations: AssociationNode[], settings: TreeSorterSettings): CompiledNode[] {
  return associations.flatMap((assoc) => {
    const own = compileKeywords(assoc.keywords, settings.matchMode);
    const children = assoc.agendas.map(
      (agenda): CompiledNode => ({
        associationId: assoc.id,
        agendaId: agenda.id,
        keywords: compileKeywords(agenda.keywords, settings.matchMode),
        inheritedExclude: own.exclude,
      })
    );
    return [{ associationId: assoc.id, keywords: own, inheritedExclude: [] }, ...children];
  });
}

function haystackFor(message: ClassifiableMessage, fields: TreeSorterSettings['fields']): string {
  const parts = fields.map((field) => {
    if (field === 'subject') return message.subject;
    if (field === 'from') return `${message.from.name} ${message.from.address}`;
    return message.snippet;
  });
  return parts.join('\n').toLowerCase();
}

/** Every branch the message belongs to. A message can land in several branches at once. */
export function classifyMessage(message: ClassifiableMessage, compiled: CompiledNode[], settings: TreeSorterSettings): TreeMatch[] {
  const haystack = haystackFor(message, settings.fields);
  return compiled.flatMap((node): TreeMatch[] => {
    if (node.keywords.include.length === 0) return [];
    const excluded = [...node.inheritedExclude, ...node.keywords.exclude].some((test) => test(haystack));
    if (excluded) return [];
    const hit = node.keywords.include.find(({ test }) => test(haystack));
    if (!hit) return [];
    return [node.agendaId ? { associationId: node.associationId, agendaId: node.agendaId, keyword: hit.keyword } : { associationId: node.associationId, keyword: hit.keyword }];
  });
}

export interface TreeScanResult {
  matches: Record<string, TreeMatch[]>;
  report: TreeScanReport;
}

function nodeKey(associationId: string, agendaId?: string): string {
  return agendaId ? `${associationId}/${agendaId}` : associationId;
}

export function scanMessages(
  messages: ClassifiableMessage[],
  associations: AssociationNode[],
  settings: TreeSorterSettings,
  now = Date.now()
): TreeScanResult {
  const compiled = compileTree(associations, settings);
  const inScope = messages.filter((m) => settings.folders.includes(m.folderId));
  const tally = new Map<string, TreeScanNodeResult>(
    compiled.map((n) => [nodeKey(n.associationId, n.agendaId), { associationId: n.associationId, agendaId: n.agendaId, count: 0, unread: 0, samples: [] }])
  );

  const matches: Record<string, TreeMatch[]> = {};
  let multiBranch = 0;
  for (const message of inScope) {
    const found = classifyMessage(message, compiled, settings);
    if (found.length === 0) continue;
    matches[message.id] = found;
    // Branches, not nodes: a hit on an association and on one of its agendas is still one branch
    if (new Set(found.map((f) => f.associationId)).size > 1 || found.filter((f) => f.agendaId).length > 1) multiBranch++;
    for (const match of found) {
      const entry = tally.get(nodeKey(match.associationId, match.agendaId));
      if (!entry) continue;
      tally.set(nodeKey(match.associationId, match.agendaId), {
        ...entry,
        count: entry.count + 1,
        unread: entry.unread + (message.isRead ? 0 : 1),
        samples: entry.samples.length < SAMPLE_LIMIT ? [...entry.samples, message.subject] : entry.samples,
      });
    }
  }

  const matched = Object.keys(matches).length;
  return {
    matches,
    report: {
      scanned: inScope.length,
      matched,
      multiBranch,
      unmatched: inScope.length - matched,
      nodes: [...tally.values()],
      applied: false,
      scannedAt: now,
    },
  };
}

function usedKeywords(associations: AssociationNode[]): Set<string> {
  const all = associations.flatMap((a) => [...normalizeKeywords(a.keywords), ...a.agendas.flatMap((ag) => normalizeKeywords(ag.keywords))]);
  return new Set(all.map((k) => k.replace(/^-/, '').trim()));
}

/** The most common meaningful subject words in scope that no branch uses yet, so a tree can start from real mail. */
export function suggestKeywords(
  messages: ClassifiableMessage[],
  associations: AssociationNode[],
  settings: TreeSorterSettings,
  limit = 14
): KeywordSuggestion[] {
  const used = usedKeywords(associations);
  const frequency = new Map<string, number>();
  for (const message of messages) {
    if (!settings.folders.includes(message.folderId)) continue;
    // Count each word once per letter, so one noisy subject cannot dominate
    const words = new Set(message.subject.toLowerCase().split(/[^\p{L}\p{N}]+/u));
    words.forEach((word) => {
      if (word.length < MIN_SUGGESTION_LENGTH || /^\d+$/.test(word) || STOPWORDS.has(word) || used.has(word)) return;
      frequency.set(word, (frequency.get(word) ?? 0) + 1);
    });
  }
  return [...frequency.entries()]
    .filter(([, count]) => count >= MIN_SUGGESTION_COUNT)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([keyword, count]) => ({ keyword, count }));
}

/** Keep only settings values the classifier understands; the renderer is not trusted. */
export function sanitizeSorterSettings(input: Partial<TreeSorterSettings> | undefined): TreeSorterSettings {
  const folders = Array.isArray(input?.folders) ? input.folders.filter((f) => ['inbox', 'sent', 'drafts', 'archive'].includes(f)) : [];
  const fields = Array.isArray(input?.fields) ? input.fields.filter((f) => ['subject', 'from', 'snippet'].includes(f)) : [];
  return {
    folders: folders.length > 0 ? [...new Set(folders)] : DEFAULT_SORTER_SETTINGS.folders,
    fields: fields.length > 0 ? [...new Set(fields)] : DEFAULT_SORTER_SETTINGS.fields,
    matchMode: input?.matchMode === 'anywhere' ? 'anywhere' : 'word',
    autoRun: input?.autoRun === true,
  };
}
