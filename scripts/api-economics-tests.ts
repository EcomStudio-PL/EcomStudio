/**
 * API / PROVIDERS / COST ECONOMICS — tests API1–API10 and E1–E7.
 *
 * Behaviour is exercised against a small in-memory Supabase fake and a fake
 * fetch: no network, no real provider, no database. Shape checks read the
 * source where a behaviour cannot be run in isolation (the generation loop).
 *
 *   npm run test:apiecon
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

process.env.GROVBASE_SERVER_KEY = "test-server-key-0123456789abcdef-XYZ";
delete process.env.APP_ENCRYPTION_KEY;

import { providerState, maskKey } from "../lib/provider-status";
import { testProviderConnection } from "../lib/server/provider-test";
import {
  saveProviderCredentialAction, deleteProviderCredentialAction, testProviderConnectionAction,
} from "../app/actions/credentials";
import { retouchModel } from "../lib/server/retouch";
import { recordProviderCalls, textMeter, toRow } from "../lib/server/ai-usage";
import { findTokenPrice, imageCost, tokenCost, type TokenPrice } from "../lib/ai/usage-cost";
import {
  aggregate, eventCost, eventRevenue, eventTool, keptCents, margin, sumCosts, warsawDayStart,
  type CallRow, type EventRow,
} from "../lib/api-economics";
import { grovnewsEconomics, readUsageHistory } from "../lib/services/api-economics";
import { dispatchToken } from "../lib/server/server-token";

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); }
}
const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ── in-memory Supabase fake ──────────────────────────────────────────────*/

type Row = Record<string, unknown>;
type Filter = [string, string, unknown];
type Rpc = (args: Record<string, unknown>) => { data: unknown; error: unknown };

const getPath = (row: Row, path: string): unknown =>
  path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Row)[k] : undefined), row);

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every(([op, col, val]) => {
    const v = getPath(row, col);
    switch (op) {
      case "eq": return v === val;
      case "neq": return v !== val;
      case "in": return (val as unknown[]).includes(v);
      case "is": return val === null ? v === null || v === undefined : v === val;
      case "gt": return String(v) > String(val) || (typeof v === "number" && v > (val as number));
      case "gte": return typeof v === "number" ? v >= (val as number) : String(v) >= String(val);
      case "lte": return typeof v === "number" ? v <= (val as number) : String(v) <= String(val);
      default: return true;
    }
  });
}

class FakeDb {
  tables: Record<string, Row[]> = {};
  rpcs: Record<string, Rpc> = {};
  rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  userId: string | null = "admin-1";
  auth = { getUser: async () => ({ data: { user: this.userId ? { id: this.userId } : null } }) };
  from(table: string) { return new Query(this, table); }
  rpc(name: string, args: Record<string, unknown> = {}) {
    this.rpcCalls.push({ name, args });
    const fn = this.rpcs[name];
    return Promise.resolve(fn ? fn(args) : { data: null, error: { code: "PGRST202", message: "no rpc" } });
  }
  rows(table: string) { return (this.tables[table] ??= []); }
}

