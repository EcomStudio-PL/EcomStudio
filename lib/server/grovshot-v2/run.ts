import "server-only";
import { randomUUID } from "node:crypto";
import type { Json } from "@/lib/database.types";
import type { Client } from "@/lib/services/workspace";
import { dispatchToken } from "@/lib/server/server-token";
import { promptKeyring, type PromptKeyring } from "@/lib/server/prompt-vault";
import { completeUsage, failUsage, startUsage } from "@/lib/services/usage";
import { recordProviderCalls, type Consumer } from "@/lib/server/ai-usage";
import { notifyGenerationDone } from "@/lib/server/user-notifications";
import { callImageModel, type ImageCallInput, type ImageCallResult } from "@/lib/server/engine/image-call";
import { beginStep, claimRun, finishStep, patchRun, type RunRow, type StepRunRow, type StepResult } from "@/lib/server/engine/workflow-store";
import { textCapableBackends, encryptConceptPayload } from "@/lib/server/prompt-engine";
import { buildFidelityInstructions } from "@/lib/ai/product-lock";
import type { AspectRatio, Resolution } from "@/lib/ai/types";
import type { VisionBackend } from "@/lib/ai/engine/vision";
import { TOOL_VARIABLES, compileTemplate } from "@/lib/ai/prompt-variables";
import { readBlockState } from "@/lib/server/account-block";
import { getAvailabilityMap } from "@/lib/server/feature-availability";
import { defaultStateFor } from "@/lib/features";
import { FRAME_TYPES, parseEngineConfig, recipeById, type EngineConfig } from "@/lib/grovshot-v2/config";
import { CARD_SCHEMA, GROVSHOT_V2_KEYS, PLAN_SCHEMA, VALIDATE_SCHEMA, qcSchema, type GrovshotStageKey, type RawQc, type RawValidation } from "@/lib/grovshot-v2/stages";
import { decideAfterCard, decideValidation, validationForPrompt, type CustomerNote, type ValidationResult } from "@/lib/grovshot-v2/validation";
import { cardForPrompt, normaliseCard, photoCatalog, type ProductCard } from "@/lib/grovshot-v2/card";
import { checkPlan, needsReplan, peopleTargets, renderPeopleTargets, renderPlanFeedback, renderUserPlan, type PlanCheck, type Shot } from "@/lib/grovshot-v2/plan";
import { qcRules, recipeCatalog, recipeForPlan, referenceMap, shotSpec, shotValues } from "@/lib/grovshot-v2/prompt";
import { decideQc, pickBest, planRetry, type QcDecision, type QcFinding } from "@/lib/grovshot-v2/qc";
import { compareColors } from "@/lib/grovshot-v2/color";
import { fits, generationEstimate } from "@/lib/grovshot-v2/budget";
import { P, itemOf } from "@/lib/grovshot-v2/steps";
import { callStage, checkLimits, type StageCall, type StageResult } from "@/lib/server/grovshot-v2/stage-call";
import { forImageModel, forVision, pixelsOf, readOrderPhotos, sha256, dimensionsOf, type OrderPhoto } from "@/lib/server/grovshot-v2/media";
import { readEngineState } from "@/lib/server/grovshot-v2/settings";
import type { StoredInput } from "@/lib/server/grovshot-v2/start";
import {
  derivatives, eventByKey, eventStatus, freshBalance, jobAsset, jobFailed, markJobCompleted,
  removeFolder, removeLibraryRows, storeNew, walletId,
} from "@/lib/server/grovshot-v2/library";

/**
 * GROVBASE SHOT V2 — THE DRIVER. One order = one `ai_engine_runs` row (run
 * kind 'grovshot'); every unit of work is an `ai_engine_step_runs` row, so a
 * finished unit is never executed (or paid for) again:
 *
 *   1   Etap 0 — the photo check (vision)                       item -1
 *   2   Etap 1 — the product card (vision + the description)    item -1
 *   3   Etap 2 — the shot plan (text); the single re-plan       item 0 / 1
 *   4   the customer-visible mirror (prompt session + concepts) item -1
 *   5   one ROUND of a shot: its candidates (Nano Banana Pro),  item shot·5+round
 *       their QC (vision + the colour check), the decision
 *   6   the shot's CHARGE — only once a candidate passed QC     item shot·5+round
 *   7   its delivery to the library                             item shot·5+round
 *   8   the server's "delivered" mark                           item shot·5+round
 *   9   the shot's final state (delivered / why not)            item shot
 *
 * MONEY. A shot is charged when — and only when — QC accepted an image:
 * job → charge → library → mark → charge closed, seconds apart in ONE
 * invocation. Candidates, QC calls and the retry are GrovBase's cost; a shot
 * that fails is never charged, and one whose delivery fails after the charge
 * is refunded (library rows and files removed first). The price is the one
 * quoted at the start (ai_models.pricing[size]).
 *
 * TIME. Each invocation has 270 s (routes declare 300). A round starts only
 * when the generation, its QC and the delivery fit; the candidates' bytes
 * live in memory only — never in a folder the customer can read — so a round
 * whose invocation died is LOST (never re-sent) and may use the shot's one
 * retry. Text stages (no image, no ledger) are re-sent on resume, a few times.
 */

export const INVOCATION_BUDGET_MS = 270_000;
export const HARD_END_MS = 300_000;
const STAGE_MARGIN_MS = 15_000;
const STAGE_TIMEOUT_MS = { validate: 90_000, card: 110_000, plan: 110_000 } as const;
/** A round is begun only with this much of the invocation left. */
export const ROUND_START_MS = 160_000;
/** Kept after the candidates for QC and delivery. */
const DELIVER_RESERVE_MS = 25_000;
/** Image call ceiling inside a round. */
const IMAGE_CALL_MS = 75_000;
/** A text stage interrupted this many times stops the order (nothing charged). */
const TEXT_RESUME_LIMIT = 3;
/** Nano Banana Pro calls in flight per instance, across every V2 order. */
const IMAGE_SLOTS = 2;

export { P };

export type GrovshotDeps = {
  callImage: (supabase: Client, input: ImageCallInput) => Promise<ImageCallResult>;
  callStage: <T>(supabase: Client, call: StageCall, rec: Parameters<typeof callStage>[2]) => Promise<StageResult<T>>;
  now: () => number;
};
const DEFAULT_DEPS: GrovshotDeps = { callImage: callImageModel, callStage, now: () => Date.now() };

/** `locked`: another invocation still holds the run's lease (nothing done).
 *  `stalled`: nothing could be begun (the run, its steps or its key could not
 *  be read, or every unit was busy) — the next call should come later. */
export type AdvanceResult = "finished" | "yield" | "busy" | "stalled" | "locked" | "not_found";

/** The lease a stalled invocation leaves: an unwell database or provider is
 *  not asked again every few seconds (a page poll included). */
const STALL_LEASE_S = 30;

type Ctx = {
  supabase: Client;
  userId: string;
  workspaceId: string;
  runId: string;
  owner: string;
  deadlineAt: number;
  hardEndAt: number;
  deps: GrovshotDeps;
  run: RunRow;
  input: StoredInput;
  config: EngineConfig;
  bodies: Record<GrovshotStageKey, string>;
  versions: Record<GrovshotStageKey, number>;
  ring: PromptKeyring;
  test: boolean;
  steps: StepRunRow[];
  progress: Record<string, Json>;
  writer: Promise<unknown>;
  reserved: number;
  /** Shots of this invocation past the balance check and not charged yet,
   *  by the order they were begun in (their credits are still in the balance). */
  inFlight: Set<number>;
  shotSeq: number;
  /** A step was begun by this invocation (it was not a stall). */
  progressed: boolean;
  stopNew: string | null;
  /** The account / availability gates could not be read: no new round now. */
  gateUnknown?: boolean;
  /** Each planned shot's first-round candidates (what a lost round may have sent). */
  candidatesOf?: Map<number, number>;
  qcFailStreak: number;
  photos: Map<number, OrderPhoto>;
  backends: VisionBackend[] | null;
  unitPrices: Awaited<ReturnType<typeof readEngineState>>["unitPrices"];
  tokenPrices: Awaited<ReturnType<typeof readEngineState>>["tokenPrices"];
};

/* ══ helpers ══════════════════════════════════════════════════════════════*/

const left = (ctx: Ctx) => ctx.deadlineAt - ctx.deps.now();
const leaseSeconds = (ctx: Ctx) => Math.max(10, Math.ceil((ctx.hardEndAt + 15_000 - ctx.deps.now()) / 1000));
const stepOf = (ctx: Ctx, pos: number, item: number) => ctx.steps.find((s) => s.position === pos && s.item_index === item);
const rowsOf = (ctx: Ctx, pos: number, shot: number) => ctx.steps
  .filter((s) => s.position === pos && s.item_index >= shot * 5 && s.item_index < shot * 5 + 5)
  .sort((a, b) => a.item_index - b.item_index);
function outputOf(s: Pick<StepRunRow, "output"> | undefined | null): Record<string, unknown> {
  const o = s?.output;
  return o && typeof o === "object" && !Array.isArray(o) ? o as Record<string, unknown> : {};
}
const consumer = (ctx: Ctx): Consumer => (ctx.test ? "workflow_test" : "generation");

async function begin(ctx: Ctx, pos: number, item: number, name: string, op: "ai_text" | "image_generation" | "tool") {
  const b = await beginStep(ctx.supabase, ctx.runId, ctx.owner, pos, item, name, op, leaseSeconds(ctx));
  if (b.state === "run") ctx.progressed = true;
  return b;
}

