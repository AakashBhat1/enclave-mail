import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Envelope3D } from './Envelope3D';
import { EASE_IN_OUT, EASE_OUT_EXPO } from '../../lib/motion';
import { prefersReducedMotion } from '../../lib/theme';

export interface FlightOrigin {
  x: number;
  y: number;
}

interface SendFlightProps {
  origin: FlightOrigin;
  onDone: () => void;
}

type Stage = 'enter' | 'tuck' | 'close' | 'seal' | 'fly';

// ms from start at which each stage begins
const TIMELINE: Array<[Stage, number]> = [
  ['tuck', 380],
  ['close', 720],
  ['seal', 1020],
  ['fly', 1380],
];
const TOTAL_MS = 2300;
const ENVELOPE = 176;

const EMBER_COLORS = ['#E3A33A', '#C4541C', '#F6C177', '#E07A3F', '#FFE3B8'];

interface Ember {
  id: number;
  dx: number;
  dy: number;
  size: number;
  delay: number;
  color: string;
}

function makeEmbers(count: number): Ember[] {
  return Array.from({ length: count }, (_, id) => {
    const angle = Math.PI * (0.55 + Math.random() * 0.75);
    const dist = 60 + Math.random() * 140;
    return {
      id,
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist * 0.8 + 30,
      size: 3 + Math.random() * 5,
      delay: Math.random() * 0.25,
      color: EMBER_COLORS[id % EMBER_COLORS.length],
    };
  });
}

/** The full send ceremony: letter → envelope → seal → flight. Pointer-transparent so the app stays usable. */
export function SendFlight({ origin, onDone }: SendFlightProps) {
  const [stage, setStage] = useState<Stage>('enter');
  const embers = useMemo(() => makeEmbers(18), []);

  useEffect(() => {
    if (prefersReducedMotion()) {
      const skip = window.setTimeout(onDone, 0);
      return () => window.clearTimeout(skip);
    }
    const timers = TIMELINE.map(([next, at]) => window.setTimeout(() => setStage(next), at));
    timers.push(window.setTimeout(onDone, TOTAL_MS));
    return () => timers.forEach((t) => window.clearTimeout(t));
    // onDone is intentionally read once; the ceremony must not restart on parent re-renders
  }, []);

  const flying = stage === 'fly';
  const after = (s: Stage) => TIMELINE.findIndex(([n]) => n === stage) >= TIMELINE.findIndex(([n]) => n === s);
  const flyX = window.innerWidth - origin.x + 120;
  const flyY = -(origin.y + 160);

  return (
    <div className="pointer-events-none fixed inset-0 z-[70]" aria-hidden="true">
      {/* Warm flash where the letter is folded */}
      <motion.div
        className="absolute rounded-full"
        style={{
          left: origin.x - 260,
          top: origin.y - 260,
          width: 520,
          height: 520,
          background: 'radial-gradient(circle, rgb(var(--spot) / .9), transparent 62%)',
        }}
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: flying ? 0 : 0.85, scale: flying ? 1.4 : 1 }}
        transition={{ duration: 0.8, ease: EASE_OUT_EXPO }}
      />

      <motion.div
        className="absolute"
        style={{ left: origin.x - ENVELOPE / 2, top: origin.y - ENVELOPE * 0.32 }}
        initial={{ opacity: 0, scale: 0.55, y: 40, rotate: -4 }}
        animate={
          flying
            ? {
                x: [0, -26, flyX],
                y: [0, 18, flyY],
                rotate: [0, 5, -24],
                scale: [1, 1.05, 0.28],
                opacity: [1, 1, 0],
              }
            : { opacity: 1, scale: 1, y: 0, rotate: 0 }
        }
        transition={
          flying
            ? { duration: 0.92, times: [0, 0.2, 1], ease: EASE_IN_OUT }
            : { duration: 0.6, ease: EASE_OUT_EXPO }
        }
      >
        <Envelope3D
          size={ENVELOPE}
          flapOpen={!after('close')}
          letterOut={stage === 'enter' ? 1 : 0}
          sealed={after('seal')}
        />

        {/* Seal ripple */}
        {after('seal') && (
          <motion.div
            className="absolute left-1/2 rounded-full border-2 border-primary/60"
            style={{ top: ENVELOPE * 0.64 * 0.58 - 20, marginLeft: -20, width: 40, height: 40 }}
            initial={{ scale: 0.6, opacity: 0.9 }}
            animate={{ scale: 3.2, opacity: 0 }}
            transition={{ duration: 0.7, ease: EASE_OUT_EXPO }}
          />
        )}
      </motion.div>

      {/* Ember trail left behind at launch */}
      {flying &&
        embers.map((e) => (
          <motion.span
            key={e.id}
            className="absolute rounded-full"
            style={{
              left: origin.x,
              top: origin.y,
              width: e.size,
              height: e.size,
              background: e.color,
              boxShadow: `0 0 ${e.size * 2}px ${e.color}`,
            }}
            initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
            animate={{ x: e.dx, y: e.dy, opacity: [0, 1, 0], scale: [0.4, 1, 0.2] }}
            transition={{ duration: 0.9, delay: e.delay, ease: EASE_OUT_EXPO }}
          />
        ))}

      {/* Speed streaks along the launch direction */}
      {flying &&
        [0, 1, 2].map((i) => (
          <motion.span
            key={`streak-${i}`}
            className="absolute h-[2px] origin-left rounded-full bg-gradient-to-r from-transparent via-marigold to-transparent"
            style={{ left: origin.x - 40, top: origin.y - 10 + i * 14, width: 220, rotate: -38 }}
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: [0, 1, 1], opacity: [0, 0.8, 0], x: [0, 60, 140] }}
            transition={{ duration: 0.6, delay: 0.12 + i * 0.05, ease: EASE_OUT_EXPO }}
          />
        ))}
    </div>
  );
}
