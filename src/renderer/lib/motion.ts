import type { Transition, Variants } from 'motion/react';

export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;

export const SPRING_SOFT: Transition = { type: 'spring', stiffness: 260, damping: 30, mass: 0.9 };
export const SPRING_SNAPPY: Transition = { type: 'spring', stiffness: 520, damping: 34 };
export const SPRING_BOUNCY: Transition = { type: 'spring', stiffness: 420, damping: 16 };

/** Rows rise in one after another; capped so long lists never feel slow. */
export function staggerDelay(index: number, step = 0.035, cap = 10): number {
  return Math.min(index, cap) * step;
}

export const fadeRise: Variants = {
  hidden: { opacity: 0, y: 14, filter: 'blur(6px)' },
  shown: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.7, ease: EASE_OUT_EXPO } },
};
