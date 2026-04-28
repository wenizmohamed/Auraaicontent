// ESLint 9 flat config — focused enforcement.
// Goal: lock the route boundary so future PRs can't reintroduce `as any`
// or `@ts-ignore` at request handlers. Service / worker / lib code is
// permissive on purpose — they're internal and the type system handles them.
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'prisma/migrations/**', 'test/**'],
  },
  {
    files: ['src/routes/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      '@typescript-eslint/no-explicit-any': ['error', { ignoreRestArgs: false }],
      '@typescript-eslint/ban-ts-comment': ['error', {
        'ts-ignore': true,
        'ts-nocheck': true,
        'ts-expect-error': 'allow-with-description',
        minimumDescriptionLength: 10,
      }],
    },
  },
];
