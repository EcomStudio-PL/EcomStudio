/**
 * NEWSLETTER — THE MODULE'S STRUCTURAL INVARIANTS.
 *
 * Nine screens, one worker, one public exit and three dictionaries were built
 * by separate hands against one brief. Nothing here talks to a browser or a
 * database: these are assertions about the REPOSITORY, which is the only place
 * the whole module is visible at once, and every one of them is a failure that
 * ships silently if nobody looks.
 *
 * Why each section exists — the failure it is standing in front of:
 *
 *   A. NAVIGATION. A menu entry is the only way into a module that has no other
 *      entrance. It is also where the product's shape is declared: Poczta and
 *      Newsletter share a transport and nothing else, and the moment they sit
 *      in one group an operator starts sending campaigns from the mailbox
 *      screen. That is a product decision, so it is pinned like one.
 *   B. ROUTES. A sub-nav tab whose href has no page.tsx behind it is a 404 that
 *      only appears when somebody clicks the ninth tab. admin-ia-tests runs
 *      exactly this check over the main menu; the newsletter has its own nav
 *      config, so it needs its own copy.
 *   C. PERMISSIONS. RLS is the lock and it holds on its own — every newsletter
 *      table answers is_admin(). These checks are about the DOOR: the layout
 *      that turns "a screen full of zeroes" into "you are not supposed to be
 *      here", and the server actions, which are POST endpoints with public URLs
 *      whether or not a menu links to them. One exported action that forgets
 *      requireAdmin is a write path with no door at all, and it is invisible in
 *      review because the other forty have one.
 *   D. I18N. t() falls back to a humanised label for a missing key, which is
 *      the right thing to show a user and exactly the wrong thing for us: the
 *      typo stops being visible. The repo's i18n-check sweeps the whole app but
 *      only sees double-quoted keys; this sweeps the module in every quote
 *      style the code actually uses.
 *   E. NO FAKE DATA. PROD has zero rows in payments and subscriptions. "0 zł"
 *      in a revenue tile is not a small number, it is a fabricated one, and an
 *      operator reads it as "the newsletter earns nothing" rather than "billing
 *      is not connected yet".
 *   F. HONESTY. This transport learns that a mail server answered 250 OK and
 *      nothing after that — no bounce webhook, no delivery receipt. A column
 *      headed "Dostarczone" would be a claim the product cannot support, and it
 *      is the kind of wording that arrives one commit at a time.
 *   G. THE WORKER IS ISOLATED. Behind that endpoint is a bulk mailing, and mail
 *      cannot be recalled. A GET or an ambient-session path means a prefetch,
 *      an image tag or a link scanner can start one.
 *   H. ONE-CLICK UNSUBSCRIBE. List-Unsubscribe plus List-Unsubscribe-Post is a
 *      promise to Gmail and Apple Mail that a POST to that URL — no cookies, no
 *      page, no human — performs the unsubscribe (RFC 8058). If the URL resolves
 *      to something that cannot answer POST, the promise is a lie, the provider
 *      stops trusting the header, the native button disappears and the
 *      recipient's remaining exit is the spam button. So the URL is traced from
 *      the header that carries it to the file that serves it.
 *
 * Run: npm run test:newsletterui
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { ADMIN_NAV } from "@/lib/navigation";
import {
  AB_METRICS, AUTOMATION_TRIGGERS, BLOCK_TYPES, CAMPAIGN_KINDS, CAMPAIGN_STATUSES,
  EVENT_TYPES, SEGMENT_FIELDS, SUPPRESSION_REASONS,
} from "@/lib/newsletter";
import plDict from "@/lib/i18n/dictionaries/pl.json";
import enDict from "@/lib/i18n/dictionaries/en.json";
import deDict from "@/lib/i18n/dictionaries/de.json";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`  ok   ${name}`); return; }
  failures += 1;
  console.error(`  FAIL ${name}${detail !== undefined && detail !== "" ? ` — ${detail}` : ""}`);
}

const ROOT = process.cwd();
const read = (path: string) => readFileSync(`${ROOT}/${path}`, "utf8");
const exists = (path: string) => existsSync(`${ROOT}/${path}`);

/* ── THE MODULE, NAMED ONCE ───────────────────────────────────────────────── */

