import { useEffect, useState } from 'react';
import type { IpcResult, SenderGroup, SenderGroupMode } from '../types/index';

/** Sender (or domain) groups for the People view; `refreshKey` changes whenever stored mail changes. */
export function useSenderGroups(providerId: string, mode: SenderGroupMode, enabled: boolean, refreshKey: number): SenderGroup[] {
  const [groups, setGroups] = useState<SenderGroup[]>([]);

  useEffect(() => {
    if (!enabled || !providerId || !window.electronAPI?.getSenderGroups) return;
    let cancelled = false;
    window.electronAPI.getSenderGroups(providerId, mode).then((res: IpcResult<SenderGroup[]>) => {
      if (cancelled) return;
      if (res.success && res.data) setGroups(res.data);
      else console.error('Could not load sender groups:', res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [providerId, mode, enabled, refreshKey]);

  // A different account must never flash the previous account's people
  useEffect(() => setGroups([]), [providerId]);

  return groups;
}
