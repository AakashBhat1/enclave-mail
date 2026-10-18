import { AnimatePresence, motion } from 'motion/react';
import { Moon, Sun } from 'lucide-react';
import { switchTheme, type Theme } from '../../lib/theme';

interface ThemeToggleProps {
  theme: Theme;
  onChange: (theme: Theme) => void;
}

export function ThemeToggle({ theme, onChange }: ThemeToggleProps) {
  const Icon = theme === 'dark' ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={(event) => switchTheme(theme === 'dark' ? 'light' : 'dark', { x: event.clientX, y: event.clientY }, onChange)}
      className="grid size-10 place-items-center overflow-hidden rounded-xl text-muted transition-colors hover:bg-sunken hover:text-primary"
      title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
      aria-label="Toggle colour theme"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          initial={{ y: 18, rotate: -90, opacity: 0 }}
          animate={{ y: 0, rotate: 0, opacity: 1 }}
          exit={{ y: -18, rotate: 90, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 24 }}
        >
          <Icon className="size-4" />
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
