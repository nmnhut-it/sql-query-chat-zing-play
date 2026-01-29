import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './src/e2e',
  testMatch: '*.pw.ts',
  timeout: 60_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5173/sql-query-chat-zing-play/',
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173/sql-query-chat-zing-play/',
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
