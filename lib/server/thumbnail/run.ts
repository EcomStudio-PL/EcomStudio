import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Json } from "@/lib/database.types";
import type { Client } from "@/lib/services/workspace";
import { dispatchToken } from "@/lib/server/server-token";
import { startUsage, completeUsage, failUsage } from "@/lib/services/usage";
import { recordProviderCalls } from "@/lib/server/ai-usage";
import { withProviderLimit } from "@/lib/server/provider-router";
import { prepareReferenceImage } from "@/lib/server/reference-image";
import { runRetouch, type RetouchInput, type RetouchResult } from "@/lib/server/retouch";
import {
  beginStep, claimRun, finishStep, patchRun, readRun, readStepRuns,
  type RunRow, type StepRunRow,
} from "@/lib/server/engine/workflow-store";
import { PREVIEW_EDGE, PREVIEW_QUALITY, THUMB_EDGE, THUMB_QUALITY, previewPathFor, thumbPathFor } from "@/lib/thumbs";
import { EDIT_MIMES, editFilename, sha256, type EditMime } from "@/lib/ai/providers/openai-thumbnail-request";
import { callSunburst, type SunburstCallInput, type SunburstOutcome } from "@/lib/server/thumbnail/sunburst";
import { finishThumbnail, FinishError, type FinishResult } from "@/lib/server/thumbnail/finish";
import { openaiCredential, readPublishedPrompt, readThumbnailConfig, readThumbnailState } from "@/lib/server/thumbnail/settings";
import { sunburstCost, type SunburstCost } from "@/lib/thumbnail/cost";
import {
  OPENAI_EDIT_MAX_IMAGE_BYTES, OPENAI_EDIT_MAX_IMAGES, STEP, THUMBNAIL_OPERATION, THUMBNAIL_SERVICE, THUMBNAIL_TOOL_KEY,
  quoteTotal, sizeEdge,
  type FinishConfig, type ThumbnailModel, type ThumbnailQuality, type ThumbnailQuote, type ThumbnailSize,
  type TokenPrices,
} from "@/lib/thumbnail/config";

/**
 * MINIATURKA — ONE DURABLE RUN, DRIVEN ONE INVOCATION AT A TIME.
 *
 * A run is an `ai_engine_runs` row (run_kind 'thumbnail') and its steps are
 * `ai_engine_step_runs` rows, so every paid step is recorded the moment it
 * succeeds and is never executed (or paid for) twice:
 *
 *   position 1, item i   Retusz AI of photo i — only when the customer chose
 *                        it. `runRetouch`, unchanged: the same request, model,
 *                        price, ledger event and library item as /retusz.
 *   position 2           the composition: ONE request to GPT Image 2.5
 *                        Sunburst with every photo, in order. Its own ledger
 *                        event, opened right before the call and closed in the
 *                        same invocation.
 *   position 3           the local finish (no AI, no charge) and the library.
 *
 * WHO DRIVES IT. The customer's own browser, through POST /api/thumbnail/runs/
 * {id} — in the customer's session, which the ledger requires. Each call
 * claims the run's lease (one driver at a time; a second tab or a double
 * click is told "busy"), does as much as fits in its time budget, and
 * returns. A provider call is only started when the whole of it fits.
 *
 * MONEY RULES.
 *   · Each Retusz pass is a paid step of its own (Retusz's own price). A pass
 *     that succeeded stays charged and stays in the library, whatever happens
 *     later; a pass that failed refunded itself.
 *   · The composition is charged at the price QUOTED when the run started,
 *     only if the balance covers it, and refunded on any failure before the
 *     finished file exists.
 *   · Nothing is ever repeated automatically: a Retusz pass or a composition
 *     whose invocation died mid-call is recovered from what it left behind
 *     (its job row, its stored output) — never sent again. A failed run is
 *     retried only by the customer, as a NEW run that reuses every Retusz
 *     result already paid for.
 */

/** How long one invocation may work (routes declare maxDuration = 300). */
export const INVOCATION_BUDGET_MS = 270_000;
/** A Retusz pass is only started with this much of the invocation left. */
export const RETOUCH_START_MS = 245_000;
/** Bookkeeping around the composition call (downloads, storage, finish). */
const COMPOSE_OVERHEAD_MS = 45_000;
/** The local finish (resume case) needs at most this. */
const FINISH_START_MS = 60_000;
/** Retusz passes running at once — the Retusz panel's own concurrency. */
export const RETOUCH_CONCURRENCY = 2;

export type RunPhotoInput = { photos: string[]; retouch: boolean };

export type StoredInput = {
  v: 1;
  photos: string[];
  retouch: boolean;
  quote: ThumbnailQuote;
  /** Per photo: an earlier run's Retusz result reused for free (or null). */
  reuse: ({ job_id: string; path: string } | null)[];
  config: {
    model: ThumbnailModel; size: ThumbnailSize; quality: ThumbnailQuality; timeout_ms: number;
    finish: FinishConfig; token_prices: TokenPrices;
  };
  /** The prompt approved at start (keyed digest + version) — the composition
   *  refuses to run on any other text. */
  prompt: { version: number | null; digest: string };
  retouch_resolution: string;
};

/** Dependencies a test replaces; production uses the real ones. */
export type ThumbnailDeps = {
  runRetouch: (supabase: Client, userId: string, workspaceId: string, input: RetouchInput) => Promise<RetouchResult>;
  callSunburst: (input: SunburstCallInput) => Promise<SunburstOutcome>;
  finish: (raw: Buffer, cfg: FinishConfig) => Promise<FinishResult>;
  now: () => number;
};

const DEFAULT_DEPS: ThumbnailDeps = { runRetouch, callSunburst, finish: finishThumbnail, now: () => Date.now() };

