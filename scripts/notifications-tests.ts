/**
 * POWIADOMIENIA V2 — the rules the bell stands on, checked without a browser
 * or a database (the SQL side: scripts/notifications-sql-tests.sh).
 *
 *   A. one classification: the client's map IS the SQL map (0160)
 *   B. the customer's words: Polish, per tool, never a code or a provider
 *   C. links: internal paths and https only
 *   D. an admin's message: what may be saved
 *   E. the copy: every key in PL, EN and DE
 *   F. source guards: no producer writes the old raw rows, the badge is the
 *      important count, the bell is the only bell
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  NOTIFICATION_KINDS, notificationCategory, presentNotification, safeHref, parseBell, type BellNotification,
} from "../lib/notifications/catalog";
import { announcementState, validateAnnouncement, type AnnouncementDraft } from "../lib/notifications/announcement";
import { makeT } from "../lib/i18n/t";
import pl from "../lib/i18n/dictionaries/pl.json";
import en from "../lib/i18n/dictionaries/en.json";
import de from "../lib/i18n/dictionaries/de.json";

let failed = 0;
let passed = 0;
function section(title: string) { console.log(`\n${title}`); }
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

/* ── A ─────────────────────────────────────────────────────────────────── */
section("A. one classification");
const sql = read("supabase/migrations/0160_notifications_v2.sql");
const fn = sql.slice(sql.indexOf("create or replace function public.notification_category"), sql.indexOf("comment on function public.notification_category"));
const sqlImportant = new Set([...fn.matchAll(/when '([a-z_]+)'\s+then 'important'/g)].map((m) => m[1]));
const tsImportant = new Set(Object.entries(NOTIFICATION_KINDS).filter(([, v]) => v.category === "important").map(([k]) => k));
check("SQL and client agree on every important type",
  sqlImportant.size === tsImportant.size && [...sqlImportant].every((k) => tsImportant.has(k)),
  `sql=${[...sqlImportant].join(",")} ts=${[...tsImportant].join(",")}`);
check("the SQL default is activity", /else 'activity'/.test(fn));
check("generations are activity", notificationCategory("generation_done") === "activity" && notificationCategory("generation_failed") === "activity");
check("admin messages, payments, credits, replies are important",
  ["announcement", "payment_failed", "renewal_failed", "plan_expiring", "credits_granted", "credits_removed", "support_reply"]
    .every((k) => notificationCategory(k) === "important"));
check("an unknown type never lights the badge", notificationCategory("something_new") === "activity");

/* ── B ─────────────────────────────────────────────────────────────────── */
section("B. the customer's words");
const t = makeT(pl as Record<string, unknown>);
const row = (o: Partial<BellNotification>): BellNotification => ({
  id: "x", type: "generation_done", category: "activity", title: o.type ?? "generation_done", body: null, href: null,
  meta: {}, read_at: null, created_at: "2026-10-25T10:00:00Z", pinned: false, ...o,
});
const show = (o: Partial<BellNotification>) => presentNotification(row(o), t, "pl");
const FORBIDDEN = /provider_error|generation_failed|generation_done|thumbnail|ecommerce_|openai|gemini|google|fal\b|photoroom|stability|error_|stack|exception/i;
const texts: string[] = [];
const keep = (p: ReturnType<typeof show>) => { texts.push([p.title, p.body ?? "", p.cta ?? ""].join(" | ")); return p; };

const done = keep(show({ meta: { tool: "ecommerce_thumbnail", count: 1, job_id: "j" }, href: "/library?open=g1" }));
check("thumbnail ready: „Miniaturka gotowa”", done.title === "Miniaturka gotowa", done.title);
check("…„1 grafika · otwórz w Bibliotece”", done.body === "1 grafika · otwórz w Bibliotece", String(done.body));
check("…links to that result in the Library", done.link?.href === "/library?open=g1" && !done.link.external);
const four = keep(show({ meta: { tool: "retouch", count: 4 } }));
check("plural: 4 grafiki", four.body?.startsWith("4 grafiki") === true, String(four.body));
const five = keep(show({ meta: { tool: "prompts", count: 5 } }));
check("plural: 5 grafik", five.body?.startsWith("5 grafik ") === true, String(five.body));

