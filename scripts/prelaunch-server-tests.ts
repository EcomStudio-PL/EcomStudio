/**
 * PRE-LAUNCH LANDING V2 — THE SERVER TRACK. Routes, mail, rewards hook, admin
 * campaign settings, and the three places the old code had to learn about them.
 *
 *   A  handles: token / answer / decoy shapes, the first-name and e-mail rules
 *   B  origin: canonical + www, previews only outside production, null, no Origin
 *   C  the shared door: method → content-type → Origin → rate limit → JSON caps,
 *      no-store on every answer
 *   D  signup: uniform 200 across created / existing / confirmed / throttled /
 *      suppressed (byte-identical shape, decoys shaped like the real thing),
 *      honeypot, 409 consent_changed, 400s, attribution from the httpOnly
 *      cookie only, keyed IP hash, after(): the DOI mail only when `send`, CTA
 *      forced to the fragment link, no first name in it, locale templates,
 *      mark_sent ok/failed, notify only when created && send and without the IP,
 *      logs carry no address and no token
 *   E  resend: uniform, email XOR token, old token hashed, per-target brake
 *   F  confirm: shapes, never an '@', referral url + approved Y, welcome mail
 *      once / respecting the switch / by locale
 *   G  channel: uniform 200 for ok / invalid / expired, 400 only when malformed
 *   H  /api/waitlist: "exists" answers exactly like "created"; the shared ping
 *      builder keeps that door's IP row
 *   I  campaign settings: Warsaw DST, ranges, approvals, price lock, early
 *      access kept, confirmed rewards switch-on, update-only, audit, revalidate;
 *      the panel read; the visible summary and the registration warnings
 *   J  the generic settings editor refuses / hides `prelaunch`
 *   K  deleteContactAction scrubs the pre-launch rows FIRST
 *   L  the rewards hook: silent while off, log_activity with amounts only, never throws
 *   M  the template catalog entries, and every i18n key this track uses in pl/en/de
 *
 * Mocks only — no network, no database, no mail server. Run:
 *   node_modules/.bin/esbuild scripts/prelaunch-server-tests.ts --bundle --platform=node --format=cjs \
 *     --alias:next/server=./scripts/stubs/prelaunch-next.ts --alias:next/headers=./scripts/stubs/prelaunch-next.ts \
 *     --alias:next/cache=./scripts/stubs/prelaunch-next.ts --alias:nodemailer=./scripts/stubs/prelaunch-next.ts \
 *     --alias:@/lib/supabase/server=./scripts/stubs/prelaunch-supabase-server.ts \
 *     --alias:@supabase/supabase-js=./scripts/stubs/prelaunch-supabase.ts \
 *     --alias:@=. --alias:server-only=./scripts/server-only-stub.js --external:sharp \
 *     --outfile=.next/prelaunch-server-tests.cjs --log-level=error \
 *   && NEXT_PUBLIC_SITE_URL=https://grovbase.com node .next/prelaunch-server-tests.cjs
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { testState } from "./stubs/prelaunch-next";
import { installAnon, installSession, makeFakeDb, type DbResult, type FakeDb, type FromCall } from "./stubs/prelaunch-supabase";
import {
  ANSWER_HANDLE_RE, DOI_TOKEN_RE, cleanEmail, cleanFirstName, decoyAnswerHandle, decoyReferralCode, newAnswerHandle, newDoiToken,
} from "@/lib/server/prelaunch/handles";
import { allowedOrigins, originAllowed } from "@/lib/server/prelaunch/origin";
import { prelaunchIpHash } from "@/lib/server/prelaunch/ip";
import { confirmLink, referralLink, renderOptinMail, scrubForLog } from "@/lib/server/prelaunch/mail";
import { getLaunchConsents } from "@/lib/server/prelaunch/public";
import { ensurePrelaunchRewards } from "@/lib/server/prelaunch/rewards";
import {
  PRELAUNCH_DEFAULTS, PRELAUNCH_SETTING_KEY, instantToWarsaw, launchWarnings, parsePrelaunchCampaign,
  validatePrelaunchCampaignInput, visibleValues, warsawToInstant, type PrelaunchCampaignConfig,
} from "@/lib/server/prelaunch/campaign-config";
import { REFERRAL_CODE_RE } from "@/lib/launch/fields";
import { TEMPLATE_CATALOG, catalogEntry, defaultTemplate } from "@/lib/server/message-templates";
import { POST as signupPOST } from "@/app/api/public/prelaunch/signup/route";
import { POST as resendPOST } from "@/app/api/public/prelaunch/resend/route";
import { POST as confirmPOST } from "@/app/api/public/prelaunch/confirm/route";
import { POST as channelPOST } from "@/app/api/public/prelaunch/channel/route";
import { POST as waitlistPOST } from "@/app/api/waitlist/route";
import { prelaunchCampaignPanelAction, savePrelaunchCampaignAction } from "@/app/actions/prelaunch-admin";
import { saveSettingAction } from "@/app/actions/admin";
import { deleteContactAction } from "@/app/actions/newsletter";
import type { Client } from "@/lib/services/workspace";

let failures = 0;
let passes = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passes++; console.log(`  ✓ ${name}`); }
  else {
    failures++;
    const d = detail === undefined ? "" : ` — ${String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 400)}`;
    console.error(`  ✗ ${name}${d}`);
  }
}
const read = (p: string) => readFileSync(p, "utf8");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const state = testState();

/* ── environment ───────────────────────────────────────────────────────── */

const SERVER_KEY = "prelaunch-test-server-key-0123456789abcdef";
process.env.GROVBASE_SERVER_KEY = SERVER_KEY;
delete process.env.VERCEL_ENV;
delete process.env.VERCEL_URL;
delete process.env.VERCEL_BRANCH_URL;
const SITE = "https://grovbase.com";

/* ── fakes ─────────────────────────────────────────────────────────────── */

const MAIL_PAYLOAD = {
  from_name: "GrovBase", from_email: "hello@grovbase.com", reply_to: "hello@grovbase.com",
  smtp: { host: "smtp.example.test", port: 587, user: "mailer", encryption: "tls", ciphertext: null, iv: null, auth_tag: null },
};

type Scenario = {
  signup?: DbResult;
  resend?: DbResult;
  confirm?: DbResult;
  channel?: DbResult;
  mailPayload?: unknown;
  welcomePayload?: unknown;
  published?: Record<string, unknown>;
  publicConfig?: Record<string, unknown> | null;
  reward?: DbResult;
  settings?: Record<string, unknown>;
  user?: { id: string } | null;
  role?: string;
  updateError?: boolean;
  forgetError?: boolean;
  waitlist?: DbResult;
};

let session: FakeDb;
let anon: FakeDb;

function install(sc: Scenario = {}) {
  const settings = sc.settings ?? {};
  const fromHandler = (call: FromCall): DbResult | undefined => {
    if (call.table === "profiles") {
      return { data: sc.user === null ? null : { id: "admin-1", role: sc.role ?? "admin" }, error: null };
    }
    if (call.table === "app_settings" && call.op === "select") {
      const inKeys = call.filters.find(([op, col]) => op === "in" && col === "key")?.[2] as string[] | undefined;
      const eqKey = call.filters.find(([op, col]) => op === "eq" && col === "key")?.[2] as string | undefined;
      const wanted = inKeys ?? (eqKey ? [eqKey] : Object.keys(settings));
      const rows = wanted.filter((k) => k in settings).map((k) => ({ key: k, value: settings[k], updated_at: "2026-10-19T10:00:00.000Z" }));
      return { data: call.mode === "many" ? rows : rows[0] ?? null, error: null };
    }
    if (call.table === "app_settings" && call.op === "update") {
      return { data: null, error: sc.updateError ? { message: "denied" } : null };
    }
    if (call.table === "newsletter_contacts" && call.op === "select") {
      return { data: { email: "someone@example.com" }, error: null };
    }
    return undefined;
  };
  const rpcHandler = (fn: string, args: Record<string, unknown> | undefined): DbResult | undefined => {
    switch (fn) {
      case "prelaunch_signup": return sc.signup;
      case "prelaunch_resend": return sc.resend;
      case "prelaunch_confirm": return sc.confirm;
      case "prelaunch_set_channel": return sc.channel;
      case "prelaunch_mail_payload": return { data: sc.mailPayload === undefined ? MAIL_PAYLOAD : sc.mailPayload, error: null };
      case "waitlist_confirmation_payload": return { data: sc.welcomePayload === undefined ? MAIL_PAYLOAD : sc.welcomePayload, error: null };
      case "secret_read_many": return { data: [{ name: "grovbase.mail.smtp_password", value: "vault-password" }], error: null };
      case "message_template_lookup": return { data: sc.published?.[String(args?.p_event)] ?? null, error: null };
      case "prelaunch_public_config": return { data: sc.publicConfig === undefined ? { optin_ttl_hours: 48 } : sc.publicConfig, error: null };
      case "prelaunch_reward_ensure": return sc.reward;
      case "prelaunch_forget_contact": return { data: null, error: sc.forgetError ? { message: "missing function" } : null };
      case "waitlist_subscribe": return sc.waitlist;
      default: return undefined;
    }
  };
  session = makeFakeDb({ user: sc.user === undefined ? { id: "admin-1" } : sc.user, from: fromHandler, rpc: rpcHandler });
  anon = makeFakeDb({ from: () => undefined, rpc: rpcHandler });
  installSession(session);
  installAnon(anon);
  state.afterQueue.length = 0;
  state.mails.length = 0;
  state.transports.length = 0;
  state.smtpError = null;
  state.revalidated.tags.length = 0;
  state.revalidated.paths.length = 0;
}

