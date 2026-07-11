import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export const ignores = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.next/**',
  '**/coverage/**',
  '**/tsc-out/**',
  '**/generated/**',
  '**/*.cjs',
  '**/*.mjs',
];

// Rules-only, no `plugins`/`parser` registration — for consumers (like dashboard) that
// already get the `@typescript-eslint` plugin registered by another shared config
// (e.g. eslint-config-next) and would conflict with a second registration of it.
export const customRules = {
  rules: {
    // Superseded by the TS-aware versions below — the core rules don't understand
    // type-only positions (e.g. `React.ReactNode`) and flag false positives.
    'no-undef': 'off',
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
  },
};

export const baseConfig = tseslint.config(
  { ignores },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  eslintConfigPrettier,
  customRules,
);

export default tseslint.config(
  ...baseConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
