import { mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';

const CLEANED_DIR = 'cleaned';

/** Cleaned CSVs live at `<dataDir>/cleaned/<runId>.csv`; the database stores only the relative path (FR-DB6). */
export class CleanedFileStore {
  private readonly dir: string;

  constructor(private readonly dataDir: string) {
    this.dir = join(dataDir, CLEANED_DIR);
  }

  /** Writes to a temp name, fsyncs, then renames, so a crash never leaves a half-written file (FR-DB3). */
  async write(
    runId: string,
    bytes: Uint8Array,
  ): Promise<{ relativePath: string; sizeBytes: number }> {
    await mkdir(this.dir, { recursive: true });
    const relativePath = `${CLEANED_DIR}/${runId}.csv`;
    const temp = join(this.dir, `${runId}.csv.tmp`);

    const handle = await open(temp, 'w');
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, join(this.dataDir, relativePath));
    return { relativePath, sizeBytes: bytes.byteLength };
  }

  /** Resolves a stored relative path, refusing anything outside the cleaned directory. */
  resolve(relativePath: string): string {
    const absolute = resolve(this.dataDir, relativePath);
    if (!absolute.startsWith(this.dir + sep)) throw new Error('Path escapes the cleaned directory');
    return absolute;
  }

  async remove(relativePath: string): Promise<void> {
    await rm(this.resolve(relativePath), { force: true });
  }

  /** Startup sweep: drops leftover temp files and files whose run was never committed (FR-DB3). */
  async sweep(hasRun: (runId: string) => boolean): Promise<string[]> {
    const entries = await readdir(this.dir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [] as string[];
      throw error;
    });
    const removed: string[] = [];
    for (const name of entries) {
      const orphan = name.endsWith('.tmp') || !hasRun(basename(name, '.csv'));
      if (!orphan) continue;
      await rm(join(this.dir, name), { force: true });
      removed.push(name);
    }
    return removed;
  }
}
