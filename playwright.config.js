import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/plot/browser',
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1440, height: 950 } },
  projects: [
    { name: 'chrome', use: { channel: 'chrome' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: [
    { command: 'npm run dev:browser', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
    { command: 'npm run preview', url: 'http://127.0.0.1:4174', reuseExistingServer: false },
  ],
  workers: 2,
});
