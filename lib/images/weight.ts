/**
 * WHAT A COMPRESSION ACTUALLY SAVED.
 *
 * The compression screen exists to answer one question — "how much smaller is
 * it now" — so the arithmetic behind that answer lives here, where it can be
 * tested, instead of inside a component where it cannot.
 *
 * Two rules run through all of it:
 *
 *   · The comparison is in BYTES. A percentage rounds, and a file that came
 *     back byte-identical must be able to say so rather than show a green 0%.
 *   · A file that grew says it grew. `sharp` can hand back something larger
 *     than the original — a PNG screenshot re-encoded as PNG, say — and a
 *     rounding that hides that is a lie in our own favour.
 */

export type WeighedItem = {
  /** `File.size` — the number the seller's own file manager shows. */
  before: number;
  /** What the server encoded and sent back, or null while it is still queued. */
  after: number | null;
};

/** The share of the file that went away, as a whole percent. Negative when a
 *  file grew, zero when there was nothing to divide. */
export function reduction(before: number, after: number): number {
  if (before <= 0) return 0;
  return Math.round(((before - after) / before) * 100);
}

/**
 * The batch, over FINISHED photos only. A queue of two hundred with three
 * done reports the three: adding the untouched weight of the other 197 to
 * both sides would drown the number the seller is watching.
 */
export function batchTotals(items: readonly WeighedItem[]) {
  const finished = items.filter((i) => i.after !== null);
  const before = finished.reduce((sum, i) => sum + i.before, 0);
  const after = finished.reduce((sum, i) => sum + (i.after ?? i.before), 0);
  return { count: finished.length, before, after, delta: before - after, percent: reduction(before, after) };
}

/** `formatBytes` speaks only in magnitudes, so the sign is carried outside it:
 *  a batch that grew must say so rather than print a negative byte count. */
export function signedBytes(delta: number, format: (bytes: number) => string): string {
  return delta < 0 ? `−${format(-delta)}` : format(delta);
}

export function signedPercent(percent: number): string {
  return percent < 0 ? `−${-percent}%` : `${percent}%`;
}
