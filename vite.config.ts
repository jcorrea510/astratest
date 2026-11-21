import { defineConfig } from 'vitest/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Stamps the service worker with a per-build id so each deploy gets a fresh cache (and old ones are removed). */
const stampServiceWorker = () => {
  let outDir = 'dist';
  return {
    name: 'ma-stamp-sw',
    configResolved(c: { build: { outDir: string } }) { outDir = c.build.outDir; },
    closeBundle() {
      const f = join(outDir, 'sw.js');
      if (existsSync(f)) writeFileSync(f, readFileSync(f, 'utf8').replaceAll('__BUILD_ID__', Date.now().toString(36)));
    },
  };
};
export default defineConfig({
  base: process.env.MA_BASE ?? '/astratest/', // npm run local builds for the root path
  plugins: [stampServiceWorker()],
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2600,
    rollupOptions: { output: { manualChunks: { three: ['three'], physics: ['@dimforge/rapier3d-compat'] } } },
  },
});