/** Finish a step and keep the local snapshot in step with it. */
async function finish(ctx: Ctx, pos: number, item: number, res: StepResult): Promise<boolean> {
  // A provider's error text never breaks the step row's code format.
  const r: StepResult = res.status === "failed"
    ? { ...res, errorCode: (res.errorCode ?? "error").toLowerCase().replace(/[^a-z0-9_:.\-]/g, "_").slice(0, 80) || "error" }
    : res;
  const ok = await finishStep(ctx.supabase, ctx.runId, ctx.owner, pos, item, r);
  const row: StepRunRow = {
    position: pos, item_index: item, status: r.status, attempts: r.attempts, provider_slug: r.providerSlug ?? null,
    model: r.model ?? null, input_tokens: r.inputTokens ?? null, output_tokens: r.outputTokens ?? null, units: r.units ?? null,
    unit_kind: r.unitKind ?? null, cost_usd_micros: r.cost.basis === "unknown" ? null : r.cost.usdMicros, cost_basis: r.cost.basis,
    error_code: r.status === "failed" ? (r.errorCode ?? "error") : null, output: r.status === "succeeded" ? (r.output ?? null) : null,
    duration_ms: r.durationMs, step_name: null, operation: "tool",
  };
  ctx.steps = [...ctx.steps.filter((s) => !(s.position === pos && s.item_index === item)), row];
  return ok;
}

/** ONE progress writer per invocation: the state is changed synchronously,
 *  the latest full object is written in order — concurrent shots can never
 *  overwrite each other's change. */
function setProgress(ctx: Ctx, patch: Record<string, Json>): Promise<unknown> {
  Object.assign(ctx.progress, patch);
  const snapshot = { ...ctx.progress };
  ctx.writer = ctx.writer.then(() => patchRun(ctx.supabase, ctx.runId, ctx.owner, { progress: snapshot })).catch(() => false);
  return ctx.writer;
}

function addNotes(ctx: Ctx, notes: { code: string; photo?: number; row?: number; ask?: boolean }[]) {
  const cur = Array.isArray(ctx.progress.notes) ? ctx.progress.notes as Json[] : [];
  const seen = new Set(cur.map((n) => JSON.stringify(n)));
  const next = [...cur];
  for (const n of notes) {
    const j = JSON.parse(JSON.stringify(n)) as Json;
    if (!seen.has(JSON.stringify(j))) { seen.add(JSON.stringify(j)); next.push(j); }
  }
  return setProgress(ctx, { notes: next.slice(0, 40) });
}

/** The image slots, shared by every V2 order in this instance — taken BEFORE
 *  a round is begun, so a round never waits for a slot while its clock runs. */
let slotsFree = IMAGE_SLOTS;
const waiting: { n: number; go: () => void }[] = [];
function acquireImages(n: number): Promise<() => void> {
  const need = Math.min(IMAGE_SLOTS, Math.max(1, n));
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    slotsFree += need;
    while (waiting.length > 0 && waiting[0].n <= slotsFree) {
      const w = waiting.shift()!;
      slotsFree -= w.n;
      w.go();
    }
  };
  if (slotsFree >= need && waiting.length === 0) { slotsFree -= need; return Promise.resolve(release); }
  return new Promise((resolve) => waiting.push({ n: need, go: () => resolve(release) }));
}

/** Spend so far: known step costs; a call without a price at the config's
 *  estimate; a round that did not finish at its worst case (every image it
 *  may have sent within the shot's paid-image cap, each with its QC) — never
 *  as one cheap call. */
function spentSoFar(ctx: Ctx): number {
  let total = 0;
  const est = generationEstimate(ctx.input.unit_price_usd_micros, ctx.config.budget);
  const maxCandidates = Math.max(ctx.config.candidates.default, ctx.config.candidates.people_or_complex);
  const images = new Map<number, number>();
  for (const shot of new Set(ctx.steps.filter((s) => s.position === P.round).map((s) => Math.floor(s.item_index / 5)))) {
    for (const r of roundImages(ctx, { index: shot, candidates: ctx.candidatesOf?.get(shot) ?? maxCandidates })) images.set(r.item, r.images);
  }
  for (const s of ctx.steps) {
    const unknown = Number(outputOf(s).unknown_calls) || 0;
    if (s.cost_basis !== "unknown" && s.cost_usd_micros !== null) total += s.cost_usd_micros;
    else if (s.position === P.round && s.status !== "pending") total += (images.get(s.item_index) ?? 0) * est;
    else if (s.position < P.round && s.status !== "pending") total += ctx.config.budget.unknown_text_call_usd_micros;
    total += unknown * ctx.config.budget.unknown_text_call_usd_micros;
  }
  return total;
}

async function readRunRow(supabase: Client, runId: string): Promise<RunRow | null | "unknown"> {
  const { data, error } = await supabase.rpc("ai_engine_run_read", { p_token: dispatchToken() ?? "", p_run_id: runId });
  if (error || !Array.isArray(data)) return "unknown";
  return (data[0] as unknown as RunRow | undefined) ?? null;
}

async function readSteps(supabase: Client, runId: string): Promise<StepRunRow[] | null> {
  const { data, error } = await supabase.rpc("ai_engine_step_runs_read", { p_token: dispatchToken() ?? "", p_run_id: runId });
  if (error || !Array.isArray(data)) return null;
  return data as unknown as StepRunRow[];
}

export function parseInput(raw: unknown): StoredInput | null {
  const i = raw as Partial<StoredInput> | null;
  if (!i || i.v !== 1 || i.engine !== "grovshot_v2" || !Array.isArray(i.photos) || i.photos.length === 0) return null;
  if (!Array.isArray(i.photo_shas) || i.photo_shas.length !== i.photos.length || !i.stages || !i.quote || !i.model) return null;
  if (typeof i.shots !== "number" || i.shots < 1 || i.shots > 10) return null;
  return i as StoredInput;
}

/* ══ entry ════════════════════════════════════════════════════════════════*/

export async function advanceGrovshotRun(
  supabase: Client, userId: string, workspaceId: string, runId: string,
  opts: { deadlineAt: number; hardEndAt?: number; deps?: Partial<GrovshotDeps> },
): Promise<AdvanceResult> {
  const deps: GrovshotDeps = { ...DEFAULT_DEPS, ...opts.deps };
  const first = await readRunRow(supabase, runId);
  // Unreadable: nothing claimed, nothing done — ask again later, not at once.
  if (first === "unknown") return "stalled";
  if (!first || (first.run_kind !== "grovshot" && first.run_kind !== "grovshot_test")
    || first.user_id !== userId || first.workspace_id !== workspaceId) return "not_found";
  if (first.status !== "queued" && first.status !== "running") return "finished";
  const hardEndAt = opts.hardEndAt ?? opts.deadlineAt + (HARD_END_MS - INVOCATION_BUDGET_MS);
  const owner = `gsv2:${randomUUID()}`;
  const claim = await claimRun(supabase, runId, owner, Math.max(10, Math.ceil((hardEndAt + 15_000 - deps.now()) / 1000)));
  if (!claim.claimed) return claim.reason === "finished" ? "finished" : "locked";

  const stall = async (): Promise<AdvanceResult> => {
    await patchRun(supabase, runId, owner, { lease_seconds: STALL_LEASE_S });
    return "stalled";
  };
  const run = await readRunRow(supabase, runId);
  if (run === "unknown" || !run) return stall();
  const base = { supabase, userId, workspaceId, runId, owner, deadlineAt: opts.deadlineAt, hardEndAt, deps, run };
  const input = parseInput(run.input);
  if (!input) { await closeEarly(base, "failed", "common_error"); return "finished"; }

  // The start-time texts, opened from the run — never what is published now.
  const ring = await promptKeyring(supabase);
  const bodies = {} as Record<GrovshotStageKey, string>;
  const versions = {} as Record<GrovshotStageKey, number>;
  for (const k of GROVSHOT_V2_KEYS) {
    const st = input.stages[k];
    const opened = st ? ring.open({ ciphertext: st.sealed.ciphertext, iv: st.sealed.iv, authTag: st.sealed.authTag }) : null;
    if (!opened || sha256(opened.text) !== st.sha256) {
      // The key is unreachable right now (or the text was tampered with): not
      // a reason to run on anything else. Wait for a later call.
      return stall();
    }
    bodies[k] = opened.text;
    versions[k] = st.version;
  }
  const parsed = parseEngineConfig(bodies.grovshot_v2_config);
  if (!parsed.ok) { await closeEarly(base, "failed", "config_invalid"); return "finished"; }
  const steps = await readSteps(supabase, runId);
  if (!steps) return stall();
  const state = await readEngineState(supabase);

  const ctx: Ctx = {
    ...base, input, config: parsed.config, bodies, versions, ring, test: run.run_kind === "grovshot_test",
    steps, progress: { ...((run.progress && typeof run.progress === "object" && !Array.isArray(run.progress)) ? run.progress as Record<string, Json> : {}) },
    writer: Promise.resolve(), reserved: 0, inFlight: new Set(), shotSeq: 0, progressed: false, stopNew: null, qcFailStreak: Number((run.progress as Record<string, unknown> | null)?.qc_fail_streak) || 0,
    photos: new Map(), backends: null, unitPrices: state.unitPrices, tokenPrices: state.tokenPrices,
  };

  let outcome: "finished" | "yield" | "busy" | "lost";
  try {
    outcome = await drive(ctx);
  } catch (e) {
    console.error("[grovshot-v2] drive error", runId.slice(0, 8), e instanceof Error ? e.name : "error");
    outcome = "yield";
  }
  await ctx.writer;
  if (outcome === "finished") return "finished";
  // Hand the run back quickly so the next call does not wait out a lease —
  // also when it was lost (the patch is a no-op unless the lease is still
  // ours, so a driver that really took over keeps it). An invocation that
  // could begin nothing leaves a longer lease and says so.
  if (!ctx.progressed) return stall();
  await patchRun(supabase, runId, owner, { lease_seconds: outcome === "busy" ? 60 : 10 });
  return outcome === "busy" ? "busy" : "yield";
}

type Drive = "finished" | "yield" | "busy" | "lost";

