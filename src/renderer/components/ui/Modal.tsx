import { useEffect, type ReactNode } from 'react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { X, type LucideIcon } from 'lucide-react';
import { EASE_IN_OUT, EASE_OUT_EXPO } from '../../lib/motion';

/** 'fold' collapses the card toward the centre like a letter being folded (used after a send). */
export type ModalExit = 'dismiss' | 'fold';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  widthClass?: string;
  exitMode?: ModalExit;
  labelledBy?: string;
}

const backdrop: Variants = {
  hidden: { opacity: 0, backdropFilter: 'blur(0px)' },
  shown: { opacity: 1, backdropFilter: 'blur(10px)', transition: { duration: 0.4, ease: EASE_OUT_EXPO } },
  exit: (mode: ModalExit) => ({
    opacity: 0,
    backdropFilter: 'blur(0px)',
    transition: { duration: mode === 'fold' ? 0.5 : 0.25, ease: EASE_IN_OUT },
  }),
};

const card: Variants = {
  hidden: { opacity: 0, y: 24, scale: 0.96, rotateX: 8, filter: 'blur(8px)' },
  shown: {
    opacity: 1,
    y: 0,
    scale: 1,
    rotateX: 0,
    filter: 'blur(0px)',
    transition: { type: 'spring', stiffness: 300, damping: 30, filter: { duration: 0.35 } },
  },
  exit: (mode: ModalExit) =>
    mode === 'fold'
      ? {
          opacity: 0,
          scaleX: 0.28,
          scaleY: 0.12,
          rotateX: 55,
          y: 60,
          filter: 'blur(4px)',
          transition: { duration: 0.42, ease: EASE_IN_OUT },
        }
      : { opacity: 0, y: 12, scale: 0.97, filter: 'blur(6px)', transition: { duration: 0.2, ease: EASE_IN_OUT } },
};

export function Modal({ isOpen, onClose, children, widthClass = 'max-w-lg', exitMode = 'dismiss', labelledBy }: ModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence custom={exitMode}>
      {isOpen && (
        <motion.div
          key="modal"
          custom={exitMode}
          variants={backdrop}
          initial="hidden"
          animate="shown"
          exit="exit"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(var(--shadow)/0.28)] p-6 dark:bg-black/50"
          style={{ perspective: 1200 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            custom={exitMode}
            variants={card}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            className={`pane flex max-h-[88vh] w-full flex-col overflow-hidden !rounded-[26px] shadow-warm-lg ${widthClass}`}
            style={{ transformOrigin: '50% 60%' }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface ModalHeaderProps {
  id?: string;
  icon: LucideIcon;
  title: string;
  subtitle?: ReactNode;
  tone?: 'primary' | 'moss' | 'sky' | 'cranberry';
  onClose: () => void;
}

const TONES = {
  primary: 'from-[#F0A070] to-[#C4541C]',
  moss: 'from-[#A9B57A] to-[#5F6B3A]',
  sky: 'from-[#8DB8BE] to-[#3F6C73]',
  cranberry: 'from-[#D98088] to-[#8E2F36]',
};

export function ModalHeader({ id, icon: Icon, title, subtitle, tone = 'primary', onClose }: ModalHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-5">
      <div className="flex items-center gap-3.5">
        <motion.div
          initial={{ scale: 0.5, rotate: -20, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 18, delay: 0.08 }}
          className={`grid size-11 place-items-center rounded-[14px] bg-gradient-to-br text-white shadow-warm ${TONES[tone]}`}
          style={{ boxShadow: '0 1px 0 rgba(255,255,255,.35) inset, 0 -2px 4px rgba(0,0,0,.15) inset, 0 8px 18px -8px rgba(120,60,20,.5)' }}
        >
          <Icon className="size-5" strokeWidth={1.9} />
        </motion.div>
        <div>
          <motion.h2
            id={id}
            className="display text-[22px] leading-tight text-foreground"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE_OUT_EXPO, delay: 0.1 }}
          >
            {title}
          </motion.h2>
          {subtitle && (
            <motion.div
              className="mt-0.5 text-xs text-muted"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              {subtitle}
            </motion.div>
          )}
        </div>
      </div>
      <button type="button" onClick={onClose} className="icon-btn -mr-2 group" aria-label="Close">
        <X className="size-4 transition-transform duration-300 group-hover:rotate-90" />
      </button>
    </div>
  );
}
