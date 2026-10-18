import type { TreeScanReport, TreeSorterSettings, TreeSorterState } from '../../renderer/types/index';
import { StorageService, type TreeSorterFile } from './storage-service';
import { sanitizeSorterSettings, scanMessages, suggestKeywords } from './tree-classifier';

/**
 * The Keyword Tree Sorter mod: the user puts keywords on tree branches, then this scans the chosen
 * folders and files each letter into every branch whose keyword it mentions. Filing is a separate
 * index (tree-sorter.json), so a re-run replaces it cleanly and hand-filed letters are never touched.
 */
export class TreeSorterService {
  constructor(private readonly storage: StorageService) {}

  private toState(providerId: string, file: TreeSorterFile): TreeSorterState {
    const suggestions = suggestKeywords(this.storage.getAllMessages(providerId), this.storage.getAssociations(providerId), file.settings);
    return { settings: file.settings, lastScan: file.lastScan, suggestions };
  }

  public getState(providerId: string): TreeSorterState {
    return this.toState(providerId, this.storage.getTreeSorter(providerId));
  }

  public saveSettings(providerId: string, input: Partial<TreeSorterSettings>): TreeSorterState {
    const current = this.storage.getTreeSorter(providerId);
    return this.toState(providerId, this.storage.saveTreeSorter(providerId, { ...current, settings: sanitizeSorterSettings(input) }));
  }

  /** Scans with the saved settings. With apply=false it is a dry run that changes nothing. */
  public run(providerId: string, apply: boolean): TreeScanReport {
    const current = this.storage.getTreeSorter(providerId);
    const { matches, report } = scanMessages(this.storage.getAllMessages(providerId), this.storage.getAssociations(providerId), current.settings);
    if (!apply) return report;
    const applied = { ...report, applied: true };
    this.storage.saveTreeSorter(providerId, { ...current, matches, lastScan: applied });
    return applied;
  }

  public clear(providerId: string): TreeSorterState {
    const current = this.storage.getTreeSorter(providerId);
    return this.toState(providerId, this.storage.saveTreeSorter(providerId, { ...current, matches: {}, lastScan: null }));
  }

  /** Called after every sync and history batch; only re-files when the user switched auto-run on. */
  public autoRun(providerId: string): boolean {
    if (!this.storage.getTreeSorter(providerId).settings.autoRun) return false;
    this.run(providerId, true);
    return true;
  }
}
