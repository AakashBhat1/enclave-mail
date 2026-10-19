import type { EmailMessage } from '../../renderer/types/index';
import type { ModEngine } from './mod-engine';
import { planMods } from './mod-rules';
import type { StorageService } from './storage-service';

export interface ModRunResult {
  appliedMods: string[];
  tagsAdded: string[];
  /** Markdown files written under the export root. */
  exported: string[];
}

/**
 * "Run mod" on one open letter: every enabled rule, or only `modId` when given (null/undefined = all).
 * Tags are saved first, so a failed export never loses them.
 */
export function runModsOnEmail(storage: StorageService, engine: ModEngine, providerId: string, emailId: string, modId?: string | null): ModRunResult {
  // A malformed id must not quietly widen into "run everything, exports included"
  if (modId !== undefined && modId !== null && (typeof modId !== 'string' || !modId)) throw new Error('Invalid mod id.');
  if (typeof emailId !== 'string') throw new Error('Email not found.');
  const email = storage.getEmailDetail(providerId, emailId);
  if (!email) throw new Error('Email not found.');

  const plan = planMods(email, engine.getRules(), { modId: modId ?? undefined });
  if (plan.addTags.length > 0) storage.applyModTags(providerId, new Map([[email.id, plan.addTags]]));
  try {
    const exported = engine.writeExports(plan.exports);
    return { appliedMods: plan.appliedMods, tagsAdded: plan.addTags, exported };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(plan.addTags.length > 0 ? `Tags were applied, but the note could not be saved: ${reason}` : reason);
  }
}

/**
 * Adds tags from the enabled tag rules to letters that are about to be stored, so tagging costs no extra
 * write and the downloaded bodies are still at hand. Never exports. Returns the same array when nothing changed.
 */
export function tagNewMail(engine: ModEngine, incoming: EmailMessage[]): EmailMessage[] {
  const rules = engine.getRules().filter((rule) => rule.enabled && rule.action.type === 'applyTag');
  if (rules.length === 0 || incoming.length === 0) return incoming;
  let changed = false;
  const tagged = incoming.map((email) => {
    const { addTags } = planMods(email, rules, { automatic: true });
    if (addTags.length === 0) return email;
    changed = true;
    return { ...email, tags: [...email.tags, ...addTags] };
  });
  return changed ? tagged : incoming;
}
