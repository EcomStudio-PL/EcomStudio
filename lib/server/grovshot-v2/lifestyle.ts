import "server-only";
import { randomUUID } from "node:crypto";
import type { Json } from "@/lib/database.types";
import type { Client } from "@/lib/services/workspace";
import { dispatchToken } from "@/lib/server/server-token";
import { promptKeyring, type PromptKeyring } from "@/lib/server/prompt-vault";
import { recordProviderCalls } from "@/lib/server/ai-usage";
import { patchRun, type RunRow } from "@/lib/server/engine/workflow-store";
import { encryptConceptPayload } from "@/lib/server/prompt-engine";
import { roleBackends } from "@/lib/server/grovshot-v2/backends";
import { buildFidelityInstructions } from "@/lib/ai/product-lock";
import type { AspectRatio, Resolution } from "@/lib/ai/types";
import type { VisionBackend } from "@/lib/ai/engine/vision";
import { blockStateOf } from "@/lib/server/account-block";
import { getAvailabilityMap } from "@/lib/server/feature-availability";
import { defaultStateFor } from "@/lib/features";
import { P, itemOf } from "@/lib/grovshot-v2/steps";
import type { StageModel } from "@/lib/grovshot-v2/config";
import type { ShotStageKey, StageCall } from "@/lib/server/grovshot-v2/stage-call";
import { dimensionsOf, forImageModel, forVision, readOrderPhotos, sha256 } from "@/lib/server/grovshot-v2/media";
import { imageUnitPrice, readEngineState } from "@/lib/server/grovshot-v2/settings";
import { freshBalance } from "@/lib/server/grovshot-v2/library";
import { srvContext, srvMirror, srvStorageGrant } from "@/lib/server/grovshot-v2/srv";
import {
  DELIVER_RESERVE_MS, MAX_ORDER_AGE_MS, STALL_LEASE_S, WIND_DOWN_INVOCATIONS,
  addNotes, begin, close, closeEarly, closeRun, deliver, finish, left, outputOf, photos, readRunRow, readSteps,
  recoverDelivery, rowsOf, setProgress, settle, settled, srv, stepOf,
  type AdvanceResult, type CoreCtx, type CoreInput, type Drive, type GrovshotDeps, type Mirror, type ShotOutcome, type SlotStore,
} from "@/lib/server/grovshot-v2/run";
import { kbInstructions, readKb, type KbParsed } from "@/lib/grovshot-shot/kb";
import {
  CARD_SCHEMA, FRAMES, LIGHTS, PLAN_SCHEMA, PRODUCT_SCHEMA, SCENES_SCHEMA, SHOT_ENGINE_VERSION, contractText, wrapData,
} from "@/lib/grovshot-shot/contract";
import { checkCard, photoId, validationFeedback, type ProductCard } from "@/lib/grovshot-shot/card";
import { checkPlan, parseUserPlan, planFeedback, planForPrompt, renderUserPlan, type PlanShot, type UserPlanRow, type Violation } from "@/lib/grovshot-shot/plan";
import { assemblePrompt, checkProductModules, checkSceneModules, type AssembledPrompt, type ProductModules, type SceneModules } from "@/lib/grovshot-shot/prompt";
import {
  classifyImageError, nextImageAttempt, parseShotSettings, type ImageErrorClass, type ShotSettings, type ShotStep,
} from "@/lib/grovshot-shot/settings";

/**
 * GROVBASE SHOT — THE LIFESTYLE PIPELINE ("jak działa automatyzacja", kroki 2–5).
 *
 * One order = one ai_engine_runs row, every unit one ai_engine_step_runs row
 * (the store, lease and per-step idempotency of V2 — nothing finished is
 * executed or paid for twice). Every Claude request and every Nano Banana
 * Pro request is its OWN row, so a retry is a new row, never a repeat:
 *
 *   1  · -1        pin: the photos' hashes, the official image price, the order's spend cap
 *   2  · 0…7       step 2, the product card (a repeat with the validation errors; transient retries)
 *   3  · 0…7       step 3, the shot plan (a repeat with the violations; then it goes on, recorded)
 *   10 · 0…7       step 4, call 1: PRODUKT + SKALA
 *   10 · 10…17     step 4, call 2: the scene modules of every shot at once
 *   10 · 30        the assembled prompt of every shot (text, modules, sha256)
 *   4  · -1        the customer-visible mirror (session + concepts, sealed)
 *   5  · shot·5+k  step 5: ONE Nano Banana Pro call of a shot (k = 0, 1, 2)
 *   6–8            the shot's charge, delivery, server mark (V2's, unchanged)
 *   9  · shot      the shot's final state
 *
 * No image QC, no second candidate, no prompt rewrite after an image: a shot
 * is one generation; a technical failure (timeout, 5xx, 429) is retried at
 * most twice (10 s, 30 s or Retry-After), a safety refusal once with the same
 * request; then the shot ends without an image and without a charge. Calls
 * wait for a GLOBAL slot (text / image, across every instance) and the
 * order's spend cap. The knowledge version, the settings and the engine
 * version are the ones the order pinned at its start.
 */

const POS = { pin: P.validate, card: P.card, plan: P.plan, write: P.write, assemble: P.write, mirror: P.mirror } as const;
const ITEM = { pin: -1, card: 0, plan: 0, product: 0, scenes: 10, assemble: 30, mirror: -1 } as const;
/** Requests one text step may make: the first, one repeat with the errors, two transient retries. */
const MAX_ROWS = 5;
const MAX_TRANSIENT_TEXT = 2;
const TEXT_DELAYS_MS = [10_000, 30_000] as const;
const TIMEOUT_MS = { card: 120_000, plan: 120_000, product: 90_000, scenes: 170_000 } as const;
const STAGE_MARGIN_MS = 15_000;
/** One image call's ceiling, and the invocation time a call needs to begin. */
const IMAGE_CALL_MS = 150_000;
const IMAGE_START_MS = IMAGE_CALL_MS + 20_000;
/** A wait this short happens inside the invocation; a longer one yields. */
const INLINE_WAIT_MS = 35_000;
const SLOT_WAIT_MS = 30_000;
const SLOT_POLL_MS = 2_500;
/** A text call whose price is unknown counts this much against the cap. */
const UNKNOWN_TEXT_MICROS = 60_000;
/** Image tokens beyond the per-image price (measured ~$0.007 on PROD), for the cap only. */
const IMAGE_TOKEN_GUARD_MICROS = 10_000;
const TRANSIENT_TEXT = new Set(["analysis_rate_limited", "analysis_overloaded", "analysis_timeout", "analysis_unreachable", "analysis_error", "lost"]);

/* ══ the order's input ════════════════════════════════════════════════════*/

export type ShotInput = CoreInput & {
  v: 2; engine: "grovshot_v2"; pipeline: "lifestyle"; engine_version: string;
  test: boolean; test_mode?: "prompts" | "full";
  session_type: "lifestyle"; description: string; notes: string; user_plan: unknown;
  unit_price_usd_micros: number | null; budget_cap_usd_micros: number | null;
  settings: unknown;
  kb: { version_id: string; version: number; sha256: string };
};

