import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessage, ModRule } from '../../renderer/types/index';

// The engine resolves ~/.enclavemail and the export root at import time, so point home at a throwaway folder first
const home = vi.hoisted(() => ({ dir: `${process.env.TEMP ?? process.env.TMPDIR ?? '/tmp'}/enclave-mods-test-${process.pid}` }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, default: { ...actual, homedir: () => home.dir } };
});

const { EXPORT_ROOT, ModEngine, planMods, resolveExportDir, validateModRule } = await import('./mod-engine');

const rulesFile = () => path.join(home.dir, '.enclavemail', 'mods', 'rules.json');

function letter(extra: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id: 'inbox_7_1',
    uid: 1,
    providerId: 'prov_a',
    folderId: 'inbox',
    from: { name: 'GitHub', address: 'noreply@github.com' },
    to: [{ name: 'Me', address: 'me@x.io' }],
    subject: 'Invoice #42 for October',
    date: 'Mon, 19 Oct 2026 09:00:00 GMT',
    timestamp: 1,
    snippet: 'Your invoice',
    bodyText: 'Amount due: 10 EUR',
    isRead: false,
    isStarred: false,
    tags: ['Existing'],
    attachments: [],
    ...extra,
  };
}

function rule(id: string, extra: Partial<ModRule> = {}): ModRule {
  return {
    id,
    name: `Rule ${id}`,
    enabled: true,
    providerId: 'all',
    condition: { field: 'subject', operator: 'contains', value: 'invoice' },
    action: { type: 'applyTag', targetValue: `Tag-${id}` },
    ...extra,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

beforeEach(() => {
  fs.rmSync(home.dir, { recursive: true, force: true });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => fs.rmSync(home.dir, { recursive: true, force: true }));

describe('planMods', () => {
  it('works out the new tags without touching the letter', () => {
    const email = deepFreeze(letter());
    const plan = planMods(email, [rule('a'), rule('b'), rule('dup', { action: { type: 'applyTag', targetValue: 'Existing' } })]);
    expect(plan.appliedMods).toEqual(['Rule a', 'Rule b', 'Rule dup']);
    expect(plan.addTags).toEqual(['Tag-a', 'Tag-b']);
    expect(email.tags).toEqual(['Existing']);
  });

  it('runs only the named rule when one is given', () => {
    const plan = planMods(letter(), [rule('a'), rule('b')], { modId: 'b' });
    expect(plan.appliedMods).toEqual(['Rule b']);
    expect(plan.addTags).toEqual(['Tag-b']);
  });

  it('skips disabled rules and rules for another account', () => {
    const plan = planMods(letter(), [rule('off', { enabled: false }), rule('other', { providerId: 'prov_b' }), rule('mine', { providerId: 'prov_a' })]);
    expect(plan.appliedMods).toEqual(['Rule mine']);
  });

  it('matches on sender and body as well as subject', () => {
    const rules = [
      rule('from', { condition: { field: 'from', operator: 'equals', value: 'NOREPLY@github.com' } }),
      rule('body', { condition: { field: 'body', operator: 'startsWith', value: 'amount due' } }),
      rule('miss', { condition: { field: 'subject', operator: 'startsWith', value: 'receipt' } }),
    ];
    expect(planMods(letter(), rules).appliedMods).toEqual(['Rule from', 'Rule body']);
  });

  it('names each note after its letter too, so different letters never overwrite each other', () => {
    const exporter = [rule('x', { condition: { field: 'from', operator: 'contains', value: 'github' }, action: { type: 'exportMarkdown', targetValue: 'Notes' } })];
    const a = planMods(letter({ id: 'inbox_7_1', subject: 'Счёт' }), exporter).exports[0].file;
    const b = planMods(letter({ id: 'inbox_7_2', subject: 'Счёт' }), exporter).exports[0].file;
    expect(a).not.toBe(b);
    // A subject that is a Windows device name still gets an ordinary file
    expect(path.basename(planMods(letter({ subject: 'CON' }), exporter).exports[0].file)).toBe('CON--inbox_7_1.md');
  });

  it('plans exports for a manual run and never for an automatic one', () => {
    const exporter = rule('x', { action: { type: 'exportMarkdown', targetValue: 'Notes/Tech' } });
    const manual = planMods(letter(), [exporter]);
    expect(manual.exports).toHaveLength(1);
    expect(manual.exports[0].file).toBe(path.join(EXPORT_ROOT, 'Notes', 'Tech', 'Invoice__42_for_October--inbox_7_1.md'));
    expect(manual.exports[0].content).toContain('Amount due: 10 EUR');

    const automatic = planMods(letter(), [exporter], { automatic: true });
    expect(automatic.exports).toEqual([]);
    expect(automatic.appliedMods).toEqual([]);
  });
});

describe('resolveExportDir', () => {
  it('keeps a relative folder inside the export root', () => {
    expect(resolveExportDir('Notes/Tech')).toBe(path.join(EXPORT_ROOT, 'Notes', 'Tech'));
  });

  it('allows names that merely start with dots', () => {
    expect(resolveExportDir('..notes/2026')).toBe(path.join(EXPORT_ROOT, '..notes', '2026'));
  });

  it.each([
    '../x', '..\\x', 'Notes/../../x', 'C:\\x', 'C:x', '/etc', '\\\\server\\share', '', '   ', 'a'.repeat(201),
    'notes:stream', 'Notes/.. ', 'Notes/x.', 'Notes/x /y', 'CON', 'Notes/nul.txt', 'com1', 'a<b', 'a|b', 'a?b', 'a*b', 'a"b', 'tab\there', './x',
  ])('refuses %j', (target) => {
    expect(() => resolveExportDir(target)).toThrow(/export folder/i);
  });
});

describe('validateModRule', () => {
  it('accepts a well-formed rule and trims its text', () => {
    const clean = validateModRule({ ...rule('ok'), name: '  Finance  ', condition: { field: 'subject', operator: 'contains', value: ' invoice ' } });
    expect(clean.name).toBe('Finance');
    expect(clean.condition.value).toBe('invoice');
  });

  it.each([
    ['not an object', 'rule'],
    ['a bad id', { ...rule('x'), id: '../evil' }],
    ['an empty name', { ...rule('x'), name: '   ' }],
    ['an unknown field', { ...rule('x'), condition: { field: 'headers', operator: 'contains', value: 'a' } }],
    ['an unknown operator', { ...rule('x'), condition: { field: 'subject', operator: 'regex', value: 'a' } }],
    ['an unknown action', { ...rule('x'), action: { type: 'runScript', targetValue: 'a' } }],
    ['a move action, which is not supported yet', { ...rule('x'), action: { type: 'moveToFolder', targetValue: 'archive' } }],
    ['an overlong target', { ...rule('x'), action: { type: 'applyTag', targetValue: 't'.repeat(201) } }],
    ['an export outside the root', { ...rule('x'), action: { type: 'exportMarkdown', targetValue: '../../Desktop' } }],
    ['a non-boolean enabled', { ...rule('x'), enabled: 'yes' }],
  ])('rejects %s', (_label, input) => {
    expect(() => validateModRule(input)).toThrow();
  });
});

describe('ModEngine', () => {
  it('saves only valid rules and leaves the file as it was otherwise', () => {
    const engine = new ModEngine();
    const before = fs.readFileSync(rulesFile(), 'utf-8');
    expect(() => engine.saveRule({ ...rule('bad'), action: { type: 'exportMarkdown', targetValue: '..\\..\\Windows' } })).toThrow(/export folder/i);
    expect(fs.readFileSync(rulesFile(), 'utf-8')).toBe(before);

    engine.saveRule(rule('good'));
    expect(engine.getRules().map((r) => r.id)).toContain('good');
  });

  it('ignores rules on disk that would not pass validation', () => {
    new ModEngine();
    fs.writeFileSync(rulesFile(), JSON.stringify([rule('fine'), { ...rule('evil'), action: { type: 'exportMarkdown', targetValue: '../../x' } }]));
    expect(new ModEngine().getRules().map((r) => r.id)).toEqual(['fine']);
  });

  it('keeps entries it could not read when saving or toggling others', () => {
    new ModEngine();
    const odd = { id: 'odd', name: 'From a newer version', enabled: true, providerId: 'all', condition: { field: 'headers' }, action: { type: 'runScript' } };
    fs.writeFileSync(rulesFile(), JSON.stringify([rule('t'), odd]));
    const engine = new ModEngine();
    engine.toggleRule('t');
    engine.saveRule(rule('new'));
    const onDisk = JSON.parse(fs.readFileSync(rulesFile(), 'utf-8')) as { id: string; enabled: boolean }[];
    expect(onDisk.map((r) => r.id)).toEqual(['t', 'odd', 'new']);
    expect(onDisk[0].enabled).toBe(false);
    expect(onDisk[1]).toEqual(odd);
  });

  it('refuses to write through a link inside the export root', () => {
    const outside = path.join(home.dir, 'outside');
    fs.mkdirSync(outside, { recursive: true });
    fs.mkdirSync(EXPORT_ROOT, { recursive: true });
    fs.symlinkSync(outside, path.join(EXPORT_ROOT, 'Notes'), 'junction');
    const engine = new ModEngine();
    const plan = planMods(letter(), [rule('x', { action: { type: 'exportMarkdown', targetValue: 'Notes/Tech' } })]);
    expect(() => engine.writeExports(plan.exports)).toThrow(/link/i);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('toggles a rule and reports the new state', () => {
    const engine = new ModEngine();
    engine.saveRule(rule('t'));
    expect(engine.toggleRule('t')).toBe(false);
    expect(engine.getRules().find((r) => r.id === 't')?.enabled).toBe(false);
    expect(engine.toggleRule('missing')).toBe(false);
  });

  it('writes planned exports under the export root only', () => {
    const engine = new ModEngine();
    const plan = planMods(letter(), [rule('x', { action: { type: 'exportMarkdown', targetValue: 'Notes/Tech' } })]);
    expect(engine.writeExports(plan.exports)).toEqual([path.join(EXPORT_ROOT, 'Notes', 'Tech', 'Invoice__42_for_October--inbox_7_1.md')]);
    expect(fs.readFileSync(plan.exports[0].file, 'utf-8')).toContain('# Invoice #42 for October');
    expect(() => engine.writeExports([{ file: path.join(home.dir, 'escaped.md'), content: 'x' }])).toThrow(/export folder/i);
    expect(fs.existsSync(path.join(home.dir, 'escaped.md'))).toBe(false);
  });
});
