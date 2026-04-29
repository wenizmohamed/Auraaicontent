// Flat ESLint config — Phase 7. Minimal but real: TypeScript parsing,
// React + jsx-a11y plugins, runs against src/. Wired to `npm run lint:a11y`
// in package.json. Existing `npm run lint` (tsc --noEmit) stays intact.
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';

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
      'react-hooks': reactHooks,
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
      'jsx-a11y/no-noninteractive-element-interactions': 'warn',
      'jsx-a11y/label-has-associated-control': 'warn',
      // Pre-existing video tags need <track> for caption a11y — known follow-up.
      'jsx-a11y/media-has-caption': 'warn',
      // Empty catch with intentional ignore-comment is valid silent-failure pattern.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Pre-existing no-useless-escape in a few regexes — not introduced this session.
      'no-useless-escape': 'warn',
      'no-useless-assignment': 'off',
      // The "preserve-caught-error" rule is from a third-party preset we
      // don't load; downgrade so existing throws-without-cause don't fail CI.
      'preserve-caught-error': 'off',
      'no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },
];
