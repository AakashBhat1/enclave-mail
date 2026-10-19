import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StorageService, PROVIDERS_DIR } from './engine/storage-service';
import { ModEngine } from './engine/mod-engine';
import { runModsOnEmail, tagNewMail } from './engine/mod-runner';
import { CredentialStore } from './engine/credential-store';
import { AccountService, summarizeError } from './engine/account-service';
import { TreeSorterService } from './engine/tree-sorter-service';
import { buildMailExport, extractJson, parseTreeImport, toCsv } from './engine/tree-export';
import { onStorageRecovered } from './engine/atomic-file';
import { createAppUrlCheck, guardIpc, hardenWebContents, isPermissionAllowed, throttleOpens } from './security';

// An AI-written tree is a few KB; anything far bigger is the wrong file
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
import type { AddAccountInput, IpcResult, SendEmailInput, SenderGroupMode, StorageRecoveryNotice, TreeSorterSettings } from '../renderer/types/index';

// ESM has no __dirname; derive it from this module's URL
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public');

let win: BrowserWindow | null;
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
const INDEX_HTML = path.join(__dirname, '../dist/index.html');
const isAppUrl = createAppUrlCheck({ devServerUrl: VITE_DEV_SERVER_URL, indexHtml: INDEX_HTML });

// Files can be repaired before the window exists (the startup sync), so notices wait until the window takes them
let pendingRecoveries: StorageRecoveryNotice[] = [];
onStorageRecovered(({ file, outcome }) => {
  pendingRecoveries = [...pendingRecoveries, { file: path.basename(file), outcome }];
  win?.webContents.send('storage-recovered');
});

const storageService = new StorageService();
const modEngine = new ModEngine();
const treeSorter = new TreeSorterService(storageService);
// Background syncs (server push, reconnects, startup, history download) tell the window to refresh what it shows
const accountService = new AccountService(
  storageService,
  new CredentialStore(PROVIDERS_DIR),
  (providerId, newInbox) => win?.webContents.send('mail-updated', { providerId, newInbox }),
  (progress) => win?.webContents.send('sync-progress', progress),
  (providerId) => treeSorter.autoRun(providerId),
  // Tag rules run on every letter as it arrives, before it is stored; exports only run when the user asks
  (_providerId, incoming) => tagNewMail(modEngine, incoming)
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

// Every channel answers only the app's own page; a foreign page or an email frame is refused
const { handle, on } = guardIpc(ipcMain, isAppUrl);

const openExternal = throttleOpens((url) => {
  shell.openExternal(url).catch((err) => console.error('Could not open link:', err instanceof Error ? err.message : err));
});

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
      sandbox: true,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(INDEX_HTML);
  }
}

// Covers every window and frame host, including any created later
app.on('web-contents-created', (_, contents) => {
  // DevTools reports as 'remote' and runs on devtools:// pages of its own; it never shows mail
  if (contents.getType() === 'remote') return;
  hardenWebContents(contents, { isAppUrl, openExternal });
});

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
handle('get-providers', async () => {
  return storageService.getProviders();
});

handle('add-provider', async (_, input: AddAccountInput) => {
  return toResult(() => accountService.addAccount(input));
});

handle('sync-provider', async (_, providerId: string) => {
  return toResult(() => accountService.sync(providerId));
});

handle('remove-provider', async (_, providerId: string) => {
  return toResult(async () => {
    await accountService.forget(providerId);
    storageService.removeProvider(providerId);
  });
});

handle('get-folders', async (_, providerId) => {
  return storageService.getFolders(providerId);
});

handle('get-associations', async (_, providerId) => {
  return storageService.getAssociations(providerId);
});

handle('reorder-associations', async (_, providerId, associationIds) => {
  return storageService.reorderAssociations(providerId, associationIds);
});

handle('add-association', async (_, providerId, name, icon, withDefaultAgendas = true, keywords = []) => {
  return toResult(async () => storageService.addAssociation(providerId, name, icon, withDefaultAgendas !== false, keywords));
});

handle('add-agenda', async (_, providerId, associationId, name, category, keywords = []) => {
  return toResult(async () => storageService.addAgenda(providerId, associationId, name, category, keywords));
});

handle('rename-tree-node', async (_, providerId: string, nodeId: string, name: string) => {
  return toResult(async () => storageService.renameNode(providerId, nodeId, name));
});

