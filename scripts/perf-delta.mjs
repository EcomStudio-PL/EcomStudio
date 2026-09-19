/**
 * BEFORE vs AFTER, computed rather than eyeballed.
 *
 * `perf:baseline` writes a JSON row per route x viewport. This reads two of
 * those files and prints the delta for every metric that matters, so a report
 * cannot quietly compare a warm AFTER against a cold BEFORE, or a route that
 * redirected against one that did not.
 *
 * WHAT IT REFUSES TO COMPARE, and why that matters more than what it prints:
 *   - a row present in one file and not the other (the route set changed)
 *   - a row whose REDIRECT status differs between runs (an anonymous hit on a
 *     protected route measures the redirect; if that changed, the two numbers
 *     are describing different pages and the delta is meaningless)
 * Either of those is reported as a MISMATCH and excluded from the totals,
 * because a comparison that silently compares two different things is worse
 * than no comparison.
 *
 * Run: node scripts/perf-delta.mjs <before.json> <after.json>
 */
import { readFileSync } from "node:fs";

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error("usage: node scripts/perf-delta.mjs <before.json> <after.json>");
  process.exit(2);
}

const before = JSON.parse(readFileSync(beforePath, "utf8"));
const after = JSON.parse(readFileSync(afterPath, "utf8"));

const key = (r) => `${r.viewport}  ${r.route}`;
const bMap = new Map(before.rows.map((r) => [key(r), r]));
const aMap = new Map(after.rows.map((r) => [key(r), r]));

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

/** Metrics where LOWER is better, with how to render them. */
const METRICS = [
  ["jsWireBytes", "JS transferred", kb],
  ["jsDecodedBytes", "JS parsed", kb],
  ["wireBytes", "total transferred", kb],
  ["htmlChars", "document (decoded)", kb],
  ["requests", "requests", String],
  ["duplicateUrls", "duplicate URLs", String],
  ["lcpMs", "LCP", (n) => `${n} ms`],
  ["cls", "CLS", (n) => String(n)],
  ["blockingMs", "blocking (TBT proxy)", (n) => `${n} ms`],
  ["loadMs", "load", (n) => `${n} ms`],
];

const mismatches = [];
let compared = 0;

for (const k of new Set([...bMap.keys(), ...aMap.keys()])) {
  const b = bMap.get(k);
  const a = aMap.get(k);
  if (!b || !a) {
    mismatches.push(`${k} — present only in ${b ? "BEFORE" : "AFTER"}; not comparable`);
    continue;
  }
  if (b.redirected !== a.redirected) {
    mismatches.push(
      `${k} — redirect changed (${b.redirected ? "redirected" : "direct"} -> ${a.redirected ? "redirected" : "direct"}); ` +
        `the two runs measured different pages, so this row is excluded`,
    );
    continue;
  }
  compared += 1;

  console.log(`\n${"=".repeat(72)}`);
  console.log(`${k}${b.redirected ? `   (redirect -> ${b.finalUrl})` : ""}`);
  console.log("=".repeat(72));
  for (const [field, label, fmt] of METRICS) {
    const bv = b[field] ?? 0;
    const av = a[field] ?? 0;
    const d = av - bv;
    const pct = bv === 0 ? (av === 0 ? 0 : 100) : (d / bv) * 100;
    const arrow = d === 0 ? "  =" : d < 0 ? "  ↓" : "  ↑";
    console.log(
      `  ${label.padEnd(22)} ${String(fmt(bv)).padStart(11)} -> ${String(fmt(av)).padStart(11)}` +
        `${arrow} ${d === 0 ? "no change" : `${d > 0 ? "+" : ""}${fmt(d)} (${pct > 0 ? "+" : ""}${pct.toFixed(1)}%)`}`,
    );
  }
}

console.log(`\n${"-".repeat(72)}`);
console.log(`compared ${compared} row(s)`);
if (mismatches.length) {
  console.log(`\nNOT COMPARABLE (${mismatches.length}) — excluded from the above:`);
  for (const m of mismatches) console.log(`  ! ${m}`);
  console.log(
    `\nA mismatch is not a pass and not a failure: it means the two runs are not\n` +
      `describing the same thing. Fix the run, do not quote the number.`,
  );
}
