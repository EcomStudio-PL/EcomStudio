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
check("the default call length is the slowest adapter we have",
  PROVIDER_CALL_BUDGET_MS >= 180_000,
  `${PROVIDER_CALL_BUDGET_MS}ms is below the 180s OpenAI image timeout`);

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
check("the attempt loop refuses to start a call that cannot finish",
  /for \(let attempt[\s\S]{0,400}?if \(!fitsInBudget\(Date\.now\(\), deadlineAt\)\)/.test(gen),
  "the check must be the first thing inside the attempt loop");
check("the backoff does not sleep past the deadline",
  /if \(!fitsInBudget\(Date\.now\(\) \+ delay, deadlineAt\)\)/.test(gen));
check("running out of time leaves the loop through the existing refund path",
  /outOfTime = true/.test(gen) && /if \(outOfTime\) break;/.test(gen),
  "both the attempt loop and the candidate loop must give up");

console.log(failures === 0 ? "\nAll generation budget tests passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