/** A storage path in the caller's own workspace — the Retusz route's rule. */
export function validPhotoPath(path: unknown, workspaceId: string): path is string {
  return typeof path === "string" && path.length > 0 && path.length <= 300
    && path.startsWith(`${workspaceId}/`) && !path.includes("..") && /^[\w\-./]+$/.test(path);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ══ START ════════════════════════════════════════════════════════════════*/

export type StartBody = {
  photos?: unknown; retouch?: unknown; quotedTotal?: unknown; attempt?: unknown; reuseFrom?: unknown;
};

export type StartResult =
  | { ok: true; runId: string; created: boolean; quote: ThumbnailQuote }
  | { ok: false; error: string; quote?: ThumbnailQuote; missingCredits?: number; blockers?: string[] };

/**
 * Validate, price and record a run. Nothing is charged here: the first paid
 * step runs on the first advance. The total shown to the customer is
 * recomputed from the live prices and must match, or the run is refused
 * (`price_changed`) — the customer always sees the price they will pay.
 */
export async function startThumbnailRun(
  supabase: Client, userId: string, workspaceId: string, body: StartBody,
): Promise<StartResult> {
  const attempt = typeof body.attempt === "string" && UUID.test(body.attempt) ? body.attempt : null;
  const retouch = body.retouch === true;
  const quotedTotal = typeof body.quotedTotal === "number" && Number.isInteger(body.quotedTotal) ? body.quotedTotal : null;
  if (!attempt || quotedTotal === null || !Array.isArray(body.photos)) return { ok: false, error: "invalid_input" };
  const photos = body.photos as unknown[];
  if (photos.length === 0 || !photos.every((p) => validPhotoPath(p, workspaceId))) return { ok: false, error: "invalid_input" };

  const state = await readThumbnailState(supabase);
  if (!state.ready || !state.config || !state.prompt || state.thumbnailCredits === null) {
    return { ok: false, error: "tool_unavailable", blockers: state.blockers };
  }
  const max = Math.min(state.config.maxPhotos, OPENAI_EDIT_MAX_IMAGES);
  if (photos.length > max) return { ok: false, error: "too_many_photos" };
  if (retouch && !state.retouch.available) return { ok: false, error: "retouch_unavailable" };

  const reuseFrom = typeof body.reuseFrom === "string" && UUID.test(body.reuseFrom) ? body.reuseFrom : null;
  const reuse = retouch && reuseFrom
    ? await reusableRetouches(supabase, userId, workspaceId, reuseFrom, photos as string[])
    : (photos as string[]).map(() => null);
  const quote = quoteTotal({
    photos: photos.length, retouch,
    retouchUnit: state.retouch.available ? state.retouch.unit : null,
    thumbnailCredits: state.thumbnailCredits,
    reused: reuse.filter(Boolean).length,
  });
  if (quote.total !== quotedTotal) return { ok: false, error: "price_changed", quote };

  const balance = await freshBalance(supabase, workspaceId);
  if (balance < quote.total) return { ok: false, error: "insufficient_credits", quote, missingCredits: quote.total - balance };

  const input: StoredInput = {
    v: 1,
    photos: photos as string[],
    retouch,
    quote,
    reuse,
    config: {
      model: state.config.model, size: state.config.size, quality: state.config.quality,
      timeout_ms: state.config.timeoutMs, finish: state.config.finish, token_prices: state.config.tokenPrices,
    },
    prompt: { version: state.prompt.version, digest: state.prompt.digest },
    retouch_resolution: state.retouch.available ? state.retouch.resolution : "2K",
  };
  const { data, error } = await supabase.rpc("thumbnail_run_create", {
    p_token: dispatchToken() ?? "",
    p_run: {
      workspace_id: workspaceId,
      user_id: userId,
      idempotency_key: `thumb:${workspaceId}:${attempt}`,
      engine_version: "thumbnail-v1",
      prompt_version: state.prompt.version,
      credits: quote.total,
      input,
    } as unknown as Json,
  });
  const out = (error ? null : data) as { id?: string; created?: boolean; error?: string } | null;
  if (!out) return { ok: false, error: "run_create_failed" };
  if (out.error) return { ok: false, error: out.error };
  if (!out.id) return { ok: false, error: "run_create_failed" };
  return { ok: true, runId: out.id, created: Boolean(out.created), quote };
}

/** The balance as stored now (not the per-request memo the layout uses). */
async function freshBalance(supabase: Client, workspaceId: string): Promise<number> {
  const { data } = await supabase.from("credit_wallets").select("balance").eq("workspace_id", workspaceId).maybeSingle();
  return data?.balance ?? 0;
}

/**
 * RETRY WITHOUT PAYING TWICE: the Retusz results of an earlier run of the
 * same member, matched photo by photo (same index, same stored file). Only a
 * pass that succeeded, whose job completed in this workspace, is reused.
 */
async function reusableRetouches(
  supabase: Client, userId: string, workspaceId: string, runId: string, photos: string[],
): Promise<({ job_id: string; path: string } | null)[]> {
  const none = photos.map(() => null);
  const prev = await readRun(supabase, runId);
  if (!prev || prev.run_kind !== "thumbnail" || prev.user_id !== userId || prev.workspace_id !== workspaceId) return none;
  const prevInput = parseInput(prev.input);
  if (!prevInput) return none;
  const steps = await readStepRuns(supabase, runId);
  const out: ({ job_id: string; path: string } | null)[] = [];
  for (let i = 0; i < photos.length; i++) {
    const s = steps.find((x) => x.position === STEP.retouch && x.item_index === i && x.status === "succeeded");
    const o = outputOf(s);
    out.push(prevInput.photos[i] === photos[i] && typeof o.job_id === "string" && typeof o.path === "string"
      ? { job_id: o.job_id, path: o.path } : null);
  }
  return out;
}

/* ══ DRIVE ════════════════════════════════════════════════════════════════*/

export type AdvanceResult = "finished" | "yield" | "busy" | "not_found";

type Ctx = {
  supabase: Client;
  userId: string;
  workspaceId: string;
  runId: string;
  owner: string;
  deadlineAt: number;
  deps: ThumbnailDeps;
  run: RunRow;
  input: StoredInput;
};

/**
 * Move a run forward inside this invocation. Returns when the run is
 * finished, when the time left cannot hold the next step ("yield" — the
 * browser's next call continues), or when another driver holds it ("busy").
 */
export async function advanceThumbnailRun(
  supabase: Client, userId: string, workspaceId: string, runId: string,
  opts: { deadlineAt: number; deps?: Partial<ThumbnailDeps> },
): Promise<AdvanceResult> {
  const deps: ThumbnailDeps = { ...DEFAULT_DEPS, ...opts.deps };
  const owner = `thumb:${randomUUID()}`;
  const first = await readRun(supabase, runId);
  if (!first || first.run_kind !== "thumbnail" || first.user_id !== userId || first.workspace_id !== workspaceId) return "not_found";
  if (first.status !== "queued" && first.status !== "running") return "finished";
  const leaseSeconds = Math.max(10, Math.ceil((opts.deadlineAt - deps.now()) / 1000) + 30);
  const claim = await claimRun(supabase, runId, owner, leaseSeconds);
  if (!claim.claimed) return claim.reason === "finished" ? "finished" : "busy";

  for (let guard = 0; guard < 60; guard++) {
    const run = await readRun(supabase, runId);
    if (!run || (run.status !== "queued" && run.status !== "running")) return "finished";
    const input = parseInput(run.input);
    const ctx: Ctx = { supabase, userId, workspaceId, runId, owner, deadlineAt: opts.deadlineAt, deps, run, input: input as StoredInput };
    if (!input) { await close(ctx, "failed", "invalid_input"); return "finished"; }
    if (run.error === "cancel_requested") { await close(ctx, "failed", "cancelled"); return "finished"; }

    const steps = await readStepRuns(supabase, runId);
    const next = await step(ctx, steps);
    if (next === "continue") continue;
    if (next === "yield") {
      // Hand the run back quickly so the next call does not wait out a lease.
      await patchRun(supabase, runId, owner, { lease_seconds: 10 });
      return "yield";
    }
    return next;
  }
  await patchRun(supabase, runId, owner, { lease_seconds: 10 });
  return "yield";
}

type StepOutcome = "continue" | "yield" | "busy" | "finished";

async function step(ctx: Ctx, steps: StepRunRow[]): Promise<StepOutcome> {
  const { input } = ctx;
  const left = () => ctx.deadlineAt - ctx.deps.now();

  // ── 1. Retusz, per photo, in order ─────────────────────────────────────
  if (input.retouch) {
    const failed = steps.find((s) => s.position === STEP.retouch && s.status === "failed");
    if (failed) { await close(ctx, "failed", "retouch_failed"); return "finished"; }
    const done = new Set(steps.filter((s) => s.position === STEP.retouch && s.status === "succeeded").map((s) => s.item_index));
    const pending = input.photos.map((_, i) => i).filter((i) => !done.has(i));
    if (pending.length > 0) {
      await progress(ctx, { stage: "retouch", retouch_done: done.size, retouch_total: input.photos.length });
      // Reused results cost nothing and take no time; a paid pass needs
      // a whole Retusz call's worth of the invocation.
      const reusable = pending.filter((i) => input.reuse[i]);
      const batch: number[] = reusable.length > 0 ? reusable.slice(0, 4) : [];
      if (batch.length === 0) {
        if (left() < RETOUCH_START_MS) return "yield";
        // Two at a time, never the same stored file twice at once (the
        // ledger would refuse the second as already running).
        for (const i of pending) {
          if (batch.length >= RETOUCH_CONCURRENCY) break;
          if (batch.some((j) => input.photos[j] === input.photos[i])) continue;
          batch.push(i);
        }
      }
      const results = await Promise.all(batch.map((i) => retouchItem(ctx, i, steps)));
      if (results.includes("lost")) return "finished";
      if (results.includes("failed")) { await close(ctx, "failed", "retouch_failed"); return "finished"; }
      if (results.includes("busy")) return "yield";
      return "continue";
    }
  }

  // ── 2. The composition — one Sunburst request ──────────────────────────
  const compose = steps.find((s) => s.position === STEP.compose && s.item_index === -1);
  if (compose?.status === "failed") { await close(ctx, "failed", compose.error_code ?? "compose_failed"); return "finished"; }
  if (compose?.status !== "succeeded") {
    // "Przygotowanie zdjęć" until the composition is charged and sent (the
    // photos are read and checked first); "Tworzenie kompozycji" from then.
    if (!input.retouch) await progress(ctx, { stage: "prepare" });
    const callMs = Math.min(input.config.timeout_ms, 200_000);
    if (left() < callMs + COMPOSE_OVERHEAD_MS) return "yield";
    const r = await composeStep(ctx, steps);
    if (r !== "ok") return r === "busy" ? "yield" : "finished";
    return "continue";
  }

  // ── 3. The local finish and the library ────────────────────────────────
  if (left() < FINISH_START_MS) return "yield";
  await progress(ctx, { stage: "finish", retouch_done: input.retouch ? input.photos.length : 0, retouch_total: input.retouch ? input.photos.length : 0 });
  const r = await finishStep3(ctx, compose);
  return r === "busy" ? "yield" : "finished";
}

/* ── 1 · RETUSZ ───────────────────────────────────────────────────────────*/

type ItemOutcome = "ok" | "failed" | "busy" | "lost";

async function retouchItem(ctx: Ctx, i: number, steps: StepRunRow[]): Promise<ItemOutcome> {
  const { supabase, runId, owner, input } = ctx;
  const photo = input.photos[i];
  const t0 = ctx.deps.now();
  const b = await beginStep(supabase, runId, owner, STEP.retouch, i, "retouch", "tool", 290);
  if (b.state === "done") return "ok";
  if (b.state === "busy") return "busy";
  if (b.state === "not_owner") return "lost";
  if (b.state === "failed" || b.state === "skipped") return "failed";
  if (b.state !== "run") return "busy";

  const ok = async (output: Record<string, Json>, credits: number) => {
    await finishStep(supabase, runId, owner, STEP.retouch, i, {
      status: "succeeded", attempts: b.attempts + 1, providerSlug: "google", unitKind: "image", units: 1,
      cost: { basis: "unknown" }, output: { ...output, credits }, durationMs: ctx.deps.now() - t0,
    });
    return "ok" as const;
  };
  const fail = async (code: string) => {
    await finishStep(supabase, runId, owner, STEP.retouch, i, {
      status: "failed", attempts: b.attempts + 1, cost: { basis: "unknown" }, errorCode: code, durationMs: ctx.deps.now() - t0,
    });
    return "failed" as const;
  };

  // A RESULT ALREADY PAID FOR in an earlier run of this member.
  const reused = input.reuse[i];
  if (reused) {
    const path = await completedRetouchPath(ctx, reused.job_id);
    if (path && path === reused.path) return ok({ job_id: reused.job_id, path, reused: true }, 0);
    // Gone since (deleted from the library): not silently re-bought.
    return fail("retouch_reuse_missing");
  }

  // RESUMED after the invocation died mid-pass: never send it again. What
  // the earlier call left behind decides.
  if (b.attempts > 0) {
    const claimed = new Set(steps.filter((s) => s.position === STEP.retouch && s.item_index !== i)
      .map((s) => outputOf(s).job_id).filter((v): v is string => typeof v === "string"));
    const prior = await priorRetouchJob(ctx, photo, claimed);
    if (prior?.status === "completed") {
      const path = await completedRetouchPath(ctx, prior.id);
      if (path) return ok({ job_id: prior.id, path, recovered: true }, prior.credits);
      return fail("retouch_interrupted");
    }
    // Still going in an invocation that may yet finish it: wait.
    if (prior?.status === "processing" && ctx.deps.now() - Date.parse(prior.createdAt) < 6 * 60_000) return "busy";
    // A failed pass refunded itself; a stale one is refunded by the ledger's
    // reconciler. Either way it is the customer's call to try again.
    if (prior) return fail(prior.status === "failed" ? "retouch_failed" : "retouch_interrupted");
    // No job row at all: the earlier call never reached the ledger, so
    // nothing was charged — the pass may be made now (once).
  }

  let result: RetouchResult;
  try {
    result = await ctx.deps.runRetouch(supabase, ctx.userId, ctx.workspaceId, {
      sourcePath: photo, resolution: input.retouch_resolution, format: "original", quotedOutputs: 1,
    });
  } catch {
    return fail("retouch_error");
  }
  if (!result.ok) return fail(`retouch:${result.error}`.slice(0, 80));
  if ("pending" in result) return fail("retouch_workflow_on");
  const path = result.path || await completedRetouchPath(ctx, result.jobId);
  if (!path) return fail("retouch_output_missing");
  return ok({ job_id: result.jobId, path }, result.credits);
}

/** The newest Retusz job of this member for this photo since the run began. */
async function priorRetouchJob(ctx: Ctx, photo: string, exclude: Set<string>):
  Promise<{ id: string; status: string; createdAt: string; credits: number } | null> {
  const { data } = await ctx.supabase.from("generation_jobs")
    .select("id, status, created_at, credits_charged")
    .eq("workspace_id", ctx.workspaceId).eq("user_id", ctx.userId)
    .gte("created_at", ctx.run.created_at)
    .contains("settings", { operation: "image_retouch", reference_paths: [photo] })
    .order("created_at", { ascending: true })
    .limit(20);
  const row = (data ?? []).find((j) => !exclude.has(j.id));
  return row ? { id: row.id, status: String(row.status), createdAt: row.created_at, credits: row.credits_charged ?? 0 } : null;
}

/** The stored file of a completed Retusz job in this workspace, or null. */
async function completedRetouchPath(ctx: Ctx, jobId: string): Promise<string | null> {
  const { data: job } = await ctx.supabase.from("generation_jobs")
    .select("id, status, workspace_id, settings").eq("id", jobId).maybeSingle();
  if (!job || job.workspace_id !== ctx.workspaceId || job.status !== "completed") return null;
  const op = (job.settings as { operation?: unknown } | null)?.operation;
  if (op !== "image_retouch") return null;
  const { data: gens } = await ctx.supabase.from("generations")
    .select("generation_assets(storage_path)").eq("job_id", jobId).limit(1);
  const assets = (gens?.[0] as { generation_assets?: { storage_path: string }[] } | undefined)?.generation_assets ?? [];
  const path = assets[0]?.storage_path ?? null;
  return path && path.startsWith(`${ctx.workspaceId}/`) ? path : null;
}

/* ── 2 · COMPOSITION ──────────────────────────────────────────────────────*/

type ComposeOutcome = "ok" | "failed" | "busy";

async function composeStep(ctx: Ctx, steps: StepRunRow[]): Promise<ComposeOutcome> {
  const { supabase, runId, owner, input } = ctx;
  const t0 = ctx.deps.now();
  const lease = Math.max(30, Math.ceil((ctx.deadlineAt - t0) / 1000) + 30);
  const b = await beginStep(supabase, runId, owner, STEP.compose, -1, "compose", "image_edit", lease);
  if (b.state === "done") return "ok";
  if (b.state === "busy") return "busy";
  if (b.state === "not_owner") return "failed";
  if (b.state === "failed" || b.state === "skipped") {
    await close(ctx, "failed", b.error ?? "compose_failed");
    return "failed";
  }
  if (b.state !== "run") return "busy";

  // RESUMED after the invocation died mid-composition: NO automatic second
  // request. If the answer was stored, it is finished from there; if not, the
  // charge is released and the customer decides.
  if (b.attempts > 0) return recoverCompose(ctx, b.attempts);

  const stepFail = async (code: string, extra: Record<string, Json> = {}) => {
    await finishStep(supabase, runId, owner, STEP.compose, -1, {
      status: "failed", attempts: 1, providerSlug: "openai", model: input.config.model,
      cost: { basis: "unknown" }, errorCode: code, output: extra, durationMs: ctx.deps.now() - t0,
    });
    await close(ctx, "failed", code);
    return "failed" as const;
  };

  // Everything that can refuse does so BEFORE anything is charged.
  const config = await readThumbnailConfig(supabase);
  const { prompt } = await readPublishedPrompt(supabase, config);
  if (!prompt || !prompt.approved) return stepFail("prompt_unavailable");
  if (prompt.digest !== input.prompt.digest) return stepFail("prompt_changed");
  const cred = await openaiCredential(supabase);
  if (!cred) return stepFail("provider_unavailable");
  const balance = await freshBalance(supabase, ctx.workspaceId);
  if (balance < input.quote.thumbnailCredits) return stepFail("insufficient_credits");

  // The inputs, in the customer's order: the Retusz result of each photo
  // when Retusz ran, otherwise the photo exactly as uploaded.
  const sources = input.photos.map((photo, i) => {
    if (!input.retouch) return { bucket: "product-images" as const, path: photo };
    const s = steps.find((x) => x.position === STEP.retouch && x.item_index === i && x.status === "succeeded");
    const p = outputOf(s).path;
    return typeof p === "string" ? { bucket: "generation-assets" as const, path: p } : null;
  });
  if (sources.some((s) => s === null)) return stepFail("source_unavailable");
  const images: { bytes: Buffer; mime: EditMime; filename: string; source: string; transform: string; sourceSha: string }[] = [];
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i]!;
    if (!src.path.startsWith(`${ctx.workspaceId}/`)) return stepFail("source_unavailable");
    const { data: blob } = await supabase.storage.from(src.bucket).download(src.path);
    if (!blob) return stepFail("source_unavailable");
    // The stored bytes as-is for PNG/JPEG/WebP — except a photo carrying an
    // EXIF orientation flag, which is turned upright the way the customer saw
    // it in the uploader; anything else (AVIF) becomes a PNG. Both recorded
    // per photo (the platform's rule outside Retusz).
    const prepared = await prepareReferenceImage(Buffer.from(await blob.arrayBuffer()), src.path);
    const mime = prepared.mime as EditMime;
    if (!(EDIT_MIMES as readonly string[]).includes(mime)) return stepFail("source_unsupported");
    const bytes = Buffer.from(prepared.base64, "base64");
    if (bytes.length > OPENAI_EDIT_MAX_IMAGE_BYTES) return stepFail("source_too_large");
    images.push({ bytes, mime, filename: editFilename(i, mime), source: src.path, transform: prepared.transform, sourceSha: prepared.sourceSha256 });
  }

  // The job the result will belong to — created before the charge so the
  // ledger event names it (the reconciler counts its assets).
  const { data: job, error: jobErr } = await supabase.from("generation_jobs").insert({
    workspace_id: ctx.workspaceId, user_id: ctx.userId, model_id: null, provider_slug: "openai",
    prompt_text: null, aspect_ratio: "1:1", quantity: 1, resolution: String(input.config.finish.target),
    status: "processing", started_at: new Date(t0).toISOString(), prompt_origin: "ecomstudio",
    reference_image_ids: [],
    settings: {
      operation: THUMBNAIL_OPERATION,
      reference_paths: input.photos,
      retouch: input.retouch,
      retouched_paths: input.retouch ? sources.map((s) => s!.path) : [],
      run_id: runId,
    } as Json,
  }).select("id").single();
  if (jobErr || !job) return stepFail("job_create_failed");
  await patchRun(supabase, runId, owner, { job_id: job.id });

  const usage = await startUsage(supabase, {
    serverToken: dispatchToken(),
    userId: ctx.userId, workspaceId: ctx.workspaceId, walletId: (await walletId(supabase, ctx.workspaceId)) ?? "",
    serviceSlug: THUMBNAIL_SERVICE, providerSlug: "openai", modelSlug: input.config.model,
    generationJobId: job.id, idempotencyKey: `thumb:${runId}:compose`,
    metadata: {
      operation: THUMBNAIL_OPERATION, quantity: 1, run_id: runId, photos: input.photos.length,
      retouched: input.retouch, quality: input.config.quality, size: input.config.size,
    },
    creditsCharged: input.quote.thumbnailCredits,
  });
  if (!usage.ok) {
    await jobFailed(ctx, job.id, usage.error);
    return stepFail(usage.error === "insufficient_credits" ? "insufficient_credits" : `charge:${usage.error}`.slice(0, 80));
  }
  await progress(ctx, { stage: "compose" });

  // THE ONE CALL.
  const timeoutMs = Math.max(1, Math.min(input.config.timeout_ms, ctx.deadlineAt - ctx.deps.now() - COMPOSE_OVERHEAD_MS));
  const outcome = await withProviderLimit("openai", () => ctx.deps.callSunburst({
    apiKey: cred.apiKey, baseUrl: cred.baseUrl,
    spec: {
      model: input.config.model, prompt: prompt.text, size: input.config.size, quality: input.config.quality,
      images: images.map(({ bytes, mime, filename }) => ({ bytes, mime, filename })),
    },
    expectedImageSha256: images.map((img) => sha256(img.bytes)),
    timeoutMs,
  }));
  const cost = sunburstCost(outcome.ok ? outcome.answer.usage : outcome.usage, input.config.token_prices);
  const costMicros = cost.known ? cost.usdMicros : undefined;
  const inputsRecord = images.map((img, i) => ({
    index: i, source_path: img.source, transform: img.transform, source_sha256: img.sourceSha,
    sent_sha256: sha256(img.bytes), mime: img.mime, bytes: img.bytes.length,
  }));
  const request: Record<string, Json> = {
    provider: "openai", endpoint: "images.edits", model: input.config.model, size: input.config.size,
    quality: input.config.quality, background: "opaque", output_format: "png", n: 1,
    prompt_version: input.prompt.version, prompt_sha256: prompt.sha256, prompt_digest: input.prompt.digest,
    photos: input.photos.length, retouched: input.retouch,
    boundary: (outcome.boundary ?? null) as unknown as Json, inputs: inputsRecord as unknown as Json,
  };

  if (!outcome.ok) {
    await failUsage(supabase, {
      serverToken: dispatchToken(), eventId: usage.eventId, walletId: (await walletId(supabase, ctx.workspaceId)) ?? "",
      error: outcome.error, apiCostUsdMicros: costMicros,
    });
    if (!outcome.notSent) await recordCall(ctx, usage.eventId, job.id, outcome, cost);
    await jobFailed(ctx, job.id, outcome.error, { provider_request: request });
    return stepFail(outcome.error, {
      request, http_status: outcome.httpStatus, provider_code: outcome.providerCode, request_id: outcome.requestId,
      usage: (outcome.usage ?? null) as unknown as Json, cost_usd_micros: costMicros ?? null,
    });
  }

  // The answer is stored BEFORE the step is recorded as done: a crash after
  // this line is recovered from the file, never by asking again.
  const rawPath = `${ctx.workspaceId}/${job.id}/raw.${outcome.mime === "image/png" ? "png" : outcome.mime === "image/webp" ? "webp" : "jpg"}`;
  const { error: upErr } = await supabase.storage.from("generation-assets")
    .upload(rawPath, outcome.image, { contentType: outcome.mime, upsert: true });
  await recordCall(ctx, usage.eventId, job.id, outcome, cost);
  if (upErr) {
    await failUsage(supabase, {
      serverToken: dispatchToken(), eventId: usage.eventId, walletId: (await walletId(supabase, ctx.workspaceId)) ?? "",
      error: "storage_failed", apiCostUsdMicros: costMicros,
    });
    await jobFailed(ctx, job.id, "storage_failed", { provider_request: request });
    return stepFail("storage_failed", { request });
  }

  const meta = await imageMeta(outcome.image);
  await finishStep(supabase, runId, owner, STEP.compose, -1, {
    status: "succeeded", attempts: 1, providerSlug: "openai", model: input.config.model,
    inputTokens: outcome.answer.usage?.inputTokens ?? null, outputTokens: outcome.answer.usage?.outputTokens ?? null,
    units: 1, unitKind: "image",
    cost: cost.known ? { basis: "estimated", usdMicros: cost.usdMicros } : { basis: "unknown" },
    output: {
      raw_path: rawPath, job_id: job.id, usage_event_id: usage.eventId, request_id: outcome.requestId,
      request,
      response: {
        size: outcome.answer.size, quality: outcome.answer.quality, background: outcome.answer.background,
        output_format: outcome.answer.outputFormat, data_count: outcome.answer.dataCount, created: outcome.answer.created,
        mime: outcome.mime, bytes: outcome.image.length, sha256: sha256(outcome.image),
        width: meta.width, height: meta.height, http_status: outcome.httpStatus, duration_ms: outcome.durationMs,
      },
      usage: (outcome.answer.usage ?? null) as unknown as Json,
      cost_usd_micros: costMicros ?? null,
      cost_breakdown: cost.known ? (cost.breakdown as unknown as Json) : null,
      cost_unknown_reason: cost.known ? null : cost.reason,
    },
    durationMs: ctx.deps.now() - t0,
  });
  return "ok";
}

