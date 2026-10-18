import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, ArrowUpDown, Check, FolderTree, Plus, Tag } from 'lucide-react';
import { AgendaNode, AssociationNode, EmailMessage } from '../types/index';
import { Modal, ModalHeader } from './ui/Modal';
import { categoryStyle } from './nav/AssociationTree';
import { EASE_OUT_EXPO, SPRING_SNAPPY } from '../lib/motion';

interface TreeMoveModalProps {
  isOpen: boolean;
  onClose: () => void;
  email: EmailMessage | null;
  associations: AssociationNode[];
  onReassign: (emailId: string, associationId: string, agendaId: string) => Promise<void>;
  onAddAssociation?: (name: string, icon?: string) => Promise<void>;
  onAddAgenda?: (associationId: string, name: string, category: string) => Promise<void>;
}

type Category = AgendaNode['category'];
const CATEGORIES: Category[] = ['project', 'financial', 'operations', 'legal', 'custom'];

const reveal = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: 0.35, ease: EASE_OUT_EXPO },
};

export function TreeMoveModal({ isOpen, onClose, email: target, associations, onReassign, onAddAssociation, onAddAgenda }: TreeMoveModalProps) {
  const [selectedAssocId, setSelectedAssocId] = useState('');
  const [selectedAgendaId, setSelectedAgendaId] = useState('');
  const [isAddingAssoc, setIsAddingAssoc] = useState(false);
  const [newAssocName, setNewAssocName] = useState('');
  const [isAddingAgenda, setIsAddingAgenda] = useState(false);
  const [newAgendaName, setNewAgendaName] = useState('');
  const [newAgendaCategory, setNewAgendaCategory] = useState<Category>('project');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // The parent clears the target as it closes; keep showing it so the exit animation has content
  const lastTarget = useRef(target);
  if (target) lastTarget.current = target;
  const email = target ?? lastTarget.current;

  // Initialise per opened email only; creating an association/agenda refreshes `associations` and must not reset the pick
  useEffect(() => {
    if (!email || !isOpen) return;
    const initAssoc = email.associationId || associations[0]?.id || '';
    setSelectedAssocId(initAssoc);
    const assoc = associations.find((a) => a.id === initAssoc);
    setSelectedAgendaId(assoc?.agendas.length ? email.agendaId || assoc.agendas[0].id : '');
  }, [email?.id, isOpen]);

  const currentAssoc = associations.find((a) => a.id === selectedAssocId) || null;
  const currentAgenda = currentAssoc?.agendas.find((ag) => ag.id === selectedAgendaId) || null;

  const handleAssocChange = (assocId: string) => {
    setSelectedAssocId(assocId);
    const assoc = associations.find((a) => a.id === assocId);
    setSelectedAgendaId(assoc?.agendas[0]?.id ?? '');
  };

  const handleSave = async () => {
    if (!email || !selectedAssocId) return;
    setIsSubmitting(true);
    await onReassign(email.id, selectedAssocId, selectedAgendaId);
    setIsSubmitting(false);
    onClose();
  };

  const handleCreateAssoc = async (e: FormEvent) => {
    e.preventDefault();
    if (!newAssocName.trim() || !onAddAssociation) return;
    await onAddAssociation(newAssocName.trim());
    setNewAssocName('');
    setIsAddingAssoc(false);
  };

  const handleCreateAgenda = async (e: FormEvent) => {
    e.preventDefault();
    if (!newAgendaName.trim() || !selectedAssocId || !onAddAgenda) return;
    await onAddAgenda(selectedAssocId, newAgendaName.trim(), newAgendaCategory);
    setNewAgendaName('');
    setIsAddingAgenda(false);
  };

  return (
    <Modal isOpen={isOpen && !!email} onClose={onClose} widthClass="max-w-lg" labelledBy="tree-move-title">
      {email && (
        <>
          <ModalHeader id="tree-move-title" icon={FolderTree} tone="sky" title="Move in tree" subtitle="Account → Association → Agenda" onClose={onClose} />

          <div className="flex-1 space-y-5 overflow-y-auto px-6 pb-5">
            <div className="card !rounded-2xl p-3.5 text-xs">
              <div className="eyebrow mb-1">Letter</div>
              <div className="line-clamp-1 text-sm font-semibold text-foreground">{email.subject}</div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
                <span>From {email.from.name || email.from.address}</span>
                <span>·</span>
                <span className="font-mono">#{email.position ?? 1}</span>
              </div>
            </div>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Tag className="size-3.5 text-primary" />
                  Association
                </span>
                {onAddAssociation && (
                  <button type="button" onClick={() => setIsAddingAssoc((v) => !v)} className="link-draw flex items-center gap-1 text-[11px] font-semibold text-primary">
                    <Plus className="size-3" />
                    New
                  </button>
                )}
              </div>

              <AnimatePresence initial={false}>
                {isAddingAssoc && (
                  <motion.form {...reveal} onSubmit={handleCreateAssoc} className="overflow-hidden">
                    <div className="mb-2 flex gap-2">
                      <input type="text" placeholder="e.g. 7brd Project or Client X" value={newAssocName} onChange={(e) => setNewAssocName(e.target.value)} className="field !py-2 !text-xs" autoFocus />
                      <button type="submit" className="btn-primary flex-shrink-0">
                        Create
                      </button>
                    </div>
                  </motion.form>
                )}
              </AnimatePresence>

              <div className="grid grid-cols-2 gap-2">
                {associations.map((assoc) => {
                  const selected = selectedAssocId === assoc.id;
                  return (
                    <button
                      key={assoc.id}
                      type="button"
                      onClick={() => handleAssocChange(assoc.id)}
                      className={`relative flex items-center gap-2.5 rounded-2xl border p-2.5 text-left text-xs transition-colors ${
                        selected ? 'border-transparent text-foreground' : 'border-border text-foreground/80 hover:border-primary/30'
                      }`}
                    >
                      {selected && <motion.span layoutId="assoc-pick" className="absolute inset-0 rounded-2xl bg-surface shadow-warm ring-2 ring-primary/60" transition={SPRING_SNAPPY} />}
                      <span className="relative grid size-8 place-items-center rounded-xl bg-sunken text-sm">{assoc.icon || '📌'}</span>
                      <span className="relative min-w-0">
                        <span className="block truncate font-semibold">{assoc.name}</span>
                        <span className="font-mono text-[10px] text-muted">#{assoc.position}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {currentAssoc && (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <ArrowUpDown className="size-3.5 text-moss" />
                    Agenda
                  </span>
                  {onAddAgenda && (
                    <button type="button" onClick={() => setIsAddingAgenda((v) => !v)} className="link-draw flex items-center gap-1 text-[11px] font-semibold text-moss">
                      <Plus className="size-3" />
                      New
                    </button>
                  )}
                </div>

                <AnimatePresence initial={false}>
                  {isAddingAgenda && (
                    <motion.form {...reveal} onSubmit={handleCreateAgenda} className="overflow-hidden">
                      <div className="mb-2 flex gap-2">
                        <input type="text" placeholder="e.g. Project Financial" value={newAgendaName} onChange={(e) => setNewAgendaName(e.target.value)} className="field !py-2 !text-xs" autoFocus />
                        <select value={newAgendaCategory} onChange={(e) => setNewAgendaCategory(e.target.value as Category)} className="field !w-auto !py-2 !text-xs capitalize">
                          {CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        <button type="submit" className="btn flex-shrink-0 bg-moss text-white">
                          Add
                        </button>
                      </div>
                    </motion.form>
                  )}
                </AnimatePresence>

                <div className="max-h-44 space-y-1 overflow-y-auto">
                  {currentAssoc.agendas.map((agenda) => {
                    const selected = selectedAgendaId === agenda.id;
                    const style = categoryStyle(agenda.category);
                    return (
                      <button
                        key={agenda.id}
                        type="button"
                        onClick={() => setSelectedAgendaId(agenda.id)}
                        className={`relative flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs transition-colors ${
                          selected ? 'text-foreground' : 'text-foreground/80 hover:bg-sunken/70'
                        }`}
                      >
                        {selected && <motion.span layoutId="agenda-pick" className="absolute inset-0 rounded-xl bg-surface shadow-warm ring-1 ring-moss/40" transition={SPRING_SNAPPY} />}
                        <span className="relative flex items-center gap-2.5">
                          <span className={`size-2 rounded-full ${style.dot}`} />
                          <span className="font-medium">{agenda.name}</span>
                          <span className="rounded-md bg-sunken px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted">{agenda.category}</span>
                        </span>
                        {selected && (
                          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="relative text-moss">
                            <Check className="size-4" />
                          </motion.span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            <div className="flex items-center gap-2 rounded-2xl bg-sunken/70 px-3.5 py-2.5 text-xs">
              <span className="eyebrow !tracking-[0.14em]">Path</span>
              <AnimatePresence mode="popLayout">
                <motion.span key={currentAssoc?.id ?? 'none'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="font-semibold text-foreground">
                  {currentAssoc?.name || 'None'}
                </motion.span>
              </AnimatePresence>
              <ArrowRight className="size-3.5 text-primary" />
              <AnimatePresence mode="popLayout">
                <motion.span key={currentAgenda?.id ?? 'general'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="font-semibold text-moss">
                  {currentAgenda?.name || 'General'}
                </motion.span>
              </AnimatePresence>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border/70 px-6 py-3">
            <button type="button" onClick={onClose} className="btn-ghost">
              Cancel
            </button>
            <button type="button" disabled={!selectedAssocId || isSubmitting} onClick={handleSave} className="btn-primary">
              {isSubmitting ? 'Moving…' : 'Confirm move'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
