import tseslint from 'typescript-eslint';
import nextVitals from 'eslint-config-next/core-web-vitals';

export default [
  {
    ignores: ['**/node_modules/**', '**/.next/**', '**/next-env.d.ts', '.agents/**', '.claude/**', 'coverage/**'],
  },
  ...tseslint.configs.recommended,
  ...nextVitals.map((config) => ({
    ...config,
    files: ['apps/web/**/*.{ts,tsx,js,mjs}'],
    settings: { ...config.settings, next: { rootDir: 'apps/web/' } },
  })),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Application code must never depend on local-only Claude Code tooling.
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['**/.agents/**', '**/.claude/**'] }],
    },
  },
];