export function isLifestyleInput(raw: unknown): boolean {
  return Boolean(raw && typeof raw === "object" && (raw as Record<string, unknown>).pipeline === "lifestyle");
}

export function parseShotInput(raw: unknown): ShotInput | null {
  const i = raw as Partial<ShotInput> | null;
  if (!i || i.v !== 2 || i.pipeline !== "lifestyle" || !Array.isArray(i.photos) || i.photos.length < 1 || i.photos.length > 10) return null;
  if (i.photo_shas !== null && (!Array.isArray(i.photo_shas) || i.photo_shas.length !== i.photos.length)) return null;
  if (typeof i.shots !== "number" || !Number.isInteger(i.shots) || i.shots < 1 || i.shots > 10) return null;
  if (!i.model?.id || !i.quote || typeof i.aspect_ratio !== "string" || typeof i.resolution !== "string") return null;
  if (!i.kb?.version_id || typeof i.kb.sha256 !== "string" || typeof i.description !== "string") return null;
  return { notes: "", user_plan: null, ...i } as ShotInput;
}

/* ══ context ══════════════════════════════════════════════════════════════*/

type LCtx = CoreCtx & {
  input: ShotInput;
  settings: ShotSettings;
  kb: KbParsed;
  kbVersion: number;
  ring: PromptKeyring;
  backends: Record<ShotStep, VisionBackend[]> | null;
  unitPrices: Awaited<ReturnType<typeof readEngineState>>["unitPrices"];
  tokenPrices: Awaited<ReturnType<typeof readEngineState>>["tokenPrices"];
  reserved: number;
  inFlight: Set<number>;
  shotSeq: number;
  gateUnknown?: boolean;
  slots: SlotStore;
  sleep: (ms: number) => Promise<void>;
  fidelity: string;
};

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));
const DB_SLOTS = (supabase: Client): SlotStore => ({
  acquire: async (kind, limit, holder, ttl) => {
    const { data, error } = await supabase.rpc("grovshot_slot_acquire", { p_token: dispatchToken() ?? "", p_kind: kind, p_limit: limit, p_holder: holder, p_ttl_seconds: ttl });
    return error || typeof data !== "number" ? null : data;
  },
  release: async (kind, holder) => {
    await supabase.rpc("grovshot_slot_release", { p_token: dispatchToken() ?? "", p_kind: kind, p_holder: holder });
  },
});

/** A pinned knowledge version never changes (0166 guard), so one read per instance. */
const kbCache = new Map<string, { sha256: string; kb: KbParsed; version: number }>();
async function readPinnedKb(supabase: Client, pin: ShotInput["kb"]): Promise<{ kb: KbParsed; version: number } | "unreadable" | "invalid"> {
  const hit = kbCache.get(pin.version_id);
  if (hit) return hit.sha256 === pin.sha256 ? hit : "invalid";
  const { data, error } = await supabase.rpc("grovshot_shot_kb", { p_token: dispatchToken() ?? "", p_version_id: pin.version_id });
  if (error) return "unreadable";
  const row = data as { sha256?: string; version?: number; parsed?: unknown } | null;
  if (!row || row.sha256 !== pin.sha256) return "invalid";
  const kb = readKb(row.parsed);
  if (!kb) return "invalid";
  kbCache.set(pin.version_id, { sha256: pin.sha256, kb, version: Number(row.version) || pin.version });
  return { kb, version: Number(row.version) || pin.version };
}

/* ══ entry (called by advanceGrovshotRun after the run is claimed) ═══════*/

type Base = { supabase: Client; userId: string; workspaceId: string; runId: string; owner: string; deadlineAt: number; hardEndAt: number; deps: GrovshotDeps; run: RunRow };

export async function advanceLifestyle(base: Base): Promise<AdvanceResult> {
  const { supabase, runId, owner } = base;
  const stall = async (): Promise<AdvanceResult> => {
    await patchRun(supabase, runId, owner, { lease_seconds: STALL_LEASE_S });
    return "stalled";
  };
  const input = parseShotInput(base.run.input);
  if (!input) { await closeEarly(base, "failed", "common_error"); return "finished"; }
  const parsed = parseShotSettings(input.settings);
  if (!parsed.ok) { await closeEarly(base, "failed", "config_invalid"); return "finished"; }
  const kb = await readPinnedKb(supabase, input.kb);
  if (kb === "unreadable") return stall();
  if (kb === "invalid") { await closeEarly(base, "failed", "knowledge_invalid"); return "finished"; }
  const steps = await readSteps(supabase, runId);
  if (!steps) return stall();
  const [state, ring] = await Promise.all([readEngineState(supabase), promptKeyring(supabase)]);
  const run = base.run;
  const ctx: LCtx = {
    ...base, input, settings: parsed.settings, kb: kb.kb, kbVersion: kb.version, ring, test: run.run_kind === "grovshot_test",
    steps, progress: { ...((run.progress && typeof run.progress === "object" && !Array.isArray(run.progress)) ? run.progress as Record<string, Json> : {}) },
    writer: Promise.resolve(), reserved: 0, inFlight: new Set(), shotSeq: 0, progressed: false, stopNew: null,
    photos: new Map(), backends: null, unitPrices: state.unitPrices, tokenPrices: state.tokenPrices,
    slots: base.deps.slots ?? DB_SLOTS(supabase), sleep: base.deps.sleep ?? realSleep, fidelity: buildFidelityInstructions(),
  };
  const invocations = Number((run as { invocations?: unknown }).invocations) || 0;
  if (invocations >= WIND_DOWN_INVOCATIONS || base.deps.now() - Date.parse(run.created_at) > MAX_ORDER_AGE_MS) {
    ctx.stopNew = "unavailable";
    await addNotes(ctx, [{ code: "wind_down" }]);
  }
  let outcome: Drive;
  try {
    outcome = await driveLifestyle(ctx, state);
  } catch (e) {
    console.error("[grovshot-shot] drive error", runId.slice(0, 8), e instanceof Error ? e.name : "error");
    outcome = "yield";
  }
  await ctx.writer;
  if (outcome === "finished") return "finished";
  if (!ctx.progressed) return stall();
  await patchRun(supabase, runId, owner, { lease_seconds: outcome === "busy" ? 60 : 10 });
  return outcome === "busy" ? "busy" : "yield";
}

