import { contextBridge, ipcRenderer } from 'electron';
import type { AddAccountInput, SendEmailInput } from '../renderer/types/index';

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

  // Association & Agenda Tree
  getAssociations: (providerId: string) => ipcRenderer.invoke('get-associations', providerId),
  reorderAssociations: (providerId: string, associationIds: string[]) => ipcRenderer.invoke('reorder-associations', providerId, associationIds),
  addAssociation: (providerId: string, name: string, icon?: string) => ipcRenderer.invoke('add-association', providerId, name, icon),
  addAgenda: (providerId: string, associationId: string, name: string, category?: string) =>
    ipcRenderer.invoke('add-agenda', providerId, associationId, name, category),
  reorderEmails: (providerId: string, emailIds: string[]) => ipcRenderer.invoke('reorder-emails', providerId, emailIds),
  reassignEmailTree: (providerId: string, emailId: string, associationId: string, agendaId: string) =>
    ipcRenderer.invoke('reassign-email-tree', providerId, emailId, associationId, agendaId),

  // Pushed by the main process after a background sync; returns an unsubscribe function
  onMailUpdated: (listener: (update: { providerId: string; newInbox: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, update: { providerId: string; newInbox: number }) => listener(update);
    ipcRenderer.on('mail-updated', handler);
    return () => ipcRenderer.removeListener('mail-updated', handler);
  },

  // Outbound SMTP
  sendEmail: (input: SendEmailInput) => ipcRenderer.invoke('send-email', input),

  // Modding & Automation Engine
  getMods: () => ipcRenderer.invoke('get-mods'),
  toggleMod: (modId: string) => ipcRenderer.invoke('toggle-mod', modId),
  runModOnEmail: (modId: string, emailId: string, providerId: string) => ipcRenderer.invoke('run-mod-on-email', modId, emailId, providerId),
  saveModRule: (rule: any) => ipcRenderer.invoke('save-mod-rule', rule),

  // Window Controls
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
