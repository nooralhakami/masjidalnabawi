import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const PORT = 4174;
/** The browser: $CHROME if given, else the container's Chromium 1194 if present, else Playwright's own (CI). */
const CONTAINER_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CHROME = process.env.CHROME ?? (existsSync(CONTAINER_CHROME) ? CONTAINER_CHROME : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    // Phone-sized, as the guide is mobile-first.
    ...devices['Pixel 7'],
    viewport: { width: 390, height: 844 },
    locale: 'ar',
    trace: 'retain-on-failure',
    launchOptions: {
      // Playwright 1.63 expects Chromium 1243; the container has 1194 (tests/CLAUDE.md). WebGL runs on
      // SwiftShader, which needs these flags in headless Chromium.
      executablePath: CHROME,
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
    },
  },
  projects: [{ name: 'mobile-chromium', use: { browserName: 'chromium' } }],
  // The production build, so the service worker and the bundling are real.
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/map.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
