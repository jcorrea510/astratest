import { defineConfig } from 'vitest/config';
export default defineConfig({
  base: '/astratest/',
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2600,
    rollupOptions: { output: { manualChunks: { three: ['three'], physics: ['@dimforge/rapier3d-compat'] } } },
  },
});
