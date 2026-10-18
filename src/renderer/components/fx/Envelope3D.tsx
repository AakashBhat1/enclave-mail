import { useEffect } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { EASE_OUT_EXPO, SPRING_BOUNCY } from '../../lib/motion';

interface Envelope3DProps {
  /** Width in px; everything else scales from it. */
  size?: number;
  flapOpen?: boolean;
  /** 0 = letter fully tucked in, 1 = peeking out above the envelope. */
  letterOut?: number;
  sealed?: boolean;
  /** Tilt toward the cursor (for idle/hero placements). */
  tilt?: boolean;
  className?: string;
}

// Fixed kraft-paper tones: the envelope is an object in the scene, so it keeps its colour in both themes
const KRAFT = {
  back: 'linear-gradient(180deg, #D9BE9C, #CFAF8A)',
  front: 'linear-gradient(162deg, #FBF1E3 0%, #F1E0C8 55%, #E5CDAE 100%)',
  flap: 'linear-gradient(180deg, #F6E8D4 0%, #EBD5B8 100%)',
  flapUnder: 'linear-gradient(0deg, #E2C9A8, #D4B690)',
  letter: '#FFFDF8',
  line: '#EADFCF',
};

const POCKET = 'polygon(0 0, 50% 52%, 100% 0, 100% 100%, 0 100%)';
const FLAP = 'polygon(0 0, 100% 0, 50% 64%)';

function useCursorTilt(enabled: boolean) {
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rotateY = useSpring(useTransform(px, [-1, 1], [-16, 16]), { stiffness: 120, damping: 18 });
  const rotateX = useSpring(useTransform(py, [-1, 1], [12, -12]), { stiffness: 120, damping: 18 });

  useEffect(() => {
    if (!enabled) return;
    const onMove = (event: PointerEvent) => {
      px.set((event.clientX / window.innerWidth) * 2 - 1);
      py.set((event.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [enabled, px, py]);

  return { rotateX, rotateY };
}

export function Envelope3D({ size = 168, flapOpen = false, letterOut = 0, sealed = false, tilt = false, className }: Envelope3DProps) {
  const height = Math.round(size * 0.64);
  const { rotateX, rotateY } = useCursorTilt(tilt);
  const seal = Math.round(size * 0.2);

  return (
    <div className={className} style={{ perspective: 900 }}>
      <motion.div
        className="relative"
        style={{ width: size, height, rotateX: tilt ? rotateX : 0, rotateY: tilt ? rotateY : 0, transformStyle: 'preserve-3d' }}
      >
        {/* Contact shadow on the "table" */}
        <div
          className="absolute left-1/2 -translate-x-1/2 rounded-[50%] bg-[#5a2f12]/25 blur-md"
          style={{ width: size * 0.9, height: size * 0.09, bottom: -size * 0.14 }}
        />

        <div className="absolute inset-0" style={{ perspective: 700 }}>
          {/* Back panel */}
          <div className="absolute inset-0 rounded-[10px]" style={{ background: KRAFT.back, zIndex: 0 }} />

          {/* Letter */}
          <motion.div
            className="absolute rounded-md px-[9%] pt-[8%]"
            style={{
              left: '7%',
              right: '7%',
              height: height * 0.9,
              bottom: '6%',
              background: KRAFT.letter,
              boxShadow: '0 1px 0 rgba(255,255,255,.9) inset, 0 6px 14px -6px rgba(90,47,18,.35)',
              zIndex: 2,
            }}
            animate={{ y: -letterOut * height * 0.62 }}
            transition={{ duration: 0.55, ease: EASE_OUT_EXPO }}
          >
            {[0.82, 0.64, 0.74, 0.48].map((w, i) => (
              <div key={i} className="mb-[6%] h-[5%] rounded-full" style={{ width: `${w * 100}%`, background: KRAFT.line }} />
            ))}
            <div className="absolute right-[9%] top-[9%] size-[16%] rounded-sm border border-dashed border-[#C4541C]/50 bg-[#FAE2CF]" />
          </motion.div>

          {/* Front pocket (the V-cut front of the envelope) */}
          <div
            className="absolute inset-0 rounded-[10px]"
            style={{
              background: KRAFT.front,
              clipPath: POCKET,
              zIndex: 3,
              boxShadow: 'inset 0 -8px 18px -10px rgba(120,60,20,.25)',
            }}
          />
          {/* Fold creases catching the light */}
          <svg className="pointer-events-none absolute inset-0" style={{ zIndex: 3 }} viewBox="0 0 100 64" preserveAspectRatio="none">
            <path d="M0 64 L50 33.3 L100 64" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth=".6" />
            <path d="M0 0.5 L50 33.3 L100 0.5" fill="none" stroke="rgba(120,60,20,.12)" strokeWidth=".5" />
          </svg>

          {/* Flap: swings open behind the letter, closes over the pocket */}
          <motion.div
            className="absolute inset-x-0 top-0 origin-top"
            style={{ height: height * 0.92, clipPath: FLAP, transformStyle: 'preserve-3d' }}
            initial={false}
            animate={{ rotateX: flapOpen ? 178 : 0, zIndex: flapOpen ? 1 : 4 }}
            transition={{
              rotateX: { duration: 0.6, ease: EASE_OUT_EXPO },
              zIndex: { delay: flapOpen ? 0.12 : 0.22, duration: 0 },
            }}
          >
            <div className="absolute inset-0" style={{ background: flapOpen ? KRAFT.flapUnder : KRAFT.flap }} />
            <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-transparent" />
          </motion.div>

          {/* Wax seal */}
          <motion.div
            className="absolute left-1/2 grid place-items-center"
            style={{ width: seal, height: seal, top: height * 0.58 - seal / 2, marginLeft: -seal / 2, zIndex: 5 }}
            initial={false}
            animate={sealed ? { scale: 1, opacity: 1, rotate: -8 } : { scale: 2.2, opacity: 0, rotate: 20 }}
            transition={sealed ? SPRING_BOUNCY : { duration: 0.2 }}
          >
            <div
              className="absolute inset-0"
              style={{
                borderRadius: '48% 52% 46% 54% / 52% 46% 54% 48%',
                background: 'radial-gradient(circle at 35% 30%, #E07A3F, #C4541C 45%, #8E2F36 100%)',
                boxShadow: '0 2px 0 rgba(255,255,255,.25) inset, 0 -2px 3px rgba(0,0,0,.25) inset, 0 4px 10px -3px rgba(90,20,10,.55)',
              }}
            />
            <div className="absolute inset-[18%] rounded-full border border-white/25" />
            <span className="display relative text-white/85" style={{ fontSize: seal * 0.48, textShadow: '0 -1px 0 rgba(0,0,0,.25)' }}>
              E
            </span>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