class Query implements PromiseLike<{ data: unknown; error: unknown; count?: number }> {
  private filters: Filter[] = [];
  private kind: "select" | "update" | "insert" | "upsert" | "delete" = "select";
  private payload: Row | Row[] | null = null;
  private single = false;
  private head = false;
  private from0 = 0;
  private to0 = Number.MAX_SAFE_INTEGER;
  private returning = false;
  constructor(private db: FakeDb, private table: string) {}
  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.kind !== "select") this.returning = true;
    if (opts?.head) this.head = true;
    return this;
  }
  eq(c: string, v: unknown) { this.filters.push(["eq", c, v]); return this; }
  neq(c: string, v: unknown) { this.filters.push(["neq", c, v]); return this; }
  in(c: string, v: unknown[]) { this.filters.push(["in", c, v]); return this; }
  is(c: string, v: unknown) { this.filters.push(["is", c, v]); return this; }
  gt(c: string, v: unknown) { this.filters.push(["gt", c, v]); return this; }
  gte(c: string, v: unknown) { this.filters.push(["gte", c, v]); return this; }
  lte(c: string, v: unknown) { this.filters.push(["lte", c, v]); return this; }
  order() { return this; }
  limit() { return this; }
  range(a: number, b: number) { this.from0 = a; this.to0 = b; return this; }
  maybeSingle() { this.single = true; return this; }
  single_() { this.single = true; return this; }
  update(p: Row) { this.kind = "update"; this.payload = p; return this; }
  insert(p: Row | Row[]) { this.kind = "insert"; this.payload = p; return this; }
  upsert(p: Row | Row[]) { this.kind = "upsert"; this.payload = p; return this; }
  delete() { this.kind = "delete"; return this; }
  then<A, B>(ok?: ((v: { data: unknown; error: unknown; count?: number }) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.run()).then(ok, bad);
  }
  private run(): { data: unknown; error: unknown; count?: number } {
    const rows = this.db.rows(this.table);
    if (this.kind === "insert" || this.kind === "upsert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
      for (const r of list) {
        if (this.kind === "upsert" && this.table === "app_settings") {
          const i = rows.findIndex((x) => x.key === r.key);
          if (i >= 0) { rows[i] = { ...rows[i], ...r }; continue; }
        }
        rows.push({ ...r });
      }
      return { data: this.single ? list[0] : list, error: null };
    }
    const hit = rows.filter((r) => matches(r, this.filters));
    if (this.kind === "update") {
      for (const r of hit) Object.assign(r, this.payload);
      return { data: this.single ? hit[0] ?? null : hit, error: null };
    }
    if (this.kind === "delete") {
      this.db.tables[this.table] = rows.filter((r) => !hit.includes(r));
      return { data: null, error: null };
    }
    if (this.head) return { data: null, error: null, count: hit.length };
    const page = hit.slice(this.from0, this.to0 + 1);
    return { data: this.single ? page[0] ?? null : page, error: null };
  }
}

const g = globalThis as unknown as { __apiFakeDb?: unknown };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function providerDb(opts: { key?: string | null; legacy?: boolean; active?: boolean; hashPublished?: boolean; credential?: boolean }) {
  const db = new FakeDb();
  db.tables.profiles = [{ id: "admin-1", role: "admin" }];
  db.tables.ai_providers = [{ id: "p1", slug: "openai", active: opts.active ?? true, metadata: {} }];
  db.tables.ai_provider_credentials = opts.credential === false ? [] : [{
    id: "c1", provider_id: "p1", base_url: null, last_four: "abcd",
    encrypted_value: opts.legacy ? "bGVnYWN5" : "vault", iv: opts.legacy ? "aXY=" : "vault", auth_tag: opts.legacy ? "dGFn" : "vault",
    updated_at: "2026-09-01T00:00:00Z",
  }];
  const token = dispatchToken() ?? "";
  db.tables.app_settings = opts.hashPublished === false ? [] : [{ key: "notifications", value: { dispatch_hash: sha(token) } }];
  db.rpcs.provider_credential_read = (args) => {
    const hash = (db.rows("app_settings").find((r) => r.key === "notifications")?.value as Row | undefined)?.dispatch_hash;
    if (hash !== sha(String(args.p_token))) return { data: null, error: { code: "P0001", message: "forbidden" } };
    const p = db.rows("ai_providers").find((r) => r.id === args.p_provider_id);
    const c = db.rows("ai_provider_credentials").find((r) => r.provider_id === args.p_provider_id);
    return { data: p?.active && c ? [{ encrypted_value: c.encrypted_value, iv: c.iv, auth_tag: c.auth_tag, base_url: c.base_url }] : [], error: null };
  };
  db.rpcs.secret_read = (args) => ({ data: args.p_name === "grovbase.provider.p1" && opts.key ? opts.key : null, error: null });
  db.rpcs.secret_put = () => ({ data: true, error: null });
  db.rpcs.secret_clear = () => ({ data: true, error: null });
  db.rpcs.provider_health_set = () => ({ data: null, error: null });
  db.rpcs.log_activity = () => ({ data: null, error: null });
  return db;
}