async function driveLifestyle(ctx: LCtx, state: Awaited<ReturnType<typeof readEngineState>>): Promise<Drive> {
  if (!ctx.test) {
    const c = await srvContext(srv(ctx)).catch(() => null);
    const blocked = c && c.member ? (c.profile ? blockStateOf(c.profile).blocked : false) : c ? true : null;
    const map = blocked === false ? await getAvailabilityMap(ctx.supabase).catch(() => null) : null;
    if (blocked === true) ctx.stopNew = "account_blocked";
    else if (blocked === null || !map) ctx.gateUnknown = true;
    else if ((["prompts", "generator"] as const).some((k) => (map[k] ?? defaultStateFor(k)).status !== "ACTIVE")) ctx.stopNew = "feature_unavailable";
  }
  const prepared = stepOf(ctx, POS.assemble, ITEM.assemble)?.status === "succeeded";
  if (!prepared && ctx.stopNew) { await close(ctx, "failed", ctx.stopNew); return "finished"; }
  if (!prepared && ctx.gateUnknown) return "busy";

  const pinned = await pin(ctx, state);
  if (typeof pinned === "string") return pinned;

  // ── krok 2 · karta ──
  await setProgress(ctx, { stage: "analyze", engine: SHOT_ENGINE_VERSION, kb_version: ctx.kbVersion });
  const card = await cardStep(ctx);
  if (typeof card === "string") return card;

  // ── krok 3 · plan ──
  await setProgress(ctx, { stage: "plan" });
  const plan = await planStep(ctx, card);
  if (typeof plan === "string") return plan;
  if (ctx.progress.planned !== plan.length) await setProgress(ctx, { planned: plan.length, recipe: card.przepis_stylu });

  // ── krok 4 · moduły + składanie ──
  await setProgress(ctx, { stage: "scenes" });
  const prompts = await promptSteps(ctx, card, plan);
  if (typeof prompts === "string") return prompts;

  if (ctx.test && ctx.input.test_mode === "prompts") {
    const ok = plan.filter((s) => prompts.get(s.numer)).length;
    const { known, unknown } = spend(ctx);
    await close(ctx, ok === 0 ? "failed" : ok === plan.length ? "ok" : "partial", ok === 0 ? "prompt_invalid" : null, {
      credits: 0, api_cost_usd_micros: known, cost_unknown: unknown,
    });
    return "finished";
  }

  const mirror = await ensureMirror(ctx, card, plan, prompts);
  if (typeof mirror === "string") return mirror;
  return shotsPhase(ctx, plan, prompts, mirror);
}

/* ══ pin: hashes, price, cap (once) ═══════════════════════════════════════*/

type Pinned = { photo_shas: string[]; unit_price_usd_micros: number; budget_cap_usd_micros: number };

async function pin(ctx: LCtx, state: Awaited<ReturnType<typeof readEngineState>>): Promise<Pinned | Drive> {
  const apply = (o: Record<string, unknown>): Pinned => {
    const p = { photo_shas: o.photo_shas as string[], unit_price_usd_micros: Number(o.unit_price_usd_micros), budget_cap_usd_micros: Number(o.budget_cap_usd_micros) };
    ctx.input = { ...ctx.input, photo_shas: p.photo_shas, unit_price_usd_micros: p.unit_price_usd_micros, budget_cap_usd_micros: p.budget_cap_usd_micros };
    return p;
  };
  const s = stepOf(ctx, POS.pin, ITEM.pin);
  if (s?.status === "succeeded") return apply(outputOf(s));
  if (s?.status === "failed") { await close(ctx, "failed", s.error_code ?? "unavailable"); return "finished"; }
  const b = await begin(ctx, POS.pin, ITEM.pin, "pin", "tool");
  if (b.state === "done") return apply(outputOf({ output: b.output }));
  if (b.state === "busy") return "busy";
  if (b.state === "not_owner") return "lost";
  if (b.state !== "run") { await close(ctx, "failed", "unavailable"); return "finished"; }
  const fail = async (code: string): Promise<Drive> => {
    await finish(ctx, POS.pin, ITEM.pin, { status: "failed", attempts: b.attempts + 1, cost: { basis: "estimated", usdMicros: 0 }, errorCode: code, durationMs: 0 });
    await close(ctx, "failed", code);
    return "finished";
  };
  let shas = ctx.input.photo_shas;
  if (!shas) {
    // An admin's test order: the photos as they are NOW are the order's photos.
    if (!(await srvStorageGrant(srv(ctx), "product-images", ctx.input.photos, ["read"]))) return "busy";
    const r = await readOrderPhotos(ctx.supabase, ctx.input.photos);
    if (!r.ok) return fail(r.error === "photo_too_large" ? "photo_too_large" : "photo_unreadable");
    shas = r.photos.map((p) => p.sha256);
    for (const p of r.photos) ctx.photos.set(p.number, p);
  }
  const unit = ctx.input.unit_price_usd_micros ?? imageUnitPrice(state, ctx.input.resolution);
  if (unit === null || !(unit > 0)) return fail("price_unknown");
  const cap = ctx.input.budget_cap_usd_micros
    ?? Math.round(ctx.settings.text_budget_usd * 1_000_000 + ctx.input.shots * 3 * (unit + IMAGE_TOKEN_GUARD_MICROS));
  const out = { photo_shas: shas, unit_price_usd_micros: unit, budget_cap_usd_micros: cap, engine_version: SHOT_ENGINE_VERSION, kb_version: ctx.kbVersion };
  await finish(ctx, POS.pin, ITEM.pin, { status: "succeeded", attempts: b.attempts + 1, cost: { basis: "estimated", usdMicros: 0 }, output: out as unknown as Json, durationMs: 0 });
  return apply(out);
}

/* ══ spend ════════════════════════════════════════════════════════════════*/

function spend(ctx: LCtx): { known: number; unknown: number; guard: number } {
  let known = 0;
  let unknown = 0;
  let guard = 0;
  const unit = ctx.input.unit_price_usd_micros ?? 0;
  for (const s of ctx.steps) {
    const u = Number(outputOf(s).unknown_calls) || 0;
    unknown += u;
    if (s.cost_basis !== "unknown" && s.cost_usd_micros !== null) { known += s.cost_usd_micros; guard += s.cost_usd_micros; }
    else if (s.position === P.round && s.status !== "pending") { unknown++; guard += unit + IMAGE_TOKEN_GUARD_MICROS; }
    else if (s.status !== "pending" && (s.position === POS.card || s.position === POS.plan || s.position === POS.write) && s.item_index !== ITEM.assemble) {
      if (s.cost_basis === "unknown") { unknown++; guard += UNKNOWN_TEXT_MICROS; }
    }
    guard += u * UNKNOWN_TEXT_MICROS;
  }
  return { known, unknown, guard };
}
const capLeft = (ctx: LCtx) => (ctx.input.budget_cap_usd_micros ?? 0) - spend(ctx).guard - ctx.reserved;

/* ══ global slots ═════════════════════════════════════════════════════════*/

async function takeSlot(ctx: LCtx, kind: "text" | "image", tag: string, ttlSeconds: number): Promise<string | null> {
  const holder = `${ctx.owner}:${kind}:${tag}`.slice(0, 120);
  const limit = kind === "text" ? ctx.settings.limits.text_concurrency : ctx.settings.limits.image_concurrency;
  const until = ctx.deps.now() + Math.min(SLOT_WAIT_MS, Math.max(0, left(ctx) - (kind === "text" ? 60_000 : IMAGE_START_MS)));
  for (;;) {
    const got = await ctx.slots.acquire(kind, limit, holder, ttlSeconds).catch(() => null);
    if (got !== null) return holder;
    if (ctx.deps.now() + SLOT_POLL_MS > until) return null;
    await ctx.sleep(SLOT_POLL_MS);
  }
}
async function freeSlot(ctx: LCtx, kind: "text" | "image", holder: string) {
  await ctx.slots.release(kind, holder).catch(() => undefined);
}

