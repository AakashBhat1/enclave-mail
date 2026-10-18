import { motion } from 'motion/react';
import { Archive, FileText, Folder as FolderIcon, Inbox, Send, Star } from 'lucide-react';
import { Folder } from '../../types/index';
import { EASE_OUT_EXPO, SPRING_SNAPPY, staggerDelay } from '../../lib/motion';

interface FolderListProps {
  folders: Folder[];
  activeFilterId: string;
  onSelectFilter: (filterId: string, label: string) => void;
}

const ICONS: Record<string, typeof Inbox> = {
  inbox: Inbox,
  starred: Star,
  sent: Send,
  drafts: FileText,
  archive: Archive,
};

export function FolderList({ folders, activeFilterId, onSelectFilter }: FolderListProps) {
  return (
    <div>
      <div className="eyebrow px-3 pb-2 pt-1">Folders</div>
      <div className="space-y-0.5">
        {folders.map((folder, index) => {
          const isActive = folder.id === activeFilterId;
          const Icon = ICONS[folder.id] ?? FolderIcon;
          return (
            <motion.button
              key={folder.id}
              type="button"
              onClick={() => onSelectFilter(folder.id, folder.name)}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: staggerDelay(index, 0.04), ease: EASE_OUT_EXPO }}
              className={`relative flex w-full items-center justify-between rounded-xl px-3 py-2 text-[13px] font-medium transition-colors ${
                isActive ? 'text-foreground' : 'text-muted hover:bg-sunken/70 hover:text-foreground'
              }`}
            >
              {isActive && (
                <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl bg-surface shadow-warm" transition={SPRING_SNAPPY}>
                  <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
                </motion.span>
              )}
              <span className="relative flex items-center gap-3">
                <Icon className={`size-4 ${isActive ? 'text-primary' : ''}`} strokeWidth={isActive ? 2.2 : 1.8} />
                <span>{folder.name}</span>
              </span>
              {folder.unreadCount > 0 && (
                <span
                  className={`relative min-w-[22px] rounded-full px-1.5 py-0.5 text-center text-[10.5px] font-bold ${
                    isActive ? 'bg-primary text-white' : 'bg-sunken text-muted'
                  }`}
                >
                  {folder.unreadCount}
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
