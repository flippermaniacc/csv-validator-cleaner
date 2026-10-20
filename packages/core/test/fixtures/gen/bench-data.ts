/** Deterministic generators for the 10 MiB benchmark inputs (AC-40, AC-41); same seed, same bytes. */

export const BENCH_SCHEMA = {
  name: 'Bench',
  columns: [
    { name: 'id', type: 'integer', required: true, unique: true },
    { name: 'email', type: 'email', required: true },
    { name: 'amount', type: 'decimal', min: 0 },
    { name: 'issued', type: 'date', dateFormat: 'DD.MM.YYYY' },
    { name: 'currency', type: 'string', enum: ['USD', 'EUR', 'GBP'] },
    { name: 'code', type: 'string', pattern: '[A-Z]{3}' },
    { name: 'active', type: 'boolean' },
    { name: 'name', type: 'string' },
  ],
} as const;

export const TEN_MIB = 10 * 1024 * 1024;

/** Errors produced by every row of the all-error file: one per schema column except `name`. */
export const ERRORS_PER_ALL_ERROR_ROW = 7;

const HEADER = 'id,email,amount,issued,currency,code,active,name,memo1,memo2';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function build(
  rowAt: (index: number, random: () => number) => string,
  targetBytes: number,
  seed: number,
) {
  const random = mulberry32(seed);
  const lines = [HEADER];
  let bytes = HEADER.length + 1;
  for (let i = 0; ; i++) {
    const line = rowAt(i, random);
    const size = Buffer.byteLength(line) + 1;
    if (bytes + size > targetBytes) break;
    lines.push(line);
    bytes += size;
  }
  return { bytes: Buffer.from(`${lines.join('\n')}\n`), rows: lines.length - 1 };
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const letters = (random: () => number, n: number) =>
  Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(random() * 26))).join('');

/** A realistic file: mostly valid rows, about 2% with a single problem, quoted fields and pass-through columns. */
export function generateTypicalCsv(targetBytes = TEN_MIB, seed = 1) {
  return build(
    (i, random) => {
      const flaw = random() < 0.02 ? Math.floor(random() * 4) : -1;
      const id = flaw === 0 && i > 0 ? String(i) : String(i + 1);
      const email = flaw === 1 ? 'not-an-email' : `user${i}@example.com`;
      const amount = flaw === 2 ? '-5.00' : (random() * 1000).toFixed(2);
      const issued =
        flaw === 3
          ? '31.02.2024'
          : `${pad2(1 + Math.floor(random() * 28))}.${pad2(1 + Math.floor(random() * 12))}.20${pad2(15 + Math.floor(random() * 10))}`;
      const currency = ['USD', 'EUR', 'GBP'][Math.floor(random() * 3)];
      const name =
        random() < 0.1 ? `"Smith, ${letters(random, 5)}"` : ` Customer ${letters(random, 6)} `;
      return [
        id,
        email,
        amount,
        issued,
        currency,
        letters(random, 3),
        random() < 0.5 ? 'true' : 'false',
        name,
        `memo ${letters(random, 12)}`,
        `ref-${Math.floor(random() * 1e9)}`,
      ].join(',');
    },
    targetBytes,
    seed,
  );
}

/** Worst case: every row fails every rule except `name`, so the error count dwarfs the 1000 stored (AC-41). */
export function generateAllErrorCsv(targetBytes = TEN_MIB, seed = 2) {
  return build(
    (i, random) =>
      [
        'x',
        'bad',
        '-1',
        '31.02.2024',
        'XXX',
        'abc',
        'maybe',
        `Row ${i}`,
        `memo ${letters(random, 12)}`,
        `ref-${Math.floor(random() * 1e9)}`,
      ].join(','),
    targetBytes,
    seed,
  );
}
