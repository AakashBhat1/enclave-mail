import type { ToastInput } from '../components/ui/Toast';
import type { StorageRecoveryNotice } from '../types/index';

const LABELS: Record<string, string> = {
  'messages.json': 'Your message list',
  'providers.json': 'Your account list',
  'folders.json': 'Your folder counts',
  'associations.json': 'Your association tree',
  'tree-sorter.json': 'The Tree Sorter settings',
  'trusted-senders.json': 'Your trusted senders',
  'rules.json': 'Your mod rules',
};

// Only the message list comes back from the server; everything else was the user's own work
const REFILLED_BY_SYNC = new Set(['messages.json', 'folders.json']);

/** The toast shown when the main process had to repair a damaged data file. */
export function recoveryToast({ file, outcome }: StorageRecoveryNotice): ToastInput {
  const label = LABELS[file] ?? `The file ${file}`;
  if (outcome === 'restored') {
    return {
      tone: 'info',
      title: 'Recovered a damaged file',
      description: `${label} was damaged, probably by a crash. The last good copy is back in place.`,
    };
  }
  const next = REFILLED_BY_SYNC.has(file) ? 'The next sync fills it in again.' : 'It starts empty from now on.';
  return {
    tone: 'error',
    title: 'Could not recover a damaged file',
    description: `${label} was unreadable and had no good backup. The damaged copy was set aside in the data folder. ${next}`,
  };
}
