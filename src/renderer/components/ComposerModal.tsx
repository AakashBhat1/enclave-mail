import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useAnimate } from 'motion/react';
import { AlertTriangle, Lock, PenLine, Send } from 'lucide-react';
import { IpcResult, ProviderEnclave, SendEmailInput, SendOutcome } from '../types/index';
import { Modal, ModalHeader, type ModalExit } from './ui/Modal';
import { Pebble } from './ui/Pebble';
import type { FlightOrigin } from './fx/SendFlight';
import { initialOf } from '../lib/avatar';
import { EASE_OUT_EXPO } from '../lib/motion';

type SendResult = IpcResult<SendOutcome>;

export interface SentInfo {
  to: string;
  subject: string;
  warning?: string;
  serverResponse?: string;
  origin: FlightOrigin;
}

interface ComposerModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentProvider: ProviderEnclave | null;
  onSend: (emailData: SendEmailInput) => Promise<SendResult>;
  /** Called after a successful send; the parent closes the composer and plays the flight. */
  onSent: (info: SentInfo) => void;
  exitMode: ModalExit;
  initialTo?: string;
  initialSubject?: string;
}

export function ComposerModal({ isOpen, onClose, exitMode, ...formProps }: ComposerModalProps) {
  const [isSending, setIsSending] = useState(false);
  const close = () => {
    if (!isSending) onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={close} exitMode={exitMode} widthClass="max-w-2xl" labelledBy="composer-title">
      {/* Mounted fresh on every open, so Reply's recipient and subject are picked up each time */}
      <ComposerForm {...formProps} onClose={close} onSendingChange={setIsSending} />
    </Modal>
  );
}

interface ComposerFormProps extends Omit<ComposerModalProps, 'isOpen' | 'exitMode'> {
  onSendingChange: (sending: boolean) => void;
}

function Field({ label, children, trailing }: { label: string; children: ReactNode; trailing?: ReactNode }) {
  return (
    <label className="group relative flex items-center gap-3 border-b border-border/80 py-2.5">
      <span className="eyebrow w-14 flex-shrink-0">{label}</span>
      {children}
      {trailing}
      <span className="absolute -bottom-px left-0 h-[1.5px] w-full origin-left scale-x-0 bg-primary transition-transform duration-500 ease-out-expo group-focus-within:scale-x-100" />
    </label>
  );
}

const inputClass = 'min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted/50';

function ComposerForm({ onClose, currentProvider, onSend, onSent, onSendingChange, initialTo = '', initialSubject = '' }: ComposerFormProps) {
  const [to, setTo] = useState(initialTo);
  const [cc, setCc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLFormElement>(null);
  const [scope, animate] = useAnimate();

  const setSending = (value: boolean) => {
    setIsSending(value);
    onSendingChange(value);
  };

  const fail = (message: string) => {
    setError(message);
    animate(scope.current, { x: [0, -10, 10, -6, 6, -2, 0] }, { duration: 0.5 });
  };

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentProvider) return fail('Add a mail account before sending.');
    if (!to || !subject) return fail('Please enter both recipient and subject.');

    setError(null);
    setSending(true);
    const result = await onSend({ to, cc: showCc ? cc : undefined, subject, body, providerId: currentProvider.id }).catch(
      (err: unknown): SendResult => ({ success: false, error: String(err) })
    );
    setSending(false);

    if (!result.success) return fail(result.error ?? 'Sending failed.');

    const rect = rootRef.current?.getBoundingClientRect();
    const origin = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    onSent({ to, subject, warning: result.data?.warning, serverResponse: result.data?.serverResponse, origin });
  };

  return (
    <div ref={scope} className="relative flex min-h-0 flex-col">
      {/* Progress sweep while the message is in flight to the SMTP server */}
      <AnimatePresence>
        {isSending && (
          <motion.div className="absolute inset-x-0 top-0 z-10 h-[2px] overflow-hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <span className="sync-sweep absolute inset-y-0 left-0 w-2/5 bg-gradient-to-r from-transparent via-primary to-transparent" />
          </motion.div>
        )}
      </AnimatePresence>

      <ModalHeader
        id="composer-title"
        icon={PenLine}
        title="New letter"
        onClose={onClose}
        subtitle={
          currentProvider ? (
            <span className="flex items-center gap-1.5">
              <Pebble color={currentProvider.avatarColor} size={16} className="!text-[8px]">
                {initialOf(currentProvider.name)}
              </Pebble>
              From {currentProvider.name} · {currentProvider.email}
            </span>
          ) : (
            'No account selected'
          )
        }
      />

      <form ref={rootRef} onSubmit={handleSend} className="flex min-h-0 flex-1 flex-col px-6 pb-5">
        <Field
          label="To"
          trailing={
            !showCc && (
              <button type="button" onClick={() => setShowCc(true)} className="link-draw text-xs font-semibold text-primary">
                Cc
              </button>
            )
          }
        >
          <input type="email" required placeholder="recipient@example.com" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} autoFocus={!initialTo} />
        </Field>

        <AnimatePresence initial={false}>
          {showCc && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: EASE_OUT_EXPO }} className="overflow-hidden">
              <Field label="Cc">
                <input type="email" placeholder="colleague@example.com" value={cc} onChange={(e) => setCc(e.target.value)} className={inputClass} autoFocus />
              </Field>
            </motion.div>
          )}
        </AnimatePresence>

        <Field label="Subject">
          <input type="text" required placeholder="What is this about?" value={subject} onChange={(e) => setSubject(e.target.value)} className={`${inputClass} font-semibold`} autoFocus={!!initialTo} />
        </Field>

        {/* Ruled letter paper; lines scroll with the text */}
        <textarea
          required
          placeholder="Dear…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="mt-4 min-h-[240px] flex-1 resize-none rounded-2xl border border-border/70 bg-surface/70 px-5 py-[14px] text-[14.5px] leading-[28px] text-foreground outline-none transition-[border-color,box-shadow] duration-300 placeholder:text-muted/50 focus:border-primary/40 focus:ring-4 focus:ring-primary/10"
          style={{
            backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0, transparent 27px, rgb(var(--border) / .55) 27px, rgb(var(--border) / .55) 28px)',
            backgroundPositionY: '13px',
            backgroundAttachment: 'local',
          }}
        />

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-cranberry/25 bg-cranberry/10 p-3 text-xs text-cranberry">
                <AlertTriangle className="mt-0.5 size-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-4 flex items-center justify-between">
          <span className="chip border-moss/25 bg-moss/10 text-moss">
            <Lock className="size-3" />
            Encrypted SMTP (TLS)
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={isSending} className="btn-ghost">
              Discard
            </button>
            <button type="submit" disabled={isSending} className="btn-primary group !px-5 !py-2.5 disabled:!opacity-90">
              <AnimatePresence mode="popLayout" initial={false}>
                {isSending ? (
                  <motion.span key="sending" className="flex items-center gap-2" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                    <span className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Sending…
                  </motion.span>
                ) : (
                  <motion.span key="idle" className="flex items-center gap-2" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                    <Send className="size-3.5 transition-transform duration-500 ease-out-expo group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:-rotate-12" />
                    Send letter
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