/** A composition whose invocation died: finish from the stored answer, or
 *  release the charge. Never a second request. */
async function recoverCompose(ctx: Ctx, attempts: number): Promise<ComposeOutcome> {
  const { supabase, runId, owner } = ctx;
  const jobId = ctx.run.job_id;
  const fail = async (code: string) => {
    await finishStep(supabase, runId, owner, STEP.compose, -1, {
      status: "failed", attempts: attempts + 1, providerSlug: "openai", model: ctx.input.config.model,
      cost: { basis: "unknown" }, errorCode: code, durationMs: 0,
    });
    await close(ctx, "failed", code);
    return "failed" as const;
  };
  const event = jobId ? await eventOfJob(ctx, jobId) : null;
  if (jobId) {
    for (const ext of ["png", "jpg", "webp"]) {
      const rawPath = `${ctx.workspaceId}/${jobId}/raw.${ext}`;
      const { data } = await supabase.storage.from("generation-assets").download(rawPath);
      if (!data) continue;
      await finishStep(supabase, runId, owner, STEP.compose, -1, {
        status: "succeeded", attempts: attempts + 1, providerSlug: "openai", model: ctx.input.config.model,
        units: 1, unitKind: "image", cost: { basis: "unknown" },
        output: { raw_path: rawPath, job_id: jobId, usage_event_id: event?.id ?? null, recovered: true },
        durationMs: 0,
      });
      return "ok";
    }
  }
  // Nothing stored: whatever was charged for this composition is released now
  // (the reconciler would do the same, later).
  if (event?.status === "pending") {
    await failUsage(supabase, {
      serverToken: dispatchToken(), eventId: event.id, walletId: (await walletId(supabase, ctx.workspaceId)) ?? "",
      error: "compose_interrupted",
    });
  }
  if (jobId) await jobFailed(ctx, jobId, "compose_interrupted");
  return fail("compose_interrupted");
}

