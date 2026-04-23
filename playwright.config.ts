import { defineConfig } from '@playwright/test';

const headless = process.env.HEADLESS !== 'false';

export default defineConfig({
  testDir: 'tests',
  use: {
    headless,
    trace: 'retain-on-failure'
  }
});