const failRefund = keep(show({ type: "generation_failed", meta: { tool: "ecommerce_thumbnail", refunded: 10, charged: 10 } }));
check("failure: „Nie udało się wygenerować miniaturki”", failRefund.title === "Nie udało się wygenerować miniaturki", failRefund.title);
check("…refund stated with the real amount",
  failRefund.body === "Kredyty (10 kr.) wróciły na Twoje konto. Spróbuj ponownie lub użyj innego zdjęcia.", String(failRefund.body));
check("…links back to the tool to retry", failRefund.link?.href === "/k/ecommerce/thumbnail");
const failUnknown = keep(show({ type: "generation_failed", meta: { tool: "retouch" } }));
check("no confirmed refund → no refund promised", !/wróciły|zwrot/i.test(failUnknown.body ?? ""), String(failUnknown.body));
const failFree = keep(show({ type: "generation_failed", meta: { tool: "retouch", charged: 0 } }));
check("nothing charged → said honestly", /Nie pobraliśmy/.test(failFree.body ?? ""), String(failFree.body));

const legacyFail = keep(show({ type: "generation_failed", title: "generation_failed", body: "provider_error", href: "/history" }));
check("history: an old failure shows no code", !FORBIDDEN.test(`${legacyFail.title} ${legacyFail.body}`), `${legacyFail.title} ${legacyFail.body}`);
check("history: an old failure promises no refund", !/wróciły/.test(legacyFail.body ?? ""));
const legacyDone = keep(show({ title: "generation_done", body: "thumbnail ×1" }));
check("history: an old result recovers its count", legacyDone.body === "1 grafika · otwórz w Bibliotece", String(legacyDone.body));
const legacyModel = keep(show({ title: "generation_done", body: "Nano Banana Pro ×2" }));
check("history: an old result hides the model's name", !/Nano|Banana/.test(`${legacyModel.title} ${legacyModel.body}`));

const pay = keep(show({ type: "payment_failed", meta: { plan: "Pro" }, href: "/credits" }));
check("payment: „Płatność za plan Pro nie powiodła się”", pay.title === "Płatność za plan Pro nie powiodła się", pay.title);
check("…„Zaktualizuj płatność” to the billing screen", pay.cta === "Zaktualizuj płatność" && pay.link?.href === "/credits");
const renew = keep(show({ type: "renewal_failed", meta: { plan: "Starter" } }));
check("renewal: its own title", renew.title === "Nie udało się odnowić planu Starter", renew.title);
const expiring = keep(show({ type: "plan_expiring", meta: { plan: "Pro", ends_at: "2026-10-28T10:00:00Z" } }));
check("plan ending: plan and date", expiring.title.startsWith("Plan Pro wygaśnie ") && /2026/.test(expiring.title), expiring.title);

const refund = keep(show({ type: "credits_granted", meta: { amount: 50, kind: "refund", reason: "Awaria serwera" } }));
check("credits: the real change", refund.title === "Zwrot kredytów: +50 kr.", refund.title);
check("…and the reason", refund.body === "Powód: Awaria serwera", String(refund.body));
const removed = keep(show({ type: "credits_removed", meta: { amount: -20, kind: "admin_adjustment", reason: "Korekta" } }));
check("credits removed: signed", removed.title === "Korekta salda: -20 kr.", removed.title);
const legacyCredits = keep(show({ type: "credits_granted", body: "+25 · Bonus za ankietę" }));
check("history: credits from the old body", legacyCredits.title === "Korekta salda: +25 kr." && legacyCredits.body === "Powód: Bonus za ankietę",
  `${legacyCredits.title} | ${legacyCredits.body}`);
const reply = keep(show({ type: "support_reply", body: "Problem z fakturą", href: "/support?thread=abc" }));
check("support reply: title + its thread", reply.title === "Masz odpowiedź na zgłoszenie" && reply.link?.href === "/support?thread=abc");
const ann = show({ type: "announcement", title: "Nowa funkcja", body: "Sprawdź", meta: { cta_label: "Zobacz", cta_href: "/tools" } });
check("announcement: the admin's words and CTA", ann.title === "Nowa funkcja" && ann.cta === "Zobacz" && ann.link?.href === "/tools");
const annBad = show({ type: "announcement", title: "X", body: "Y", meta: { cta_label: "Klik", cta_href: "javascript:alert(1)" } });
check("announcement: a dangerous link is no link and no button", annBad.link === null && annBad.cta === null);
const unknown = keep(show({ type: "weird_event", title: "weird_event", body: "some_code" }));
check("unknown type: a neutral title, no code", unknown.title === "Powiadomienie" && unknown.body === null);
check("no presented text contains a code, a tool key or a provider",
  texts.every((s) => !FORBIDDEN.test(s)), texts.filter((s) => FORBIDDEN.test(s)).join(" || "));