/* ── 3 · FINISH + LIBRARY ─────────────────────────────────────────────────*/

async function finishStep3(ctx: Ctx, compose: StepRunRow | undefined): Promise<"ok" | "failed" | "busy"> {
  const { supabase, runId, owner, input } = ctx;
  const t0 = ctx.deps.now();
  const b = await beginStep(supabase, runId, owner, STEP.finish, -1, "finish", "tool", 120);
  if (b.state === "busy") return "busy";
  if (b.state === "not_owner") return "failed";
  const out = outputOf(compose);
  const jobId = typeof out.job_id === "string" ? out.job_id : null;
  const rawPath = typeof out.raw_path === "string" ? out.raw_path : null;
  const eventId = typeof out.usage_event_id === "string" ? out.usage_event_id : jobId ? (await eventOfJob(ctx, jobId))?.id ?? null : null;
  const costMicros = typeof out.cost_usd_micros === "number" ? out.cost_usd_micros : null;
  if (b.state === "done") { await closeOk(ctx, outputOf({ output: b.output }), costMicros); return "ok"; }
  if (b.state === "failed" || b.state === "skipped") { await close(ctx, "failed", b.error ?? "finish_failed"); return "failed"; }
  if (b.state !== "run") return "busy";

  const fail = async (code: string) => {
    if (eventId) {
      await failUsage(supabase, {
        serverToken: dispatchToken(), eventId, walletId: (await walletId(supabase, ctx.workspaceId)) ?? "",
        error: code, apiCostUsdMicros: costMicros ?? undefined,
      });
    }
    if (jobId) await jobFailed(ctx, jobId, code);
    await finishStep(supabase, runId, owner, STEP.finish, -1, {
      status: "failed", attempts: b.attempts + 1, cost: { basis: "estimated", usdMicros: 0 }, errorCode: code, durationMs: ctx.deps.now() - t0,
    });
    await close(ctx, "failed", code);
    return "failed" as const;
  };
  if (!jobId || !rawPath) return fail("finish_source_missing");

  const { data: blob } = await supabase.storage.from("generation-assets").download(rawPath);
  if (!blob) return fail("finish_source_missing");
  let fin: FinishResult;
  try {
    fin = await ctx.deps.finish(Buffer.from(await blob.arrayBuffer()), input.config.finish);
  } catch (e) {
    return fail(e instanceof FinishError ? e.code : "finish_failed");
  }

  const path = `${ctx.workspaceId}/${jobId}/0.${fin.ext}`;
  const { error: upErr } = await supabase.storage.from("generation-assets")
    .upload(path, fin.bytes, { contentType: fin.mime, upsert: true });
  if (upErr) return fail("storage_failed");

  // Library rows — idempotent: a resumed finish finds its own rows.
  let generationId: string | null = null;
  const { data: existing } = await supabase.from("generations").select("id").eq("job_id", jobId).limit(1);
  generationId = existing?.[0]?.id ?? null;
  if (!generationId) {
    const { data: gen } = await supabase.from("generations").insert({
      job_id: jobId, workspace_id: ctx.workspaceId, quality_status: "skipped",
    }).select("id").single();
    generationId = gen?.id ?? null;
  }
  if (!generationId) return fail("library_failed");
  let assetId: string | null = null;
  const { data: assets } = await supabase.from("generation_assets").select("id")
    .eq("generation_id", generationId).eq("storage_path", path).limit(1);
  assetId = assets?.[0]?.id ?? null;
  if (!assetId) {
    const { data: asset } = await supabase.from("generation_assets").insert({
      generation_id: generationId, asset_type: "image", storage_path: path, width: fin.width, height: fin.height,
      metadata: { tool: THUMBNAIL_TOOL_KEY, provider: "openai", model: input.config.model, postprocess: fin.postprocess } as Json,
    }).select("id").single();
    assetId = asset?.id ?? null;
  }
  if (!assetId) return fail("library_failed");
  await derivatives(supabase, assetId, path, fin.bytes);

  const delivered = {
    path, job_id: jobId, generation_id: generationId, asset_id: assetId,
    width: fin.width, height: fin.height, mime: fin.mime, bytes: fin.bytes.length, sha256: fin.sha256,
    source: fin.source, inner: fin.inner, margin_px: fin.marginPx, checks: fin.checks,
    finish: { target: fin.config.target, margin_percent: fin.config.marginPercent, brightness_percent: fin.config.brightnessPercent, kernel: fin.config.kernel, format: fin.config.format },
    postprocess: fin.postprocess,
  };
  const { data: jobRow } = await supabase.from("generation_jobs").select("settings").eq("id", jobId).maybeSingle();
  const settings = (jobRow?.settings ?? {}) as Record<string, Json>;
  await supabase.from("generation_jobs").update({
    status: "completed", credits_charged: input.quote.thumbnailCredits, latency_ms: Date.now() - Date.parse(ctx.run.created_at),
    completed_at: new Date().toISOString(), request_id: typeof out.request_id === "string" ? out.request_id : null,
    settings: {
      ...settings,
      provider_request: (out.request ?? null) as Json,
      provider_output: [{
        provider_returned_width: (out.response as { width?: number } | undefined)?.width ?? null,
        provider_returned_height: (out.response as { height?: number } | undefined)?.height ?? null,
        provider_sha256: (out.response as { sha256?: string } | undefined)?.sha256 ?? null,
        stored_path: path, stored_width: fin.width, stored_height: fin.height, stored_sha256: fin.sha256,
        transformed_after_provider: true, postprocess: fin.postprocess,
      }] as unknown as Json,
    } as Json,
  }).eq("id", jobId);

  // The ledger closes AFTER the file and its rows exist.
  if (eventId) {
    await completeUsage(supabase, dispatchToken(), eventId, 1, {
      apiCostUsdMicros: costMicros ?? undefined,
      providerRequestId: typeof out.request_id === "string" ? out.request_id : null,
      executor: { providerSlug: "openai", modelSlug: input.config.model },
    });
  }
  await supabase.from("notifications").insert({
    user_id: ctx.userId, type: "generation_done", title: "generation_done", body: "thumbnail ×1", href: "/library",
  });
  await supabase.rpc("log_activity", {
    p_workspace_id: ctx.workspaceId, p_action: "generation.completed",
    p_entity_type: "generation_job", p_entity_id: jobId,
    p_metadata: {
      tool: THUMBNAIL_TOOL_KEY, provider: "openai", model: input.config.model, photos: input.photos.length,
      retouched: input.retouch, credits: input.quote.thumbnailCredits, run_id: runId,
    },
  });
  await finishStep(supabase, runId, owner, STEP.finish, -1, {
    status: "succeeded", attempts: b.attempts + 1, cost: { basis: "estimated", usdMicros: 0 },
    output: delivered as unknown as Json, durationMs: ctx.deps.now() - t0,
  });
  await closeOk(ctx, delivered as unknown as Record<string, unknown>, costMicros);
  return "ok";
}

