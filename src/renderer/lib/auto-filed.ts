import type { AssociationNode, EmailMessage } from '../types/index';

export interface AutoBranch {
  key: string;
  label: string;
  keyword: string;
}

/** Tree Sorter branches as short labels; an agenda hit shows as "Parent › Agenda" and hides its bare parent hit. */
export function autoFiledLabels(email: EmailMessage, associations: AssociationNode[]): AutoBranch[] {
  const matches = email.treeMatches ?? [];
  const withAgenda = new Set(matches.filter((m) => m.agendaId).map((m) => m.associationId));
  return matches.flatMap((m): AutoBranch[] => {
    const assoc = associations.find((a) => a.id === m.associationId);
    if (!assoc || (!m.agendaId && withAgenda.has(m.associationId))) return [];
    const agenda = m.agendaId ? assoc.agendas.find((ag) => ag.id === m.agendaId) : undefined;
    if (m.agendaId && !agenda) return [];
    return [{ key: `${m.associationId}/${m.agendaId ?? ''}`, label: agenda ? `${assoc.name} › ${agenda.name}` : assoc.name, keyword: m.keyword }];
  });
}
