import { baseConfig } from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // typescript-eslint's project-service type resolution doesn't pick up @types/jest's ambient
    // globals (describe/it/expect/jest) for these files the way a plain `tsc` program does, so
    // every jest.fn()/expect() call reads as a method on `any` — the type-aware "unsafe-*" rules
    // exist to catch real `any` leaks in application code, not this. Jest itself (via ts-jest,
    // configured separately in jest.config.ts) still fully type-checks these files when they run.
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
];
