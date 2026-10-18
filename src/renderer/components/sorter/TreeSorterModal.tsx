import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bot, Download, Eraser, Eye, Lightbulb, Loader2, Plus, Upload, Wand2 } from 'lucide-react';
import type { AssociationNode, TreeScanReport, TreeSorterSettings, TreeSorterState } from '../../types/index';
import { Modal, ModalHeader } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { InlineAddForm } from '../nav/InlineAddForm';
import { BranchEditor } from './BranchEditor';
import { ScopePanel } from './ScopePanel';
import { ScanResults } from './ScanResults';
import { BRANCH_TEMPLATES, type BranchTemplate } from './templates';
import { errorMessage, unwrap } from '../../lib/ipc';

interface TreeSorterModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  associations: AssociationNode[];
  /** The tree (keywords, branches) changed; the app should show this version. */
  onTreeChanged: (associations: AssociationNode[]) => void;
  /** Filing changed (run, clear, branch removed); lists and counts need a reload. */
  onFiled: () => void;
}

type Busy = 'preview' | 'apply' | 'clear' | 'export' | 'import' | null;

interface ImportSummary {
  createdBranches: number;
  createdSubBranches: number;
  updatedNodes: number;
  clearedNodes: string[];
}

export function TreeSorterModal({ isOpen, onClose, ...rest }: TreeSorterModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} widthClass="max-w-5xl" labelledBy="sorter-title">
      <ModalHeader
        id="sorter-title"
        icon={Wand2}
        tone="sky"
        title="Keyword Tree Sorter"
        subtitle="Give each branch keywords, preview, then file. A letter can sit in several branches at once."
        onClose={onClose}
      />
      <SorterBody {...rest} />
    </Modal>
  );
}

function hitsFrom(report: TreeScanReport | null): Record<string, number> {
  if (!report) return {};
  return Object.fromEntries(report.nodes.map((n) => [n.agendaId ?? n.associationId, n.count]));
}

