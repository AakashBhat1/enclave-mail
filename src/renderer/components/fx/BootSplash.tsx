import { motion } from 'motion/react';
import { Envelope3D } from './Envelope3D';
import { EASE_IN_OUT, EASE_OUT_EXPO } from '../../lib/motion';

const WORDMARK = ['Enclave', 'Mail'];

/** First-paint splash: the envelope settles in, the wordmark rises word by word, a light sweeps the rule. */
export function BootSplash() {
  return (
    <motion.div
      className="fixed inset-0 z-[90] grid place-items-center bg-background/40 backdrop-blur-[2px]"
      exit={{ opacity: 0, scale: 1.04, filter: 'blur(10px)', transition: { duration: 0.6, ease: EASE_IN_OUT } }}
    >
      <div className="flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, y: 30, rotateX: 40, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
          transition={{ duration: 1.1, ease: EASE_OUT_EXPO }}
        >
          <div className="float-y">
            <Envelope3D size={150} letterOut={0.55} flapOpen tilt />
          </div>
        </motion.div>

        <h1 className="display mt-14 flex gap-3 text-5xl text-foreground">
          {WORDMARK.map((word, i) => (
            <span key={word} className="inline-block overflow-hidden pb-1">
              <span className={`word-rise ${i === 1 ? 'italic text-primary' : ''}`} style={{ animationDelay: `${0.25 + i * 0.12}s` }}>
                {word}
              </span>
            </span>
          ))}
        </h1>

        <motion.p
          className="eyebrow mt-3"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.55, ease: EASE_OUT_EXPO }}
        >
          Opening your local enclaves
        </motion.p>

        <div className="relative mt-6 h-[2px] w-44 overflow-hidden rounded-full bg-border/70">
          <span className="sync-sweep absolute inset-y-0 left-0 w-1/2 rounded-full bg-gradient-to-r from-transparent via-primary to-transparent" />
        </div>
      </div>
    </motion.div>
  );
}
