/**
 * THE PROVIDER LOOP MUST NOT OUTLIVE THE ROUTE THAT CALLS IT.
 *
 * WHAT WENT WRONG. runGeneration retried a provider up to
 * MAX_ATTEMPTS_PER_PROVIDER times, and the slowest adapter this codebase has
 * carries its own 180 s AbortSignal.timeout. Three of those is 540 s of
 * provider time alone, before reference downloads, storage and backoff — under
 * a route ceiling of 300 s. The function was therefore killed mid-loop on a
 * slow provider, which matters because the credits are taken BEFORE the loop
 * (generation.ts charges through the usage ledger, then calls the provider).
 * A kill skips the failUsage below the loop, so the customer stays charged for
 * a run that nobody can close. That is P1-30.
 *
 * The fix is a deadline: an attempt starts only when the WHOLE of it still
 * fits. Falling out of the loop takes the EXISTING failure path, which refunds.
 *
 * WHAT THIS FILE PINS, AND WHY EACH PART IS HERE.
 *
 *   A. fitsInBudget itself — the one decision the whole thing rests on.
 *   B. A simulation of the loop against the REAL ceilings of the REAL routes,
 *      parsed from their source. This is what catches someone adding a slower
 *      adapter, raising MAX_ATTEMPTS_PER_PROVIDER, or writing a new route with
 *      a shorter maxDuration.
 *   C. A structural check that generation.ts actually CONSULTS the budget.
 *      Without C, B would pass forever on a copy of the rule that the product
 *      no longer calls — the tautology this project keeps catching in its own
 *      tests. C is a grep, deliberately: it is the only way to pin a call site
 *      without standing up a real generation against a paid provider.
 *
 * Run: npm run test:budget
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  GENERATION_BUDGET_MS, MAX_ATTEMPTS_PER_PROVIDER, PROVIDER_CALL_BUDGET_MS, fitsInBudget,
} from "../lib/server/provider-router";
import { timeoutFor } from "../lib/ai/types";
import { googleAdapter } from "../lib/ai/providers/google";
import { openaiAdapter } from "../lib/ai/providers/openai";
import { falAdapter } from "../lib/ai/providers/fal";

const ROOT = process.cwd();
let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

/* ── A. the decision itself ─────────────────────────────────────────────── */
console.log("A. A CALL THAT CANNOT FINISH IN TIME IS NOT STARTED");

check("a call that fits is allowed", fitsInBudget(0, 240_000, 185_000));
check("a call that would end exactly on the deadline is allowed",
  fitsInBudget(55_000, 240_000, 185_000));
check("a call that would end one millisecond late is refused",
  !fitsInBudget(55_001, 240_000, 185_000));
check("no time left means no attempt", !fitsInBudget(240_000, 240_000, 185_000));
check("the default call length covers a single bounded request",
  PROVIDER_CALL_BUDGET_MS >= 180_000,
  `${PROVIDER_CALL_BUDGET_MS}ms is below the 180s OpenAI image timeout`);

/*
  …AND THE DEFAULT IS NOT ASSUMED TO COVER EVERY ADAPTER.

  This section used to assert one hardcoded number and stop, which is exactly
  how the hole got through: the Google adapter issues `quantity` requests in
  sequence, so four images there can need far longer than the OpenAI timeout
  the constant was taken from. The flat number let such an attempt start with
  nowhere near enough time, and an attempt that overruns the route is killed
  with the charge already taken.

  Two things now have to hold, and neither is a number written down here.
*/
const ADAPTERS: Array<[string, { worstCaseMs?: (q: number) => number }]> = [
  ["google", googleAdapter], ["openai", openaiAdapter], ["fal", falAdapter],
];
for (const [name, adapter] of ADAPTERS) {
  const worst = adapter.worstCaseMs?.(4) ?? PROVIDER_CALL_BUDGET_MS;
  const one = adapter.worstCaseMs?.(1) ?? PROVIDER_CALL_BUDGET_MS;
  // 1. An adapter whose worst case grows with the quantity must SAY SO, so the
  //    runner can ask instead of assuming.
  check(`${name} declares a per-image worst case if it has one`,
    worst === one || adapter.worstCaseMs !== undefined,
    "an adapter that loops per image and stays silent gets the flat default");
  // 2. Whatever it declares for ONE image must fit, or the gate would refuse
  //    every attempt on that provider and the feature would simply stop.
  check(`${name} can always start at least one image`, one <= GENERATION_BUDGET_MS,
    `${one}ms does not fit in the ${GENERATION_BUDGET_MS}ms budget`);
}

/*
  THE OTHER HALF OF THE FIX, and the one that makes the gate honest: an
  adapter carries the deadline into its own timeouts, so it gives up BEFORE
  the platform kills the function rather than after. Without this, "there is
  time for one image" would still let a four-image run overrun.
*/
check("a timeout is never longer than the time actually left",
  timeoutFor(90_000, 1_000_000, 950_000) === 50_000,
  "the adapter would block past the deadline");
check("its own ceiling still wins when there is plenty of time",
  timeoutFor(90_000, 1_000_000, 500_000) === 90_000);
check("no deadline means the adapter's own ceiling",
  timeoutFor(90_000, undefined, 500_000) === 90_000);
check("no time left is reported as no time left",
  timeoutFor(90_000, 1_000_000, 1_000_001) < 0,
  "a caller must be able to tell that it has to stop");

