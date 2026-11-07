import "server-only";
import type { Client } from "@/lib/services/workspace";
import { P } from "@/lib/grovshot-v2/steps";
import { readKb, type KbParsed } from "@/lib/grovshot-shot/kb";
import { DEFAULT_SHOT_SETTINGS, orderStatus, parseShotSettings, type OrderStatus, type ShotSettings } from "@/lib/grovshot-shot/settings";

/**
 * GROVBASE SHOT — what the admin panel reads (Baza wiedzy · Testy). Admin
 * session only (RLS is_admin on every table read here). The run view shows
 * the order step by step: input and references, the card, the plan with its
 * violations, the prompt modules, the final prompt of every shot, every
 * model call (tokens, cache, time, cost, the account's rate limits), the
 * images and the queue — never a key.
 */

export type KbVersionRow = {
  id: string; version: number; active: boolean; status: "draft" | "active" | "archived";
  createdAt: string; activatedAt: string | null; author: string | null; note: string | null;
  sha256: string; sourceSha256: string | null; summary: Record<string, unknown> | null;
};
export type KbEventRow = { id: string; versionId: string; version: number | null; action: string; fromVersion: number | null; note: string | null; actor: string | null; at: string };
export type TestProduct = { id: string; title: string; photos: { path: string; url: string | null }[]; description: string; notes: string };

export type ShotAdmin = {
  versions: KbVersionRow[];
  events: KbEventRow[];
  active: { id: string; version: number; kb: KbParsed } | null;
  settings: ShotSettings;
  settingsErrors: string[];
  model: { ratios: string[]; resolutions: string[]; pricing: Record<string, number> } | null;
  testProducts: TestProduct[];
  queue: { slots: Record<string, number>; open: Record<string, unknown>[] } | null;
};

const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const arr = (v: unknown) => (Array.isArray(v) ? v : []);

export async function readShotAdmin(supabase: Client): Promise<ShotAdmin> {
  const [{ data: rows }, { data: events }, { data: settingsRow }, { data: model }, queue] = await Promise.all([
    supabase.from("knowledge_versions")
      .select("id, version, active, created_at, activated_at, changelog, created_by, content_sha256, source_sha256, summary, parsed")
      .eq("tool_key", "grovshot_shot").order("version", { ascending: false }).limit(100),
    supabase.from("knowledge_version_events").select("id, version_id, action, from_version_id, note, actor, created_at")
      .eq("tool_key", "grovshot_shot").order("created_at", { ascending: false }).limit(50),
    supabase.from("app_settings").select("value").eq("key", "grovshot_shot").maybeSingle(),
    supabase.from("ai_models").select("supported_aspect_ratios, supported_resolutions, pricing").eq("model_identifier", "gemini-3-pro-image").eq("active", true).limit(1).maybeSingle(),
    supabase.rpc("grovshot_shot_queue").then((r) => (r.error ? null : r.data as ShotAdmin["queue"])),
  ]);
  const list = rows ?? [];
  const people = [...new Set([...list.map((r) => r.created_by), ...(events ?? []).map((e) => e.actor)].filter((x): x is string => Boolean(x)))];
  const { data: profiles } = people.length ? await supabase.from("profiles").select("id, email, full_name").in("id", people) : { data: [] };
  const who = (id: string | null) => {
    const p = (profiles ?? []).find((x) => x.id === id);
    return p ? (p.full_name?.trim() || p.email || null) : null;
  };
  const versions: KbVersionRow[] = list.map((r) => ({
    id: r.id, version: r.version, active: r.active,
    status: r.active ? "active" : r.activated_at ? "archived" : "draft",
    createdAt: r.created_at, activatedAt: r.activated_at, author: who(r.created_by), note: r.changelog,
    sha256: r.content_sha256, sourceSha256: r.source_sha256, summary: r.summary ? obj(r.summary) : null,
  }));
  const byId = new Map(list.map((r) => [r.id, r.version]));
  const activeRow = list.find((r) => r.active);
  const activeKb = activeRow ? readKb(activeRow.parsed) : null;
  const parsed = parseShotSettings(settingsRow?.value ?? null);
  const { data: products } = await supabase.from("knowledge_examples")
    .select("id, title, photo_paths, description, notes, set_id, knowledge_sets!inner(scope)")
    .eq("knowledge_sets.scope", "grovshot_shot").not("photo_paths", "is", null).order("created_at").limit(30);
  const testProducts: TestProduct[] = [];
  for (const p of (products ?? []) as unknown as { id: string; title: string | null; photo_paths: string[] | null; description: string | null; notes: string | null }[]) {
    const paths = p.photo_paths ?? [];
    const { data: urls } = paths.length ? await supabase.storage.from("product-images").createSignedUrls(paths, 3600) : { data: [] };
    testProducts.push({
      id: p.id, title: p.title ?? "", description: p.description ?? "", notes: p.notes ?? "",
      photos: paths.map((path, i) => ({ path, url: urls?.[i]?.signedUrl ?? null })),
    });
  }
  return {
    versions,
    events: (events ?? []).map((e) => ({
      id: e.id, versionId: e.version_id, version: byId.get(e.version_id) ?? null, action: e.action,
      fromVersion: e.from_version_id ? byId.get(e.from_version_id) ?? null : null, note: e.note, actor: who(e.actor), at: e.created_at,
    })),
    active: activeRow && activeKb ? { id: activeRow.id, version: activeRow.version, kb: activeKb } : null,
    settings: parsed.ok ? parsed.settings : DEFAULT_SHOT_SETTINGS,
    settingsErrors: parsed.ok ? [] : parsed.errors,
    model: model ? { ratios: model.supported_aspect_ratios ?? [], resolutions: model.supported_resolutions ?? [], pricing: obj(model.pricing) as Record<string, number> } : null,
    testProducts,
    queue: queue ?? null,
  };
}

