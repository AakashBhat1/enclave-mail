import { motion } from 'motion/react';
import { EASE_OUT_EXPO } from '../../lib/motion';

/** Shimmering placeholder rows shown while a mailbox is fetched for the first time. */
export function MessageSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div className="space-y-1 px-2 py-1" aria-label="Loading messages" role="status">
      {Array.from({ length: rows }, (_, i) => (
        <motion.div
          key={i}
          className="rounded-xl p-2.5"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1 - i * 0.1, y: 0 }}
          transition={{ duration: 0.6, delay: i * 0.06, ease: EASE_OUT_EXPO }}
        >
          <div className="mb-2.5 flex items-center gap-2.5">
            <div className="shimmer size-[30px] rounded-[10px]" />
            <div className="flex-1 space-y-1.5">
              <div className="shimmer h-2.5 w-2/5 rounded-full" />
              <div className="shimmer h-2 w-1/4 rounded-full" />
            </div>
          </div>
          <div className="shimmer mb-1.5 h-2.5 w-4/5 rounded-full" />
          <div className="shimmer h-2 w-3/5 rounded-full" />
        </motion.div>
      ))}
    </div>
  );
}
