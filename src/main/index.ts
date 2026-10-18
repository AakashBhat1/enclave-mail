import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StorageService, PROVIDERS_DIR } from './engine/storage-service';
import { ModEngine } from './engine/mod-engine';
import { CredentialStore } from './engine/credential-store';
import { AccountService, summarizeError } from './engine/account-service';
import { TreeSorterService } from './engine/tree-sorter-service';
import { buildMailExport, extractJson, parseTreeImport, toCsv } from './engine/tree-export';

// An AI-written tree is a few KB; anything far bigger is the wrong file
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
import type { AddAccountInput, IpcResult, SendEmailInput, SenderGroupMode, TreeSorterSettings } from '../renderer/types/index';

// ESM has no __dirname; derive it from this module's URL
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public');

let win: BrowserWindow | null;
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

const storageService = new StorageService();
const modEngine = new ModEngine();
const treeSorter = new TreeSorterService(storageService);
// Background syncs (server push, reconnects, startup, history download) tell the window to refresh what it shows
const accountService = new AccountService(
  storageService,
  new CredentialStore(PROVIDERS_DIR),
  (providerId, newInbox) => win?.webContents.send('mail-updated', { providerId, newInbox }),
  (progress) => win?.webContents.send('sync-progress', progress),
  (providerId) => treeSorter.autoRun(providerId)
);

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

ipcMain.handle('add-association', async (_, providerId, name, icon, withDefaultAgendas = true, keywords = []) => {
  return toResult(async () => storageService.addAssociation(providerId, name, icon, withDefaultAgendas !== false, keywords));
});

ipcMain.handle('add-agenda', async (_, providerId, associationId, name, category, keywords = []) => {
  return toResult(async () => storageService.addAgenda(providerId, associationId, name, category, keywords));
});

ipcMain.handle('rename-tree-node', async (_, providerId: string, nodeId: string, name: string) => {
  return toResult(async () => storageService.renameNode(providerId, nodeId, name));
});

ipcMain.handle('set-node-keywords', async (_, providerId: string, nodeId: string, keywords: string[]) => {
  return toResult(async () => storageService.setNodeKeywords(providerId, nodeId, keywords));
});

ipcMain.handle('delete-tree-node', async (_, providerId: string, nodeId: string) => {
  return toResult(async () => storageService.deleteTreeNode(providerId, nodeId));
});

// Keyword Tree Sorter mod
ipcMain.handle('get-tree-sorter', async (_, providerId: string) => {
  return toResult(async () => treeSorter.getState(providerId));
});

ipcMain.handle('save-tree-sorter-settings', async (_, providerId: string, settings: Partial<TreeSorterSettings>) => {
  return toResult(async () => treeSorter.saveSettings(providerId, settings));
});

ipcMain.handle('run-tree-sorter', async (_, providerId: string, apply: boolean) => {
  return toResult(async () => treeSorter.run(providerId, apply === true));
});

ipcMain.handle('clear-tree-sorter', async (_, providerId: string) => {
  return toResult(async () => treeSorter.clear(providerId));
});

// "Design my tree with AI": export the mail list (with instructions for the agent), then import its answer
ipcMain.handle('export-mail-list', async (_, providerId: string) => {
  return toResult(async () => {
    const provider = storageService.getProvider(providerId);
    if (!provider || !win) throw new Error('Account not found.');
    const stamp = new Date().toISOString().slice(0, 10);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export mail list for AI analysis',
      defaultPath: path.join(app.getPath('downloads'), `enclave-mail-${provider.email.replace(/[^\w.-]/g, '_')}-${stamp}.json`),
      filters: [
        { name: 'JSON for an AI agent (recommended)', extensions: ['json'] },
        { name: 'CSV spreadsheet', extensions: ['csv'] },
      ],
    });
    if (canceled || !filePath) return null;
    const data = buildMailExport(provider.email, storageService.getAllMessages(providerId), storageService.getAssociations(providerId));
    const body = filePath.toLowerCase().endsWith('.csv') ? toCsv(data) : JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, body, 'utf-8');
    return { filePath, count: data.messages.length };
  });
});

ipcMain.handle('import-tree', async (_, providerId: string, mode: unknown) => {
  return toResult(async () => {
    if (!storageService.getProvider(providerId) || !win) throw new Error('Account not found.');
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Import a tree (enclave-tree/v1)',
      properties: ['openFile'],
      filters: [{ name: 'Tree JSON', extensions: ['json', 'txt', 'md'] }],
    });
    if (canceled || filePaths.length === 0) return null;
    if (fs.statSync(filePaths[0]).size > MAX_IMPORT_BYTES) throw new Error('That file is too large to be a tree.');
    const branches = parseTreeImport(extractJson(fs.readFileSync(filePaths[0], 'utf-8')));
    return storageService.importTree(providerId, branches, mode === 'replace' ? 'replace' : 'merge');
  });
});

// People view: received mail grouped by sender or domain
ipcMain.handle('get-sender-groups', async (_, providerId: string, mode: SenderGroupMode) => {
  return toResult(async () => storageService.getSenderGroups(providerId, mode));
});

ipcMain.handle('mark-filter-read', async (_, providerId: string, filterId: string) => {
  return toResult(async () => storageService.markFilterRead(providerId, filterId));
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
