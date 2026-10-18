const DAY_MS = 24 * 60 * 60 * 1000;

/** Compact list date: time today, weekday this week, "16 Oct" this year, "16 Oct 2025" before. */
export function formatListDate(timestamp: number | undefined, fallback: string): string {
  if (!timestamp) return fallback;
  const date = new Date(timestamp);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (timestamp >= startOfToday) return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (timestamp >= startOfToday - 6 * DAY_MS) return date.toLocaleDateString(undefined, { weekday: 'short' });
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Full reading-pane date, e.g. "Sat, 18 Oct 2026, 11:51". */
export function formatFullDate(timestamp: number | undefined, fallback: string): string {
  if (!timestamp) return fallback;
  return new Date(timestamp).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