async function flushAfter() {
  const queue = state.afterQueue.splice(0);
  for (const fn of queue) await fn();
}

let ipSeq = 0;
const nextIp = () => { ipSeq++; return `203.0.${Math.floor(ipSeq / 250)}.${ipSeq % 250 + 1}`; };

function request(path: string, body: unknown, o: {
  method?: string; origin?: string | null; ct?: string; ip?: string; raw?: string; fetchSite?: string;
} = {}): Request {
  const ip = o.ip ?? nextIp();
  const headers = new Headers();
  headers.set("content-type", o.ct ?? "application/json");
  if (o.origin !== null) headers.set("origin", o.origin ?? SITE);
  if (o.fetchSite) headers.set("sec-fetch-site", o.fetchSite);
  headers.set("x-forwarded-for", ip);
  // collectEventContext() reads the same request through next/headers.
  state.headers = new Map([["x-forwarded-for", ip], ["user-agent", "Mozilla/5.0 (iPhone) Safari/604.1"], ["accept-language", "pl-PL"]]);
  const method = o.method ?? "POST";
  return new Request(`${SITE}${path}`, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : (o.raw ?? JSON.stringify(body)),
  });
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

/** A value's shape: keys in order, string lengths, types — never the content. */
function shape(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(shape);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)]));
  if (typeof v === "string") return `string:${v.length}`;
  return typeof v;
}

/* ── A ─────────────────────────────────────────────────────────────────── */

function sectionA() {
  console.log("\nA. HANDLES AND INPUT RULES");
  const t = newDoiToken();
  check("A1 the DOI token is 32 random bytes base64url and only its sha256 is stored", DOI_TOKEN_RE.test(t.raw) && t.hash === sha(t.raw));
  const a = newAnswerHandle();
  check("A2 the answer handle is 16 bytes base64url, hashed the same way", ANSWER_HANDLE_RE.test(a.raw) && a.hash === sha(a.raw));
  const codes = Array.from({ length: 2000 }, decoyReferralCode);
  check("A3 a decoy referral code always matches REFERRAL_CODE_RE (no I, O, 0, 1)", codes.every((c) => REFERRAL_CODE_RE.test(c)));
  check("A4 decoys are random, not a constant", new Set(codes).size > 1990);
  check("A5 a decoy answer is shaped like a real handle", Array.from({ length: 200 }, decoyAnswerHandle).every((h) => ANSWER_HANDLE_RE.test(h)));
  const good = ["Łukasz", "Anna-Maria", "O'Neil", "Zoë", "Jürgen", "Ana María", "D’Angelo", "Żaneta"];
  check("A6 real first names pass (Polish/German diacritics, hyphen, apostrophe, space)", good.every((n) => cleanFirstName(n) === n), good.filter((n) => cleanFirstName(n) !== n));
  const bad = ["a@b.pl", "<b>Jan</b>", "x".repeat(41), "Wygrałeś 500 zł → bit.ly/x", "1abc", "", "   ", "Jan\u0000", "http://x", "-Jan"];
  check("A7 anything that is not a plain name is no name (S9)", bad.every((n) => cleanFirstName(n) === null), bad.filter((n) => cleanFirstName(n) !== null));
  check("A8 an NFD name is normalised before the check", cleanFirstName("Żaneta") === "Żaneta");
  check("A9 e-mail: trimmed, lower-cased, shaped, ≤ 254",
    cleanEmail("  Ola@Example.COM ") === "ola@example.com" && cleanEmail("nope") === null
    && cleanEmail(`${"a".repeat(250)}@x.pl`) === null && cleanEmail(42) === null);
  check("A9b the strict address (review S6): the shapes the mailer would re-parse into another inbox are refused, ordinary ones kept",
    ["a(1)victim@gmail.com", "x,victim@gmail.com", "x;victim@gmail.com", "x:victim@gmail.com;", "\"q\"@example.com",
      "x <victim@example.com>", "x@[1.2.3.4]", "x@-bad.example.com", "x@example"].every((e) => cleanEmail(e) === null)
    && ["jan.kowalski@example.com", "o'brien+shop@mail.example.co.uk", "x_y-z@sub.example.travel", "jan@example.xn--p1ai"]
      .every((e) => cleanEmail(e) === e)
    && cleanEmail(" Jan@Żółw.PL ") === "jan@xn--w-uga1v8h.pl");
}

/* ── B ─────────────────────────────────────────────────────────────────── */

function sectionB() {
  console.log("\nB. ORIGIN");
  const mk = (h: Record<string, string>, url = `${SITE}/api/public/prelaunch/signup`) => new Request(url, { method: "POST", headers: h });
  const prod = { VERCEL_ENV: "production", VERCEL_URL: "ecomstudio-abc.vercel.app" };
  check("B1 the canonical origin is allowed (compared as a string, not the URL object)", originAllowed(mk({ origin: SITE }), prod));
  check("B2 and its www twin", originAllowed(mk({ origin: "https://www.grovbase.com" }), prod));
  check("B3 a foreign origin is refused", !originAllowed(mk({ origin: "https://evil.example" }), prod));
  check("B4 Origin: null is refused", !originAllowed(mk({ origin: "null" }), prod));
  check("B5 a malformed Origin is refused", !originAllowed(mk({ origin: "grovbase.com" }), prod) && !originAllowed(mk({ origin: "" }), prod));
  check("B6 no Origin + no Fetch Metadata (a server-side caller) is allowed", originAllowed(mk({}), prod));
  check("B7 no Origin + sec-fetch-site: same-origin is allowed", originAllowed(mk({ "sec-fetch-site": "same-origin" }), prod));
  check("B8 no Origin + sec-fetch-site: cross-site is refused", !originAllowed(mk({ "sec-fetch-site": "cross-site" }), prod)
    && !originAllowed(mk({ "sec-fetch-site": "same-site" }), prod));
  check("B9 in production the deployment URL is NOT an allowed origin", !originAllowed(mk({ origin: "https://ecomstudio-abc.vercel.app" }), prod));
  const preview = { VERCEL_ENV: "preview", VERCEL_URL: "ecomstudio-abc.vercel.app", VERCEL_BRANCH_URL: "ecomstudio-git-feat.vercel.app" };
  const previewUrl = "https://ecomstudio-git-feat.vercel.app/api/public/prelaunch/signup";
  check("B10 on a preview: the deployment URL, the branch alias and the request's own origin",
    originAllowed(mk({ origin: "https://ecomstudio-abc.vercel.app" }), preview)
    && originAllowed(mk({ origin: "https://ecomstudio-git-feat.vercel.app" }, previewUrl), preview)
    && originAllowed(mk({ origin: "http://localhost:3111" }, "http://localhost:3111/api/public/prelaunch/signup"), {}));
  check("B11 …and still never a foreign one", !originAllowed(mk({ origin: "https://evil.vercel.app" }), preview));
  check("B12 the allowed set is built from SITE_ORIGIN.origin", allowedOrigins(mk({}), prod).has(SITE));
}

/* ── C ─────────────────────────────────────────────────────────────────── */

const SIGNUP = "/api/public/prelaunch/signup";