/* ══ one text step: rows of requests ══════════════════════════════════════*/

async function backendsFor(ctx: LCtx, step: ShotStep): Promise<VisionBackend[]> {
  if (!ctx.backends) {
    const models = { card: ctx.settings.models.card, plan: ctx.settings.models.plan, prompt: ctx.settings.models.prompt } as Record<string, StageModel>;
    const r = await roleBackends(ctx.supabase, models as never).catch(() => null);
    ctx.backends = r ? { card: r.backends.card ?? [], plan: r.backends.plan ?? [], prompt: r.backends.prompt ?? [] } : null;
  }
  return ctx.backends?.[step] ?? [];
}

type Checked<V> = { value: V | null; errors: string[] };
type StepOk<V> = { value: V; errors: string[]; item: number; out: Record<string, unknown> };

/**
 * Rows `base … base+MAX_ROWS-1` of one position are the step's requests in
 * order. Decided from what is stored: a clean answer → done; an answer with
 * errors → once more WITH the errors, then the best usable answer (or a
 * failure); a transient failure → again after 10 s / 30 s / Retry-After,
 * twice; anything else → a failure. A row an invocation left running is a
 * lost request (transient).
 */
async function stageRows<V>(ctx: LCtx, o: {
  pos: number; base: number; name: string; key: ShotStageKey; step: ShotStep; timeoutMs: number;
  build: (feedback: string | null) => Promise<Omit<StageCall, "key" | "body" | "values" | "timeoutMs" | "deadlineAt" | "backends" | "tokenPrices" | "now"> | "changed" | "unreadable">;
  check: (raw: unknown) => Checked<V>;
  feedback: (errors: string[]) => string;
}): Promise<StepOk<V> | { failed: string } | Drive> {
  for (let guard = 0; guard < MAX_ROWS + 2; guard++) {
    const rows = ctx.steps.filter((s) => s.position === o.pos && s.item_index >= o.base && s.item_index < o.base + MAX_ROWS)
      .sort((a, b) => a.item_index - b.item_index);
    const last = rows[rows.length - 1];
    if (last && (last.status === "running" || last.status === "pending")) {
      const b = await begin(ctx, o.pos, last.item_index, o.name, "ai_text");
      if (b.state === "busy") return "busy";
      if (b.state === "not_owner") return "lost";
      if (b.state === "run") {
        await finish(ctx, o.pos, last.item_index, { status: "failed", attempts: b.attempts + 1, cost: { basis: "unknown" }, errorCode: "lost",
          output: { transient: true, retry_at: ctx.deps.now() } as Json, durationMs: 0 });
      }
      continue;
    }
    const answers = rows.filter((r) => r.status === "succeeded").map((r) => ({ r, c: o.check(outputOf(r).raw) }));
    if (last?.status === "succeeded") {
      const c = answers[answers.length - 1].c;
      if (c.value !== null && c.errors.length === 0) return { value: c.value, errors: [], item: last.item_index, out: outputOf(last) };
      if (answers.length >= 2) {
        // The repeat did not clear everything: the usable answer with the fewest errors (the later one on a tie).
        const usable = answers.filter((a) => a.c.value !== null).sort((a, b) => a.c.errors.length - b.c.errors.length || b.r.item_index - a.r.item_index)[0];
        return usable ? { value: usable.c.value as V, errors: usable.c.errors, item: usable.r.item_index, out: outputOf(usable.r) } : { failed: "invalid_output" };
      }
    } else if (last?.status === "failed") {
      const code = last.error_code ?? "error";
      const transient = rows.filter((r) => r.status === "failed" && TRANSIENT_TEXT.has(r.error_code ?? ""));
      if (!TRANSIENT_TEXT.has(code) || transient.length > MAX_TRANSIENT_TEXT) return { failed: code };
      const at = Number(outputOf(last).retry_at) || 0;
      const wait = at - ctx.deps.now();
      if (wait > 0) {
        if (wait > INLINE_WAIT_MS || left(ctx) < wait + o.timeoutMs + STAGE_MARGIN_MS) return "yield";
        await ctx.sleep(wait);
      }
    }
    if (rows.length >= MAX_ROWS) return { failed: last?.error_code ?? "invalid_output" };
    // The feedback the next request carries: the latest answer's errors.
    const prev = answers[answers.length - 1];
    const feedback = prev && prev.c.errors.length > 0 ? o.feedback(prev.c.errors) : null;
    if (left(ctx) < o.timeoutMs + STAGE_MARGIN_MS) return "yield";
    const holder = await takeSlot(ctx, "text", `${o.pos}:${o.base + rows.length}`, Math.ceil(o.timeoutMs / 1000) + 30);
    if (!holder) return "busy";
    try {
      const item = o.base + rows.length;
      const b = await begin(ctx, o.pos, item, o.name, "ai_text");
      if (b.state === "busy") return "busy";
      if (b.state === "not_owner") return "lost";
      if (b.state !== "run") continue;
      const built = await o.build(feedback);
      if (built === "changed" || built === "unreadable") {
        await finish(ctx, o.pos, item, { status: "failed", attempts: b.attempts + 1, cost: { basis: "estimated", usdMicros: 0 }, errorCode: built === "changed" ? "reference_changed" : "photo_unreadable", durationMs: 0 });
        return { failed: built === "changed" ? "reference_changed" : "unavailable" };
      }
      const t0 = ctx.deps.now();
      const call: StageCall = {
        ...built, key: o.key, body: "", values: {}, timeoutMs: o.timeoutMs, deadlineAt: ctx.deadlineAt,
        backends: await backendsFor(ctx, o.step), tokenPrices: ctx.tokenPrices, now: ctx.deps.now,
      };
      const res = await ctx.deps.callStage<unknown>(ctx.supabase, call, {
        consumer: ctx.test ? "workflow_test" : "generation", actorKind: ctx.test ? "admin" : "customer",
        userId: ctx.userId, workspaceId: ctx.workspaceId, runRef: ctx.runId,
      });
      const meta = {
        trace: (res.trace ?? null) as unknown as Json, unknown_calls: res.unknownCalls, feedback: Boolean(feedback),
        system_chars: call.direct?.system.length ?? 0, user_chars: call.direct?.user.length ?? 0, images: call.images.length,
        kb_version: ctx.kbVersion, engine_version: SHOT_ENGINE_VERSION,
      };
      if (!res.ok) {
        const retryAfter = Math.max(0, ...(res.trace?.attempts ?? []).map((a) => a.retry_after_ms ?? 0));
        const transient = TRANSIENT_TEXT.has(res.error);
        const nth = rows.filter((r) => r.status === "failed").length;
        const delay = Math.max(TEXT_DELAYS_MS[Math.min(nth, TEXT_DELAYS_MS.length - 1)], retryAfter);
        await finish(ctx, o.pos, item, {
          status: "failed", attempts: b.attempts + 1, cost: res.cost, errorCode: res.error.slice(0, 80),
          output: { ...meta, transient, retry_at: ctx.deps.now() + delay } as Json, durationMs: ctx.deps.now() - t0,
        });
        continue;
      }
      const c = o.check(res.data);
      await finish(ctx, o.pos, item, {
        status: "succeeded", attempts: b.attempts + 1, providerSlug: res.trace.provider, model: res.trace.model,
        inputTokens: res.attempts.reduce((sum, a) => sum + (a.inputTokens ?? 0), 0) || undefined,
        outputTokens: res.attempts.reduce((sum, a) => sum + (a.outputTokens ?? 0), 0) || undefined,
        cost: res.cost, output: { raw: res.data as Json, errors: c.errors, usable: c.value !== null, ...meta } as Json, durationMs: ctx.deps.now() - t0,
      });
    } finally {
      await freeSlot(ctx, "text", holder);
    }
  }
  return "busy";
}