async function drive(ctx: Ctx): Promise<Drive> {
  // Gates a customer order re-checks on every invocation, before anything new
  // is charged: a blocked account or a feature switched off stops new shots.
  if (!ctx.test) {
    const blocked = await readBlockState(ctx.supabase, ctx.userId).then((s) => s.blocked).catch(() => null);
    const map = blocked === false ? await getAvailabilityMap(ctx.supabase).catch(() => null) : null;
    if (blocked === true) ctx.stopNew = "account_blocked";
    else if (blocked === null || !map) ctx.gateUnknown = true;
    else if ((["prompts", "generator"] as const).some((k) => (map[k] ?? defaultStateFor(k)).status !== "ACTIVE")) ctx.stopNew = "feature_unavailable";
  }
  // Not analysed yet — the analysis is complete once its shots are mirrored
  // (plan, any re-plan, the session rows) — and stopped (account blocked,
  // tool switched off): no further paid analysis; nothing was charged yet.
  // Gates that cannot be read: nothing new now.
  const analysed = stepOf(ctx, P.mirror, -1)?.status === "succeeded";
  if (!analysed && ctx.stopNew) { await close(ctx, "failed", ctx.stopNew); return "finished"; }
  if (!analysed && ctx.gateUnknown) return "busy";
  const analysis = await analyse(ctx);
  if (typeof analysis === "string") return analysis;
  const mirror = await ensureMirror(ctx, analysis.card, analysis.plan.shots);
  if (typeof mirror === "string") return mirror;
  return shotsPhase(ctx, analysis.card, analysis.plan.shots, mirror);
}

/* ══ A · analysis (Etap 0–2) ══════════════════════════════════════════════*/

type Analysis = { validation: ValidationResult; card: ProductCard; plan: PlanCheck };

async function backends(ctx: Ctx): Promise<VisionBackend[]> {
  ctx.backends ??= await textCapableBackends(ctx.supabase).catch(() => []);
  return ctx.backends;
}

async function photos(ctx: Ctx, numbers: readonly number[]): Promise<OrderPhoto[] | "changed" | "unreadable"> {
  const missing = numbers.filter((n) => !ctx.photos.has(n));
  if (missing.length > 0) {
    const r = await readOrderPhotos(ctx.supabase, ctx.input.photos, ctx.input.photo_shas, missing);
    if (!r.ok) return r.error === "reference_changed" ? "changed" : "unreadable";
    for (const p of r.photos) ctx.photos.set(p.number, p);
  }
  return numbers.map((n) => ctx.photos.get(n)!);
}

let lookupCache: { runId: string; value: { validate: unknown; card: unknown } | null } | null = null;
async function analysisLookup(ctx: Ctx): Promise<{ validate: Record<string, unknown> | null; card: Record<string, unknown> | null }> {
  if (lookupCache?.runId !== ctx.runId) {
    const { data, error } = await ctx.supabase.rpc("grovshot_analysis_lookup", {
      p_token: dispatchToken() ?? "", p_workspace_id: ctx.workspaceId, p_photo_key: ctx.input.photo_key, p_card_key: ctx.input.card_key,
    });
    lookupCache = { runId: ctx.runId, value: error ? null : (data as { validate: unknown; card: unknown } | null) };
  }
  const v = lookupCache.value;
  const obj = (x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : null);
  return { validate: obj(v?.validate), card: obj(v?.card) };
}

/** Run (or reuse) one text/vision stage step. */
async function stageStep<T>(ctx: Ctx, pos: number, item: number, name: string,
  cached: Record<string, unknown> | null, timeoutMs: number, build: () => Promise<StageCall | "changed" | "unreadable">,
  soft = false,
): Promise<{ raw: T; out: Record<string, unknown> } | Drive | null> {
  const s = stepOf(ctx, pos, item);
  if (s?.status === "succeeded") return { raw: outputOf(s).raw as T, out: outputOf(s) };
  if (s?.status === "failed") {
    if (soft) return null;
    await close(ctx, "failed", "analysis_unavailable");
    return "finished";
  }
  if (cached?.raw !== undefined) {
    const b = await begin(ctx, pos, item, name, "ai_text");
    if (b.state === "done") return { raw: outputOf({ output: b.output }).raw as T, out: outputOf({ output: b.output }) };
    if (b.state !== "run") return b.state === "not_owner" ? "lost" : "busy";
    const out = { ...cached, cached: true };
    await finish(ctx, pos, item, { status: "succeeded", attempts: b.attempts + 1, cost: { basis: "estimated", usdMicros: 0 }, output: out as Json, durationMs: 0 });
    return { raw: cached.raw as T, out };
  }
  if (left(ctx) < timeoutMs + STAGE_MARGIN_MS) return "yield";
  const b = await begin(ctx, pos, item, name, "ai_text");
  if (b.state === "done") return { raw: outputOf({ output: b.output }).raw as T, out: outputOf({ output: b.output }) };
  if (b.state === "busy") return "busy";
  if (b.state === "not_owner") return "lost";
  if (b.state !== "run") { await close(ctx, "failed", "analysis_unavailable"); return "finished"; }
  const t0 = ctx.deps.now();
  // A text stage carries no image and no charge: re-sent on resume, a few times.
  if (b.attempts >= TEXT_RESUME_LIMIT) {
    await finish(ctx, pos, item, { status: "failed", attempts: b.attempts + 1, cost: { basis: "unknown" }, errorCode: "resume_limit", durationMs: 0 });
    await close(ctx, "failed", "analysis_unavailable");
    return "finished";
  }
  const call = await build();
  if (call === "changed" || call === "unreadable") {
    await finish(ctx, pos, item, { status: "failed", attempts: b.attempts + 1, cost: { basis: "estimated", usdMicros: 0 }, errorCode: call === "changed" ? "reference_changed" : "photo_unreadable", durationMs: 0 });
    await close(ctx, "failed", call === "changed" ? "reference_changed" : "unavailable");
    return "finished";
  }
  const res = await ctx.deps.callStage<T>(ctx.supabase, call, {
    consumer: consumer(ctx), actorKind: ctx.test ? "admin" : "customer", userId: ctx.userId, workspaceId: ctx.workspaceId, runRef: ctx.runId,
  });
  const meta = { trace: (res.trace ?? null) as unknown as Json, unknown_calls: res.unknownCalls };
  if (!res.ok) {
    await finish(ctx, pos, item, { status: "failed", attempts: b.attempts + 1, cost: res.cost, errorCode: res.error.slice(0, 80), durationMs: ctx.deps.now() - t0 });
    if (soft) return null;
    await close(ctx, "failed", "analysis_unavailable");
    return "finished";
  }
  const out = { raw: res.data as unknown as Json, ...meta };
  await finish(ctx, pos, item, {
    status: "succeeded", attempts: b.attempts + 1, providerSlug: res.trace.provider, model: res.trace.model,
    cost: res.cost, output: out as Json, durationMs: ctx.deps.now() - t0,
  });
  return { raw: res.data, out };
}

