import { defineConfig, devices } from '@playwright/test';

const PORT = 4174;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    // Phone-sized, as the guide is mobile-first.
    ...devices['Pixel 7'],
    viewport: { width: 390, height: 844 },
    locale: 'ar',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'mobile-chromium', use: { browserName: 'chromium' } }],
  // Test the production build so the service worker is real.
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