async function derivatives(supabase: Client, assetId: string, path: string, bytes: Buffer): Promise<void> {
  try {
    const { default: sharp } = await import("sharp");
    const derive = (edge: number, quality: number) => sharp(bytes, { failOn: "none" })
      .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true }).webp({ quality }).toBuffer();
    const [thumb, preview] = await Promise.all([derive(THUMB_EDGE, THUMB_QUALITY), derive(PREVIEW_EDGE, PREVIEW_QUALITY)]);
    const opts = { contentType: "image/webp", upsert: true, cacheControl: "31536000, immutable" } as const;
    const bucket = supabase.storage.from("generation-assets");
    const [t, p] = await Promise.all([bucket.upload(thumbPathFor(path), thumb, opts), bucket.upload(previewPathFor(path), preview, opts)]);
    if (t.error) return;
    await supabase.rpc("set_asset_derivatives", {
      asset_id: assetId, thumb_path: thumbPathFor(path), preview_path: p.error ? null : previewPathFor(path),
    });
  } catch {
    // The library falls back to the original until the backfill makes one.
  }
}

/* ══ helpers ══════════════════════════════════════════════════════════════*/

async function close(ctx: Ctx, status: "ok" | "failed", error: string | null, extra: Record<string, Json> = {}): Promise<void> {
  const steps = await readStepRuns(ctx.supabase, ctx.runId);
  const retouchCredits = steps.filter((s) => s.position === STEP.retouch && s.status === "succeeded")
    .reduce((n, s) => n + (Number(outputOf(s).credits) || 0), 0);
  await patchRun(ctx.supabase, ctx.runId, ctx.owner, {
    status, error: error ?? "",
    credits: retouchCredits + (status === "ok" ? ctx.input?.quote.thumbnailCredits ?? 0 : 0),
    progress: { ...(progressOf(ctx.run)), stage: status === "ok" ? "done" : "failed" },
    duration_ms: Math.max(0, Date.now() - Date.parse(ctx.run.created_at)),
    ...extra,
  });
}