/* ══ krok 2 · karta ═══════════════════════════════════════════════════════*/

const dataBlock = (ctx: LCtx) => [
  wrapData("opis_allegro", ctx.input.description || "(brak opisu)"),
  ctx.input.notes ? wrapData("uwagi_klienta", ctx.input.notes) : "",
].filter(Boolean).join("\n\n");

async function cardStep(ctx: LCtx): Promise<ProductCard | Drive> {
  const count = ctx.input.photos.length;
  const all = ctx.input.photos.map((_, i) => i + 1);
  const r = await stageRows<ProductCard>(ctx, {
    pos: POS.card, base: ITEM.card, name: "card", key: "grovshot_shot_card", step: "card", timeoutMs: TIMEOUT_MS.card,
    build: async (feedback) => {
      const ph = await photos(ctx, all);
      if (typeof ph === "string") return ph;
      return {
        direct: {
          system: `${contractText("karta", { version: ctx.kbVersion })}\n\n${kbInstructions(ctx.kb, "karta", { fidelityRules: ctx.fidelity })}`,
          user: [
            `Zdjęcia produktu: ${all.map(photoId).join(", ")} (w kolejności, w jakiej je dostajesz). Liczba zdjęć: ${count}.`,
            dataBlock(ctx), feedback ?? "",
          ].filter(Boolean).join("\n\n"),
        },
        images: await Promise.all(ph.map((p) => forVision(p.bytes))), schema: CARD_SCHEMA, cacheSystem: true,
      };
    },
    check: (raw) => {
      const c = checkCard(raw, { photoCount: count, kb: ctx.kb });
      return c.ok ? { value: c.card, errors: [] } : { value: null, errors: c.errors };
    },
    feedback: validationFeedback,
  });
  if (typeof r === "string") return r;
  if ("failed" in r) { await close(ctx, "failed", r.failed === "invalid_output" ? "card_invalid" : "analysis_unavailable"); return "finished"; }
  return r.value;
}

/* ══ krok 3 · plan ════════════════════════════════════════════════════════*/

async function planStep(ctx: LCtx, card: ProductCard): Promise<PlanShot[] | Drive> {
  const userPlan = parseUserPlan(ctx.input.user_plan, { shots: ctx.input.shots, photoCount: ctx.input.photos.length });
  if (userPlan === "invalid") { await close(ctx, "failed", "invalid_shot_plan"); return "finished"; }
  const r = await stageRows<{ shots: PlanShot[]; violations: Violation[]; conflicts: string[] }>(ctx, {
    pos: POS.plan, base: ITEM.plan, name: "plan", key: "grovshot_shot_plan", step: "plan", timeoutMs: TIMEOUT_MS.plan,
    build: async (feedback) => ({
      direct: {
        system: `${contractText("plan", { version: ctx.kbVersion })}\n\n${kbInstructions(ctx.kb, "plan", { recipeId: card.przepis_stylu, flags: card.flagi, fidelityRules: ctx.fidelity })}`,
        user: planUser(ctx, card, userPlan, feedback),
      },
      images: [], schema: PLAN_SCHEMA, cacheSystem: true,
    }),
    check: (raw) => {
      const c = checkPlan(raw, { card, kb: ctx.kb, shots: ctx.input.shots, userPlan });
      if (c.structural.length > 0) return { value: null, errors: c.structural };
      return { value: { shots: c.shots, violations: c.violations, conflicts: c.conflicts }, errors: c.violations.map((v) => v.detail) };
    },
    feedback: (errors) => planFeedback({ structural: errors, violations: [] }),
  });
  if (typeof r === "string") return r;
  if ("failed" in r) { await close(ctx, "failed", r.failed === "invalid_output" ? "plan_invalid" : "analysis_unavailable"); return "finished"; }
  // Violations left after the repeat are recorded (the admin's log), the plan goes on.
  if (r.value.violations.length > 0 || r.value.conflicts.length > 0) {
    await setProgress(ctx, {
      plan_violations: r.value.violations.map((v) => ({ code: v.code, shots: v.shots })) as unknown as Json,
      plan_conflicts: r.value.conflicts.length,
    });
  }
  return r.value.shots;
}

function planUser(ctx: LCtx, card: ProductCard, userPlan: UserPlanRow[] | null, feedback: string | null): string {
  return [
    `Liczba ujęć do zaplanowania: dokładnie ${ctx.input.shots}. Format całego zestawu: ${ctx.input.aspect_ratio}.`,
    `Karta produktu (JSON):\n${JSON.stringify(card)}`,
    ctx.kb.directions.length ? `Pole „kierunek” = dokładnie jedna nazwa z listy: ${ctx.kb.directions.join(" | ")}.` : "",
    `Pole „kadr”: ${FRAMES.join(", ")}. Pole „swiatlo_typ”: ${LIGHTS.join(", ")}. Pole „stan”: dokładnie jeden ze stanów karty. „skala_cm”: największy wymiar produktu w cm wynikający z kotwic skali tej sceny (null, gdy scena go nie ustala).`,
    userPlan ? `Pozycje ustalone przez administratora (wiążące, przepisz bez zmian):\n${renderUserPlan(userPlan)}` : "",
    ctx.input.notes ? wrapData("uwagi_klienta", ctx.input.notes) : "",
    feedback ?? "",
  ].filter(Boolean).join("\n\n");
}

/* ══ krok 4 · moduły promptu + składanie ══════════════════════════════════*/

type Prompts = Map<number, AssembledPrompt & { sha256: string; references: number[] }>;

function promptsFrom(o: Record<string, unknown>): Prompts {
  const m: Prompts = new Map();
  for (const x of Array.isArray(o.shots) ? o.shots as Record<string, unknown>[] : []) {
    if (typeof x.text === "string" && typeof x.numer === "number") {
      m.set(x.numer, {
        text: x.text, sha256: String(x.sha256), modules: (x.modules ?? []) as AssembledPrompt["modules"], footer: String(x.footer ?? ""),
        pattern: x.pattern === "detail" ? "detail" : "full", references: Array.isArray(x.references) ? x.references as number[] : [],
      });
    }
  }
  return m;
}

