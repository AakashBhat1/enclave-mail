// Shared by the main process and the UI, so both agree on which views keep a hand-made order
const MAIL_FOLDERS = new Set(['inbox', 'starred', 'sent', 'drafts', 'archive']);

export function isSenderFilterId(filterId: string): boolean {
  return filterId.startsWith('sender:') || filterId.startsWith('domain:');
}

/**
 * Mail folders and People are strictly newest first, so new mail always lands on top.
 * Hand ordering (the ↑/↓ arrows) belongs to custom places: Tree associations and agendas.
 */
export function isReorderableFilter(filterId: string): boolean {
  return !MAIL_FOLDERS.has(filterId) && !isSenderFilterId(filterId);
}
