import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { Mic, Search, X } from 'lucide-react';
import { AssociationNode, EmailMessage } from '../types/index';
import { VoiceSearchButton } from './VoiceSearchButton';
import { MessageRow } from './list/MessageRow';
import { MessageSkeleton } from './fx/Skeleton';
import { Envelope3D } from './fx/Envelope3D';
import { EASE_OUT_EXPO, SPRING_SNAPPY } from '../lib/motion';

interface MessageListProps {
  emails: EmailMessage[];
  selectedEmailId: string | null;
  associations?: AssociationNode[];
  title: string;
  /** Changes when the account or folder changes, so rows replay their entrance. */
  listKey: string;
  isLoading?: boolean;
  isSyncing?: boolean;
  onSelectEmail: (id: string) => void;
  onToggleStar: (id: string, e: MouseEvent) => void;
  onSelectFolder?: (folderId: string) => void;
  onReorderEmails?: (emailIds: string[]) => void;
  onOpenTreeMove?: (email: EmailMessage) => void;
  /** True only for Tree views (associations/agendas); folders and People stay newest first. */
  canReorder?: boolean;
}

type FilterMode = 'all' | 'unread' | 'starred';

// With full history a folder can hold thousands of letters; rows mount a page at a time as you scroll
const PAGE_SIZE = 80;

/** Grows the rendered window when the sentinel at the bottom of the list scrolls into view. */
function usePagedCount(resetKey: string): [number, (node: HTMLDivElement | null) => void] {
  const [count, setCount] = useState(PAGE_SIZE);
  const observer = useRef<IntersectionObserver | null>(null);
  useEffect(() => setCount(PAGE_SIZE), [resetKey]);
  useEffect(() => () => observer.current?.disconnect(), []);
  const sentinel = (node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!node) return;
    observer.current = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setCount((n) => n + PAGE_SIZE);
      },
      { rootMargin: '400px' }
    );
    observer.current.observe(node);
  };
  return [count, sentinel];
}

