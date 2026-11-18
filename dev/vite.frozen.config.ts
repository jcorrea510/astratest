// Dev server without HMR/file watching, so long e2e runs are not reloaded by edits happening elsewhere.
// Usage: npx vite --config dev/vite.frozen.config.ts --port 5299 --strictPort
import { defineConfig, mergeConfig } from 'vite';
import base from '../vite.config';
export default mergeConfig(base, defineConfig({ root: '.', server: { hmr: false, watch: { ignored: ['**/*'] } } }));
