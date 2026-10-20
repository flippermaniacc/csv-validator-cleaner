import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CleanedFileStore } from '../src/storage/cleaned-files.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'csvv-store-'));
  dirs.push(dataDir);
  return { dataDir, store: new CleanedFileStore(dataDir), cleaned: join(dataDir, 'cleaned') };
}

describe('CleanedFileStore.write (FR-DB3, FR-DB6)', () => {
  it('writes <dataDir>/cleaned/<id>.csv, returns the relative path and size, and leaves no temp file', async () => {
    const { store, dataDir, cleaned } = setup();
    const bytes = Buffer.from('a,b\n1,2\n', 'utf8');
    const written = await store.write('run-1', bytes);

    expect(written).toEqual({ relativePath: 'cleaned/run-1.csv', sizeBytes: bytes.length });
    expect(readFileSync(join(dataDir, written.relativePath))).toEqual(bytes);
    expect(readdirSync(cleaned)).toEqual(['run-1.csv']);
  });

  it('creates the cleaned directory on demand and handles empty content', async () => {
    const { store, dataDir } = setup();
    await store.write('empty', new Uint8Array());
    expect(readFileSync(join(dataDir, 'cleaned', 'empty.csv'))).toHaveLength(0);
  });

  it('writes binary content unchanged', async () => {
    const { store, dataDir } = setup();
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    await store.write('bin', bytes);
    expect(new Uint8Array(readFileSync(join(dataDir, 'cleaned', 'bin.csv')))).toEqual(bytes);
  });
});

describe('CleanedFileStore.remove and resolve', () => {
  it('removes a stored file and tolerates a missing one', async () => {
    const { store, dataDir } = setup();
    const { relativePath } = await store.write('r', Buffer.from('x'));
    await store.remove(relativePath);
    expect(existsSync(join(dataDir, relativePath))).toBe(false);
    await expect(store.remove(relativePath)).resolves.toBeUndefined();
  });

  it.each([
    '../secret.csv',
    'cleaned/../../secret.csv',
    '/etc/passwd',
    'cleaned/../app.db',
    'cleaned',
  ])('refuses to resolve %j', (path) => {
    expect(() => setup().store.resolve(path)).toThrow(/escapes/);
  });

  it('resolves a normal stored path inside the cleaned directory', () => {
    const { store, cleaned } = setup();
    expect(store.resolve('cleaned/abc.csv')).toBe(join(cleaned, 'abc.csv'));
  });
});

describe('CleanedFileStore.sweep (AC-36)', () => {
  it('deletes temp files and files without a run, keeps known ones', async () => {
    const { store, cleaned } = setup();
    mkdirSync(cleaned);
    for (const name of ['keep.csv', 'orphan.csv', 'half.csv.tmp', 'other.tmp']) {
      writeFileSync(join(cleaned, name), 'x');
    }
    const removed = await store.sweep((id) => id === 'keep');
    expect(removed.sort()).toEqual(['half.csv.tmp', 'orphan.csv', 'other.tmp']);
    expect(readdirSync(cleaned)).toEqual(['keep.csv']);
  });

  it('returns nothing when the directory does not exist yet', async () => {
    expect(await setup().store.sweep(() => false)).toEqual([]);
  });
});