async function sectionC() {
  console.log("\nC. THE SHARED DOOR");
  install({ signup: { data: null, error: { message: "should not be called" } } });
  const noStore = (r: Response) => r.headers.get("cache-control") === "no-store";

  const get = await signupPOST(request(SIGNUP, null, { method: "GET" }));
  check("C1 not POST → 405 with Allow: POST", get.status === 405 && get.headers.get("allow") === "POST" && noStore(get));
  const text = await signupPOST(request(SIGNUP, { email: "a@b.pl" }, { ct: "text/plain" }));
  check("C2 text/plain (a cross-site form) → 415", text.status === 415 && noStore(text));
  const form = await signupPOST(request(SIGNUP, null, { ct: "application/x-www-form-urlencoded", raw: "email=a%40b.pl" }));
  check("C3 urlencoded → 415", form.status === 415);
  const evil = await signupPOST(request(SIGNUP, { email: "a@b.pl" }, { origin: "https://evil.example" }));
  check("C4 a foreign Origin → 403 {error:'origin'}", evil.status === 403 && (await json(evil)).error === "origin" && noStore(evil));
  const cross = await signupPOST(request(SIGNUP, { email: "a@b.pl" }, { origin: null, fetchSite: "cross-site" }));
  check("C5 no Origin but cross-site Fetch Metadata → 403", cross.status === 403);
  const big = await signupPOST(request(SIGNUP, { email: "a@b.pl", pad: "x".repeat(5000) }));
  check("C6 a body over the cap → 400 bad_request, unparsed", big.status === 400 && (await json(big)).error === "bad_request");
  const junk = await signupPOST(request(SIGNUP, null, { raw: "{not json" }));
  check("C7 malformed JSON → 400 bad_request", junk.status === 400 && (await json(junk)).error === "bad_request");
  const arr = await signupPOST(request(SIGNUP, null, { raw: "[1,2]" }));
  check("C8 a JSON array → 400 bad_request", arr.status === 400);
  check("C9 none of the refused requests reached the database", session.rpcs().length === 0 && anon.rpcs().length === 0);

  const ip = nextIp();
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) statuses.push((await signupPOST(request(SIGNUP, { company: "bot" }, { ip }))).status);
  check("C10 the 11th signup from one IP in 10 minutes → 429 rate_limited", statuses.slice(0, 10).every((s) => s === 200) && statuses[10] === 429, statuses);
  const limited = await signupPOST(request(SIGNUP, { company: "bot" }, { ip }));
  check("C11 429 is no-store and says rate_limited", limited.status === 429 && noStore(limited) && (await json(limited)).error === "rate_limited");
  const order = (await confirmPOST(request("/api/public/prelaunch/confirm", null, { ct: "text/plain", origin: "https://evil.example", raw: "x" }))).status;
  check("C12 order: content-type is judged before Origin (415, not 403)", order === 415);
}

/* ── D ─────────────────────────────────────────────────────────────────── */

type SignupAnswerRow = {
  status: string; created?: boolean; send?: boolean; token_id?: string | null; signup_id?: string | null;
  email?: string | null; locale?: string; referral_code?: string | null; throttled?: boolean;
};
const answer = (row: SignupAnswerRow): DbResult => ({ data: row, error: null });

async function validBody(over: Record<string, unknown> = {}, locale = "pl") {
  install({});
  const consents = await getLaunchConsents(locale, session.client as unknown as Client);
  return {
    email: "Nowa.Osoba@Example.com", first_name: "Janina", locale, form: "hero",
    consent_terms: true, consent_marketing: true,
    consent_versions: { terms_privacy: consents.terms.version, marketing_email: consents.marketing.version },
    ...over,
  };
}