async function promptSteps(ctx: LCtx, card: ProductCard, plan: PlanShot[]): Promise<Prompts | Drive> {
  const done = stepOf(ctx, POS.assemble, ITEM.assemble);
  if (done?.status === "succeeded") return promptsFrom(outputOf(done));
  // One system text for both calls: the second reads it from the prompt cache.
  const system = `${contractText("prompty", { version: ctx.kbVersion })}\n\n${kbInstructions(ctx.kb, ["produkt", "sceny"], { recipeId: card.przepis_stylu, flags: card.flagi, fidelityRules: ctx.fidelity })}`;
  const wholes = card.zdjecia.filter((p) => p.rola === "calosc").slice(0, 3).map((p) => p.n);
  const product = await stageRows<ProductModules>(ctx, {
    pos: POS.write, base: ITEM.product, name: "product", key: "grovshot_shot_product", step: "prompt", timeoutMs: TIMEOUT_MS.product,
    build: async (feedback) => {
      const ph = wholes.length ? await photos(ctx, wholes) : [];
      if (typeof ph === "string") return ph;
      return {
        direct: {
          system,
          user: [
            "Zadanie: napisz moduły PRODUKT i SKALA tego zlecenia (raz na zlecenie). PRODUKT opisuje produkt dokładnie jak na zdjęciach referencyjnych i nie podaje numerów zdjęć.",
            wholes.length ? `Dołączone zdjęcia całości: ${wholes.map(photoId).join(", ")}.` : "",
            `Karta produktu (JSON):\n${JSON.stringify(card)}`,
            wrapData("opis_allegro", ctx.input.description || "(brak opisu)"),
            feedback ?? "",
          ].filter(Boolean).join("\n\n"),
        },
        images: await Promise.all(ph.map((p) => forVision(p.bytes))), schema: PRODUCT_SCHEMA, cacheSystem: true,
      };
    },
    check: (raw) => {
      const c = checkProductModules(raw);
      return c.ok ? { value: c.modules, errors: [] } : { value: null, errors: c.errors };
    },
    feedback: validationFeedback,
  });
  if (typeof product === "string") return product;
  if ("failed" in product) { await close(ctx, "failed", "prompt_invalid"); return "finished"; }

  const detailRefs = [...new Set(plan.filter((s) => s.typ === "detal").map((s) => s.referencje[0]))].slice(0, 4);
  const scenes = await stageRows<{ modules: Map<number, SceneModules>; missing: number[] }>(ctx, {
    pos: POS.write, base: ITEM.scenes, name: "scenes", key: "grovshot_shot_scenes", step: "prompt", timeoutMs: TIMEOUT_MS.scenes,
    build: async (feedback) => {
      const ph = detailRefs.length ? await photos(ctx, detailRefs) : [];
      if (typeof ph === "string") return ph;
      return {
        direct: {
          system,
          user: [
            "Zadanie: napisz moduły scen dla WSZYSTKICH ujęć planu naraz, tak żeby miejsca, światło i kompozycje się nie powtarzały.",
            "Ujęcie typu detal: wypełnij „detal” (detal skopiowany 1:1 z jego pierwszej referencji, zmienione tylko tło, światło i jeden element) i „kadr” (kąt z referencji); pozostałe pola puste.",
            "Pozostałe ujęcia: „stan_chwyt”, „moment”, „kadr”, „postac” (pusta, gdy ludzie = brak), „scenografia”; „detal” pusty. Do zdjęć odwołuj się „zdjęcie 1”, „zdjęcie 2” według listy referencji ujęcia.",
            `Format kadru: ${ctx.input.aspect_ratio}.`,
            detailRefs.length ? `Dołączone zdjęcia detali: ${detailRefs.map(photoId).join(", ")}.` : "",
            `Karta produktu (JSON):\n${JSON.stringify(card)}`,
            `Moduły PRODUKT i SKALA (już napisane – nie powtarzaj ich):\nPRODUKT: ${product.value.produkt}\nSKALA: ${product.value.skala}`,
            `Plan ujęć (JSON):\n${planForPrompt(plan)}`,
            ctx.input.notes ? wrapData("uwagi_klienta", ctx.input.notes) : "",
            feedback ?? "",
          ].filter(Boolean).join("\n\n"),
        },
        images: await Promise.all(ph.map((p) => forVision(p.bytes))), schema: SCENES_SCHEMA, cacheSystem: true,
      };
    },
    check: (raw) => {
      const c = checkSceneModules(raw, plan);
      return { value: c.modules.size > 0 ? { modules: c.modules, missing: c.missing } : null, errors: c.errors };
    },
    feedback: validationFeedback,
  });
  if (typeof scenes === "string") return scenes;
  if ("failed" in scenes) { await close(ctx, "failed", "prompt_invalid"); return "finished"; }

  // The final prompts, fixed now — exactly what each image call will send.
  const b = await begin(ctx, POS.assemble, ITEM.assemble, "assemble", "tool");
  if (b.state === "done") return promptsFrom(outputOf({ output: b.output }));
  if (b.state === "busy") return "busy";
  if (b.state === "not_owner") return "lost";
  if (b.state !== "run") { await close(ctx, "failed", "prompt_invalid"); return "finished"; }
  const shots: Record<string, Json>[] = [];
  for (const shot of plan) {
    const m = scenes.value.modules.get(shot.numer);
    if (!m) continue;
    const a = assemblePrompt({ kb: ctx.kb, card, shot, product: product.value, scene: m });
    shots.push({
      numer: shot.numer, text: a.text, sha256: sha256(a.text), modules: a.modules as unknown as Json, footer: a.footer, pattern: a.pattern,
      references: shot.referencje, kb_version: ctx.kbVersion, engine_version: SHOT_ENGINE_VERSION,
    });
  }
  const out = {
    shots, missing: scenes.value.missing, kb_version: ctx.kbVersion, engine_version: SHOT_ENGINE_VERSION,
    card_item: null, product_item: product.item, scenes_item: scenes.item,
  };
  await finish(ctx, POS.assemble, ITEM.assemble, { status: "succeeded", attempts: b.attempts + 1, cost: { basis: "estimated", usdMicros: 0 }, output: out as unknown as Json, durationMs: 0 });
  return promptsFrom(out);
}

/* ══ the customer-visible mirror ══════════════════════════════════════════*/

