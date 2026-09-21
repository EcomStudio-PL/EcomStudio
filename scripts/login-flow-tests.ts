/**
 * THE ORDER OF THE LOGIN FLOW — the regression for the bug that was reported.
 *
 * WHAT HAPPENED, EXACTLY.
 *
 *   A is signed in. A opens the login door to switch to account B.
 *     lib/supabase/middleware.ts saw a session and redirected away from the
 *     auth page to /home
 *       → app/(app)/layout.tsx ran enforceLoginSecurity FOR A
 *       → /auth/security-check
 *       → ensureChallengeAction() read A's session
 *       → a 6-digit code was e-mailed to A
 *       → "Potwierdź, że to Ty"
 *
 *   No form was shown. No address was typed. No password was typed. The second
 *   factor fired because a cookie existed, not because anybody authenticated.
 *
 * THE RULE THIS PINS: a challenge is a consequence of AUTHENTICATING, and it
 * belongs to the account that was just authenticated — never to whatever
 * session happened to be open beforehand.
 *
 * Numbered to the brief: TEST 1-3 here, TEST 4-9 in the SQL suite
 * (scripts/login-security-sql-tests.sh, run against a real Postgres, where the
 * timing and the concurrency can actually be exercised) and in
 * scripts/login-security-key-tests.ts, TEST 10 in section D below.
 *
 * Run: npm run test:loginflow
 */
import { readFileSync } from "fs";
import { NextRequest } from "next/server";
import { evaluateRisk, openOrReuseChallenge, LOGIN_SECURITY_DEFAULTS } from "@/lib/server/login-security";
import { updateSession } from "@/lib/supabase/middleware";
import { resetPassCache } from "@/lib/server/step-up-edge";
/*
  IMPORTED BY PATH, NOT BY THE ALIASED NAME.

  package.json points esbuild's `@supabase/ssr` and `@/lib/server/mailer` at
  these files, so the middleware and the mailer under test resolve to exactly
  these module instances. Importing them here by their real paths means the
  same instance again — and, unlike importing "@supabase/ssr", it also
  typechecks, because tsc knows nothing about esbuild's aliases.
*/
import { __reset, __setSession, __setVerdict, rpcCalls } from "./stubs/supabase-ssr";
import { deliveries, __reset as __resetMailer } from "./stubs/login-security-mailer";
import { __smtpConfigured } from "./stubs/login-security-integrations";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail === undefined ? "" : ` — ${String(detail).slice(0, 220)}`}`); }
}

const read = (p: string) => readFileSync(p, "utf8");

async function main() {

/* ════════════════════════════════════════════════════════════════════════ */
console.log("A0. TEST 1 — THE MIDDLEWARE, RUN RATHER THAN READ");
{
  /*
    The real updateSession(), every branch in its real order, with only the
    Supabase client replaced (scripts/stubs/supabase-ssr.ts). A regex can say
    the redirect was deleted; only this can say what the request actually gets.
  */
  const A = { id: "user-a" };
  const go = async (path: string, search = "") => {
    resetPassCache();
    const res = await updateSession(
      new NextRequest(`https://grovbase.com${path}${search}`),
    );
    return { status: res.status, location: res.headers.get("location") };
  };

  // ── A is signed in and opens a login door. Nothing may move them.
  __reset(); __setSession(A);
  for (const [path, search] of [
    ["/login", ""], ["/login", "?next=%2Fhome"], ["/", "?auth=login"],
    ["/register", ""], ["/forgot-password", ""], ["/admin/login", ""],
  ] as const) {
    const r = await go(path, search);
    check(`signed in, ${path}${search} is NOT redirected`,
      r.status === 200 && r.location === null, JSON.stringify(r));
  }
  check("and opening a login door asked the database for NOTHING",
    rpcCalls.length === 0,
    "a challenge starts after credentials, never on the way to the form");

  // ── the protections that must still hold, exercised the same way.
  __reset(); __setSession(null);
  const stranger = await go("/home");
  check("a stranger on a protected page is still sent to the dialog",
    stranger.status === 307 && (stranger.location ?? "").includes("auth=login"),
    JSON.stringify(stranger));
  check("...carrying where they were going",
    (stranger.location ?? "").includes("next=%2Fhome"), stranger.location);

  const strangerApi = await go("/api/generate");
  check("a stranger's API call is not step-up-checked (there is no session)",
    rpcCalls.length === 0, JSON.stringify(rpcCalls));

  // ── an authenticated but UNVERIFIED device still cannot spend credits.
  __reset(); __setSession(A); __setVerdict({ trusted: false });
  const gatedApi = await go("/api/generate");
  check("an unverified device is refused the API with 403",
    gatedApi.status === 403, JSON.stringify(gatedApi));
  check("and the refusal came from a real policy check",
    rpcCalls.some((c) => c.name === "login_security_check"), JSON.stringify(rpcCalls));

  // ── the same session, on the login door, is still let through. This is the
  //    whole point: the gate guards the APP, not the act of signing in.
  __reset(); __setSession(A); __setVerdict({ trusted: false });
  const doorWhileGated = await go("/login");
  check("the SAME unverified session may still reach the login form",
    doorWhileGated.status === 200 && doorWhileGated.location === null,
    JSON.stringify(doorWhileGated));
  check("and that did not require any second-factor decision",
    rpcCalls.length === 0, JSON.stringify(rpcCalls));

  // ── a verified device is waved through the API.
  __reset(); __setSession(A); __setVerdict({ trusted: true });
  const okApi = await go("/api/generate");
  check("a trusted device passes the API gate", okApi.status === 200, JSON.stringify(okApi));

  // ── TEST 10, at the request layer: the feature off is a PASS, not a 403.
  __reset(); __setSession(A); __setVerdict({ trusted: true });
  const featureOff = await go("/api/tools/run");
  check("TEST 10: with the policy answering 'trusted', no 403",
    featureOff.status === 200, JSON.stringify(featureOff));

  __reset();
}