function SorterBody({ providerId, associations, onTreeChanged, onFiled }: Omit<TreeSorterModalProps, 'isOpen' | 'onClose'>) {
  const notify = useToast();
  const api = window.electronAPI;
  const [state, setState] = useState<TreeSorterState | null>(null);
  const [report, setReport] = useState<TreeScanReport | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [addingBranch, setAddingBranch] = useState(false);
  // An AI-made tree is meant to be the whole picture, so by default it replaces keywords instead of adding to them
  const [replaceOnImport, setReplaceOnImport] = useState(true);

  const fail = (err: unknown) => notify({ tone: 'error', title: 'Tree Sorter', description: errorMessage(err) });

  const reloadState = () =>
    unwrap<TreeSorterState>(api.getTreeSorter(providerId))
      .then(setState)
      .catch(fail);

  useEffect(() => {
    unwrap<TreeSorterState>(api.getTreeSorter(providerId))
      .then((s) => {
        setState(s);
        setReport(s.lastScan);
      })
      .catch(fail);
  }, [providerId]);

  /** Any tree edit makes the last preview outdated and may change which words are worth suggesting. */
  const treeEdited = (next: AssociationNode[]) => {
    onTreeChanged(next);
    setStale(true);
    void reloadState();
  };

  // get-associations predates IpcResult and returns the list directly
  const freshTree = async () => treeEdited((await api.getAssociations(providerId)) as AssociationNode[]);

  const setKeywords = (nodeId: string, keywords: string[]) =>
    unwrap<AssociationNode[]>(api.setNodeKeywords(providerId, nodeId, keywords)).then(treeEdited).catch(fail);

  const rename = (nodeId: string, name: string) =>
    unwrap<AssociationNode[]>(api.renameTreeNode(providerId, nodeId, name)).then(onTreeChanged).catch(fail);

  const addSub = (associationId: string, name: string) =>
    unwrap(api.addAgenda(providerId, associationId, name, 'custom', [])).then(freshTree).catch(fail);

  const addBranch = (name: string, icon = '🌿', keywords: string[] = []) =>
    unwrap(api.addAssociation(providerId, name, icon, false, keywords)).then(freshTree).catch(fail);

  const remove = (nodeId: string) =>
    unwrap<AssociationNode[]>(api.deleteTreeNode(providerId, nodeId))
      .then((next) => {
        treeEdited(next);
        onFiled();
      })
      .catch(fail);

  const saveSettings = (settings: TreeSorterSettings) => {
    setState((prev) => (prev ? { ...prev, settings } : prev));
    setStale(true);
    unwrap<TreeSorterState>(api.saveTreeSorterSettings(providerId, settings)).then(setState).catch(fail);
  };

  const run = async (apply: boolean) => {
    setBusy(apply ? 'apply' : 'preview');
    try {
      const result = await unwrap<TreeScanReport>(api.runTreeSorter(providerId, apply));
      setReport(result);
      setStale(false);
      if (apply) {
        onFiled();
        const branches = result.nodes.filter((n) => n.count > 0).length;
        notify({
          tone: 'success',
          title: `Filed ${result.matched.toLocaleString()} letters`,
          description: `Into ${branches} ${branches === 1 ? 'branch' : 'branches'}; ${result.multiBranch} sit in more than one.`,
        });
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    setBusy('clear');
    try {
      setState(await unwrap<TreeSorterState>(api.clearTreeSorter(providerId)));
      setReport(null);
      onFiled();
      notify({ tone: 'info', title: 'Auto-filing cleared', description: 'Letters you filed by hand stay where they are.' });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const exportForAi = async () => {
    setBusy('export');
    try {
      const saved = await unwrap<{ filePath: string; count: number } | null>(api.exportMailList(providerId));
      if (saved) {
        notify({
          tone: 'success',
          title: `Exported ${saved.count.toLocaleString()} letters`,
          description: `${saved.filePath}. Give it to your AI agent; the file explains what to answer.`,
        });
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const importFromAi = async () => {
    setBusy('import');
    try {
      const summary = await unwrap<ImportSummary | null>(api.importTree(providerId, replaceOnImport ? 'replace' : 'merge'));
      if (!summary) return;
      await freshTree();
      notify({
        tone: 'success',
        title: 'Tree imported',
        description: `${summary.createdBranches} new branches, ${summary.createdSubBranches} new sub-branches, ${summary.updatedNodes} updated. Preview, then Run & file.`,
      });
      if (summary.clearedNodes.length > 0) {
        notify({
          tone: 'info',
          title: `Keywords removed from ${summary.clearedNodes.length} old ${summary.clearedNodes.length === 1 ? 'branch' : 'branches'}`,
          description: `${summary.clearedNodes.join(', ')}. They stay (with anything you filed by hand) but no longer auto-file; delete them if you don't need them.`,
        });
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const hasKeywords = associations.some((a) => (a.keywords?.length ?? 0) > 0 || a.agendas.some((ag) => (ag.keywords?.length ?? 0) > 0));
  const unusedTemplates = BRANCH_TEMPLATES.filter((t) => !associations.some((a) => a.name.toLowerCase() === t.name.toLowerCase()));
  const hits = stale ? {} : hitsFrom(report);

  return (
    <>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 border-t border-border/70 lg:grid-cols-[1.35fr_1fr]">
        {/* 1. The tree and its keywords */}
        <section className="min-h-0 space-y-3 overflow-y-auto px-6 py-4 lg:border-r lg:border-border/70">
          <div className="flex items-center justify-between">
            <span className="eyebrow">1 · Branches &amp; keywords</span>
            <button type="button" onClick={() => setAddingBranch((v) => !v)} className="btn-soft !px-2.5 !py-1 !text-[11px]">
              <Plus className="size-3" />
              Branch
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sky/25 bg-sky/5 p-2.5">
            <Bot className="size-4 flex-shrink-0 text-sky" />
            <span className="min-w-0 flex-1 text-[11px] text-foreground/80">
              <strong>Design with AI:</strong> export your mail, give the file to an agent, then import the tree it writes back.
            </span>
            <button type="button" onClick={exportForAi} disabled={busy !== null} className="btn-soft !px-2.5 !py-1 !text-[11px]">
              {busy === 'export' ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
              Export for AI
            </button>
            <button type="button" onClick={importFromAi} disabled={busy !== null} className="btn-soft !px-2.5 !py-1 !text-[11px]">
              {busy === 'import' ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
              Import tree
            </button>
            <label
              className="flex w-full cursor-pointer items-center gap-1.5 pl-6 text-[10.5px] text-muted"
              title="On: the file's keywords replace the current ones, and branches it doesn't mention stop auto-filing. Off: keywords are added to what is there."
            >
              <input type="checkbox" checked={replaceOnImport} onChange={(e) => setReplaceOnImport(e.target.checked)} className="size-3 accent-[rgb(var(--sky))]" />
              Import replaces keywords (recommended for AI trees; nothing is deleted)
            </label>
          </div>

          <AnimatePresence>
            {addingBranch && (
              <InlineAddForm
                placeholder="Branch name, e.g. Clients"
                onSubmit={(name) => {
                  void addBranch(name);
                  setAddingBranch(false);
                }}
                onCancel={() => setAddingBranch(false)}
              />
            )}
          </AnimatePresence>

          {unusedTemplates.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10.5px] font-semibold text-muted">Starters:</span>
              {unusedTemplates.map((t: BranchTemplate) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => void addBranch(t.name, t.icon, t.keywords)}
                  className="chip border-border bg-surface/80 text-foreground/80 transition-colors hover:border-sky/40 hover:text-sky"
                  title={t.keywords.join(', ')}
                >
                  {t.icon} {t.name}
                </button>
              ))}
            </div>
          )}

          {state && state.suggestions.length > 0 && (
            <div className="rounded-xl border border-marigold/30 bg-marigold/10 p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-foreground/80">
                <Lightbulb className="size-3.5 text-marigold" />
                Frequent in your subjects; click to make a branch
              </div>
              <div className="flex flex-wrap gap-1">
                {state.suggestions.map((s) => (
                  <button
                    key={s.keyword}
                    type="button"
                    onClick={() => void addBranch(s.keyword.charAt(0).toUpperCase() + s.keyword.slice(1), '🏷️', [s.keyword])}
                    className="chip border-marigold/30 bg-surface/80 text-foreground/80 hover:border-marigold"
                  >
                    {s.keyword} <span className="font-mono text-[9.5px] text-muted">{s.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {associations.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-xs text-muted">
              No branches yet. Add one, or start from a starter above.
            </p>
          ) : (
            <motion.div layout className="space-y-2.5">
              <AnimatePresence initial={false}>
                {associations.map((assoc, index) => (
                  <BranchEditor
                    key={assoc.id}
                    association={assoc}
                    index={index}
                    hits={hits}
                    onKeywords={setKeywords}
                    onRename={rename}
                    onAddSub={addSub}
                    onDelete={remove}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          )}
          <p className="text-[10.5px] text-muted">
            Tip: put <span className="font-mono text-cranberry">-word</span> on a branch to keep letters that mention it out; a parent’s exclusions apply to its
            sub-branches too.
          </p>
        </section>

        {/* 2. Scope and 3. results */}
        <section className="min-h-0 space-y-5 overflow-y-auto px-6 py-4">
          <div className="space-y-3">
            <span className="eyebrow">2 · Scope</span>
            {state ? <ScopePanel settings={state.settings} onChange={saveSettings} /> : <div className="shimmer h-40 rounded-xl" />}
          </div>
          <div className="space-y-3">
            <span className="eyebrow">3 · Results</span>
            {report ? (
              <ScanResults report={report} associations={associations} stale={stale} />
            ) : (
              <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted">
                Preview to see how many letters each branch would catch. Nothing is filed until you press Run.
              </p>
            )}
          </div>
        </section>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border/70 px-6 py-3">
        <span className="hidden text-[10.5px] text-muted sm:block">Hand-filed letters are never moved. Auto-filing is local to this laptop.</span>
        <div className="flex items-center gap-2">
          {report?.applied && (
            <button type="button" onClick={clear} disabled={busy !== null} className="btn-ghost">
              {busy === 'clear' ? <Loader2 className="size-3.5 animate-spin" /> : <Eraser className="size-3.5" />}
              Clear filing
            </button>
          )}
          <button type="button" onClick={() => run(false)} disabled={busy !== null || !hasKeywords} className="btn-soft">
            {busy === 'preview' ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
            Preview
          </button>
          <button
            type="button"
            onClick={() => run(true)}
            disabled={busy !== null || !hasKeywords}
            className="btn-primary"
            title={hasKeywords ? 'Scan and file into branches' : 'Add at least one keyword first'}
          >
            {busy === 'apply' ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
            Run &amp; file
          </button>
        </div>
      </div>
    </>
  );
}
