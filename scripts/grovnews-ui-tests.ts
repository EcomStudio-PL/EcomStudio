/**
 * GROVNEWS — CLIENT PAGE + ADMIN PULPIT.
 *
 *   npm run test:grovnewsui
 *
 * The real pages (/grovnews, /grovnews/[slug]) and the real reader render
 * against a FAKE Supabase client (rpc + from recorder): no database, no
 * Stripe, no network. The request scope (client, dictionary, admin check) is
 * swapped by scripts/stubs/grovnews-ui-env.ts in this test's esbuild command.
 *
 * S1  no access → "Kup dostęp" to the existing /checkout?kind=grovnews, and no
 *     post / edition query at all (nothing premium in the HTML)
 * S2  PAID → "Zarządzaj subskrypcją" → /settings?tab=subscriptions#grovnews
 * S3  LAUNCH_BONUS → the bonus end date (or "no time limit")
 * S4  ADMIN without entitlement → no checkout wall, the feed
 * S5  the price shown = the offer config through formatMoney
 * S6  the page never starts a subscription itself (only the existing checkout)
 * plus: category filter validation, empty state, topic anchors, the Pulpit's
 * health summary / verdict / unknown-cost rules, and the active-subscriber fix.
 */
import fs from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import GrovNewsPage from "@/app/(app)/grovnews/page";
import GrovNewsArticlePage from "@/app/(app)/grovnews/[slug]/page";
import { ContentBlocks, GrovNewsFeed, topicAnchor } from "@/components/grovnews/reader";
import { parseContent } from "@/lib/grovnews";
import { formatMoney, formatWarsawDate, parseGrovNewsState } from "@/lib/grovnews-billing";
import {
  adminStats, adminToday, grovnewsAccessView, pickCategory, sourceErrorBucket, summarizeSourceHealth,
  type CategoryRow, type FeedPost,
} from "@/lib/services/grovnews";
import { dashboardVerdict, type DashboardSettings } from "@/components/admin/grovnews/dashboard-data";
import { aiCostLabel, formatUsdMicros, GrovNewsEconomicsPanel } from "@/components/admin/grovnews/dashboard";
import type { GrovNewsEconomics } from "@/lib/services/api-economics";
import type { Client } from "@/lib/services/workspace";
import { makeT } from "@/lib/i18n/t";
import pl from "@/lib/i18n/dictionaries/pl.json";
import en from "@/lib/i18n/dictionaries/en.json";
import de from "@/lib/i18n/dictionaries/de.json";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : `\n       ${detail}`}`);
}
const section = (s: string) => console.log(`\n${s}`);
const read = (p: string) => fs.readFileSync(p, "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const t = makeT(pl);

/* ── a fake Supabase client that records every query ───────────────────────── */

type Op = [string, ...unknown[]];
type Query = { table: string; ops: Op[] };
type Result = { data: unknown; count?: number | null; error?: unknown };
type Table = unknown[] | ((q: Query) => Result);

function fakeDb(rpc: Record<string, unknown>, tables: Record<string, Table> = {}) {
  const log = { rpc: [] as string[], from: [] as Query[] };
  const run = (q: Query): Result => {
    const src = tables[q.table];
    if (typeof src === "function") return src(q);
    let rows = [...(src ?? [])];
    const head = q.ops.some(([op, , opts]) => op === "select" && (opts as { head?: boolean } | undefined)?.head === true);
    const count = rows.length;
    const range = q.ops.find(([op]) => op === "range");
    if (range) rows = rows.slice(Number(range[1]), Number(range[2]) + 1);
    if (q.ops.some(([op]) => op === "maybeSingle")) return { data: rows[0] ?? null, count, error: null };
    return { data: head ? null : rows, count, error: null };
  };
  const builder = (q: Query): unknown => {
    const proxy: unknown = new Proxy({}, {
      get(_, prop) {
        if (prop === "then") {
          return (ok: (v: Result) => unknown, bad: (e: unknown) => unknown) => Promise.resolve().then(() => run(q)).then(ok, bad);
        }
        return (...args: unknown[]) => { q.ops.push([String(prop), ...args]); return proxy; };
      },
    });
    return proxy;
  };
  const client = {
    rpc: async (name: string) => { log.rpc.push(name); return { data: rpc[name] ?? null, error: null }; },
    from: (table: string) => { const q: Query = { table, ops: [] }; log.from.push(q); return builder(q); },
  };
  return { client, log };
}

const env = (client: unknown, admin: boolean) => {
  (globalThis as unknown as { __grovnewsUi: { client: unknown; admin: boolean } }).__grovnewsUi = { client, admin };
};

const SECRET = "TAJNY-NAGLOWEK-PREMIUM";
const CATS: CategoryRow[] = [
  { id: "c-ai", slug: "ai", name: "Sztuczna inteligencja", sort_order: 1, is_active: true },
  { id: "c-law", slug: "prawo", name: "Prawo testowe", sort_order: 2, is_active: true },
  { id: "c-old", slug: "stara", name: "Stara kategoria", sort_order: 3, is_active: false },
];
const post = (slug: string, sources = 2) => ({
  id: `p-${slug}`, slug, title: `${SECRET} ${slug}`, excerpt: "Lead wpisu.", cover_url: null,
  published_at: "2026-09-26T05:00:00Z", estimated_read_minutes: 4, category: { slug: "ai", name: "Sztuczna inteligencja" },
  sources: Array.from({ length: sources }, (_, i) => ({ url: `https://example.com/${i}`, title: `Źródło ${i}` })),
  content: "## 1. Temat\n\nTreść.", tags: [],
});
const OFFER = { available: true, price_cents: 2900, currency: "PLN" };
const noAccessState = { access: false, sources: [], offer: OFFER, paid: null, launch: null };
const tablesWith = (posts: unknown[]) => ({ grovnews_posts: posts, grovnews_categories: CATS });
const noParams = { searchParams: Promise.resolve({}) };
const postQueries = (log: { from: Query[] }) => log.from.filter((q) => q.table === "grovnews_posts");

