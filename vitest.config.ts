import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'core', root: 'packages/core', include: ['test/**/*.test.ts'] } },
      { test: { name: 'api', root: 'packages/api', include: ['test/**/*.test.ts'] } },
      { test: { name: 'web', root: 'packages/web', include: ['test/**/*.test.ts'] } },
    ],
  },
});
