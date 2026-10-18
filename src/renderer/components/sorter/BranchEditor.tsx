import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CornerDownRight, Plus, Trash2 } from 'lucide-react';
import type { AgendaNode, AssociationNode } from '../../types/index';
import { KeywordInput } from './KeywordInput';
import { InlineAddForm } from '../nav/InlineAddForm';
import { categoryStyle } from '../nav/AssociationTree';
import { EASE_OUT_EXPO } from '../../lib/motion';

const CONFIRM_WINDOW_MS = 3000;

interface BranchEditorProps {
  association: AssociationNode;
  index: number;
  /** Letters each node would hold, from the latest preview; keyed by node id. */
  hits: Record<string, number>;
  onKeywords: (nodeId: string, keywords: string[]) => void;
  onRename: (nodeId: string, name: string) => void;
  onAddSub: (associationId: string, name: string) => void;
  onDelete: (nodeId: string) => void;
}

/** Two clicks to delete: the first arms it, the second (within a few seconds) removes the branch. */
function DeleteButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      onClick={() => {
        if (armed) {
          window.clearTimeout(timer.current);
          onConfirm();
          return;
        }
        setArmed(true);
        timer.current = window.setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS);
      }}
      className={`flex h-6 items-center gap-1 rounded-md px-1.5 text-[10.5px] font-semibold transition-colors ${
        armed ? 'bg-cranberry text-white' : 'text-muted hover:bg-cranberry/10 hover:text-cranberry'
      }`}
      aria-label={`Delete ${label}`}
      title={armed ? 'Click again to delete' : `Delete ${label}`}
    >
      <Trash2 className="size-3" />
      {armed && 'Delete?'}
    </button>
  );
}

/** Name that turns into a field on double-click; Enter saves, Escape cancels. */
function EditableName({ name, className, onRename }: { name: string; className: string; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  if (!editing) {
    return (
      <span className={`cursor-text truncate ${className}`} onDoubleClick={() => { setValue(name); setEditing(true); }} title="Double-click to rename">
        {name}
      </span>
    );
  }
  const save = () => {
    setEditing(false);
    if (value.trim() && value.trim() !== name) onRename(value.trim());
  };
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') setEditing(false);
      }}
      className="field !rounded-md !px-2 !py-0.5 !text-xs"
    />
  );
}

function HitBadge({ count }: { count: number | undefined }) {
  if (count === undefined) return null;
  return (
    <span className={`chip flex-shrink-0 tabular-nums ${count > 0 ? 'border-moss/25 bg-moss/10 text-moss' : 'border-transparent bg-sunken text-muted'}`}>
      {count} {count === 1 ? 'letter' : 'letters'}
    </span>
  );
}

function SubBranch({ agenda, hits, onKeywords, onRename, onDelete }: { agenda: AgendaNode } & Pick<BranchEditorProps, 'hits' | 'onKeywords' | 'onRename' | 'onDelete'>) {
  const Icon = categoryStyle(agenda.category).icon;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
      className="space-y-1.5"
    >
      <div className="flex items-center gap-2">
        <CornerDownRight className="size-3.5 flex-shrink-0 text-muted/60" />
        <Icon className={`size-3.5 flex-shrink-0 ${categoryStyle(agenda.category).tint}`} />
        <EditableName name={agenda.name} className="min-w-0 flex-1 text-xs font-semibold text-foreground" onRename={(n) => onRename(agenda.id, n)} />
        <HitBadge count={hits[agenda.id]} />
        <DeleteButton label={agenda.name} onConfirm={() => onDelete(agenda.id)} />
      </div>
      <div className="pl-[22px]">
        <KeywordInput label={`Keywords for ${agenda.name}`} keywords={agenda.keywords ?? []} onChange={(k) => onKeywords(agenda.id, k)} />
      </div>
    </motion.div>
  );
}

export function BranchEditor({ association, index, hits, onKeywords, onRename, onAddSub, onDelete }: BranchEditorProps) {
  const [addingSub, setAddingSub] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.45, delay: Math.min(index, 8) * 0.04, ease: EASE_OUT_EXPO }}
      className="card space-y-2.5 !rounded-xl p-3"
    >
      <div className="flex items-center gap-2">
        <span className="grid size-7 flex-shrink-0 place-items-center rounded-lg bg-sunken text-sm">{association.icon || '📌'}</span>
        <EditableName name={association.name} className="min-w-0 flex-1 text-[13px] font-bold text-foreground" onRename={(n) => onRename(association.id, n)} />
        {/* A parent with no keywords of its own only groups sub-branches, so a "0 letters" badge would mislead */}
        <HitBadge count={(association.keywords ?? []).some((k) => !k.startsWith('-')) ? hits[association.id] : undefined} />
        <DeleteButton label={association.name} onConfirm={() => onDelete(association.id)} />
      </div>
      <KeywordInput
        label={`Keywords for ${association.name}`}
        keywords={association.keywords ?? []}
        onChange={(k) => onKeywords(association.id, k)}
        placeholder="Branch keywords, e.g. invoice, receipt, -newsletter"
      />

      {association.agendas.length > 0 && (
        <div className="space-y-2.5 border-l border-dashed border-border pl-2.5">
          <AnimatePresence initial={false}>
            {association.agendas.map((agenda) => (
              <SubBranch key={agenda.id} agenda={agenda} hits={hits} onKeywords={onKeywords} onRename={onRename} onDelete={onDelete} />
            ))}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {addingSub && (
          <InlineAddForm
            placeholder="Sub-branch name, e.g. Acme"
            onSubmit={(name) => {
              onAddSub(association.id, name);
              setAddingSub(false);
            }}
            onCancel={() => setAddingSub(false)}
          />
        )}
      </AnimatePresence>
      {!addingSub && (
        <button type="button" onClick={() => setAddingSub(true)} className="flex items-center gap-1 text-[11px] font-semibold text-sky hover:underline">
          <Plus className="size-3" />
          Sub-branch
        </button>
      )}
    </motion.div>
  );
}