handle('set-node-keywords', async (_, providerId: string, nodeId: string, keywords: string[]) => {
  return toResult(async () => storageService.setNodeKeywords(providerId, nodeId, keywords));
});

handle('delete-tree-node', async (_, providerId: string, nodeId: string) => {
  return toResult(async () => storageService.deleteTreeNode(providerId, nodeId));
});

// Keyword Tree Sorter mod
handle('get-tree-sorter', async (_, providerId: string) => {
  return toResult(async () => treeSorter.getState(providerId));
});

handle('save-tree-sorter-settings', async (_, providerId: string, settings: Partial<TreeSorterSettings>) => {
  return toResult(async () => treeSorter.saveSettings(providerId, settings));
});

handle('run-tree-sorter', async (_, providerId: string, apply: boolean) => {
  return toResult(async () => treeSorter.run(providerId, apply === true));
});

handle('clear-tree-sorter', async (_, providerId: string) => {
  return toResult(async () => treeSorter.clear(providerId));
});

// "Design my tree with AI": export the mail list (with instructions for the agent), then import its answer
handle('export-mail-list', async (_, providerId: string) => {
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

handle('import-tree', async (_, providerId: string, mode: unknown) => {
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
handle('get-sender-groups', async (_, providerId: string, mode: SenderGroupMode) => {
  return toResult(async () => storageService.getSenderGroups(providerId, mode));
});

handle('mark-filter-read', async (_, providerId: string, filterId: string) => {
  return toResult(async () => storageService.markFilterRead(providerId, filterId));
});

handle('reorder-emails', async (_, providerId, emailIds) => {
  return storageService.reorderEmails(providerId, emailIds);
});

handle('reassign-email-tree', async (_, providerId, emailId, associationId, agendaId) => {
  storageService.reassignEmailTree(providerId, emailId, associationId, agendaId);
  return true;
});

handle('get-emails', async (_, providerId, folderId) => {
  return storageService.getEmails(providerId, folderId);
});

handle('get-email-detail', async (_, providerId, emailId) => {
  return storageService.getEmailDetail(providerId, emailId);
});

handle('take-storage-recoveries', async () => {
  const taken = pendingRecoveries;
  pendingRecoveries = [];
  return taken;
});

handle('get-trusted-senders', async (_, providerId: string) => {
  return storageService.getTrustedSenders(providerId);
});

handle('trust-sender', async (_, providerId: string, address: string) => {
  return toResult(async () => storageService.trustSender(providerId, address));
});

handle('mark-email-read', async (_, providerId, emailId, isRead) => {
  storageService.markEmailRead(providerId, emailId, isRead);
  return true;
});

handle('toggle-star', async (_, providerId, emailId) => {
  return storageService.toggleStar(providerId, emailId);
});

handle('send-email', async (_, input: SendEmailInput) => {
  return toResult(() => accountService.send(input));
});

handle('get-mods', async () => {
  return modEngine.getRules();
});

handle('toggle-mod', async (_, modId) => {
  return modEngine.toggleRule(modId);
});

handle('save-mod-rule', async (_, rule: unknown) => {
  return toResult(async () => modEngine.saveRule(rule));
});

// modId null runs every enabled rule (the reading pane's "Run mod"); an id runs just that rule
handle('run-mod-on-email', async (_, modId: unknown, emailId: string, providerId: string) => {
  return toResult(async () => {
    const result = runModsOnEmail(storageService, modEngine, providerId, emailId, modId as string | null);
    if (result.tagsAdded.length > 0) win?.webContents.send('mail-updated', { providerId, newInbox: 0 });
    return result;
  });
});

on('window-minimize', () => win?.minimize());
on('window-maximize', () => {
  if (win?.isMaximized()) {
    win.unmaximize();
  } else {
    win?.maximize();
  }
});
on('window-close', () => win?.close());

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_, permission, callback, details) => {
    callback(isPermissionAllowed(permission, details.requestingUrl, isAppUrl));
  });
  // Synchronous checks (permissions.query, device lists) follow the same rule as prompts
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
    isPermissionAllowed(permission, details.requestingUrl || contents?.getURL() || '', isAppUrl)
  );
  createWindow();
  void accountService.startWatching();
});

app.on('before-quit', () => {
  void accountService.shutdown();
});
