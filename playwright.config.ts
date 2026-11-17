import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
export default defineConfig({ testDir: './tests/e2e', use: { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'] }, baseURL: 'http://127.0.0.1:4173/astratest/', screenshot: 'only-on-failure' }, webServer: { command: 'npm run build && npm run preview -- --port 4173', url: 'http://127.0.0.1:4173/astratest/', reuseExistingServer: !process.env.CI }, reporter: 'list' });