const realFetch = globalThis.fetch;
function fakeFetch(handler: (url: string, init?: RequestInit) => { status: number; body?: string }) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const r = handler(url, init);
    return new Response(r.body ?? "{}", { status: r.status });
  }) as typeof fetch;
}
const authOf = (init?: RequestInit) => new Headers(init?.headers).get("authorization") ?? "";

async function main() {
  console.log("\nA. Provider status (pure)");
  check("no credential → not_configured", providerState(null).state === "not_configured");
  const base = { readable: true, updatedAt: "2026-09-01T00:00:00Z", lastTestedAt: null, lastTestStatus: null, lastSuccessAt: null, lastErrorAt: null, lastErrorCode: null };
  check("a stored key alone is never connected", providerState(base).state === "untested");
  check("unreadable key → error key_unreadable", providerState({ ...base, readable: false }).reason === "key_unreadable");
  check("green test after the key change → connected",
    providerState({ ...base, lastTestedAt: "2026-09-02T00:00:00Z", lastTestStatus: "connected" }).state === "connected");
  check("green test BEFORE the key change → not connected",
    providerState({ ...base, updatedAt: "2026-09-03T00:00:00Z", lastTestedAt: "2026-09-02T00:00:00Z", lastTestStatus: "connected" }).state === "untested");
  check("failed test → error with the verdict",
    providerState({ ...base, lastTestedAt: "2026-09-02T00:00:00Z", lastTestStatus: "auth_failed" }).reason === "auth_failed");
  check("newest real call failed → error runtime:<code>",
    providerState({ ...base, lastTestedAt: "2026-09-02T00:00:00Z", lastTestStatus: "connected", lastSuccessAt: "2026-09-03T00:00:00Z", lastErrorAt: "2026-09-04T00:00:00Z", lastErrorCode: "provider_rate_limited" }).reason === "runtime:provider_rate_limited");
  check("mask keeps case and only four characters", maskKey("aBcD") === "•••• aBcD" && maskKey("1234567890") === "•••• 7890");

  console.log("\nB. Real, cheapest connection probes");
  fakeFetch((url, init) => ({ status: url.includes("api.openai.com/v1/models") && authOf(init) === "Bearer good" ? 200 : 401 }));
  const ok = await testProviderConnection("openai", "good");
  check("API1 valid key → connected (with measured latency)", ok.status === "connected" && typeof ok.latencyMs === "number", ok);
  const bad = await testProviderConnection("openai", "bad");
  check("API2 wrong key → auth_failed (code, not a provider message)", bad.status === "auth_failed" && bad.detail === "http_401", bad);
  fakeFetch(() => ({ status: 400 }));
  check("google 400 → auth_failed", (await testProviderConnection("google", "x")).status === "auth_failed");
  fakeFetch(() => ({ status: 503 }));
  check("fal 5xx is NOT connected any more", (await testProviderConnection("fal", "x")).status === "unavailable");
  fakeFetch(() => ({ status: 404 }));
  const fal404 = await testProviderConnection("fal", "x");
  check("fal 404 (auth passed, path unknown) → connected, flagged 'reachable'", fal404.status === "connected" && fal404.detail === "reachable");
  fakeFetch(() => ({ status: 401 }));
  check("fal 401 → auth_failed", (await testProviderConnection("fal", "x")).status === "auth_failed");
  check("provider without a probe → unsupported, never connected", (await testProviderConnection("stability", "x")).status === "unsupported");
  fakeFetch(() => ({ status: 200 }));
  check("trailing slash in base URL is trimmed", (await testProviderConnection("openai", "good", "https://api.openai.com/")).status === "connected");

  console.log("\nC. Connection test through the RUNTIME door (actions)");
  fakeFetch((url, init) => ({ status: authOf(init) === "Bearer sk-good-key" ? 200 : 401 }));
  let db = providerDb({ key: "sk-good-key" });
  g.__apiFakeDb = db;
  const r1 = await testProviderConnectionAction("p1");
  const cred1 = db.rows("ai_provider_credentials")[0];
  check("API1 action: vault key + provider accepts → connected", r1.ok && r1.status === "connected", r1);
  check("API1 verdict + latency stored on the row", cred1.last_test_status === "connected" && typeof cred1.last_test_latency_ms === "number");
  check("API1 runtime door was used (provider_credential_read with the server token)",
    db.rpcCalls.some((c) => c.name === "provider_credential_read" && c.args.p_token === dispatchToken()));
  check("API3 the action result never carries the key", !JSON.stringify(r1).includes("sk-good-key"));
  check("API3 the stored row never carries the key", !JSON.stringify(cred1).includes("sk-good-key"));

  db = providerDb({ key: "sk-wrong" }); g.__apiFakeDb = db;
  const r2 = await testProviderConnectionAction("p1");
  check("API2 action: wrong key → auth_failed, ok=false", !r2.ok && r2.status === "auth_failed", r2);
  check("API2 failure recorded on the row", db.rows("ai_provider_credentials")[0].last_test_status === "auth_failed");

  db = providerDb({ key: "sk-good-key", credential: false }); g.__apiFakeDb = db;
  const r5 = await testProviderConnectionAction("p1");
  check("API5 no credential → controlled no_credential, ok=false", !r5.ok && r5.status === "no_credential", r5);

  db = providerDb({ key: null, legacy: true }); g.__apiFakeDb = db;
  const r5b = await testProviderConnectionAction("p1");
  check("API5 legacy ciphertext without its decryption key → key_unreadable (no fake green)", !r5b.ok && r5b.status === "key_unreadable", r5b);
  check("API5 key_unreadable is written to the row", db.rows("ai_provider_credentials")[0].last_test_status === "key_unreadable");

  db = providerDb({ key: "sk-good-key", hashPublished: false }); g.__apiFakeDb = db;
  const r6 = await testProviderConnectionAction("p1");
  check("missing server-token hash is published by the test, then the runtime door works", r6.ok && r6.status === "connected", r6);

  db = providerDb({ key: "sk-good-key", active: false }); g.__apiFakeDb = db;
  const r7 = await testProviderConnectionAction("p1");
  check("inactive provider is still testable (activate-after-green flow)", r7.ok && r7.status === "connected", r7);

  db = providerDb({ key: null }); g.__apiFakeDb = db;
  const saved = await saveProviderCredentialAction("p1", "sk-new-secret-9876");
  const row = db.rows("ai_provider_credentials")[0];
  check("save: key goes to the vault only (secret_put), row keeps 'vault' + last four",
    saved.ok && row.encrypted_value === "vault" && row.last_four === "9876" && !JSON.stringify(row).includes("sk-new-secret"));
  check("save: the new key has proven nothing — old verdicts cleared",
    row.last_test_status === null && row.last_image_test_status === null && row.last_success_at === null && row.last_error_at === null);
  check("save: publishes the server-token hash so the runtime can read the key",
    db.rows("app_settings").some((r) => r.key === "notifications"));
  const del = await deleteProviderCredentialAction("p1");
  check("delete: clears the vault secret too", del.ok && db.rpcCalls.some((c) => c.name === "secret_clear" && c.args.p_name === "grovbase.provider.p1"));
  check("delete: row gone", db.rows("ai_provider_credentials").length === 0);

  console.log("\nD. Tool → provider/model (Retusz reads the panel's assignment)");
  const retouchDb = (row: Row | null) => {
    const d = new FakeDb();
    d.tables.ai_models = [
      { id: "m-default", model_identifier: "gemini-3-pro-image-preview", active: true, supported_resolutions: ["1K"], supported_aspect_ratios: ["1:1"], pricing: { "1K": 7 }, credit_cost: 7, ai_providers: { active: true } },
      { id: "m2", model_identifier: "gpt-image-2", active: true, supported_resolutions: ["1K"], supported_aspect_ratios: ["1:1"], pricing: { "1K": 4 }, credit_cost: 4, ai_providers: { active: true } },
    ];
    d.tables.app_settings = [];
    d.rpcs.ai_tool_runtime = () => ({ data: row ? [row] : [], error: null });
    return d;
  };
  const rt = (primary: string | null, fallback: string | null, enabled: boolean) => ({
    tool_key: "retouch", engine_mode: "grovbase", service_slug: "image_edit", allow_model_choice: false,
    fallback_enabled: enabled, timeout_ms: 120000, max_attempts: 1, primary_model_id: primary, fallback_model_id: fallback,
    prompt_encrypted: null, prompt_iv: null, prompt_tag: null, prompt_version: null, knowledge_strategy: "proven",
  });
  const noAssign = await retouchModel(retouchDb(rt(null, null, false)) as unknown as Parameters<typeof retouchModel>[0]);
  check("API4 no assignment → the tool's long-standing default model (unchanged behaviour)", noAssign?.id === "m-default" && noAssign.pricing["1K"] === 7);
  const assigned = await retouchModel(retouchDb(rt("m2", "m-default", false)) as unknown as Parameters<typeof retouchModel>[0]);
  check("API4 assigned primary is the model the tool runs on (and is priced from)", assigned?.id === "m2" && assigned.pricing["1K"] === 4);
  check("API6 fallback NOT used when the fallback switch is off", assigned?.fallbackId === null);
  const withFb = await retouchModel(retouchDb(rt("m2", "m-default", true)) as unknown as Parameters<typeof retouchModel>[0]);
  check("API6 fallback used only when configured AND enabled", withFb?.fallbackId === "m-default");
  const retouchSrc = code("lib/server/retouch.ts");
  check("API6 fallback reaches runGeneration only through fallbackModelIds", /fallbackModelIds: \[model\.fallbackId\]/.test(retouchSrc));
  const actionsSrc = code("app/actions/ai-tools.ts");
  check("assignments for a runtime-read tool must be reference-capable image models", /model_incompatible/.test(actionsSrc) && /MODEL_ASSIGNMENT_RUNTIME\.has/.test(actionsSrc));
  check("a failed clear stops the model save (no insert on top)", /if \(clearError\) return/.test(actionsSrc));

  console.log("\nE. Usage trace (who, what, which provider/model, units)");
  const traceDb = new FakeDb();
  let recorded: Row[] = [];
  traceDb.rpcs.ai_provider_call_record = (args) => { recorded = recorded.concat(args.p_calls as Row[]); return { data: (args.p_calls as Row[]).length, error: null }; };
  traceDb.rpcs.ai_token_prices_read = () => ({ data: [{ provider_slug: "google", model: "gemini-flash-latest", input_usd_micros_per_mtok: 300000, output_usd_micros_per_mtok: 2500000 }], error: null });
  const meter = textMeter(traceDb as unknown as Parameters<typeof textMeter>[0], { actorKind: "system", consumer: "grovnews", runRef: "run-1" });
  const wrapped = meter.wrap([{ provider: "google", cred: { apiKey: "k" } }, { provider: "openai", cred: { apiKey: "k" } }]);
  wrapped[0].meter?.({ provider: "google", model: "gemini-flash-latest", ok: true, durationMs: 800, inputTokens: 1000, outputTokens: 200 });
  wrapped[1].meter?.({ provider: "openai", model: "gpt-4.1", ok: false, durationMs: 50, error: "analysis_rate_limited" });
  await meter.flush();
  const gRow = recorded.find((r) => r.provider_slug === "google");
  const oRow = recorded.find((r) => r.provider_slug === "openai");
  check("API7 provider + model recorded exactly as the request used them", gRow?.model === "gemini-flash-latest" && oRow?.model === "gpt-4.1");
  check("API7 who/what: system actor, grovnews consumer, run id", gRow?.actor_kind === "system" && gRow?.consumer === "grovnews" && gRow?.run_ref === "run-1");
  check("API7 reported tokens carried, never invented", gRow?.input_tokens === 1000 && gRow?.output_tokens === 200 && oRow?.input_tokens === null);
  check("API8 token call with a price → ESTIMATED cost", gRow?.cost_basis === "estimated" && gRow?.cost_usd_micros === Math.round((1000 * 300000 + 200 * 2500000) / 1e6));
  check("API8 token call without a price → UNKNOWN (null, not 0)", oRow?.cost_basis === "unknown" && oRow?.cost_usd_micros === null);
  check("API9 failed request is recorded as failed with its code", oRow?.status === "failed" && oRow?.error_code === "analysis_rate_limited");
  check("flush is idempotent (nothing recorded twice)", (await meter.flush()) === 0 && recorded.length === 2);
  recorded = [];
  const many = Array.from({ length: 60 }, () => ({ actorKind: "system" as const, consumer: "embeddings" as const, providerSlug: "openai", status: "succeeded" as const, cost: { basis: "unknown" as const } }));
  const kept = await recordProviderCalls(traceDb as unknown as Parameters<typeof recordProviderCalls>[0], many);
  check("batches of ≤50 per RPC (60 rows → 2 calls, all kept)", kept === 60 && traceDb.rpcCalls.filter((c) => c.name === "ai_provider_call_record").length === 3);
  const img = toRow({ actorKind: "customer", consumer: "generation", providerSlug: "google", status: "succeeded", units: 2, unitKind: "image", cost: imageCost(39000, 2) });
  check("API8 image call: images as units, cost = per-image × images, ESTIMATED; no fake tokens",
    img.units === 2 && img.unit_kind === "image" && img.cost_usd_micros === 78000 && img.cost_basis === "estimated" && img.input_tokens === null);
  check("API8 image model with no configured cost → unknown, not free", imageCost(null, 1).basis === "unknown");
  const prices: TokenPrice[] = [{ providerSlug: "openai", model: "gpt-4.1", inputPerMTok: 2_000_000, outputPerMTok: 8_000_000 }];
  check("token price: exact id or longest listed prefix", findTokenPrice(prices, "openai", "gpt-4.1-2025-04-14")?.model === "gpt-4.1" && findTokenPrice(prices, "google", "gpt-4.1") === null);
  check("token cost unknown without provider-reported tokens", tokenCost(prices, "openai", "gpt-4.1", null, null).basis === "unknown");

  const gen = code("lib/server/generation.ts");
  check("API7 generation traces every attempt (success and failure) with the serving provider/model",
    (gen.match(/traceCall\(\{/g) ?? []).length === 2 && /providerSlug: cProviderSlug, model: cModel, ok: true/.test(gen) && /providerSlug: cProviderSlug, model: cModel, ok: false/.test(gen));
  check("API7 generation flushes the trace on every exit (failed, storage failed, completed)", (gen.match(/await recordProviderCalls\(supabase, providerCalls\)/g) ?? []).length === 3);
  check("image tools, prompt engine, workflows and embeddings are traced",
    /recordProviderCalls\(supabase, \[trace\(true/.test(code("lib/server/image-tools.ts"))
    && /consumer: "prompt_engine"/.test(code("lib/server/prompt-engine.ts"))
    && /consumer: "workflow"/.test(code("lib/server/engine/tool-run.ts"))
    && /consumer: "embeddings"/.test(code("lib/server/knowledge.ts")));
  const vision = code("lib/ai/engine/vision.ts");
  check("vision layer meters BOTH successful and failed requests", /meter\(backend, \{ provider: backend\.provider, model, ok: true/.test(vision) && /ok: false, durationMs/.test(vision));

  console.log("\nF. Revenue, cost and margin (E1–E7)");
  const ev = (o: Partial<EventRow>): EventRow => ({
    id: "e", created_at: "2026-09-20T10:00:00Z", workspace_id: "w1", user_id: "u1", service_slug: "image_generation",
    provider_slug: "google", model_slug: "m", status: "succeeded", credits_charged: 4, result_count: 1,
    actual_api_cost_usd_micros: 39000, api_cost_usd_micros_snapshot: 0, metadata: {}, ...o,
  });
  // Workspace paid 19.00 zł and was granted 100 purchased + 100 bonus credits.
  const money = { paidCents: 1900, grantedCredits: 200 };
  const paid = eventRevenue(ev({}), money);
  check("E1 paid credits → proportional revenue (4 cr × 1900 / 200 = 38 gr)", paid.kind === "paid" && paid.cents === 38, paid);
  check("E2 bonus-only workspace → revenue 0, kind bonus (never 'we earned X')", JSON.stringify(eventRevenue(ev({}), { paidCents: 0, grantedCredits: 500 })) === JSON.stringify({ kind: "bonus", cents: 0 }));
  check("E3 free run (0 credits) → revenue 0, kind free", eventRevenue(ev({ credits_charged: 0 }), money).kind === "free");
  const costs = [{ usdMicros: 39000, basis: "estimated" as const }, { usdMicros: 1000, basis: "actual" as const }, { usdMicros: null, basis: "unknown" as const }];
  const s = sumCosts(costs);
  check("E4 provider cost sums the known parts and COUNTS the unknown one", s.usdMicros === 40000 && s.unknown === 1 && s.basis === "estimated");
  const m = margin(paid, { usdMicros: 39000, basis: "estimated" }, 4);
  check("E5 margin = revenue − cost (38 gr − 15.6 gr ≈ 22 gr)", m.cents === 38 - 16 && m.percent !== null, m);
  check("margin is not computed on an unknown cost", margin(paid, { usdMicros: null, basis: "unknown" }, 4).cents === null);
  const refunded = ev({ status: "refunded", credits_charged: 0, actual_api_cost_usd_micros: 39000 });
  check("E6 refunded run: revenue 0 but its provider cost still counts", eventRevenue(refunded, money).cents === 0 && eventCost(refunded, undefined).usdMicros === 39000);
  const agg = aggregate([
    { event: ev({}), calls: [], revenue: paid, cost: eventCost(ev({}), undefined) },
    { event: refunded, calls: [], revenue: eventRevenue(refunded, money), cost: eventCost(refunded, undefined) },
  ], 4);
  check("E6 failed/refunded usage cannot inflate the margin", agg.failed === 1 && agg.revenueCents === 38 && (agg.marginCents ?? 0) < 38 - 16);
  check("API10 aggregate cost equals the sum of the raw events' costs", agg.cost.usdMicros === 78000);
  check("API9 a failed run is not a successful paid run", agg.succeeded === 1 && agg.paidRuns === 1);
  check("legacy recorded cost is ESTIMATED (price table), never 'measured'", eventCost(ev({}), undefined).basis === "estimated");
  check("legacy failed run with nothing recorded → unknown, not 0", eventCost(ev({ status: "failed", actual_api_cost_usd_micros: 0, credits_charged: 0 }), undefined).basis === "unknown");
  const traced: CallRow[] = [
    { id: "c1", created_at: "", actor_kind: "customer", consumer: "generation", tool_key: "retouch", usage_event_id: "e", provider_slug: "google", model: "x", status: "failed", request_count: 1, input_tokens: null, output_tokens: null, units: 1, unit_kind: "image", cost_usd_micros: 39000, cost_basis: "estimated", duration_ms: 1 },
    { id: "c2", created_at: "", actor_kind: "customer", consumer: "generation", tool_key: "retouch", usage_event_id: "e", provider_slug: "openai", model: "y", status: "succeeded", request_count: 1, input_tokens: null, output_tokens: null, units: 1, unit_kind: "image", cost_usd_micros: 40000, cost_basis: "estimated", duration_ms: 1 },
  ];
  check("a traced run costs ALL its attempts (a billed partial before a fallback included)", eventCost(ev({}), traced).usdMicros === 79000);
  const maps = { s: new Map([["tool_compress", "compress"]]), k: new Set(["retouch", "fashion_iron", "compress"]) };
  check("tool attribution: trace tool_key wins", eventTool(ev({}), traced, maps.s, maps.k) === "retouch");
  check("tool attribution: Retusz from the operation (was booked as image_generation)", eventTool(ev({ metadata: { operation: "image_retouch" } }), undefined, maps.s, maps.k) === "retouch");
  check("tool attribution: Moda from the operation", eventTool(ev({ metadata: { operation: "fashion_iron" } }), undefined, maps.s, maps.k) === "fashion_iron");
  check("tool attribution: GrovShot from the prompt session", eventTool(ev({ metadata: { session_id: "s" } }), undefined, maps.s, maps.k) === "prompts");
  check("tool attribution: service → tool map", eventTool(ev({ service_slug: "tool_compress" }), undefined, maps.s, maps.k) === "compress");
  check("partially refunded payment keeps only the money kept", keptCents({ amount_cents: 1900, status: "partially_refunded", metadata: { refund: { amount_cents: 400 } } }) === 1500 && keptCents({ amount_cents: 1900, status: "refunded", metadata: {} }) === 0);
  const noon = new Date("2026-09-26T10:00:00Z");
  check("'today' starts at Europe/Warsaw midnight", warsawDayStart(noon).toISOString() === "2026-09-25T22:00:00.000Z");

  // E7 — system jobs: cost yes, "customer paid" no.
  const hist = new FakeDb();
  hist.tables.usage_events = [];
  hist.tables.ai_tools = [];
  hist.tables.app_settings = [{ key: "billing", value: { usd_to_pln: 4 } }];
  const nowIso = new Date().toISOString();
  hist.tables.ai_provider_calls = [{ id: "g1", created_at: nowIso, actor_kind: "system", consumer: "grovnews", tool_key: null, usage_event_id: null, provider_slug: "google", model: "gemini-flash-latest", status: "succeeded", request_count: 1, input_tokens: 5000, output_tokens: 900, units: null, unit_kind: null, cost_usd_micros: 4000, cost_basis: "estimated", duration_ms: 900 }];
  const h = await readUsageHistory(hist as unknown as Parameters<typeof readUsageHistory>[0], { days: 7 });
  const sys = h.rows[0];
  check("E7 GrovNews job appears in history WITH its cost", sys?.kind === "system" && sys.costUsdMicros === 4000 && sys.costBasis === "estimated");
  check("E7 …and is never shown as 'customer paid' (kind system, no margin)", sys?.revenue.kind === "system" && sys.marginCents === null);
  hist.tables.grovnews_editions = [];
  hist.tables.grovnews_subscriptions = [{ status: "active", unit_amount_cents: 2900, currency: "pln", paid_through: "2099-01-01T00:00:00Z" }];
  hist.tables.grovnews_invoices = [{ amount_paid_cents: 2900, currency: "pln", paid_at: nowIso }];
  hist.tables.grovnews_entitlements = [{ source: "LAUNCH_BONUS", status: "ACTIVE", starts_at: "2026-01-01T00:00:00Z", expires_at: null }];
  const gn = await grovnewsEconomics(hist as unknown as Parameters<typeof grovnewsEconomics>[0]);
  check("E7 GrovNews economics: AI cost from its own trace, MRR from live subscriptions",
    gn.days30.aiCostUsdMicros === 4000 && gn.mrrCents === 2900 && gn.activePaid === 1 && gn.launchActive === 1, gn);
  check("E7 GrovNews margin = money received − AI cost (estimated)", gn.margin30Cents === 2900 - 2 && gn.marginNote === "estimated", gn.margin30Cents);

  console.log("\nG. Secrets never reach the client (API3)");
  const card = read("components/admin/provider-card.tsx");
  check("provider card is a client component that only receives masked metadata",
    card.startsWith('"use client"') && !/encrypted_value|apiKey:|auth_tag|decrypt/.test(card));
  const page = code("app/admin/ai/modele/page.tsx");
  const viewBlock = page.slice(page.indexOf("credential: c ? {"), page.indexOf("} : null,", page.indexOf("credential: c ? {")));
  check("the view object sent to the card has no ciphertext field", viewBlock.length > 0 && !/encrypted_value|iv:|auth_tag/.test(viewBlock));
  check("no provider key in any NEXT_PUBLIC variable", !/NEXT_PUBLIC_[A-Z_]*(OPENAI|GEMINI|GOOGLE_AI|FAL|ANTHROPIC)/.test(read(".env.example")));
  check("usage trace + token prices are admin-read / token-written only (migration)",
    /create policy ai_provider_calls_admin_read[\s\S]*using \(public\.is_admin\(\)\)/.test(read("supabase/migrations/0127_ai_provider_calls.sql"))
    && /if not public\.server_call_ok\(p_token\) then raise exception 'forbidden'/.test(read("supabase/migrations/0127_ai_provider_calls.sql")));

  globalThis.fetch = realFetch;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
