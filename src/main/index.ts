import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StorageService, PROVIDERS_DIR } from './engine/storage-service';
import { ModEngine } from './engine/mod-engine';
import { CredentialStore } from './engine/credential-store';
import { AccountService, summarizeError } from './engine/account-service';
import type { AddAccountInput, IpcResult, SendEmailInput } from '../renderer/types/index';

// ESM has no __dirname; derive it from this module's URL
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public');

let win: BrowserWindow | null;
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

const storageService = new StorageService();
const modEngine = new ModEngine();
// Background syncs (server push, reconnects, startup) tell the window to refresh what it shows
const accountService = new AccountService(storageService, new CredentialStore(PROVIDERS_DIR), (providerId, newInbox) => {
  win?.webContents.send('mail-updated', { providerId, newInbox });
});

// Wrap network-facing handlers so the renderer always gets a readable error instead of a rejected promise
async function toResult<T>(run: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { success: true, data: await run() };
  } catch (err) {
    console.error(summarizeError(err));
    return { success: false, error: err instanceof Error ? err.message : 'Unexpected error' };
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title: 'Enclave Mail',
    frame: true,
    backgroundColor: '#FBF6EE',
    // The default File/Edit/View menu is unused chrome; Alt still reveals it
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
    win = null;
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handler Registrations
ipcMain.handle('get-providers', async () => {
  return storageService.getProviders();
});

ipcMain.handle('add-provider', async (_, input: AddAccountInput) => {
  return toResult(() => accountService.addAccount(input));
});

ipcMain.handle('sync-provider', async (_, providerId: string) => {
  return toResult(() => accountService.sync(providerId));
});

ipcMain.handle('remove-provider', async (_, providerId: string) => {
  return toResult(async () => {
    await accountService.forget(providerId);
    storageService.removeProvider(providerId);
  });
});

ipcMain.handle('get-folders', async (_, providerId) => {
  return storageService.getFolders(providerId);
});

ipcMain.handle('get-associations', async (_, providerId) => {
  return storageService.getAssociations(providerId);
});

ipcMain.handle('reorder-associations', async (_, providerId, associationIds) => {
  return storageService.reorderAssociations(providerId, associationIds);
});

ipcMain.handle('add-association', async (_, providerId, name, icon) => {
  return storageService.addAssociation(providerId, name, icon);
});

ipcMain.handle('add-agenda', async (_, providerId, associationId, name, category) => {
  return storageService.addAgenda(providerId, associationId, name, category);
});

ipcMain.handle('reorder-emails', async (_, providerId, emailIds) => {
  return storageService.reorderEmails(providerId, emailIds);
});

ipcMain.handle('reassign-email-tree', async (_, providerId, emailId, associationId, agendaId) => {
  storageService.reassignEmailTree(providerId, emailId, associationId, agendaId);
  return true;
});

ipcMain.handle('get-emails', async (_, providerId, folderId) => {
  return storageService.getEmails(providerId, folderId);
});

ipcMain.handle('get-email-detail', async (_, providerId, emailId) => {
  return storageService.getEmailDetail(providerId, emailId);
});

ipcMain.handle('mark-email-read', async (_, providerId, emailId, isRead) => {
  storageService.markEmailRead(providerId, emailId, isRead);
  return true;
});

ipcMain.handle('toggle-star', async (_, providerId, emailId) => {
  return storageService.toggleStar(providerId, emailId);
});

ipcMain.handle('send-email', async (_, input: SendEmailInput) => {
  return toResult(() => accountService.send(input));
});

ipcMain.handle('get-mods', async () => {
  return modEngine.getRules();
});

ipcMain.handle('toggle-mod', async (_, modId) => {
  return modEngine.toggleRule(modId);
});

ipcMain.handle('save-mod-rule', async (_, rule) => {
  return modEngine.saveRule(rule);
});

ipcMain.handle('run-mod-on-email', async (_, modId, emailId, providerId) => {
  const email = storageService.getEmailDetail(providerId, emailId);
  if (!email) return { success: false };
  const res = modEngine.executeModsOnEmail(email);
  return { success: true, appliedMods: res.appliedMods };
});

ipcMain.on('window-minimize', () => win?.minimize());
ipcMain.on('window-maximize', () => {
  if (win?.isMaximized()) {
    win.unmaximize();
  } else {
    win?.maximize();
  }
});
ipcMain.on('window-close', () => win?.close());

app.whenReady().then(() => {
  createWindow();
  void accountService.startWatching();
});

app.on('before-quit', () => {
  void accountService.shutdown();
});
