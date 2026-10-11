import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Local database URLs for integration tests come from git-ignored env files when present.
for (const file of ['.env', '.env.db-admin']) {
  if (existsSync(file)) process.loadEnvFile(file);
}

export default defineConfig({
  test: {
    include: [
      'apps/*/src/**/*.test.ts',
      'apps/web/lib/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
      'packages/broker-adapters/*/src/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/.next/**'],
    environment: 'node',
    // Worker smoke tests spawn real processes.
    testTimeout: 20_000,
    // Database integration files share one test database; run files one at a time.
    fileParallelism: false,
  },
});