export function MessageList({
  emails,
  selectedEmailId,
  associations = [],
  title,
  listKey,
  isLoading = false,
  isSyncing = false,
  onSelectEmail,
  onToggleStar,
  onSelectFolder,
  onReorderEmails,
  onOpenTreeMove,
  canReorder = false,
}: MessageListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [lastVoiceQuery, setLastVoiceQuery] = useState<string | null>(null);
  const [visibleCount, sentinelRef] = usePagedCount(`${listKey}|${filterMode}|${searchQuery}`);

  // Row indices refer to the filtered view, so swap the two visible neighbours inside the full order
  const handleMoveEmail = (index: number, direction: 'up' | 'down', e: MouseEvent) => {
    e.stopPropagation();
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= filteredEmails.length) return;
    const ids = emails.map((m) => m.id);
    const from = ids.indexOf(filteredEmails[index].id);
    const to = ids.indexOf(filteredEmails[target].id);
    [ids[from], ids[to]] = [ids[to], ids[from]];
    onReorderEmails?.(ids);
  };

  const handleVoiceTranscript = (query: string) => {
    setSearchQuery(query);
    setLastVoiceQuery(query || null);
  };

  const handleVoiceCommand = (cmd: { type: 'filter' | 'folder' | 'clear'; value: string }) => {
    if (cmd.type === 'folder' && onSelectFolder) {
      onSelectFolder(cmd.value);
    } else if (cmd.type === 'filter') {
      setSearchQuery(cmd.value);
      setLastVoiceQuery(cmd.value);
    } else if (cmd.type === 'clear') {
      setSearchQuery('');
      setLastVoiceQuery(null);
    }
  };

  const unreadCount = emails.filter((e) => !e.isRead).length;
  const filteredEmails = emails.filter((email) => {
    if (filterMode === 'unread' && email.isRead) return false;
    if (filterMode === 'starred' && !email.isStarred) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      email.subject.toLowerCase().includes(q) ||
      email.from.name.toLowerCase().includes(q) ||
      email.from.address.toLowerCase().includes(q) ||
      email.snippet.toLowerCase().includes(q) ||
      email.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  const chips: Array<{ id: FilterMode; label: string }> = [
    { id: 'all', label: `All ${emails.length}` },
    { id: 'unread', label: unreadCount ? `Unread ${unreadCount}` : 'Unread' },
    { id: 'starred', label: 'Starred' },
  ];

  return (
    <div className="pane flex h-full w-[300px] flex-shrink-0 flex-col overflow-hidden lg:w-[320px] xl:w-[360px]">
      {/* Sync light sweep along the top edge */}
      <AnimatePresence>
        {isSyncing && (
          <motion.div
            className="absolute inset-x-0 top-0 z-10 h-[2px] overflow-hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <span className="sync-sweep absolute inset-y-0 left-0 w-2/5 bg-gradient-to-r from-transparent via-primary to-transparent" />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="space-y-2.5 px-3.5 pb-2.5 pt-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="display min-w-0 truncate text-[22px] leading-none text-foreground">
            <span key={title} className="word-mask -mr-[0.15em] pb-1 align-bottom">
              <span className="word-rise">{title}</span>
            </span>
          </h1>
          <AnimatePresence mode="popLayout">
            <motion.span
              key={isSyncing ? 'sync' : 'idle'}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="eyebrow flex-shrink-0"
            >
              {isSyncing ? 'Syncing…' : `${unreadCount} new`}
            </motion.span>
          </AnimatePresence>
        </div>

        <div className="group relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted transition-colors group-focus-within:text-primary" />
          <input
            type="text"
            placeholder="Search, or speak “7brd”…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="field !rounded-xl !py-2 !pl-9 !pr-10"
          />
          <div className="absolute right-1.5 top-1/2 z-30 -translate-y-1/2">
            <VoiceSearchButton onTranscript={handleVoiceTranscript} onVoiceCommand={handleVoiceCommand} />
          </div>
        </div>

        <AnimatePresence>
          {lastVoiceQuery && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
              className="overflow-hidden"
            >
              <div className="flex items-center justify-between rounded-xl border border-primary/25 bg-primary/10 px-3 py-1.5 text-[11px] text-primary">
                <span className="flex items-center gap-1.5">
                  <Mic className="size-3" />
                  Voice filter: <strong>“{lastVoiceQuery}”</strong>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setLastVoiceQuery(null);
                  }}
                  className="rounded p-0.5 hover:bg-primary/15"
                  aria-label="Clear voice filter"
                >
                  <X className="size-3" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex gap-1">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => setFilterMode(chip.id)}
              className={`relative rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
                filterMode === chip.id ? 'text-white' : 'text-muted hover:text-foreground'
              }`}
            >
              {filterMode === chip.id && (
                <motion.span layoutId="list-chip" className="absolute inset-0 rounded-full bg-foreground shadow-warm dark:bg-primary" transition={SPRING_SNAPPY} />
              )}
              <span className="relative">{chip.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {isLoading && emails.length === 0 ? (
          <MessageSkeleton />
        ) : filteredEmails.length === 0 ? (
          <EmptyList query={searchQuery} />
        ) : (
          <LayoutGroup id={listKey}>
            <div key={listKey} className="space-y-0.5">
              {filteredEmails.slice(0, visibleCount).map((email, index) => (
                <MessageRow
                  key={email.id}
                  email={email}
                  index={index}
                  isSelected={email.id === selectedEmailId}
                  isFirst={index === 0}
                  isLast={index === filteredEmails.length - 1}
                  associations={associations}
                  onSelect={onSelectEmail}
                  onToggleStar={onToggleStar}
                  onMove={canReorder ? handleMoveEmail : undefined}
                  onOpenTreeMove={onOpenTreeMove}
                />
              ))}
              {filteredEmails.length > visibleCount && (
                <div ref={sentinelRef} className="py-3 text-center text-[11px] text-muted">
                  Showing {visibleCount.toLocaleString()} of {filteredEmails.length.toLocaleString()}…
                </div>
              )}
            </div>
          </LayoutGroup>
        )}
      </div>
    </div>
  );
}

function EmptyList({ query }: { query: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: EASE_OUT_EXPO }}
      className="flex flex-col items-center px-6 pt-16 text-center"
    >
      <div className="float-y">
        <Envelope3D size={96} />
      </div>
      <p className="display mt-10 text-lg text-foreground">{query ? 'No matches' : 'All quiet here'}</p>
      <p className="mt-1 text-xs text-muted">{query ? `Nothing in this folder mentions “${query}”.` : 'No letters in this folder yet.'}</p>
    </motion.div>
  );
}
