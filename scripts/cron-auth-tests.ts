/**
 * THE SCHEDULER'S CREDENTIAL — correct token runs, wrong token 401, no token 401.
 *
 * WHY THIS EXISTS (NEW-BG-02). `vercel.json` schedules /api/cron/mail daily.
 * The platform scheduler arrives with `Authorization: Bearer <CRON_SECRET>`
 * and NO SESSION, so without that variable the route answers 401 before any
 * job runs and the mailbox, the weekly ranking, the block sweep and the
 * reconciler belt all go silent together. Setting the variable is an operator
 * action; proving the rule around it is this file's job.
 *
 * NO SECRET IS USED, PRINTED OR NEEDED HERE. The rule is a pure function of
 * (header, configured secret), so it is exercised with throwaway values that
 * exist only inside this process. Nothing read from the environment, nothing
 * logged, nothing that could end up in a transcript or a report.
 *
 * WHAT IT PINS
 *   A. the parser — what counts as a bearer token and what does not
 *   B. the comparison — constant-time, and never satisfied by an empty value
 *   C. the verdict — the three-way answer both routes now share
 *   D. the call sites — that both routes actually consult it, and that the
 *      route turns a refusal into a 401 rather than running the work
 *
 * Run: npm run test:cronauth
 */
import { readFileSync } from "fs";
import { join } from "path";
import { bearerToken, secretMatches, cronTokenVerdict } from "../lib/server/cron-auth";

const ROOT = process.cwd();
let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

/* Throwaway values, generated per run and never leaving this process. */
const SECRET = `test-secret-${Math.random().toString(36).slice(2)}-${"x".repeat(24)}`;
const WRONG = `wrong-secret-${Math.random().toString(36).slice(2)}`;

console.log("A. WHAT COUNTS AS A BEARER TOKEN");
check("a normal header yields the token", bearerToken(`Bearer ${SECRET}`) === SECRET);
check("the scheme is case-insensitive", bearerToken(`bearer ${SECRET}`) === SECRET);
check("extra whitespace is tolerated", bearerToken(`  Bearer   ${SECRET}  `) === SECRET);
check("a bare value is NOT a bearer token", bearerToken(SECRET) === "");
check("a scheme with no token yields nothing", bearerToken("Bearer ") === "");
check("no header at all yields nothing", bearerToken(null) === "");
check("another scheme is not accepted", bearerToken(`Basic ${SECRET}`) === "");

console.log("\nB. THE COMPARISON");
check("the right secret matches", secretMatches(SECRET, SECRET));
check("a wrong secret does not", !secretMatches(WRONG, SECRET));
// The length case is the one the two old copies disagreed about. It must
// answer false WITHOUT throwing — timingSafeEqual throws on unequal lengths,
// which is why both sides are hashed to 32 bytes first.
check("a wrong-LENGTH secret does not match, and does not throw",
  !secretMatches("short", SECRET));
check("a longer wrong secret is the same", !secretMatches(SECRET + "tail", SECRET));
// An empty side must never satisfy the comparison, or a deployment with no
// credential would accept a caller who presented nothing.
check("empty presented never matches", !secretMatches("", SECRET));
check("empty expected never matches", !secretMatches(SECRET, ""));
check("empty against empty never matches", !secretMatches("", ""));

/*
  AND THE SHAPE OF THE COMPARISON, not just its answers.

  A unit test cannot observe timing: the weak implementation this module
  replaced — compare raw bytes, return early when the lengths differ — returns
  false for every case above, exactly like the strong one. Asserting only the
  answers would let that regression back in silently, which is the same class
  of hole as a gate nothing calls. So the property is pinned structurally.
*/
const shared = readFileSync(join(ROOT, "lib/server/cron-auth.ts"), "utf8");
check("both sides are hashed before they are compared",
  /createHash\("sha256"\)[\s\S]{0,240}?timingSafeEqual|timingSafeEqual\([\s\S]{0,240}?createHash\("sha256"\)/
    .test(shared),
  "hashing is what makes both buffers 32 bytes, so the compare is constant-time");
check("and nothing short-circuits on a length difference",
  !/\.length\s*!==\s*\w+\.length/.test(shared),
  "answering faster for a wrong-length guess is itself a measurement");

console.log("\nC. THE VERDICT THE SCHEDULER GETS");
check("CORRECT token => the job may run",
  cronTokenVerdict(`Bearer ${SECRET}`, SECRET) === "cron");
check("WRONG token => refused", cronTokenVerdict(`Bearer ${WRONG}`, SECRET) === "no_match");
check("MISSING token => refused", cronTokenVerdict(null, SECRET) === "no_match");
check("token present but malformed => refused",
  cronTokenVerdict(SECRET, SECRET) === "no_match");
// The distinct third answer exists so an operator can tell "you got it wrong"
// from "this deployment cannot authenticate a scheduler at all" — which is
// exactly the state NEW-BG-02 describes.
check("no secret CONFIGURED => a distinct answer, not a pass",
  cronTokenVerdict(`Bearer ${SECRET}`, undefined) === "secret_missing");
check("an empty configured secret is the same as none",
  cronTokenVerdict(`Bearer ${SECRET}`, "   ") === "secret_missing");
check("and a correct-looking header cannot rescue it",
  cronTokenVerdict(`Bearer ${SECRET}`, null) !== "cron");

console.log("\nD. BOTH ROUTES CONSULT IT, AND A REFUSAL IS A 401");
const mail = readFileSync(join(ROOT, "app/actions/mail.ts"), "utf8");
const worker = readFileSync(join(ROOT, "app/api/newsletter/worker/route.ts"), "utf8");
const route = readFileSync(join(ROOT, "app/api/cron/mail/route.ts"), "utf8");

check("the mailbox poll uses the shared rule", /cronTokenVerdict\(/.test(mail));
check("the newsletter worker uses the shared comparison",
  /secretMatches\(/.test(worker) && /bearerToken\(/.test(worker));
// Two copies of a security rule is how the two stop agreeing; they already had.
check("neither route keeps a private copy of the comparison",
  !/timingSafeEqual/.test(mail) && !/timingSafeEqual/.test(worker),
  "a second implementation is how these drifted apart in the first place");

check("a missing secret counts as unauthorised",
  /cron_secret_missing: "cron_secret_missing"/.test(route));
check("and the unauthorised branch answers 401",
  /UNAUTHORIZED\[result\.error\][\s\S]{0,160}?status: 401/.test(route),
  "the scheduler must be refused, not quietly allowed to do half the work");
check("an unverifiable caller is 503, not a pass",
  /caller_unverified[\s\S]{0,200}?status: 503/.test(route));
// The jobs must sit BELOW the authorisation, or a refused caller still works.
const authAt = route.indexOf("status: 401");
const firstJob = route.indexOf("refreshPopularityIfDue()");
check("no job is reachable above the authorisation check",
  authAt !== -1 && firstJob !== -1 && authAt < firstJob,
  "order is what makes the refusal mean anything");

console.log(failures === 0 ? "\nAll cron auth tests passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
