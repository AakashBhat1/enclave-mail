import { contextBridge, ipcRenderer } from 'electron';
import type { AddAccountInput, ModRule, SendEmailInput, SenderGroupMode, SyncProgress, TreeSorterSettings } from '../renderer/types/index';

export const electronAPI = {
  // Provider Enclaves
  getProviders: () => ipcRenderer.invoke('get-providers'),
  addProvider: (input: AddAccountInput) => ipcRenderer.invoke('add-provider', input),
  syncProvider: (providerId: string) => ipcRenderer.invoke('sync-provider', providerId),
  removeProvider: (providerId: string) => ipcRenderer.invoke('remove-provider', providerId),

  // Folders & Messages
  getFolders: (providerId: string) => ipcRenderer.invoke('get-folders', providerId),
  getEmails: (providerId: string, folderId: string) => ipcRenderer.invoke('get-emails', providerId, folderId),
  getEmailDetail: (providerId: string, emailId: string) => ipcRenderer.invoke('get-email-detail', providerId, emailId),
  markEmailRead: (providerId: string, emailId: string, isRead: boolean) => ipcRenderer.invoke('mark-email-read', providerId, emailId, isRead),
  toggleStar: (providerId: string, emailId: string) => ipcRenderer.invoke('toggle-star', providerId, emailId),
  getTrustedSenders: (providerId: string) => ipcRenderer.invoke('get-trusted-senders', providerId),
  trustSender: (providerId: string, address: string) => ipcRenderer.invoke('trust-sender', providerId, address),

  // Association & Agenda Tree
  getAssociations: (providerId: string) => ipcRenderer.invoke('get-associations', providerId),
  reorderAssociations: (providerId: string, associationIds: string[]) => ipcRenderer.invoke('reorder-associations', providerId, associationIds),
  addAssociation: (providerId: string, name: string, icon?: string, withDefaultAgendas = true, keywords: string[] = []) =>
    ipcRenderer.invoke('add-association', providerId, name, icon, withDefaultAgendas, keywords),
  addAgenda: (providerId: string, associationId: string, name: string, category?: string, keywords: string[] = []) =>
    ipcRenderer.invoke('add-agenda', providerId, associationId, name, category, keywords),
  renameTreeNode: (providerId: string, nodeId: string, name: string) => ipcRenderer.invoke('rename-tree-node', providerId, nodeId, name),
  setNodeKeywords: (providerId: string, nodeId: string, keywords: string[]) => ipcRenderer.invoke('set-node-keywords', providerId, nodeId, keywords),
  deleteTreeNode: (providerId: string, nodeId: string) => ipcRenderer.invoke('delete-tree-node', providerId, nodeId),

  // Keyword Tree Sorter mod
  getTreeSorter: (providerId: string) => ipcRenderer.invoke('get-tree-sorter', providerId),
  saveTreeSorterSettings: (providerId: string, settings: Partial<TreeSorterSettings>) =>
    ipcRenderer.invoke('save-tree-sorter-settings', providerId, settings),
  runTreeSorter: (providerId: string, apply: boolean) => ipcRenderer.invoke('run-tree-sorter', providerId, apply),
  clearTreeSorter: (providerId: string) => ipcRenderer.invoke('clear-tree-sorter', providerId),
  exportMailList: (providerId: string) => ipcRenderer.invoke('export-mail-list', providerId),
  importTree: (providerId: string, mode: 'merge' | 'replace') => ipcRenderer.invoke('import-tree', providerId, mode),

  // People view
  getSenderGroups: (providerId: string, mode: SenderGroupMode) => ipcRenderer.invoke('get-sender-groups', providerId, mode),
  markFilterRead: (providerId: string, filterId: string) => ipcRenderer.invoke('mark-filter-read', providerId, filterId),
  reorderEmails: (providerId: string, emailIds: string[]) => ipcRenderer.invoke('reorder-emails', providerId, emailIds),
  reassignEmailTree: (providerId: string, emailId: string, associationId: string, agendaId: string) =>
    ipcRenderer.invoke('reassign-email-tree', providerId, emailId, associationId, agendaId),

  // Pushed by the main process after a background sync; returns an unsubscribe function
  onMailUpdated: (listener: (update: { providerId: string; newInbox: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, update: { providerId: string; newInbox: number }) => listener(update);
    ipcRenderer.on('mail-updated', handler);
    return () => ipcRenderer.removeListener('mail-updated', handler);
  },

  // History download progress after an account is added (or resumed after a restart)
  onSyncProgress: (listener: (progress: SyncProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: SyncProgress) => listener(progress);
    ipcRenderer.on('sync-progress', handler);
    return () => ipcRenderer.removeListener('sync-progress', handler);
  },

  // Damaged data files the main process repaired. The event is only a nudge to take them, so none shows twice
  takeStorageRecoveries: () => ipcRenderer.invoke('take-storage-recoveries'),
  onStorageRecovered: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on('storage-recovered', handler);
    return () => ipcRenderer.removeListener('storage-recovered', handler);
  },

  // Outbound SMTP
  sendEmail: (input: SendEmailInput) => ipcRenderer.invoke('send-email', input),

  // Modding & Automation Engine
  getMods: () => ipcRenderer.invoke('get-mods'),
  toggleMod: (modId: string) => ipcRenderer.invoke('toggle-mod', modId),
  runModOnEmail: (modId: string | null, emailId: string, providerId: string) => ipcRenderer.invoke('run-mod-on-email', modId, emailId, providerId),
  saveModRule: (rule: ModRule) => ipcRenderer.invoke('save-mod-rule', rule),

  // Window Controls
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
