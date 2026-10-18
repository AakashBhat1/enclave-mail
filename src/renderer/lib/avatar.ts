// Warm palette for sender avatars: pumpkin, cranberry, moss, marigold-brown, deep teal, walnut, clay
const PALETTE = ['#C4541C', '#8E2F36', '#5F6B3A', '#B7791F', '#3F6C73', '#7A5C3E', '#A8553A'];

/** Stable colour per sender so the same person always gets the same pebble. */
export function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function initialOf(text: string): string {
  return (text.trim().charAt(0) || '?').toUpperCase();
}

export const ACCOUNT_COLORS = ['#C4541C', '#8E2F36', '#5F6B3A', '#B7791F', '#3F6C73', '#7A5C3E'];
