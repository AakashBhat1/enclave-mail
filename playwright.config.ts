import { defineConfig } from '@playwright/test';

// Drives the built Electron app (run `pnpm build` first); no browsers are downloaded or used
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
});
