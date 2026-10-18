import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ModRule, EmailMessage } from '../../renderer/types/index';

const BASE_DIR = path.join(os.homedir(), '.enclavemail');
const MODS_FILE = path.join(BASE_DIR, 'mods', 'rules.json');
const INVOICES_EXPORT_DIR = path.join(os.homedir(), 'Downloads', 'EnclaveInvoices');

export class ModEngine {
  constructor() {
    this.ensureModsFile();
  }

  private ensureModsFile() {
    if (!fs.existsSync(path.dirname(MODS_FILE))) {
      fs.mkdirSync(path.dirname(MODS_FILE), { recursive: true });
    }
    if (!fs.existsSync(MODS_FILE)) {
      const defaultRules: ModRule[] = [
        {
          id: 'rule_invoice_autofiler',
          name: 'Auto-File Finance Invoices & Receipts',
          enabled: true,
          providerId: 'all',
          condition: {
            field: 'subject',
            operator: 'contains',
            value: 'Invoice',
          },
          action: {
            type: 'applyTag',
            targetValue: 'Tax-Deductible',
          },
        },
        {
          id: 'rule_devops_tagger',
          name: 'GitHub & CI/CD Fast Tagger',
          enabled: true,
          providerId: 'all',
          condition: {
            field: 'from',
            operator: 'contains',
            value: 'github.com',
          },
          action: {
            type: 'applyTag',
            targetValue: 'DevOps-Pipeline',
          },
        },
        {
          id: 'rule_markdown_sync',
          name: 'Export Technical Newsletters to Markdown Notes',
          enabled: true,
          providerId: 'all',
          condition: {
            field: 'subject',
            operator: 'contains',
            value: 'Pragmatic',
          },
          action: {
            type: 'exportMarkdown',
            targetValue: 'Notes/TechReadings',
          },
        },
      ];
      fs.writeFileSync(MODS_FILE, JSON.stringify(defaultRules, null, 2), 'utf-8');
    }
  }

  public getRules(): ModRule[] {
    if (!fs.existsSync(MODS_FILE)) return [];
    return JSON.parse(fs.readFileSync(MODS_FILE, 'utf-8'));
  }

  public toggleRule(ruleId: string): boolean {
    const rules = this.getRules();
    const r = rules.find((x) => x.id === ruleId);
    if (r) {
      r.enabled = !r.enabled;
      fs.writeFileSync(MODS_FILE, JSON.stringify(rules, null, 2), 'utf-8');
      return r.enabled;
    }
    return false;
  }

  public saveRule(rule: ModRule): ModRule {
    const rules = this.getRules();
    const idx = rules.findIndex((r) => r.id === rule.id);
    if (idx >= 0) {
      rules[idx] = rule;
    } else {
      rules.push(rule);
    }
    fs.writeFileSync(MODS_FILE, JSON.stringify(rules, null, 2), 'utf-8');
    return rule;
  }

  public executeModsOnEmail(email: EmailMessage): { appliedMods: string[]; modifiedEmail: EmailMessage } {
    const rules = this.getRules().filter((r) => r.enabled);
    const applied: string[] = [];

    for (const rule of rules) {
      if (rule.providerId !== 'all' && rule.providerId !== email.providerId) {
        continue;
      }

      let match = false;
      const targetStr =
        rule.condition.field === 'subject'
          ? email.subject
          : rule.condition.field === 'from'
          ? email.from.address
          : email.snippet;

      const testVal = rule.condition.value.toLowerCase();
      const content = targetStr.toLowerCase();

      if (rule.condition.operator === 'contains' && content.includes(testVal)) {
        match = true;
      } else if (rule.condition.operator === 'equals' && content === testVal) {
        match = true;
      } else if (rule.condition.operator === 'startsWith' && content.startsWith(testVal)) {
        match = true;
      }

      if (match) {
        applied.push(rule.name);
        if (rule.action.type === 'applyTag') {
          if (!email.tags.includes(rule.action.targetValue)) {
            email.tags.push(rule.action.targetValue);
          }
        } else if (rule.action.type === 'moveToFolder') {
          email.folderId = rule.action.targetValue;
        } else if (rule.action.type === 'exportMarkdown') {
          // Export email body to local markdown file
          try {
            const exportFolder = path.join(os.homedir(), rule.action.targetValue);
            fs.mkdirSync(exportFolder, { recursive: true });
            const sanitizedTitle = email.subject.replace(/[^a-zA-Z0-9_-]/g, '_');
            const mdFile = path.join(exportFolder, `${sanitizedTitle}.md`);
            const mdContent = `# ${email.subject}\n\n**From:** ${email.from.name} (${email.from.address})\n**Date:** ${email.date}\n\n---\n\n${email.bodyText || email.snippet}\n`;
            fs.writeFileSync(mdFile, mdContent, 'utf-8');
          } catch (e) {
            console.error('Failed to export markdown:', e);
          }
        }
      }
    }

    return { appliedMods: applied, modifiedEmail: email };
  }
}
