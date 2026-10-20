import { describe, expect, it } from 'vitest';

/** Raw text of every web source file, bundled at test time by Vite. */
const sources = import.meta.glob<string>('../src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Every import or re-export statement with its specifier. */
function importsOf(source: string): { statement: string; specifier: string }[] {
  const found: { statement: string; specifier: string }[] = [];
  for (const match of source.matchAll(
    /\b(?:import|export)\b[^;'"]*?from\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/g,
  )) {
    found.push({ statement: match[0], specifier: match[1] ?? match[2] ?? '' });
  }
  return found;
}

describe('web package boundaries (AC-39, FR-30)', () => {
  const files = Object.entries(sources);

  it('finds the web sources', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('imports core only as types, so no core code ships in the bundle', () => {
    const offenders = files.flatMap(([file, text]) =>
      importsOf(text)
        .filter(({ specifier }) => specifier.startsWith('@csv-validator/core'))
        .filter(({ statement }) => !/^(import|export)\s+type\b/.test(statement))
        .map(({ statement }) => `${file}: ${statement}`),
    );
    expect(offenders).toEqual([]);
  });

  it('never imports api code or Node built-ins', () => {
    const offenders = files.flatMap(([file, text]) =>
      importsOf(text)
        .filter(({ specifier }) => /^@csv-validator\/api|^node:|^(fs|path|http)$/.test(specifier))
        .map(({ specifier }) => `${file}: ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });

  it('detects a runtime core import (guards the guard)', () => {
    const bad = importsOf("import { COLUMN_TYPES } from '@csv-validator/core';");
    const good = importsOf("import type { ColumnType } from '@csv-validator/core';");
    expect(bad[0]?.statement).not.toMatch(/^import\s+type\b/);
    expect(good[0]?.statement).toMatch(/^import\s+type\b/);
  });
});
