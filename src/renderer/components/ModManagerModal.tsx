import { useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Plus, Sliders, Terminal } from 'lucide-react';
import { ModRule } from '../types/index';
import { Modal, ModalHeader } from './ui/Modal';
import { EASE_OUT_EXPO, SPRING_SNAPPY, staggerDelay } from '../lib/motion';

interface ModManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  mods: ModRule[];
  onToggleMod: (id: string) => void;
  onAddMod: (rule: ModRule) => void;
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={`flex h-7 w-12 flex-shrink-0 items-center rounded-full p-1 shadow-pressed transition-colors duration-300 ${on ? 'justify-end bg-moss' : 'justify-start bg-sunken'}`}
    >
      <motion.span layout transition={{ type: 'spring', stiffness: 700, damping: 32 }} className="size-5 rounded-full bg-white shadow-warm" />
    </button>
  );
}

export function ModManagerModal({ isOpen, onClose, mods, onToggleMod, onAddMod }: ModManagerModalProps) {
  const [newRuleName, setNewRuleName] = useState('');
  const [keyword, setKeyword] = useState('');
  const [tag, setTag] = useState('');

  const handleCreateRule = (e: FormEvent) => {
    e.preventDefault();
    if (!newRuleName || !keyword || !tag) return;

    onAddMod({
      id: `rule_${Date.now()}`,
      name: newRuleName,
      enabled: true,
      providerId: 'all',
      condition: { field: 'subject', operator: 'contains', value: keyword },
      action: { type: 'applyTag', targetValue: tag },
    });
    setNewRuleName('');
    setKeyword('');
    setTag('');
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} widthClass="max-w-2xl" labelledBy="mods-title">
      <ModalHeader id="mods-title" icon={Sliders} tone="moss" title="Automation mods" subtitle="Rules that run on your mail, locally." onClose={onClose} />

      <div className="mx-6 flex items-center gap-2.5 rounded-2xl border border-moss/20 bg-moss/10 p-3 text-xs text-moss">
        <Terminal className="size-4 flex-shrink-0" />
        <span>Mods execute on this laptop only. No network ports, no outside exposure.</span>
      </div>

      <div className="flex-1 space-y-2.5 overflow-y-auto px-6 pb-6 pt-5">
        <div className="eyebrow">Active rules</div>
        <AnimatePresence initial={false}>
          {mods.map((mod, index) => (
            <motion.div
              key={mod.id}
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.5, delay: staggerDelay(index, 0.05), ease: EASE_OUT_EXPO, layout: SPRING_SNAPPY }}
              className={`card flex items-center justify-between gap-4 p-4 transition-opacity ${mod.enabled ? '' : 'opacity-60'}`}
            >
              <div className="min-w-0 space-y-1.5">
                <div className="text-sm font-semibold text-foreground">{mod.name}</div>
                <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                  <span className="rounded-md bg-sunken px-2 py-0.5 text-muted">
                    if {mod.condition.field} {mod.condition.operator} “{mod.condition.value}”
                  </span>
                  <span className="text-muted/60">→</span>
                  <span className="rounded-md bg-moss/10 px-2 py-0.5 text-moss">
                    {mod.action.type}(‘{mod.action.targetValue}’)
                  </span>
                </div>
              </div>
              <Toggle on={mod.enabled} onClick={() => onToggleMod(mod.id)} label={`Toggle ${mod.name}`} />
            </motion.div>
          ))}
        </AnimatePresence>

        <form onSubmit={handleCreateRule} className="mt-2 space-y-3 rounded-2xl border-[1.5px] border-dashed border-border p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Plus className="size-4 text-moss" />
            New rule
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input type="text" placeholder="Rule name, e.g. Work tag" value={newRuleName} onChange={(e) => setNewRuleName(e.target.value)} className="field !py-2 !text-xs" />
            <input type="text" placeholder="Subject contains…" value={keyword} onChange={(e) => setKeyword(e.target.value)} className="field !py-2 !text-xs" />
            <input type="text" placeholder="Tag to apply" value={tag} onChange={(e) => setTag(e.target.value)} className="field !py-2 !text-xs" />
          </div>
          <button type="submit" className="btn w-full bg-moss py-2.5 text-white shadow-warm hover:brightness-110">
            Add rule to local pipeline
          </button>
        </form>
      </div>

      <div className="flex justify-end border-t border-border/70 px-6 py-3">
        <button type="button" onClick={onClose} className="btn-soft">
          Done
        </button>
      </div>
    </Modal>
  );
}