/** Every directory a user-facing newsletter string can live in. The public
 *  unsubscribe page is in here because it is the one screen of this module a
 *  non-admin ever sees, which makes a raw key there the most expensive one. */
const UI_DIRS = [
  "app/admin/newsletter",
  "components/admin/newsletter",
  "app/wypisz-sie",
] as const;

const NAV_FILE = "components/admin/newsletter/nav.tsx";
const LAYOUT_FILE = "app/admin/newsletter/layout.tsx";
const WORKER_ROUTE = "app/api/newsletter/worker/route.ts";
const MAILER_FILE = "lib/server/mailer.ts";
const SEND_FILE = "lib/server/newsletter/worker.ts";
const CRON_MAIL = "app/api/cron/mail/route.ts";
const ACTION_FILES = ["app/actions/newsletter.ts", "app/actions/newsletter-ai.ts"] as const;

function walk(dir: string, out: string[] = []): string[] {
  if (!exists(dir)) return out;
  for (const entry of readdirSync(`${ROOT}/${dir}`)) {
    const full = `${dir}/${entry}`;
    if (statSync(`${ROOT}/${full}`).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const UI_FILES = UI_DIRS.flatMap((dir) => walk(dir));

/**
 * Source with its commentary removed.
 *
 * EVERY PROSE CHECK BELOW NEEDS THIS, because the comments in this module are
 * mostly ABOUT the words that must not appear: kpi.tsx explains at length why
 * there is no "Dostarczone" tile and no "0 zł". Matching on the raw file would
 * fail the module for documenting its own rule, which teaches the next author
 * to delete the explanation rather than keep the rule.
 *
 * Block comments go first so that a JSX `{/* … *\/}` — which starts mid-line
 * after the indent and would survive a line-oriented strip — is gone too. Then
 * whole lines whose first non-space character is `//` or a JSDoc `*`. A `//`
 * that appears mid-line is deliberately LEFT ALONE: the only thing that reliably
 * looks like one there is the `//` in a URL, and eating the rest of that line
 * would turn this into a check that passes by not looking.
 */
function decomment(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

/**
 * A file's CODE. Every structural check below reads through this rather than
 * through `read`, and the reason is specific to this repository: the module
 * documents its rules at length, in the file the rule is about, naming the
 * thing that must not be there. app/api/newsletter/worker/route.ts writes out
 * "export async function GET" in order to say it does not exist; kpi.tsx
 * discusses "0 zł" for eight lines; app/actions/newsletter.ts mentions
 * `requireAdmin` in prose next to functions that must call it. Matched raw,
 * every one of those is either a false failure or — worse, in the
 * `requireAdmin` case — a false PASS, where a mention in a comment satisfies a
 * check about a call.
 */
const code = (path: string) => decomment(read(path));

/* ═══════════════════════════════════════════════════════════════════════════ */
console.log("A. THE MODULE HAS ONE DOOR, AND IT IS NOT NEXT TO THE MAILBOX");

const groupOf = (href: string) => ADMIN_NAV.find((g) => g.items.some((i) => i.href === href));
const newsletterGroup = groupOf("/admin/newsletter");
const mailboxGroup = groupOf("/admin/communication");
const newsletterItem = newsletterGroup?.items.find((i) => i.href === "/admin/newsletter");

check("ADMIN_NAV carries /admin/newsletter, spelled exactly", newsletterItem !== undefined,
  ADMIN_NAV.flatMap((g) => g.items.map((i) => i.href)).filter((h) => h.includes("newsletter")).join(", "));
check("…exactly once — two entries is two answers to 'where is it'",
  ADMIN_NAV.flatMap((g) => g.items).filter((i) => i.href === "/admin/newsletter").length === 1);
check("the entry lands on a real screen", exists("app/admin/newsletter/page.tsx"));

// The product decision, pinned. Poczta is the inbox and the messages the app
// sends because something happened; this is campaigns written to a list.
check("the mailbox entry is still where it was", mailboxGroup !== undefined);
check("Newsletter is NOT in the same group as Poczta",
  newsletterGroup !== undefined && mailboxGroup !== undefined
  && newsletterGroup.key !== mailboxGroup.key,
  `newsletter=${newsletterGroup?.key ?? "—"} poczta=${mailboxGroup?.key ?? "—"}`);

type DictNode = { [key: string]: string | DictNode };
const DICTS: readonly { name: string; dict: DictNode }[] = [
  { name: "pl", dict: plDict as unknown as DictNode },
  { name: "en", dict: enDict as unknown as DictNode },
  { name: "de", dict: deDict as unknown as DictNode },
];

/**
 * Mirrors lookup() in lib/i18n/t.ts, INCLUDING flat dotted keys.
 *
 * This is not pedantry: the whole `newsletter` namespace is written flat —
 * `{"newsletter": {"nav.dashboard": "Pulpit"}}` — so a naive
 * `dict.newsletter.nav.dashboard` walk reports all 519 keys missing and every
 * check below passes for the wrong reason, or fails for one.
 */
function has(dict: DictNode, key: string): boolean {
  const parts = key.split(".");
  let node: string | DictNode | undefined = dict;
  for (let i = 0; i < parts.length; i++) {
    if (!node || typeof node !== "object") return false;
    if (typeof node[parts.slice(i).join(".")] === "string") return true;
    node = node[parts[i]];
  }
  return typeof node === "string";
}

for (const { name, dict } of DICTS) {
  check(`${name}: admin.nav.${newsletterItem?.key ?? "newsletter"} is translated`,
    has(dict, `admin.nav.${newsletterItem?.key ?? "newsletter"}`));
}

/* ═══════════════════════════════════════════════════════════════════════════ */
console.log("\nB. EVERY TAB IN THE SUB-NAV OPENS SOMETHING");

const navSource = code(NAV_FILE);
const navHrefs = [...navSource.matchAll(/href[:=]\s*"(\/[^"]*)"/g)].map((m) => m[1]);

check("the sub-nav declares its destinations as literals", navHrefs.length > 0,
  "no href: \"…\" found — the extraction below would pass by finding nothing");
check("nine tabs, the nine screens the brief asked for", navHrefs.length === 9,
  String(navHrefs.length));
check("no tab is declared twice", new Set(navHrefs).size === navHrefs.length, navHrefs.join(" "));

for (const href of navHrefs) {
  const file = `app${href.split("?")[0]}/page.tsx`;
  check(`${href} exists`, exists(file), file);
  // A tab pointing at a redirect stub is a 404 with extra steps: the operator
  // lands somewhere else and the tab they pressed is no longer selected.
  if (exists(file)) {
    const src = code(file);
    check(`${href} is a real screen, not a redirect`,
      !(/^import \{ redirect \} from "next\/navigation";/m.test(src) && /redirect\("/.test(src)));
  }
}

/**
 * THE TAB LABELS, WHICH NO OTHER CHECK CAN SEE.
 *
 * nav.tsx renders `t(\`newsletter.nav.${tab.key}\`)`. That is an interpolated
 * call, so scripts/i18n-check.mjs counts it and moves on, and section D below
 * only looks at literals. A missing one does not throw — t() humanises the key
 * — so the tab quietly reads "Suppressions" in a Polish panel. The keys are
 * reconstructed from the TABS literal, which is the one place they are static.
 */
const navKeys = [...navSource.matchAll(/key:\s*"([A-Za-z][\w]*)"/g)].map((m) => m[1]);
check("the tab keys were found in the source", navKeys.length === navHrefs.length,
  navKeys.join(" "));
for (const { name, dict } of DICTS) {
  const missing = navKeys.filter((key) => !has(dict, `newsletter.nav.${key}`));
  check(`${name}: every tab label is translated`, missing.length === 0, missing.join(", "));
  // "Więcej" is the overflow button on a phone; it is the one label that is not
  // a tab, so it is the one nobody remembers to translate.
  check(`${name}: the phone overflow button is translated`, has(dict, "newsletter.nav.more"));
}

/* ═══════════════════════════════════════════════════════════════════════════ */
console.log("\nC. THE DOOR IS LOCKED IN FRONT OF THE LOCK");

const layout = code(LAYOUT_FILE);
check("the shell reads the caller's role from profiles",
  /\.from\("profiles"\)/.test(layout) && /select\("role"\)/.test(layout));
check("…and turns anything but admin away",
  /role\s*!==\s*"admin"/.test(layout) && /redirect\(/.test(layout));
check("…and a signed-out visitor never reaches the role query",
  /if\s*\(!user\)\s*redirect\(/.test(layout));

/**
 * EVERY EXPORTED ACTION, NOT MOST OF THEM.
 *
 * A "use server" export is a POST endpoint with a public, stable URL. The menu
 * does not gate it, the layout does not gate it, and RLS gates the READS but
 * not the RPCs these call through SECURITY DEFINER. requireAdmin is the only
 * thing between an authenticated non-admin and, say, cancelCampaignAction.
 *
 * Bodies are sliced between consecutive top-level `export async function`
 * declarations, so a helper defined between two actions counts as part of the
 * action above it — which is correct: that is the code that runs.
 */
for (const file of ACTION_FILES) {
  const src = code(file);
  check(`${file}: defines requireAdmin`, /async function requireAdmin\(/.test(src));
  check(`${file}: requireAdmin actually checks the role, not just the session`,
    /auth\.getUser\(\)/.test(src) && /\.from\("profiles"\)/.test(src)
    && /role\s*!==\s*"admin"/.test(src));

  const heads = [...src.matchAll(/^export async function ([A-Za-z0-9_]+)/gm)];
  check(`${file}: exported actions were found`, heads.length > 0, String(heads.length));
  const naked: string[] = [];
  for (const [i, head] of heads.entries()) {
    const from = head.index ?? 0;
    const to = i + 1 < heads.length ? heads[i + 1].index ?? src.length : src.length;
    if (!src.slice(from, to).includes("requireAdmin(")) naked.push(head[1]);
  }
  check(`${file}: all ${heads.length} exported actions call requireAdmin`,
    naked.length === 0, naked.join(", "));
}

/* ═══════════════════════════════════════════════════════════════════════════ */
console.log("\nD. NO RAW KEY REACHES A SCREEN");

/** Both quote styles plus a backtick with nothing interpolated. The module uses
 *  all three, and i18n-check only sees the first. */
const KEY_CALL = /\bt\(\s*(["'`])(newsletter\.[A-Za-z][\w.]*)\1/g;

const usedKeys = new Map<string, string>();
for (const file of UI_FILES) {
  for (const m of code(file).matchAll(KEY_CALL)) {
    if (!usedKeys.has(m[2])) usedKeys.set(m[2], file);
  }
}
check("the module's screens were found and scanned", UI_FILES.length > 0, String(UI_FILES.length));
check("literal newsletter.* keys were found", usedKeys.size > 0, String(usedKeys.size));

/**
 * KEYS STILL WAITING TO BE MERGED.
 *
 * Three agents cannot edit one JSON file at once without corrupting it, so this
 * module's convention is that an author who needs a new key writes it to
 * `i18n-add.<label>.json` at the repo root — `{ "pl": {…}, "en": {…}, "de": {…} }`
 * — and uses it in code as though it already existed. Those files are merged
 * into the dictionaries centrally and then deleted.
 *
 * A key that is DECLARED in one of them is not a defect; it is a key in transit,
 * and failing the module for it would mean the test can only be green when no
 * work is in flight. A key declared NOWHERE still fails, which is the case worth
 * catching — t() humanises it, so "newsletter.ab.noWinnerYet" reaches a Polish
 * operator as "No Winner Yet" and nothing throws.
 *
 * THE COUNT IS PRINTED, AND THAT IS THE POINT: a staging file that is never
 * merged ships exactly the raw key this section exists to prevent, so the run
 * says out loud how many keys are still only promised.
 */
function pendingKeys(): Map<string, string> {
  const pending = new Map<string, string>();
  for (const entry of readdirSync(ROOT)) {
    if (!/^i18n-add\..+\.json$/.test(entry)) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(read(entry)); } catch { continue; }
    if (!parsed || typeof parsed !== "object") continue;
    const byLocale = parsed as Record<string, unknown>;
    const locales = DICTS.map(({ name }) => byLocale[name]);
    // Only a key present in ALL THREE counts. One locale on its own is the
    // drift that makes a German panel fall back to Polish.
    if (!locales.every((node) => node && typeof node === "object")) continue;
    const [first, ...rest] = locales as Record<string, unknown>[];
    for (const key of Object.keys(first)) {
      if (rest.every((node) => typeof node[key] === "string")
        && typeof first[key] === "string") pending.set(key, entry);
    }
  }
  return pending;
}

const pending = pendingKeys();
for (const { name, dict } of DICTS) {
  const missing = [...usedKeys].filter(([key]) => !has(dict, key) && !pending.has(key));
  check(`${name}: all ${usedKeys.size} literal keys are declared`, missing.length === 0,
    missing.map(([key, file]) => `${key} (${file})`).join(", "));
}

const awaiting = [...usedKeys].filter(([key]) => pending.has(key));
if (awaiting.length > 0) {
  console.log(`  note ${awaiting.length} key(s) still awaiting the central merge: `
    + awaiting.map(([key]) => `${key} → ${pending.get(key)}`).join(", "));
}

/**
 * THE KEYS NO STATIC SWEEP CAN SEE, CHECKED FROM THE OTHER END.
 *
 * Most of this module's labels are looked up by interpolation — the campaign
 * list renders t(`newsletter.status.${campaign.status}`), the timeline renders
 * t(`newsletter.event.${event.type}`), and there are 55 such calls. Nothing
 * above catches them, scripts/i18n-check.mjs counts them and moves on, and t()
 * does not throw: a missing one renders as a humanised key, so an operator on a
 * Polish panel sees "Complained" next to nine Polish words and the only person
 * who notices is a customer.
 *
 * They cannot be read from the call sites, but they do not need to be: the set
 * of values each one can take is a const tuple in lib/newsletter.ts, which is
 * also what the database column is constrained to. So the check runs from the
 * domain instead of from the source, and it is stronger for it — a NEW status
 * added to CAMPAIGN_STATUSES fails here on the commit that adds it, rather than
 * on the first campaign that reaches that state.
 */
const ENUM_KEYS: readonly [string, readonly string[]][] = [
  ["newsletter.status", CAMPAIGN_STATUSES],
  ["newsletter.kind", CAMPAIGN_KINDS],
  ["newsletter.reason", SUPPRESSION_REASONS],
  ["newsletter.event", EVENT_TYPES],
  ["newsletter.trigger", AUTOMATION_TRIGGERS],
  ["newsletter.block", BLOCK_TYPES],
  ["newsletter.ab.metric", AB_METRICS],
  ["newsletter.segment.field", SEGMENT_FIELDS],
];
for (const [prefix, members] of ENUM_KEYS) {
  check(`${prefix}.* has members to check`, members.length > 0);
  for (const { name, dict } of DICTS) {
    const missing = members.filter((m) => !has(dict, `${prefix}.${m}`) && !pending.has(`${prefix}.${m}`));
    check(`${name}: all ${members.length} ${prefix}.* labels exist`, missing.length === 0,
      missing.join(", "));
  }
}

// The four keys the honesty rules are made of. Named individually so that
// deleting the rule cannot look like a passing test.
for (const key of ["newsletter.noSalesData", "newsletter.noSalesDataHint",
  "newsletter.openRateNote", "newsletter.acceptedNote", "newsletter.kpi.accepted"]) {
  for (const { name, dict } of DICTS) {
    check(`${name}: ${key} ships`, has(dict, key));
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
console.log("\nE. NOTHING IS INVENTED WHERE NOTHING WAS MEASURED");

/**
 * `0 zł`, `0,00 zł`, `0 PLN` — a currency amount whose value is the literal
 * zero. A formatted amount from a real row goes through formatPrice(), so
 * anything matching this was typed by hand.
 *
 * THE LEADING `[^\d.,]` IS THE WHOLE PRECISION OF THIS PATTERN: without it
 * "120 zł" and "10 000 zł" are violations, because they end in a zero.
 *
 * THE TRAILING GUARD IS A LOOKAHEAD, NOT `\b`, AND THAT IS NOT A STYLE CHOICE.
 * `\b` is defined against ASCII `\w`, so after the `ł` of "zł" — a non-word
 * character followed, in `value="0 zł"`, by another non-word character — there
 * is no boundary and the match fails. The first version of this check ended in
 * `\b` and therefore fired on "0 PLN" and never once on "0 zł", which is the
 * literal the brief actually names and the one a Polish panel would contain.
 * It passed. `(?!\p{L})` asks the question that was meant: is the currency
 * token followed by more letters (as in "zloty"), or has it ended?
 */
const ZERO_MONEY = /(?:^|[^\d.,])0(?:[.,]0+)?\s*(?:zł|zl|PLN)(?!\p{L})/iu;

const moneyOffenders: string[] = [];
for (const file of UI_FILES) {
  for (const [i, line] of code(file).split("\n").entries()) {
    if (ZERO_MONEY.test(line)) moneyOffenders.push(`${file}:${i + 1}`);
  }
}
check("no hardcoded zero-revenue literal anywhere in the module",
  moneyOffenders.length === 0, moneyOffenders.join(", "));

/**
 * AND THE DASHBOARD SAYS THE HONEST THING INSTEAD.
 *
 * Checked across the dashboard AND the newsletter components it renders,
 * because the empty state deliberately lives in kpi.tsx so that the two screens
 * that raise the subject cannot word it differently. Asserting only on
 * dashboard.tsx would force the copy back inline to satisfy a test.
 */
const DASHBOARD = "components/admin/newsletter/dashboard.tsx";
const dashboardSource = read(DASHBOARD);
const dashboardTree = new Set<string>([DASHBOARD]);
for (const m of dashboardSource.matchAll(/from "@\/components\/admin\/newsletter\/([\w-]+)"/g)) {
  const file = `components/admin/newsletter/${m[1]}.tsx`;
  if (exists(file)) dashboardTree.add(file);
}
const dashboardText = [...dashboardTree].map((f) => read(f)).join("\n");
check("the dashboard reaches the 'no sales data' state",
  dashboardText.includes("newsletter.noSalesData"),
  [...dashboardTree].join(", "));
check("…and its hint, so the tile explains itself",
  dashboardText.includes("newsletter.noSalesDataHint"));
check("the dashboard's revenue branches on whether a payments system exists",
  /hasSalesData/.test(dashboardText));

// A rate with a zero denominator is unknown, not 0%. The helpers return
// null / "—" precisely so that stays impossible; using them is the check.
check("rates go through rate()/formatRate() rather than being divided inline",
  dashboardText.includes("formatRate(") && dashboardText.includes("rate("));

/* ═══════════════════════════════════════════════════════════════════════════ */
console.log("\nF. THE MODULE DOES NOT CLAIM A DELIVERY IT CANNOT SEE");

/** Polish stem, English word, German word. The stem matters: "dostarczono",
 *  "dostarczone" and "dostarczonych" are the same claim. */
const DELIVERY_CLAIM = /dostarczon|delivered|zugestellt/i;

const claimOffenders: string[] = [];
for (const file of UI_FILES) {
  for (const [i, line] of code(file).split("\n").entries()) {
    if (DELIVERY_CLAIM.test(line)) claimOffenders.push(`${file}:${i + 1} ${line.trim()}`);
  }
}
check("no screen in the module says 'delivered' about a send",
  claimOffenders.length === 0, claimOffenders.join(" | "));

/**
 * AND THE SAME SWEEP OVER THE DICTIONARIES, WHICH IS WHERE THE WORDS REALLY ARE.
 *
 * The screens hold keys; the sentences an operator reads are in the JSON. A
 * check that only looked at the .tsx files would be satisfied by
 * t("newsletter.kpi.accepted") while pl.json translated that key as
 * "Dostarczone" — which is precisely how the wrong word gets in, since nobody
 * reviewing a dictionary diff has the tile in front of them.
 */
function stringsUnder(node: string | DictNode | undefined, path: string,
  out: [string, string][] = []): [string, string][] {
  if (typeof node === "string") { out.push([path, node]); return out; }
  if (!node || typeof node !== "object") return out;
  for (const [key, value] of Object.entries(node)) stringsUnder(value, `${path}.${key}`, out);
  return out;
}
for (const { name, dict } of DICTS) {
  const strings = stringsUnder(dict.newsletter, "newsletter");
  check(`${name}: the newsletter namespace was found`, strings.length > 0, String(strings.length));
  const bad = strings.filter(([, value]) => DELIVERY_CLAIM.test(value));
  check(`${name}: no translation promises delivery`, bad.length === 0,
    bad.map(([key, value]) => `${key}="${value}"`).join(", "));
}

// The positive half: the honest word is present and qualified. A module that
// simply removed the tile would pass every check above.
check("the accepted-count tile exists", usedKeys.has("newsletter.kpi.accepted"));
check("…and is qualified wherever it appears",
  usedKeys.has("newsletter.acceptedNote"),
  "the tile is allowed to exist only because the caveat is next to it");
check("open rate carries its approximation note", usedKeys.has("newsletter.openRateNote"));

/* ═══════════════════════════════════════════════════════════════════════════ */
console.log("\nG. THE SEND TRIGGER HAS NO DOOR A BROWSER CAN OPEN");

/**
 * DECOMMENTED FIRST, AND EVERY CHECK IN THIS SECTION READS THE STRIPPED COPY.
 *
 * The route's own doc comment is forty lines explaining why there is no GET and
 * no session path — it names `export async function GET` and `is_admin()` in
 * order to say they are absent. Matching the raw file would fail the module for
 * carrying its rationale, which trains the next author to delete the rationale
 * rather than keep the rule. Same reasoning as sections E and F.
 */
const worker = code(WORKER_ROUTE);
check("the worker route exports POST", /export\s+async\s+function\s+POST\b/.test(worker));
check("…and does not export GET at all",
  !/export\s+(?:async\s+)?(?:function\s+GET\b|const\s+GET\b)/.test(worker),
  "a GET here is reachable by a prefetch, a link scanner or an <img src>");
check("…nor any other browser-navigable verb",
  !/export\s+(?:async\s+)?(?:function|const)\s+(?:HEAD|OPTIONS)\b/.test(worker));

/**
 * NO SESSION PATH IN. Checked by what the file is allowed to reach for, not by
 * reading its prose: a cookie-backed client, a getUser() call or an is_admin()
 * probe are the three shapes an ambient-session check takes here, and any of
 * them means an admin's browser can be made to start a bulk mailing by a page
 * it merely opens.
 */
check("the worker never builds a cookie-backed Supabase client",
  !worker.includes("@/lib/supabase/server"));
check("…never reads an ambient user", !/auth\.getUser\(/.test(worker));
check("…never touches cookies", !/\bcookies\(/.test(worker));
check("…and does not fall back to an is_admin() probe", !/is_admin/.test(worker));
check("the two credentials it does accept are server-held secrets",
  /CRON_SECRET/.test(worker) && /dispatchToken\(/.test(worker));
check("…compared in constant time", /timingSafeEqual/.test(worker));

/**
 * AND THE MAIL CRON IS UNCHANGED WITH RESPECT TO THE NEWSLETTER.
 *
 * /api/cron/mail accepts a GET with either a bearer secret or an ambient admin
 * session, which is defensible for polling a mailbox. The moment it imports
 * anything from lib/server/newsletter, that looser door is in front of a bulk
 * send — the exact arrangement section G exists to prevent, arrived at through
 * the back.
 */
const cron = code(CRON_MAIL);
const cronImports = [...cron.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
check("the mail cron imports nothing from lib/server/newsletter",
  !cronImports.some((spec) => /newsletter/i.test(spec)),
  cronImports.filter((spec) => /newsletter/i.test(spec)).join(", "));
check("…and does not reach the worker by URL either",
  !/api\/newsletter/.test(cron));

/* ═══════════════════════════════════════════════════════════════════════════ */
console.log("\nH. THE ADDRESS IN List-Unsubscribe CAN ACTUALLY BE POSTED TO");

const mailer = code(MAILER_FILE);
check("the transport sends List-Unsubscribe from the caller's url",
  /"List-Unsubscribe":\s*`<\$\{message\.unsubscribeUrl\}>`/.test(mailer));
check("…together with List-Unsubscribe-Post: One-Click",
  /"List-Unsubscribe-Post":\s*"List-Unsubscribe=One-Click"/.test(mailer),
  "without this pair the header is a link, not a promise — and the check below would be moot");

/**
 * THE TRACE. The header value is whatever the sender passes as `unsubscribeUrl`,
 * so the URL is read out of the send path rather than hardcoded here: a future
 * change of address fails this test instead of silently pointing the header at
 * a page.
 */
const sendPath = code(SEND_FILE);
const built = /unsubscribeUrl\s*=\s*`\$\{[A-Za-z_][\w]*\}(\/[^`]*)`/.exec(sendPath);
check("the unsubscribe url is built in the send path", built !== null,
  "no `${ORIGIN}/…` template found in lib/server/newsletter/worker.ts");

if (built) {
  const segments = built[1].split("/").filter(Boolean);
  check("…on this origin, not a third party", !built[1].startsWith("//"), built[1]);

  /** Resolve a URL path to the file that serves it. A segment carrying a
   *  template expression is a dynamic one, and the directory that answers it is
   *  whichever `[…]` folder sits there — the parameter's NAME is the route's
   *  business, not this test's. */
  let dir = "app";
  let resolved = true;
  for (const segment of segments) {
    const dynamic = segment.includes("${");
    if (!dynamic) {
      dir = `${dir}/${segment}`;
      if (!exists(dir)) { resolved = false; break; }
      continue;
    }
    const slots = exists(dir)
      ? readdirSync(`${ROOT}/${dir}`).filter((e) =>
        /^\[.+\]$/.test(e) && statSync(`${ROOT}/${dir}/${e}`).isDirectory())
      : [];
    if (slots.length !== 1) { resolved = false; break; }
    dir = `${dir}/${slots[0]}`;
  }

  check(`the header's url resolves to a route directory (${built[1]})`, resolved, dir);

  if (resolved) {
    const handler = `${dir}/route.ts`;
    const page = `${dir}/page.tsx`;
    check(`${handler} exists`, exists(handler),
      "a page.tsx cannot export POST — if this is a page, one-click is broken");
    check("…and it is a route handler, not a page", !exists(page));

    if (exists(handler)) {
      const source = code(handler);
      check("the unsubscribe url exports POST", /export\s+async\s+function\s+POST\b/.test(source));
      // A mail client shows "couldn't unsubscribe" on a non-2xx, and some then
      // offer the spam button instead. The route answers 200 whatever happened.
      check("…and answers 200 to the mail client whatever happened",
        /status:\s*200/.test(source) && !/status:\s*(?:401|403|404|500)/.test(source));
      // GET is the human's path — the visible footer link — and it must land on
      // a page rather than performing the write a second time.
      check("…while GET sends a person to a readable page",
        /export\s+async\s+function\s+GET\b/.test(source) && /redirect\(/.test(source));
      const humanPage = /\/wypisz-sie\//.test(source);
      check("…which exists", !humanPage || exists("app/wypisz-sie/[token]/page.tsx"));
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
console.log(failures === 0
  ? "\nAll newsletter UI tests passed."
  : `\n${failures} newsletter UI check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
