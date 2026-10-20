import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const coreSource = fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url));

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**/*.ts'],
      exclude: ['packages/core/src/index.ts'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 85 },
    },
    projects: [
      { test: { name: 'core', root: 'packages/core', include: ['test/**/*.test.ts'] } },
      {
        resolve: { alias: { '@csv-validator/core': coreSource } },
        test: {
          name: 'api',
          root: 'packages/api',
          include: ['test/**/*.test.ts'],
          setupFiles: ['./test/setup.ts'],
        },
      },
      {
        test: {
          name: 'web',
          root: 'packages/web',
          environment: 'jsdom',
          include: ['test/**/*.test.{ts,tsx}'],
          setupFiles: ['./test/setup.ts'],
        },
      },
    ],
  },
});
