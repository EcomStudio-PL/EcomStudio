/**
 * THE SECOND FACTOR HAS TO COVER REQUESTS, NOT JUST RENDERS.
 *
 * WHAT WENT WRONG (P1-23). The emailed-code gate was called from two layouts.
 * A layout runs when a page renders; /auth/sign-in writes full session cookies
 * the moment the password is correct and then redirects. Between those two
 * events there is a valid session that has passed one factor, and every route
 * handler is reachable in it — /api/generate and /api/tools/run spend the
 * customer's credits, /api/library/zip and /api/generations/sources hand back
 * their work. A stolen password was enough for all four.
 *
 * WHAT THIS PINS.
 *   A. the predicate: which paths the gate applies to, and which it must never
 *      touch, because gating a token-authenticated worker breaks it without
 *      protecting anyone.
 *   B. the cache: positive verdicts only. Caching a REFUSAL would mean a
 *      customer who has just typed their code is still refused, which is a
 *      lockout with a thirty-second fuse.
 *   C. the hash agreeing with the one the database matches on — a different
 *      digest here would refuse every device on every request.
 *   D. the call site, because a predicate nothing consults is not a gate.
 *
 * Run: npm run test:stepup
 */
import { readFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { cachedPass, rememberPass, resetPassCache, sha256Hex, stepUpAppliesTo } from "../lib/server/step-up-edge";

const ROOT = process.cwd();
let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function main() {
console.log("A. WHAT THE GATE COVERS");

/** The four the finding names, plus the rest of the authenticated API. */
for (const path of [
  "/api/generate", "/api/tools/run", "/api/library/zip", "/api/generations/sources",
  "/api/fashion", "/api/retouch", "/api/concepts/generate", "/api/prompts/generate",
  "/api/tools/save",
]) {
  check(`${path} is gated`, stepUpAppliesTo(path),
    "a session that passed only a password can reach this");
}

/** Paths that authenticate themselves and have no customer device to check. */
for (const path of [
  "/api/public/newsletter", "/api/newsletter/worker", "/api/cron/mail",
  "/api/hooks/send-email", "/api/waitlist",
]) {
  check(`${path} is NOT gated`, !stepUpAppliesTo(path),
    "this one carries its own secret and no session — gating it only breaks it");
}

/** Everything that is not an API route keeps using the layout gate. */
for (const path of ["/", "/home", "/library", "/admin", "/auth/security-check", "/regulamin"]) {
  check(`${path} is left to the layout gate`, !stepUpAppliesTo(path));
}

console.log("\nB. THE CACHE REMEMBERS A PASS, NEVER A REFUSAL");
resetPassCache();
const KEY = "user-1:device-1";
const T = 1_700_000_000_000;

check("an unknown key is not a pass", !cachedPass(KEY, T));
rememberPass(KEY, T);
check("a remembered pass is honoured", cachedPass(KEY, T + 1_000));
check("and it expires", !cachedPass(KEY, T + 31_000));
check("a second key is unaffected by the first", !cachedPass("user-2:device-1", T + 1_000));

// The important one: nothing in the module can ever store a negative verdict,
// because a customer who has just verified must be let in on the next request.
const source = readFileSync(join(ROOT, "lib/server/step-up-edge.ts"), "utf8");
check("there is no way to cache a refusal",
  !/rememberFail|rememberRefus|cacheFail/i.test(source),
  "a cached refusal is a lockout with a thirty-second fuse");

console.log("\nC. THE EDGE HASH IS THE HASH THE DATABASE MATCHES ON");
const sample = "a-device-cookie-value";
const node = createHash("sha256").update(sample).digest("hex");
check("WebCrypto and node:crypto agree", (await sha256Hex(sample)) === node,
  "a different digest here refuses every device on every request");

const loginSecurity = readFileSync(join(ROOT, "lib/server/login-security.ts"), "utf8");
const cookieName = /export const DEVICE_COOKIE = "([^"]+)"/.exec(loginSecurity)?.[1];
const middleware = readFileSync(join(ROOT, "lib/supabase/middleware.ts"), "utf8");
check("middleware reads the same cookie the app writes",
  Boolean(cookieName) && new RegExp(`const DEVICE_COOKIE = "${cookieName}"`).test(middleware),
  `login-security says ${cookieName}`);

console.log("\nD. THE GATE IS ACTUALLY CONSULTED");
check("middleware asks the predicate",
  /stepUpAppliesTo\(pathname\)/.test(middleware));
check("and only for a signed-in caller",
  /if \(user && stepUpAppliesTo\(pathname\)\)/.test(middleware),
  "an anonymous request has no device to challenge and is handled above");
check("a definite refusal is a 403, not a redirect",
  /step_up_required[\s\S]{0,80}403/.test(middleware),
  "an API caller cannot follow a redirect to a form");
check("an undecided verdict does not refuse",
  /stepUp\.undecided/.test(middleware),
  "a database blip must not turn into an outage; the layout gate still applies");
check("a pass is remembered", /rememberPass\(key\)/.test(middleware));

console.log(failures === 0 ? "\nAll step-up tests passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
}

main();
