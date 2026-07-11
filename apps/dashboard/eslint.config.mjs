import js from '@eslint/js';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import eslintConfigPrettier from 'eslint-config-prettier';
import { ignores, customRules } from '../../eslint.config.mjs';

export default [
  // eslint-config-next's legacy babel parser (used for plain .js/.jsx files) isn't
  // compatible with newer ESLint scope-manager internals yet — this repo's only such
  // file is plain CJS config, so excluding it from linting is a no-op in practice.
  { ignores: [...ignores, 'postcss.config.js'] },
  js.configs.recommended,
  // Registers its own `@typescript-eslint` plugin/parser for .ts/.tsx — don't also
  // spread the root `baseConfig` here, it registers a second, conflicting instance.
  ...nextCoreWebVitals,
  eslintConfigPrettier,
  customRules,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];
