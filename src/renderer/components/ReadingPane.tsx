import { useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Download, FileText, FolderTree, Info, Lock, Reply, Sparkles, Wand2 } from 'lucide-react';
import DOMPurify from 'dompurify';
import { EmailMessage, AssociationNode } from '../types/index';
import { Envelope3D } from './fx/Envelope3D';
import { Pebble } from './ui/Pebble';
import { StarButton } from './ui/StarButton';
import { useToast } from './ui/Toast';
import { categoryStyle } from './nav/AssociationTree';
import { autoFiledLabels } from '../lib/auto-filed';
import { colorFor, initialOf } from '../lib/avatar';
import { formatFullDate } from '../lib/date';
import { EASE_OUT_EXPO } from '../lib/motion';

interface ReadingPaneProps {
  email: EmailMessage | null;
  associations?: AssociationNode[];
  onReply: (email: EmailMessage) => void;
  onTriggerMod: (emailId: string) => void;
  onToggleStar: (emailId: string) => void;
  onOpenTreeMove?: (email: EmailMessage) => void;
}

const rise = (delay: number) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, delay, ease: EASE_OUT_EXPO },
});

function EmptyReader() {
  const words = 'Pick a letter to read'.split(' ');
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <motion.div {...rise(0)}>
        <div className="float-y">
          <Envelope3D size={170} letterOut={0.35} flapOpen tilt />
        </div>
      </motion.div>
      <h3 className="display mt-12 text-[24px] leading-tight text-foreground">
        {words.map((word, i) => (
          <span key={i} className="mr-[0.25em] inline-block overflow-hidden pb-1 align-bottom">
            <span className="word-rise" style={{ animationDelay: `${0.15 + i * 0.07}s` }}>
              {word}
            </span>
          </span>
        ))}
      </h3>
      <motion.p {...rise(0.45)} className="mt-2 max-w-xs text-sm text-muted">
        Every account lives in its own local enclave. Nothing leaves this machine unless you send it.
      </motion.p>
    </div>
  );
}

