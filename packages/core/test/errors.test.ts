import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ERROR_LEVEL } from '../src/index.js';

/** Reads the code catalog (SRS section 4.3) so the code cannot drift from the spec. */
function catalogFromSrs(): Map<string, string> {
  const srs = readFileSync(
    fileURLToPath(new URL('../../../docs/01-srs.md', import.meta.url)),
    'utf8',
  );
  const section = srs.slice(srs.indexOf('### 4.3 Error code catalog'));
  const codes = new Map<string, string>();
  for (const match of section.matchAll(/^\| `([A-Z_]+)` \| (file|row) \|/gm)) {
    codes.set(match[1] as string, match[2] as string);
  }
  return codes;
}

describe('error code catalog', () => {
  it('matches SRS section 4.3 exactly (codes and levels)', () => {
    const fromSrs = catalogFromSrs();
    expect(fromSrs.size).toBe(14);
    expect([...ERROR_CODES].sort()).toEqual([...fromSrs.keys()].sort());
    for (const [code, level] of fromSrs) {
      expect(ERROR_LEVEL[code as keyof typeof ERROR_LEVEL]).toBe(level);
    }
  });

  it('has no duplicate codes', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});
