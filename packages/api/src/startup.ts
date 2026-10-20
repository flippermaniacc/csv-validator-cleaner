import { RunsRepo } from './db/runs.repo.js';
import type { Db } from './db/connection.js';
import { CleanedFileStore } from './storage/cleaned-files.js';

/** Removes temp files and cleaned files whose run never committed (FR-DB3); returns the removed names. */
export function sweepOrphanedFiles(db: Db, dataDir: string): Promise<string[]> {
  const runs = new RunsRepo(db);
  return new CleanedFileStore(dataDir).sweep((id) => runs.has(id));
}