async function closeOk(ctx: Ctx, delivered: Record<string, unknown>, costMicros: number | null): Promise<void> {
  await close(ctx, "ok", null, {
    outputs: [{ path: String(delivered.path ?? ""), step: STEP.finish, item: -1 }] as unknown as Json,
    ...(costMicros !== null ? { api_cost_usd_micros: costMicros } : { cost_unknown: 1 }),
    model_label: ctx.input.config.model,
  });
}

async function progress(ctx: Ctx, p: Record<string, Json>): Promise<void> {
  const cur = progressOf(ctx.run);
  if (Object.entries(p).every(([k, v]) => cur[k] === v)) return;
  await patchRun(ctx.supabase, ctx.runId, ctx.owner, { progress: { ...cur, ...p } });
  ctx.run = { ...ctx.run, progress: { ...cur, ...p } };
}

function progressOf(run: RunRow): Record<string, Json> {
  return run.progress && typeof run.progress === "object" && !Array.isArray(run.progress) ? run.progress as Record<string, Json> : {};
}

function outputOf(s: Pick<StepRunRow, "output"> | undefined | null): Record<string, unknown> {
  const o = s?.output;
  return o && typeof o === "object" && !Array.isArray(o) ? o as Record<string, unknown> : {};
}

export function parseInput(raw: unknown): StoredInput | null {
  const i = raw as Partial<StoredInput> | null;
  if (!i || i.v !== 1 || !Array.isArray(i.photos) || i.photos.length === 0 || typeof i.retouch !== "boolean") return null;
  if (!i.quote || !i.config || !i.prompt || typeof i.prompt.digest !== "string") return null;
  if (!Array.isArray(i.reuse) || i.reuse.length !== i.photos.length) return null;
  return i as StoredInput;
}

