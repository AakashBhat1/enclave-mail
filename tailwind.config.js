/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        serif: ['"Fraunces Variable"', 'Georgia', 'serif'],
        sans: ['"Plus Jakarta Sans Variable"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Consolas', 'monospace'],
      },
      // Warm palette shared with the resume site (C:\dev\resume\app\globals.css)
      colors: {
        background: token('background'),
        surface: token('surface'),
        sunken: token('sunken'),
        foreground: token('foreground'),
        muted: token('muted'),
        border: token('border'),
        primary: {
          DEFAULT: token('primary'),
          hover: token('primary-hover'),
          soft: token('primary-soft'),
        },
        marigold: token('marigold'),
        cranberry: token('cranberry'),
        moss: token('moss'),
        sky: token('sky'),
      },
      boxShadow: {
        warm: '0 1px 0 rgb(var(--shadow) / .05), 0 10px 30px -14px rgb(var(--shadow-glow) / .28)',
        'warm-lg': '0 2px 4px rgb(var(--shadow) / .06), 0 24px 60px -20px rgb(var(--shadow-glow) / .38)',
        pane: '0 1px 0 rgb(255 255 255 / .55) inset, 0 0 0 1px rgb(var(--border) / .7), 0 18px 50px -28px rgb(var(--shadow-glow) / .45)',
        pressed: 'inset 0 2px 6px rgb(var(--shadow) / .18)',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'in-out-quint': 'cubic-bezier(0.83, 0, 0.17, 1)',
      },
      width: {
        18: '4.5rem',
      },
    },
  },
  plugins: [],
};
