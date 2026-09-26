/**
 * GROVNEWS STAGE 6 (0128) — the backend finished end to end: API sources with
 * auth, language + translation, the AI choice inside the platform stack and
 * its trace, the publish / send hours, operator copies, the digest with topic
 * anchors, the recipient fixes, health summaries.
 *
 *   npm run test:grovnews6
 *
 * The TypeScript half; the SQL half (what 0128 really does to rows) runs on a
 * real Postgres in scripts/grovnews6-sql-tests.sh. Offline and deterministic:
 * feeds through a stubbed https.request or a scripted transport, the model
 * through a stubbed fetch or a fake engine, the database through a fake rpc /
 * from. No network, no mail, no paid call.
 *
 *   G1–G16  the pipeline (sources, language, translation, dedupe, runs)
 *   M1–M10  the mail (the TS halves; the SQL halves live in the .sh)
 *   A.      the AI choice and its trace
 *   H.      hours, operators, settings, health summaries
 */
import fs from "node:fs";
import https from "node:https";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { Client } from "@/lib/services/workspace";
import { parseContent } from "@/lib/grovnews";
import {
  DEFAULT_SETTINGS, detectLanguage, itemLanguage, originalExcerpt, parseOperatorEmails, sourceErrorKind, sourceMethod, sourceState,
  validateSettingsInput, validateSourceInput, type DailyRecord, type GrovNewsSettings,
} from "@/lib/grovnews-research";
import { fetchWith, type Transport } from "@/lib/server/grovnews/fetch";
import { parseApiJson } from "@/lib/server/grovnews/feed";
import { apiErrorCode, authHeadersFor, probeApiSource, readApi } from "@/lib/server/grovnews/api";
import {
  allowedDigestHrefs, buildTopics, checkedTranslation, composeDaily, composeDailyMail, dailyPayload, hrefsOf, mailBodyDaily,
  parseDaily, renderDailyMailHtml, toTopic, topicReview, translationProblem, type DailyCopy,
} from "@/lib/server/grovnews/daily";
import { autoSendEdition, budget, ingestSources, noTopicsReason, runDaily, type RunReport } from "@/lib/server/grovnews/pipeline";
import { GROVNEWS_MODEL_OPTIONS, grovnewsEngine, orderBackends } from "@/lib/server/grovnews/ai";
import { sendOperatorCopies } from "@/lib/server/grovnews/operators";
import { settingsFromRow, type DailyCandidate, type DailySource, type JobContext } from "@/lib/server/grovnews/store";
import { postUrl } from "@/lib/server/grovnews/compose";
import { sourceHealthSummary, todayRunSummary } from "@/lib/services/grovnews-research";
import type { VisionBackend } from "@/lib/ai/engine/vision";
import type { BulkMailer } from "@/lib/server/mailer";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : `\n       ${detail}`}`);
}
const section = (s: string) => console.log(`\n${s}`);
const read = (p: string) => fs.readFileSync(p, "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// The store's doors carry the dispatch token (read from the env at call time).
process.env.GROVBASE_SERVER_KEY = "grovnews6-tests-offline-server-key-0123456789abcdef";

const DATE = "2026-09-26";
const RUN_DATE = "2026-09-26";
const UUID = (n: number) => `${String(n).padStart(8, "0")}-6666-4666-8666-666666666666`;
const alpha = (n: number): string => {
  let x = n + 26 * 26;
  let s = "";
  while (x > 0) { s = String.fromCharCode(97 + (x % 26)) + s; x = Math.floor(x / 26); }
  return s;
};
const SECRET = "sk-live-grovnews6-SECRET-value-9f8e7d";

/* ── fakes ─────────────────────────────────────────────────────────────────── */

type Call = { fn: string; args: Record<string, unknown> };
/** A fake client: rpc answered by name, `from(table)` answered from rows. */
function fakeDb(answer: (fn: string, args: Record<string, unknown>) => unknown, tables: Record<string, Record<string, unknown>[]> = {}) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    let single = false;
    const rows = () => (tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
    const q: Record<string, unknown> = {};
    const chain = () => new Proxy(q, {
      get: (_t, prop) => {
        if (prop === "then") {
          return (done: (v: unknown) => void) => {
            const list = rows();
            done(single ? { data: list[0] ?? null, error: null } : { data: list, error: null, count: list.length });
          };
        }
        if (prop === "eq") return (k: string, v: unknown) => { filters.push([k, v]); return chain(); };
        if (prop === "maybeSingle" || prop === "single") return () => { single = true; return chain(); };
        return () => chain();
      },
    });
    return chain();
  };
  const db = {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      const data = answer(fn, args);
      return Promise.resolve(data instanceof Error ? { data: null, error: { message: data.message } } : { data, error: null });
    },
    from,
  };
  return { db: db as unknown as Client, calls, of: (fn: string) => calls.filter((c) => c.fn === fn) };
}

type Raw = Awaited<ReturnType<Transport>>;
const reply = (status: number, headers: Record<string, string>, body = ""): Raw =>
  ({ status, headers, body: Readable.from([Buffer.from(body)]) });
function scripted(step: (url: URL) => Raw) {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const transport: Transport = async (url, headers) => { seen.push({ url: url.toString(), headers }); return step(url); };
  return { transport, seen };
}

type FakeHttp = { status: number; headers?: Record<string, string>; body: string };
function patchHttps(handler: (url: URL) => FakeHttp) {
  const mod = https as unknown as { request: unknown };
  const original = mod.request;
  const urls: string[] = [];
  mod.request = (url: URL, _opts: unknown, onResponse: (res: Readable) => void) => {
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () => {
      urls.push(url.toString());
      const r = handler(url);
      setTimeout(() => onResponse(Object.assign(Readable.from([Buffer.from(r.body)]), { statusCode: r.status, headers: r.headers ?? {} })), 0);
    };
    return req;
  };
  return { urls, restore: () => { mod.request = original; } };
}

const NOW_ISO = new Date().toISOString();
const rss = (base: string, titles: string[]) => `<?xml version="1.0"?><rss version="2.0"><channel><title>K</title>${
  titles.map((t, i) => `<item><title>${t}</title><link>${base}/a-${i}</link><description>${t} — opis.</description><pubDate>${new Date(Date.now() - (i + 1) * 3600_000).toUTCString()}</pubDate></item>`).join("")}</channel></rss>`;
const atom = (base: string) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>A</title>
<entry><title>Nowe zasady zwrotów dla sprzedawców internetowych</title><link href="${base}/e1"/><updated>${NOW_ISO}</updated><summary>Sprzedawcy muszą zmienić regulaminy.</summary></entry></feed>`;
const listing = (base: string) => `<html><head><title>Aktualności</title></head><body><main>
<a href="${base}/aktualnosci/zmiana-stawek-prowizji">Zmiana stawek prowizji dla sprzedawców od listopada</a>
<a href="${base}/aktualnosci/nowy-regulamin">Nowy regulamin platformy dla firm handlowych</a></main></body></html>`;

