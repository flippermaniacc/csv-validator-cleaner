# CSV Validator & Cleaner

Schema-driven validation and deterministic cleaning of CSV files.

Design documents live in [`docs/`](docs/): problem definition, SRS, system design, and the
implementation roadmap (design section 12).

## Requirements

- Node.js >= 22.13.0 (see `.nvmrc`)
- npm >= 10

## Workspace layout

| Package         | Purpose                                         |
| --------------- | ----------------------------------------------- |
| `packages/core` | Pure TypeScript library: parse, validate, clean |
| `packages/api`  | Fastify backend: uploads, persistence           |
| `packages/web`  | React + Vite single-page app                    |

Dependencies point inward to `core`; the boundary rules are enforced by `npm run lint`.

## Scripts

| Command                | What it does                                    |
| ---------------------- | ----------------------------------------------- |
| `npm run typecheck`    | Type-check every package (strict TypeScript)    |
| `npm run lint`         | ESLint and dependency-cruiser boundary checks   |
| `npm run format`       | Format everything with Prettier                 |
| `npm run format:check` | Verify formatting without writing               |
| `npm test`             | Run all Vitest projects                         |
| `npm run build`        | Build all packages with TypeScript project refs |
