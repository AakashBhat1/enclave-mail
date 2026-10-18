import { useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { FolderTree as TreeIcon, Layers, PenLine, RefreshCw, Users } from 'lucide-react';
import { AssociationNode, Folder, ProviderEnclave, SenderGroup, SenderGroupMode, SyncProgress } from '../types/index';
import { AssociationTree } from './nav/AssociationTree';
import { FolderList } from './nav/FolderList';
import { SenderList } from './nav/SenderList';
import { EASE_OUT_EXPO, SPRING_SNAPPY } from '../lib/motion';

export type NavMode = 'associations' | 'folders' | 'people';

interface AssociationTreeNavProps {
  currentProvider: ProviderEnclave | null;
  folders: Folder[];
  associations: AssociationNode[];
  activeFilterId: string;
  navMode: NavMode;
  onNavModeChange: (mode: NavMode) => void;
  senderGroups: SenderGroup[];
  senderMode: SenderGroupMode;
  onSenderModeChange: (mode: SenderGroupMode) => void;
  onMarkSenderRead: (group: SenderGroup) => void;
  onComposeTo: (address: string) => void;
  syncProgress: SyncProgress | null;
  onSelectFilter: (filterId: string, label: string) => void;
  onReorderAssociations: (associationIds: string[]) => void;
  onAddAssociation?: (name: string, icon?: string) => void;
  onAddAgenda?: (associationId: string, name: string, category: string) => void;
  onOpenTreeSorter: () => void;
  onOpenComposer: () => void;
  onSync: () => void;
  isSyncing: boolean;
}

const MODES: Array<{ id: NavMode; label: string; icon: typeof Layers }> = [
  { id: 'associations', label: 'Tree', icon: TreeIcon },
  { id: 'folders', label: 'Folders', icon: Layers },
  { id: 'people', label: 'People', icon: Users },
];

const MODE_ORDER: NavMode[] = MODES.map((m) => m.id);

function HistoryProgress({ progress }: { progress: SyncProgress }) {
  const pct = progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 100;
  return (
    <div className="w-full" title={`Downloading older mail: ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate">
          Fetching history{progress.folderId ? ` · ${progress.folderId}` : ''}
        </span>
        <span className="font-mono text-[10px] tabular-nums">
          {progress.done.toLocaleString()}/{progress.total.toLocaleString()}
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-sunken">
        <motion.div className="h-full rounded-full bg-primary" initial={false} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, ease: EASE_OUT_EXPO }} />
      </div>
    </div>
  );
}

export function AssociationTreeNav({
  currentProvider,
  folders,
  associations,
  activeFilterId,
  navMode,
  onNavModeChange,
  senderGroups,
  senderMode,
  onSenderModeChange,
  onMarkSenderRead,
  onComposeTo,
  syncProgress,
  onSelectFilter,
  onReorderAssociations,
  onAddAssociation,
  onAddAgenda,
  onOpenTreeSorter,
  onOpenComposer,
  onSync,
  isSyncing,
}: AssociationTreeNavProps) {
  // Panels slide in from the side of the tab that was picked
  const [direction, setDirection] = useState(1);
  const selectMode = (mode: NavMode) => {
    setDirection(MODE_ORDER.indexOf(mode) >= MODE_ORDER.indexOf(navMode) ? 1 : -1);
    onNavModeChange(mode);
  };

  return (
    <div className="pane flex h-full w-[228px] flex-shrink-0 flex-col overflow-hidden xl:w-[252px]">
      <div className="px-3.5 pb-2.5 pt-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={currentProvider?.id ?? 'none'}
                initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
                transition={{ duration: 0.45, ease: EASE_OUT_EXPO }}
              >
                <h2 className="display truncate text-[18px] leading-tight text-foreground">{currentProvider?.name || 'Workspace'}</h2>
                <p className="truncate text-xs text-muted">{currentProvider?.email || 'No account selected'}</p>
              </motion.div>
            </AnimatePresence>
          </div>
          <button
            type="button"
            onClick={onSync}
            disabled={isSyncing}
            className={`icon-btn flex-shrink-0 ${isSyncing ? '!text-primary' : ''}`}
            title="Sync mailbox"
          >
            <motion.span
              animate={isSyncing ? { rotate: 360 } : { rotate: 0 }}
              transition={isSyncing ? { duration: 1, repeat: Infinity, ease: 'linear' } : { duration: 0.4 }}
              className="grid place-items-center"
            >
              <RefreshCw className="size-4" />
            </motion.span>
          </button>
        </div>

        <motion.button
          type="button"
          onClick={onOpenComposer}
          whileTap={{ scale: 0.97 }}
          className="btn-primary mt-3 w-full !rounded-xl !py-2.5 !text-[13px]"
        >
          <PenLine className="size-4" />
          <span>Compose</span>
        </motion.button>
      </div>

      {/* Segmented control with a sliding thumb */}
      <div className="px-3.5 pb-2.5">
        <div className="relative grid grid-cols-3 rounded-xl bg-sunken p-1 shadow-pressed">
          {MODES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => selectMode(id)}
              className={`relative flex items-center justify-center gap-1 rounded-lg py-1.5 text-[11.5px] font-semibold transition-colors ${
                navMode === id ? 'text-foreground' : 'text-muted hover:text-foreground'
              }`}
            >
              {navMode === id && <motion.span layoutId="nav-mode-thumb" className="absolute inset-0 rounded-lg bg-surface shadow-warm" transition={SPRING_SNAPPY} />}
              <Icon className="relative size-3.5" />
              <span className="relative">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <LayoutGroup id="nav">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={navMode}
              initial={{ opacity: 0, x: 16 * direction }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 * direction }}
              transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
            >
              {navMode === 'associations' && (
                <AssociationTree
                  associations={associations}
                  activeFilterId={activeFilterId}
                  onSelectFilter={onSelectFilter}
                  onReorderAssociations={onReorderAssociations}
                  onAddAssociation={onAddAssociation}
                  onAddAgenda={onAddAgenda}
                  onOpenTreeSorter={onOpenTreeSorter}
                />
              )}
              {navMode === 'folders' && <FolderList folders={folders} activeFilterId={activeFilterId} onSelectFilter={onSelectFilter} />}
              {navMode === 'people' && (
                <SenderList
                  groups={senderGroups}
                  mode={senderMode}
                  activeFilterId={activeFilterId}
                  onModeChange={onSenderModeChange}
                  onSelectFilter={onSelectFilter}
                  onMarkRead={onMarkSenderRead}
                  onCompose={onComposeTo}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </LayoutGroup>
      </div>

      <div className="flex items-center justify-between border-t border-border/70 px-3.5 py-2 text-[10.5px] text-muted">
        {syncProgress?.phase === 'history' ? (
          <HistoryProgress progress={syncProgress} />
        ) : (
          <>
            <span className="flex items-center gap-2">
              <span className="relative flex size-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-moss/60" />
                <span className="relative size-2 rounded-full bg-moss" />
              </span>
              <span className="truncate">HAAT taxonomy active</span>
            </span>
            <span className="hidden font-mono text-[10px] opacity-70 xl:inline">Account → Tree</span>
          </>
        )}
      </div>
    </div>
  );
}