function cand(n: number, p: Partial<DailyCandidate> = {}): DailyCandidate {
  return {
    id: UUID(n), url: `https://news${n}.example.com/artykul-${alpha(n)}`,
    title: `Komunikat ${alpha(n)} dotyczy ${alpha(n + 1000)} ${alpha(n + 2000)}`,
    excerpt: `Wyciąg ${alpha(n)} opisuje zmianę ${alpha(n + 3000)} dla sprzedawców internetowych w sklepach.`,
    published_at: "2026-09-25T08:00:00.000Z", discovered_at: "2026-09-25T09:00:00.000Z",
    ai_title: null, ai_summary: "Streszczenie badania.", ai_reason: "Dotyczy sprzedawców.",
    relevance: 80, importance: 80, sensitive: false, review_required: false, review_reason: null,
    category: "allegro", source_name: `Źródło ${alpha(n)}`, official: true, priority: 50, language: "pl",
    source_id: UUID(5000 + n), related: [], ...p,
  };
}
const rel = (n: number, p: Partial<DailySource> = {}): DailySource => ({
  id: UUID(n), url: `https://rel${n}.example.com/r-${alpha(n)}`, title: `Relacja ${alpha(n)}`,
  excerpt: `Opis ${alpha(n)}.`, published_at: "2026-09-25T07:00:00.000Z", source: `Portal ${alpha(n)}`,
  official: false, priority: 40, source_id: UUID(7000 + n), ...p,
});
function answerFor(user: string, patch: (id: string, i: number) => Record<string, unknown> = () => ({})) {
  const payload = JSON.parse(user) as { topics: { id: string }[] };
  return {
    headline: "Zmiany w zasadach sprzedaży na platformach",
    opening: "Dzisiejszy przegląd zbiera najważniejsze zmiany dla sprzedawców internetowych.",
    mail_intro: "Krótko o tym, co dziś zmienia się w handlu internetowym.",
    topics: payload.topics.map((tp, i) => ({
      id: tp.id, title: `Temat dnia ${alpha(i)} dla sprzedawców`,
      what_happened: "Platforma ogłosiła zmianę zasad, która obejmie część sprzedawców w najbliższym czasie.",
      key_facts: ["Zmiana dotyczy wybranych kategorii."], why_it_matters: "Wpływa na koszty.", for_sellers: "Warto sprawdzić ustawienia.",
      short: `Krótko o temacie ${alpha(i)}.`, mail: `Najważniejsze informacje o temacie ${alpha(i)}. Szczegóły w artykule.`,
      review_required: false, review_reason: "", translation_pl: "", ...patch(tp.id, i),
    })),
    watch_next: ["Kolejne komunikaty platform."],
  };
}
const copyFor = (ids: string[], patch: (id: string, i: number) => Record<string, unknown> = () => ({})): DailyCopy =>
  parseDaily(answerFor(JSON.stringify({ topics: ids.map((id) => ({ id })) }), patch), ids);

const AI_BASE = "https://ai.offline.example";
async function withModel<T>(answer: (user: string) => unknown, run: () => Promise<T>, usage = true): Promise<{ result: T; asked: string[] }> {
  const real = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith(AI_BASE)) throw new Error(`unexpected fetch ${url}`);
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: { content?: unknown }[] };
    const content = body.messages?.[1]?.content;
    const user = Array.isArray(content) ? String((content[0] as { text?: unknown } | undefined)?.text ?? "") : String(content ?? "");
    asked.push(user);
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(answer(user)) } }],
      ...(usage ? { usage: { prompt_tokens: 1000, completion_tokens: 500 } } : {}),
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try { return { result: await run(), asked }; } finally { globalThis.fetch = real; }
}

