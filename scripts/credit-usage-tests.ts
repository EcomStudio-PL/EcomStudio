/**
 * THE CREDIT METER — the arithmetic the mobile menu colours a bar with.
 *
 * The bar is the one place a seller learns they are about to run out, so the
 * ways it can lie are what this file is about:
 *
 *   · THE BANDS, at their edges. 49/50, 74/75 and 89/90 are where the colour
 *     changes, and an off-by-one there paints "half your package is gone" in
 *     the same green as "you have just started".
 *   · THE FOUR TIERS, on their REAL allowances. Free grants 25, Starter 300,
 *     Pro 1200, Agency 5000 — the numbers in `subscription_plans` — so the
 *     same balance lands in a different band on a different plan, which is the
 *     whole reason the plan row is fetched at all.
 *   · NO NEGATIVES, NO OVER-HUNDRED. A workspace that bought a credit pack
 *     holds more than its monthly grant; an empty wallet holds none. Neither
 *     may produce "-300 of 25" or "115 %".
 *   · NO LIMIT, NO GUESS. A plan with no monthly grant, a missing plan row and
 *     a broken number all land on the neutral band with a null percentage —
 *     never on an invented denominator.
 *   · EVERY BAND HAS A COLOUR, and no two bands share one. A band added later
 *     without a class would render an unstyled bar on a dark panel.
 *
 * Run:  npm run test:credits
 */
import {
  creditUsage, usageBand, USAGE_BAR, USAGE_TEXT, type UsageBand,
} from "@/lib/credit-usage";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : `\n     ${detail}`}`);
}

/* ── the four bands, at the percentages the brief names ──────────────────── */

console.log("A. THE BANDS");

const BANDS: [number, UsageBand, string][] = [
  [0, "ok", "nothing used"],
  [10, "ok", "10 % — green"],
  [49, "ok", "49 % — still green"],
  [50, "caution", "50 % — yellow starts exactly here"],
  [60, "caution", "60 % — yellow"],
  [74, "caution", "74 % — still yellow"],
  [75, "warn", "75 % — orange starts exactly here"],
  [80, "warn", "80 % — orange"],
  [89, "warn", "89 % — still orange"],
  [90, "critical", "90 % — red starts exactly here"],
  [95, "critical", "95 % — red"],
  [100, "critical", "100 % — red"],
];
for (const [pct, band, label] of BANDS) {
  check(`${label} → ${band}`, usageBand(pct) === band, `got ${usageBand(pct)}`);
}

/* ── the same bands, reached through a real wallet and a real plan ───────── */

console.log("\nB. THE SAME BANDS, FROM A BALANCE AND A PLAN");

/** The allowances the DEV and production plan rows actually carry. */
const PLAN = { free: 25, starter: 300, pro: 1200, agency: 5000 };

// balance, allowance, expected percent used, expected band
const WALLETS: [number, number, number, UsageBand, string][] = [
  [PLAN.pro * 0.9, PLAN.pro, 10, "ok", "Pro with 1080 of 1200 left → 10 % used, green"],
  [PLAN.pro * 0.4, PLAN.pro, 60, "caution", "Pro with 480 left → 60 % used, yellow"],
  [PLAN.pro * 0.2, PLAN.pro, 80, "warn", "Pro with 240 left → 80 % used, orange"],
  [PLAN.pro * 0.05, PLAN.pro, 95, "critical", "Pro with 60 left → 95 % used, red"],
  [25, PLAN.free, 0, "ok", "a fresh Free account has used none of its 25"],
  [13, PLAN.free, 48, "ok", "Free with 13 left is still green"],
  [12, PLAN.free, 52, "caution", "…and 12 left tips it into yellow"],
  [0, PLAN.free, 100, "critical", "an empty Free wallet is red"],
  [0, PLAN.agency, 100, "critical", "so is an empty Agency wallet"],
  [4500, PLAN.agency, 10, "ok", "Agency with 4500 of 5000 → 10 %, green"],
  [150, PLAN.starter, 50, "caution", "Starter at exactly half"],
  // The same balance, three plans, three different answers. This is what the
  // meter would get wrong if it measured against a constant.
  [300, PLAN.starter, 0, "ok", "300 credits on Starter: the whole package"],
  [300, PLAN.pro, 75, "warn", "the same 300 on Pro: three quarters gone"],
  [300, PLAN.agency, 94, "critical", "the same 300 on Agency: nearly out"],
];
for (const [balance, allowance, pct, band, label] of WALLETS) {
  const u = creditUsage(balance, allowance);
  check(label, u.percent === pct && u.band === band,
    `got ${u.percent}% / ${u.band} (used ${u.used} of ${u.total})`);
}

/* ── the clamps ──────────────────────────────────────────────────────────── */

console.log("\nC. NO NEGATIVES, NO OVER-HUNDRED");

{
  // A Free account that bought a 500-credit pack holds twenty times its grant.
  const u = creditUsage(525, PLAN.free);
  check("a topped-up wallet reads as 0 % used, not as a negative",
    u.used === 0 && u.percent === 0 && u.band === "ok", JSON.stringify(u));
  check("…and its remaining balance is reported in full",
    u.remaining === 525, `remaining ${u.remaining}`);
}
{
  const u = creditUsage(-40, PLAN.pro);
  check("a negative balance cannot push usage past 100 %",
    u.percent === 100 && u.used === PLAN.pro && u.remaining === 0, JSON.stringify(u));
}
{
  const u = creditUsage(1, 3);
  check("a fractional share is rounded, never left as 66.66…",
    Number.isInteger(u.percent ?? 0) && u.percent === 67, `percent ${u.percent}`);
}

/* ── nothing to measure against ──────────────────────────────────────────── */

console.log("\nD. NO LIMIT, NO GUESS");

for (const [allowance, label] of [
  [0, "a plan that grants nothing monthly"],
  [null, "a plan row that could not be read"],
  [undefined, "a plan with no allowance field at all"],
  [-5, "a nonsense negative allowance"],
  [Number.NaN, "a broken number"],
] as [number | null | undefined, string][]) {
  const u = creditUsage(120, allowance);
  check(`${label} → neutral, with no percentage`,
    u.percent === null && u.total === null && u.band === "unknown",
    JSON.stringify(u));
  check("…and the balance is still reported", u.remaining === 120, `remaining ${u.remaining}`);
}

/* ── every band is paintable, and distinct ───────────────────────────────── */

console.log("\nE. EVERY BAND HAS ITS OWN COLOUR");

const ALL: UsageBand[] = ["ok", "caution", "warn", "critical", "unknown"];
for (const band of ALL) {
  check(`${band} has a bar class`, Boolean(USAGE_BAR[band]?.includes("bg-")), USAGE_BAR[band]);
  check(`${band} has a text class`, Boolean(USAGE_TEXT[band]?.includes("text-")), USAGE_TEXT[band]);
}
check("no two bands share a bar colour",
  new Set(ALL.map((b) => USAGE_BAR[b])).size === ALL.length);
check("the meter's glow is its own colour, never the brand's, except when neutral",
  ALL.filter((b) => USAGE_BAR[b].includes("--accent")).length === 1,
  ALL.map((b) => `${b}: ${USAGE_BAR[b]}`).join("\n     "));

console.log(failed === 0 ? "\nAll credit-meter tests passed." : `\n${failed} credit-meter test(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
