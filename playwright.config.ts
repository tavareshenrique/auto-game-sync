import { defineConfig } from '@playwright/test';

const headless = process.env.HEADLESS !== 'false';

export default defineConfig({
  use: {
    headless,
    trace: 'retain-on-failure'
  }
});