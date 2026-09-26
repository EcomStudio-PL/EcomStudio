/**
 * EVERY API ROUTE BELONGS TO EXACTLY ONE CLASS, AND SAYS SO IN ITS OWN CODE.
 *
 * P1-28 proposed making the middleware cheaper by excluding /api from its
 * matcher. Before anything could be removed, the brief required a route matrix
 * proving what each endpoint relies on. Building it is what killed the idea —
 * see THE VERDICT at the bottom. This file is that matrix, kept executable so
 * it cannot drift from the code it describes.
 *
 * THE CLASSES
 *   PUBLIC        anonymous by design — a tracking pixel, an unsubscribe link,
 *                 a contact form. Listed explicitly, one line of reasoning each.
 *   SERVER-TOKEN  no session; a shared secret or a signed token proves the
 *                 caller. Scheduler entry points and provider webhooks.
 *   AUTHENTICATED a signed-in customer. The route checks it itself.
 *   ADMIN         authenticated AND profiles.role = 'admin', re-checked in the
 *                 route, because the admin LAYOUT guards pages and not routes.
 *
 * WHY THIS IS A TEST AND NOT A MARKDOWN TABLE. A table is accurate on the day
 * it is written. The real risk is the route added six months from now that
 * quietly ships with no check at all — so an unrecognised route is a FAILURE
 * here, and the only way to add one is to classify it. The allowlists below
 * are the matrix; adding to them is a deliberate act.
 *
 * Run: npm run test:routematrix
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { stepUpAppliesTo } from "../lib/server/step-up-edge";
import { isProtectedPath } from "../lib/supabase/middleware";

const ROOT = process.cwd();
let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

/** Anonymous on purpose. Each entry states why it may not be gated. */
const PUBLIC: Record<string, string> = {
  "/api/newsletter/open/[recipient]": "open-tracking pixel — fired by a mail client that has no session",
  "/api/newsletter/unsubscribe/[token]": "one-click unsubscribe — the token IS the credential, and RFC 8058 forbids a login wall",
  "/api/public/contact": "contact form for people who do not have an account yet",
  "/api/public/newsletter": "subscribe form on the public site",
  /*
    ANONYMOUS, and it took an independent review to say so out loud.

    This was first filed under SERVER-TOKEN with the note "server-to-server
    token (server_call_ok)", which was exactly backwards. server_call_ok is
    used OUTBOUND here: dispatchToken() authorises this route's own secret_read
    when it fetches SMTP credentials. It authenticates US TO THE DATABASE, not
    the caller to us. The only inbound header the route reads is user-agent,
    for metadata.

    So it is public, by design and by its own header comment ("the one thing an
    anonymous visitor may write"). Recording it honestly matters more than it
    sounds: the route writes a row and SENDS MAIL to an address taken from the
    body, and its only brake is an in-memory per-instance rate limit. A matrix
    that calls that token-protected is worse than no matrix.
  */
  "/api/waitlist": "public sign-up form — anonymous by design; rate-limited, and its token use is OUTBOUND only",
};

