import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// P9 (docs/tenant_isolation_and_platform_admin_plan.md §P9 required suite #8, "Dashboard tests
// for cache clearing and direct-route guards") — the dashboard had no test runner at all before
// this (test:module-capabilities is a bespoke tsc+node script for one pure-logic file; nothing
// exercises a React hook/component). Vitest chosen over Jest for a Next.js 16 + React 19 app:
// native ESM/Vite transform (no ts-jest/babel config needed for this package's own tsconfig),
// and it already shares jsdom with nothing else in this workspace to conflict with. Excludes
// test/module-capabilities.test.mjs — that file is plain Node/assert, run only via its own
// test:module-capabilities script, not part of this suite.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
