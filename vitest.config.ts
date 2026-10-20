import { defineConfig } from 'vitest/config';

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
      { test: { name: 'api', root: 'packages/api', include: ['test/**/*.test.ts'] } },
      { test: { name: 'web', root: 'packages/web', include: ['test/**/*.test.ts'] } },
    ],
  },
});
