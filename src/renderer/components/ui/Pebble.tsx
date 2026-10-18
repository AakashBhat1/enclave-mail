import type { CSSProperties, ReactNode } from 'react';

interface PebbleProps {
  color: string;
  children: ReactNode;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/** A glossy, lit 3D tile (avatars, brand mark): top light, inner rim shading, and a coloured drop glow. */
export function Pebble({ color, children, size = 44, className = '', style }: PebbleProps) {
  return (
    <span
      className={`relative inline-grid flex-shrink-0 place-items-center overflow-hidden font-semibold text-white ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.34,
        background: `radial-gradient(120% 90% at 30% 15%, rgba(255,255,255,.45), transparent 48%), radial-gradient(90% 90% at 70% 110%, rgba(0,0,0,.28), transparent 60%), ${color}`,
        boxShadow: `0 1px 0 rgba(255,255,255,.45) inset, 0 -3px 6px rgba(0,0,0,.18) inset, 0 10px 22px -10px ${color}`,
        fontSize: size * 0.4,
        textShadow: '0 1px 2px rgba(0,0,0,.25)',
        ...style,
      }}
    >
      {/* Specular streak */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -left-1/4 top-0 h-1/2 w-[150%] -rotate-12 bg-gradient-to-b from-white/25 to-transparent"
      />
      <span className="relative">{children}</span>
    </span>
  );
}