for (const [name, dict] of [["EN", en], ["DE", de]] as const) {
  const tt = makeT(dict as Record<string, unknown>);
  const p = presentNotification(row({ meta: { tool: "ecommerce_thumbnail", count: 2 } }), tt, name.toLowerCase());
  check(`${name}: localised, not Polish`, p.title !== "Miniaturka gotowa" && !/grafik/.test(p.body ?? ""), `${p.title} | ${p.body}`);
}

const parsed = parseBell({ important: [{ id: "a", type: "announcement", created_at: "2026-10-25T00:00:00Z", pinned: true }], activity: "x", unread: 3.7, banner: null });
check("parseBell: defensive", parsed.important.length === 1 && parsed.activity.length === 0 && parsed.unread === 3 && parsed.banner === null);

/* ── C ─────────────────────────────────────────────────────────────────── */
section("C. links");
check("internal path", safeHref("/credits")?.external === false);
check("internal path with a query", safeHref("/library?open=1")?.href === "/library?open=1");
check("https opens outside", safeHref("https://grovbase.com/blog")?.external === true);
for (const bad of ["//evil.com", "/\\evil.com", "javascript:alert(1)", "data:text/html,x", "http://x.pl", "/a b", "credits", " ", "/x\u0000"]) {
  check(`refused: ${JSON.stringify(bad)}`, safeHref(bad) === null);
}

/* ── D ─────────────────────────────────────────────────────────────────── */
section("D. an admin's message");
const NOW = Date.parse("2026-10-25T12:00:00Z");
const base: AnnouncementDraft = {
  title: "Nowość", body: "Treść", ctaLabel: "", ctaHref: "", priority: "normal",
  audience: { kind: "all" }, mode: "now", publishAt: null, expiresAt: null,
};
const v = (p: Partial<AnnouncementDraft>) => validateAnnouncement({ ...base, ...p }, NOW);
check("a plain message is valid", v({}).length === 0);
check("title required", v({ title: "  " }).includes("title"));
check("title max 120", v({ title: "x".repeat(121) }).includes("title"));
check("body max 600", v({ body: "x".repeat(601) }).includes("body"));
check("CTA needs both label and link", v({ ctaLabel: "Klik" }).includes("cta_pair") && v({ ctaHref: "/x" }).includes("cta_pair"));
check("CTA link must be safe", v({ ctaLabel: "Klik", ctaHref: "javascript:x" }).includes("cta_href"));
check("plans need at least one", v({ audience: { kind: "plans", plan_ids: [] } }).includes("plans"));
check("plans need real ids", v({ audience: { kind: "plans", plan_ids: ["pro"] } }).includes("plans"));
check("one user needs an id", v({ audience: { kind: "user", user_id: "" } }).includes("user"));
check("schedule must be in the future", v({ mode: "schedule", publishAt: "2026-10-25T11:00:00Z" }).includes("publish_at"));
check("schedule in the future is fine", v({ mode: "schedule", publishAt: "2026-10-26T11:00:00Z" }).length === 0);
check("expiry after publication", v({ mode: "schedule", publishAt: "2026-10-26T11:00:00Z", expiresAt: "2026-10-26T10:00:00Z" }).includes("expires_at"));
check("states", announcementState({ status: "published", expires_at: null }, NOW) === "active"
  && announcementState({ status: "published", expires_at: "2026-10-24T00:00:00Z" }, NOW) === "expired"
  && announcementState({ status: "withdrawn", expires_at: null }, NOW) === "withdrawn"
  && announcementState({ status: "scheduled", expires_at: null }, NOW) === "scheduled"
  && announcementState({ status: "draft", expires_at: null }, NOW) === "draft");
