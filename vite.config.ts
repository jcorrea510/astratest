import { defineConfig } from 'vitest/config';
export default defineConfig({
  base: process.env.MA_BASE ?? '/astratest/', // npm run local builds for the root path
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2600,
    rollupOptions: { output: { manualChunks: { three: ['three'], physics: ['@dimforge/rapier3d-compat'] } } },
  },
});
