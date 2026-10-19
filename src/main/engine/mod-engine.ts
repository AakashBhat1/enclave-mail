import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ModRule } from '../../renderer/types/index';
import { isJsonArray, readJsonSafe, writeFileAtomic, writeJsonAtomic } from './atomic-file';
import { isInsideExportRoot, validateModRule, EXPORT_ROOT, type MarkdownExport } from './mod-rules';

export { EXPORT_ROOT, planMods, resolveExportDir, validateModRule } from './mod-rules';
export type { MarkdownExport, ModPlan, PlanOptions } from './mod-rules';

const BASE_DIR = path.join(os.homedir(), '.enclavemail');
const MODS_FILE = path.join(BASE_DIR, 'mods', 'rules.json');

const DEFAULT_RULES: ModRule[] = [
  {
    id: 'rule_invoice_autofiler',
    name: 'Auto-File Finance Invoices & Receipts',
    enabled: true,
    providerId: 'all',
    condition: { field: 'subject', operator: 'contains', value: 'Invoice' },
    action: { type: 'applyTag', targetValue: 'Tax-Deductible' },
  },
  {
    id: 'rule_devops_tagger',
    name: 'GitHub & CI/CD Fast Tagger',
    enabled: true,
    providerId: 'all',
    condition: { field: 'from', operator: 'contains', value: 'github.com' },
    action: { type: 'applyTag', targetValue: 'DevOps-Pipeline' },
  },
  {
    id: 'rule_markdown_sync',
    name: 'Export Technical Newsletters to Markdown Notes',
    enabled: true,
    providerId: 'all',
    condition: { field: 'subject', operator: 'contains', value: 'Pragmatic' },
    action: { type: 'exportMarkdown', targetValue: 'Notes/TechReadings' },
  },
];

function validOrNull(rule: unknown): ModRule | null {
  try {
    return validateModRule(rule);
  } catch (err) {
    console.error('Ignoring an invalid mod rule:', err instanceof Error ? err.message : err);
    return null;
  }
}

function idOf(entry: unknown): string | undefined {
  const id = typeof entry === 'object' && entry !== null ? (entry as { id?: unknown }).id : undefined;
  return typeof id === 'string' ? id : undefined;
}

function isLink(file: string): boolean {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}

function refuseLink(target: string): never {
  throw new Error(`Refusing to write through ${target}: it is a link that could lead outside the export folder.`);
}

// Creates the folder one level at a time from the root and refuses any link (symlink or junction) on the
// way, so nothing is ever created or written outside, even as an empty folder
function ensureExportFolder(dir: string, realRoot: string): void {
  let current = EXPORT_ROOT;
  for (const segment of path.relative(EXPORT_ROOT, dir).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (isLink(current)) refuseLink(current);
    if (!fs.existsSync(current)) fs.mkdirSync(current);
  }
  // Backstop for anything lstat cannot see as a link
  if (!isInsideExportRoot(fs.realpathSync(dir), realRoot)) refuseLink(dir);
}

/** Keeps the rule list on disk; what the rules do to a letter is worked out by planMods. */
export class ModEngine {
  constructor() {
    if (!fs.existsSync(MODS_FILE)) writeJsonAtomic(MODS_FILE, DEFAULT_RULES, { space: 2 });
  }

  // Entries this version cannot read (hand-edited, or from a newer version) are kept on every write
  private readRaw(): unknown[] {
    return readJsonSafe<unknown[]>(MODS_FILE, [], isJsonArray);
  }

  /** Every rule on disk that still passes validation (a hand-edited file can't smuggle in a bad export). */
  public getRules(): ModRule[] {
    return this.readRaw()
      .map(validOrNull)
      .filter((rule): rule is ModRule => rule !== null);
  }

  public toggleRule(ruleId: string): boolean {
    const raw = this.readRaw();
    const target = this.getRules().find((r) => r.id === ruleId);
    if (!target) return false;
    const enabled = !target.enabled;
    writeJsonAtomic(MODS_FILE, raw.map((entry) => (idOf(entry) === ruleId ? { ...target, enabled } : entry)), { space: 2 });
    return enabled;
  }

  /** Validates, then adds or replaces the rule; an invalid rule throws and nothing is written. */
  public saveRule(input: unknown): ModRule {
    const rule = validateModRule(input);
    const raw = this.readRaw();
    const next = raw.some((entry) => idOf(entry) === rule.id) ? raw.map((entry) => (idOf(entry) === rule.id ? rule : entry)) : [...raw, rule];
    writeJsonAtomic(MODS_FILE, next, { space: 2 });
    return rule;
  }

  /** Writes planned Markdown exports and returns their paths; anything outside EXPORT_ROOT is refused. */
  public writeExports(exports: readonly MarkdownExport[]): string[] {
    const outside = exports.find((e) => !isInsideExportRoot(e.file));
    if (outside) throw new Error(`Refusing to write ${outside.file}: it is not inside the export folder ${EXPORT_ROOT}.`);
    if (exports.length === 0) return [];
    fs.mkdirSync(EXPORT_ROOT, { recursive: true });
    const realRoot = fs.realpathSync(EXPORT_ROOT);
    for (const { file, content } of exports) {
      ensureExportFolder(path.dirname(file), realRoot);
      if (isLink(file) || isLink(`${file}.tmp`)) refuseLink(file);
      writeFileAtomic(file, content, { backup: false });
    }
    return exports.map((e) => e.file);
  }
}
