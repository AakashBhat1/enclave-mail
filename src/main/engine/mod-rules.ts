import path from 'node:path';
import os from 'node:os';
import type { EmailMessage, ModRule } from '../../renderer/types/index';

/** Markdown exports land here and nowhere else, whatever a rule asks for. */
export const EXPORT_ROOT = path.join(os.homedir(), 'EnclaveMail', 'exports');

const RULE_ID = /^[\w-]{1,64}$/;
const ACCOUNT_ID = /^[\w-]{1,128}$/;
const MAX_NAME = 80;
const MAX_TEXT = 200;
const MAX_FILE_STEM = 100;
const FIELDS = ['subject', 'from', 'body'] as const;
const OPERATORS = ['contains', 'equals', 'startsWith'] as const;
const ACTIONS = ['applyTag', 'exportMarkdown'] as const;
// "C:", "C:\x" and "C:x" all leave the export root on Windows, even though path.isAbsolute misses the last
const DRIVE_PREFIX = /^[a-zA-Z]:/;
const MAX_SEGMENT = 80;
// Characters Windows refuses in names (":" would also open an alternate data stream)
const BAD_SEGMENT_CHARS = /[<>:"|?*\x00-\x1f]/;
// Windows strips trailing dots and spaces, so "x." and "x" would differ for Node but not for the disk
const TRAILING_DOT_OR_SPACE = /[. ]$/;
// Device names stay devices whatever extension follows ("nul.txt")
const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

function isSafeSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment.length <= MAX_SEGMENT &&
    !BAD_SEGMENT_CHARS.test(segment) &&
    !TRAILING_DOT_OR_SPACE.test(segment) &&
    !RESERVED_NAME.test(segment)
  );
}

export interface MarkdownExport {
  file: string;
  content: string;
}

export interface ModPlan {
  appliedMods: string[];
  /** Tags the letter does not have yet, in rule order. */
  addTags: string[];
  exports: MarkdownExport[];
}

export interface PlanOptions {
  /** Run only this rule (by id) instead of every enabled one. */
  modId?: string;
  /** Mail arriving in the background: tag only, never write files. */
  automatic?: boolean;
}

// Inside means the relative path does not climb out; "..notes" is a folder name, not a climb
function staysInside(root: string, target: string): boolean {
  const inside = path.relative(root, target);
  return !!inside && inside !== '..' && !inside.startsWith(`..${path.sep}`) && !path.isAbsolute(inside);
}

/** Resolves a rule's export folder under EXPORT_ROOT, or throws if it would land anywhere else. */
export function resolveExportDir(target: string): string {
  const relative = typeof target === 'string' ? target.trim() : '';
  const invalid = () => new Error(`"${String(target).slice(0, 40)}" is not a valid export folder. Use a folder inside ${EXPORT_ROOT}.`);
  if (!relative || relative.length > MAX_TEXT || path.isAbsolute(relative) || DRIVE_PREFIX.test(relative)) throw invalid();
  // Segment by segment, so "..notes" is fine while "..", ".", "x." and "nul" are not
  if (!relative.split(/[\\/]+/).every(isSafeSegment)) throw invalid();
  const resolved = path.resolve(EXPORT_ROOT, relative);
  if (!staysInside(EXPORT_ROOT, resolved)) throw invalid();
  return resolved;
}

/** True when `file` sits inside `root` (EXPORT_ROOT by default) by path; links are checked when writing. */
export function isInsideExportRoot(file: string, root: string = EXPORT_ROOT): boolean {
  return staysInside(root, path.resolve(file));
}

function text(value: unknown, what: string, max: number): string {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (!clean) throw new Error(`The rule needs ${what}.`);
  if (clean.length > max) throw new Error(`The rule's ${what} is longer than ${max} characters.`);
  return clean;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`Unsupported ${what}: ${String(value).slice(0, 40)}.`);
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`The rule's ${what} is missing.`);
  return value as Record<string, unknown>;
}

/** Checks a rule from the renderer or from disk and returns a clean copy; throws a readable error otherwise. */
export function validateModRule(input: unknown): ModRule {
  const raw = asRecord(input, 'definition');
  const condition = asRecord(raw.condition, 'condition');
  const action = asRecord(raw.action, 'action');

  if (typeof raw.id !== 'string' || !RULE_ID.test(raw.id)) throw new Error('The rule id is invalid.');
  if (typeof raw.enabled !== 'boolean') throw new Error('The rule must be on or off.');
  const providerId = raw.providerId ?? 'all';
  if (providerId !== 'all' && (typeof providerId !== 'string' || !ACCOUNT_ID.test(providerId))) throw new Error('The rule account is invalid.');

  const type = oneOf(action.type, ACTIONS, 'action');
  const targetValue = text(action.targetValue, type === 'applyTag' ? 'a tag' : 'an export folder', MAX_TEXT);
  if (type === 'exportMarkdown') resolveExportDir(targetValue);

  return {
    id: raw.id,
    name: text(raw.name, 'a name', MAX_NAME),
    enabled: raw.enabled,
    providerId,
    condition: {
      field: oneOf(condition.field, FIELDS, 'field'),
      operator: oneOf(condition.operator, OPERATORS, 'condition'),
      value: text(condition.value, 'something to look for', MAX_TEXT),
    },
    action: { type, targetValue },
  };
}

function fieldText(email: EmailMessage, field: ModRule['condition']['field']): string {
  if (field === 'subject') return email.subject ?? '';
  if (field === 'from') return email.from?.address ?? '';
  return email.bodyText ?? email.snippet ?? '';
}

function matches(rule: ModRule, email: EmailMessage): boolean {
  const content = fieldText(email, rule.condition.field).toLowerCase();
  const wanted = rule.condition.value.toLowerCase();
  if (rule.condition.operator === 'equals') return content === wanted;
  if (rule.condition.operator === 'startsWith') return content.startsWith(wanted);
  return content.includes(wanted);
}

function markdownFor(email: EmailMessage, folder: string): MarkdownExport {
  const title = email.subject.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, MAX_FILE_STEM) || 'untitled';
  // The letter id keeps two letters with similar (or non-Latin) subjects apart, and means no name is ever
  // a bare Windows device name; exporting the same letter again just refreshes its note
  const stem = `${title}--${email.id.replace(/[^\w-]/g, '_')}`;
  const content = `# ${email.subject}\n\n**From:** ${email.from.name} (${email.from.address})\n**Date:** ${email.date}\n\n---\n\n${email.bodyText || email.snippet}\n`;
  return { file: path.join(folder, `${stem}.md`), content };
}

/** Works out what the rules would do to one letter. Pure: the letter and the rules are never changed. */
export function planMods(email: EmailMessage, rules: readonly ModRule[], { modId, automatic = false }: PlanOptions = {}): ModPlan {
  const selected = rules.filter(
    (rule) =>
      (modId ? rule.id === modId : rule.enabled) &&
      (rule.providerId === 'all' || rule.providerId === email.providerId) &&
      !(automatic && rule.action.type === 'exportMarkdown')
  );
  const plan: ModPlan = { appliedMods: [], addTags: [], exports: [] };
  const tags = new Set(email.tags);
  for (const rule of selected) {
    if (!matches(rule, email)) continue;
    plan.appliedMods.push(rule.name);
    if (rule.action.type === 'applyTag') {
      if (!tags.has(rule.action.targetValue)) plan.addTags.push(rule.action.targetValue);
      tags.add(rule.action.targetValue);
    } else {
      plan.exports.push(markdownFor(email, resolveExportDir(rule.action.targetValue)));
    }
  }
  return plan;
}
