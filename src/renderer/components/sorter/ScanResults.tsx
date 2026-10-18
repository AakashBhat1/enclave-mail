import { motion } from 'motion/react';
import type { AssociationNode, TreeScanReport } from '../../types/index';
import { EASE_OUT_EXPO } from '../../lib/motion';

interface ScanResultsProps {
  report: TreeScanReport;
  associations: AssociationNode[];
  stale: boolean;
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl bg-sunken/70 px-2.5 py-2">
      <div className={`display text-[19px] leading-none tabular-nums ${tone}`}>{value.toLocaleString()}</div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</div>
    </div>
  );
}

function nodeName(associations: AssociationNode[], associationId: string, agendaId?: string): string | null {
  const assoc = associations.find((a) => a.id === associationId);
  if (!assoc) return null;
  if (!agendaId) return assoc.name;
  const agenda = assoc.agendas.find((ag) => ag.id === agendaId);
  return agenda ? `${assoc.name} › ${agenda.name}` : null;
}

export function ScanResults({ report, associations, stale }: ScanResultsProps) {
  const rows = report.nodes
    .map((n) => ({ ...n, name: nodeName(associations, n.associationId, n.agendaId) }))
    .filter((n): n is typeof n & { name: string } => n.name !== null && n.count > 0)
    .sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <div className={`space-y-3 transition-opacity ${stale ? 'opacity-55' : ''}`}>
      <div className="flex items-center justify-between">
        <span className="eyebrow">{report.applied ? 'Filed' : 'Preview'}</span>
        <span className="text-[10.5px] text-muted">
          {stale ? 'Tree changed since this run' : new Date(report.scannedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        <Stat label="Scanned" value={report.scanned} tone="text-foreground" />
        <Stat label="Filed" value={report.matched} tone="text-moss" />
        <Stat label="2+ branches" value={report.multiBranch} tone="text-sky" />
        <Stat label="Unmatched" value={report.unmatched} tone="text-muted" />
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted">
          No branch caught anything yet. Add keywords, or switch matching to “Anywhere”.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={`${row.associationId}/${row.agendaId ?? ''}`} title={row.samples.length ? `e.g. ${row.samples.join(' · ')}` : undefined}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate font-semibold text-foreground">{row.name}</span>
                <span className="flex-shrink-0 tabular-nums text-muted">
                  {row.count.toLocaleString()}
                  {row.unread > 0 && <span className="ml-1 text-primary">· {row.unread} new</span>}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
                <motion.div
                  className={`h-full rounded-full ${row.agendaId ? 'bg-sky/70' : 'bg-sky'}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${(row.count / max) * 100}%` }}
                  transition={{ duration: 0.7, delay: Math.min(index, 10) * 0.04, ease: EASE_OUT_EXPO }}
                />
              </div>
              {row.samples[0] && <div className="mt-0.5 truncate text-[10.5px] italic text-muted">“{row.samples[0]}”</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
