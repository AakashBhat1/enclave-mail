import { defineConfig } from 'vitest/config';

// Kept apart from vite.config.ts so tests never boot the Electron plugin
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
