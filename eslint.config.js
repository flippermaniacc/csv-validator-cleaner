import { builtinModules } from 'node:module';
import js from '@eslint/js';
import globals from 'globals';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

const NATIVE_OR_IO_PACKAGES = [
  'fastify',
  '@fastify/*',
  'better-sqlite3',
  're2',
  'react',
  'react-dom',
];
const NODE_BUILTINS = [...new Set(builtinModules.flatMap((m) => [m, `node:${m}`]))];

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'data/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Plain JS tooling files (this config, dependency-cruiser) run under Node.
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // core: pure library. No I/O, no native modules, no HTTP/DB/UI, and no
    // sources of nondeterminism (design section 1.1 and 3.3).
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...NATIVE_OR_IO_PACKAGES, ...NODE_BUILTINS].map((name) => ({
            name,
            message: 'packages/core must stay pure: no I/O, HTTP, DB, UI or native modules.',
          })),
          patterns: [
            {
              group: ['@fastify/*', 'node:*', '@csv-validator/api', '@csv-validator/web'],
              message: 'packages/core must stay pure and may not depend on other packages.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'core must be deterministic: callers supply timestamps.' },
        { name: 'Intl', message: 'core must be deterministic: no locale-sensitive APIs.' },
        { name: 'process', message: 'core must not read the environment.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'core must be deterministic: no randomness.',
        },
        {
          property: 'toLocaleString',
          message: 'core must be deterministic: no locale-sensitive APIs.',
        },
        {
          property: 'localeCompare',
          message: 'core must be deterministic: no locale-sensitive APIs.',
        },
      ],
    },
  },
  {
    // api may use core, but never web.
    files: ['packages/api/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ group: ['@csv-validator/web'], message: 'api must not depend on web.' }],
        },
      ],
    },
  },
  {
    // web may only use type-only imports from core, and never touches api.
    files: ['packages/web/src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@csv-validator/core', '@csv-validator/core/*'],
              allowTypeImports: true,
              message: 'web may only use `import type` from core (no runtime imports).',
            },
            {
              group: ['@csv-validator/api', '@csv-validator/api/*'],
              message: 'web must not depend on api.',
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
);