check("the SQL refuses what the client refuses (CTA link rule present)", /cta_href ~ '\^\/\(\[\^\/\\\\\]\.\*\)\?\$'/.test(sql));

/* ── E ─────────────────────────────────────────────────────────────────── */
section("E. the copy");
const keys = (o: unknown, prefix = ""): string[] =>
  o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, val]) => keys(val, prefix ? `${prefix}.${k}` : k)) : [prefix];
const plV2 = keys((pl as { notif: { v2: unknown } }).notif.v2);
const plAnn = keys((pl as { comm: { ann: unknown } }).comm.ann);
for (const [name, dict] of [["EN", en], ["DE", de]] as const) {
  const d = dict as { notif: { v2: unknown }; comm: { ann: unknown; "tab.announcements"?: string } };
  const v2 = new Set(keys(d.notif.v2));
  const an = new Set(keys(d.comm.ann));
  check(`${name}: every bell key`, plV2.every((k) => v2.has(k)), plV2.filter((k) => !v2.has(k)).join(","));
  check(`${name}: every Komunikaty key`, plAnn.every((k) => an.has(k)), plAnn.filter((k) => !an.has(k)).join(","));
  check(`${name}: the tab`, typeof d.comm["tab.announcements"] === "string");
}

/* ── F ─────────────────────────────────────────────────────────────────── */
section("F. source guards");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(__dirname, "..", dir))) {
    const p = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(join(__dirname, "..", p)).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const sources = [...walk("app"), ...walk("lib"), ...walk("components")];
const rawGen = sources.filter((p) => /type:\s*"generation_(done|failed)"[\s\S]{0,80}title:\s*"generation_/.test(read(p)));
check("no producer writes the old raw generation rows", rawGen.length === 0, rawGen.join(","));
const producers = ["lib/server/generation.ts", "lib/server/thumbnail/run.ts", "lib/server/engine/workflow.ts"];
check("every generation producer goes through the shared helper",
  producers.every((p) => /notifyGenerationDone/.test(read(p)) && /notifyGenerationFailed/.test(read(p))));
const helper = read("lib/server/user-notifications.ts");
check("a refund is claimed only from the ledger", /status === "refunded" && ev\.refund_tx_id/.test(helper));
check("each generation notice is deduplicated per job", /generation_done:\$\{input\.jobId\}/.test(helper) && /generation_failed:\$\{input\.jobId\}/.test(helper));
const layout = read("app/(app)/layout.tsx");
check("the app layout reads the bell through the RPC", /readBell\(supabase\)/.test(layout) && !/from\("notifications"\)/.test(layout));
const bell = read("components/layout/notifications-bell.tsx");
check("the badge is the important count", /bell\.unread > 9 \? "9\+" : String\(bell\.unread\)/.test(bell));
check("opening the bell no longer marks everything read", !/markNotificationsReadAction/.test(bell));
const bells = sources.filter((p) => /export function NotificationsBell/.test(read(p)));
check("one bell component", bells.length === 1, bells.join(","));
const store = read("lib/notifications/bell-store.ts");
check("one refresh loop: 60 s + tab return", /POLL_MS = 60_000/.test(store) && /visibilitychange/.test(store));
check("the server render never reads the shared module state (no cross-user leak)",
  /if \(typeof window === "undefined"\) return;/.test(store) && /\(\) => initial \?\? EMPTY_BELL\)/.test(store));
const actions = read("app/actions/notifications.ts");
check("mark/dismiss act only on the caller's rows", (actions.match(/\.eq\("user_id", s\.userId\)/g) ?? []).length >= 4);
const annActions = read("app/actions/announcements.ts");
check("every announcement action re-checks the admin", (annActions.match(/await requireAdmin\(\)/g) ?? []).length >= 5);
check("every announcement write is audited", (annActions.match(/logAudit\(/g) ?? []).length >= 3);
const toast = read("components/layout/generation-toast.tsx");
check("toast: only results that arrive during the visit", /seen\.current === null/.test(toast));
check("toast: not on the tool's own panel", /pathname === panel \|\| pathname\.startsWith/.test(toast));
check("toast: its baseline is the page's own server copy (a refresh never re-toasts)", /useBell\(initial\)/.test(toast) && /<GenerationToast initial=\{bell\} \/>/.test(layout));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
