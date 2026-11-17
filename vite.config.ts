import { defineConfig } from 'vitest/config';
export default defineConfig({ base: '/astratest/', test: { include: ['src/**/*.test.ts'], environment: 'node' }, build: { target: 'es2022' } });