async function ensureMirror(ctx: LCtx, card: ProductCard, plan: PlanShot[], prompts: Prompts): Promise<Mirror | Drive> {
  const s = stepOf(ctx, POS.mirror, ITEM.mirror);
  const read = (o: Record<string, unknown>): Mirror => ({
    sessionId: typeof o.session_id === "string" ? o.session_id : null,
    concepts: (o.concepts && typeof o.concepts === "object" ? o.concepts : {}) as Record<number, string>,
  });
  if (s?.status === "succeeded") return read(outputOf(s));
  const b = await begin(ctx, POS.mirror, ITEM.mirror, "mirror", "tool");
  if (b.state === "done") return read(outputOf({ output: b.output }));
  if (b.state === "busy") return "busy";
  if (b.state === "not_owner") return "lost";
  if (b.state !== "run") { await close(ctx, "failed", "unavailable"); return "finished"; }
  if (ctx.test) {
    const out = { session_id: null, concepts: {} };
    await finish(ctx, POS.mirror, ITEM.mirror, { status: "succeeded", attempts: b.attempts + 1, cost: { basis: "estimated", usdMicros: 0 }, output: out, durationMs: 0 });
    return read(out);
  }
  const rows: Record<string, Json>[] = [];
  for (const shot of plan) {
    const p = prompts.get(shot.numer);
    if (!p) continue;
    const sealed = encryptConceptPayload(ctx.ring, p.text, "", { tv: ctx.kbVersion });
    rows.push({
      concept_name: shot.argument.slice(0, 120), customer_title: shot.argument.slice(0, 120), customer_description: shot.opis,
      prompt_encrypted: sealed.ciphertext, prompt_iv: sealed.iv, prompt_tag: sealed.authTag,
      primary_reference: shot.referencje[0] ?? 1, reference_indices: shot.referencje,
      format: ctx.input.aspect_ratio, priority: shot.numer, model_id: ctx.input.model.id,
    });
  }
  const mirrored = await srvMirror(srv(ctx), {
    product_name: card.produkt.nazwa.slice(0, 120), aspect_ratio: ctx.input.aspect_ratio, resolution: ctx.input.resolution,
  }, rows);
  if (!mirrored) {
    await finish(ctx, POS.mirror, ITEM.mirror, { status: "failed", attempts: b.attempts + 1, cost: { basis: "estimated", usdMicros: 0 }, errorCode: "session_create_failed", durationMs: 0 });
    await close(ctx, "failed", "unavailable");
    return "finished";
  }
  const concepts: Record<number, string> = {};
  for (const r of mirrored.concepts) concepts[(r.priority ?? 0) - 1] = r.id;
  const out = { session_id: mirrored.sessionId, concepts };
  await finish(ctx, POS.mirror, ITEM.mirror, { status: "succeeded", attempts: b.attempts + 1, cost: { basis: "estimated", usdMicros: 0 }, output: out as Json, durationMs: 0 });
  return read(out);
}

/* ══ krok 5 · Nano Banana Pro, one generation per shot ════════════════════*/

async function shotsPhase(ctx: LCtx, plan: PlanShot[], prompts: Prompts, mirror: Mirror): Promise<Drive> {
  const idx = (s: PlanShot) => s.numer - 1;
  const pending = plan.filter((s) => !settled(ctx, idx(s)));
  if (pending.length === 0) return closeRun(ctx, plan.map((s) => ({ index: idx(s) })));
  await setProgress(ctx, { stage: "images" });
  const results: ShotOutcome[] = [];
  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const shot = pending[next++];
      let r: ShotOutcome;
      try {
        r = await runShot(ctx, shot, prompts.get(shot.numer) ?? null, mirror);
      } catch (e) {
        console.error("[grovshot-shot] shot error", ctx.runId.slice(0, 8), shot.numer, e instanceof Error ? e.name : "error");
        r = "yield";
      }
      results.push(r);
      if (r === "lost") return;
    }
  };
  await Promise.allSettled(Array.from({ length: Math.max(1, Math.min(ctx.settings.limits.image_concurrency, pending.length)) }, worker));
  if (results.includes("lost")) return "lost";
  if (plan.every((s) => settled(ctx, idx(s)))) return closeRun(ctx, plan.map((s) => ({ index: idx(s) })));
  return results.includes("busy") && !results.includes("yield") ? "busy" : "yield";
}

type RoundOut = { ok: boolean; error: string | null; cls: ImageErrorClass | null; retry_after_ms: number | null; at: number };
const roundOut = (o: Record<string, unknown>, status: string, code: string | null): RoundOut => ({
  ok: o.ok === true, error: typeof o.error === "string" ? o.error : code, cls: (o.cls as ImageErrorClass) ?? (status === "failed" ? classifyImageError(code) : null),
  retry_after_ms: typeof o.retry_after_ms === "number" ? o.retry_after_ms : null, at: Number(o.at) || 0,
});

