import type { ReactNode } from 'react';
import type { TreeSorterField, TreeSorterSettings } from '../../types/index';

interface ScopePanelProps {
  settings: TreeSorterSettings;
  onChange: (next: TreeSorterSettings) => void;
}

const FOLDERS: Array<{ id: string; label: string }> = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'archive', label: 'Archive' },
  { id: 'sent', label: 'Sent' },
  { id: 'drafts', label: 'Drafts' },
];

const FIELDS: Array<{ id: TreeSorterField; label: string }> = [
  { id: 'subject', label: 'Subject' },
  { id: 'from', label: 'Sender' },
  { id: 'snippet', label: 'Preview text' },
];

function toggle<T>(list: T[], item: T): T[] {
  const next = list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
  // At least one option must stay on, or the scan would look at nothing
  return next.length > 0 ? next : list;
}

function Pill({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
        on ? 'border-sky/40 bg-sky/15 text-sky' : 'border-border text-muted hover:border-sky/30 hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
}

function Row({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div>
        <div className="text-xs font-semibold text-foreground">{title}</div>
        <div className="text-[10.5px] text-muted">{hint}</div>
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export function ScopePanel({ settings, onChange }: ScopePanelProps) {
  return (
    <div className="space-y-3.5">
      <Row title="Scan folders" hint="Where the mod looks for letters to file.">
        {FOLDERS.map((f) => (
          <Pill key={f.id} on={settings.folders.includes(f.id)} label={f.label} onClick={() => onChange({ ...settings, folders: toggle(settings.folders, f.id) })} />
        ))}
      </Row>
      <Row title="Match keywords in" hint="Subject is the classic; sender catches domains like github.com.">
        {FIELDS.map((f) => (
          <Pill key={f.id} on={settings.fields.includes(f.id)} label={f.label} onClick={() => onChange({ ...settings, fields: toggle(settings.fields, f.id) })} />
        ))}
      </Row>
      <Row title="Matching" hint={settings.matchMode === 'word' ? '“invoice” matches “Invoices” but not “reinvoice”.' : '“bill” also matches inside “billing” and “rebill”.'}>
        <Pill on={settings.matchMode === 'word'} label="Word start" onClick={() => onChange({ ...settings, matchMode: 'word' })} />
        <Pill on={settings.matchMode === 'anywhere'} label="Anywhere" onClick={() => onChange({ ...settings, matchMode: 'anywhere' })} />
      </Row>
      <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border/80 bg-surface/60 p-2.5">
        <input
          type="checkbox"
          checked={settings.autoRun}
          onChange={(e) => onChange({ ...settings, autoRun: e.target.checked })}
          className="mt-0.5 size-4 accent-[rgb(var(--sky))]"
        />
        <span>
          <span className="block text-xs font-semibold text-foreground">Auto-file new mail</span>
          <span className="block text-[10.5px] text-muted">Re-run after every sync, so new letters land in their branches on arrival.</span>
        </span>
      </label>
    </div>
  );
}
