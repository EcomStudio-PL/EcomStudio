/**
 * PAIRING FILES BY THEIR NAMES — "buty-przed.jpg" and "buty-po.jpg" are one
 * before/after pair.
 *
 * Pure, and shared: "Wgraj wiele" on /home fills the registry's fixed pair
 * slots with it (components/ice/editor/bulk-panel.tsx, which re-exports these
 * under their old names), and the launch page's galleries build new pairs
 * from it (lib/ice/gallery.ts). One rule for what a pair's name looks like,
 * so the two uploads can never disagree about which files belong together.
 * No DOM, no React — the unit tests import it as it is.
 */

export type PairSide = "before" | "after";
export type BulkFile = { id: string; name: string };
/** What fills one row: one file, or a pair's [before, after]. */
export type BulkUnit<F extends BulkFile> = { id: string; name: string; files: F[] };
export type BulkProblemReason = "noSuffix" | "missingBefore" | "missingAfter" | "duplicate";
export type BulkProblem<F extends BulkFile> = { file: F; reason: BulkProblemReason; base: string };

/** Natural, case-insensitive order: "2.jpg" before "10.jpg". */
export const naturalCompare = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/**
 * "buty-przed.jpg" → { base: "buty", side: "before" }. The suffix — -przed /
 * -po / -before / -after, any case — must sit right before the extension; the
 * greedy base takes the LAST one ("a-przed-po.jpg" is the after of
 * "a-przed"). Anything else is null.
 */
export function pairSuffix(name: string): { base: string; side: PairSide } | null {
  const stem = name.replace(/\.[^./\\]+$/, "");
  const m = /^(.+)-(przed|po|before|after)$/i.exec(stem);
  const base = m?.[1].trim();
  if (!m || !base) return null;
  const word = m[2].toLowerCase();
  return { base, side: word === "przed" || word === "before" ? "before" : "after" };
}

/**
 * Files → complete pairs, matched by base name regardless of case. A base
 * with a half missing, or with two files for the same half, is a problem —
 * never guessed at — and so is a file without a recognised suffix.
 */
export function groupPairs<F extends BulkFile>(files: readonly F[]): { pairs: BulkUnit<F>[]; problems: BulkProblem<F>[] } {
  const groups = new Map<string, { base: string; before: F[]; after: F[] }>();
  const problems: BulkProblem<F>[] = [];
  for (const f of files) {
    const p = pairSuffix(f.name);
    if (!p) {
      problems.push({ file: f, reason: "noSuffix", base: "" });
      continue;
    }
    const key = p.base.toLocaleLowerCase();
    const g = groups.get(key) ?? { base: p.base, before: [], after: [] };
    // The "before" file names the pair, so the label does not depend on
    // which half was dropped first.
    if (p.side === "before") g.base = p.base;
    g[p.side].push(f);
    groups.set(key, g);
  }
  const pairs: BulkUnit<F>[] = [];
  for (const [key, g] of groups) {
    if (g.before.length === 1 && g.after.length === 1) {
      pairs.push({ id: `pair:${key}`, name: g.base, files: [g.before[0], g.after[0]] });
      continue;
    }
    const reason: BulkProblemReason = g.before.length > 1 || g.after.length > 1 ? "duplicate"
      : g.before.length === 0 ? "missingBefore" : "missingAfter";
    for (const f of [...g.before, ...g.after]) problems.push({ file: f, reason, base: g.base });
  }
  pairs.sort((a, b) => naturalCompare(a.name, b.name) || naturalCompare(a.id, b.id));
  problems.sort((a, b) => naturalCompare(a.file.name, b.file.name) || naturalCompare(a.file.id, b.file.id));
  return { pairs, problems };
}