async function feedHtml(rpc: Record<string, unknown>, admin: boolean, params: Record<string, string> = {}, posts: unknown[] = [post("a"), post("b")]) {
  const db = fakeDb({ grovnews_launch_ensure: { status: "noop" }, ...rpc }, tablesWith(posts));
  env(db.client, admin);
  const html = renderToStaticMarkup(await GrovNewsPage({ searchParams: Promise.resolve(params) }));
  return { html, log: db.log };
}

async function main() {
  /* ── S1 ───────────────────────────────────────────────────────────────── */
  section("S1. NO ACCESS — the premium hero, the existing checkout, and no post query");
  {
    const { html, log } = await feedHtml({ grovnews_has_access: false, grovnews_my_state: noAccessState, grovnews_offer: OFFER }, false);
    check("S1 locked view rendered", html.includes("data-grovnews-locked"));
    check("S1 'Kup dostęp' CTA → /checkout?kind=grovnews", html.includes('href="/checkout?kind=grovnews"') && html.includes(pl.grovnews.hero.cta));
    check("S1 hero copy + the five ✓ points", html.includes(pl.grovnews.hero.title)
      && ["marketplace", "ai", "law", "trade", "digest"].every((k) => html.includes((pl.grovnews.hero.points as Record<string, string>)[k])));
    check("S1 no grovnews_posts query and no edition RPC", postQueries(log).length === 0 && !log.rpc.includes("grovnews_current_edition"),
      JSON.stringify({ from: log.from.map((q) => q.table), rpc: log.rpc }));
    check("S1 the launch claim ran before access was asked", log.rpc.indexOf("grovnews_launch_ensure") === 0
      && log.rpc.indexOf("grovnews_launch_ensure") < log.rpc.indexOf("grovnews_has_access"));
    check("S1 locked view reveals no post data (title, count, category chips)", !html.includes(SECRET) && !html.includes("data-grovnews-card")
      && !html.includes("data-grovnews-filter") && !html.includes("Źródła: "));

    const soon = await feedHtml({ grovnews_has_access: false, grovnews_my_state: noAccessState, grovnews_offer: { available: false } }, false);
    check("S1b sales off → honest 'soon', no checkout link", soon.html.includes("data-grovnews-soon") && !soon.html.includes("/checkout?kind=grovnews")
      && soon.html.includes(pl.grovnews.lockedSoon));

    const pastDue = await feedHtml({
      grovnews_has_access: false, grovnews_offer: OFFER,
      grovnews_my_state: { ...noAccessState, paid: { status: "past_due", live: true, has_access: false, price_cents: 2900, currency: "PLN" } },
    }, false);
    check("S1c a live subscription without access (payment failed) → manage it, never a second purchase",
      pastDue.html.includes("data-grovnews-manage") && pastDue.html.includes('href="/settings?tab=subscriptions#grovnews"')
      && !pastDue.html.includes("/checkout?kind=grovnews"));

    const db = fakeDb({ grovnews_has_access: false, grovnews_my_state: noAccessState, grovnews_offer: OFFER }, tablesWith([post("a")]));
    env(db.client, false);
    const art = renderToStaticMarkup(await GrovNewsArticlePage({ params: Promise.resolve({ slug: "a" }) }));
    check("S1d a direct article link without access → locked, the post is never read",
      art.includes("data-grovnews-locked") && postQueries(db.log).length === 0 && !art.includes(SECRET));
  }

  /* ── S2 ───────────────────────────────────────────────────────────────── */
  section("S2. PAID — the active card and the way to manage the subscription");
  {
    const paidState = {
      access: true, sources: [], offer: OFFER, launch: null,
      paid: { status: "active", live: true, has_access: true, price_cents: 1990, currency: "PLN",
        current_period_end: "2026-10-26T10:00:00Z", paid_through: "2026-10-26T10:00:00Z", cancel_at_period_end: false },
    };
    const { html, log } = await feedHtml({ grovnews_has_access: true, grovnews_my_state: paidState }, false);
    check("S2 card 'GrovNews Premium ● Aktywny', type PAID", html.includes('data-grovnews-access="PAID"')
      && html.includes(pl.grovnews.status.title) && html.includes(pl.grovnews.status.active) && html.includes(pl.grovnews.status.kind.PAID));
    check("S2 'Zarządzaj subskrypcją' → /settings?tab=subscriptions#grovnews",
      html.includes('href="/settings?tab=subscriptions#grovnews"') && html.includes(pl.grovnews.status.manage));
    check("S2 the subscriber's OWN price (19,90 zł, not the 29,00 offer) and the next renewal date",
      html.includes(formatMoney(1990, "PLN", "pl")) && !html.includes(formatMoney(2900, "PLN", "pl"))
      && html.includes(formatWarsawDate("2026-10-26T10:00:00Z", "pl")));
    check("S2 no buy CTA for a subscriber", !html.includes("/checkout?kind=grovnews"));
    check("S2 the feed is read (PUBLISHED only) and the edition asked for", postQueries(log).length === 1 && log.rpc.includes("grovnews_current_edition")
      && postQueries(log)[0].ops.some(([op, col, v]) => op === "eq" && col === "status" && v === "PUBLISHED"));
    check("S2 cards: category, headline, lead, 'Źródła: 2', read time, 'Czytaj'", html.includes("data-grovnews-card=\"a\"")
      && html.includes("Źródła: 2") && html.includes(pl.grovnews.card.read) && html.includes("4 min czytania"));

    const cancelling = grovnewsAccessView(parseGrovNewsState({ ...paidState, paid: { ...paidState.paid, cancel_at_period_end: true } }), false);
    check("S2b cancelling → no renewal, access until paid_through", cancelling?.kind === "PAID" && cancelling.renewsOn === null
      && cancelling.endsOn === "2026-10-26T10:00:00Z");
  }

  /* ── S3 ───────────────────────────────────────────────────────────────── */
  section("S3. LAUNCH BONUS — access until the bonus date, no buy button");
  {
    const until = "2026-12-31T12:00:00Z";
    const state = { access: true, sources: ["LAUNCH_BONUS"], offer: OFFER, paid: null,
      launch: { access_granted: true, access_expires_at: until, forever: false } };
    const { html } = await feedHtml({ grovnews_has_access: true, grovnews_my_state: state }, false);
    check("S3 type LAUNCH BONUS with its end date", html.includes('data-grovnews-access="LAUNCH_BONUS"')
      && html.includes(pl.grovnews.status.kind.LAUNCH_BONUS) && html.includes(formatWarsawDate(until, "pl")));
    check("S3 no checkout wall, no manage-subscription link", !html.includes("/checkout?kind=grovnews") && !html.includes("data-grovnews-manage"));
    const forever = grovnewsAccessView(parseGrovNewsState({ ...state, launch: { access_granted: true, access_expires_at: null, forever: true } }), false);
    check("S3b a forever bonus → 'bez limitu', no invented date", forever?.forever === true && forever.until === null);
    const promo = grovnewsAccessView(parseGrovNewsState({ ...state, sources: ["PROMO", "ADMIN_GRANT"], launch: null }), false);
    check("S3c PROMO first, ADMIN_GRANT beside it, no guessed end date", promo?.kind === "PROMO" && promo.also.join() === "ADMIN_GRANT"
      && promo.until === null && !promo.forever);
  }

  /* ── S4 ───────────────────────────────────────────────────────────────── */
  section("S4. ADMIN without an entitlement — reads, no checkout wall");
  {
    const { html, log } = await feedHtml({ grovnews_has_access: false, grovnews_my_state: noAccessState }, true);
    check("S4 no locked view, card type ADMIN", !html.includes("data-grovnews-locked") && html.includes('data-grovnews-access="ADMIN"'));
    check("S4 no checkout link", !html.includes("/checkout?kind=grovnews"));
    check("S4 the feed is read", postQueries(log).length === 1 && html.includes("data-grovnews-feed"));
    check("S4 no access and not admin → no card at all (view is null)", grovnewsAccessView(parseGrovNewsState(noAccessState), false) === null);
  }

  /* ── S5 ───────────────────────────────────────────────────────────────── */
  section("S5. PRICE — exactly the offer config through formatMoney");
  {
    for (const cents of [2900, 1999]) {
      const { html } = await feedHtml({ grovnews_has_access: false, grovnews_my_state: noAccessState,
        grovnews_offer: { available: true, price_cents: cents, currency: "PLN" } }, false);
      const shown = /data-grovnews-price="true">([^<]+)</.exec(html)?.[1] ?? /data-grovnews-price[^>]*>([^<]+)</.exec(html)?.[1];
      check(`S5 ${cents} grosze → "${formatMoney(cents, "PLN", "pl")}"`, shown === formatMoney(cents, "PLN", "pl"), String(shown));
    }
  }

  /* ── S6 ───────────────────────────────────────────────────────────────── */
  section("S6. NO NEW PURCHASE PATH — the page only links to the existing checkout");
  {
    const files = ["app/(app)/grovnews/page.tsx", "app/(app)/grovnews/[slug]/page.tsx", "components/grovnews/reader.tsx",
      "components/grovnews/access-card.tsx", "lib/services/grovnews.ts"];
    const src = files.map((f) => code(read(f))).join("\n");
    check("S6 no Stripe, no checkout code, no server action, no fetch in the reader files",
      !/stripe|beginGrovNews|priceGrovNews|lib\/server\/checkout|@\/app\/actions|\bfetch\(|"use server"|"use client"/i.test(src));
    const hrefs = [...src.matchAll(/\/checkout[^"'`\s]*/g)].map((m) => m[0]);
    check("S6 the only checkout target is /checkout?kind=grovnews", hrefs.length >= 1 && hrefs.every((h) => h === "/checkout?kind=grovnews"), hrefs.join(", "));
    check("S6 the checkout itself still refuses a second subscription (existing guard untouched)",
      /grovnewsAlreadyActive|grovnews_checkout_begin/.test(read("lib/server/checkout.ts") + read("lib/server/grovnews-billing.ts")));
    check("S6 access order pinned: launch claim → access → locked return before any post query",
      ["app/(app)/grovnews/page.tsx", "app/(app)/grovnews/[slug]/page.tsx"].every((f) => {
        const c = code(read(f));
        const lock = c.indexOf("if (!access && !admin) return <GrovNewsLocked");
        return c.indexOf("await ensureLaunchBonus(supabase)") < c.indexOf("hasActiveGrovNewsAccess(supabase)") && lock > 0
          && lock < Math.min(...["listFeed(", "getPublishedArticle(", "getCurrentEdition("].map((k) => c.indexOf(k)).filter((i) => i >= 0));
      }));
    check("S6 FeatureGate still wraps the module", /<FeatureGate feature="grovnews">/.test(read("app/(app)/grovnews/layout.tsx")));
  }

  /* ── C ────────────────────────────────────────────────────────────────── */
  section("C. CATEGORY FILTER — DB categories, validated slug, filtered in the database");
  {
    check("C1 an active slug → its row", pickCategory(CATS, "ai")?.id === "c-ai");
    check("C2 inactive / unknown / malformed / oversize → ignored (null)", [
      "stara", "nie-ma", "../ai", "AI", "ai;drop", "", "a".repeat(200), 5, null, undefined,
    ].every((v) => pickCategory(CATS, v) === null));
    check("C3 ?category=a&category=b → the first value only", pickCategory(CATS, ["prawo", "ai"])?.id === "c-law");
    const paid = { grovnews_has_access: true, grovnews_my_state: { ...noAccessState, access: true, sources: ["PROMO"] } };
    const on = await feedHtml(paid, false, { category: "ai" });
    const q = postQueries(on.log)[0];
    check("C4 ?category=ai → eq(category_id, <id>) on the posts query, no edition hero",
      !!q && q.ops.some(([op, col, v]) => op === "eq" && col === "category_id" && v === "c-ai") && !on.log.rpc.includes("grovnews_current_edition"));
    check("C5 chips are the DB's ACTIVE categories (inactive one absent), the chosen one marked",
      on.html.includes("Sztuczna inteligencja") && on.html.includes("Prawo testowe") && !on.html.includes("Stara kategoria")
      && /aria-current="page"[^>]*data-grovnews-category="ai"|data-grovnews-category="ai"[^>]*aria-current="page"/.test(on.html));
    const bogus = await feedHtml(paid, false, { category: "../../etc" });
    check("C6 an invalid slug → the full feed, no category filter", !postQueries(bogus.log)[0].ops.some(([, col]) => col === "category_id"));
    const reader = code(read("components/grovnews/reader.tsx"));
    // The seeded category slugs (0119) must not appear as a list in code; the
    // hero's five selling points are copy keys, not categories.
    const SEEDED = ["allegro", "olx", "amazon", "e-commerce", "marketing", "prawo", "podatki", "import-i-hurt", "logistyka", "trendy"];
    check("C7 no hardcoded category list in the reader (chips come from the categories prop)",
      !SEEDED.some((slug) => reader.includes(`"${slug}"`)) && !/grovnews\.topics\./.test(reader) && /categories\.map\(\(c\) =>/.test(reader));
    const empty = await feedHtml(paid, false, { category: "prawo" }, []);
    check("C8 empty category → its own message + 'Wszystkie'", empty.html.includes(pl.grovnews.empty.categoryTitle) && empty.html.includes('href="/grovnews"'));
  }

  /* ── E ────────────────────────────────────────────────────────────────── */
  section("E. EMPTY STATE, EDITION HERO, ARTICLE ANCHORS");
  {
    const paid = { grovnews_has_access: true, grovnews_my_state: { ...noAccessState, access: true, sources: ["ADMIN_GRANT"] } };
    const { html } = await feedHtml(paid, false, {}, []);
    check("E1 'Pierwsze wydanie GrovNews jest przygotowywane.' + what will appear here", html.includes(pl.grovnews.empty.title)
      && Object.values(pl.grovnews.empty.points).every((p) => html.includes(p)));
    check("E1 the PL copy is the brief's sentence", pl.grovnews.empty.title === "Pierwsze wydanie GrovNews jest przygotowywane.");

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const ed = await feedHtml({ ...paid, grovnews_current_edition: { date: today, title: "GrovNews — dziś", intro: "Wstęp.",
      posts: [{ id: "p1", slug: "grovnews-dzis", title: "GrovNews — dziś", excerpt: "Pięć tematów.", featured: true, read_minutes: 5 }] } }, false);
    check("E2 today's edition hero with a 'Czytaj wydanie' link to the article", ed.html.includes(`data-grovnews-edition-box="${today}"`)
      && ed.html.includes('href="/grovnews/grovnews-dzis"') && ed.html.includes(pl.grovnews.edition.cta));

    const blocks = parseContent("Wstęp.\n\n## 1. Allegro zmienia prowizje\n\nTekst.\n\n> **Oryginał:** \"Fees change.\"\n\n> **Tłumaczenie PL:** Opłaty się zmieniają.\n\n## 2. Drugi temat\n\n## Bez numeru\n\n### W skrócie\n\n- a");
    const body = renderToStaticMarkup(createElement(ContentBlocks, { blocks }));
    check("E3 '## N. title' headings get stable ids t1, t2 (the mail's #tN links)", body.includes('id="t1"') && body.includes('id="t2"')
      && (body.match(/ id="t\d+"/g) ?? []).length === 2);
    check("E4 quote blocks (Oryginał / Tłumaczenie PL) render as styled quotes", (body.match(/data-grovnews-quote/g) ?? []).length === 2
      && body.includes("<strong") && body.includes("Tłumaczenie PL:"));
    check("E5 topicAnchor: 10 → t10, no number → none, a duplicate number keeps the first id only",
      topicAnchor([{ kind: "text", text: "10. Temat" }]) === "t10" && topicAnchor([{ kind: "text", text: "Temat" }]) === null
      && (renderToStaticMarkup(createElement(ContentBlocks, { blocks: parseContent("## 1. A\n\n## 1. B") })).match(/id="t1"/g) ?? []).length === 1);
    check("E6 the daily article still writes topics as '## N. title' (lib/server/grovnews/daily.ts)",
      /`## \$\{n\}\. \$\{copy\.title\}`/.test(read("lib/server/grovnews/daily.ts")));

    const feed: FeedPost[] = [{ id: "x", slug: "x", title: "T", excerpt: "", coverUrl: null, publishedAt: null, readMinutes: 1, category: null, sourcesCount: 0 }];
    const card = renderToStaticMarkup(createElement(GrovNewsFeed, { posts: feed, locale: "pl", t }));
    check("E7 a post with no sources shows no 'Źródła: 0'", !card.includes("Źródła:"));
  }

  /* ── P ────────────────────────────────────────────────────────────────── */
  section("P. PULPIT — health summary, verdict, unknown cost, active subscribers");
  {
    const rows = [
      ...Array.from({ length: 50 }, () => ({ enabled: true, health_status: "HEALTHY", last_error: null })),
      ...Array.from({ length: 3 }, () => ({ enabled: true, health_status: "DEGRADED", last_error: "timeout" })),
      { enabled: true, health_status: "UNSUPPORTED", last_error: "http_status_403" },
      { enabled: true, health_status: "FAILED", last_error: "requires_access" },
      { enabled: false, health_status: "FAILED", last_error: "dns" },
      { enabled: true, health_status: null, last_error: null },
    ];
    const h = summarizeSourceHealth(rows);
    check("P1 '57 źródeł · 50 OK · 3 timeout · 2 auth' — real counts, causes largest first",
      h.total === 57 && h.enabled === 56 && h.disabled === 1 && h.ok === 50 && h.withErrors === 5 && h.unchecked === 1
      && h.causes.map((c) => `${c.bucket}:${c.count}`).join() === "timeout:3,auth:2", JSON.stringify(h));
    check("P2 error buckets", sourceErrorBucket("http_status_500") === "http" && sourceErrorBucket("dns") === "network"
      && sourceErrorBucket("adapter_unavailable") === "unsupported" && sourceErrorBucket("weird") === "other" && sourceErrorBucket(null) === "other");

    const S: DashboardSettings = { dailyEnabled: true, mode: "REVIEW", runHour: 6, emailEnabled: true, publishHour: null, sendHour: null };
    const at = (h: number) => new Date(Date.UTC(2026, 8, 26, h - 2, 30));
    const base = { date: "2026-09-26", items: { fetched: 0, rejected: 0, duplicates: 0 }, mail: null };
    const run = (status: string, outcome: string | null) => ({ status, stage: "DONE", trigger: "CRON", startedAt: "", finishedAt: null, outcome, error: null });
    const edition = (status: string) => ({ id: "e", status, title: "x", topics: 3, recipients: 10, failureReason: null, campaignId: null });
    check("P3 verdicts: off / waiting / missing / review / sent / failed / aiDown / noTopics", [
      dashboardVerdict(null, { ...S, dailyEnabled: false }, at(12)).key === "off",
      dashboardVerdict({ ...base, run: null, edition: null }, S, at(5)).key === "waiting",
      dashboardVerdict({ ...base, run: null, edition: null }, S, at(9)).key === "missing",
      dashboardVerdict({ ...base, run: run("DONE", "draft_review"), edition: edition("DRAFT") }, S, at(9)).key === "review",
      dashboardVerdict({ ...base, run: run("DONE", "published_queued"), edition: edition("SENT") }, S, at(9)).key === "sent",
      dashboardVerdict({ ...base, run: run("FAILED", null), edition: null }, S, at(9)).key === "failed",
      dashboardVerdict({ ...base, run: run("RUNNING", "ai_unavailable"), edition: null }, S, at(9)).key === "aiDown",
      dashboardVerdict({ ...base, run: run("DONE", "no_topics"), edition: null }, S, at(9)).key === "noTopics",
    ].every(Boolean));

    check("P4 unknown AI cost is 'Nieznany', never $0.00; partial is a floor; zero calls is a real $0.00",
      aiCostLabel({ aiCostUsdMicros: 0, aiCalls: 4, unknownCostCalls: 4 }, t).value === pl.grovnewsAdm.dash.unknown
      && aiCostLabel({ aiCostUsdMicros: 120_000, aiCalls: 5, unknownCostCalls: 1 }, t).value === "≥ $0.12"
      && aiCostLabel({ aiCostUsdMicros: 0, aiCalls: 0, unknownCostCalls: 0 }, t).value === "$0.00"
      && aiCostLabel(null, t).value === "—" && formatUsdMicros(3_400) === "$0.0034");

    const econ = (over: Partial<GrovNewsEconomics>): GrovNewsEconomics => ({
      today: { aiCostUsdMicros: 0, aiCalls: 0, unknownCostCalls: 0 }, days30: { aiCostUsdMicros: 500_000, aiCalls: 30, unknownCostCalls: 0 },
      editions30: 12, activePaid: 3, mrrCents: 8700, revenue30Cents: 8700, currency: "PLN", promoActive: 1, launchActive: 2, adminGrants: 0,
      margin30Cents: 6700, marginNote: "estimated", ...over,
    });
    const ok = renderToStaticMarkup(createElement(GrovNewsEconomicsPanel, { economics: econ({}), locale: "pl", t }));
    check("P5 economics: MRR, paid, grants, margin labelled 'Szacowana' with its note", ok.includes(formatMoney(8700, "PLN", "pl"))
      && ok.includes(formatMoney(6700, "PLN", "pl")) && ok.includes(pl.grovnewsAdm.dash.econ.estimatedMargin) && ok.includes("data-grovnews-dash-margin-note"));
    const thin = renderToStaticMarkup(createElement(GrovNewsEconomicsPanel, {
      economics: econ({ days30: { aiCostUsdMicros: 100_000, aiCalls: 9, unknownCostCalls: 2 } }), locale: "pl", t }));
    check("P6 unpriced calls → the margin is withheld and the reason said in words", !thin.includes(formatMoney(6700, "PLN", "pl"))
      && thin.includes(t("grovnewsAdm.dash.econ.insufficientUnpriced", { n: 2 })));
    const none = renderToStaticMarkup(createElement(GrovNewsEconomicsPanel, { economics: null, locale: "pl", t }));
    check("P7 no economics data → 'unavailable', no zeros", none.includes(pl.grovnewsAdm.dash.econ.unavailable) && !none.includes("0,00"));

    // The subscriber-count fix: entitlement users ∪ paid-through subscribers,
    // distinct, read page by page past 1000 rows.
    const ent = Array.from({ length: 1500 }, (_, i) => ({ user_id: `u${i}` }));
    const subs = [...Array.from({ length: 200 }, (_, i) => ({ user_id: `u${i}` })), ...Array.from({ length: 100 }, (_, i) => ({ user_id: `paid${i}` })), { user_id: null }];
    const db = fakeDb({}, { grovnews_entitlements: (q) => {
      const head = q.ops.some(([op, , o]) => op === "select" && (o as { head?: boolean } | undefined)?.head);
      if (head) return { data: null, count: 7 };
      const r = q.ops.find(([op]) => op === "range");
      return { data: ent.slice(Number(r?.[1] ?? 0), Number(r?.[2] ?? 999) + 1), count: ent.length };
    }, grovnews_subscriptions: (q) => {
      const r = q.ops.find(([op]) => op === "range");
      const paidOnly = q.ops.some(([op, col]) => op === "gt" && col === "paid_through");
      return { data: paidOnly ? subs.slice(Number(r?.[1] ?? 0), Number(r?.[2] ?? 999) + 1) : [], count: subs.length };
    }, grovnews_posts: [], profiles: [] });
    const stats = await adminStats(db.client as unknown as Client);
    check("P8 active subscribers = distinct(entitlements ∪ paid_through > now), past the 1000-row cap", stats.activeSubscribers === 1600,
      String(stats.activeSubscribers));

    const dayDb = fakeDb({}, {
      grovnews_runs: [{ status: "DONE", stage: "DONE", trigger: "CRON", started_at: "2026-09-26T04:00:00Z", finished_at: null, error: null, stats: { outcome: "published_queued" } }],
      grovnews_editions: [{ id: "e1", status: "QUEUED", title: "GrovNews", campaign_id: "k1", email_recipients: 12, failure_reason: null,
        daily: null, posts: [{ count: 1 }] }],
      grovnews_research_items: (q) => ({ data: null, count: q.ops.some(([op, col, v]) => op === "eq" && col === "status" && v === "REJECTED") ? 9
        : q.ops.some(([op, col]) => op === "eq" && col === "status") ? 4 : 40 }),
      newsletter_campaigns: [{ status: "sending" }],
      newsletter_recipients: (q) => ({ data: null, count: q.ops.some(([op, , v]) => op === "eq" && v === "sent") ? 10
        : q.ops.some(([op, , v]) => op === "eq" && v === "failed") ? 1 : 12 }),
    });
    const day = await adminToday(dayDb.client as unknown as Client, new Date("2026-09-26T08:00:00Z"));
    check("P9 today: fetched / rejected / duplicates, edition, mail recipients / sent / failed — all counted",
      day.date === "2026-09-26" && day.items.fetched === 40 && day.items.rejected === 9 && day.items.duplicates === 4
      && day.edition?.status === "QUEUED" && day.edition.topics === 1 && day.run?.outcome === "published_queued"
      && day.mail?.recipients === 12 && day.mail.sent === 10 && day.mail.failed === 1 && day.mail.campaignStatus === "sending", JSON.stringify(day));
    const since = dayDb.log.from.find((q) => q.table === "grovnews_research_items")?.ops.find(([op]) => op === "gte")?.[2];
    check("P10 'today' starts at Warsaw midnight (22:00 UTC in summer)", since === "2026-09-25T22:00:00.000Z", String(since));
  }

  /* ── I ────────────────────────────────────────────────────────────────── */
  section("I. I18N — every new key in PL, EN and DE");
  {
    const files = ["components/grovnews/reader.tsx", "components/grovnews/access-card.tsx", "components/admin/grovnews/dashboard.tsx",
      "app/(app)/grovnews/page.tsx", "app/admin/newsletter/grovnews/page.tsx"];
    const keys = new Set<string>();
    for (const f of files) for (const m of read(f).matchAll(/"((?:grovnews|grovnewsAdm)\.[A-Za-z0-9_.]+)"/g)) if (!m[1].endsWith(".")) keys.add(m[1]);
    const fam: Record<string, readonly string[]> = {
      "grovnews.hero.points": ["marketplace", "ai", "law", "trade", "digest"],
      "grovnews.empty.points": ["edition", "categories", "digest"],
      "grovnews.status.kind": ["PAID", "LAUNCH_BONUS", "PROMO", "ADMIN_GRANT", "ADMIN"],
      "grovnewsAdm.dash.bucket": ["timeout", "auth", "http", "network", "format", "empty", "unsupported", "other"],
    };
    for (const [b, m] of Object.entries(fam)) m.forEach((k) => keys.add(`${b}.${k}`));
    const get = (d: unknown, key: string) => key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), d);
    for (const [name, dict] of [["pl", pl], ["en", en], ["de", de]] as const) {
      const missing = [...keys].filter((k) => typeof get(dict, k) !== "string");
      check(`${name}: all ${keys.size} keys resolve`, missing.length === 0, missing.join(", "));
    }
    const client = ["components/grovnews/reader.tsx", "components/grovnews/access-card.tsx", "app/(app)/grovnews/page.tsx"].map(read).join("\n");
    check("no admin namespace in the subscriber-facing files", !client.includes("grovnewsAdm."));
  }

  console.log(failed ? `\n${failed} GrovNews UI test(s) failed.` : "\nAll GrovNews UI tests passed.");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
