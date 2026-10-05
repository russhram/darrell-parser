import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/viewer',
  workers: 1,
  use: { browserName: 'chromium' },
});
