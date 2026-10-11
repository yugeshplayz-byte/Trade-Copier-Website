import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/*/src/**/*.test.ts', 'apps/web/lib/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**'],
    environment: 'node',
    // Worker smoke tests spawn real processes.
    testTimeout: 20_000,
  },
});
