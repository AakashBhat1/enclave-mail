import { useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { FolderTree as TreeIcon, Layers, PenLine, RefreshCw } from 'lucide-react';
import { AssociationNode, Folder, ProviderEnclave } from '../types/index';
import { AssociationTree } from './nav/AssociationTree';
import { FolderList } from './nav/FolderList';
import { EASE_OUT_EXPO, SPRING_SNAPPY } from '../lib/motion';

interface AssociationTreeNavProps {
  currentProvider: ProviderEnclave | null;
  folders: Folder[];
  associations: AssociationNode[];
  activeFilterId: string;
  onSelectFilter: (filterId: string, label: string) => void;
  onReorderAssociations: (associationIds: string[]) => void;
  onAddAssociation?: (name: string, icon?: string) => void;
  onAddAgenda?: (associationId: string, name: string, category: string) => void;
  onOpenComposer: () => void;
  onSync: () => void;
  isSyncing: boolean;
}

type NavMode = 'associations' | 'folders';

const MODES: Array<{ id: NavMode; label: string; icon: typeof Layers }> = [
  { id: 'associations', label: 'Tree', icon: TreeIcon },
  { id: 'folders', label: 'Folders', icon: Layers },
];

export function AssociationTreeNav({
  currentProvider,
  folders,
  associations,
  activeFilterId,
  onSelectFilter,
  onReorderAssociations,
  onAddAssociation,
  onAddAgenda,
  onOpenComposer,
  onSync,
  isSyncing,
}: AssociationTreeNavProps) {
  const [navMode, setNavMode] = useState<NavMode>('associations');

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
        <div className="relative grid grid-cols-2 rounded-xl bg-sunken p-1 shadow-pressed">
          {MODES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setNavMode(id)}
              className={`relative flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-colors ${
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
              initial={{ opacity: 0, x: navMode === 'folders' ? 16 : -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: navMode === 'folders' ? -16 : 16 }}
              transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
            >
              {navMode === 'associations' ? (
                <AssociationTree
                  associations={associations}
                  activeFilterId={activeFilterId}
                  onSelectFilter={onSelectFilter}
                  onReorderAssociations={onReorderAssociations}
                  onAddAssociation={onAddAssociation}
                  onAddAgenda={onAddAgenda}
                />
              ) : (
                <FolderList folders={folders} activeFilterId={activeFilterId} onSelectFilter={onSelectFilter} />
              )}
            </motion.div>
          </AnimatePresence>
        </LayoutGroup>
      </div>

      <div className="flex items-center justify-between border-t border-border/70 px-3.5 py-2 text-[10.5px] text-muted">
        <span className="flex items-center gap-2">
          <span className="relative flex size-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-moss/60" />
            <span className="relative size-2 rounded-full bg-moss" />
          </span>
          <span className="truncate">HAAT taxonomy active</span>
        </span>
        <span className="hidden font-mono text-[10px] opacity-70 xl:inline">Account → Tree</span>
      </div>
    </div>
  );
}