/** One version's file and parse (preview, comparison). */
export async function readKbVersion(supabase: Client, id: string): Promise<{ version: number; kb: KbParsed; source: string } | null> {
  const { data } = await supabase.from("knowledge_versions").select("version, parsed, source_id").eq("id", id).eq("tool_key", "grovshot_shot").maybeSingle();
  const kb = data ? readKb(data.parsed) : null;
  if (!data || !kb || !data.source_id) return null;
  const { data: src } = await supabase.from("knowledge_sources").select("content").eq("id", data.source_id).maybeSingle();
  return { version: data.version, kb, source: src?.content ?? "" };
}

/* ── the run view ─────────────────────────────────────────────────────────*/

type StepRow = {
  position: number; item_index: number; status: string; attempts: number; duration_ms: number | null; provider_slug: string | null;
  model: string | null; input_tokens: number | null; output_tokens: number | null; cost_usd_micros: number | null; cost_basis: string;
  error_code: string | null; output: unknown; started_at: string | null; finished_at: string | null;
};
export type CallView = {
  step: string; item: number; status: string; provider: string | null; model: string | null; inTokens: number | null; outTokens: number | null;
  cached: number | null; cacheWrite: number | null; ms: number | null; costMicros: number | null; costBasis: string; error: string | null;
  rateLimits: Record<string, number> | null; feedback: boolean; images: number | null; at: string | null;
};
export type ShotRunView = {
  id: string; kind: string; status: string; orderStatus: OrderStatus; error: string | null; createdAt: string; durationMs: number | null;
  credits: number; apiCostMicros: number | null; costUnknown: number; progress: Record<string, unknown>;
  input: {
    photos: { n: number; path: string; url: string | null }[]; shots: number; aspectRatio: string; resolution: string; description: string; notes: string;
    userPlan: unknown; kbVersion: number | null; engineVersion: string | null; testMode: string | null; testProductId: string | null; models: Record<string, unknown> | null;
  };
  pin: Record<string, unknown> | null;
  card: { value: unknown; errors: string[] };
  plan: { shots: unknown[]; violations: unknown; conflicts: unknown; errors: string[] };
  product: unknown;
  scenes: unknown;
  prompts: { numer: number; text: string; sha256: string; modules: unknown; footer: string; pattern: string; references: number[] }[];
  shots: { numer: number; state: string | null; reason: string | null; rounds: Record<string, unknown>[]; imageUrl: string | null; path: string | null }[];
  calls: CallView[];
};