const RUN_ID = UUID(990);
const POST_ID = UUID(991);
const ED_ID = UUID(992);
type RunOpts = {
  stage: string; stats?: Record<string, unknown>; mode?: "REVIEW" | "AUTOMATIC"; ai?: boolean; settings?: Record<string, unknown>;
  sources?: unknown[]; candidates?: () => DailyCandidate[]; article?: (args: Record<string, unknown>) => unknown;
  edition?: { edition_id: string | null; status: string | null; created: boolean; added: number }; mailSource?: unknown;
  claim?: unknown; operators?: string[] | Error; secret?: string | null; send?: unknown;
};
function runDb(o: RunOpts) {
  return fakeDb((fn, args) => {
    switch (fn) {
      case "grovnews_editions_sync": return 0;
      case "grovnews_run_claim": return o.claim ?? { claimed: true, run_id: RUN_ID, stage: o.stage, stats: o.stats ?? {}, run_date: RUN_DATE };
      case "grovnews_job_context": return {
        settings: {
          mode: o.mode ?? "REVIEW", daily_enabled: true, run_hour: 6, min_relevance: 60, min_importance: 60, max_topics: 5,
          auto_publish_official_sensitive: false, min_topics: 1, lookback_hours: 36, email_enabled: true, ...o.settings,
        },
        sources: o.sources ?? [], categories: [], recent: [],
      };
      case "grovnews_ai_providers": return o.ai ? [{ id: UUID(993), slug: "openai" }] : [];
      case "provider_credential_read": return [{ base_url: AI_BASE, encrypted_value: null, iv: null, auth_tag: null }];
      case "secret_read": return String(args.p_name ?? "").startsWith("grovbase.grovnews_source.") ? (o.secret ?? null) : "sk-offline-test-key";
      case "grovnews_run_update": return null;
      case "grovnews_ingest": return { inserted: Array.isArray(args.p_items) ? args.p_items.length : 0, duplicates: 0, skipped: 0, stale: 0, items: [] };
      case "grovnews_work_items": return [];
      case "grovnews_select_top": return 0;
      case "grovnews_daily_candidates": return o.candidates ? o.candidates() : [];
      case "grovnews_daily_article": return o.article ? o.article(args)
        : Array.isArray(args.p_item_ids) && args.p_item_ids.length === 0 ? new Error("invalid_items") : new Error("unexpected_daily_article");
      case "grovnews_build_edition": return o.edition ?? { edition_id: ED_ID, status: "DRAFT", created: false, added: 0 };
      case "grovnews_edition_mail_source": return o.mailSource ?? null;
      case "grovnews_edition_send": return o.send ?? { status: "queued", campaign_id: UUID(994), recipients: 2 };
      case "grovnews_operator_recipients": return o.operators ?? [];
      case "ai_token_prices_read": return [{ provider_slug: "openai", model: "gpt-5", input_usd_micros_per_mtok: 1_250_000, output_usd_micros_per_mtok: 10_000_000 }];
      case "ai_provider_call_record": return Array.isArray(args.p_calls) ? args.p_calls.length : 0;
      default: return new Error(`unexpected_rpc_${fn}`);
    }
  });
}
const statsOf = (r: RunReport) => (r.stats ?? {}) as Record<string, unknown>;
const recOf = (v: unknown) => (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
const SETTINGS: GrovNewsSettings = { ...DEFAULT_SETTINGS, maxTopics: 5, minTopics: 1 };

function fakeMailer() {
  const sent: { to: string; subject: string; html: string }[] = [];
  let closed = false;
  const mailer: BulkMailer = {
    async send(m) { sent.push({ to: m.to, subject: m.subject, html: m.html }); return { sent: true, accepted: [m.to], rejected: [] }; },
    close() { closed = true; },
    newMessageId: () => "<id@test>",
  };
  return { mailer, sent, closed: () => closed };
}

(async () => {
  /* ── G: sources ───────────────────────────────────────────────────────────── */
  section("G. SOURCES — RSS, Atom, WWW, API (none / Bearer / header), failures");
  {
    const sources = [
      { id: UUID(1), name: "RSS", type: "RSS", url: "https://rss.example.com/feed", categoryId: null, priority: 50, official: false, language: "pl" as const },
      { id: UUID(2), name: "Atom", type: "ATOM", url: "https://atom.example.com/atom.xml", categoryId: null, priority: 50, official: false, language: "pl" as const },
      { id: UUID(3), name: "WWW", type: "WEB_PAGE", url: "https://www.example-news.com/aktualnosci", categoryId: null, priority: 50, official: false, language: "pl" as const },
      { id: UUID(4), name: "Broken", type: "RSS", url: "https://broken.example.com/feed", categoryId: null, priority: 50, official: false, language: "pl" as const },
    ] satisfies JobContext["sources"];
    const web = patchHttps((url) => {
      if (url.pathname === "/robots.txt") return { status: 404, body: "" };
      if (url.hostname === "rss.example.com") return { status: 200, headers: { "content-type": "application/rss+xml" }, body: rss("https://rss.example.com", ["Allegro zmienia prowizje od października dla sprzedawców", "Nowe zasady wysyłki paczek w Polsce"]) };
      if (url.hostname === "atom.example.com") return { status: 200, headers: { "content-type": "application/atom+xml" }, body: atom("https://atom.example.com") };
      if (url.hostname === "www.example-news.com") return { status: 200, headers: { "content-type": "text/html" }, body: listing("https://www.example-news.com") };
      return { status: 500, body: "upstream exploded with SECRET details" };
    });
    const f = runDb({ stage: "INGEST" });
    let rep;
    try {
      rep = await ingestSources(f.db, { settings: SETTINGS, sources, categories: [], recent: [] }, budget(60_000));
    } finally { web.restore(); }
    const ingest = (id: string) => f.of("grovnews_ingest").find((c) => c.args.p_source_id === id)?.args;
    const items = (id: string) => (ingest(id)?.p_items ?? []) as { title: string; language?: string; url: string }[];
    check("G1 RSS works: two entries stored, each with its detected language",
      ingest(UUID(1))?.p_ok === true && items(UUID(1)).length === 2 && items(UUID(1)).every((i) => i.language === "pl"), JSON.stringify(items(UUID(1))));
    check("G2 Atom works", ingest(UUID(2))?.p_ok === true && items(UUID(2)).length === 1 && items(UUID(2))[0].url === "https://atom.example.com/e1");
    check("G3 WWW listing works (existing fetcher, same-site article links)",
      ingest(UUID(3))?.p_ok === true && items(UUID(3)).length === 2 && items(UUID(3)).every((i) => i.url.startsWith("https://www.example-news.com/aktualnosci/")));
    check("G14 one broken source does not stop the run: the others are stored, the broken one recorded as a code (never the upstream body)",
      !!rep && rep.sources === 4 && rep.failed === 1 && rep.succeeded === 3 && ingest(UUID(4))?.p_ok === false && ingest(UUID(4))?.p_error === "http_status_500"
      && !JSON.stringify(f.calls).includes("upstream exploded"), JSON.stringify(rep));

    // API — no auth: robots.txt read first, then the API (JSON Feed).
    const API = "https://api.example.com/v1/news";
    const jsonFeed = JSON.stringify({ version: "https://jsonfeed.org/version/1.1", title: "API", items: [
      { id: "1", url: "https://api.example.com/n/1", title: "Amazon raises fees for sellers in Europe", summary: "The new fees apply from November.", date_published: NOW_ISO },
    ] });
    const none = scripted((url) => (url.pathname === "/robots.txt" ? reply(404, {}) : reply(200, { "content-type": "application/feed+json" }, jsonFeed)));
    const r4 = await readApi(API, { kind: "none" }, { transport: none.transport });
    check("G4 API without auth works (JSON Feed): robots.txt first, no credential header anywhere",
      r4.parsed.entries.length === 1 && none.seen.map((s) => new URL(s.url).pathname).join() === "/robots.txt,/v1/news"
      && none.seen.every((s) => !Object.keys(s.headers).some((k) => /^(authorization|cookie|x-api-key)$/i.test(k))), JSON.stringify(none.seen.map((s) => s.url)));
    const generic = parseApiJson(JSON.stringify({ data: { articles: [
      { headline: "Nowe cła na import z Chin", link: "/a/1", publishedAt: NOW_ISO, description: "<p>Rząd ogłosił zmiany.</p>" },
      { title: "", url: "https://x.example.com/2" }, { title: "Bez adresu" }, { title: "Zły link", url: "javascript:alert(1)" },
    ] } }), API);
    check("G4 …a plain JSON list (data.articles, headline/link/publishedAt/description) is mapped; entries without a title or an http(s) URL are dropped",
      generic !== null && generic.kind === "api" && generic.entries.length === 1 && generic.entries[0].url === "https://api.example.com/a/1"
      && generic.entries[0].excerpt === "Rząd ogłosił zmiany." && generic.entries[0].publishedAt !== null, JSON.stringify(generic));
    check("G4 …and anything that is neither a feed nor such a list is unrecognized_format",
      parseApiJson("{\"hello\":1}", API) === null && parseApiJson("not json", API) === null
      && await readApi(API, { kind: "none" }, { transport: scripted((u) => (u.pathname === "/robots.txt" ? reply(404, {}) : reply(200, {}, "{\"x\":1}"))).transport }).then(() => "ok", (e) => apiErrorCode(e)) === "unrecognized_format");

    // API — Bearer: the header goes to the source's own origin only.
    const bearer = scripted((url) => {
      if (url.hostname === "api.example.com" && url.pathname === "/v1/news") return reply(302, { location: "/v2/news" });
      if (url.hostname === "api.example.com" && url.pathname === "/v2/news") return reply(302, { location: "https://cdn.other-host.com/news.json" });
      return reply(200, { "content-type": "application/json" }, JSON.stringify({ items: [{ title: "Temat z API", url: "https://api.example.com/t/1" }] }));
    });
    const r5 = await readApi(API, { kind: "bearer", secret: SECRET }, { transport: bearer.transport });
    const sentTo = bearer.seen.map((s) => `${new URL(s.url).host}:${s.headers.authorization ? "auth" : "-"}`);
    check("G5 API with a Bearer token: sent to the source's own origin (and a same-origin redirect), DROPPED on the cross-origin redirect; robots.txt not consulted",
      r5.parsed.entries.length === 1 && sentTo.join() === "api.example.com:auth,api.example.com:auth,cdn.other-host.com:-"
      && bearer.seen[0].headers.authorization === `Bearer ${SECRET}` && !bearer.seen.some((s) => s.url.endsWith("/robots.txt")), sentTo.join());
    const hdr = authHeadersFor({ kind: "header", header: "X-API-Key", secret: SECRET }, "https://api.example.com");
    check("G5 …a header key goes in the named header, to the same origin only",
      hdr(new URL("https://api.example.com/x"))["x-api-key"] === SECRET && Object.keys(hdr(new URL("https://evil.example.com/x"))).length === 0
      && Object.keys(hdr(new URL("http://api.example.com/x"))).length === 0);

    // API — wrong key: 401 → auth_failed, the secret nowhere in the result.
    const apiSource = { id: UUID(20), name: "API", type: "API" as const, url: API, categoryId: null, priority: 50, official: false, language: "en" as const, authKind: "bearer" as const, authHeader: null };
    const deny = scripted(() => reply(401, { "content-type": "application/json" }, `{"error":"invalid token ${SECRET}"}`));
    const fa = runDb({ stage: "INGEST", secret: SECRET });
    const rep6 = await ingestSources(fa.db, { settings: SETTINGS, sources: [apiSource], categories: [], recent: [] }, budget(60_000), undefined, undefined, { transport: deny.transport });
    const probe6 = await probeApiSource(fa.db, apiSource, { transport: deny.transport });
    check("G6 invalid auth (401) → the source's error is auth_failed; the secret is in no ingest call, no report, no probe (it was only in the request header)",
      rep6.failed === 1 && fa.of("grovnews_ingest")[0]?.args.p_error === "auth_failed" && probe6.code === "auth_failed" && probe6.verdict === "UNSUPPORTED"
      && !JSON.stringify(fa.calls).includes(SECRET) && !JSON.stringify(rep6).includes(SECRET) && !JSON.stringify(probe6).includes(SECRET)
      && !JSON.stringify(probe6).includes("invalid token") && deny.seen[0].headers.authorization === `Bearer ${SECRET}`, JSON.stringify({ rep6, probe6 }));
    const fm = runDb({ stage: "INGEST", secret: null });
    const noSecret = scripted(() => reply(200, {}, "[]"));
    const rep6b = await ingestSources(fm.db, { settings: SETTINGS, sources: [apiSource], categories: [], recent: [] }, budget(60_000), undefined, undefined, { transport: noSecret.transport });
    check("G6 …auth configured but no secret stored → secret_missing, and NO request is made",
      rep6b.failed === 1 && fm.of("grovnews_ingest")[0]?.args.p_error === "secret_missing" && noSecret.seen.length === 0);
    const ok6 = scripted(() => reply(200, { "content-type": "application/json" }, JSON.stringify({ results: [
      { title: "Amazon raises FBA fees for sellers in Europe", url: "https://api.example.com/t/1", published_at: NOW_ISO, summary: "The fees apply from 1 November and will affect all sellers." },
    ] })));
    const fo = runDb({ stage: "INGEST", secret: SECRET });
    const probeOk = await probeApiSource(fo.db, apiSource, { transport: ok6.transport });
    check("G4/G5 the source test of a working API: ✓ OK, entries, newest entry date — and the recorded health says HEALTHY-shaped (ok, entries)",
      probeOk.verdict === "OK" && probeOk.entries === 1 && probeOk.lastItemAt !== null && probeOk.apiKind === "api", JSON.stringify(probeOk));
    const rep8 = await ingestSources(fo.db, { settings: SETTINGS, sources: [apiSource], categories: [], recent: [] }, budget(60_000), undefined, undefined, { transport: ok6.transport });
    const apiItems = (fo.of("grovnews_ingest")[0]?.args.p_items ?? []) as { language?: string }[];
    check("G8 an English report on an API source is stored with language 'en'", rep8.succeeded === 1 && apiItems[0]?.language === "en", JSON.stringify(apiItems));
    check("G8 detectLanguage: en / de / pl, and null when the text says too little (the source's language is the fallback)",
      detectLanguage("Amazon raises FBA fees for sellers in Europe from November") === "en"
      && detectLanguage("Die neue Verordnung für Händler tritt ab Januar in Kraft und gilt für alle") === "de"
      && detectLanguage("Allegro zmienia prowizje od października dla sprzedawców") === "pl"
      && detectLanguage("Allegro 2026") === null && itemLanguage("Allegro 2026", "", "de") === "de");
    const pipe = code(read("lib/server/grovnews/pipeline.ts"));
    check("G14 the run keeps per-source failures as codes (source_errors: id + code; ingest_errors: counts) — never a message",
      /stats\.source_errors = sourceErrors\(stats\.source_errors, r\.errors\);/.test(pipe) && /stats\.ingest_errors = add\(/.test(pipe));
  }

  /* ── G: language, translation, merging ────────────────────────────────────── */
  section("G. THE DAY — merge, language, the original excerpt and its translation");
  {
    const eight = Array.from({ length: 8 }, (_, i) => cand(100 + i, {
      title: "Allegro podnosi prowizje w kategorii elektronika od listopada", ai_title: "Allegro podnosi prowizje w elektronice od listopada",
      official: i === 3, source_id: UUID(6000 + i), source_name: `Portal ${alpha(i)}`,
    }));
    const { topics, merged } = buildTopics(eight, SETTINGS);
    const composed = composeDaily(DATE, topics, copyFor(topics.map((t) => t.itemId)), { minTopics: 1, sourcesFailed: false });
    const sourcesLine = parseContent(composed.post.content).find((b) => b.kind === "p" && b.inline[0]?.kind === "bold" && b.inline[0].text === "Źródła:");
    const links = sourcesLine && sourcesLine.kind === "p" ? sourcesLine.inline.filter((i) => i.kind === "link") : [];
    check("G7 the same story from 8 portals is ONE topic (7 merged), the official report primary, several sources cited — not 8 items",
      topics.length === 1 && merged === 7 && topics[0].primary.official && composed.itemIds.length === 1 && composed.absorbed.length === 7
      && links.length === 6 && composed.post.daily.topics[0].sources.length === 8, JSON.stringify({ topics: topics.length, merged, links: links.length }));

    const EN_EXCERPT = "Amazon will raise its FBA fulfilment fees by 5% from 1 November 2026. The change applies to all sellers in the EU store network and was announced on Monday. Small items keep the lower rate. The company said the increase reflects higher transport costs across the region, and more details will follow soon for everyone.";
    const enCand = cand(200, { item_language: "en", language: "pl", excerpt: EN_EXCERPT, title: "Amazon raises FBA fees", source_name: "Amazon News" });
    const enTopic = toTopic(enCand);
    check("G8/G9 an English primary report makes the topic English with a SHORT verbatim excerpt (≤ 300 chars, cut at a sentence end)",
      enTopic.language === "en" && !!enTopic.original && enTopic.original.text.length <= 300 && EN_EXCERPT.startsWith(enTopic.original.text)
      && /[.!?]$/.test(enTopic.original.text) && enTopic.original.url === enCand.url, JSON.stringify(enTopic.original));
    const payload = JSON.parse(dailyPayload(DATE, [enTopic])) as { topics: { original_excerpt?: { language: string; text: string } }[] };
    check("G9 the writer is handed that exact excerpt to translate (and a Polish topic gets no such field)",
      payload.topics[0].original_excerpt?.language === "en" && payload.topics[0].original_excerpt.text === enTopic.original?.text
      && !("original_excerpt" in (JSON.parse(dailyPayload(DATE, [toTopic(cand(201))])) as { topics: Record<string, unknown>[] }).topics[0]));
    const TRANSLATION = "Amazon podniesie opłaty za realizację FBA o 5% od 1 listopada 2026. Zmiana dotyczy wszystkich sprzedawców w sieci sklepów w UE i została ogłoszona w poniedziałek. Małe produkty zachowują niższą stawkę. Firma podała, że wzrost odzwierciedla wyższe koszty transportu w regionie.";
    const enCopy = copyFor([enTopic.itemId], () => ({ translation_pl: TRANSLATION }));
    const day = composeDaily(DATE, [enTopic], enCopy, { minTopics: 1, sourcesFailed: false });
    const blocks = parseContent(day.post.content);
    const quotes = blocks.filter((b) => b.kind === "quote").map((b) => (b.kind === "quote" ? b.inline.map((i) => i.text).join("") : ""));
    const boldP = blocks.filter((b) => b.kind === "p" && b.inline[0]?.kind === "bold").map((b) => (b.kind === "p" ? b.inline[0].text : ""));
    const srcLine = blocks.find((b) => b.kind === "p" && b.inline[0]?.kind === "text" && b.inline[0].text.startsWith("Źródło: "));
    check("G9 the English topic renders \"Oryginał (EN)\" + the excerpt as a quote + its source link, then \"Tłumaczenie PL\" + the translation as a quote",
      boldP.includes("Oryginał (EN)") && boldP.includes("Tłumaczenie PL") && quotes[0] === enTopic.original?.text
      && quotes[1] === TRANSLATION && !!srcLine && srcLine.kind === "p" && srcLine.inline.some((i) => i.kind === "link" && i.href === enCand.url)
      && boldP.indexOf("Oryginał (EN)") < boldP.indexOf("Tłumaczenie PL"), JSON.stringify({ boldP, quotes }));
    check("G9 the designated excerpt quote is the ONE verbatim passage allowed: the topic is not flagged 'verbatim', the record keeps excerpt + translation",
      !(day.post.daily.topics[0].reviewReason ?? "").includes("verbatim") && day.post.daily.topics[0].translation === TRANSLATION
      && day.post.daily.topics[0].original?.text === enTopic.original?.text && day.post.daily.topics[0].language === "en", JSON.stringify(day.post.daily.topics[0]));
    const copied = copyFor([enTopic.itemId], () => ({ translation_pl: TRANSLATION, what_happened: `Opis: ${EN_EXCERPT.slice(0, 120)}` }));
    check("G9 …while the model copying the source anywhere else is still caught (verbatim)",
      topicReview(enTopic, copied.topics[0], DATE).includes("verbatim"));
    const wrongNumbers = copyFor([enTopic.itemId], () => ({ translation_pl: TRANSLATION.replace("5%", "7%") }));
    const bad = composeDaily(DATE, [enTopic], wrongNumbers, { minTopics: 1, sourcesFailed: false });
    check("G9 a translation that changes a number is DROPPED (never printed, never invented) and the topic waits for review",
      !bad.post.content.includes("Tłumaczenie PL") && bad.post.content.includes("Oryginał (EN)") && bad.post.daily.topics[0].translation === null
      && (bad.post.daily.topics[0].reviewReason ?? "").includes("translation_invalid") && bad.reviewReasons.includes("topic_review"));
    check("G9 translationProblem: empty / too short / numbers / still English / copied → refused; a faithful one passes",
      translationProblem(enTopic.original!, "") === "missing" && translationProblem(enTopic.original!, "Krótko.") === "length"
      && translationProblem(enTopic.original!, TRANSLATION.replace("2026", "2025")) === "numbers"
      && translationProblem(enTopic.original!, enTopic.original!.text) !== null
      && translationProblem(enTopic.original!, TRANSLATION) === null && checkedTranslation(enTopic, { translation: TRANSLATION }) === TRANSLATION);
    const plDay = composeDaily(DATE, [toTopic(cand(202))], copyFor([UUID(202)], () => ({ translation_pl: "Coś, czego nie powinno być." })), { minTopics: 1, sourcesFailed: false });
    check("G10 a Polish source gets NO translation block (whatever the model returns)",
      !plDay.post.content.includes("Oryginał") && !plDay.post.content.includes("Tłumaczenie PL") && !plDay.post.content.includes("Coś, czego")
      && plDay.post.daily.topics[0].original === undefined);
    check("G9 originalExcerpt: the whole text when short; else a sentence end or a word + \"…\"; no article marks",
      originalExcerpt("Krótki tekst.") === "Krótki tekst." && originalExcerpt("a ".repeat(400)).endsWith("…") && originalExcerpt("a ".repeat(400)).length <= 301
      && originalExcerpt("**Bold** [link](https://x.y) tekst") === "Bold link(https://x.y) tekst");
  }

  /* ── G: the run ────────────────────────────────────────────────────────────── */
  section("G. THE RUN — no source, no fabrication; review vs automatic; waits; idempotence");
  {
    const g11 = runDb({ stage: "INGEST", ai: true, sources: [] });
    const { result: r11, asked: a11 } = await withModel((u) => answerFor(u), () => runDaily(g11.db, "CRON", 240_000));
    const art11 = recOf(statsOf(r11).article);
    check("G11 no source → no fabricated news: nothing fetched, no model call, no article, outcome no_topics with the reason no_sources",
      r11.status === "done" && statsOf(r11).outcome === "no_topics" && art11.reason === "no_sources" && a11.length === 0
      && g11.of("grovnews_daily_article").every((c) => Array.isArray(c.args.p_item_ids) && c.args.p_item_ids.length === 0)
      && g11.of("grovnews_edition_send").length === 0, JSON.stringify(statsOf(r11)));
    check("G11 …and when every source failed the stats say so (all_sources_failed); nothing met the bar → below_threshold",
      noTopicsReason({ sources: 3, succeeded: 0, failed: 3 }, 0) === "all_sources_failed" && noTopicsReason({ sources: 3, succeeded: 2, failed: 1 }, 0) === "below_threshold");

    const g13 = runDb({ stage: "DONE", claim: { claimed: false, reason: "done", run_id: RUN_ID } });
    const r13 = await runDaily(g13.db, "CRON", 240_000);
    check("G12/G13 a day already DONE: a re-run is skipped — no read, no write, no model, no second edition or campaign",
      r13.status === "skipped" && r13.reason === "done" && g13.calls.map((c) => c.fn).join() === "grovnews_editions_sync,grovnews_run_claim");

    const two = () => [cand(301), cand(302)];
    const article = (args: Record<string, unknown>) => (Array.isArray(args.p_item_ids) && args.p_item_ids.length === 0 ? new Error("invalid_items")
      : { post_id: POST_ID, slug: `grovnews-${RUN_DATE}`, status: "DRAFT", created: true, edition_id: ED_ID, edition_status: "DRAFT", attached: true });
    const g15 = runDb({ stage: "DRAFT", mode: "REVIEW", ai: true, candidates: two, article });
    const { result: r15 } = await withModel((u) => answerFor(u), () => runDaily(g15.db, "CRON", 240_000));
    check("G15 REVIEW mode: the article is written asking NOT to publish, the edition is built unpublished, nothing is sent",
      r15.status === "done" && g15.of("grovnews_daily_article").find((c) => (c.args.p_item_ids as unknown[]).length > 0)?.args.p_publish === false
      && g15.of("grovnews_build_edition")[0]?.args.p_published_only === false && g15.of("grovnews_edition_send").length === 0
      && statsOf(r15).outcome === "draft_review");

    const flagged = composeDaily(DATE, [toTopic(cand(310, { official: false, source_id: UUID(9) }))], copyFor([UUID(310)]), { minTopics: 1, sourcesFailed: false });
    const g16 = runDb({ stage: "DRAFT", mode: "AUTOMATIC", ai: true, candidates: () => [cand(310, { official: false })], article });
    await withModel((u) => answerFor(u), () => runDaily(g16.db, "CRON", 240_000));
    const w16 = g16.of("grovnews_daily_article").find((c) => (c.args.p_item_ids as unknown[]).length > 0);
    check("G16 AUTOMATIC: a topic resting on one unofficial source is not publishable — the run does not even ask to publish, and says why (the DB decides again, SQL G16)",
      flagged.reviewReasons.includes("topic_review") && w16?.args.p_publish === false && String(w16.args.p_review_reason).includes("topic_review"));
    const g16ok = runDb({ stage: "DRAFT", mode: "AUTOMATIC", ai: true, candidates: () => [cand(311, { official: true })], article });
    await withModel((u) => answerFor(u), () => runDaily(g16ok.db, "CRON", 240_000));
    const w16ok = g16ok.of("grovnews_daily_article").find((c) => (c.args.p_item_ids as unknown[]).length > 0);
    check("G16 …a clean day from an official source in AUTOMATIC is written asking to publish (the database re-checks every rule)",
      w16ok?.args.p_publish === true && w16ok.args.p_review_reason === "");

    // publish / send hours
    const at = (h: number) => () => new Date(Date.UTC(2026, 8, 26, h - 2, 30));
    const wp = runDb({ stage: "DRAFT", mode: "AUTOMATIC", ai: true, candidates: two, article, settings: { publish_hour: 9 } });
    const rwp = await runDaily(wp.db, "CRON", 240_000, { now: at(8) });
    check("H1 AUTOMATIC before publish_hour: the run waits at DRAFT (released, nothing written, no model call)",
      rwp.status === "partial" && rwp.reason === "waiting_publish" && rwp.stage === "DRAFT" && wp.of("grovnews_daily_candidates").length === 0
      && wp.of("grovnews_run_update").at(-1)?.args.p_release === true && statsOf(rwp).waiting === "publish");
    const wr = runDb({ stage: "DRAFT", mode: "REVIEW", ai: true, candidates: two, article, settings: { publish_hour: 9 } });
    const { result: rwr } = await withModel((u) => answerFor(u), () => runDaily(wr.db, "CRON", 240_000, { now: at(8) }));
    check("H1 REVIEW mode ignores publish_hour (the draft is written for a person right away; nothing publishes without approval)",
      rwr.status === "done" && wr.of("grovnews_daily_article").some((c) => (c.args.p_item_ids as unknown[]).length > 0));
    const record: DailyRecord = {
      version: 1, date: RUN_DATE, headline: "Nagłówek", opening: "Otwarcie dnia.", mailIntro: "Wstęp.", watch: [], generatedAt: NOW_ISO,
      review: { required: false, reasons: [] },
      topics: [{ itemId: UUID(31), title: "Temat pierwszy", short: "Krótko.", mail: "Treść maila o temacie.", category: null, confidence: "HIGH", official: true, sources: [], review: false, reviewReason: null }],
    };
    const SLUG = `grovnews-${RUN_DATE}`;
    const mailSource = {
      date: RUN_DATE, title: "GrovNews — 26.09.2026", intro: "", article_post_id: POST_ID, daily: record,
      posts: [{ id: POST_ID, slug: SLUG, title: "GrovNews — 26.09.2026", excerpt: "Lead", content: "Treść", email_summary: null, blurb: null }],
    };
    const ws = runDb({ stage: "EDITION", mode: "AUTOMATIC", mailSource, edition: { edition_id: ED_ID, status: "PUBLISHED", created: false, added: 0 }, settings: { send_hour: 10 } });
    const rws = await runDaily(ws.db, "CRON", 240_000, { now: at(9) });
    check("H2 AUTOMATIC, published, before send_hour: the run waits at SEND — no mail door, no operator copy",
      rws.status === "partial" && rws.reason === "waiting_send" && rws.stage === "SEND" && ws.of("grovnews_edition_send").length === 0
      && ws.of("grovnews_operator_recipients").length === 0);
    const mail = fakeMailer();
    const wsend = runDb({ stage: "SEND", mode: "AUTOMATIC", mailSource, edition: { edition_id: ED_ID, status: "PUBLISHED", created: false, added: 0 },
      settings: { send_hour: 10 }, operators: ["redakcja@firma.pl"], stats: { waiting: "send" } });
    const rsend = await runDaily(wsend.db, "CRON", 240_000, { now: at(10), operators: { mailer: async () => mail.mailer } });
    check("H2 at send_hour the mail goes ONCE through the send door; then the operator copy of the same digest (never failing the run)",
      rsend.status === "done" && wsend.of("grovnews_edition_send").length === 1 && statsOf(rsend).outcome === "published_queued"
      && mail.sent.length === 1 && mail.sent[0].to === "redakcja@firma.pl" && mail.closed()
      && JSON.stringify(recOf(statsOf(rsend).operators)) === JSON.stringify({ sent: 1, failed: 0 }) && statsOf(rsend).waiting === null,
      JSON.stringify({ stats: statsOf(rsend), sent: mail.sent.length }));
    const bad = runDb({ stage: "SEND", mode: "AUTOMATIC", mailSource, edition: { edition_id: ED_ID, status: "PUBLISHED", created: false, added: 0 },
      operators: new Error("rpc down") });
    const rbad = await runDaily(bad.db, "CRON", 240_000);
    check("H3 an operator copy that cannot be sent (addresses unreadable) never fails the day",
      rbad.status === "done" && statsOf(rbad).outcome === "published_queued" && recOf(statsOf(rbad).operators).skipped === "unavailable");
  }

  /* ── M: the mail (TS halves) ─────────────────────────────────────────────── */
  section("M. THE DIGEST — built from the published edition, links only to it");
  {
    const SLUG = "grovnews-2026-09-26";
    const record: DailyRecord = {
      version: 1, date: DATE, headline: "Nagłówek dnia", opening: "Otwarcie.", mailIntro: "Dzień dobry.", watch: [], generatedAt: NOW_ISO,
      review: { required: false, reasons: [] },
      topics: [1, 2, 3].map((n) => ({ itemId: UUID(n), title: `Temat ${alpha(n)}`, short: "Krótko.", mail: `Dwa zdania o temacie ${alpha(n)}. Drugie zdanie.`,
        category: null, confidence: "HIGH" as const, official: true, sources: [], review: false, reviewReason: null })),
    };
    const m = composeDailyMail(DATE, record);
    const html = renderDailyMailHtml({ date: DATE, articleSlug: SLUG, mail: m });
    const hrefs = hrefsOf(html);
    check("M9 the digest: \"Najważniejsze dzisiaj\", numbered topics each with \"Czytaj więcej\" → #tN of the article, then \"Otwórz całe dzisiejsze wydanie\" → the article",
      html.includes("Najważniejsze dzisiaj") && (html.match(/Czytaj więcej/g) ?? []).length === 3 && html.includes("Otwórz całe dzisiejsze wydanie")
      && hrefs.join() === [1, 2, 3].map((n) => `${postUrl(SLUG)}#t${n}`).concat(postUrl(SLUG)).join()
      && html.indexOf("1. Temat") < html.indexOf("2. Temat"), hrefs.join(" "));
    const ok = mailBodyDaily(DATE, SLUG, m);
    check("M9 mailBodyDaily accepts the article and its anchors (utm-tagged, the fragment kept)",
      ok.links.length === 4 && ok.links.every((l) => l.startsWith(`${postUrl(SLUG)}?`)) && ok.links.filter((l) => /#t\d$/.test(l)).length === 3);
    const allowed = allowedDigestHrefs(SLUG, 3);
    check("M9 …and refuses anything else: another page, an anchor beyond the topics, a query string, another post",
      !allowed.has(`${postUrl(SLUG)}#t4`) && !allowed.has(`${postUrl(SLUG)}?x=1`) && !allowed.has(postUrl("inny")) && !allowed.has("https://evil.example/")
      && (() => { try { mailBodyDaily(DATE, SLUG, { ...m, intro: "Zobacz https://evil.example/x" }); return false; } catch (e) { return (e as Error).message === "foreign_link"; } })());
    const daily = code(read("lib/server/grovnews/daily.ts"));
    check("M9 the TS guard and the SQL door agree: #t anchors of the same article only (0128 §8 regex)",
      /hrefs\.some\(\(h\) => !allowed\.has\(h\)\)/.test(daily)
      && read("supabase/migrations/0128_grovnews_finalization.sql").includes("'^https://[^/\"?#]+/grovnews/' || v_slug || '(#t[1-9][0-9]?)?$'"));

    // M10: the digest comes only from the edition's own record and PUBLISHED posts.
    const draftOnly = runDb({ stage: "SEND", mode: "AUTOMATIC",
      mailSource: { date: DATE, title: "GrovNews", intro: "", article_post_id: POST_ID, daily: record, posts: [
        { id: UUID(77), slug: "inny-szkic", title: "Inny", excerpt: "", content: "", email_summary: null, blurb: null }] } });
    const r10 = await autoSendEdition(draftOnly.db, null, ED_ID);
    check("M10 an edition whose article is not among its PUBLISHED posts sends nothing (never another draft's text)",
      r10.status === "edition_empty" && draftOnly.of("grovnews_edition_send").length === 0);
    const good = runDb({ stage: "SEND", mode: "AUTOMATIC",
      mailSource: { date: DATE, title: "GrovNews", intro: "", article_post_id: POST_ID, daily: record, posts: [
        { id: POST_ID, slug: SLUG, title: "GrovNews", excerpt: "", content: "", email_summary: null, blurb: null }] } });
    const r10b = await autoSendEdition(good.db, null, ED_ID);
    const body = String(good.of("grovnews_edition_send")[0]?.args.p_body ?? "");
    check("M10 …and a published one sends the digest of ITS record (its topics, its slug)",
      r10b.status === "queued" && body.includes("Temat") && hrefsOf(body).every((h) => h.startsWith(postUrl(SLUG))) && good.of("grovnews_edition_mail_source").length === 1);
  }

  /* ── A: the AI choice and its trace ─────────────────────────────────────── */
  section("A. AI — a choice inside the platform stack, every request traced");
  {
    const oa: VisionBackend = { provider: "openai", cred: { apiKey: "k1" } };
    const go: VisionBackend = { provider: "google", cred: { apiKey: "k2" }, model: "gemini-flash-latest" };
    check("A1 orderBackends: no choice → the platform's order unchanged",
      orderBackends([oa, go], { provider: null, model: null }).map((b) => b.provider).join() === "openai,google");
    const g = orderBackends([oa, go], { provider: "google", model: "gemini-2.5-flash" });
    check("A1 the chosen provider first with the chosen model; the other configured one stays as fallback",
      g.map((b) => b.provider).join() === "google,openai" && g[0].model === "gemini-2.5-flash" && g[1] === oa);
    check("A1 a model id the platform does not offer is ignored (the provider's own default stays)",
      orderBackends([oa, go], { provider: "google", model: "made-up-model" })[0].model === "gemini-flash-latest");
    check("A1 a chosen provider without a working key → the platform's order (never a failure)",
      orderBackends([oa], { provider: "google", model: null }).map((b) => b.provider).join() === "openai"
      && orderBackends([oa], { provider: "google", model: null }, go).map((b) => b.provider).join() === "google,openai");
    check("A1 the model options are the real ids of lib/ai/engine/vision.ts",
      GROVNEWS_MODEL_OPTIONS.openai.join() === "gpt-5,gpt-4.1,gpt-4o" && GROVNEWS_MODEL_OPTIONS.google[0] === "gemini-flash-latest"
      && GROVNEWS_MODEL_OPTIONS.google.includes("gemini-2.5-flash"));

    const tr = runDb({ stage: "DRAFT", mode: "REVIEW", ai: true, candidates: () => [cand(401)], settings: { ai_provider: "openai", ai_model: "gpt-4.1" },
      article: (args) => (Array.isArray(args.p_item_ids) && args.p_item_ids.length === 0 ? new Error("invalid_items")
        : { post_id: POST_ID, slug: "grovnews-x", status: "DRAFT", created: true, edition_id: ED_ID, edition_status: "DRAFT", attached: true }) });
    let usedModel = "";
    const realFetch = globalThis.fetch;
    const { result: rt } = await withModel((u) => answerFor(u), async () => {
      const inner = globalThis.fetch;
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        usedModel = (JSON.parse(String(init?.body ?? "{}")) as { model?: string }).model ?? "";
        return inner(input, init);
      }) as typeof fetch;
      try { return await runDaily(tr.db, "CRON", 240_000); } finally { globalThis.fetch = inner; }
    });
    globalThis.fetch = realFetch;
    const recorded = tr.of("ai_provider_call_record").flatMap((c) => c.args.p_calls as Record<string, unknown>[]);
    const usage = recOf(statsOf(rt).ai_usage);
    check("A2 the daily run uses the chosen model and traces EVERY request: consumer grovnews, actor system, run_ref = the run id",
      usedModel === "gpt-4.1" && recorded.length === 1 && recorded[0].consumer === "grovnews" && recorded[0].actor_kind === "system"
      && recorded[0].run_ref === RUN_ID && recorded[0].provider_slug === "openai" && recorded[0].model === "gpt-4.1", JSON.stringify(recorded));
    check("A2 …and the run's stats count the calls and their cost (tokens × the price list; unknown when no price)",
      usage.calls === 1 && usage.unknown_cost_calls === 1 && usage.cost_usd_micros === 0
      && JSON.stringify(recorded[0]).includes("\"cost_basis\":\"unknown\""), JSON.stringify(usage));
    const adm = runDb({ stage: "X", ai: true });
    const eng = await grovnewsEngine(adm.db, { choice: { provider: null, model: null }, ref: "grovnews:analyze" });
    await withModel(() => ({ ok: true }), () => eng!.ask({ system: "s", user: "{}", schema: {} }));
    const admCalls = adm.of("ai_provider_call_record").flatMap((c) => c.args.p_calls as Record<string, unknown>[]);
    check("A3 an admin action's engine traces its request too (actor admin, run_ref grovnews:<action>), flushed after the call",
      admCalls.length === 1 && admCalls[0].actor_kind === "admin" && admCalls[0].run_ref === "grovnews:analyze" && admCalls[0].cost_basis === "estimated"
      && Number(admCalls[0].cost_usd_micros) === 6250, JSON.stringify(admCalls));
    const noAi = runDb({ stage: "X", ai: false });
    check("A4 no configured provider → no engine (an honest 'unavailable', never a fake answer)",
      (await grovnewsEngine(noAi.db, { choice: { provider: "google", model: null } })) === null);
  }

  /* ── H: settings, operators, health ─────────────────────────────────────── */
  section("H. SETTINGS, OPERATORS, SOURCE AUTH, HEALTH SUMMARIES");
  {
    const base = { mode: "AUTOMATIC", runHour: 6, minRelevance: 60, minImportance: 60, maxTopics: 5, minTopics: 3, lookbackHours: 36 };
    const v0 = validateSettingsInput(base);
    check("H4 existing settings stay valid and mean today's behaviour (no AI preference, no hours, no operators)",
      v0.ok && v0.value.aiProvider === null && v0.value.publishHour === null && v0.value.sendHour === null && v0.value.operatorEmails.length === 0
      && JSON.stringify(settingsFromRow({ mode: "REVIEW" })) === JSON.stringify({ ...DEFAULT_SETTINGS }));
    check("H4 hours must be in order: prepare ≤ publish ≤ send (else 'hours')",
      validateSettingsInput({ ...base, publishHour: 8, sendHour: 9 }).ok
      && !validateSettingsInput({ ...base, publishHour: 5 }).ok && (validateSettingsInput({ ...base, publishHour: 9, sendHour: 8 }) as { error?: string }).error === "hours"
      && !validateSettingsInput({ ...base, sendHour: 24 }).ok);
    check("H4 a model must be one the provider really offers; a model without a provider is refused",
      validateSettingsInput({ ...base, aiProvider: "openai", aiModel: "gpt-4.1" }, GROVNEWS_MODEL_OPTIONS).ok
      && !validateSettingsInput({ ...base, aiProvider: "openai", aiModel: "gemini-2.5-flash" }, GROVNEWS_MODEL_OPTIONS).ok
      && !validateSettingsInput({ ...base, aiModel: "gpt-4.1" }, GROVNEWS_MODEL_OPTIONS).ok
      && !validateSettingsInput({ ...base, aiProvider: "anthropic" }).ok);
    check("H5 operator addresses: normalised, deduped, at most five, all valid — else refused",
      JSON.stringify(parseOperatorEmails("A@x.pl, a@x.pl\nb@y.com")) === JSON.stringify(["a@x.pl", "b@y.com"])
      && parseOperatorEmails("a@x.pl, nie-adres") === null && parseOperatorEmails(Array.from({ length: 6 }, (_, i) => `u${i}@x.pl`)) === null
      && (validateSettingsInput({ ...base, operatorEmails: "x" }) as { error?: string }).error === "operators");
    const none = await sendOperatorCopies(runDb({ stage: "X", operators: [] }).db, { subject: "s", preview: "p", html: "<p>x</p>" });
    const mb = fakeMailer();
    const two = await sendOperatorCopies(runDb({ stage: "X", operators: ["a@x.pl", "b@y.pl"] }).db, { subject: "GrovNews — 26.09.2026", preview: "p", html: "<p>Treść</p>" },
      { mailer: async () => mb.mailer });
    check("H5 operator copies: none configured → nothing; configured → the same digest to each (no [TEST] tag), the mailbox closed",
      JSON.stringify(none) === JSON.stringify({ skipped: "none" }) && JSON.stringify(two) === JSON.stringify({ sent: 2, failed: 0 })
      && mb.sent.map((s) => s.to).join() === "a@x.pl,b@y.pl" && mb.sent.every((s) => s.subject === "GrovNews — 26.09.2026") && mb.closed());

    check("H6 source auth: only API sources carry auth; a header key needs a valid, non-system header name",
      (validateSourceInput({ name: "A", type: "API", url: "https://api.example.com/v1", authKind: "header", authHeader: "X-API-Key" }) as { value?: { authKind: string } }).value?.authKind === "header"
      && (validateSourceInput({ name: "A", type: "RSS", url: "https://x.example.com/f", authKind: "bearer" }) as { value?: { authKind: string } }).value?.authKind === "none"
      && (validateSourceInput({ name: "A", type: "API", url: "https://api.example.com/v1", authKind: "header", authHeader: "Host" }) as { error?: string }).error === "authHeader"
      && (validateSourceInput({ name: "A", type: "API", url: "https://api.example.com/v1", authKind: "header", authHeader: "bad header" }) as { error?: string }).error === "authHeader");
    const acts = code(read("app/actions/grovnews-research.ts"));
    const saveChunk = acts.split("export async function ").find((c) => c.startsWith("saveSourceAction")) ?? "";
    check("H6 the secret never lives in the source row: saveSourceAction writes auth_kind/auth_header only; the vault is written by saveSourceSecretAction (putSecret) and never echoed",
      /auth_kind: v\.authKind, auth_header: v\.authHeader/.test(saveChunk) && !/secret/i.test(saveChunk.replace(/clearSecret\(supabase, sourceSecretName\(res\.data\.id\)\)/, ""))
      && /putSecret\(supabase, name, secret\)/.test(acts) && /after: \{ secret: "replaced" \}/.test(acts)
      && !/return \{ ok: true[^}]*secret[^L]/.test(acts.split("export async function saveSourceSecretAction")[1]?.split("export async function")[0] ?? ""));
    check("H6 no client component reads a secret (the page gets configured + last four, computed in the database)",
      !/readSecret|secret_read/.test(read("components/admin/grovnews/sources.tsx") + read("components/admin/grovnews/source-auth.tsx"))
      && /secretStatuses\(supabase/.test(read("app/admin/newsletter/grovnews/zrodla/page.tsx")));

    check("H7 compact states and methods: HEALTHY→ok, DEGRADED/FAILED/UNSUPPORTED→problem, UNCHECKED→untested, DISABLED→off; RSS/API/WWW",
      sourceState("HEALTHY") === "ok" && sourceState("FAILED") === "problem" && sourceState("UNSUPPORTED") === "problem" && sourceState("UNCHECKED") === "untested"
      && sourceState("DISABLED") === "off" && sourceMethod("ATOM") === "RSS" && sourceMethod("API") === "API" && sourceMethod("WEB_PAGE") === "WWW");
    check("H7 error kinds: timeout / auth (401/403, auth_failed, secret_missing) / http / invalid feed / other",
      sourceErrorKind("timeout") === "timeout" && sourceErrorKind("auth_failed") === "auth" && sourceErrorKind("http_status_403") === "auth"
      && sourceErrorKind("http_status_500") === "http" && sourceErrorKind("unrecognized_format") === "invalid_feed" && sourceErrorKind("dns") === "other");
    const rows = [
      ...Array.from({ length: 69 }, () => ({ enabled: true, health_status: "HEALTHY", last_error: null })),
      { enabled: true, health_status: "DEGRADED", last_error: "timeout" }, { enabled: true, health_status: "DEGRADED", last_error: "timeout" },
      { enabled: true, health_status: "UNSUPPORTED", last_error: "auth_failed" },
      { enabled: true, health_status: null, last_error: null }, { enabled: false, health_status: "FAILED", last_error: "dns" },
    ];
    const hs = await sourceHealthSummary(fakeDb(() => null, { grovnews_sources: rows }).db);
    check("H8 sourceHealthSummary: \"73 sources · 69 OK · 2 timeout · 1 auth\" (+1 untested; the switched-off one only in total)",
      hs.total === 74 && hs.enabled === 73 && hs.ok === 69 && hs.problem === 3 && hs.untested === 1 && hs.byKind.timeout === 2 && hs.byKind.auth === 1
      && hs.byKind.other === 0, JSON.stringify(hs));
    const today = new Date("2026-09-26T09:00:00Z");
    const ts = await todayRunSummary(fakeDb(() => null, {
      grovnews_runs: [{ id: RUN_ID, kind: "DAILY", run_date: "2026-09-26", status: "DONE", stage: "DONE", started_at: "a", finished_at: "b",
        stats: { ingest: { sources: 72, found: 300, inserted: 40, duplicates: 12, stale: 8 }, selected: 5, article: { topics: 4 }, outcome: "published_queued" } }],
      grovnews_editions: [{ id: ED_ID, edition_date: "2026-09-26", status: "QUEUED", campaign_id: UUID(994), email_recipients: 10 }],
      ai_provider_calls: [
        { consumer: "grovnews", run_ref: RUN_ID, request_count: 1, cost_usd_micros: 1200, cost_basis: "estimated" },
        { consumer: "grovnews", run_ref: RUN_ID, request_count: 1, cost_usd_micros: null, cost_basis: "unknown" },
      ],
      newsletter_recipients: [
        { campaign_id: UUID(994), status: "sent", id: "1" }, { campaign_id: UUID(994), status: "sent", id: "2" }, { campaign_id: UUID(994), status: "failed", id: "3" },
      ],
    }).db, today);
    check("H8 todayRunSummary: the run's counts, AI calls and known cost, the edition, its campaign and sent / failed",
      ts.runDate === "2026-09-26" && ts.status === "DONE" && ts.sources === 72 && ts.fetched === 300 && ts.inserted === 40 && ts.duplicates === 12
      && ts.rejected === 8 && ts.accepted === 4 && ts.aiCalls === 2 && ts.aiCostUsdMicros === 1200 && ts.unknownCostCalls === 1
      && ts.editionId === ED_ID && ts.editionStatus === "QUEUED" && ts.campaignId === UUID(994) && ts.recipients === 10 && ts.sent === 2 && ts.failed === 1
      && ts.outcome === "published_queued", JSON.stringify(ts));
    const empty = await todayRunSummary(fakeDb(() => null, {}).db, today);
    check("H8 no run today: nulls, zero calls — nothing guessed",
      empty.status === null && empty.sources === null && empty.aiCalls === 0 && empty.aiCostUsdMicros === null && empty.editionId === null && empty.sent === null);
  }

  /* ── pins ──────────────────────────────────────────────────────────────── */
  section("P. SHAPE — the rules that hold the above in place");
  {
    const mig = read("supabase/migrations/0128_grovnews_finalization.sql");
    check("P1 0128 is additive: no drop of a table / column, every new column nullable or defaulted, a ROLLBACK block",
      !/^\s*drop (table|column)/im.test(mig.replace(/^--.*$/gm, "")) && /add column operator_emails text\[\] not null default '\{\}'::text\[\]/.test(mig)
      && /add column auth_kind text not null default 'none'/.test(mig) && /-- ROLLBACK/.test(mig));
    check("P2 the recipient fix: the mailed address is the verified sign-in address, one contact per person",
      /lower\(c\.email\) = lower\(u\.email\)/.test(mig) && /select distinct on \(u\.id\) c\.id/.test(mig) && /u\.email_confirmed_at is not null/.test(mig));
    check("P3 the cron route is unchanged in shape: POST, token only, runDaily(supabase, \"CRON\", …)",
      /runDaily\(supabase, "CRON", RUN_BUDGET_MS\)/.test(read("app/api/cron/grovnews/route.ts")));
    check("P4 no second mailer / worker / AI stack: operators use bulkMailer + renderCampaign; the engine uses textCapableBackends + callVisionJson",
      /bulkMailer\(/.test(read("lib/server/grovnews/operators.ts")) && /renderCampaign\(/.test(read("lib/server/grovnews/operators.ts"))
      && /textCapableBackends\(db, known\)/.test(read("lib/server/grovnews/ai.ts")) && !/nodemailer/.test(read("lib/server/grovnews/operators.ts")));
  }

  console.log(failed ? `\n${failed} GrovNews Stage 6 test(s) failed.` : "\nAll GrovNews Stage 6 tests passed.");
  process.exit(Math.min(failed, 255));
})().catch((e) => {
  console.error(e);
  process.exit(255);
});
