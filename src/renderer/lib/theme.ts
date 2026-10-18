import { flushSync } from 'react-dom';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'enclave-theme';

export function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyThemeClass(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable; the theme still applies for this session
  }
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Switch theme with a circular reveal spreading from the click point (same effect as the resume site). */
export function switchTheme(next: Theme, origin: { x: number; y: number }, commit: (theme: Theme) => void): void {
  const apply = () => {
    flushSync(() => commit(next));
    applyThemeClass(next);
    persistTheme(next);
  };

  if (!document.startViewTransition || prefersReducedMotion()) {
    apply();
    return;
  }

  const root = document.documentElement;
  root.style.setProperty('--vt-x', `${origin.x}px`);
  root.style.setProperty('--vt-y', `${origin.y}px`);
  root.classList.add('theme-vt');
  const transition = document.startViewTransition(apply);
  transition.finished.finally(() => root.classList.remove('theme-vt'));
}