/* ════════════════════════════════════════════════════════════════════════ */
console.log("\nA. TEST 1 — A SESSION DOES NOT CLOSE THE LOGIN DOOR");
{
  const mw = read("lib/supabase/middleware.ts");

  /*
    The exact redirect that caused it. It read:

      const dialogOpen = pathname === AUTH_HOST && searchParams.has(AUTH_PARAM);
      if (user && (dialogOpen || isAuthPage(pathname))) { ...redirect to /home }

    Any shape of "authenticated + on an auth page → go into the app" puts the
    bug back, because the app is where the gate lives.
  */
  check("nothing redirects an authenticated visitor off an auth page",
    !/user\s*&&\s*\(?\s*(dialogOpen|isAuthPage)/.test(mw),
    "this is the redirect that fired the second factor before any credentials");
  check("and not off the operator's door either",
    !/if\s*\(\s*user\s*&&\s*adminLogin\s*\)/.test(mw),
    "/admin/login had the identical defect for admin-to-admin switching");
  check("no auth path is computed as a redirect destination for a signed-in user",
    !/user\s*&&[^\n]*\n?[^\n]*safeReturnTo/.test(mw));

  // ...and the protections that must NOT have moved while doing it.
  check("a STRANGER is still refused every protected path",
    /!user\s*&&\s*!adminLogin\s*&&\s*isProtectedPath\(pathname\)/.test(mw));
  check("the edge step-up still runs for signed-in callers",
    /if\s*\(user\s*&&\s*stepUpAppliesTo\(pathname\)\)/.test(mw));
  check("and it still refuses with a 403",
    /step_up_required[\s\S]{0,60}status:\s*403/.test(mw));
  check("the policy is still the database's, not the caller's",
    /p_verify_device:\s*true/.test(mw) && /migration 0104|0104/.test(mw),
    "P1-17: login_security_check reads its own policy");
  check("auth pages are still never cached",
    /isProtectedPath\(pathname\)\s*\|\|\s*isAuthPage\(pathname\)[\s\S]{0,120}no-store/.test(mw));

  // The gate itself is untouched: both protected layouts still consult it.
  for (const p of ["app/(app)/layout.tsx", "app/admin/layout.tsx"]) {
    check(`${p} still calls the gate`, /enforceLoginSecurity\(supabase\)/.test(read(p)));
  }

  /*
    THE MIDDLEWARE IS NOT THE ONLY PLACE THAT CAN BOUNCE A SIGNED-IN VISITOR.

    This check exists because the first version of this suite did not have it,
    and it reported /admin/login as fixed while it was not. A0 runs
    updateSession(), which is the middleware — but app/(auth)/admin/login
    carried its own `if (user) redirect("/admin")`, justified by a comment
    saying the middleware already did it. Removing the middleware redirect left
    the page's copy behind, and the whole chain still completed:

      /admin/login → redirect("/admin") → app/admin/layout.tsx runs
      enforceLoginSecurity for the OLD session → /auth/security-check → a code
      is e-mailed to the account the operator was trying to leave.

    So the rule is asserted over EVERY auth door as a class, not at the one
    address somebody remembered. A door that reads the session and redirects on
    it is the defect, wherever it is written.
  */
  const AUTH_DOORS = [
    "app/(auth)/login/page.tsx",
    "app/(auth)/register/page.tsx",
    "app/(auth)/forgot-password/page.tsx",
    "app/(auth)/reset-password/page.tsx",
    "app/(auth)/admin/login/page.tsx",
    "app/(auth)/layout.tsx",
  ];
  for (const door of AUTH_DOORS) {
    const src = read(door);
    // Comments are stripped first: these files EXPLAIN the removed redirect,
    // and prose must not be able to fail — or pass — a guard about code.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    check(`${door} does not redirect on the presence of a session`,
      !(/getUser\(\)/.test(code) && /redirect\(/.test(code)),
      "reading the session and bouncing on it is the defect, wherever it lives");
    check(`${door} opens no challenge of its own`,
      !/ensureChallenge|login_challenge|security-check/.test(code));
  }
  const signIn = read("app/auth/sign-in/route.ts");
  check("the sign-in route opens no challenge either — the gate does that",
    !/ensureChallenge|login_challenge/.test(signIn));
  check("the password is still checked before anything else happens",
    /signInWithPassword/.test(signIn));
}

/* ════════════════════════════════════════════════════════════════════════ */
console.log("\nB. TEST 2 — THE CHALLENGE BELONGS TO WHOEVER JUST AUTHENTICATED");
{
  const actions = read("app/actions/login-security.ts");

  /*
    THE CLIENT MUST NOT BE ABLE TO NAME THE ACCOUNT. If any of these took a
    user id or an address, a caller could open — or verify — a challenge for
    somebody else, which is the account-switch bug turned into an attack.
  */
  check("ensureChallengeAction takes NOTHING from the client",
    /export async function ensureChallengeAction\(\s*\)/.test(actions));
  check("resendCodeAction takes NOTHING from the client",
    /export async function resendCodeAction\(\s*\)/.test(actions));
  check("verifyCodeAction takes only the six digits",
    /export async function verifyCodeAction\(code: string\)/.test(actions));
  check("every one of them re-reads the session server-side",
    (actions.match(/await supabase\.auth\.getUser\(\)/g) ?? []).length >= 4);
  check("the address the code goes to is the SESSION's, never an argument",
    /openOrReuseChallenge\(supabase,\s*\{[\s\S]{0,200}?email: user\.email/.test(actions));
  check("the id the challenge is opened for is the SESSION's",
    /openOrReuseChallenge\(supabase,\s*\{[\s\S]{0,200}?userId: user\.id/.test(actions));
  check("and the IP comes from the request, not the body",
    /hashIp\(await callerIpRaw\(\)\)/.test(actions) && !/ipHash:\s*input|ip:\s*body/.test(actions));
}

/* ════════════════════════════════════════════════════════════════════════ */
console.log("\nC. TEST 2/3 — A'S CODE IS NEVER B'S CODE (exercised)");
{
  /*
    Behavioural, against a fake that answers the way migration 0111 does. The
    account-switch case in one run: A already holds a live code, B then
    authenticates on the SAME browser (same device hash), and what B gets must
    be B's own challenge — while A's is left exactly as it was.
  */
  const A = "user-a", B = "user-b";
  type Row = {
    id: string; user: string; device: string; code: string;
    expires: number; used: number | null;
  };
  const rows: Row[] = [];
  let seq = 0;
  let now = 1_700_000_000_000;

  const liveOf = (user: string, device: string) =>
    rows.find((r) => r.user === user && r.device === device && r.used === null && r.expires > now);

  // The module refuses to issue anything without a server key (P0-04, fails
  // CLOSED on purpose), and publishes sha256(token) into app_settings before
  // every call. Both are given here so the test exercises the real path
  // instead of the early return.
  process.env.GROVBASE_SERVER_KEY = "a-long-random-proof-of-server-value-32+";
  const settings = new Map<string, Record<string, unknown>>();

  const client = {
    from() {
      return {
        select() {
          return { eq(_c: string, key: string) {
            return { maybeSingle: async () => ({ data: { value: settings.get(key) ?? null }, error: null }) };
          } };
        },
        async upsert(row: { key: string; value: Record<string, unknown> }) {
          settings.set(row.key, row.value);
          return { error: null };
        },
      };
    },
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === "login_challenge_start") {
        const alive = liveOf(String(args.p_user), String(args.p_device_hash));
        if (alive) {
          return { data: { status: "live", expires_in_seconds: Math.floor((alive.expires - now) / 1000) }, error: null };
        }
        const ttl = Number(args.p_ttl_seconds ?? 120);
        const row: Row = {
          id: `ch_${++seq}`, user: String(args.p_user), device: String(args.p_device_hash),
          code: String(args.p_code_hash), expires: now + ttl * 1000, used: null,
        };
        rows.push(row);
        return { data: { status: "opened", id: row.id, expires_in_seconds: ttl }, error: null };
      }
      return { data: null, error: null };
    },
  };

  /*
    THE REAL CHAIN, STOPPING AT THE TRANSPORT. The mailer is the recording
    stub, so `deliveries` is what SMTP would actually have been handed —
    address included. That is the assertion that matters here: not "a row was
    written" but "the six digits went to this person".
  */
  __resetMailer();
  __smtpConfigured();
  const openFor = (user: string, email: string) =>
    openOrReuseChallenge(client as never, {
      userId: user, email, deviceHash: "same-browser", ipHash: "ip", label: "Mac",
      reason: "new_device", settings: LOGIN_SECURITY_DEFAULTS,
    } as never);

  const first = await openFor(A, "a@example.com");
  check("A's challenge is opened and the code is sent",
    first.status === "sent", JSON.stringify(first));
  const aRows = rows.filter((r) => r.user === A).length;
  check("A holds exactly one challenge", aRows === 1, `rows=${aRows}`);
  check("and exactly one mail left, addressed to A",
    deliveries.length === 1 && deliveries[0]?.to === "a@example.com",
    JSON.stringify(deliveries.map((d) => d.to)));
  check("carrying a real six-digit code",
    /\d{6}/.test((deliveries[0]?.text ?? "").replace(/\s+/g, "")),
    deliveries[0]?.text?.slice(0, 80));

  // B now signs in on the same browser. A's row must not be touched, reused or
  // handed over.
  const aRowBefore = JSON.stringify(rows.filter((r) => r.user === A));
  const second = await openFor(B, "b@example.com");
  check("B's own challenge is opened", second.status === "sent", JSON.stringify(second));
  check("B gets a challenge of B's own",
    rows.filter((r) => r.user === B).length === 1,
    JSON.stringify(rows.map((r) => r.user)));
  check("A gets NO new challenge from B signing in",
    rows.filter((r) => r.user === A).length === 1);
  check("A's existing row is untouched",
    JSON.stringify(rows.filter((r) => r.user === A)) === aRowBefore);
  check("the second mail went to B, and ONLY to B",
    deliveries.length === 2 && deliveries[1]?.to === "b@example.com",
    JSON.stringify(deliveries.map((d) => d.to)));
  check("B's code is not A's code",
    (deliveries[0]?.text ?? "x").replace(/\s+/g, "").match(/\d{6}/)?.[0]
    !== (deliveries[1]?.text ?? "y").replace(/\s+/g, "").match(/\d{6}/)?.[0]);
  check("A's live code does not satisfy B — they are separate rows",
    liveOf(A, "same-browser")!.id !== liveOf(B, "same-browser")!.id);

  // TEST 3 — B does not need a second factor at all: the gate never sends the
  // person here, so no challenge exists for anyone.
  const countBefore = rows.length;
  const trusted = await evaluateRisk(
    client as never,
    { ...LOGIN_SECURITY_DEFAULTS, verifyNewDevice: false, verifyNewIp: false, reverifyDays: 0 },
    "same-browser", "ip",
  );
  check("TEST 3: with nothing to verify the risk check says trusted",
    trusted.trusted === true, JSON.stringify(trusted));
  check("TEST 3: and no challenge is created on the way",
    rows.length === countBefore);

  // Time passes; A's code dies. That must not resurrect anything for B.
  now += (LOGIN_SECURITY_DEFAULTS.codeTtlSeconds + 1) * 1000;
  check("once expired, neither account holds a live code",
    !liveOf(A, "same-browser") && !liveOf(B, "same-browser"));
}

/* ════════════════════════════════════════════════════════════════════════ */
console.log("\nD. TEST 10 — TURNING THE FEATURE OFF STILL WORKS, AND IS NOT A 403");
{
  let rpcCalls = 0;
  const client = {
    from() {
      return { select() { return { eq() { return { maybeSingle: async () => ({ data: null, error: null }) }; } }; } };
    },
    async rpc() { rpcCalls++; return { data: null, error: null }; },
  };

  const off = await evaluateRisk(
    client as never,
    { ...LOGIN_SECURITY_DEFAULTS, verifyNewDevice: false, verifyNewIp: false, reverifyDays: 0 },
    "", "",
  );
  check("all three knobs off → trusted", off.trusted === true, JSON.stringify(off));
  check("...without even asking the database", rpcCalls === 0, `rpcCalls=${rpcCalls}`);

  // The edge gate has to agree, or the pages open and the API 403s.
  const mw = read("lib/supabase/middleware.ts");
  check("the edge gate lets a 'trusted' verdict through",
    /verdict === true[\s\S]{0,80}rememberPass/.test(mw));
  // The window is generous because the branch carries the paragraph that
  // explains WHY it is not a refusal, and a guard that fails on a comment
  // getting longer is a guard that punishes documentation.
  check("and an UNDECIDED verdict is not a refusal",
    /error \|\| verdict === undefined[\s\S]{0,1200}console\.warn\("stepUp\.undecided"/.test(mw),
    "a database hiccup must not read as 'the feature is on and you failed it'");
  // 0104 is what makes the off switch reach the edge at all: the function
  // reads its own policy, so a deployment with the feature off is waved
  // through there exactly as it is in the layouts.
  const m0104 = read("supabase/migrations/0104_login_security_reads_its_own_policy.sql");
  check("the off switch is read INSIDE the database function",
    /verify_new_device/.test(m0104) && /app_settings/.test(m0104));
}

/* ════════════════════════════════════════════════════════════════════════ */
console.log("\nE. THE SCREEN STILL SAYS WHOSE ADDRESS IT IS");
{
  const ui = read("components/auth/security-check.tsx");
  const actions = read("app/actions/login-security.ts");
  check("the masked address comes from the server's session read",
    /masked: maskEmail\(user\.email\)/.test(actions));
  check("and the screen only ever renders what it was handed",
    /setMasked\(res\.masked\)/.test(ui) && !/maskEmail/.test(ui));
  check("a code that has expired is refused with words, not a crash",
    /security\.expired/.test(ui) && /reason === "expired"/.test(ui));
  /*
    THE DEAD END THIS ALMOST SHIPPED WITH.

    login_challenge_verify (0057) spends the row on the LAST wrong attempt:

      used_at = case when attempts + 1 >= max_attempts then now() else null end

    so after a lockout the server holds no live challenge and would issue a
    replacement immediately. The screen cleared its deadline only on
    `expired`, so the countdown kept running after a lockout and — under the
    one-live-code rule, where the button is disabled while the clock runs —
    the only way forward was greyed out for up to the full TTL. Every ending
    the DATABASE treats as final must end the clock here too.
  */
  check("a lockout ends the clock, because the server ended the challenge",
    /res\.reason === "locked" \|\| res\.reason === "expired" \|\| res\.reason === "not_found"[\s\S]{0,200}?setExpiresAt\(Date\.now\(\)\)/
      .test(ui),
    "leaving the countdown running after a lockout disables the only way out");
  check("a spent-elsewhere challenge is not reported as a wrong code",
    /not_found/.test(ui) && !/attemptsLeft[\s\S]{0,80}not_found/.test(ui));
  check("a send that failed says so instead of claiming a code went out",
    /res\.status === "error"\) setError/.test(ui),
    "otherwise the page shows 'we sent a code to m***@…' after an SMTP throw");
  /*
    THE SCREEN MUST NOT OFFER WHAT THE SERVER WILL REFUSE — AND MUST NOT
    WITHHOLD WHAT IT WOULD ACCEPT.

    An earlier version of this change got that backwards. login_challenge_verify
    SPENDS the row on the last wrong attempt, so after a lockout there is no
    live challenge and a replacement can be issued at once; the copy had been
    rewritten to say the opposite ("only once the current one expires"), which
    invented a two-minute dead end the server never asked for.

    Each language is checked against ITS OWN expected phrase rather than a
    union of all three — a union passes when an untranslated English string is
    sitting in pl.json, which is exactly the bug "checked in all three
    languages" is supposed to catch.
  */
  const COPY: Record<string, { locked: RegExp; stillValid: RegExp }> = {
    pl: { locked: /nowy kod/i, stillValid: /jeszcze ważny/i },
    en: { locked: /new code/i, stillValid: /still valid/i },
    de: { locked: /neuen code/i, stillValid: /noch gültig/i },
  };
  const seen: Record<string, string[]> = { locked: [], stillValid: [] };
  for (const lang of ["pl", "en", "de"] as const) {
    const dict = JSON.parse(read(`lib/i18n/dictionaries/${lang}.json`)) as
      { security: Record<string, string> };
    const locked = dict.security.locked ?? "";
    const stillValid = dict.security.stillValid ?? "";
    check(`${lang}: the lockout message points at a NEW code, not at waiting`,
      COPY[lang]!.locked.test(locked) && !/wygaśnię|expires|Ablauf/i.test(locked),
      locked);
    check(`${lang}: a refused resend says the current code is still valid`,
      COPY[lang]!.stillValid.test(stillValid), stillValid);
    seen.locked!.push(locked);
    seen.stillValid!.push(stillValid);
  }
  // Three distinct strings, or one of them is an untranslated copy of another.
  for (const key of ["locked", "stillValid"] as const) {
    check(`security.${key} is genuinely translated three times`,
      new Set(seen[key]).size === 3, JSON.stringify(seen[key]));
  }
  check("leaving the page un-cleared sends the person to login, not into the app",
    /window\.location\.assign\("\/login"\)/.test(ui));
  check("and it only navigates on when the GATE would really pass",
    /clearanceReadyAction\(\)/.test(ui) && /ready \? next : "\/login"/.test(ui));
}

console.log(failures === 0
  ? "\nAll login-flow tests passed.\n"
  : `\n${failures} login-flow test(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("login-flow tests crashed:", e); process.exit(1); });
