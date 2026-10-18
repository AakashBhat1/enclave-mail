import { AnimatePresence, motion } from 'motion/react';
import { Plus, Sliders, ShieldCheck, X } from 'lucide-react';
import { ProviderEnclave } from '../types/index';
import { Pebble } from './ui/Pebble';
import { ThemeToggle } from './ui/ThemeToggle';
import { SPRING_SNAPPY, staggerDelay } from '../lib/motion';
import { initialOf } from '../lib/avatar';
import type { Theme } from '../lib/theme';

interface WorkspaceDockProps {
  providers: ProviderEnclave[];
  activeProviderId: string;
  onSelectProvider: (id: string) => void;
  onOpenAddModal: () => void;
  onOpenModsModal: () => void;
  onRemoveProvider: (id: string) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}

function BrandSeal() {
  return (
    <motion.div
      whileHover={{ rotate: -12, scale: 1.06 }}
      transition={{ type: 'spring', stiffness: 300, damping: 12 }}
      className="relative grid size-10 place-items-center"
      title="Enclave Mail"
    >
      <span
        className="absolute inset-0"
        style={{
          borderRadius: '46% 54% 50% 50% / 52% 46% 54% 48%',
          background: 'radial-gradient(circle at 34% 28%, #EC9358, #C4541C 48%, #8E2F36 100%)',
          boxShadow: '0 1px 0 rgba(255,255,255,.35) inset, 0 -3px 5px rgba(0,0,0,.22) inset, 0 10px 22px -10px rgba(142,47,54,.8)',
        }}
      />
      <span className="absolute inset-[6px] rounded-full border border-white/25" />
      <span className="display relative text-[19px] italic text-white/90" style={{ textShadow: '0 -1px 0 rgba(0,0,0,.25)' }}>
        E
      </span>
    </motion.div>
  );
}

export function WorkspaceDock({
  providers,
  activeProviderId,
  onSelectProvider,
  onOpenAddModal,
  onOpenModsModal,
  onRemoveProvider,
  theme,
  onThemeChange,
}: WorkspaceDockProps) {
  return (
    <aside className="pane z-20 flex h-full w-16 flex-shrink-0 flex-col items-center py-3">
      <BrandSeal />
      <div className="my-3 h-px w-7 bg-border" />

      {/* No scroll container here: it would clip the hover cards that slide out to the right */}
      <div className="flex w-full flex-1 flex-col items-center gap-3 py-1">
        {providers.map((p, index) => {
          const isActive = p.id === activeProviderId;
          return (
            <motion.div
              key={p.id}
              className="group relative flex items-center"
              initial={{ opacity: 0, x: -16, scale: 0.8 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              transition={{ ...SPRING_SNAPPY, delay: 0.2 + staggerDelay(index, 0.06) }}
            >
              {isActive && (
                <motion.span
                  layoutId="dock-active"
                  className="absolute -left-[11px] h-7 w-1 rounded-r-full bg-primary shadow-[0_0_12px_rgb(var(--primary)/0.6)]"
                  transition={SPRING_SNAPPY}
                />
              )}

              <motion.button
                type="button"
                onClick={() => onSelectProvider(p.id)}
                whileHover={{ y: -2, scale: 1.06 }}
                whileTap={{ scale: 0.94 }}
                transition={SPRING_SNAPPY}
                className={`relative rounded-[15px] transition-[box-shadow,opacity] duration-300 ${
                  isActive ? 'ring-2 ring-primary/70 ring-offset-2 ring-offset-[rgb(var(--surface))]' : 'opacity-75 hover:opacity-100'
                }`}
                aria-label={`${p.name} (${p.email})`}
              >
                <Pebble color={p.avatarColor} size={38}>
                  {initialOf(p.name)}
                </Pebble>
                <AnimatePresence>
                  {p.unreadTotal > 0 && (
                    <motion.span
                      key={p.unreadTotal}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      exit={{ scale: 0 }}
                      transition={{ type: 'spring', stiffness: 600, damping: 18 }}
                      className="absolute -right-1.5 -top-1.5 min-w-[20px] rounded-full border-2 border-[rgb(var(--surface))] bg-cranberry px-1.5 text-center text-[10px] font-bold leading-4 text-white"
                    >
                      {p.unreadTotal > 99 ? '99+' : p.unreadTotal}
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>

              {/* Hover card with the account identity */}
              <span className="pointer-events-none absolute left-[52px] z-30 hidden translate-x-1 whitespace-nowrap rounded-xl border border-border bg-surface px-3 py-2 opacity-0 shadow-warm transition-all duration-300 ease-out-expo group-hover:block group-hover:translate-x-0 group-hover:opacity-100">
                <span className="block text-xs font-semibold text-foreground">{p.name}</span>
                <span className="block text-[11px] text-muted">{p.email}</span>
              </span>

              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Remove ${p.email} from this app? Mail on the server is not touched.`)) {
                    onRemoveProvider(p.id);
                  }
                }}
                className="absolute -bottom-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-surface text-muted opacity-0 shadow-warm transition-[opacity,color,background-color] hover:bg-cranberry hover:text-white focus-visible:opacity-100 group-hover:opacity-100"
                aria-label={`Remove ${p.email}`}
              >
                <X className="size-3" />
              </button>
            </motion.div>
          );
        })}

        <motion.button
          type="button"
          onClick={onOpenAddModal}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          className="group grid size-[38px] place-items-center rounded-[13px] border-[1.5px] border-dashed border-border text-muted transition-colors hover:border-primary/60 hover:bg-primary/5 hover:text-primary"
          title="Add a mail account"
        >
          <Plus className="size-4 transition-transform duration-500 ease-out-expo group-hover:rotate-90" />
        </motion.button>
      </div>

      <div className="mt-3 flex w-full flex-col items-center gap-1.5 border-t border-border/80 pt-3">
        <button
          type="button"
          onClick={onOpenModsModal}
          className="group grid size-10 place-items-center rounded-xl text-muted transition-colors hover:bg-sunken hover:text-primary"
          title="Mods & automation"
        >
          <Sliders className="size-4 transition-transform duration-500 ease-out-expo group-hover:rotate-90" />
        </button>
        <ThemeToggle theme={theme} onChange={onThemeChange} />
        <div className="relative grid size-10 place-items-center text-moss" title="Local enclave: outbound TLS only, no inbound ports.">
          <ShieldCheck className="size-4" />
          <span className="absolute right-2 top-2 size-1.5 rounded-full bg-moss">
            <span className="absolute inset-0 animate-ping rounded-full bg-moss/70" />
          </span>
        </div>
      </div>
    </aside>
  );
}
