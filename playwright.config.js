import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5190', headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {} },
  webServer: {
    command: 'npm run dev -- --port 5190 --strictPort', url: 'http://127.0.0.1:5190', reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: 'https://unit-test.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_unit_test_fixture_only' }
  }
});