async function analyse(ctx: Ctx): Promise<Analysis | Drive> {
  const { input, config } = ctx;
  const photoCount = input.photos.length;
  const all = input.photos.map((_, i) => i + 1);
  const analysed = stepOf(ctx, P.validate, -1)?.status === "succeeded" && stepOf(ctx, P.card, -1)?.status === "succeeded";
  const cache = analysed ? { validate: null, card: null } : await analysisLookup(ctx);

  // ── Etap 0 ──
  await setProgress(ctx, { stage: "analyze" });
  const v0 = await stageStep<RawValidation>(ctx, P.validate, -1, "validate", cache.validate, STAGE_TIMEOUT_MS.validate, async () => {
    const ph = await photos(ctx, all);
    if (typeof ph === "string") return ph;
    return {
      key: "grovshot_v2_validate", body: ctx.bodies.grovshot_v2_validate,
      values: { photo_count: String(photoCount), session_type: "lifestyle" },
      images: await Promise.all(ph.map((p) => forVision(p.bytes))), schema: VALIDATE_SCHEMA,
      timeoutMs: STAGE_TIMEOUT_MS.validate, deadlineAt: ctx.deadlineAt, backends: await backends(ctx),
      models: config.models, tokenPrices: ctx.tokenPrices, now: ctx.deps.now,
    };
  });
  if (typeof v0 === "string" || v0 === null) return v0 ?? "finished";
  const validation = decideValidation(v0.raw ?? {}, { photoCount, acknowledge: input.acknowledge }, config.validation);
  if (validation.verdict === "blocked") {
    await addNotes(ctx, validation.notes);
    await close(ctx, "blocked", "blocked_input");
    return "finished";
  }

  // ── Etap 1 ──
  const c1 = await stageStep<unknown>(ctx, P.card, -1, "card", cache.card, STAGE_TIMEOUT_MS.card, async () => {
    const ph = await photos(ctx, all);
    if (typeof ph === "string") return ph;
    return {
      key: "grovshot_v2_card", body: ctx.bodies.grovshot_v2_card,
      values: {
        photo_count: String(photoCount), validation_summary: validationForPrompt(validation),
        allegro_description: input.description, customer_dimensions: input.dimensions ?? "",
        style_recipes: recipeCatalog(config), session_type: "lifestyle",
      },
      // Every photo, in upload order — the numbering IS the order; the photos
      // Etap 0 set aside are marked so in the summary.
      images: await Promise.all(ph.map((p) => forVision(p.bytes))), schema: CARD_SCHEMA,
      timeoutMs: STAGE_TIMEOUT_MS.card, deadlineAt: ctx.deadlineAt, backends: await backends(ctx),
      models: config.models, tokenPrices: ctx.tokenPrices, now: ctx.deps.now,
    };
  });
  if (typeof c1 === "string" || c1 === null) return c1 ?? "finished";
  const cardRes = normaliseCard(c1.raw, {
    validation, customerDimensions: input.dimensions, customerDimsCm: input.dimensions_cm,
  }, config);
  if (!cardRes.ok) { await close(ctx, "failed", "analysis_unavailable"); return "finished"; }
  const card = cardRes.card;
  const after = decideAfterCard(validation, cardRes.signals, { customerDimensions: input.dimensions, acknowledge: input.acknowledge }, config.validation);
  await addNotes(ctx, after.notes);
  if (after.verdict !== "proceed") {
    // Nothing was charged; the analysis stays reusable for the confirmed order.
    await close(ctx, "blocked", after.verdict === "needs_dimensions" ? "needs_dimensions" : after.verdict === "attention" ? "needs_attention" : "blocked_input");
    return "finished";
  }

  // ── Etap 2 ──
  await setProgress(ctx, { stage: "plan" });
  const recipe = recipeById(config, card.recipe_id);
  const planValues = (feedback: string) => ({
    shot_count: String(input.shots), product_card: cardForPrompt(card), photo_catalog: photoCatalog(card),
    style_recipe: recipeForPlan(recipe), shared_rules: config.shared_rules.join("\n"),
    banned_cliches: config.banned_cliches.join(", "), frame_types: FRAME_TYPES.join(", "),
    people_targets: renderPeopleTargets(peopleTargets(config, input.shots, card)),
    user_shot_plan: renderUserPlan(input.user_rows ?? undefined), plan_feedback: feedback,
    aspect_ratio: input.aspect_ratio, session_type: "lifestyle",
  });
  const planCall = (feedback: string) => async (): Promise<StageCall> => ({
    key: "grovshot_v2_plan", body: ctx.bodies.grovshot_v2_plan, values: planValues(feedback), images: [],
    schema: PLAN_SCHEMA, timeoutMs: STAGE_TIMEOUT_MS.plan, deadlineAt: ctx.deadlineAt, backends: await backends(ctx),
    models: config.models, tokenPrices: ctx.tokenPrices, now: ctx.deps.now,
  });
  const check = (raw: unknown) => checkPlan(raw, { card, shots: input.shots, userRows: input.user_rows ?? undefined, config });
  const p0 = await stageStep<unknown>(ctx, P.plan, 0, "plan", null, STAGE_TIMEOUT_MS.plan, planCall(""));
  if (typeof p0 === "string" || p0 === null) return p0 ?? "finished";
  let plan = check(p0.raw);
  if (needsReplan(plan) && config.limits.replans === 1) {
    // The re-plan is an improvement attempt: if it cannot be made, the first
    // plan stands (with its violations recorded).
    const p1 = await stageStep<unknown>(ctx, P.plan, 1, "replan", null, STAGE_TIMEOUT_MS.plan, planCall(renderPlanFeedback(plan.violations)), true);
    if (typeof p1 === "string") return p1;
    if (p1) {
      const second = check(p1.raw);
      // The re-plan stands unless it lost shots the first plan had.
      if (second.shots.length >= plan.shots.length) plan = second;
    }
  }
  if (plan.shots.length === 0) { await close(ctx, "failed", "plan_invalid"); return "finished"; }
  await addNotes(ctx, [...plan.notes, ...(plan.shots.length < input.shots ? [{ code: "plan_short" }] : [])]);
  if (ctx.progress.planned !== plan.shots.length) await setProgress(ctx, { planned: plan.shots.length, recipe: recipe.id });
  return { validation: after, card, plan };
}

/* ══ B · the customer-visible mirror ══════════════════════════════════════*/

type Mirror = { sessionId: string | null; concepts: Record<number, string> };

function compileShot(ctx: Ctx, shot: Shot, card: ProductCard, correction: string | null): { ok: true; text: string } | { ok: false; error: string } {
  const values = shotValues({
    shot, card, recipe: recipeById(ctx.config, card.recipe_id), config: ctx.config,
    aspectRatio: ctx.input.aspect_ratio, resolution: ctx.input.resolution,
    fidelityRules: buildFidelityInstructions(), correction,
  });
  const tooLong = checkLimits("grovshot_v2_shot", ctx.bodies.grovshot_v2_shot, values);
  if (tooLong) return { ok: false, error: `variable_too_long:${tooLong}`.slice(0, 80) };
  const c = compileTemplate(ctx.bodies.grovshot_v2_shot, TOOL_VARIABLES.grovshot_v2_shot ?? [], values);
  return c.ok ? { ok: true, text: c.text } : { ok: false, error: `variable_missing:${c.missing[0] ?? c.unknown[0] ?? ""}`.slice(0, 80) };
}

async function ensureMirror(ctx: Ctx, card: ProductCard, shots: Shot[]): Promise<Mirror | Drive> {
  const s = stepOf(ctx, P.mirror, -1);
  const read = (o: Record<string, unknown>): Mirror => ({
    sessionId: typeof o.session_id === "string" ? o.session_id : null,
    concepts: (o.concepts && typeof o.concepts === "object" ? o.concepts : {}) as Record<number, string>,
  });
  if (s?.status === "succeeded") return read(outputOf(s));
  await setProgress(ctx, { stage: "scenes" });
  const b = await begin(ctx, P.mirror, -1, "mirror", "tool");
  if (b.state === "done") return read(outputOf({ output: b.output }));
  if (b.state === "busy") return "busy";
  if (b.state === "not_owner") return "lost";
  if (b.state !== "run") { await close(ctx, "failed", "unavailable"); return "finished"; }
  if (ctx.test) {
    const out = { session_id: null, concepts: {} };
    await finish(ctx, P.mirror, -1, { status: "succeeded", attempts: b.attempts + 1, cost: { basis: "estimated", usdMicros: 0 }, output: out, durationMs: 0 });
    return read(out);
  }
  // Customer-visible rows, never read back as truth: the session (its photos
  // in upload order) and one concept per shot — the sealed base prompt, the
  // shot's title and summary — so 👍/👎 and „Regeneruj” work per shot.
  const { data: session, error } = await ctx.supabase.from("prompt_sessions").insert({
    workspace_id: ctx.workspaceId, user_id: ctx.userId, product_id: null,
    product_name: card.name.slice(0, 120), description: null, extra_info: null,
    aspect_ratio: ctx.input.aspect_ratio, style: null, resolution: ctx.input.resolution,
    reference_paths: ctx.input.photos, status: "ready", mode: "engine", session_type: "lifestyle",
  }).select("id").single();
  if (error || !session) {
    await finish(ctx, P.mirror, -1, { status: "failed", attempts: b.attempts + 1, cost: { basis: "estimated", usdMicros: 0 }, errorCode: "session_create_failed", durationMs: 0 });
    await close(ctx, "failed", "unavailable");
    return "finished";
  }
  const rows = [];
  for (const shot of shots) {
    const prompt = compileShot(ctx, shot, card, null);
    if (!prompt.ok) continue;
    const sealed = encryptConceptPayload(ctx.ring, prompt.text, "", { tv: ctx.versions.grovshot_v2_shot });
    rows.push({
      product_id: null, workspace_id: ctx.workspaceId, session_id: session.id,
      concept_name: shot.title, shot_type: "scene", scene_type: null,
      customer_title: shot.title, customer_description: shot.summary || shot.argument,
      prompt_text: "", negative_prompt: null,
      prompt_encrypted: sealed.ciphertext, prompt_iv: sealed.iv, prompt_tag: sealed.authTag,
      primary_reference: shot.references[0] ?? 1, supporting_references: [] as never,
      reference_indices: shot.references, reference_image_ids: [], reference_rationale: null,
      format: ctx.input.aspect_ratio, style: null, priority: shot.index + 1, status: "ready" as const, lock_strength: "LOW",
      model_id: ctx.input.model.id,
    });
  }
  const { data: inserted } = rows.length > 0
    ? await ctx.supabase.from("generated_prompts").insert(rows).select("id, priority")
    : { data: [] as { id: string; priority: number }[] };
  const concepts: Record<number, string> = {};
  for (const r of inserted ?? []) concepts[(r.priority ?? 0) - 1] = r.id;
  const out = { session_id: session.id, concepts };
  await finish(ctx, P.mirror, -1, { status: "succeeded", attempts: b.attempts + 1, cost: { basis: "estimated", usdMicros: 0 }, output: out as Json, durationMs: 0 });
  return read(out);
}

/* ══ C · shots ════════════════════════════════════════════════════════════*/

const settled = (ctx: Ctx, n: number) => {
  const s = stepOf(ctx, P.settle, n);
  return s?.status === "succeeded" || s?.status === "failed";
};

async function shotsPhase(ctx: Ctx, card: ProductCard, shots: Shot[], mirror: Mirror): Promise<Drive> {
  ctx.candidatesOf = new Map(shots.map((s) => [s.index, s.candidates]));
  const pending = shots.filter((s) => !settled(ctx, s.index));
  if (pending.length === 0) return closeRun(ctx, shots);
  await setProgress(ctx, { stage: "images" });
  const results: ShotOutcome[] = [];
  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const shot = pending[next++];
      let r: ShotOutcome;
      try {
        r = await runShot(ctx, card, shot, mirror);
      } catch (e) {
        console.error("[grovshot-v2] shot error", ctx.runId.slice(0, 8), shot.index, e instanceof Error ? e.name : "error");
        r = "yield";
      }
      results.push(r);
      if (r === "lost") return;
    }
  };
  // Every worker settles before the run is handed back: no shot is ever cut
  // off mid-call by the lease being released under it.
  await Promise.allSettled(Array.from({ length: Math.max(1, Math.min(ctx.config.limits.shot_concurrency, pending.length)) }, worker));
  if (results.includes("lost")) return "lost";
  if (shots.every((s) => settled(ctx, s.index))) return closeRun(ctx, shots);
  return results.includes("yield") ? "yield" : "busy";
}

type ShotOutcome = "settled" | "yield" | "busy" | "lost";