async function runShot(ctx: LCtx, shot: PlanShot, prompt: (AssembledPrompt & { sha256: string; references: number[] }) | null, mirror: Mirror): Promise<ShotOutcome> {
  const n = shot.numer - 1;
  const core = { index: n, references: shot.referencje };
  for (let guard = 0; guard < 8; guard++) {
    if (settled(ctx, n)) return "settled";
    // A charge an earlier invocation began and did not settle.
    const pendingCharge = rowsOf(ctx, P.charge, n).find((c) => {
      if (c.status === "running" || c.status === "pending") return true;
      if (c.status !== "succeeded") return false;
      const d = stepOf(ctx, P.deliver, c.item_index);
      return !d || d.status !== "failed";
    });
    if (pendingCharge) {
      const r = await recoverDelivery(ctx, n, pendingCharge);
      if (r === "busy" || r === "lost") return r;
      if (r === "delivered") return "settled";
    }
    if (!prompt) return settle(ctx, n, false, "prompt_invalid");
    const rounds = rowsOf(ctx, P.round, n);
    const last = rounds[rounds.length - 1];
    if (last && (last.status === "running" || last.status === "pending")) {
      // Begun by an invocation that is gone: never re-sent as the same call — a lost call (counted as transient).
      const b = await begin(ctx, P.round, last.item_index, "round", "image_generation");
      if (b.state === "busy") return "busy";
      if (b.state === "not_owner") return "lost";
      if (b.state === "run") {
        await finish(ctx, P.round, last.item_index, { status: "failed", attempts: b.attempts + 1, cost: { basis: "unknown" }, errorCode: "round_lost",
          output: { ok: false, error: "round_lost", cls: "transient", retry_after_ms: null, at: ctx.deps.now() } as Json, durationMs: 0 });
      }
      continue;
    }
    // Each finished call that brought no delivered image is one failure.
    const failures = rounds.map((r) => roundOut(outputOf(r), r.status, r.error_code))
      .map((o) => ({ cls: (o.ok ? "transient" : o.cls ?? "final") as ImageErrorClass, retryAfterMs: o.retry_after_ms, at: o.at }));
    const decision = nextImageAttempt(failures);
    if (!decision.retry) {
      const lastCls = failures[failures.length - 1]?.cls;
      return settle(ctx, n, false, lastCls === "safety" ? "safety_refused" : "image_failed");
    }
    if (ctx.stopNew) return settle(ctx, n, false, ctx.stopNew);
    if (ctx.gateUnknown) return "yield";
    const waitUntil = failures.length ? failures[failures.length - 1].at + decision.delayMs : 0;
    const wait = waitUntil - ctx.deps.now();
    if (wait > 0) {
      if (wait > INLINE_WAIT_MS || left(ctx) < wait + IMAGE_START_MS) return "yield";
      await ctx.sleep(wait);
    }
    if (left(ctx) < IMAGE_START_MS) return "yield";
    const est = (ctx.input.unit_price_usd_micros ?? 0) + IMAGE_TOKEN_GUARD_MICROS;
    if (capLeft(ctx) < est) return settle(ctx, n, false, "budget");
    ctx.reserved += est;
    let held = est;
    const releaseBudget = () => { ctx.reserved = Math.max(0, ctx.reserved - held); held = 0; };
    const place = ++ctx.shotSeq;
    ctx.inFlight.add(place);
    const charged = () => { ctx.inFlight.delete(place); };
    try {
      if (!ctx.test) {
        const bal = await freshBalance(srv(ctx));
        if (bal === null) return "busy";
        if (bal < ctx.input.quote.unit) return settle(ctx, n, false, "insufficient_credits");
        const ahead = [...ctx.inFlight].filter((p) => p < place).length;
        if (bal < ctx.input.quote.unit * (ahead + 1)) return "yield";
      }
      const refs = await photos(ctx, shot.referencje);
      if (refs === "changed") { ctx.stopNew = "reference_changed"; return settle(ctx, n, false, "reference_changed"); }
      if (refs === "unreadable") return "busy";
      const holder = await takeSlot(ctx, "image", `s${n}`, Math.ceil(IMAGE_CALL_MS / 1000) + 30);
      if (!holder) return "busy";
      let image: { bytes: Buffer; mime: string; width: number | null; height: number | null; sha256: string } | null = null;
      let roundIndex = rounds.length;
      try {
        if (left(ctx) < IMAGE_START_MS) return "yield";
        const item = itemOf(n, roundIndex);
        const b = await begin(ctx, P.round, item, "round", "image_generation");
        if (b.state === "busy") return "busy";
        if (b.state === "not_owner") return "lost";
        if (b.state !== "run") continue;
        await setProgress(ctx, { stage: "images" });
        const t0 = ctx.deps.now();
        const refsForModel = await Promise.all(refs.map(forImageModel));
        const r = await ctx.deps.callImage(ctx.supabase, {
          candidateModelIds: [ctx.input.model.id], prompt: prompt.text, references: refsForModel,
          aspectRatio: ctx.input.aspect_ratio as AspectRatio, resolution: ctx.input.resolution as Resolution,
          maxAttempts: 1, deadlineAt: Math.min(ctx.hardEndAt - DELIVER_RESERVE_MS, ctx.deps.now() + IMAGE_CALL_MS),
          unitPrices: ctx.unitPrices, tokenPrices: ctx.tokenPrices,
        });
        let cost = 0;
        let unknown = 0;
        for (const a of r.attempts) { if (a.cost.basis === "unknown") unknown++; else cost += a.cost.usdMicros; }
        await recordProviderCalls(ctx.supabase, r.attempts.map((a) => ({
          actorKind: ctx.test ? "admin" as const : "customer" as const, consumer: ctx.test ? "workflow_test" as const : "generation" as const,
          userId: ctx.userId, workspaceId: ctx.workspaceId, toolKey: "prompts", runRef: ctx.runId,
          providerSlug: a.providerSlug, model: a.model, status: a.ok ? "succeeded" as const : "failed" as const,
          errorCode: a.ok ? null : (a.errorCode ?? "provider_error"), inputTokens: a.inputTokens ?? null,
          outputTokens: a.outputTokens ?? null, thoughtTokens: a.thoughtTokens ?? null,
          units: a.ok ? 1 : 0, unitKind: "image" as const, resolution: a.resolution ?? null, cost: a.cost, baseCost: a.baseCost ?? null, durationMs: a.ms,
        })));
        if (r.ok && r.image.base64) {
          const bytes = Buffer.from(r.image.base64, "base64");
          const dims = await dimensionsOf(bytes);
          image = { bytes, mime: r.image.mime || "image/png", width: dims.width, height: dims.height, sha256: sha256(bytes) };
        }
        const error = image ? null : r.ok ? "provider_empty_result" : r.error;
        // The image door (lib/server/engine, frozen for Retusz/Miniaturka) does not
        // pass Google's RetryInfo out: the PDF's fixed gaps (10 s, 30 s) apply.
        const retryAfter: number | null = null;
        const out: Record<string, Json> = {
          ok: Boolean(image), error, cls: error ? classifyImageError(error) : null, retry_after_ms: retryAfter, at: ctx.deps.now(),
          ms: ctx.deps.now() - t0, sha256: image?.sha256 ?? null, width: image?.width ?? null, height: image?.height ?? null, mime: image?.mime ?? null,
          bytes: image?.bytes.length ?? null, cost_usd_micros: cost, unknown_calls: unknown,
          prompt: { sha256: prompt.sha256, pattern: prompt.pattern, footer: prompt.footer, kb_version: ctx.kbVersion, engine_version: SHOT_ENGINE_VERSION },
          // THE REFERENCE MANIFEST: what Nano Banana Pro received, in send order ("zdjęcie 1" = entry 1).
          references_sent: refs.map((p, i) => ({ n: i + 1, photo: p.number, sha256: p.sha256 })) as unknown as Json,
          aspect_ratio: ctx.input.aspect_ratio, resolution: ctx.input.resolution, attempt: roundIndex + 1,
        };
        const ok = await finish(ctx, P.round, item, {
          status: "succeeded", attempts: b.attempts + 1, providerSlug: ctx.input.model.provider, model: ctx.input.model.identifier,
          units: image ? 1 : 0, unitKind: "image", cost: unknown > 0 && cost === 0 ? { basis: "unknown" } : { basis: "estimated", usdMicros: cost },
          output: out, durationMs: ctx.deps.now() - t0,
        });
        if (!ok) return "lost";
        roundIndex++;
      } finally {
        await freeSlot(ctx, "image", holder);
      }
      releaseBudget();
      if (image) {
        await setProgress(ctx, { stage: "results" });
        for (let attempt = 0; attempt < 2; attempt++) {
          const slot = rowsOf(ctx, P.charge, n).length;
          if (slot > 4 || (attempt > 0 && ctx.hardEndAt - ctx.deps.now() < DELIVER_RESERVE_MS)) break;
          const d = await deliver(ctx, core, mirror, { ...image, costMicros: 0 }, roundIndex - 1, slot, charged);
          if (d === "lost" || d === "busy") return d;
          if (d === "delivered" || settled(ctx, n)) return "settled";
        }
        // Delivery failed twice: the image is gone (it lived in memory) — a
        // later call may still bring one, within the shot's limit.
      }
    } finally {
      releaseBudget();
      charged();
    }
  }
  return "busy";
}

/** For the admin test route: a fresh owner tag (never a customer's). */
export const lifestyleOwnerTag = () => `gsls:${randomUUID()}`;
export { readRunRow };
