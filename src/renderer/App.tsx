import React, { useState, useEffect, useRef, type ReactNode } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { ProviderEnclave, Folder, EmailMessage, ModRule, AssociationNode, AddAccountInput, IpcResult, SendEmailInput, SendOutcome } from './types/index';
import { WorkspaceDock } from './components/WorkspaceDock';
import { AssociationTreeNav } from './components/AssociationTreeNav';
import { MessageList } from './components/MessageList';
import { ReadingPane } from './components/ReadingPane';
import { ComposerModal, type SentInfo } from './components/ComposerModal';
import { ModManagerModal } from './components/ModManagerModal';
import { AddAccountModal } from './components/AddAccountModal';
import { TreeMoveModal } from './components/TreeMoveModal';
import { AmbientLight } from './components/fx/AmbientLight';
import { BootSplash } from './components/fx/BootSplash';
import { SendFlight } from './components/fx/SendFlight';
import { ToastProvider, useToast } from './components/ui/Toast';
import type { ModalExit } from './components/ui/Modal';
import { readStoredTheme, type Theme } from './lib/theme';
import { EASE_OUT_EXPO } from './lib/motion';

const RECENT_SYNC_MS = 60_000;
// Long enough for the splash to read as intentional, short enough not to feel like a wait
const MIN_SPLASH_MS = 1400;

// Type declaration for window.electronAPI
declare global {
  interface Window {
    electronAPI?: any;
  }
}

export const App: React.FC = () => (
  <MotionConfig reducedMotion="user">
    <ToastProvider>
      <MailApp />
    </ToastProvider>
  </MotionConfig>
);

interface PaneEntranceProps {
  index: number;
  shown: boolean;
  className: string;
  children: ReactNode;
}

/** Panes float up one after another once the splash clears. */
function PaneEntrance({ index, shown, className, children }: PaneEntranceProps) {
  return (
    <motion.div
      className={className}
      // No filter here: a filtered ancestor would cut the panes' backdrop blur off from the ambient light
      initial={{ opacity: 0, y: 28, scale: 0.985 }}
      animate={shown ? { opacity: 1, y: 0, scale: 1 } : undefined}
      transition={{ duration: 0.9, delay: 0.08 + index * 0.08, ease: EASE_OUT_EXPO }}
    >
      {children}
    </motion.div>
  );
}

interface Flight extends SentInfo {
  id: number;
}