const NAMES: Record<number, string> = { [P.validate]: "pin", [P.card]: "card", [P.plan]: "plan", [P.mirror]: "mirror", [P.round]: "image", [P.charge]: "charge", [P.deliver]: "deliver", [P.mark]: "mark", [P.settle]: "settle" };
const stepName = (pos: number, item: number) => (pos === P.write ? (item >= 30 ? "assemble" : item >= 10 ? "scenes" : "product") : NAMES[pos] ?? String(pos));

export async function readShotRuns(supabase: Client, opts: { ids?: string[]; limit?: number } = {}): Promise<ShotRunView[]> {
  let q = supabase.from("ai_engine_runs")
    .select("id, run_kind, status, error, created_at, duration_ms, credits, api_cost_usd_micros, cost_unknown, progress, input, workspace_id")
    .in("run_kind", ["grovshot", "grovshot_test"]).eq("input->>pipeline", "lifestyle")
    .order("created_at", { ascending: false }).limit(opts.limit ?? 10);
  if (opts.ids) q = q.in("id", opts.ids);
  const { data: runs } = await q;
  if (!runs?.length) return [];
  const { data: steps } = await supabase.from("ai_engine_step_runs")
    .select("run_id, position, item_index, status, attempts, duration_ms, provider_slug, model, input_tokens, output_tokens, cost_usd_micros, cost_basis, error_code, output, started_at, finished_at")
    .in("run_id", runs.map((r) => r.id)).order("position").order("item_index").limit(5000);
  const out: ShotRunView[] = [];
  for (const r of runs) {
    const st = ((steps ?? []) as unknown as (StepRow & { run_id: string })[]).filter((s) => s.run_id === r.id);
    const at = (pos: number, item: number) => st.find((s) => s.position === pos && s.item_index === item);
    const rows = (pos: number, from: number, to: number) => st.filter((s) => s.position === pos && s.item_index >= from && s.item_index < to);
    const input = obj(r.input);
    const photos = arr(input.photos).map(String);
    const { data: urls } = photos.length ? await supabase.storage.from("product-images").createSignedUrls(photos, 3600) : { data: [] };
    const lastOk = (xs: StepRow[]) => [...xs].reverse().find((s) => s.status === "succeeded");
    const card = lastOk(rows(P.card, 0, 10));
    const plan = lastOk(rows(P.plan, 0, 10));
    const product = lastOk(rows(P.write, 0, 10));
    const scenes = lastOk(rows(P.write, 10, 20));
    const assemble = at(P.write, 30);
    const prompts = arr(obj(assemble?.output).shots).map((x) => {
      const o = obj(x);
      return { numer: Number(o.numer), text: String(o.text ?? ""), sha256: String(o.sha256 ?? ""), modules: o.modules, footer: String(o.footer ?? ""), pattern: String(o.pattern ?? ""), references: arr(o.references).map(Number) };
    });
    const planned = Number(obj(r.progress).planned) || Number(input.shots) || 0;
    const shots: ShotRunView["shots"] = [];
    for (let n = 0; n < planned; n++) {
      const settleRow = at(P.settle, n);
      const path = typeof obj(settleRow?.output).path === "string" ? String(obj(settleRow?.output).path) : null;
      let imageUrl: string | null = null;
      if (path) {
        const { data } = await supabase.storage.from("generation-assets").createSignedUrl(path, 3600);
        imageUrl = data?.signedUrl ?? null;
      }
      shots.push({
        numer: n + 1, state: settleRow ? (settleRow.status === "succeeded" ? "delivered" : settleRow.status === "failed" ? "failed" : settleRow.status) : null,
        reason: settleRow?.error_code ?? null,
        rounds: st.filter((s) => s.position === P.round && s.item_index >= n * 5 && s.item_index < n * 5 + 5)
          .map((s) => ({ ...obj(s.output), status: s.status, error_code: s.error_code, duration_ms: s.duration_ms, cost_usd_micros: s.cost_usd_micros })),
        imageUrl, path,
      });
    }
    const calls: CallView[] = st.filter((s) => s.position === P.card || s.position === P.plan || (s.position === P.write && s.item_index < 30) || s.position === P.round)
      .flatMap((s): CallView[] => {
        const o = obj(s.output);
        const tr = obj(o.trace);
        const attempts = arr(tr.attempts).map(obj);
        const base = { step: stepName(s.position, s.item_index), item: s.item_index, status: s.status, ms: s.duration_ms, costMicros: s.cost_usd_micros, costBasis: s.cost_basis, feedback: o.feedback === true, images: typeof o.images === "number" ? o.images : null, at: s.finished_at };
        if (s.position === P.round) {
          return [{ ...base, provider: s.provider_slug, model: s.model, inTokens: null, outTokens: null, cached: null, cacheWrite: null, error: s.error_code ?? (typeof o.error === "string" ? o.error : null), rateLimits: null }];
        }
        if (attempts.length === 0) return [{ ...base, provider: s.provider_slug, model: s.model, inTokens: s.input_tokens, outTokens: s.output_tokens, cached: null, cacheWrite: null, error: s.error_code, rateLimits: null }];
        return attempts.map((a) => ({
          ...base, provider: String(a.provider ?? s.provider_slug ?? ""), model: String(a.model ?? s.model ?? ""),
          inTokens: typeof a.in === "number" ? a.in : null, outTokens: typeof a.out === "number" ? a.out : null,
          cached: typeof a.cached === "number" ? a.cached : null, cacheWrite: typeof a.cache_write === "number" ? a.cache_write : null,
          error: typeof a.error === "string" ? a.error : s.error_code, rateLimits: a.rate_limits ? obj(a.rate_limits) as Record<string, number> : null,
        }));
      });
    const planOut = obj(plan?.output);
    out.push({
      id: r.id, kind: r.run_kind, status: r.status, orderStatus: orderStatus(r), error: r.error || null, createdAt: r.created_at, durationMs: r.duration_ms,
      credits: r.credits ?? 0, apiCostMicros: r.api_cost_usd_micros, costUnknown: r.cost_unknown ?? 0, progress: obj(r.progress),
      input: {
        photos: photos.map((path, i) => ({ n: i + 1, path, url: urls?.[i]?.signedUrl ?? null })), shots: Number(input.shots) || 0,
        aspectRatio: String(input.aspect_ratio ?? ""), resolution: String(input.resolution ?? ""), description: String(input.description ?? ""),
        notes: String(input.notes ?? ""), userPlan: input.user_plan ?? null, kbVersion: Number(obj(input.kb).version) || null,
        engineVersion: typeof input.engine_version === "string" ? input.engine_version : null, testMode: typeof input.test_mode === "string" ? input.test_mode : null,
        testProductId: typeof input.test_product_id === "string" ? input.test_product_id : null,
        models: obj(obj(input.settings).models),
      },
      pin: at(P.validate, -1) ? obj(at(P.validate, -1)!.output) : null,
      card: { value: obj(card?.output).raw ?? null, errors: arr(obj(card?.output).errors).map(String) },
      plan: { shots: arr(obj(planOut.raw).ujecia), violations: obj(r.progress).plan_violations ?? null, conflicts: obj(planOut.raw).konflikty ?? null, errors: arr(planOut.errors).map(String) },
      product: obj(product?.output).raw ?? null,
      scenes: obj(scenes?.output).raw ?? null,
      prompts, shots, calls,
    });
  }
  return out;
}