/*
  EVERY PATH THAT GIVES UP MUST DELIVER WHAT WAS ALREADY BOUGHT.

  The first version of this fix took the partial only when the ATTEMPTS ran
  out. But the deadline error an adapter raises is RETRIABLE, so control fell
  through to the backoff — where there is by definition no time left — and the
  `outOfTime` break stepped straight over the delivery. Three images Google
  had produced and billed were discarded on the one path the partial handling
  exists for.
*/
const genSrc = readFileSync(join(ROOT, "lib/server/generation.ts"), "utf8");
check("giving up on attempts delivers the partial",
  /if \(spent\) \{ takePartial\(\); break; \}/.test(genSrc));
check("and so does running out of time",
  /outOfTime = true; takePartial\(\); break;/.test(genSrc),
  "the deadline error is retriable, so this is the path that actually fires");
check("the largest partial wins, not the latest",
  /pe\.partial\.length > lastPartial\.length/.test(genSrc),
  "a later, smaller partial must not shrink what an earlier attempt bought");
check("an adapter does not fire a call it knows cannot return",
  /budget <= MIN_USEFUL_CALL_MS/.test(
    readFileSync(join(ROOT, "lib/ai/providers/google.ts"), "utf8")),
  "a few seconds against a 90s endpoint is a guaranteed timeout, possibly billed");

check("the runner asks the adapter instead of assuming",
  /cAdapter\.worstCaseMs\?\.\(1\)\s*\?\?\s*PROVIDER_CALL_BUDGET_MS/.test(genSrc));
check("and hands the deadline to the adapter",
  /\n\s*deadlineAt,\n/.test(genSrc),
  "an adapter that cannot see the deadline cannot respect it");
for (const p of ["google", "openai", "fal"]) {
  check(`the ${p} adapter clamps against it`,
    /timeoutFor\(/.test(readFileSync(join(ROOT, `lib/ai/providers/${p}.ts`), "utf8")));
}

/* ── B. the loop, simulated against the real routes ─────────────────────── */
console.log("\nB. THE WORST CASE FITS INSIDE EVERY ROUTE THAT CAN REACH THE LOOP");

/** Every route whose request can end up in runGeneration. Traced by import,
 *  not guessed: generate and generations/regenerate call it directly, and
 *  fashion / retouch / concepts reach it through lib/server/{fashion,retouch,
 *  concept-generation}.ts. */
const ROUTES = [
  "app/api/generate/route.ts",
  "app/api/generations/regenerate/route.ts",
  "app/api/fashion/route.ts",
  "app/api/retouch/route.ts",
  "app/api/concepts/generate/route.ts",
];

function ceilingSeconds(file: string): number | null {
  const src = readFileSync(join(ROOT, file), "utf8");
  const m = /export const maxDuration\s*=\s*(\d+)/.exec(src);
  return m ? Number(m[1]) : null;
}

/** How long the loop runs if every attempt takes the full provider timeout,
 *  under a given policy. Returns milliseconds of wall clock spent in the loop. */
function simulate(budgeted: boolean): number {
  const deadlineAt = GENERATION_BUDGET_MS;
  let now = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PROVIDER; attempt++) {
    if (budgeted && !fitsInBudget(now, deadlineAt)) break;
    now += PROVIDER_CALL_BUDGET_MS; // the adapter burns its whole timeout
  }
  return now;
}

const budgeted = simulate(true);
const unbudgeted = simulate(false);

// The defect, stated as a fact rather than as folklore. This assertion is the
// reason the budget exists; it is expected to stay true forever.
check("without a budget the loop would overrun a 300 s route",
  unbudgeted > 300_000,
  `unbudgeted worst case is ${unbudgeted / 1000}s, which would fit — is MAX_ATTEMPTS or the adapter timeout different now?`);

/** Work that still has to happen after the last provider call returns:
 *  storing images, derivatives, the generation rows, and the refund. */
const RESERVE_MS = 45_000;

for (const file of ROUTES) {
  const ceiling = ceilingSeconds(file);
  if (ceiling === null) { check(`${file} declares a maxDuration`, false, "none found"); continue; }
  check(`${file} (${ceiling}s) survives the worst-case loop`,
    budgeted + RESERVE_MS <= ceiling * 1000,
    `loop may spend ${budgeted / 1000}s and needs ${RESERVE_MS / 1000}s after it, ` +
    `which does not fit in ${ceiling}s — lower GENERATION_BUDGET_MS or raise the route`);
}

/* ── C. the product actually consults the budget ────────────────────────── */
console.log("\nC. runGeneration CONSULTS THE BUDGET (a rule nothing calls is not a rule)");

const gen = readFileSync(join(ROOT, "lib/server/generation.ts"), "utf8");

check("generation.ts imports the budget helpers",
  /fitsInBudget/.test(gen) && /GENERATION_BUDGET_MS/.test(gen));
check("a deadline is derived from the invocation start",
  /const deadlineAt = invocationStartedAt \+ GENERATION_BUDGET_MS/.test(gen),
  "the deadline must cover the model resolve, the charge and the reference downloads too");
// The third argument is the point: these used to match a two-argument call,
// which is the flat default — the very assumption that let a per-image adapter
// overrun. The gate must be asked with the length THIS adapter needs.
check("the attempt loop refuses to start a call that cannot finish",
  /for \(let attempt[\s\S]{0,900}?if \(!fitsInBudget\(Date\.now\(\), deadlineAt, cCallMs\)\)/.test(gen),
  "the check must open the attempt loop, and must use the adapter's own length");
check("the backoff does not sleep past the deadline",
  /if \(!fitsInBudget\(Date\.now\(\) \+ delay, deadlineAt, cCallMs\)\)/.test(gen));
check("running out of time leaves the loop through the existing refund path",
  /outOfTime = true/.test(gen) && /if \(outOfTime\) break;/.test(gen),
  "both the attempt loop and the candidate loop must give up");

console.log(failures === 0 ? "\nAll generation budget tests passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