const MailApp: React.FC = () => {
  const notify = useToast();
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const [splashDone, setSplashDone] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const booted = splashDone && initialLoaded;

  const [providers, setProviders] = useState<ProviderEnclave[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string>('');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [associations, setAssociations] = useState<AssociationNode[]>([]);
  const [activeFilterId, setActiveFilterId] = useState<string>('inbox');
  const [activeFilterLabel, setActiveFilterLabel] = useState<string>('Inbox');
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const activeProviderIdRef = useRef(activeProviderId);
  const activeFilterIdRef = useRef(activeFilterId);
  const providersRef = useRef(providers);
  providersRef.current = providers;
  activeProviderIdRef.current = activeProviderId;
  activeFilterIdRef.current = activeFilterId;

  // Modals state
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [composerExit, setComposerExit] = useState<ModalExit>('dismiss');
  const [flight, setFlight] = useState<Flight | null>(null);
  const [isModsOpen, setIsModsOpen] = useState(false);
  const [isAddAccountOpen, setIsAddAccountOpen] = useState(false);
  const [isTreeMoveOpen, setIsTreeMoveOpen] = useState(false);
  const [treeMoveTargetEmail, setTreeMoveTargetEmail] = useState<EmailMessage | null>(null);

  const [composerInitialTo, setComposerInitialTo] = useState('');
  const [composerInitialSubject, setComposerInitialSubject] = useState('');
  const [mods, setMods] = useState<ModRule[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSplashDone(true), MIN_SPLASH_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // 1. Initial Load: Fetch Providers & Mods
  useEffect(() => {
    async function loadInitial() {
      try {
        if (window.electronAPI) {
          const provs = await window.electronAPI.getProviders();
          setProviders(provs);
          if (provs.length > 0) {
            setActiveProviderId(provs[0].id);
          }
          const m = await window.electronAPI.getMods();
          setMods(m);
        }
      } finally {
        setInitialLoaded(true);
      }
    }
    loadInitial();
  }, []);

  // 2. When active provider changes: fetch folders & associations
  useEffect(() => {
    if (!activeProviderId) return;
    async function loadProviderData() {
      if (window.electronAPI) {
        const [f, a] = await Promise.all([
          window.electronAPI.getFolders(activeProviderId),
          window.electronAPI.getAssociations(activeProviderId),
        ]);
        setFolders(f);
        setAssociations(a);
        setActiveFilterId('inbox');
        setActiveFilterLabel('Inbox');
      }
    }
    loadProviderData();
    // Show cached mail immediately, then pull fresh mail unless it was just synced (e.g. right after adding)
    const lastSynced = providersRef.current.find((p) => p.id === activeProviderId)?.lastSyncedAt ?? 0;
    if (Date.now() - lastSynced > RECENT_SYNC_MS) syncProvider(activeProviderId);
  }, [activeProviderId]);

  // 3. When active filter changes: fetch emails
  useEffect(() => {
    if (!activeProviderId || !activeFilterId) return;
    async function loadEmails() {
      if (window.electronAPI) {
        const msgs = await window.electronAPI.getEmails(activeProviderId, activeFilterId);
        setEmails(msgs);
        if (msgs.length > 0) {
          setSelectedEmailId(msgs[0].id);
          window.electronAPI.markEmailRead(activeProviderId, msgs[0].id, true);
        } else {
          setSelectedEmailId(null);
        }
      }
    }
    loadEmails();
  }, [activeProviderId, activeFilterId]);

  // 4. Live updates: the main process keeps an IDLE connection and pushes when new mail lands
  useEffect(() => {
    if (!window.electronAPI?.onMailUpdated) return;
    return window.electronAPI.onMailUpdated(async ({ providerId, newInbox }: { providerId: string; newInbox: number }) => {
      const provs: ProviderEnclave[] = await window.electronAPI.getProviders();
      setProviders(provs);
      if (newInbox > 0) {
        const email = provs.find((p) => p.id === providerId)?.email ?? '';
        notify({ tone: 'info', title: newInbox === 1 ? 'New letter' : `${newInbox} new letters`, description: email });
      }
      if (providerId !== activeProviderIdRef.current) return;
      const [f, msgs] = await Promise.all([
        window.electronAPI.getFolders(providerId),
        window.electronAPI.getEmails(providerId, activeFilterIdRef.current),
      ]);
      setFolders(f);
      setEmails(msgs);
    });
  }, [notify]);

  const activeProvider = providers.find((p) => p.id === activeProviderId) || null;
  const selectedEmail = emails.find((e) => e.id === selectedEmailId) || null;

  // Handlers
  const handleSelectFilter = (filterId: string, label: string) => {
    setActiveFilterId(filterId);
    setActiveFilterLabel(label);
  };

  const handleSelectEmail = async (id: string) => {
    setSelectedEmailId(id);
    if (window.electronAPI) {
      await window.electronAPI.markEmailRead(activeProviderId, id, true);
      setEmails((prev) =>
        prev.map((m) => (m.id === id ? { ...m, isRead: true } : m))
      );
    }
  };

  const handleToggleStar = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (window.electronAPI) {
      const isStarred = await window.electronAPI.toggleStar(activeProviderId, id);
      setEmails((prev) =>
        prev.map((m) => (m.id === id ? { ...m, isStarred } : m))
      );
    }
  };

  async function syncProvider(providerId: string) {
    if (!window.electronAPI || !providerId) return;
    setIsSyncing(true);
    const res: IpcResult<ProviderEnclave> = await window.electronAPI.syncProvider(providerId);
    setIsSyncing(false);
    if (!res.success || !res.data) {
      notify({ tone: 'error', title: 'Sync failed', description: res.error ?? 'The mail server did not respond.' });
      return;
    }
    const synced = res.data;
    setProviders((prev) => prev.map((p) => (p.id === synced.id ? synced : p)));
    // Ignore results for an account the user has already switched away from
    if (providerId !== activeProviderIdRef.current) return;
    const [f, msgs] = await Promise.all([
      window.electronAPI.getFolders(providerId),
      window.electronAPI.getEmails(providerId, activeFilterIdRef.current),
    ]);
    setFolders(f);
    setEmails(msgs);
  }

  const handleSync = () => syncProvider(activeProviderId);

  const handleReorderAssociations = async (ids: string[]) => {
    if (window.electronAPI) {
      const updated = await window.electronAPI.reorderAssociations(activeProviderId, ids);
      setAssociations(updated);
    }
  };

  const handleAddAssociation = async (name: string, icon?: string) => {
    if (window.electronAPI) {
      await window.electronAPI.addAssociation(activeProviderId, name, icon);
      const updated = await window.electronAPI.getAssociations(activeProviderId);
      setAssociations(updated);
    }
  };

  const handleAddAgenda = async (associationId: string, name: string, category: string) => {
    if (window.electronAPI) {
      await window.electronAPI.addAgenda(activeProviderId, associationId, name, category);
      const updated = await window.electronAPI.getAssociations(activeProviderId);
      setAssociations(updated);
    }
  };

  const handleReorderEmails = async (emailIds: string[]) => {
    if (window.electronAPI) {
      await window.electronAPI.reorderEmails(activeProviderId, emailIds);
      const msgs = await window.electronAPI.getEmails(activeProviderId, activeFilterId);
      setEmails(msgs);
    }
  };

  const handleReassignEmailTree = async (emailId: string, associationId: string, agendaId: string) => {
    if (window.electronAPI) {
      await window.electronAPI.reassignEmailTree(activeProviderId, emailId, associationId, agendaId);
      const [msgs, assocs] = await Promise.all([
        window.electronAPI.getEmails(activeProviderId, activeFilterId),
        window.electronAPI.getAssociations(activeProviderId),
      ]);
      setEmails(msgs);
      setAssociations(assocs);
    }
  };

  const handleSendEmail = async (emailData: SendEmailInput): Promise<IpcResult<SendOutcome>> => {
    if (!window.electronAPI) return { success: false, error: 'App backend is not available.' };
    const res = await window.electronAPI.sendEmail(emailData);
    if (res.success && activeFilterId === 'sent') {
      setEmails(await window.electronAPI.getEmails(activeProviderId, 'sent'));
    }
    return res;
  };

  const openComposer = (to: string, subject: string) => {
    setComposerInitialTo(to);
    setComposerInitialSubject(subject);
    setComposerExit('dismiss');
    setIsComposerOpen(true);
  };

  // The composer folds away as the envelope takes over; the toast lands once it has flown
  const handleSent = (info: SentInfo) => {
    setComposerExit('fold');
    setIsComposerOpen(false);
    setFlight({ ...info, id: Date.now() });
  };

  const handleFlightDone = () => {
    if (flight) {
      // The queue id in the server reply is what the host's delivery log searches by
      const queued = flight.serverResponse ? ` · Server: ${flight.serverResponse}` : '';
      notify({ tone: 'success', title: `Sent to ${flight.to}`, description: `${flight.subject}${queued}` });
      if (flight.warning) notify({ tone: 'info', title: 'Sent, with a note', description: flight.warning });
    }
    setFlight(null);
  };

  const handleReply = (email: EmailMessage) => {
    openComposer(email.from.address, email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`);
  };

  const handleTriggerMod = async (emailId: string) => {
    if (window.electronAPI) {
      const res = await window.electronAPI.runModOnEmail('rule_invoice_autofiler', emailId, activeProviderId);
      if (res.success && res.appliedMods.length > 0) {
        notify({ tone: 'success', title: 'Mod applied', description: res.appliedMods.join(', ') });
        const msgs = await window.electronAPI.getEmails(activeProviderId, activeFilterId);
        setEmails(msgs);
      } else {
        notify({ tone: 'info', title: 'No rule matched', description: 'None of your automation mods apply to this email.' });
      }
    }
  };

  const handleToggleMod = async (modId: string) => {
    if (window.electronAPI) {
      const enabled = await window.electronAPI.toggleMod(modId);
      setMods((prev) =>
        prev.map((m) => (m.id === modId ? { ...m, enabled } : m))
      );
    }
  };

  const handleAddMod = async (rule: ModRule) => {
    if (window.electronAPI) {
      await window.electronAPI.saveModRule(rule);
      const m = await window.electronAPI.getMods();
      setMods(m);
    }
  };

  const handleAddProvider = async (input: AddAccountInput): Promise<IpcResult<ProviderEnclave>> => {
    if (!window.electronAPI) return { success: false, error: 'App backend is not available.' };
    const res: IpcResult<ProviderEnclave> = await window.electronAPI.addProvider(input);
    if (res.success && res.data) {
      const added = res.data;
      setProviders((prev) => [...prev, added]);
      setActiveProviderId(added.id);
      notify({ tone: 'success', title: 'Mailbox connected', description: `${added.email} now has its own enclave.` });
    }
    return res;
  };

  const handleRemoveProvider = async (id: string) => {
    if (!window.electronAPI) return;
    const res: IpcResult<void> = await window.electronAPI.removeProvider(id);
    if (!res.success) {
      notify({ tone: 'error', title: 'Could not remove the account', description: res.error });
      return;
    }
    const remaining = providers.filter((p) => p.id !== id);
    setProviders(remaining);
    if (id === activeProviderId) {
      setActiveProviderId(remaining[0]?.id ?? '');
      if (remaining.length === 0) {
        setFolders([]);
        setAssociations([]);
        setEmails([]);
        setSelectedEmailId(null);
      }
    }
  };

  const openTreeMove = (email: EmailMessage) => {
    setTreeMoveTargetEmail(email);
    setIsTreeMoveOpen(true);
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden font-sans text-foreground">
      <AmbientLight dark={theme === 'dark'} />

      <AnimatePresence>{!booted && <BootSplash key="splash" />}</AnimatePresence>

      <div className="relative z-10 flex h-full gap-2 p-2">
        {/* 1. Provider Enclave Switcher Dock (Supports Multiple Accounts) */}
        <PaneEntrance index={0} shown={booted} className="flex-shrink-0">
          <WorkspaceDock
            providers={providers}
            activeProviderId={activeProviderId}
            onSelectProvider={(id) => setActiveProviderId(id)}
            onOpenAddModal={() => setIsAddAccountOpen(true)}
            onOpenModsModal={() => setIsModsOpen(true)}
            onRemoveProvider={handleRemoveProvider}
            theme={theme}
            onThemeChange={setTheme}
          />
        </PaneEntrance>

        {/* 2. Hierarchical Association & Agenda Tree Navigation */}
        <PaneEntrance index={1} shown={booted} className="flex-shrink-0">
          <AssociationTreeNav
            currentProvider={activeProvider}
            folders={folders}
            associations={associations}
            activeFilterId={activeFilterId}
            onSelectFilter={handleSelectFilter}
            onReorderAssociations={handleReorderAssociations}
            onAddAssociation={handleAddAssociation}
            onAddAgenda={handleAddAgenda}
            onOpenComposer={() => openComposer('', '')}
            onSync={handleSync}
            isSyncing={isSyncing}
          />
        </PaneEntrance>

        {/* 3. Messages List with Position Reordering & Voice Filter */}
        <PaneEntrance index={2} shown={booted} className="flex-shrink-0">
          <MessageList
            emails={emails}
            selectedEmailId={selectedEmailId}
            associations={associations}
            title={activeFilterLabel}
            listKey={`${activeProviderId}:${activeFilterId}`}
            isLoading={isSyncing}
            isSyncing={isSyncing}
            onSelectEmail={handleSelectEmail}
            onToggleStar={handleToggleStar}
            onSelectFolder={(id) => handleSelectFilter(id, id.charAt(0).toUpperCase() + id.slice(1))}
            onReorderEmails={handleReorderEmails}
            onOpenTreeMove={openTreeMove}
          />
        </PaneEntrance>

        {/* 4. Reading Pane with HAAT Location Breadcrumbs & Sandboxing */}
        <PaneEntrance index={3} shown={booted} className="min-w-0 flex-1">
          <ReadingPane
            email={selectedEmail}
            associations={associations}
            onReply={handleReply}
            onTriggerMod={handleTriggerMod}
            onToggleStar={(id) => handleToggleStar(id)}
            onOpenTreeMove={openTreeMove}
          />
        </PaneEntrance>
      </div>

      {/* Modals */}
      <ComposerModal
        isOpen={isComposerOpen}
        onClose={() => setIsComposerOpen(false)}
        currentProvider={activeProvider}
        onSend={handleSendEmail}
        onSent={handleSent}
        exitMode={composerExit}
        initialTo={composerInitialTo}
        initialSubject={composerInitialSubject}
      />

      {flight && <SendFlight key={flight.id} origin={flight.origin} onDone={handleFlightDone} />}

      <ModManagerModal
        isOpen={isModsOpen}
        onClose={() => setIsModsOpen(false)}
        mods={mods}
        onToggleMod={handleToggleMod}
        onAddMod={handleAddMod}
      />

      <AddAccountModal
        isOpen={isAddAccountOpen}
        onClose={() => setIsAddAccountOpen(false)}
        onAddProvider={handleAddProvider}
      />

      <TreeMoveModal
        isOpen={isTreeMoveOpen}
        onClose={() => {
          setIsTreeMoveOpen(false);
          setTreeMoveTargetEmail(null);
        }}
        email={treeMoveTargetEmail}
        associations={associations}
        onReassign={handleReassignEmailTree}
        onAddAssociation={handleAddAssociation}
        onAddAgenda={handleAddAgenda}
      />
    </div>
  );
};