async function settle(ctx: Ctx, n: number, ok: boolean, reason: string, output: Record<string, Json> = {}): Promise<ShotOutcome> {
  const b = await begin(ctx, P.settle, n, "settle", "tool");
  if (b.state === "not_owner") return "lost";
  if (b.state === "done" || b.state === "failed" || b.state === "skipped") return "settled";
  if (b.state !== "run") return "busy";
  await finish(ctx, P.settle, n, ok
    ? { status: "succeeded", attempts: b.attempts + 1, cost: { basis: "estimated", usdMicros: 0 }, output: { state: "delivered", ...output }, durationMs: 0 }
    : { status: "failed", attempts: b.attempts + 1, cost: { basis: "estimated", usdMicros: 0 }, errorCode: reason, durationMs: 0 });
  return "settled";
}

/** A round is begun only when one image call, its QC and the delivery fit
 *  (never less than ROUND_START_MS): a longer published QC timeout moves it. */
function roundStartMs(ctx: Ctx): number {
  return Math.max(ROUND_START_MS,
    IMAGE_CALL_MS + ctx.config.qc.timeout_ms + DELIVER_RESERVE_MS - (HARD_END_MS - INVOCATION_BUDGET_MS) + 10_000);
}

/** The most paid image requests one round may make: its candidates, each
 *  re-issued at most transport_reissues times. */
function roundWorstCase(ctx: Ctx, shot: { candidates: number }, round: number): number {
  const candidates = round === 0 ? shot.candidates : ctx.config.retry.candidates;
  return candidates * (1 + ctx.config.retry.transport_reissues);
}

/** Paid image requests of each of a shot's rounds, in order. A round that did
 *  not finish (its invocation died) counts its WORST case within what the
 *  shot was still allowed — it may have sent everything. */
function roundImages(ctx: Ctx, shot: { index: number; candidates: number }): { item: number; images: number }[] {
  const cap = ctx.config.limits.max_paid_images_per_shot;
  let paid = 0;
  return rowsOf(ctx, P.round, shot.index).map((r) => {
    const cands = outputOf(r).candidates;
    const images = r.status !== "succeeded"
      ? Math.max(0, Math.min(cap - paid, roundWorstCase(ctx, shot, r.item_index - shot.index * 5)))
      : Array.isArray(cands) ? cands.reduce((a: number, c) => a + (Number((c as { calls?: unknown }).calls) || 1), 0) : 0;
    paid += images;
    return { item: r.item_index, images };
  });
}

/** Paid image requests a shot has made so far. */
function paidImages(ctx: Ctx, shot: Pick<Shot, "index" | "candidates">): number {
  return roundImages(ctx, shot).reduce((sum, r) => sum + r.images, 0);
}

/** Why a shot ends without an image, from its last round. */
function reasonOf(round: StepRunRow | undefined): string {
  const d = outputOf(round).decision;
  if (d === "rejected") return "qc_rejected";
  if (d === "unchecked") return "qc_unavailable";
  return "unavailable";
}

async function runShot(ctx: Ctx, card: ProductCard, shot: Shot, mirror: Mirror): Promise<ShotOutcome> {
  const n = shot.index;
  for (let guard = 0; guard < 6; guard++) {
    if (settled(ctx, n)) return "settled";
    // An acceptance whose delivery an earlier invocation did not finish.
    const pendingCharge = rowsOf(ctx, P.charge, n).find((c) => {
      if (c.status === "running" || c.status === "pending") return true;
      if (c.status !== "succeeded") return false;
      const d = stepOf(ctx, P.deliver, c.item_index);
      // Charged, and its delivery not closed as failed (released): open.
      return !d || d.status !== "failed";
    });
    if (pendingCharge) {
      const r = await recoverDelivery(ctx, n, pendingCharge);
      if (r === "busy" || r === "lost") return r;
      if (r === "delivered") return "settled";
    }
    const rounds = rowsOf(ctx, P.round, n);
    const used = rounds.length;
    const last = rounds[rounds.length - 1];
    if (last && (last.status === "running" || last.status === "pending")) {
      // Begun by an invocation that is gone: its candidates were only in
      // memory. Never re-sent — recorded as lost; the shot may still retry.
      const b = await begin(ctx, P.round, last.item_index, "round", "image_generation");
      if (b.state === "busy") return "busy";
      if (b.state === "not_owner") return "lost";
      if (b.state === "run") {
        await finish(ctx, P.round, last.item_index, { status: "failed", attempts: b.attempts + 1, cost: { basis: "unknown" }, errorCode: "round_lost", durationMs: 0 });
      }
      continue;
    }
    const maxRounds = 1 + ctx.config.retry.max_rounds;
    const prev = last ? outputOf(last) : null;
    const prevRetry = prev?.retry as { mode?: string; correction?: string } | null | undefined;
    const accepted = prev?.decision === "accepted";
    // A round that ended without a planned retry closes the shot — unless it
    // was LOST (failed round, or an accepted image whose delivery died),
    // which may use what is left of the rounds.
    if (last && last.status === "succeeded" && !accepted && !prevRetry) return settle(ctx, n, false, reasonOf(last));
    if (used >= maxRounds) return settle(ctx, n, false, last?.status === "failed" ? "unavailable" : reasonOf(last));
    // Stopped (account, tool, credits, QC down, a changed photo): no new
    // round at all — the retry included.
    if (ctx.stopNew) return settle(ctx, n, false, ctx.stopNew);
    if (ctx.gateUnknown) return "yield";
    if (left(ctx) < roundStartMs(ctx)) return "yield";

    const correction = prevRetry?.mode === "amended" && typeof prevRetry.correction === "string" ? prevRetry.correction : null;
    let candidates: number = used === 0 ? shot.candidates : ctx.config.retry.candidates;
    // Paid image requests for this shot, every round and re-issue counted.
    const allowance = ctx.config.limits.max_paid_images_per_shot - paidImages(ctx, shot);
    candidates = Math.min(candidates, Math.max(0, allowance));
    if (candidates === 0) return settle(ctx, n, false, used === 0 ? "unavailable" : reasonOf(last));
    const est = generationEstimate(ctx.input.unit_price_usd_micros, ctx.config.budget);
    const spent = spentSoFar(ctx);
    while (candidates > 0 && !fits(spent + ctx.reserved, ctx.input.budget_cap_usd_micros, candidates * est)) candidates--;
    if (candidates === 0) return settle(ctx, n, false, used === 0 ? "budget" : reasonOf(last));

    // Reserved at once (before anything is awaited), so a concurrent shot
    // checks the budget and the balance against this one too. The budget is
    // released once the round's real cost is recorded, the balance place once
    // the shot is charged (its credits have then left the balance) — and both
    // on every way out, with whatever the re-issues reserved.
    const calls: CallBudget = { left: Math.max(0, allowance - candidates), est, reserved: 0 };
    let held = candidates * est;
    ctx.reserved += held;
    const releaseBudget = () => {
      ctx.reserved = Math.max(0, ctx.reserved - held - calls.reserved);
      held = 0;
      calls.reserved = 0;
    };
    const place = ++ctx.shotSeq;
    ctx.inFlight.add(place);
    const charged = () => { ctx.inFlight.delete(place); };
    try {
      if (!ctx.test) {
        const bal = await freshBalance(ctx.supabase, ctx.workspaceId);
        if (bal === null) return "busy";
        // Not even this shot: it ends here (every other shot checks its own).
        if (bal < ctx.input.quote.unit) return settle(ctx, n, false, "insufficient_credits");
        // Enough for this shot alone, not with the uncharged shots begun
        // before it: whether they are delivered decides — the next call
        // checks again (the first of them always proceeds).
        const ahead = [...ctx.inFlight].filter((p) => p < place).length;
        if (bal < ctx.input.quote.unit * (ahead + 1)) return "yield";
      }
      const refs = await photos(ctx, shot.references);
      if (refs === "changed") { ctx.stopNew = "reference_changed"; return settle(ctx, n, false, "reference_changed"); }
      if (refs === "unreadable") return "busy";
      const prompt = compileShot(ctx, shot, card, correction);
      if (!prompt.ok) return settle(ctx, n, false, "prompt_unconfigured");

      const release = await acquireImages(candidates);
      let releasedEarly = false;
      const free = () => { if (!releasedEarly) { releasedEarly = true; release(); } };
      try {
        if (left(ctx) < roundStartMs(ctx)) return "yield";
        const item = itemOf(n, used);
        const b = await begin(ctx, P.round, item, "round", "image_generation");
        if (b.state === "busy") return "busy";
        if (b.state === "not_owner") return "lost";
        if (b.state !== "run") continue;
        if (b.attempts > 0) {
          await finish(ctx, P.round, item, { status: "failed", attempts: b.attempts + 1, cost: { basis: "unknown" }, errorCode: "round_lost", durationMs: 0 });
          continue;
        }
        await setProgress(ctx, { stage: "images" });
        const round = await executeRound(ctx, card, shot, { prompt: prompt.text, refs, candidates, round: used, correction, item, attempts: b.attempts, free, calls });
        if (round === "lost") return "lost";
        // The round's real cost is in its row now.
        releaseBudget();
        if (round.accepted) {
          await setProgress(ctx, { stage: "results" });
          // The accepted image is in memory: its delivery is tried again
          // once before anything new is paid for.
          for (let attempt = 0; attempt < 2; attempt++) {
            const slot = rowsOf(ctx, P.charge, n).length;
            if (slot > 4 || (attempt > 0 && ctx.hardEndAt - ctx.deps.now() < DELIVER_RESERVE_MS)) break;
            const d = await deliver(ctx, shot, mirror, round.accepted, used, slot, charged);
            if (d === "lost" || d === "busy") return d;
            if (d === "delivered" || settled(ctx, n)) return "settled";
          }
          // Released twice: what is left of the rounds may still help.
        }
      } finally {
        free();
      }
    } finally {
      releaseBudget();
      charged();
    }
  }
  return "busy";
}

type Candidate = {
  image: { bytes: Buffer; mime: string; width: number | null; height: number | null; sha256: string } | null;
  error: string | null; reissued: boolean; calls: number; costMicros: number; unknown: number; ms: number;
};