/** No session; a secret or signed token proves the caller instead. */
const SERVER_TOKEN: Record<string, string> = {
  "/api/cron/mail": "platform scheduler (CRON_SECRET) or an admin",
  "/api/newsletter/worker": "the sending belt, driven by the same secret",
  "/api/cron/grovnews": "GrovNews daily run: POST only, CRON_SECRET or the dispatch token from the pg_cron tick (0121); no session",
  "/api/hooks/supabase/send-email": "Supabase auth hook, verified by its own signing secret",
  /*
    THE ONE ROUTE THAT TURNS MONEY INTO CREDITS, and it is anonymous by
    necessity: Stripe cannot hold a GrovBase session. What stands in for one is
    an HMAC over the RAW request body, keyed by STRIPE_WEBHOOK_SECRET, checked
    before anything parses the payload — and then a second proof, the dispatch
    token, because the ledger functions refuse a caller that cannot present it.

    Worth stating plainly in this table: an unauthenticated POST endpoint that
    can grant credits is exactly the shape of route this matrix exists to keep
    honest. It holds NO service-role client for that reason.
  */
  "/api/hooks/stripe": "Stripe webhook, verified by an HMAC over the raw body (STRIPE_WEBHOOK_SECRET), then gated again by the dispatch token inside every ledger function",
  "/api/waitlist": "server-to-server token (server_call_ok)",
};

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) routeFiles(full, out);
    // Next accepts route.ts, route.tsx, route.js and route.mjs. Matching only
    // route.ts would let an unguarded endpoint be added in any of the others
    // and never appear in this matrix at all.
    else if (/^route\.(ts|tsx|js|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = routeFiles(join(ROOT, "app/api"));
const routes = files.map((f) => ({
  route: "/" + f.slice(join(ROOT, "app").length + 1).replace(/\/route\.ts$/, ""),
  src: readFileSync(f, "utf8"),
}));

console.log(`A. EVERY ROUTE IS CLASSIFIED (${routes.length} found)`);
check("the scan found routes at all", routes.length > 10, `only ${routes.length}`);

const unclassified: string[] = [];
const adminRoutes: string[] = [];
const authedRoutes: string[] = [];
for (const { route, src } of routes) {
  if (PUBLIC[route] || SERVER_TOKEN[route]) continue;
  // Calling getUser() is not a guard; ACTING on the answer is. A route that
  // reads the user and never refuses anyone would otherwise classify as
  // AUTHENTICATED on the strength of one function call.
  const checksUser = /auth\.getUser\(\)/.test(src)
    && /if\s*\(!\s*user\s*\)/.test(src)
    && /status:\s*401/.test(src);
  // The role is re-read from profiles and compared; a route that merely
  // mentions the word "admin" does not count.
  const checksAdmin = /role\s*!==\s*"admin"|requireAdmin\(/.test(src);
  if (checksAdmin) adminRoutes.push(route);
  else if (checksUser) authedRoutes.push(route);
  else unclassified.push(route);
}
check(
  "no route is left without a guard or an explicit exemption",
  unclassified.length === 0,
  unclassified.length
    ? `${unclassified.join(", ")} — add a check, or classify it in PUBLIC/SERVER_TOKEN with a reason`
    : "",
);

console.log("\nB. EVERY /api/admin ROUTE RE-CHECKS THE ROLE ITSELF");
// The admin LAYOUT cannot protect a route: no layout runs for an API call.
// Without an in-route check, any signed-in customer could call these.
for (const { route, src } of routes) {
  if (!route.startsWith("/api/admin/")) continue;
  check(
    `${route} refuses a non-admin`,
    /role\s*!==\s*"admin"|requireAdmin\(/.test(src) && /status:\s*403/.test(src),
    "an /api/admin route that trusts the layout is reachable by every logged-in customer",
  );
}

console.log("\nC. THE STEP-UP GATE ONLY EXISTS FOR /api");
/*
  THE LOAD-BEARING FACT OF P1-28.

  The emailed-code second factor is enforced at the request layer in
  middleware, and stepUpAppliesTo returns FALSE for every path that is not
  under /api/. So the middleware matcher is the ONLY thing that brings an API
  request past that gate. Excluding /api from the matcher — the change the
  finding proposed — would not make the gate cheaper. It would delete it, and
  re-open P1-23, whose whole point is that a stolen password yields a valid
  session before any layout has run.
*/
check("step-up does not apply to page routes", !stepUpAppliesTo("/home") && !stepUpAppliesTo("/regulamin"));
check("step-up DOES apply to the routes that spend credits",
  stepUpAppliesTo("/api/generate") && stepUpAppliesTo("/api/tools/run") && stepUpAppliesTo("/api/retouch"));
check("and to the ones that hand back the customer's work",
  stepUpAppliesTo("/api/library/zip") && stepUpAppliesTo("/api/generations"));
check("the self-authenticating endpoints stay exempt",
  !stepUpAppliesTo("/api/cron/mail") && !stepUpAppliesTo("/api/public/contact")
  && !stepUpAppliesTo("/api/newsletter/worker") && !stepUpAppliesTo("/api/waitlist"));

console.log("\nD. THE MIDDLEWARE STILL RUNS FOR /api");
const mw = readFileSync(join(ROOT, "middleware.ts"), "utf8");
const matcher = /matcher:\s*\[([^\]]*)\]/.exec(mw)?.[1] ?? "";
check("a matcher is declared", matcher.length > 0);
check(
  "the matcher does NOT exclude /api",
  !/\bapi\b/.test(matcher),
  "excluding /api here removes the only step-up enforcement point — see section C",
);
/*
  AND THE PREFETCH HEADER IS NOT AN AUTHORISATION SIGNAL.

  The other half of the proposed change was to skip work when
  `next-router-prefetch: 1` is present. That header arrives from the client and
  Next does not strip it — base-server.js deletes NEXT_URL and nothing else —
  so any caller can set it. Using it to skip updateSession would hand out a
  one-header bypass of both the protected-path redirect and the step-up 403.

  It is legitimately used in this file for ONE thing: deciding whether to issue
  a 30x for an admin-managed redirect, where the worst case of a forged header
  is that the forger does not get redirected.
*/
const prefetchUses = mw.split("next-router-prefetch").length - 1;
check("the prefetch header is consulted at most once, for redirects only",
  prefetchUses <= 1 && (prefetchUses === 0 || /matchRedirect/.test(mw)),
  `found ${prefetchUses} uses — it is attacker-controlled and must never gate auth`);
check("updateSession is not conditional on any request header",
  /const response = await updateSession\(request\);/.test(mw),
  "updateSession must run unconditionally for every matched request");

console.log("\nE. PROTECTED PREFIXES STILL COVER THE PRODUCT");
check("the dashboard and the panel are protected",
  isProtectedPath("/home") && isProtectedPath("/admin") && isProtectedPath("/settings"));
check("and a public CMS slug is NOT swallowed by a one-letter prefix",
  !isProtectedPath("/kontakt") && !isProtectedPath("/regulamin") && !isProtectedPath("/polityka-prywatnosci"));

console.log(`
THE VERDICT ON P1-28: NO CODE CHANGE.

  1. Excluding /api deletes the only step-up enforcement point (section C).
  2. next-router-prefetch is attacker-controlled (section D).
  3. The remaining matcher tweak saves zero auth round trips: middleware
     already runs on those paths, and the change only moves which ones.
  4. The finding's premise does not hold for the traffic it was about. On a
     public page with no auth cookie, supabase getUser() returns
     AuthSessionMissingError from _useSession WITHOUT issuing a request — read
     in @supabase/auth-js GoTrueClient._getUser. There is no redundant network
     call to remove for an anonymous visitor. The genuine double call happens
     only on AUTHENTICATED requests, where middleware and the route each
     verify, and removing either one is removing a check, not a duplication.
`);

console.log(failures === 0 ? "All route matrix tests passed." : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
