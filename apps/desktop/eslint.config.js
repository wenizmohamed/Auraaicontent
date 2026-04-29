// Flat ESLint config — Phase 7. Minimal but real: TypeScript parsing,
// React + jsx-a11y plugins, runs against src/. Wired to `npm run lint:a11y`
// in package.json. Existing `npm run lint` (tsc --noEmit) stays intact.
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'electron/**'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx,jsx,js}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        Blob: 'readonly',
        FormData: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        location: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLImageElement: 'readonly',
        KeyboardEvent: 'readonly',
        MouseEvent: 'readonly',
        Event: 'readonly',
        Node: 'readonly',
      },
    },
    plugins: {
      'jsx-a11y': jsxA11y,
    },
    rules: {
      // Type-aware rules belong in tsc --noEmit (already in `npm run lint`).
      // This config is purely the a11y safety net.
      ...jsxA11y.configs.recommended.rules,
      // Pragmatic loosenings — Radix primitives manage their own a11y +
      // we use lots of custom roles for design-system parity.
      'jsx-a11y/no-autofocus': 'off',
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',
      'jsx-a11y/label-has-associated-control': 'warn',
      'no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },
];
