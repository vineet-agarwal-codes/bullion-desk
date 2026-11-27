import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'PORT=3001 DB_PATH=/tmp/bullion-e2e.db ENABLE_LIVE_FEED=false npm --workspace=@bullion-desk/server run dev',
      port: 3001,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'VITE_API_URL=http://localhost:3001 npm --workspace=@bullion-desk/web run dev -- --port 5173',
      port: 5173,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
