import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Info, X } from 'lucide-react';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
}

interface ToastItem extends Required<Pick<ToastInput, 'title' | 'tone'>> {
  id: number;
  description?: string;
}

type Notify = (toast: ToastInput) => void;

const ToastContext = createContext<Notify>(() => {});

export function useToast(): Notify {
  return useContext(ToastContext);
}

const DURATION: Record<ToastTone, number> = { success: 4200, info: 4200, error: 9000 };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  const notify = useCallback<Notify>(
    ({ title, description, tone = 'info' }) => {
      const id = nextId.current++;
      // Keep the stack short; the oldest toast makes way
      setToasts((prev) => [...prev.slice(-3), { id, title, description, tone }]);
      window.setTimeout(() => dismiss(id), DURATION[tone]);
    },
    [dismiss]
  );

  const value = useMemo(() => notify, [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[75] flex w-[340px] flex-col items-end gap-2.5" aria-live="polite">
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

function ToastIcon({ tone }: { tone: ToastTone }) {
  if (tone === 'success') {
    return (
      <span className="grid size-8 flex-shrink-0 place-items-center rounded-full bg-moss/15 text-moss">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
          <path className="draw-check" d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    );
  }
  if (tone === 'error') {
    return (
      <span className="grid size-8 flex-shrink-0 place-items-center rounded-full bg-cranberry/15 text-cranberry">
        <AlertTriangle className="size-4" />
      </span>
    );
  }
  return (
    <span className="grid size-8 flex-shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
      <Info className="size-4" />
    </span>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 24, scale: 0.92, filter: 'blur(6px)' }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, x: 60, scale: 0.96, transition: { duration: 0.25 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      className="pane pointer-events-auto flex w-full items-start gap-3 !rounded-2xl p-3.5 shadow-warm-lg"
      role={toast.tone === 'error' ? 'alert' : 'status'}
    >
      <ToastIcon tone={toast.tone} />
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="text-[13px] font-semibold text-foreground">{toast.title}</div>
        {toast.description && <div className="mt-0.5 text-xs leading-relaxed text-muted">{toast.description}</div>}
      </div>
      <button type="button" onClick={onDismiss} className="icon-btn !size-6" aria-label="Dismiss">
        <X className="size-3.5" />
      </button>
      <motion.span
        className="absolute bottom-0 left-4 right-4 h-[2px] origin-left rounded-full bg-primary/30"
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: DURATION[toast.tone] / 1000, ease: 'linear' }}
      />
    </motion.div>
  );
}