/** Re-issues a round may still make (the shot's cap), their budget, and
 *  what they reserved (released with the round's own reservation). */
type CallBudget = { left: number; est: number; reserved: number };
type Accepted = { bytes: Buffer; mime: string; width: number | null; height: number | null; sha256: string; decision: QcDecision; costMicros: number };

/** `limitAt`: when the round's image calls must be over (its QC and the
 *  delivery still fit after it); each call has at most IMAGE_CALL_MS. */
async function genCandidate(ctx: Ctx, prompt: string, refs: Awaited<ReturnType<typeof forImageModel>>[], limitAt: number, budget: CallBudget): Promise<Candidate> {
  let reissued = false;
  let costMicros = 0;
  let unknown = 0;
  let calls = 0;
  const t0 = ctx.deps.now();
  for (let attempt = 0; attempt <= ctx.config.retry.transport_reissues; attempt++) {
    if (attempt > 0) {
      // A re-issue (same prompt) only when a whole call still fits before the
      // round's limit, the shot's paid-image cap allows one more, and so
      // does the budget.
      if (limitAt - ctx.deps.now() < IMAGE_CALL_MS || budget.left <= 0) break;
      if (!fits(spentSoFar(ctx) + ctx.reserved, ctx.input.budget_cap_usd_micros, budget.est)) break;
      budget.left--;
      ctx.reserved += budget.est;
      budget.reserved += budget.est;
      reissued = true;
    }
    calls++;
    const r = await ctx.deps.callImage(ctx.supabase, {
      candidateModelIds: [ctx.input.model.id], prompt, references: refs,
      aspectRatio: ctx.input.aspect_ratio as AspectRatio, resolution: ctx.input.resolution as Resolution,
      maxAttempts: 1, deadlineAt: Math.min(limitAt, ctx.deps.now() + IMAGE_CALL_MS), unitPrices: ctx.unitPrices, tokenPrices: ctx.tokenPrices,
    });
    for (const a of r.attempts) { if (a.cost.basis === "unknown") unknown++; else costMicros += a.cost.usdMicros; }
    await recordProviderCalls(ctx.supabase, r.attempts.map((a) => ({
      actorKind: ctx.test ? "admin" as const : "customer" as const, consumer: consumer(ctx),
      userId: ctx.userId, workspaceId: ctx.workspaceId, toolKey: "prompts", runRef: ctx.runId,
      providerSlug: a.providerSlug, model: a.model, status: a.ok ? "succeeded" as const : "failed" as const,
      errorCode: a.ok ? null : (a.errorCode ?? "provider_error"), inputTokens: a.inputTokens ?? null,
      outputTokens: a.outputTokens ?? null, thoughtTokens: a.thoughtTokens ?? null,
      units: a.ok ? 1 : 0, unitKind: "image" as const, resolution: a.resolution ?? null, cost: a.cost, baseCost: a.baseCost ?? null, durationMs: a.ms,
    })));
    if (r.ok && r.image.base64) {
      const bytes = Buffer.from(r.image.base64, "base64");
      const dims = await dimensionsOf(bytes);
      return {
        image: { bytes, mime: r.image.mime || "image/png", width: dims.width, height: dims.height, sha256: sha256(bytes) },
        error: null, reissued, calls, costMicros, unknown, ms: ctx.deps.now() - t0,
      };
    }
    if (r.ok) return { image: null, error: "provider_empty_result", reissued, calls, costMicros, unknown, ms: ctx.deps.now() - t0 };
    // Out of time is not a provider failure worth a second request now.
    if (r.retryLater) return { image: null, error: r.error, reissued, calls, costMicros, unknown, ms: ctx.deps.now() - t0 };
  }
  return { image: null, error: "provider_error", reissued, calls, costMicros, unknown, ms: ctx.deps.now() - t0 };
}

async function executeRound(ctx: Ctx, card: ProductCard, shot: Shot, r: {
  prompt: string; refs: OrderPhoto[]; candidates: number; round: number; correction: string | null; item: number; attempts: number; free: () => void;
  calls: CallBudget;
}): Promise<{ accepted: Accepted | null } | "lost"> {
  const t0 = ctx.deps.now();
  const refsForModel = await Promise.all(r.refs.map(forImageModel));
  const qcTimeout = ctx.config.qc.timeout_ms;
  const imageLimit = ctx.hardEndAt - DELIVER_RESERVE_MS - qcTimeout;
  const cands = await Promise.all(Array.from({ length: r.candidates }, () => genCandidate(ctx, r.prompt, refsForModel, imageLimit, r.calls)));
  r.free();

  // ── Etap 4 — every candidate with an image is checked ──
  await setProgress(ctx, { stage: "qc" });
  const refVision = await Promise.all(r.refs.map((p) => forVision(p.bytes)));
  const colorRef = card.color_sample && r.refs.some((p) => p.number === card.color_sample!.photo)
    ? await pixelsOf(r.refs.find((p) => p.number === card.color_sample!.photo)!.bytes) : null;
  const pastel = card.colors.some((c) => c.pastel);
  const qcValues = {
    reference_map: referenceMap(card, shot.references, ctx.config.labels), product_card: cardForPrompt(card),
    shot_spec: shotSpec(shot, card), is_hero: shot.whole ? "tak" : "nie", qc_rules: qcRules(ctx.config),
  };
  const schema = qcSchema(ctx.config.qc.categories.map((c) => c.id));
  let qcCost = 0;
  let qcUnknown = 0;
  const qcTraces: Json[] = [];
  const decisions = await Promise.all(cands.map(async (c, i): Promise<{ d: QcDecision | null; unchecked: boolean; color: Json }> => {
    if (!c.image) return { d: null, unchecked: false, color: null };
    const candVision = await forVision(c.image.bytes, c.image.mime);
    for (let ask = 0; ask <= ctx.config.qc.reask; ask++) {
      const room = ctx.hardEndAt - DELIVER_RESERVE_MS - ctx.deps.now();
      if (room < 20_000) break;
      const res = await ctx.deps.callStage<RawQc>(ctx.supabase, {
        key: "grovshot_v2_qc", body: ctx.bodies.grovshot_v2_qc, values: qcValues,
        images: [...refVision, candVision], schema, timeoutMs: Math.min(qcTimeout, room - 5_000),
        deadlineAt: ctx.hardEndAt - DELIVER_RESERVE_MS, backends: await backends(ctx), models: ctx.config.models,
        tokenPrices: ctx.tokenPrices, now: ctx.deps.now,
      }, { consumer: consumer(ctx), actorKind: ctx.test ? "admin" : "customer", userId: ctx.userId, workspaceId: ctx.workspaceId, runRef: ctx.runId });
      if (res.cost.basis !== "unknown") qcCost += res.cost.usdMicros;
      qcUnknown += res.unknownCalls;
      qcTraces.push({ candidate: i, ok: res.ok, ...(res.ok ? {} : { error: res.error }), trace: (res.trace ?? null) as unknown as Json });
      if (!res.ok) continue;
      // The colour check, in code — conclusive only, never on a guess.
      let colorFinding: QcFinding[] = [];
      let color: Json = null;
      if (ctx.config.qc.color.enabled && colorRef && card.color_sample) {
        const candPx = await pixelsOf(c.image.bytes);
        const box = res.data.product_box;
        const check = candPx ? compareColors(
          { px: colorRef, box: card.color_sample },
          { px: candPx, box: box && box.w && box.h ? { x: box.x ?? 0, y: box.y ?? 0, w: box.w, h: box.h } : null },
          ctx.config.qc.color, pastel,
        ) : { conclusive: false as const, reason: "sample_failed" as const };
        color = check.conclusive ? { conclusive: true, shift: check.shift, hue: check.hueDiff, chroma: check.chromaRatio } : { conclusive: false, reason: check.reason };
        const cat = ctx.config.qc.categories.find((x) => x.id === "color_shift");
        if (check.conclusive && check.shift && cat) {
          colorFinding = [{ category: "color_shift", level: cat.level, kind: "systematic", confidence: 0.9, detail: `hue ${check.hueDiff}°, chroma ×${check.chromaRatio}`, source: "code" }];
        }
      }
      return { d: decideQc(res.data, { config: ctx.config, isHero: shot.whole, codeFindings: colorFinding }), unchecked: false, color };
    }
    return { d: null, unchecked: true, color: null };
  }));

  const judged = decisions.map((x) => x.d);
  const best = pickBest(judged);
  const anyJudged = decisions.some((x) => x.d !== null);
  const anyUnchecked = decisions.some((x) => x.unchecked);
  // QC that could not run: never a reason to spend the image retry.
  if (anyJudged) ctx.qcFailStreak = 0;
  else if (anyUnchecked) {
    ctx.qcFailStreak++;
    if (ctx.qcFailStreak >= 2) ctx.stopNew = "qc_unavailable";
    await setProgress(ctx, { qc_fail_streak: ctx.qcFailStreak });
  }
  const forRetry = decisions.filter((x) => !x.unchecked).map((x) => x.d);
  const retry = best !== null || (!anyJudged && anyUnchecked) ? { retry: false as const } : planRetry(forRetry, ctx.config, r.round);
  const decision = best !== null ? "accepted" : anyJudged ? "rejected" : anyUnchecked ? "unchecked" : "no_image";

  const imageCost = cands.reduce((s, c) => s + c.costMicros, 0);
  const unknownCalls = cands.reduce((s, c) => s + c.unknown, 0) + qcUnknown;
  const out: Record<string, Json> = {
    decision,
    chosen: best,
    round: r.round,
    candidates: cands.map((c, i) => ({
      index: i, ok: Boolean(c.image), error: c.error, reissued: c.reissued, calls: c.calls, ms: c.ms,
      sha256: c.image?.sha256 ?? null, width: c.image?.width ?? null, height: c.image?.height ?? null, cost_usd_micros: c.costMicros,
      verdict: decisions[i].d?.verdict ?? (decisions[i].unchecked ? "unchecked" : null),
      rejecting: (decisions[i].d?.rejecting ?? []).map((f) => ({ category: f.category, confidence: f.confidence, kind: f.kind, source: f.source })),
      warnings: (decisions[i].d?.warnings ?? []).map((f) => ({ category: f.category, confidence: f.confidence })),
      tolerated: (decisions[i].d?.tolerated ?? []).map((f) => f.category),
      unknown_categories: decisions[i].d?.unknown ?? [],
      color: decisions[i].color,
    })) as Json,
    qc: qcTraces,
    retry: retry.retry ? { mode: retry.mode, correction: retry.correction } : null,
    prompt: { sha256: sha256(r.prompt), amended: Boolean(r.correction), correction: r.correction, version: ctx.versions.grovshot_v2_shot },
    references: shot.references,
    cost_usd_micros: imageCost + qcCost,
    unknown_calls: unknownCalls,
  };
  const ok = await finish(ctx, P.round, r.item, {
    status: "succeeded", attempts: r.attempts + 1, providerSlug: ctx.input.model.provider, model: ctx.input.model.identifier,
    units: cands.filter((c) => c.image).length, unitKind: "image",
    cost: { basis: "estimated", usdMicros: imageCost + qcCost }, output: out, durationMs: ctx.deps.now() - t0,
  });
  if (!ok) return "lost";
  if (best === null) return { accepted: null };
  const c = cands[best].image!;
  return { accepted: { ...c, decision: judged[best]!, costMicros: imageCost + qcCost } };
}

