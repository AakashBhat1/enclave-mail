import { useState, type MouseEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowUp, Briefcase, ChevronRight, Cog, DollarSign, Folder as FolderIcon, Plus, Shield } from 'lucide-react';
import { AssociationNode } from '../../types/index';
import { InlineAddForm } from './InlineAddForm';
import { EASE_OUT_EXPO, SPRING_SNAPPY, staggerDelay } from '../../lib/motion';

interface AssociationTreeProps {
  associations: AssociationNode[];
  activeFilterId: string;
  onSelectFilter: (filterId: string, label: string) => void;
  onReorderAssociations: (associationIds: string[]) => void;
  onAddAssociation?: (name: string, icon?: string) => void;
  onAddAgenda?: (associationId: string, name: string, category: string) => void;
}

export const CATEGORY_STYLE: Record<string, { icon: typeof Briefcase; tint: string; dot: string }> = {
  financial: { icon: DollarSign, tint: 'text-moss', dot: 'bg-moss' },
  project: { icon: Briefcase, tint: 'text-primary', dot: 'bg-primary' },
  legal: { icon: Shield, tint: 'text-marigold', dot: 'bg-marigold' },
  operations: { icon: Cog, tint: 'text-cranberry', dot: 'bg-cranberry' },
  custom: { icon: FolderIcon, tint: 'text-muted', dot: 'bg-muted' },
};

export function categoryStyle(category: string) {
  return CATEGORY_STYLE[category] ?? CATEGORY_STYLE.custom;
}

export function AssociationTree({
  associations,
  activeFilterId,
  onSelectFilter,
  onReorderAssociations,
  onAddAssociation,
  onAddAgenda,
}: AssociationTreeProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    assoc_7brd: true,
    assoc_acme: true,
    assoc_stripe: true,
  });
  const [isAddingAssoc, setIsAddingAssoc] = useState(false);
  const [addingAgendaFor, setAddingAgendaFor] = useState<string | null>(null);

  const toggle = (id: string, e: MouseEvent) => {
    e.stopPropagation();
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const move = (index: number, direction: 'up' | 'down', e: MouseEvent) => {
    e.stopPropagation();
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= associations.length) return;
    const ids = associations.map((a) => a.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    onReorderAssociations(ids);
  };

  return (
    <div>
      <div className="flex items-center justify-between px-3 pb-2 pt-1">
        <span className="eyebrow">Associations</span>
        <button
          type="button"
          onClick={() => setIsAddingAssoc((v) => !v)}
          className="group grid size-6 place-items-center rounded-md text-primary transition-colors hover:bg-primary/10"
          title="Add association"
        >
          <Plus className={`size-3.5 transition-transform duration-500 ease-out-expo ${isAddingAssoc ? 'rotate-45' : 'group-hover:rotate-90'}`} />
        </button>
      </div>

      <AnimatePresence>
        {isAddingAssoc && onAddAssociation && (
          <InlineAddForm
            placeholder="New association, e.g. 7brd"
            onSubmit={(name) => {
              onAddAssociation(name);
              setIsAddingAssoc(false);
            }}
            onCancel={() => setIsAddingAssoc(false)}
          />
        )}
      </AnimatePresence>

      {associations.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-muted">No associations in this enclave yet.</p>
      ) : (
        <div className="space-y-1">
          {associations.map((assoc, index) => {
            const isOpen = !!expanded[assoc.id];
            const isActive = activeFilterId === assoc.id;
            const unread = assoc.agendas.reduce((sum, a) => sum + a.unreadCount, 0);

            return (
              <motion.div
                key={assoc.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ layout: SPRING_SNAPPY, duration: 0.5, delay: staggerDelay(index, 0.05), ease: EASE_OUT_EXPO }}
                className="overflow-hidden rounded-xl border border-border/60 bg-surface/40"
              >
                <div
                  onClick={() => onSelectFilter(assoc.id, assoc.name)}
                  className={`group relative flex cursor-pointer items-center justify-between px-1.5 py-1.5 transition-colors ${
                    isActive ? 'text-foreground' : 'text-foreground/85 hover:bg-sunken/60'
                  }`}
                >
                  {isActive && (
                    <motion.span layoutId="nav-active" className="absolute inset-0 bg-surface shadow-warm" transition={SPRING_SNAPPY}>
                      <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
                    </motion.span>
                  )}
                  <div className="relative flex min-w-0 items-center gap-1.5">
                    <button type="button" onClick={(e) => toggle(assoc.id, e)} className="icon-btn !size-6" aria-label={isOpen ? 'Collapse' : 'Expand'}>
                      <ChevronRight className={`size-3.5 transition-transform duration-300 ease-out-expo ${isOpen ? 'rotate-90' : ''}`} />
                    </button>
                    <span className="grid size-6 place-items-center rounded-lg bg-sunken text-[13px]">{assoc.icon || '📌'}</span>
                    <span className="truncate text-[13px] font-semibold">{assoc.name}</span>
                    {unread > 0 && !isOpen && <span className="size-1.5 flex-shrink-0 rounded-full bg-primary" />}
                  </div>

                  <div className="relative flex items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAddingAgendaFor(addingAgendaFor === assoc.id ? null : assoc.id);
                      }}
                      className="icon-btn !size-6 hover:!text-moss"
                      title="Add agenda"
                    >
                      <Plus className="size-3" />
                    </button>
                    <button type="button" disabled={index === 0} onClick={(e) => move(index, 'up', e)} className="icon-btn !size-6 disabled:opacity-25" title="Move up">
                      <ArrowUp className="size-3" />
                    </button>
                    <button
                      type="button"
                      disabled={index === associations.length - 1}
                      onClick={(e) => move(index, 'down', e)}
                      className="icon-btn !size-6 disabled:opacity-25"
                      title="Move down"
                    >
                      <ArrowDown className="size-3" />
                    </button>
                  </div>
                </div>

                <AnimatePresence>
                  {addingAgendaFor === assoc.id && onAddAgenda && (
                    <InlineAddForm
                      placeholder="e.g. Project Financial"
                      onSubmit={(name) => {
                        onAddAgenda(assoc.id, name, 'project');
                        setAddingAgendaFor(null);
                      }}
                      onCancel={() => setAddingAgendaFor(null)}
                    />
                  )}
                </AnimatePresence>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.4, ease: EASE_OUT_EXPO }}
                      className="overflow-hidden"
                    >
                      <div className="relative ml-[22px] space-y-0.5 border-l border-dashed border-border py-1 pl-2 pr-1.5">
                        {assoc.agendas.map((agenda) => {
                          const isAgendaActive = activeFilterId === agenda.id;
                          const style = categoryStyle(agenda.category);
                          const Icon = style.icon;
                          return (
                            <button
                              key={agenda.id}
                              type="button"
                              onClick={() => onSelectFilter(agenda.id, `${assoc.name} → ${agenda.name}`)}
                              className={`relative flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
                                isAgendaActive ? 'text-foreground' : 'text-muted hover:bg-sunken/70 hover:text-foreground'
                              }`}
                            >
                              {isAgendaActive && (
                                <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg bg-surface shadow-warm" transition={SPRING_SNAPPY} />
                              )}
                              <span className="relative flex min-w-0 items-center gap-2">
                                <Icon className={`size-3.5 flex-shrink-0 ${style.tint}`} />
                                <span className="truncate">{agenda.name}</span>
                              </span>
                              {agenda.unreadCount > 0 && (
                                <span className="relative rounded-full bg-primary px-1.5 text-[10px] font-bold leading-4 text-white">{agenda.unreadCount}</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
