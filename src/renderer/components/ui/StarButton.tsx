import { useState, type MouseEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Star } from 'lucide-react';
import { EASE_OUT_EXPO, SPRING_BOUNCY } from '../../lib/motion';

interface StarButtonProps {
  starred: boolean;
  onToggle: (event: MouseEvent) => void;
  size?: 'sm' | 'md';
}

const SPARKS = [0, 60, 120, 180, 240, 300];

/** Star that pops with a little ring of marigold sparks when it becomes starred. */
export function StarButton({ starred, onToggle, size = 'sm' }: StarButtonProps) {
  const [burst, setBurst] = useState(0);
  const iconClass = size === 'sm' ? 'size-3.5' : 'size-[18px]';

  return (
    <button
      type="button"
      onClick={(event) => {
        if (!starred) setBurst((b) => b + 1);
        onToggle(event);
      }}
      className={`relative grid place-items-center rounded-lg text-muted transition-colors hover:text-marigold ${size === 'sm' ? 'size-6' : 'size-8 hover:bg-sunken'}`}
      aria-label={starred ? 'Unstar' : 'Star'}
      aria-pressed={starred}
    >
      <motion.span key={burst} initial={burst ? { scale: 0.4, rotate: -40 } : false} animate={{ scale: 1, rotate: 0 }} transition={SPRING_BOUNCY}>
        <Star className={`${iconClass} ${starred ? 'fill-marigold text-marigold' : ''}`} strokeWidth={2} />
      </motion.span>
      <AnimatePresence>
        {burst > 0 && starred && (
          <motion.span key={`b-${burst}`} className="pointer-events-none absolute inset-0" exit={{ opacity: 0 }}>
            {SPARKS.map((deg) => (
              <motion.span
                key={deg}
                className="absolute left-1/2 top-1/2 size-1 rounded-full bg-marigold"
                initial={{ x: '-50%', y: '-50%', opacity: 1, scale: 1 }}
                animate={{
                  x: `calc(-50% + ${Math.cos((deg * Math.PI) / 180) * 14}px)`,
                  y: `calc(-50% + ${Math.sin((deg * Math.PI) / 180) * 14}px)`,
                  opacity: 0,
                  scale: 0.3,
                }}
                transition={{ duration: 0.55, ease: EASE_OUT_EXPO }}
              />
            ))}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}
