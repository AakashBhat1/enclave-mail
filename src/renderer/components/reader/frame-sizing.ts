export const MIN_FRAME_HEIGHT = 120;
// Far taller than any real letter; past it the frame scrolls on its own
export const MAX_FRAME_HEIGHT = 30_000;
// The same growth this many times in a row means the letter sizes itself from the frame (100vh, height:100%)
const RUNAWAY_STEPS = 3;
const JITTER_PX = 2;

export interface FrameSizing {
  height: number;
  lastGrowth: number;
  streak: number;
  /** Once locked the frame keeps its height and stops following the letter. */
  locked: boolean;
}

export const INITIAL_SIZING: FrameSizing = { height: MIN_FRAME_HEIGHT, lastGrowth: 0, streak: 0, locked: false };

/** The frame height for a newly measured content height; returns the same object when nothing changes. */
export function nextSizing(current: FrameSizing, measured: number): FrameSizing {
  if (current.locked) return current;
  const target = Math.min(MAX_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, Math.ceil(measured)));
  const growth = target - current.height;
  if (Math.abs(growth) < JITTER_PX) return current;

  const streak = growth > 0 && growth === current.lastGrowth ? current.streak + 1 : growth > 0 ? 1 : 0;
  return {
    height: target,
    lastGrowth: Math.max(growth, 0),
    streak,
    locked: streak >= RUNAWAY_STEPS || target === MAX_FRAME_HEIGHT,
  };
}

/** A new page in the same frame (e.g. after "Load images") starts following again from the current height. */
export function restartSizing(current: FrameSizing): FrameSizing {
  return { ...current, lastGrowth: 0, streak: 0, locked: false };
}