async function walletId(supabase: Client, workspaceId: string): Promise<string | null> {
  const { data } = await supabase.from("credit_wallets").select("id").eq("workspace_id", workspaceId).maybeSingle();
  return data?.id ?? null;
}

async function eventOfJob(ctx: Ctx, jobId: string): Promise<{ id: string; status: string } | null> {
  const { data } = await ctx.supabase.from("usage_events").select("id, status")
    .eq("generation_job_id", jobId).eq("service_slug", THUMBNAIL_SERVICE)
    .order("created_at", { ascending: false }).limit(1);
  return data?.[0] ? { id: data[0].id, status: data[0].status } : null;
}

async function jobFailed(ctx: Ctx, jobId: string, code: string, settingsExtra: Record<string, Json> = {}): Promise<void> {
  const { data: row } = await ctx.supabase.from("generation_jobs").select("settings").eq("id", jobId).maybeSingle();
  await ctx.supabase.from("generation_jobs").update({
    status: "failed", error_message: code.slice(0, 200), error_class: code.slice(0, 80), completed_at: new Date().toISOString(),
    ...(Object.keys(settingsExtra).length ? { settings: { ...((row?.settings ?? {}) as Record<string, Json>), ...settingsExtra } as Json } : {}),
  }).eq("id", jobId);
}