async function sectionD() {
  console.log("\nD. SIGNUP");
  const body = await validBody();

  // The five outcomes the database can have, one response.
  const outcomes: [string, SignupAnswerRow][] = [
    ["created", { status: "pending", created: true, send: true, token_id: "t-1", email: "nowa.osoba@example.com", locale: "pl", referral_code: "ABCD2345" }],
    // A repeat submit of a stored address gets a fresh ALIAS from the database
    // (review S1); a submit that stored nothing (throttled) gets no code.
    ["existing", { status: "pending", created: false, send: true, token_id: "t-2", email: "nowa.osoba@example.com", locale: "pl", referral_code: "ALZASXY2" }],
    ["confirmed", { status: "confirmed", created: false, send: false, token_id: null, locale: "pl", referral_code: "ZZZZ2345" }],
    ["throttled", { status: "pending", created: false, send: false, token_id: null, locale: "pl", throttled: true }],
    ["suppressed", { status: "pending", created: false, send: false, token_id: null, locale: "pl", referral_code: "SPRSD234" }],
  ];
  const shapes: string[] = [];
  const bodies: Record<string, Record<string, unknown>> = {};
  for (const [name, row] of outcomes) {
    install({ signup: answer(row) });
    const res = await signupPOST(request(SIGNUP, body));
    const out = await json(res);
    bodies[name] = out;
    shapes.push(JSON.stringify(shape(out)));
    check(`D1 ${name}: 200, check_inbox, no-store`, res.status === 200 && out.ok === true && out.state === "check_inbox"
      && res.headers.get("cache-control") === "no-store", out);
    const referral = out.referral as { code: string; url: string };
    check(`D2 ${name}: referral code shaped like a real one, url = absoluteUrl('/?ref_code=' + code)`,
      REFERRAL_CODE_RE.test(referral.code) && referral.url === `${SITE}/?ref_code=${referral.code}`, referral);
    check(`D3 ${name}: answer shaped like a real handle`, typeof out.answer === "string" && ANSWER_HANDLE_RE.test(out.answer as string));
    const args = session.rpcs("prelaunch_signup")[0]?.args ?? {};
    if (name === "created") {
      check("D4 created: the REAL code, and the handle whose hash the database stored",
        referral.code === "ABCD2345" && sha(out.answer as string) === args.p_answer_hash);
    } else if (row.referral_code) {
      check(`D5 ${name}: the code the database handed (its alias — a link that earns, review S1) and a DECOY handle (S7)`,
        referral.code === row.referral_code && sha(out.answer as string) !== args.p_answer_hash);
    } else {
      check(`D5 ${name}: nothing stored → a DECOY code and a DECOY handle`,
        REFERRAL_CODE_RE.test(referral.code) && sha(out.answer as string) !== args.p_answer_hash);
    }
    await flushAfter();
    const mailed = state.mails.length;
    const pinged = session.rpcs("enqueue_notification").length;
    const marked = session.rpcs("prelaunch_mark_sent");
    if (row.send) {
      check(`D6 ${name}: send → exactly one DOI mail, marked sent ok`, mailed === 1
        && marked.length === 1 && marked[0]!.args?.p_ok === true && marked[0]!.args?.p_token_id === row.token_id, { mailed, marked });
    } else {
      check(`D7 ${name}: no send → no mail, no mark_sent`, mailed === 0 && marked.length === 0, { mailed, marked: marked.length });
    }
    check(`D8 ${name}: the operator is pinged only for created && send (S8)`, pinged === (row.created && row.send ? 1 : 0), pinged);
  }
  check("D9 all five outcomes answer with a byte-identical SHAPE", new Set(shapes).size === 1, shapes);
  check("D10 the two decoy codes differ between submissions (not a constant)",
    (bodies.confirmed!.referral as { code: string }).code !== (bodies.suppressed!.referral as { code: string }).code);

  // The created path in detail.
  install({ signup: answer(outcomes[0]![1]) });
  state.cookies = new Map([["ecs_first_touch", "utm_source=newsletter&utm_medium=email&utm_campaign=start&ref=www.google.com&path=%2F"]]);
  const ip = nextIp();
  const res = await signupPOST(request(SIGNUP, { ...body, utm_source: "forged", ref_code: "abcd2345", company: "" }, { ip }));
  check("D11 the honest submission still answers 200", res.status === 200);
  const args = session.rpcs("prelaunch_signup")[0]?.args ?? {};
  check("D12 the address is normalised before the database sees it", args.p_email === "nowa.osoba@example.com");
  check("D13 first name, locale and form are passed as cleaned", args.p_first_name === "Janina" && args.p_locale === "pl" && args.p_form === "hero");
  check("D14 attribution comes from the httpOnly first-touch cookie, never the body",
    JSON.stringify(args.p_attr) === JSON.stringify({ utm_source: "newsletter", utm_medium: "email", utm_campaign: "start", referrer_host: "www.google.com", landing_path: "/" }), args.p_attr);
  check("D15 the referral code is upper-cased and passed when it is a code", args.p_ref_code === "ABCD2345");
  check("D16 the IP is a keyed hash: sha256('grovbase-prelaunch-ip:' + secret + ':' + ip)",
    args.p_ip_hash === sha(`grovbase-prelaunch-ip:${SERVER_KEY}:${ip}`), args.p_ip_hash);
  check("D17 the server token goes in p_token; the optin and answer hashes are 64-hex",
    typeof args.p_token === "string" && /^[0-9a-f]{64}$/.test(String(args.p_optin_hash)) && /^[0-9a-f]{64}$/.test(String(args.p_answer_hash)));
  const consents = await getLaunchConsents("pl", session.client as unknown as Client);
  check("D18 the consent records carry the SERVER's sentences and versions (+ the documents' versions)",
    JSON.stringify(args.p_consents) === JSON.stringify([
      { key: "terms_privacy", version: consents.terms.version, text: consents.terms.text },
      { key: "marketing_email", version: consents.marketing.version, text: consents.marketing.text },
    ]) && typeof args.p_doc_versions === "object", args.p_consents);
  await flushAfter();
  const mail = state.mails[0];
  const link = mail ? /href="(https:\/\/grovbase\.com\/potwierdz-zapis#t=[A-Za-z0-9_-]{43})"/.exec(mail.html)?.[1] : undefined;
  const raw = link?.split("#t=")[1] ?? "";
  check("D19 the DOI mail goes to the address, with the confirm link in the FRAGMENT", mail?.to === "nowa.osoba@example.com" && Boolean(link), mail?.html.slice(0, 200));
  check("D20 …and the link's token hashes to exactly the p_optin_hash the database stored", sha(raw) === args.p_optin_hash);
  check("D21 the DOI mail never carries the first name (S9)", Boolean(mail) && !mail!.html.includes("Janina") && !mail!.text.includes("Janina") && !mail!.subject.includes("Janina"));
  check("D22 the mailbox password comes from the Vault, as /api/waitlist reads it",
    JSON.stringify(state.transports[0] ?? {}).includes("vault-password"));
  check("D23 the link lifetime is the database's optin_ttl_hours", mail?.text.includes("48") === true);
  const ping = session.rpcs("enqueue_notification")[0]?.args?.p_payload as { rows?: [string, string][]; data?: Record<string, string> } | undefined;
  check("D24 the ping keeps the waitlist rows but has NO raw IP row and no {{ip}} (S8)",
    Boolean(ping) && ping!.rows!.some(([l]) => l === "📧 E-mail") && !ping!.rows!.some(([l, v]) => l === "📍 IP" || v.includes(ip))
    && !("ip" in (ping!.data ?? {})), ping);
  check("D25 the ping names the form and the campaign", ping?.rows?.some(([l, v]) => l === "🌍 Źródło" && v === "hero") === true
    && ping?.rows?.some(([l, v]) => l === "📣 Kampania" && v.includes("newsletter")) === true);
  state.cookies = new Map();

  // A published template cannot redirect the button, and cannot smuggle the name in.
  install({
    signup: answer(outcomes[0]![1]),
    published: { "waitlist.optin": {
      subject: "Hej {{first_name}}", heading: "H", body: "Cześć {{first_name}} — {{email}}",
      ctaLabel: "", ctaUrl: "https://evil.example/phish", footer: "F", showLogo: true, showFields: true, showCta: false,
    } },
  });
  await signupPOST(request(SIGNUP, body));
  await flushAfter();
  const forced = state.mails[0];
  check("D26 a published template's ctaUrl is overridden by the computed confirm link (renderAuthMail rule)",
    Boolean(forced) && !forced!.html.includes("evil.example") && /href="https:\/\/grovbase\.com\/potwierdz-zapis#t=/.test(forced!.html));
  check("D27 …its blank CTA label falls back to the built-in one, the button is shown even with showCta off",
    forced?.html.includes("Potwierdzam zapis") === true);
  check("D28 …and {{first_name}} renders EMPTY even when the template asks for it", Boolean(forced) && !forced!.html.includes("Janina") && !forced!.subject.includes("Janina"));
  const lookups = session.rpcs("message_template_lookup").map((c) => c.args?.p_event);
  check("D29 the Polish DOI is looked up as waitlist.optin", lookups.includes("waitlist.optin"), lookups);

  // Locale: German.
  const de = await validBody({}, "de");
  install({ signup: answer({ ...outcomes[0]![1], locale: "de" }) });
  await signupPOST(request(SIGNUP, de));
  await flushAfter();
  check("D30 a German signup gets waitlist.optin_de (its built-in default when unpublished)",
    session.rpcs("message_template_lookup").some((c) => c.args?.p_event === "waitlist.optin_de")
    && state.mails[0]?.subject === "Bestätige deine Anmeldung bei GrovBase", state.mails[0]?.subject);

  // Consent and validation refusals.
  install({ signup: answer(outcomes[0]![1]) });
  const changed = await signupPOST(request(SIGNUP, { ...body, consent_versions: { terms_privacy: "terms_privacy@000000000000", marketing_email: body.consent_versions.marketing_email } }));
  check("D31 a consent sentence that changed under the form → 409 consent_changed, nothing written",
    changed.status === 409 && (await json(changed)).error === "consent_changed" && session.rpcs("prelaunch_signup").length === 0);
  const noMarketing = await signupPOST(request(SIGNUP, { ...body, consent_marketing: false }));
  check("D32 a missing consent → 400 consent_required", noMarketing.status === 400 && (await json(noMarketing)).error === "consent_required");
  const stringTrue = await signupPOST(request(SIGNUP, { ...body, consent_terms: "true" }));
  check("D33 consent must be the boolean true, not a string", stringTrue.status === 400);
  const badMail = await signupPOST(request(SIGNUP, { ...body, email: "not-an-address" }));
  check("D34 an invalid address → 400 invalid_email", badMail.status === 400 && (await json(badMail)).error === "invalid_email");
  const noVersions = await signupPOST(request(SIGNUP, { ...body, consent_versions: undefined }));
  check("D35 no consent versions → 400 bad_request", noVersions.status === 400 && (await json(noVersions)).error === "bad_request");
  check("D36 none of these reached the database", session.rpcs("prelaunch_signup").length === 0);
  const badRef = await (async () => {
    install({ signup: answer(outcomes[0]![1]) });
    await signupPOST(request(SIGNUP, { ...body, ref_code: "IIII0000" }));
    return session.rpcs("prelaunch_signup")[0]?.args?.p_ref_code;
  })();
  check("D37 a referral code outside the alphabet is ignored, not an error", badRef === null);

  install({ signup: answer({ status: "invalid" }) });
  const dbInvalid = await signupPOST(request(SIGNUP, body));
  check("D38 the database's 'invalid' → 400 invalid_email", dbInvalid.status === 400 && (await json(dbInvalid)).error === "invalid_email");
  install({ signup: answer({ status: "consent_required" }) });
  const dbConsent = await signupPOST(request(SIGNUP, body));
  check("D39 the database's 'consent_required' → 400 consent_required", dbConsent.status === 400 && (await json(dbConsent)).error === "consent_required");
  install({ signup: { data: null, error: { message: "boom" } } });
  const dbError = await signupPOST(request(SIGNUP, body));
  check("D40 an RPC error → 500 generic", dbError.status === 500 && (await json(dbError)).error === "generic");

  // Honeypot.
  install({ signup: answer(outcomes[0]![1]) });
  const trap = await signupPOST(request(SIGNUP, { ...body, company: "ACME" }));
  const trapBody = await json(trap);
  check("D41 a filled honeypot gets the SAME shape as a real signup, and nothing is written or sent",
    trap.status === 200 && JSON.stringify(shape(trapBody)) === shapes[0] && session.rpcs().length === 0 && state.afterQueue.length === 0);

  // No server key: honest failure, nothing pretended.
  install({ signup: answer(outcomes[0]![1]) });
  delete process.env.GROVBASE_SERVER_KEY;
  const noKey = await signupPOST(request(SIGNUP, body));
  check("D42 without the server key: 500 generic (the database would refuse anyway), and the IP hash is null",
    noKey.status === 500 && prelaunchIpHash("198.51.100.1") === null);
  process.env.GROVBASE_SERVER_KEY = SERVER_KEY;
  check("D43 only GROVBASE_SERVER_KEY (no legacy 64-hex key) is enough for a non-null IP hash (S14)",
    !process.env.APP_ENCRYPTION_KEY && /^[0-9a-f]{64}$/.test(prelaunchIpHash("198.51.100.1") ?? "") && prelaunchIpHash("unknown") === null);

  // SMTP failure: mark_sent(false), and the log names neither the address nor the token.
  install({ signup: answer(outcomes[0]![1]) });
  await signupPOST(request(SIGNUP, body));
  const pending = state.afterQueue.splice(0);
  const logged: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => { logged.push(a.map(String).join(" ")); };
  try {
    state.smtpError = "550 5.1.1 <nowa.osoba@example.com>: Recipient address rejected (token AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd)";
    for (const fn of pending) await fn();
  } finally {
    console.error = original;
  }
  const marked = session.rpcs("prelaunch_mark_sent");
  check("D44 an SMTP failure is recorded as p_ok=false", marked.length === 1 && marked[0]!.args?.p_ok === false);
  check("D45 …and the log line carries no address and no token", logged.length > 0
    && logged.every((l) => !l.includes("@") && !/[A-Za-z0-9_-]{32,}/.test(l)), logged);
  check("D46 scrubForLog removes addresses and long tokens", scrubForLog("to a.b+c@x.pl t=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789") === "to [address] t=[redacted]");
  state.smtpError = null;

  // No mailbox: still marked (failed), nothing thrown.
  install({ signup: answer(outcomes[0]![1]), mailPayload: null });
  await signupPOST(request(SIGNUP, body));
  const silenced = console.error;
  console.error = () => undefined;
  try { await flushAfter(); } finally { console.error = silenced; }
  const unsent = session.rpcs("prelaunch_mark_sent");
  check("D47 no mailbox configured → no mail, marked p_ok=false", state.mails.length === 0 && unsent.length === 1 && unsent[0]!.args?.p_ok === false);

  check("D48 confirmLink/referralLink are absoluteUrl-built; the token is a fragment, the code a ref_code param",
    confirmLink("abc") === `${SITE}/potwierdz-zapis#t=abc` && referralLink("ABCD2345") === `${SITE}/?ref_code=ABCD2345`);
  install({});
  const rendered = await renderOptinMail(session.client as unknown as Client, { locale: "en", to: "x@y.pl", confirmUrl: "https://grovbase.com/potwierdz-zapis#t=T", expiresHours: 72 });
  check("D49 the English default DOI renders with its CTA and the lifetime",
    rendered?.subject === "Confirm your GrovBase signup" && rendered.html.includes("Confirm my signup") && rendered.text.includes("72"));
}

/* ── E ─────────────────────────────────────────────────────────────────── */

const RESEND = "/api/public/prelaunch/resend";

async function sectionE() {
  console.log("\nE. RESEND");
  const sent: DbResult = { data: { status: "sent", send: true, token_id: "r-1", email: "ola@example.com", locale: "en" }, error: null };
  const noop: DbResult = { data: { status: "noop", send: false, token_id: null, email: null, locale: "pl" }, error: null };
  const bodies: string[] = [];
  for (const [name, reply] of [["sent", sent], ["noop", noop]] as const) {
    install({ resend: reply });
    const res = await resendPOST(request(RESEND, { email: "Ola@Example.com" }));
    const text = await res.text();
    bodies.push(text);
    check(`E1 ${name}: 200 {ok:true}, no-store, no address in the body`, res.status === 200 && text === '{"ok":true}'
      && res.headers.get("cache-control") === "no-store");
    await flushAfter();
    check(`E2 ${name}: mail only when the database says send`, state.mails.length === (name === "sent" ? 1 : 0));
    if (name === "sent") {
      check("E3 the mail goes to the address the DATABASE returned, in its locale",
        state.mails[0]?.to === "ola@example.com" && state.mails[0]?.subject === "Confirm your GrovBase signup");
      const args = session.rpcs("prelaunch_resend")[0]?.args ?? {};
      check("E4 by e-mail: p_email normalised, p_old_hash null, fresh optin hash",
        args.p_email === "ola@example.com" && args.p_old_hash === null && /^[0-9a-f]{64}$/.test(String(args.p_optin_hash)));
    }
  }
  check("E5 sent and noop answer byte-for-byte the same", bodies[0] === bodies[1]);

  install({ resend: noop });
  const old = newDoiToken().raw;
  await resendPOST(request(RESEND, { token: old }));
  const args = session.rpcs("prelaunch_resend")[0]?.args ?? {};
  check("E6 by expired link: the OLD token's hash, never the token itself", args.p_old_hash === sha(old) && args.p_email === null
    && !JSON.stringify(args).includes(old));
  const both = await resendPOST(request(RESEND, { email: "a@b.pl", token: old }));
  const neither = await resendPOST(request(RESEND, {}));
  const badToken = await resendPOST(request(RESEND, { token: "short" }));
  const badEmail = await resendPOST(request(RESEND, { email: "nope" }));
  check("E7 both, neither, a malformed token → 400 bad_request; a bad address → 400 invalid_email",
    both.status === 400 && neither.status === 400 && badToken.status === 400 && badEmail.status === 400
    && (await json(badEmail)).error === "invalid_email");
  install({ resend: sent });
  const ip = nextIp();
  await resendPOST(request(RESEND, { email: "same@example.com" }, { ip }));
  const second = await resendPOST(request(RESEND, { email: "same@example.com" }, { ip }));
  check("E8 a double click: the second answers the same 200 and never reaches the database",
    second.status === 200 && (await second.text()) === '{"ok":true}' && session.rpcs("prelaunch_resend").length === 1);
  install({ resend: sent });
  const trap = await resendPOST(request(RESEND, { email: "a@b.pl", company: "x" }));
  check("E9 honeypot → the same 200, nothing called", trap.status === 200 && session.rpcs().length === 0);
}

/* ── F ─────────────────────────────────────────────────────────────────── */

const CONFIRM = "/api/public/prelaunch/confirm";

async function sectionF() {
  console.log("\nF. CONFIRM");
  const token = newDoiToken().raw;
  const confirmed: DbResult = { data: {
    status: "confirmed", email: "ola@example.com", first_name: "Ola", locale: "pl",
    referral_code: "ABCD2345", referral_counted: true, welcome: true,
  }, error: null };
  install({ confirm: confirmed, publicConfig: { referral_credits: 50, optin_ttl_hours: 72 } });
  const res = await confirmPOST(request(CONFIRM, { token }));
  const text = await res.text();
  const out = JSON.parse(text) as Record<string, unknown>;
  check("F1 confirmed: status, first name, referral {code,url}, the APPROVED referral credits",
    res.status === 200 && out.status === "confirmed" && out.first_name === "Ola"
    && JSON.stringify(out.referral) === JSON.stringify({ code: "ABCD2345", url: `${SITE}/?ref_code=ABCD2345` })
    && out.referral_credits === 50, out);
  check("F2 the response NEVER contains an '@' (the address stays on the server)", !text.includes("@"), text);
  check("F3 the token is hashed before the database sees it", session.rpcs("prelaunch_confirm")[0]?.args?.p_token_hash === sha(token));
  await flushAfter();
  check("F4 welcome → one welcome mail to the confirmed address, Polish copy",
    state.mails.length === 1 && state.mails[0]!.to === "ola@example.com" && state.mails[0]!.subject === "Jesteś na liście GrovBase 🚀");

  install({ confirm: { data: { ...(confirmed.data as object), welcome: false, status: "already" }, error: null }, publicConfig: { referral_credits: null } });
  const already = await json(await confirmPOST(request(CONFIRM, { token })));
  await flushAfter();
  check("F5 already confirmed: no second welcome; an unapproved Y is null", already.status === "already" && state.mails.length === 0
    && already.referral_credits === null);

  install({ confirm: confirmed, welcomePayload: null });
  await confirmPOST(request(CONFIRM, { token }));
  await flushAfter();
  check("F6 the welcome switch is off (no payload) → no welcome mail", state.mails.length === 0);

  install({ confirm: { data: { ...(confirmed.data as object), locale: "en" }, error: null } });
  await confirmPOST(request(CONFIRM, { token }));
  await flushAfter();
  check("F7 an English confirmation gets waitlist.confirmation_en (its default while unpublished)",
    session.rpcs("message_template_lookup").some((c) => c.args?.p_event === "waitlist.confirmation_en")
    && state.mails[0]?.subject === "You're on the GrovBase list 🚀", state.mails[0]?.subject);

  install({ confirm: { data: { ...(confirmed.data as object), first_name: "mail@me.pl" }, error: null } });
  const odd = await confirmPOST(request(CONFIRM, { token }));
  const oddText = await odd.text();
  check("F8 a 'first name' that is not a name is left out, so even then no '@' leaves", !oddText.includes("@") && !("first_name" in JSON.parse(oddText)));

  for (const status of ["expired", "invalid"] as const) {
    install({ confirm: { data: { status, email: "ola@example.com" }, error: null } });
    const r = await confirmPOST(request(CONFIRM, { token }));
    const t = await r.text();
    check(`F9 ${status}: exactly {ok, status} — no name, no code, no address`, t === JSON.stringify({ ok: true, status }), t);
  }
  install({ confirm: confirmed });
  const broken = await confirmPOST(request(CONFIRM, { token: "abc" }));
  check("F10 a string not shaped like a token → 200 invalid, without a database call",
    (await broken.text()) === JSON.stringify({ ok: true, status: "invalid" }) && session.rpcs("prelaunch_confirm").length === 0);
  const notString = await confirmPOST(request(CONFIRM, { token: 42 }));
  check("F11 no token at all → 400 bad_request", notString.status === 400);
  install({ confirm: { data: null, error: { message: "boom" } } });
  check("F12 an RPC error → 500 generic", (await confirmPOST(request(CONFIRM, { token }))).status === 500);
}

/* ── G ─────────────────────────────────────────────────────────────────── */

const CHANNEL = "/api/public/prelaunch/channel";

async function sectionG() {
  console.log("\nG. CHANNEL");
  const handle = newAnswerHandle().raw;
  const texts: string[] = [];
  for (const word of ["ok", "invalid", "expired"]) {
    install({ channel: { data: word, error: null } });
    const res = await channelPOST(request(CHANNEL, { answer: handle, channel: "allegro" }));
    texts.push(`${res.status}:${await res.text()}`);
  }
  check("G1 ok / invalid / expired all answer the same 200 {ok:true} (a decoy is no oracle)", new Set(texts).size === 1 && texts[0] === '200:{"ok":true}', texts);
  install({ channel: { data: "ok", error: null } });
  await channelPOST(request(CHANNEL, { answer: handle, channel: "own_store" }));
  const args = session.rpcs("prelaunch_set_channel")[0]?.args ?? {};
  check("G2 the handle is hashed; the channel passed as given", args.p_answer_hash === sha(handle) && args.p_channel === "own_store");
  const badChannel = await channelPOST(request(CHANNEL, { answer: handle, channel: "ebay" }));
  const badHandle = await channelPOST(request(CHANNEL, { answer: "x", channel: "allegro" }));
  check("G3 an unknown channel or a malformed handle → 400", badChannel.status === 400 && badHandle.status === 400);
  install({ channel: { data: null, error: { message: "boom" } } });
  check("G4 an RPC error → 500", (await channelPOST(request(CHANNEL, { answer: handle, channel: "multi" }))).status === 500);
}

/* ── H ─────────────────────────────────────────────────────────────────── */

async function sectionH() {
  console.log("\nH. /api/waitlist");
  const body = { email: "stary@example.com", locale: "pl", source: "newsletter", first_name: "Ewa", last_name: "Nowak" };
  install({ waitlist: { data: { status: "created", confirmation: false }, error: null } });
  const created = await (await waitlistPOST(request("/api/waitlist", body))).text();
  await flushAfter();
  const ping = session.rpcs("enqueue_notification")[0]?.args?.p_payload as { rows?: [string, string][] } | undefined;
  const firstKey = session.rpcs("enqueue_notification")[0]?.args?.p_dedupe;
  // Since 0144 the function answers alike for new and known addresses; an old
  // 'exists' (a function from before 0144) must still read as 'created'.
  install({ waitlist: { data: { status: "exists" }, error: null } });
  const exists = await (await waitlistPOST(request("/api/waitlist", body))).text();
  await flushAfter();
  check("H1 a known address answers byte-for-byte like a new one (no enumeration)", created === exists && exists === '{"ok":true,"status":"created"}', { created, exists });
  check("H2 …and is announced under the SAME per-address dedupe key (once in the outbox, however often typed)",
    typeof firstKey === "string" && session.rpcs("enqueue_notification")[0]?.args?.p_dedupe === firstKey);
  // No mail from this door any more (review S5): not even if a function from
  // before 0144 still said a confirmation was due.
  install({ waitlist: { data: { status: "created", confirmation: true }, error: null } });
  const mailsBefore = state.mails.length;
  await waitlistPOST(request("/api/waitlist", { ...body, email: "nowy.legacy@example.com" }));
  await flushAfter();
  check("H2b the legacy door sends no mail: no payload read, no delivery",
    state.mails.length === mailsBefore && session.rpcs("waitlist_confirmation_payload").length === 0);
  check("H3 the shared ping builder keeps this door's rows, the IP included",
    Boolean(ping) && ping!.rows!.some(([l]) => l === "📍 IP") && ping!.rows!.some(([l, v]) => l === "👤 Użytkownik" && v === "Ewa Nowak"));
}

/* ── I ─────────────────────────────────────────────────────────────────── */

const STORED = {
  v: 1, campaign: "prelaunch-2026", marketing_required: true, referral_requires_account: true, survey_bonus_policy: "stack",
  launch_at: null, launch_at_approved: false, signup_credits: null, signup_credits_approved: false,
  referral_credits: null, referral_credits_approved: false, referral_cap: 10,
  early_access_hours: 24, early_access_approved: false, price_lock_approved: false, rewards_active: false,
  optin_ttl_hours: 72, standard_credits: null, standard_credits_approved: false, optin_hourly_cap: 300, reward_claim_until: null,
};

const baseInput = () => ({
  launch: { date: "2027-01-15", time: "10:00", approved: true },
  signupCredits: { value: 100, approved: true },
  referralCredits: { value: 20, approved: false },
  standardCredits: { value: 25, approved: true },
  referralCap: 10,
  priceLockApproved: false,
  rewardsActive: false,
  rewardClaimUntil: { date: "", time: "" },
  optinTtlHours: 72,
  optinHourlyCap: 300,
});

async function sectionI() {
  console.log("\nI. CAMPAIGN SETTINGS");
  // Warsaw wall clock.
  const winter = warsawToInstant("2026-11-20", "10:00");
  const summer = warsawToInstant("2027-07-01", "10:00");
  check("I1 winter time is +01:00, summer +02:00", winter.ok && winter.iso === "2026-11-20T10:00:00+01:00" && Date.parse(winter.iso) === Date.UTC(2026, 10, 20, 9)
    && summer.ok && summer.iso === "2027-07-01T10:00:00+02:00", { winter, summer });
  const gap = warsawToInstant("2027-03-28", "02:30");
  const overlap = warsawToInstant("2026-10-25", "02:30");
  check("I2 the spring-forward gap does not exist (2027-03-28 02:30)", !gap.ok && gap.reason === "nonexistent", gap);
  check("I3 the fall-back hour happens twice (2026-10-25 02:30)", !overlap.ok && overlap.reason === "ambiguous", overlap);
  check("I4 the hours around the switch are fine", warsawToInstant("2027-03-28", "03:00").ok && warsawToInstant("2026-10-25", "03:00").ok
    && warsawToInstant("2027-03-28", "01:59").ok);
  check("I5 impossible dates and times are a format error",
    ["2026-02-30|10:00", "2026-13-01|10:00", "2026-11-20|24:00", "2026-11-20|9:00", "20-11-2026|10:00"]
      .every((x) => { const [d, t] = x.split("|"); const r = warsawToInstant(d!, t!); return !r.ok && r.reason === "format"; }));
  check("I6 an instant reads back as its Warsaw wall clock", JSON.stringify(instantToWarsaw("2026-11-20T09:00:00Z")) === JSON.stringify({ date: "2026-11-20", time: "10:00" }));

  // Pure validation.
  const NOW = Date.parse("2026-10-19T12:00:00Z");
  const ctx = (over: Partial<{ premiereActive: boolean; welcomeCredits: number | null; before: PrelaunchCampaignConfig }> = {}) => ({
    now: NOW, premiereActive: false, welcomeCredits: 25, before: parsePrelaunchCampaign(STORED), ...over,
  });
  const v = (input: unknown, c = ctx()) => validatePrelaunchCampaignInput(input, c);
  const ok = v(baseInput());
  check("I7 a sane set validates; launch_at stored as an ISO instant with offset", ok.ok && ok.config.launchAt === "2027-01-15T10:00:00+01:00");
  const field = (over: Record<string, unknown>) => { const r = v({ ...baseInput(), ...over }); return r.ok ? "ok" : `${r.field}:${r.reason}`; };
  check("I8 approving a past launch date → launch:past", field({ launch: { date: "2026-10-01", time: "10:00", approved: true } }) === "launch:past");
  check("I9 a past date NOT approved is fine (it shows nowhere)", field({ launch: { date: "2026-10-01", time: "10:00", approved: false } }) === "ok");
  check("I10 the already-approved, untouched date may have passed (saving another field after launch)",
    v({ ...baseInput(), launch: { date: "2026-10-01", time: "10:00", approved: true } },
      ctx({ before: parsePrelaunchCampaign({ ...STORED, launch_at: "2026-10-01T10:00:00+02:00", launch_at_approved: true }) })).ok);
  check("I11 a DST-gap launch → launch:nonexistent; an overlap → launch:ambiguous",
    field({ launch: { date: "2027-03-28", time: "02:30", approved: true } }) === "launch:nonexistent"
    && field({ launch: { date: "2026-10-25", time: "02:30", approved: false } }) === "launch:ambiguous");
  check("I12 approved without a date → launch:required", field({ launch: { date: "", time: "", approved: true } }) === "launch:required");
  check("I13 credits over 10 000 → range; approved empty or 0 → required",
    field({ signupCredits: { value: 10001, approved: false } }) === "signupCredits:range"
    && field({ referralCredits: { value: null, approved: true } }) === "referralCredits:required"
    && field({ standardCredits: { value: 0, approved: true } }) === "standardCredits:required"
    && field({ signupCredits: { value: 1.5, approved: false } }) === "signupCredits:range");
  check("I14 X must beat what an account gets at birth (D2): 25 approved → signupCredits:not_above_standard",
    field({ signupCredits: { value: 25, approved: true } }) === "signupCredits:not_above_standard"
    && field({ signupCredits: { value: 25, approved: false } }) === "ok");
  check("I15 referral cap 0..1000, link TTL 1..336 h, hourly cap 1..10 000",
    field({ referralCap: 1001 }) === "referralCap:range" && field({ referralCap: -1 }) === "referralCap:range"
    && field({ referralCap: 0 }) === "ok" && field({ optinTtlHours: 0 }) === "optinTtlHours:range"
    && field({ optinTtlHours: 337 }) === "optinTtlHours:range" && field({ optinHourlyCap: 0 }) === "optinHourlyCap:range"
    && field({ referralCap: Number.NaN }) === "referralCap:range");
  check("I16 the price lock cannot be switched ON while the premiere offer is off",
    field({ priceLockApproved: true }) === "priceLock:unsupported" && v({ ...baseInput(), priceLockApproved: true }, ctx({ premiereActive: true })).ok);
  check("I17 …but a lock already on may be kept (or turned off)",
    v({ ...baseInput(), priceLockApproved: true }, ctx({ before: parsePrelaunchCampaign({ ...STORED, price_lock_approved: true }) })).ok);
  check("I18 the claim deadline obeys the same DST rule", field({ rewardClaimUntil: { date: "2027-03-28", time: "02:15" } }) === "rewardClaimUntil:nonexistent");
  check("I19 early access is not editable: the stored hours/approval pass through untouched",
    ok.ok && ok.config.earlyAccessHours === 24 && ok.config.earlyAccessApproved === false);
  check("I20 garbage is refused, never coerced", !v(null).ok && !v({ ...baseInput(), launch: "tomorrow" }).ok && !v({ ...baseInput(), rewardsActive: "yes" }).ok);

  // The action.
  const settings = () => ({ [PRELAUNCH_SETTING_KEY]: { ...STORED }, user_defaults: { welcome_credits: 25 } });
  install({ settings: settings(), role: "user" });
  check("I21 a non-admin is refused", (await savePrelaunchCampaignAction(baseInput())).ok === false
    && session.froms("app_settings").length === 0);
  install({ settings: { user_defaults: { welcome_credits: 25 } } });
  const pending = await savePrelaunchCampaignAction(baseInput());
  check("I22 before 0144 (no row): migration_pending, nothing written", !pending.ok && pending.error === "migration_pending"
    && session.froms("app_settings").every((c) => c.op === "select"));
  install({ settings: settings() });
  const invalid = await savePrelaunchCampaignAction({ ...baseInput(), signupCredits: { value: 20, approved: true } });
  check("I23 an invalid field comes back named, nothing written", !invalid.ok && invalid.error === "invalid" && invalid.field === "signupCredits"
    && invalid.reason === "not_above_standard" && session.froms("app_settings").every((c) => c.op === "select"));

  install({ settings: settings() });
  const unconfirmed = await savePrelaunchCampaignAction({ ...baseInput(), rewardsActive: true });
  check("I24 switching rewards ON without the confirmation → confirm_required, nothing written",
    !unconfirmed.ok && unconfirmed.error === "confirm_required" && session.froms("app_settings").every((c) => c.op === "select"));
  install({ settings: settings() });
  const saved = await savePrelaunchCampaignAction({ ...baseInput(), rewardsActive: true, confirm: true });
  const update = session.froms("app_settings").find((c) => c.op === "update");
  const after = update?.payload as { value: Record<string, unknown> } | undefined;
  check("I25 with the confirmation: saved", saved.ok, saved);
  check("I26 an UPDATE of exactly the prelaunch row (never an upsert that could create a public row)",
    Boolean(update) && update!.filters.some(([op, col, val]) => op === "eq" && col === "key" && val === "prelaunch")
    && session.froms("app_settings").every((c) => c.op !== "upsert"));
  check("I27 the stored row: the panel's values replaced, the owner/legal keys kept as they were",
    after?.value.rewards_active === true && after.value.launch_at === "2027-01-15T10:00:00+01:00" && after.value.launch_at_approved === true
    && after.value.signup_credits === 100 && after.value.referral_credits_approved === false
    && after.value.campaign === "prelaunch-2026" && after.value.marketing_required === true && after.value.v === 1
    && after.value.referral_requires_account === true && after.value.survey_bonus_policy === "stack" && after.value.early_access_hours === 24, after?.value);
  const audit = session.froms("audit_logs")[0]?.payload as { action: string; before: Record<string, unknown>; after: Record<string, unknown> } | undefined;
  check("I28 audited before/after as admin.prelaunch_rewards_enabled",
    audit?.action === "admin.prelaunch_rewards_enabled" && audit.before.rewards_active === false && audit.after.rewards_active === true);
  check("I29 the public config tag and '/' are revalidated",
    state.revalidated.tags.includes("prelaunch-config") && state.revalidated.paths.includes("/"));

  install({ settings: { ...settings(), [PRELAUNCH_SETTING_KEY]: { ...STORED, rewards_active: true } } });
  const off = await savePrelaunchCampaignAction({ ...baseInput(), rewardsActive: false });
  const offAudit = session.froms("audit_logs")[0]?.payload as { action: string } | undefined;
  check("I30 switching rewards OFF needs no confirmation and is audited as disabled", off.ok && offAudit?.action === "admin.prelaunch_rewards_disabled");
  install({ settings: settings(), updateError: true });
  check("I31 a refused write is 'generic'", (await savePrelaunchCampaignAction(baseInput())).ok === false);

  // The panel read.
  install({ settings: { ...settings(), platform_access: { allow_signup: false } } });
  const panel = await prelaunchCampaignPanelAction();
  check("I32 the panel reads the private row with the admin's own session", panel?.installed === true && panel.config.referralCap === 10
    && panel.welcomeCredits === 25 && panel.earlyAccessSupported === false && panel.premiereActive === false
    && panel.platform?.allowSignup === false, panel);
  install({ settings: settings(), role: "user" });
  check("I33 …and a non-admin gets nothing", (await prelaunchCampaignPanelAction()) === null);

  // What the page will show, and the registration warnings.
  const cfg: PrelaunchCampaignConfig = {
    ...PRELAUNCH_DEFAULTS, launchAt: "2027-01-15T10:00:00+01:00", launchAtApproved: true,
    signupCredits: 100, signupCreditsApproved: true, referralCredits: 20, referralCreditsApproved: false,
    standardCredits: 25, standardCreditsApproved: true, priceLockApproved: true, earlyAccessHours: 24, earlyAccessApproved: true,
  };
  const keys = visibleValues(cfg, { now: NOW, premiereActive: false }).map((x) => x.key).join(",");
  check("I34 visible: the approved date, X and the standard figure — not the unapproved Y, not the lock (no premiere), never early access",
    keys === "date,credits,standard", keys);
  check("I35 a passed launch date is not visible", !visibleValues({ ...cfg, launchAt: "2026-10-01T10:00:00+02:00" }, { now: NOW, premiereActive: true })
    .some((x) => x.key === "date"));
  check("I36 warning: approved date but registration switched off", JSON.stringify(launchWarnings(cfg, { allowSignup: false, signupOpensAt: null }, NOW)) === '[{"kind":"signup_closed"}]');
  check("I37 warning: registration opening more than an hour from the launch",
    launchWarnings(cfg, { allowSignup: true, signupOpensAt: "2027-01-15T12:00:00+01:00" }, NOW)[0]?.kind === "signup_differs"
    && launchWarnings(cfg, { allowSignup: true, signupOpensAt: "2027-01-15T10:30:00+01:00" }, NOW).length === 0);
  check("I38 warning: registration already open while the launch is ahead",
    JSON.stringify(launchWarnings(cfg, { allowSignup: true, signupOpensAt: null }, NOW)) === '[{"kind":"signup_differs","opensAt":null}]');
  check("I39 no approved date, or one already passed → no warnings",
    launchWarnings({ ...cfg, launchAtApproved: false }, { allowSignup: false, signupOpensAt: null }, NOW).length === 0
    && launchWarnings({ ...cfg, launchAt: "2026-10-01T10:00:00+02:00" }, { allowSignup: true, signupOpensAt: null }, NOW).length === 0);
  const actionSrc = read("app/actions/prelaunch-admin.ts");
  check("I40 the action never writes platform_access", !/from\("app_settings"\)[\s\S]{0,80}platform_access/.test(actionSrc)
    && !/ACCESS_SETTINGS_KEY/.test(actionSrc));
}

/* ── J ─────────────────────────────────────────────────────────────────── */

async function sectionJ() {
  console.log("\nJ. THE GENERIC SETTINGS EDITOR");
  install({ settings: { prelaunch: { ...STORED } } });
  const r = await saveSettingAction(PRELAUNCH_SETTING_KEY, { rewards_active: true, signup_credits: 1000000 });
  check("J1 saveSettingAction refuses 'prelaunch' before reading or writing anything", !r.ok && session.log.length === 0);
  const page = read("app/admin/system/page.tsx");
  check("J2 /admin/system filters the row out of the raw editor", /\.filter\(\(s\) => s\.key !== PRELAUNCH_SETTING_KEY\)/.test(page));
}

/* ── K ─────────────────────────────────────────────────────────────────── */

async function sectionK() {
  console.log("\nK. CONTACT ERASURE");
  const id = "c0000000-0000-4000-8000-000000000001";
  install({});
  const r = await deleteContactAction(id);
  const order = session.log.map((e) => (e.kind === "rpc" ? `rpc:${e.call.fn}` : `${e.call.table}:${e.call.op}`));
  const forget = order.indexOf("rpc:prelaunch_forget_contact");
  const del = order.indexOf("newsletter_contacts:delete");
  check("K1 the pre-launch rows are scrubbed FIRST, then the contact is deleted", r.ok && forget >= 0 && del > forget, order);
  check("K2 forget is called with the contact id", session.rpcs("prelaunch_forget_contact")[0]?.args?.p_contact === id);
  install({ forgetError: true });
  const r2 = await deleteContactAction(id);
  check("K3 before 0144 (no function) the delete still goes ahead", r2.ok && session.froms("newsletter_contacts").some((c) => c.op === "delete"));
}

/* ── L ─────────────────────────────────────────────────────────────────── */

async function sectionL() {
  console.log("\nL. THE REWARDS HOOK");
  const ws = "w0000000-0000-4000-8000-000000000001";
  install({ publicConfig: { rewards_active: false }, reward: { data: { granted: 100 }, error: null } });
  await ensurePrelaunchRewards(session.client as unknown as Client, ws);
  check("L1 rewards off → no reward call at all (cached config decides)", session.rpcs("prelaunch_reward_ensure").length === 0);
  install({ publicConfig: { rewards_active: true }, reward: { data: { granted: 0, signup: 0, referrals: 0 }, error: null } });
  await ensurePrelaunchRewards(session.client as unknown as Client, ws);
  check("L2 rewards on, nothing owed → one call, no activity row", session.rpcs("prelaunch_reward_ensure").length === 1 && session.rpcs("log_activity").length === 0);
  install({ publicConfig: { rewards_active: true }, reward: { data: { granted: 120, signup: 100, referrals: 20 }, error: null } });
  await ensurePrelaunchRewards(session.client as unknown as Client, ws);
  const log = session.rpcs("log_activity")[0]?.args;
  check("L3 a grant → log_activity('prelaunch_reward.granted') on the layout's workspace, amounts only",
    log?.p_action === "prelaunch_reward.granted" && log.p_workspace_id === ws
    && JSON.stringify(log.p_metadata) === JSON.stringify({ granted: 120, signup: 100, referrals: 20 }), log);
  install({ publicConfig: { rewards_active: true } });
  (session.handlers as { rpc?: unknown }).rpc = () => { throw new Error("db down"); };
  const silenced = console.error;
  console.error = () => undefined;
  let threw = false;
  try { await ensurePrelaunchRewards(session.client as unknown as Client, ws); } catch { threw = true; } finally { console.error = silenced; }
  check("L4 a failure never reaches the render", !threw);
  const layout = read("app/(app)/layout.tsx");
  const guard = layout.indexOf("if (block.blocked)");
  const offer = layout.indexOf("await ensureOffer(");
  const hook = layout.indexOf("await ensurePrelaunchRewards(supabase, workspace.id)");
  check("L5 the layout calls it after the blocked guard, right after ensureOffer", guard > 0 && offer > guard && hook > offer && hook - offer < 900);
}

/* ── M ─────────────────────────────────────────────────────────────────── */

function flatten(node: unknown, prefix: string, out: Record<string, string>) {
  if (typeof node === "string") { out[prefix] = node; return; }
  if (node && typeof node === "object") for (const [k, v] of Object.entries(node as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
}

function sectionM() {
  console.log("\nM. TEMPLATES AND I18N");
  for (const key of ["waitlist.optin:email", "waitlist.optin_en:email", "waitlist.optin_de:email"]) {
    const e = catalogEntry(key);
    const def = defaultTemplate(key);
    check(`M1 ${key}: catalogued, app kind, NO delivery switch, no first_name placeholder, default with a CTA`,
      Boolean(e) && e!.kind === "app" && !e!.deliverySwitch && !e!.placeholders.includes("first_name")
      && e!.placeholders.includes("confirm_url") && def?.channel === "email" && def.email.showCta && !def.email.showFields
      && !/first_name/.test(JSON.stringify(def)));
  }
  for (const key of ["waitlist.confirmation_en:email", "waitlist.confirmation_de:email"]) {
    const e = catalogEntry(key);
    check(`M2 ${key}: the same delivery-switch semantics as waitlist.confirmation, with a default`,
      e?.deliverySwitch === true && JSON.stringify(e.placeholders) === JSON.stringify(catalogEntry("waitlist.confirmation:email")!.placeholders)
      && defaultTemplate(key)?.channel === "email");
  }
  check("M3 every wired app template still has a default", TEMPLATE_CATALOG.filter((e) => e.hooked && e.kind === "app").every((e) => defaultTemplate(e.key) !== null));

  // The keys this track uses, in the repo dictionaries — or, before the
  // integrator merges them, in the fragment named by PRELAUNCH_I18N_FRAGMENT.
  const dicts: Record<string, Record<string, string>> = {};
  const fragmentPath = process.env.PRELAUNCH_I18N_FRAGMENT;
  const fragment = fragmentPath && existsSync(fragmentPath) ? JSON.parse(read(fragmentPath)) as Record<string, unknown> : null;
  for (const loc of ["pl", "en", "de"]) {
    const out: Record<string, string> = {};
    flatten(JSON.parse(read(`lib/i18n/dictionaries/${loc}.json`)), "", out);
    if (fragment) flatten(fragment[loc], "", out);
    dicts[loc] = out;
  }
  const src = read("components/admin/prelaunch-campaign.tsx");
  const used = new Set([...src.matchAll(/"(admin\.prelaunch\.[A-Za-z0-9_.]+)"/g)].map((m) => m[1]!));
  // Keys built from a field name at runtime are listed literally in the maps,
  // so the regex above sees every one of them.
  const tplKeys = ["waitlist.optin:email", "waitlist.optin_en:email", "waitlist.optin_de:email", "waitlist.confirmation_en:email", "waitlist.confirmation_de:email"]
    .map((k) => catalogEntry(k)!.nameKey);
  const missing = [...used, ...tplKeys, "common.save", "common.cancel", "common.error"]
    .flatMap((k) => ["pl", "en", "de"].filter((l) => typeof dicts[l]![k] !== "string").map((l) => `${l}:${k}`));
  check(`M4 all ${used.size} admin.prelaunch keys the panel uses (+ template names) exist in pl, en and de`,
    missing.length === 0, missing.length ? `${missing.slice(0, 8).join(", ")} — merge the i18n fragment (or set PRELAUNCH_I18N_FRAGMENT)` : undefined);
  const ours = (l: string) => Object.keys(dicts[l]!).filter((k) => k.startsWith("admin.prelaunch.")).sort();
  check("M5 the three locales carry the same admin.prelaunch keys", ours("pl").join("|") === ours("en").join("|") && ours("en").join("|") === ours("de").join("|"));
  const dead = ours("pl").filter((k) => !used.has(k));
  check("M6 no dead admin.prelaunch keys", dead.length === 0, dead);
  const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  const drift = ours("pl").filter((k) => vars(dicts.pl![k]!) !== vars(dicts.en![k]!) || vars(dicts.pl![k]!) !== vars(dicts.de![k]!));
  check("M7 every placeholder exists in all three translations", drift.length === 0, drift);
}

async function main() {
  console.log("PRE-LAUNCH V2 — server track");
  sectionA();
  sectionB();
  await sectionC();
  await sectionD();
  await sectionE();
  await sectionF();
  await sectionG();
  await sectionH();
  await sectionI();
  await sectionJ();
  await sectionK();
  await sectionL();
  sectionM();
  console.log(failures === 0 ? `\nAll ${passes} pre-launch server tests passed.` : `\n${failures} FAILED (${passes} passed)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
