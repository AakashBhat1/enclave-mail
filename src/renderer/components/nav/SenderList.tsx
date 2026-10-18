import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { AtSign, CheckCheck, PenLine, Search, User } from 'lucide-react';
import type { SenderGroup, SenderGroupMode } from '../../types/index';
import { Pebble } from '../ui/Pebble';
import { colorFor, initialOf } from '../../lib/avatar';
import { formatListDate } from '../../lib/date';
import { EASE_OUT_EXPO, SPRING_SNAPPY, staggerDelay } from '../../lib/motion';

type SortMode = 'count' | 'recent' | 'unread';

// Thousands of correspondents would make the pane sluggish; more appear on demand
const PAGE_SIZE = 120;

const SORTS: Array<{ id: SortMode; label: string }> = [
  { id: 'count', label: 'Most mail' },
  { id: 'recent', label: 'Latest' },
  { id: 'unread', label: 'Unread' },
];

const SORTERS: Record<SortMode, (a: SenderGroup, b: SenderGroup) => number> = {
  count: (a, b) => b.count - a.count || b.latestTimestamp - a.latestTimestamp,
  recent: (a, b) => b.latestTimestamp - a.latestTimestamp,
  unread: (a, b) => b.unread - a.unread || b.latestTimestamp - a.latestTimestamp,
};

interface SenderListProps {
  groups: SenderGroup[];
  mode: SenderGroupMode;
  activeFilterId: string;
  onModeChange: (mode: SenderGroupMode) => void;
  onSelectFilter: (filterId: string, label: string) => void;
  onMarkRead: (group: SenderGroup) => void;
  onCompose: (address: string) => void;
}

export function SenderList({ groups, mode, activeFilterId, onModeChange, onSelectFilter, onMarkRead, onCompose }: SenderListProps) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('count');
  const [limit, setLimit] = useState(PAGE_SIZE);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q ? groups.filter((g) => g.label.toLowerCase().includes(q) || g.address.includes(q)) : groups;
    return [...matched].sort(SORTERS[sort]);
  }, [groups, query, sort]);

  return (
    <div>
      <div className="flex items-center justify-between px-3 pb-2 pt-1">
        <span className="eyebrow">{mode === 'domain' ? 'Domains' : 'People'}</span>
        <div className="flex rounded-lg bg-sunken p-0.5 shadow-pressed">
          {(['sender', 'domain'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onModeChange(m)}
              className={`grid size-6 place-items-center rounded-md transition-colors ${mode === m ? 'bg-surface text-primary shadow-warm' : 'text-muted hover:text-foreground'}`}
              title={m === 'sender' ? 'Group by person' : 'Group by domain'}
              aria-pressed={mode === m}
            >
              {m === 'sender' ? <User className="size-3.5" /> : <AtSign className="size-3.5" />}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5 px-1.5 pb-2">
        <div className="group relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted transition-colors group-focus-within:text-primary" />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE_SIZE);
            }}
            placeholder={mode === 'domain' ? 'Find a domain…' : 'Find a person…'}
            className="field !rounded-lg !py-1.5 !pl-8 !text-xs"
          />
        </div>
        <div className="flex gap-1">
          {SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSort(s.id)}
              className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold transition-colors ${
                sort === s.id ? 'bg-foreground text-white dark:bg-primary' : 'text-muted hover:text-foreground'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-muted">{query ? 'Nobody matches that.' : 'No received mail yet.'}</p>
      ) : (
        <div className="space-y-0.5">
          {visible.slice(0, limit).map((group, index) => (
            <SenderRow
              key={group.id}
              group={group}
              mode={mode}
              index={index}
              isActive={group.id === activeFilterId}
              onSelect={() => onSelectFilter(group.id, group.label)}
              onMarkRead={() => onMarkRead(group)}
              onCompose={() => onCompose(group.address)}
            />
          ))}
          {visible.length > limit && (
            <button type="button" onClick={() => setLimit((n) => n + PAGE_SIZE)} className="btn-ghost w-full !py-1.5 !text-[11px]">
              Show {Math.min(PAGE_SIZE, visible.length - limit)} more of {visible.length - limit}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface SenderRowProps {
  group: SenderGroup;
  mode: SenderGroupMode;
  index: number;
  isActive: boolean;
  onSelect: () => void;
  onMarkRead: () => void;
  onCompose: () => void;
}

function SenderRow({ group, mode, index, isActive, onSelect, onMarkRead, onCompose }: SenderRowProps) {
  const subline = mode === 'domain' ? `${group.members} ${group.members === 1 ? 'sender' : 'senders'} · ${formatListDate(group.latestTimestamp, '')}` : group.address;
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.45, delay: staggerDelay(index, 0.03), ease: EASE_OUT_EXPO }}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
      aria-current={isActive ? 'true' : undefined}
      title={group.latestSubject ? `Latest: ${group.latestSubject}` : undefined}
      className={`group relative flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors ${
        isActive ? 'text-foreground' : 'text-foreground/85 hover:bg-sunken/70'
      }`}
    >
      {isActive && (
        <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl bg-surface shadow-warm" transition={SPRING_SNAPPY}>
          <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
        </motion.span>
      )}
      <span className="relative">
        <Pebble color={colorFor(group.address)} size={26}>
          {mode === 'domain' ? <AtSign className="size-3" /> : initialOf(group.label)}
        </Pebble>
      </span>
      <span className="relative min-w-0 flex-1">
        <span className={`block truncate text-[12.5px] ${group.unread > 0 ? 'font-bold' : 'font-semibold'}`}>{group.label}</span>
        <span className="block truncate text-[10.5px] text-muted">{subline}</span>
      </span>

      <span className="relative flex flex-shrink-0 items-center gap-0.5">
        <span className="hidden items-center group-focus-within:flex group-hover:flex">
          {group.unread > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMarkRead();
              }}
              className="icon-btn !size-6 hover:!text-moss"
              title="Mark all as read"
            >
              <CheckCheck className="size-3" />
            </button>
          )}
          {mode === 'sender' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCompose();
              }}
              className="icon-btn !size-6 hover:!text-primary"
              title={`Write to ${group.address}`}
            >
              <PenLine className="size-3" />
            </button>
          )}
        </span>
        <span
          className={`min-w-[22px] rounded-full px-1.5 py-0.5 text-center text-[10.5px] font-bold tabular-nums group-hover:hidden ${
            group.unread > 0 ? 'bg-primary text-white' : 'bg-sunken text-muted'
          }`}
          title={`${group.count} letters, ${group.unread} unread`}
        >
          {group.unread > 0 ? group.unread : group.count}
        </span>
      </span>
    </motion.div>
  );
}
