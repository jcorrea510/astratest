import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const PORT = Number(process.env.PW_PORT ?? 4173);
const local = existsSync('/opt/pw-browsers/chromium') && !process.env.CI ? '/opt/pw-browsers/chromium' : undefined;
export default defineConfig({
  testDir: './tests/e2e',
  grepInvert: process.env.SOAK ? undefined : /@soak/,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${PORT}/astratest/`,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    trace: 'off',
    launchOptions: { executablePath: local, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--enable-precise-memory-info', '--js-flags=--expose-gc', '--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: { command: `npm run build && npx vite preview --port ${PORT} --strictPort --host 127.0.0.1`, url: `http://127.0.0.1:${PORT}/astratest/`, reuseExistingServer: !process.env.CI, timeout: 180_000 },
  reporter: [['list']],
});
