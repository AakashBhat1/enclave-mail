import type { MouseEvent } from 'react';
import { motion } from 'motion/react';
import { ArrowDown, ArrowUp, FolderTree, Paperclip, Wand2 } from 'lucide-react';
import { AssociationNode, EmailMessage } from '../../types/index';
import { Pebble } from '../ui/Pebble';
import { StarButton } from '../ui/StarButton';
import { categoryStyle } from '../nav/AssociationTree';
import { colorFor, initialOf } from '../../lib/avatar';
import { formatListDate } from '../../lib/date';
import { autoFiledLabels } from '../../lib/auto-filed';
import { EASE_OUT_EXPO, SPRING_SNAPPY, staggerDelay } from '../../lib/motion';

interface MessageRowProps {
  email: EmailMessage;
  index: number;
  isSelected: boolean;
  isFirst: boolean;
  isLast: boolean;
  associations: AssociationNode[];
  onSelect: (id: string) => void;
  onToggleStar: (id: string, e: MouseEvent) => void;
  /** Only passed in Tree views; folders are always newest first and show no ↑/↓. */
  onMove?: (index: number, direction: 'up' | 'down', e: MouseEvent) => void;
  onOpenTreeMove?: (email: EmailMessage) => void;
}

const MAX_AUTO_CHIPS = 2;

export function MessageRow({
  email,
  index,
  isSelected,
  isFirst,
  isLast,
  associations,
  onSelect,
  onToggleStar,
  onMove,
  onOpenTreeMove,
}: MessageRowProps) {
  const assoc = associations.find((a) => a.id === email.associationId);
  const agenda = assoc?.agendas.find((ag) => ag.id === email.agendaId);
  const sender = email.from.name || email.from.address;
  const unread = !email.isRead;
  const autoBranches = autoFiledLabels(email, associations);

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ layout: SPRING_SNAPPY, duration: 0.55, delay: staggerDelay(index), ease: EASE_OUT_EXPO }}
      onClick={() => onSelect(email.id)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect(email.id);
        }
      }}
      role="button"
      tabIndex={0}
      aria-current={isSelected ? 'true' : undefined}
      className="group relative cursor-pointer rounded-xl px-2.5 py-2.5"
    >
      {isSelected ? (
        <motion.span layoutId="row-selected" className="absolute inset-0 rounded-xl bg-surface shadow-warm ring-1 ring-primary/15" transition={SPRING_SNAPPY} />
      ) : (
        <span className="absolute inset-0 rounded-xl bg-sunken/0 transition-colors duration-200 group-hover:bg-sunken/60" />
      )}

      <div className="relative flex gap-2.5">
        <div className="relative flex-shrink-0">
          <Pebble color={colorFor(email.from.address || sender)} size={30}>
            {initialOf(sender)}
          </Pebble>
          {unread && (
            <span className="absolute -left-1 -top-1 size-2.5 rounded-full border-2 border-[rgb(var(--surface))] bg-primary" title="Unread" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className={`truncate text-[13px] ${unread ? 'font-bold text-foreground' : 'font-medium text-foreground/80'}`}>{sender}</span>
            <div className="flex flex-shrink-0 items-center gap-1 text-[11px] text-muted">
              <div className="hidden items-center group-focus-within:flex group-hover:flex">
                {onMove && (
                  <>
                    <button type="button" disabled={isFirst} onClick={(e) => onMove(index, 'up', e)} className="icon-btn !size-6 disabled:opacity-25" title="Move up">
                      <ArrowUp className="size-3" />
                    </button>
                    <button type="button" disabled={isLast} onClick={(e) => onMove(index, 'down', e)} className="icon-btn !size-6 disabled:opacity-25" title="Move down">
                      <ArrowDown className="size-3" />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenTreeMove?.(email);
                  }}
                  className="icon-btn !size-6 hover:!text-primary"
                  title="Assign in tree"
                >
                  <FolderTree className="size-3" />
                </button>
              </div>
              {email.attachments.length > 0 && <Paperclip className="size-3" />}
              <span className="tabular-nums" title={email.date}>{formatListDate(email.timestamp, email.date)}</span>
              <StarButton starred={email.isStarred} onToggle={(e) => onToggleStar(email.id, e)} />
            </div>
          </div>

          <div className={`mt-0.5 truncate text-[13px] ${unread ? 'font-semibold text-foreground' : 'text-foreground/75'}`}>{email.subject}</div>
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted">{email.snippet}</p>

          {(assoc || email.tags.length > 0 || autoBranches.length > 0) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {assoc && (
                <span className="chip max-w-[130px] border-border bg-surface/80 text-foreground/80">
                  <span>{assoc.icon || '📌'}</span>
                  <span className="truncate">{assoc.name}</span>
                </span>
              )}
              {agenda && (
                <span className="chip max-w-[130px] border-transparent bg-sunken text-foreground/75">
                  <span className={`size-1.5 rounded-full ${categoryStyle(agenda.category).dot}`} />
                  <span className="truncate">{agenda.name}</span>
                </span>
              )}
              {autoBranches.slice(0, MAX_AUTO_CHIPS).map((branch) => (
                <span key={branch.key} className="chip max-w-[140px] border-sky/25 bg-sky/10 text-sky" title={`Auto-filed: matched “${branch.keyword}”`}>
                  <Wand2 className="size-2.5 flex-shrink-0" />
                  <span className="truncate">{branch.label}</span>
                </span>
              ))}
              {autoBranches.length > MAX_AUTO_CHIPS && (
                <span className="chip border-transparent bg-sky/10 text-sky" title={autoBranches.slice(MAX_AUTO_CHIPS).map((b) => b.label).join(', ')}>
                  +{autoBranches.length - MAX_AUTO_CHIPS}
                </span>
              )}
              {email.tags.map((tag) => (
                <span
                  key={tag}
                  className={`chip ${tag === '7brd' ? 'border-primary/30 bg-primary/10 text-primary' : 'border-transparent bg-sunken/80 text-muted'}`}
                >
                  #{tag}
                </span>
              ))}
              {onMove && <span className="ml-auto font-mono text-[10px] text-muted/60">#{email.position ?? index + 1}</span>}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
