/** First occurrence of a normalized value claims it; later rows are duplicates (FR-U3, FR-U4). */
export class UniqueTracker {
  private readonly firstRow = new Map<string, number>();

  /** Returns the row that already holds `key`, or null after claiming it for `row`. */
  claim(key: string, row: number): number | null {
    const existing = this.firstRow.get(key);
    if (existing !== undefined) return existing;
    this.firstRow.set(key, row);
    return null;
  }
}
