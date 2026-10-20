/** Dependency boundaries between workspace packages (design section 1.1). */
module.exports = {
  forbidden: [
    {
      name: 'core-is-a-leaf',
      comment: 'packages/core must not depend on api or web.',
      severity: 'error',
      from: { path: '^packages/core/src' },
      to: { path: '^(packages/|node_modules/@csv-validator/|@csv-validator/)(api|web)' },
    },
    {
      name: 'core-allowed-externals',
      comment: 'packages/core may only use zod and csv-parse (pure JS) and no Node built-ins.',
      severity: 'error',
      from: { path: '^packages/core/src' },
      to: {
        dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-unknown', 'core'],
        pathNot: ['node_modules/(zod|csv-parse)/'],
      },
    },
    {
      name: 'web-not-api',
      comment: 'packages/web must not depend on api.',
      severity: 'error',
      from: { path: '^packages/web/src' },
      to: { path: '^(packages/|node_modules/@csv-validator/|@csv-validator/)api' },
    },
    {
      name: 'api-not-web',
      comment: 'packages/api must not depend on web.',
      severity: 'error',
      from: { path: '^packages/api/src' },
      to: { path: '^(packages/|node_modules/@csv-validator/|@csv-validator/)web' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.base.json' },
    tsPreCompilationDeps: true,
    exclude: { path: ['/dist/', '/test/'] },
  },
};