async function recordCall(ctx: Ctx, eventId: string, jobId: string, outcome: SunburstOutcome, cost: SunburstCost): Promise<void> {
  const usage = outcome.ok ? outcome.answer.usage : outcome.usage;
  const edge = sizeEdge(ctx.input.config.size);
  await recordProviderCalls(ctx.supabase, [{
    actorKind: "customer", consumer: "image_tool", userId: ctx.userId, workspaceId: ctx.workspaceId,
    toolKey: THUMBNAIL_TOOL_KEY, usageEventId: eventId, jobId, runRef: ctx.runId,
    providerSlug: "openai", model: ctx.input.config.model,
    status: outcome.ok ? "succeeded" : "failed", errorCode: outcome.ok ? null : outcome.error,
    requestCount: 1,
    inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null,
    cachedInputTokens: usage?.cachedInputTokens ?? null,
    units: outcome.ok ? 1 : 0, unitKind: "image",
    resolution: edge === 1024 ? "1K" : edge === 2048 ? "2K" : String(edge),
    cost: cost.known ? { basis: "estimated", usdMicros: cost.usdMicros } : { basis: "unknown" },
    durationMs: outcome.durationMs,
  }]);
}

async function imageMeta(b: Buffer): Promise<{ width: number | null; height: number | null }> {
  try {
    const { default: sharp } = await import("sharp");
    const m = await sharp(b, { failOn: "none" }).metadata();
    return { width: m.width ?? null, height: m.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

/** A short, stable reference for logs (never the key or the prompt). */
export function runRef(runId: string): string {
  return createHash("sha256").update(runId).digest("hex").slice(0, 12);
}