export function ReadingPane({ email, associations = [], onReply, onTriggerMod, onToggleStar, onOpenTreeMove }: ReadingPaneProps) {
  const notify = useToast();

  return (
    <div className="pane flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <AnimatePresence mode="wait" initial={false}>
        {!email ? (
          <motion.div key="empty" className="h-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.2 } }}>
            <EmptyReader />
          </motion.div>
        ) : (
          <motion.div
            key={email.id}
            className="flex h-full min-h-0 flex-col"
            initial={{ opacity: 0, y: 18, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -10, filter: 'blur(4px)', transition: { duration: 0.18 } }}
            transition={{ duration: 0.55, ease: EASE_OUT_EXPO }}
          >
            <Letter
              email={email}
              associations={associations}
              onReply={onReply}
              onTriggerMod={onTriggerMod}
              onToggleStar={onToggleStar}
              onOpenTreeMove={onOpenTreeMove}
              onAttachment={(name) =>
                notify({ tone: 'info', title: 'Attachment downloads are coming soon', description: `“${name}” is listed but can’t be saved yet.` })
              }
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface LetterProps extends Omit<ReadingPaneProps, 'email'> {
  email: EmailMessage;
  associations: AssociationNode[];
  onAttachment: (filename: string) => void;
}

function Letter({ email, associations, onReply, onTriggerMod, onToggleStar, onOpenTreeMove, onAttachment }: LetterProps) {
  const assoc = associations.find((a) => a.id === email.associationId);
  const agenda = assoc?.agendas.find((ag) => ag.id === email.agendaId);
  const sender = email.from.name || email.from.address;
  const words = email.subject.split(' ');
  const autoBranches = autoFiledLabels(email, associations);

  // Sanitize the HTML for safety, stripping scripts and remote tracking pixels
  const sanitizedHtml = useMemo(
    () =>
      email.bodyHtml
        ? DOMPurify.sanitize(email.bodyHtml, {
            FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
            FORBID_ATTR: ['onerror', 'onload', 'onclick'],
          })
        : '',
    [email.bodyHtml]
  );

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 whitespace-nowrap border-b border-border/70 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onReply(email)} className="btn-primary">
            <Reply className="size-3.5" />
            Reply
          </button>
          <button type="button" onClick={() => onOpenTreeMove?.(email)} className="btn-soft" title="Move this email in the association tree">
            <FolderTree className="size-3.5" />
            <span className="hidden xl:inline">Move</span>
          </button>
          <button type="button" onClick={() => onTriggerMod(email.id)} className="btn-soft" title="Run automation mods on this email">
            <Sparkles className="size-3.5" />
            <span className="hidden xl:inline">Run mod</span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="chip border-moss/25 bg-moss/10 text-moss" title="Scripts are stripped from this email before it is shown">
            <Lock className="size-3" />
            <span className="hidden lg:inline">Sandboxed</span>
          </span>
          <StarButton starred={email.isStarred} onToggle={() => onToggleStar(email.id)} size="md" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-5 pb-8 pt-5 xl:px-8">
          {/* Tree location */}
          <motion.div {...rise(0.05)} className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            <FolderTree className="size-3.5 text-primary" />
            {assoc ? (
              <span className="chip border-border bg-surface/80 text-foreground/80">
                {assoc.icon || '📌'} {assoc.name}
              </span>
            ) : (
              <span className="italic">No association</span>
            )}
            <span className="text-muted/60">/</span>
            {agenda ? (
              <span className="chip border-transparent bg-sunken text-foreground/80">
                <span className={`size-1.5 rounded-full ${categoryStyle(agenda.category).dot}`} />
                {agenda.name}
              </span>
            ) : (
              <span className="italic">General</span>
            )}
            <span className="ml-1 font-mono text-[10px] text-muted/70">#{email.position ?? 1}</span>
            <button type="button" onClick={() => onOpenTreeMove?.(email)} className="link-draw ml-auto font-semibold text-primary">
              Change node
            </button>
          </motion.div>

          {autoBranches.length > 0 && (
            <motion.div {...rise(0.08)} className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
              <Wand2 className="size-3.5 text-sky" />
              <span>Auto-filed in</span>
              {autoBranches.map((branch) => (
                <span key={branch.key} className="chip border-sky/25 bg-sky/10 text-sky" title={`Matched “${branch.keyword}”`}>
                  {branch.label}
                  <span className="font-normal opacity-70">· {branch.keyword}</span>
                </span>
              ))}
            </motion.div>
          )}

          {/* Subject: each word rises out of its own mask */}
          <h1 className="display mt-3 text-[24px] leading-[1.18] text-foreground xl:text-[27px]">
            {words.map((word, i) => (
              <span key={i} className="mr-[0.24em] inline-block overflow-hidden pb-[0.08em] align-bottom">
                <span className="word-rise" style={{ animationDelay: `${0.05 + Math.min(i, 12) * 0.035}s` }}>
                  {word}
                </span>
              </span>
            ))}
          </h1>

          <motion.div {...rise(0.18)} className="mt-4 flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <Pebble color={colorFor(email.from.address || sender)} size={36}>
                {initialOf(sender)}
              </Pebble>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">
                  {email.from.name} <span className="font-normal text-muted">&lt;{email.from.address}&gt;</span>
                </div>
                <div className="truncate text-xs text-muted">To {email.to.map((t) => t.name || t.address).join(', ')}</div>
              </div>
            </div>
            <div className="flex-shrink-0 text-xs tabular-nums text-muted">{formatFullDate(email.timestamp, email.date)}</div>
          </motion.div>

          {email.tags.length > 0 && (
            <motion.div {...rise(0.24)} className="mt-4 flex flex-wrap gap-1.5">
              {email.tags.map((tag) => (
                <span key={tag} className="chip border-primary/20 bg-primary/10 text-primary">
                  #{tag}
                </span>
              ))}
            </motion.div>
          )}

          {email.attachments.length > 0 && (
            <motion.div {...rise(0.28)} className="mt-5 flex flex-wrap gap-2">
              {email.attachments.map((att) => (
                <motion.button
                  key={att.id}
                  type="button"
                  whileHover={{ y: -2 }}
                  onClick={() => onAttachment(att.filename)}
                  className="card group flex items-center gap-2.5 !rounded-xl px-3 py-2 text-left text-xs"
                >
                  <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
                    <FileText className="size-4" />
                  </span>
                  <span>
                    <span className="block max-w-[180px] truncate font-semibold text-foreground">{att.filename}</span>
                    <span className="text-[10.5px] text-muted">{Math.max(1, Math.round(att.size / 1024))} KB</span>
                  </span>
                  <Download className="ml-1 size-3.5 text-muted transition-colors group-hover:text-primary" />
                </motion.button>
              ))}
            </motion.div>
          )}

          {email.bodyTruncated && (
            <motion.div {...rise(0.3)} className="mt-5 flex items-center gap-2 rounded-xl border border-marigold/30 bg-marigold/10 px-3 py-2 text-[11.5px] text-foreground/80">
              <Info className="size-3.5 flex-shrink-0 text-marigold" />
              This is a very large letter from your history, so only its first part was stored. Attachments may be incomplete.
            </motion.div>
          )}

          {/* The letter itself, on paper */}
          <motion.div
            initial={{ opacity: 0, y: 24, clipPath: 'inset(0 0 100% 0 round 16px)' }}
            animate={{ opacity: 1, y: 0, clipPath: 'inset(0 0 0% 0 round 16px)', transitionEnd: { clipPath: 'none' } }}
            transition={{ duration: 0.9, delay: 0.22, ease: EASE_OUT_EXPO }}
            className="mt-6 select-text rounded-2xl border border-[#E9DCC9] bg-[#FFFDF8] p-5 text-[#2B1E16] shadow-warm xl:p-6"
          >
            {email.bodyHtml ? (
              <div className="overflow-x-auto text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />
            ) : (
              <div className="whitespace-pre-wrap text-[14.5px] leading-[1.75]">{email.bodyText || email.snippet}</div>
            )}
          </motion.div>
        </div>
      </div>
    </>
  );
}
