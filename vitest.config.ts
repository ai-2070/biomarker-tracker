// Tests: `bun run test` (or `bun run test:watch`).
//   tests/server: the server's logic, against a throwaway data folder (never your real data/)
//   tests/web:    browser helpers, in a simulated DOM (happy-dom)
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          include: ['tests/server/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/server/setup.ts'],
          // every file gets its own data folder and module state
          isolate: true,
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'web',
          include: ['tests/web/**/*.test.{ts,tsx}'],
          environment: 'happy-dom',
        },
      },
    ],
  },
});