/* ══ D · delivery (the only place a shot is charged) ══════════════════════*/

type DeliverOutcome = "delivered" | "released" | "busy" | "lost";

/** One charge per delivery attempt of a shot (slot 0..4): a released
 *  attempt never blocks the next one on the same idempotency key. */
const chargeKey = (ctx: Ctx, n: number, slot: number) => `gsv2:${ctx.runId}:s${n}:d${slot}`;

/** startUsage refusals that are final for this order (nothing charged). */
const CHARGE_FINAL = new Set(["insufficient_credits", "service_unavailable", "maintenance"]);

function matchScore(d: QcDecision): number {
  const worst = Math.max(0, ...d.warnings.map((w) => w.confidence));
  return Math.round((1 - worst) * 10000) / 100;
}

async function deliver(ctx: Ctx, shot: Shot, mirror: Mirror, acc: Accepted, round: number, slot: number, charged: () => void): Promise<DeliverOutcome> {
  const n = shot.index;
  const item = itemOf(n, slot);
  const ext = acc.mime === "image/jpeg" ? "jpg" : acc.mime === "image/webp" ? "webp" : "png";
  if (ctx.test) {
    // An admin test: no ledger, no library — the image lands in the test folder.
    const path = await storeNew(ctx.supabase, `${ctx.workspaceId}/gsv2-test/${ctx.runId}`, ext, acc.bytes, acc.mime);
    if (!path) return (await settle(ctx, n, false, "storage_failed")) === "lost" ? "lost" : "released";
    const s = await settle(ctx, n, true, "", { path, test: true, verdict: acc.decision.verdict });
    return s === "lost" ? "lost" : s === "busy" ? "busy" : "delivered";
  }

  const t0 = ctx.deps.now();
  // An unreadable wallet is not a charge failure: nothing is begun.
  const wallet = await walletId(ctx.supabase, ctx.workspaceId);
  if (!wallet) return "busy";
  const b = await begin(ctx, P.charge, item, "charge", "tool");
  if (b.state === "not_owner") return "lost";
  if (b.state !== "run" || b.attempts > 0) return "busy";
  const conceptId = mirror.concepts[n] ?? null;
  const refPaths = shot.references.map((x) => ctx.input.photos[x - 1]);
  const { data: job, error: jobErr } = await ctx.supabase.from("generation_jobs").insert({
    workspace_id: ctx.workspaceId, user_id: ctx.userId, model_id: ctx.input.model.id, provider_slug: ctx.input.model.provider,
    prompt_text: null, aspect_ratio: ctx.input.aspect_ratio, quantity: 1, resolution: ctx.input.resolution,
    prompt_id: conceptId, prompt_session_id: mirror.sessionId, prompt_origin: "ecomstudio",
    status: "processing", started_at: new Date(t0).toISOString(), reference_image_ids: [],
    settings: {
      engine: "grovshot_v2", run_id: ctx.runId, shot: n + 1, shot_item: item, concept_id: conceptId,
      resolution: ctx.input.resolution, reference_paths: refPaths,
    } as Json,
  }).select("id").single();
  if (jobErr || !job) {
    await finish(ctx, P.charge, item, { status: "failed", attempts: 1, cost: { basis: "estimated", usdMicros: 0 }, errorCode: "job_create_failed", durationMs: 0 });
    return "released";
  }
  const usage = await startUsage(ctx.supabase, {
    serverToken: dispatchToken(), userId: ctx.userId, workspaceId: ctx.workspaceId, walletId: wallet,
    serviceSlug: "image_generation", providerSlug: ctx.input.model.provider, modelSlug: ctx.input.model.identifier,
    generationJobId: job.id, idempotencyKey: chargeKey(ctx, n, slot),
    metadata: { operation: "grovshot_v2", quantity: 1, run_id: ctx.runId, session_id: mirror.sessionId, shot: n + 1, round, slot },
    creditsCharged: ctx.input.quote.unit,
  });
  if (!usage.ok) {
    if (!CHARGE_FINAL.has(usage.error)) {
      // Unknown outcome (the event may exist): the charge row stays open and
      // recovery settles it from the ledger — never a second charge now.
      return "busy";
    }
    await jobFailed(ctx.supabase, job.id, usage.error);
    await finish(ctx, P.charge, item, { status: "failed", attempts: 1, cost: { basis: "estimated", usdMicros: 0 }, errorCode: `charge:${usage.error}`.slice(0, 80), durationMs: 0 });
    ctx.stopNew = usage.error === "insufficient_credits" ? "insufficient_credits" : "unavailable";
    const s = await settle(ctx, n, false, usage.error === "insufficient_credits" ? "insufficient_credits" : "unavailable");
    return s === "lost" ? "lost" : s === "busy" ? "busy" : "released";
  }
  // The credits have left the balance: no longer counted as still to charge.
  charged();
  await finish(ctx, P.charge, item, {
    status: "succeeded", attempts: 1, cost: { basis: "estimated", usdMicros: 0 },
    output: { job_id: job.id, event_id: usage.eventId, credits: ctx.input.quote.unit, round, slot }, durationMs: 0,
  });

  const d = await begin(ctx, P.deliver, item, "deliver", "tool");
  if (d.state === "not_owner") {
    await failUsage(ctx.supabase, { serverToken: dispatchToken(), eventId: usage.eventId, walletId: wallet, error: "deliver_lost" });
    return "lost";
  }
  const release = async (code: string): Promise<DeliverOutcome> => {
    // Nothing refunded stays readable: library rows first, then files; if
    // either cannot be confirmed, nothing is refunded yet (next call does it).
    if (!(await removeLibraryRows(ctx.supabase, job.id))) return "busy";
    if (!(await removeFolder(ctx.supabase, `${ctx.workspaceId}/${job.id}`))) return "busy";
    await failUsage(ctx.supabase, { serverToken: dispatchToken(), eventId: usage.eventId, walletId: wallet, error: code, apiCostUsdMicros: shotCost(ctx, n) });
    await jobFailed(ctx.supabase, job.id, code);
    if (d.state === "run") await finish(ctx, P.deliver, item, { status: "failed", attempts: d.attempts + 1, cost: { basis: "estimated", usdMicros: 0 }, errorCode: code, durationMs: ctx.deps.now() - t0 });
    return "released";
  };
  if (d.state !== "run") return release("deliver_failed");

  const completed = await markJobCompleted(ctx.supabase, job.id, ctx.input.quote.unit, {
    latency_ms: ctx.deps.now() - Date.parse(ctx.run.created_at),
  }, {
    provider_output: [{
      provider_returned_width: acc.width, provider_returned_height: acc.height, provider_mime: acc.mime,
      provider_bytes: acc.bytes.length, provider_sha256: acc.sha256, transformed_after_provider: false,
    }] as unknown as Json,
  });
  if (!completed) return release("library_failed");
  const path = await storeNew(ctx.supabase, `${ctx.workspaceId}/${job.id}`, ext, acc.bytes, acc.mime);
  if (!path) return release("storage_failed");
  const { data: gen, error: genErr } = await ctx.supabase.from("generations").insert({
    job_id: job.id, workspace_id: ctx.workspaceId,
    quality_status: acc.decision.verdict === "warning" ? "warning" : "passed",
    product_match_score: matchScore(acc.decision),
  }).select("id").single();
  if (genErr || !gen) return release("library_failed");
  const { data: asset, error: assetErr } = await ctx.supabase.from("generation_assets").insert({
    generation_id: gen.id, asset_type: "image", storage_path: path, width: acc.width, height: acc.height,
    metadata: { tool: "prompts", engine: "grovshot_v2", shot: n + 1 } as Json,
  }).select("id").single();
  if (assetErr || !asset) return release("library_failed");

  // DELIVERED — the server's own mark, before the charge closes: library rows
  // a member can delete never decide a refund.
  const m = await begin(ctx, P.mark, item, "mark", "tool");
  if (m.state === "run") {
    await finish(ctx, P.mark, item, { status: "succeeded", attempts: m.attempts + 1, cost: { basis: "estimated", usdMicros: 0 },
      output: { job_id: job.id, generation_id: gen.id, asset_id: asset.id, path }, durationMs: 0 });
  }
  await completeUsage(ctx.supabase, dispatchToken(), usage.eventId, 1, {
    apiCostUsdMicros: shotCost(ctx, n), executor: { providerSlug: ctx.input.model.provider, modelSlug: ctx.input.model.identifier },
  });
  const status = await eventStatus(ctx.supabase, usage.eventId);
  if (status === "unknown" || status === "pending") return "busy";
  if (status !== "succeeded") {
    // The ledger closed it otherwise (the reconciler refunded a stalled
    // shot): the image is not delivered for free.
    if (!(await removeLibraryRows(ctx.supabase, job.id)) || !(await removeFolder(ctx.supabase, `${ctx.workspaceId}/${job.id}`))) return "busy";
    await jobFailed(ctx.supabase, job.id, "charge_closed");
    await finish(ctx, P.deliver, item, { status: "failed", attempts: d.attempts + 1, cost: { basis: "estimated", usdMicros: 0 }, errorCode: "charge_closed", durationMs: 0 });
    return "released";
  }
  await derivatives(ctx.supabase, asset.id, path, acc.bytes);
  if (conceptId) await ctx.supabase.from("generated_prompts").update({ last_job_id: job.id, generation_count: 1 }).eq("id", conceptId);
  await ctx.supabase.rpc("log_activity", {
    p_workspace_id: ctx.workspaceId, p_action: "generation.completed", p_entity_type: "generation_job", p_entity_id: job.id,
    p_metadata: { tool: "prompts", engine: "grovshot_v2", run_id: ctx.runId, shot: n + 1, round, credits: ctx.input.quote.unit },
  });
  await finish(ctx, P.deliver, item, { status: "succeeded", attempts: d.attempts + 1, cost: { basis: "estimated", usdMicros: 0 },
    output: { job_id: job.id, generation_id: gen.id, path }, durationMs: ctx.deps.now() - t0 });
  const s = await settle(ctx, n, true, "", { job_id: job.id, generation_id: gen.id, verdict: acc.decision.verdict, round });
  if (s !== "lost") await patchCredits(ctx);
  return s === "lost" ? "lost" : s === "busy" ? "busy" : "delivered";
}

/** Provider cost of every round of a shot (what this image really cost). */
function shotCost(ctx: Ctx, n: number): number {
  return rowsOf(ctx, P.round, n).reduce((sum, r) => sum + (Number(outputOf(r).cost_usd_micros) || (r.cost_basis !== "unknown" ? r.cost_usd_micros ?? 0 : 0)), 0);
}

/** The run row's credits follow each delivered shot (not only the close). */
async function patchCredits(ctx: Ctx) {
  if (ctx.test) return;
  await ctx.writer;
  const delivered = ctx.steps.filter((s) => s.position === P.settle && s.status === "succeeded").length;
  await patchRun(ctx.supabase, ctx.runId, ctx.owner, { credits: delivered * ctx.input.quote.unit });
}

/**
 * A charge an earlier invocation began and did not settle. The image was
 * only in memory, so: delivered already (the server's mark, or a library
 * file) → closed as delivered; otherwise everything of that job is removed
 * and the charge refunded — never a second request for the same round.
 */
async function recoverDelivery(ctx: Ctx, n: number, charge: StepRunRow): Promise<DeliverOutcome> {
  const item = charge.item_index;
  const slot = item - n * 5;
  const out = outputOf(charge);
  let jobId = typeof out.job_id === "string" ? out.job_id : null;
  let eventId = typeof out.event_id === "string" ? out.event_id : null;
  if (!jobId || !eventId) {
    const ev = await eventByKey(ctx.supabase, chargeKey(ctx, n, slot));
    if (ev === "unknown") return "busy";
    jobId = jobId ?? ev?.jobId ?? null;
    eventId = eventId ?? ev?.id ?? null;
    if (!jobId) {
      // A job written before the charge: found by its run and item, failed.
      const { data: orphans } = await ctx.supabase.from("generation_jobs").select("id")
        .eq("workspace_id", ctx.workspaceId).eq("settings->>run_id", ctx.runId).eq("settings->>shot_item", String(item))
        .in("status", ["queued", "processing"]).limit(3);
      for (const o of orphans ?? []) await jobFailed(ctx.supabase, o.id, "charge_interrupted");
    }
  }
  const markRow = stepOf(ctx, P.mark, item);
  const asset = jobId ? await jobAsset(ctx.supabase, ctx.workspaceId, jobId) : null;
  if (asset === "unknown") return "busy";
  const wallet = await walletId(ctx.supabase, ctx.workspaceId);
  if (!wallet) return "busy";
  const status = eventId ? await eventStatus(ctx.supabase, eventId) : null;
  if (status === "unknown") return "busy";
  const closeRow = async (pos: number, ok: boolean, code: string) => {
    const r = stepOf(ctx, pos, item);
    if (r && r.status !== "succeeded" && r.status !== "failed") {
      await finish(ctx, pos, item, ok
        ? { status: "succeeded", attempts: r.attempts + 1, cost: { basis: "estimated", usdMicros: 0 }, output: { job_id: jobId, recovered: true }, durationMs: 0 }
        : { status: "failed", attempts: r.attempts + 1, cost: { basis: "estimated", usdMicros: 0 }, errorCode: code, durationMs: 0 });
    }
  };
  if (jobId && (markRow?.status === "succeeded" || asset) && status !== "refunded" && status !== "failed") {
    if (!(await markJobCompleted(ctx.supabase, jobId, ctx.input.quote.unit))) return "busy";
    if (eventId && status === "pending") {
      await completeUsage(ctx.supabase, dispatchToken(), eventId, 1, {
        apiCostUsdMicros: shotCost(ctx, n) || undefined,
        executor: { providerSlug: ctx.input.model.provider, modelSlug: ctx.input.model.identifier },
      });
      const after = await eventStatus(ctx.supabase, eventId);
      if (after !== "succeeded") return "busy";
    }
    await closeRow(P.charge, true, "");
    await closeRow(P.deliver, true, "");
    const s = await settle(ctx, n, true, "", { job_id: jobId, generation_id: asset ? asset.generationId : null, recovered: true });
    if (s !== "lost") await patchCredits(ctx);
    return s === "lost" ? "lost" : s === "busy" ? "busy" : "delivered";
  }
  if (jobId) {
    if (!(await removeLibraryRows(ctx.supabase, jobId))) return "busy";
    if (!(await removeFolder(ctx.supabase, `${ctx.workspaceId}/${jobId}`))) return "busy";
  }
  if (eventId && status === "pending") {
    await failUsage(ctx.supabase, { serverToken: dispatchToken(), eventId, walletId: wallet, error: "deliver_interrupted" });
  }
  if (jobId) await jobFailed(ctx.supabase, jobId, "deliver_interrupted");
  await closeRow(P.charge, false, "deliver_interrupted");
  await closeRow(P.deliver, false, "deliver_interrupted");
  // A deliver row that never began still marks this charge as handled.
  if (!stepOf(ctx, P.deliver, item)) {
    const d = await begin(ctx, P.deliver, item, "deliver", "tool");
    if (d.state === "run") await finish(ctx, P.deliver, item, { status: "failed", attempts: d.attempts + 1, cost: { basis: "estimated", usdMicros: 0 }, errorCode: "deliver_interrupted", durationMs: 0 });
  }
  return "released";
}

/* ══ closing ══════════════════════════════════════════════════════════════*/

async function closeEarly(base: { supabase: Client; runId: string; owner: string; run: RunRow }, status: "failed" | "blocked", error: string) {
  await patchRun(base.supabase, base.runId, base.owner, {
    status, error, credits: 0, progress: { stage: "failed" },
    duration_ms: Math.max(0, Date.now() - Date.parse(base.run.created_at)),
  });
}

async function close(ctx: Ctx, status: "failed" | "blocked" | "ok" | "partial", error: string | null, extra: Record<string, Json> = {}) {
  await setProgress(ctx, { stage: status === "ok" || status === "partial" ? "done" : status === "blocked" ? "attention" : "failed" });
  await ctx.writer;
  await patchRun(ctx.supabase, ctx.runId, ctx.owner, {
    status, error: error ?? "", progress: ctx.progress,
    duration_ms: Math.max(0, ctx.deps.now() - Date.parse(ctx.run.created_at)),
    ...extra,
  });
}

async function closeRun(ctx: Ctx, shots: Shot[]): Promise<Drive> {
  const delivered = shots.map((s) => stepOf(ctx, P.settle, s.index)).filter((s) => s?.status === "succeeded");
  const credits = ctx.test ? 0 : delivered.length * ctx.input.quote.unit;
  const known = ctx.steps.reduce((sum, s) => sum + (s.cost_basis !== "unknown" && s.cost_usd_micros !== null ? s.cost_usd_micros : 0), 0);
  const unknown = ctx.steps.reduce((sum, s) => sum + (Number(outputOf(s).unknown_calls) || 0) + (s.cost_basis === "unknown" && s.position <= P.round ? 1 : 0), 0);
  const status = delivered.length === 0 ? "failed" : delivered.length === ctx.input.shots ? "ok" : "partial";
  const outputs = delivered.map((s) => ({ job_id: String(outputOf(s).job_id ?? ""), path: String(outputOf(s).path ?? ""), step: P.settle, item: s!.item_index }));
  await close(ctx, status, status === "failed" ? "not_delivered" : null, {
    credits, api_cost_usd_micros: known, cost_unknown: unknown, model_label: ctx.input.model.identifier,
    outputs: outputs as unknown as Json,
  });
  if (!ctx.test && delivered.length > 0) {
    const first = outputOf(delivered[0]);
    await notifyGenerationDone(ctx.supabase, {
      userId: ctx.userId, tool: "prompts", jobId: String(first.job_id), count: delivered.length,
      generationId: typeof first.generation_id === "string" ? first.generation_id : null,
    });
  }
  await ctx.supabase.rpc("log_activity", {
    p_workspace_id: ctx.workspaceId, p_action: "grovshot_v2.completed", p_entity_type: "ai_engine_run", p_entity_id: ctx.runId,
    p_metadata: { delivered: delivered.length, planned: shots.length, ordered: ctx.input.shots, test: ctx.test, credits },
  });
  return "finished";
}
