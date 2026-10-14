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
import { EDIT_MIMES, editFilename, sha256, type EditMime } from "@/lib/thumbnail/openai-request";
import { callSunburst, type SunburstCallInput, type SunburstOutcome } from "@/lib/server/thumbnail/sunburst";
import { finishThumbnail, FinishError, type FinishResult } from "@/lib/server/thumbnail/finish";
import { openaiCredential, readPublishedPrompt, readRetouchOffer, readThumbnailConfig, readThumbnailState } from "@/lib/server/thumbnail/settings";
import { sunburstCost, type SunburstCost } from "@/lib/thumbnail/cost";
import {
  OPENAI_EDIT_MAX_IMAGE_BYTES, OPENAI_EDIT_MAX_IMAGES, RANGES, STEP, THUMBNAIL_OPERATION, THUMBNAIL_SERVICE, THUMBNAIL_TOOL_KEY,
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
 *     finished file exists. A refund always removes every file of that job
 *     first — nothing refunded stays readable.
 *   · Nothing is ever repeated automatically: a Retusz pass or a composition
 *     whose invocation died mid-call is recovered from what it left behind
 *     (its job row, its stored output) — never sent again. A failed run is
 *     retried only by the customer, as a NEW run that reuses every Retusz
 *     result already paid for.
 *   · A read that fails is "unknown", never "nothing there": the step waits
 *     for the next call instead of refunding a delivery or failing a paid job.
 */

/** How long one invocation may work (routes declare maxDuration = 300). */
export const INVOCATION_BUDGET_MS = 270_000;
/** A Retusz pass is only started with this much of the invocation left. */
export const RETOUCH_START_MS = 245_000;
/** Before reading the photos: the call, the reading and the finish must fit. */
const COMPOSE_OVERHEAD_MS = 50_000;
/** Kept free after the call for the finish, the library and the ledger. */
const FINISH_RESERVE_MS = 35_000;
/** Retusz passes running at once — the Retusz panel's own concurrency. */
export const RETOUCH_CONCURRENCY = 2;
/** Photos read and prepared at once before the composition. */
const PREP_CONCURRENCY = 4;
/** Invocations in a row whose photos were read but whose call no longer fit:
 *  past this the run ends (`compose_no_time`, nothing charged) instead of
 *  spending the run's invocations on the same reading again. */
export const MAX_COMPOSE_LATE = 3;
/** The lease a recovery takes on a step: short, so an unreadable answer is
 *  retried by the next call instead of being waited out. */
const RECOVERY_LEASE_S = 30;

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

/** The provider call's own timeout: the operator's setting, within the range
 *  one invocation can hold (RANGES.timeoutMs). */
const callBudgetMs = (input: StoredInput) => Math.min(input.config.timeout_ms, RANGES.timeoutMs.max);

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
      // What was CHARGED, kept up to date as steps are paid — nothing yet.
      // The quote lives in the input.
      credits: 0,
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
    const steps = await readStepRuns(supabase, runId);
    // A cancel is honoured while no composition is in flight or paid for.
    // Once one is, its charge is settled first — released, or closed as
    // delivered with the result in the library — and never left open.
    const composing = steps.some((x) => x.position === STEP.compose && (x.status === "running" || x.status === "succeeded"));
    if (run.error === "cancel_requested" && !composing) { await close(ctx, "failed", "cancelled"); return "finished"; }

    const next = await step(ctx, steps);
    if (next === "continue") continue;
    if (next === "yield") {
      // Hand the run back quickly so the next call does not wait out a lease.
      await patchRun(supabase, runId, owner, { lease_seconds: 10 });
      return "yield";
    }
    if (next === "wait") {
      // A step is still held by an earlier invocation (its lease has not run
      // out, or its Retusz job is still being written), or a read failed.
      // Keep the RUN leased for a minute: the browser's calls meanwhile are
      // refused as "busy" without claiming — every claim counts against the
      // run's limit of 30 invocations, and a tight retry loop would spend it
      // in seconds.
      await patchRun(supabase, runId, owner, { lease_seconds: 60 });
      return "busy";
    }
    // The run's lease went to another driver: it continues from there.
    if (next === "lost") return "busy";
    return next;
  }
  await patchRun(supabase, runId, owner, { lease_seconds: 10 });
  return "yield";
}

type StepOutcome = "continue" | "yield" | "wait" | "lost" | "finished";

async function step(ctx: Ctx, steps: StepRunRow[]): Promise<StepOutcome> {
  const { input } = ctx;
  const left = () => ctx.deadlineAt - ctx.deps.now();
  await syncCredits(ctx, steps);

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
      if (results.includes("lost")) return "lost";
      if (results.includes("failed")) { await close(ctx, "failed", "retouch_failed"); return "finished"; }
      if (results.includes("busy")) return "wait";
      return "continue";
    }
  }

  // ── 2 + 3. The composition — one Sunburst request — and its finish ─────
  const compose = steps.find((s) => s.position === STEP.compose && s.item_index === -1);
  if (compose?.status === "failed") { await close(ctx, "failed", compose.error_code ?? "compose_failed"); return "finished"; }
  if (compose?.status === "succeeded") {
    // Only after an invocation died between the answer and the finish.
    return outcomeOf(await resumeFinish(ctx, compose));
  }
  if (compose?.status === "running") {
    // Begun by an earlier invocation that is gone (or still holds it): what
    // it left behind decides — no photos read, no time needed, no lane.
    return outcomeOf(await recoverComposeStep(ctx));
  }
  // "Przygotowanie zdjęć" until the composition is charged and sent (the
  // photos are read and checked first); "Tworzenie kompozycji" from then.
  if (!input.retouch) await progress(ctx, { stage: "prepare" });
  if (left() < callBudgetMs(input) + COMPOSE_OVERHEAD_MS) return "yield";
  const r = await composeStep(ctx, steps);
  if (r === "late") return lateCompose(ctx);
  return outcomeOf(r);
}

function outcomeOf(r: ComposeOutcome): StepOutcome {
  if (r === "busy") return "wait";
  if (r === "lost") return "lost";
  if (r === "again") return "continue";
  if (r === "late") return "yield";
  return "finished";
}

/** The photos were read but the call no longer fitted (a slow read, or the
 *  OpenAI lane was full): yield — a few times, then stop honestly. */
async function lateCompose(ctx: Ctx): Promise<StepOutcome> {
  const late = (Number(progressOf(ctx.run).compose_late) || 0) + 1;
  if (late >= MAX_COMPOSE_LATE) { await close(ctx, "failed", "compose_no_time"); return "finished"; }
  await progress(ctx, { compose_late: late });
  return "yield";
}

/* ── 1 · RETUSZ ───────────────────────────────────────────────────────────*/

type ItemOutcome = "ok" | "failed" | "busy" | "lost";

/** What an earlier, dead invocation's pass left behind. */
type PassRecovery =
  | { kind: "recovered"; jobId: string; path: string; credits: number }
  | { kind: "fail"; code: string }
  | { kind: "fresh" };

async function retouchItem(ctx: Ctx, i: number, steps: StepRunRow[]): Promise<ItemOutcome> {
  const { supabase, runId, owner, input } = ctx;
  const photo = input.photos[i];
  const t0 = ctx.deps.now();
  const snap = steps.find((s) => s.position === STEP.retouch && s.item_index === i);

  // Everything this pass depends on is READ FIRST, before the step is taken:
  // a read that fails leaves the step as it was (no fresh lease to wait out).
  const reused = input.reuse[i];
  let reusedPath: string | null = null;
  if (reused) {
    const p = await retouchAssetPath(ctx, reused.job_id);
    if (p === "unknown") return "busy";
    reusedPath = p;
  }
  let recovery: PassRecovery | null = null;
  if (!reused && snap?.status === "running") {
    const r = await recoverPass(ctx, i, steps);
    if (r === "unknown") return "busy";
    recovery = r;
  }

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
  if (reused) {
    if (reusedPath && reusedPath === reused.path) return ok({ job_id: reused.job_id, path: reusedPath, reused: true }, 0);
    // Gone since (deleted from the library): not silently re-bought.
    return fail("retouch_reuse_missing");
  }

  // RESUMED after the invocation died mid-pass: never send it again. What
  // the earlier call left behind decides.
  if (b.attempts > 0) {
    if (!recovery) {
      const r = await recoverPass(ctx, i, steps);
      if (r === "unknown") return "busy";
      recovery = r;
    }
    if (recovery.kind === "recovered") return ok({ job_id: recovery.jobId, path: recovery.path, recovered: true }, recovery.credits);
    if (recovery.kind === "fail") return fail(recovery.code);
    // No job row at all: the earlier call never reached the ledger, so
    // nothing was charged — the pass may be made now (once).
  }

  // Retusz charges its own live price: the pass runs only if that is still
  // the price the customer was shown, on the single-call path.
  const offer = await readRetouchOffer(supabase);
  if (!offer.available) return fail(offer.reason === "workflow_on" ? "retouch_workflow_on" : "retouch_unavailable");
  if (offer.unit !== input.quote.retouchUnit) return fail("price_changed");

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
  let path: string | null = result.path || null;
  if (!path) {
    const p = await retouchAssetPath(ctx, result.jobId);
    path = p === "unknown" ? null : p;
  }
  if (!path) return fail("retouch_output_missing");
  return ok({ job_id: result.jobId, path }, result.credits);
}

/**
 * A pass an earlier invocation began and never recorded. Its Retusz job (the
 * newest one of this member for this photo since the run began, not claimed
 * by another item) decides:
 *   · its file is in the library — whether the job reads "completed" or is
 *     still "processing" (Retusz writes the file and closes its charge before
 *     it marks the job) — the pass is RECOVERED, never bought again;
 *   · failed — Retusz refunded it; the run stops (the customer's call);
 *   · no file — interrupted: the ledger's reconciler refunds it;
 *   · no job at all — nothing was charged: the pass may be made (once).
 */
async function recoverPass(ctx: Ctx, i: number, steps: StepRunRow[]): Promise<PassRecovery | "unknown"> {
  const claimed = new Set(steps.filter((s) => s.position === STEP.retouch && s.item_index !== i)
    .map((s) => outputOf(s).job_id).filter((v): v is string => typeof v === "string"));
  const prior = await priorRetouchJob(ctx, ctx.input.photos[i], claimed);
  if (prior === "unknown") return "unknown";
  if (!prior) return { kind: "fresh" };
  if (prior.status === "failed") return { kind: "fail", code: "retouch_failed" };
  const path = await retouchAssetPath(ctx, prior.id);
  if (path === "unknown") return "unknown";
  if (path) return { kind: "recovered", jobId: prior.id, path, credits: prior.credits || ctx.input.quote.retouchUnit || 0 };
  return { kind: "fail", code: "retouch_interrupted" };
}

/** The newest Retusz job of this member for this photo since the run began. */
async function priorRetouchJob(ctx: Ctx, photo: string, exclude: Set<string>):
  Promise<{ id: string; status: string; createdAt: string; credits: number } | null | "unknown"> {
  const { data, error } = await ctx.supabase.from("generation_jobs")
    .select("id, status, created_at, credits_charged")
    .eq("workspace_id", ctx.workspaceId).eq("user_id", ctx.userId)
    .gte("created_at", ctx.run.created_at)
    .contains("settings", { operation: "image_retouch", reference_paths: [photo] })
    .order("created_at", { ascending: true })
    .limit(20);
  if (error || !data) return "unknown";
  const row = data.find((j) => !exclude.has(j.id));
  return row ? { id: row.id, status: String(row.status), createdAt: row.created_at, credits: row.credits_charged ?? 0 } : null;
}

/** The stored file of a delivered Retusz job in this workspace ("completed",
 *  or "processing" with its file written), null when there is none,
 *  "unknown" when it could not be read. */
async function retouchAssetPath(ctx: Ctx, jobId: string): Promise<string | null | "unknown"> {
  const { data: job, error } = await ctx.supabase.from("generation_jobs")
    .select("id, status, workspace_id, settings").eq("id", jobId).maybeSingle();
  if (error) return "unknown";
  if (!job || job.workspace_id !== ctx.workspaceId) return null;
  if (job.status !== "completed" && job.status !== "processing") return null;
  const op = (job.settings as { operation?: unknown } | null)?.operation;
  if (op !== "image_retouch") return null;
  const asset = await jobAsset(ctx, jobId);
  if (asset === "unknown") return "unknown";
  return asset?.path ?? null;
}

/* ── 2 · COMPOSITION, then at once 3 · FINISH + LIBRARY ──────────────────*/

type ComposeOutcome = "ok" | "failed" | "busy" | "late" | "lost" | "again";

type PreparedInput = { bytes: Buffer; mime: EditMime; filename: string; source: string; transform: string; sourceSha: string };
type Prepared = { images: PreparedInput[]; paths: string[] } | { error: string };

/**
 * THE COMPOSITION, in three phases:
 *   1. the photos are read and checked — free, outside the OpenAI lane;
 *   2. inside the lane only: the time left is judged, the step begun, every
 *      refusal made, the charge opened and the ONE call sent;
 *   3. outside the lane again: the call recorded and the result delivered in
 *      the SAME invocation. The provider's answer lives in server memory only
 *      until the customer's file is in the library — a refund never leaves a
 *      file behind.
 */
async function composeStep(ctx: Ctx, steps: StepRunRow[]): Promise<ComposeOutcome> {
  const prep = await preparePhotos(ctx, steps);
  const sent = await withProviderLimit("openai", () => chargeAndCall(ctx, prep));
  if (sent.kind === "recover") return recoverCompose(ctx, sent.attempts);
  if (sent.kind !== "called") return sent.kind;
  return recordAndDeliver(ctx, sent);
}

/**
 * The inputs, in the customer's order: the Retusz result of each photo when
 * Retusz ran, otherwise the photo as uploaded. Read a few at a time.
 */
async function preparePhotos(ctx: Ctx, steps: StepRunRow[]): Promise<Prepared> {
  const { input } = ctx;
  const sources = input.photos.map((photo, i) => {
    if (!input.retouch) return { bucket: "product-images" as const, path: photo };
    const st = steps.find((x) => x.position === STEP.retouch && x.item_index === i && x.status === "succeeded");
    const p = outputOf(st).path;
    return typeof p === "string" ? { bucket: "generation-assets" as const, path: p } : null;
  });
  if (sources.some((x) => x === null || !x.path.startsWith(`${ctx.workspaceId}/`))) return { error: "source_unavailable" };
  const images: PreparedInput[] = new Array(sources.length);
  const state = { next: 0, error: null as string | null };
  const worker = async () => {
    while (state.error === null) {
      const i = state.next++;
      if (i >= sources.length) return;
      const r = await prepareOne(ctx, sources[i]!, i);
      if (typeof r === "string") { state.error ??= r; return; }
      images[i] = r;
    }
  };
  await Promise.all(Array.from({ length: Math.min(PREP_CONCURRENCY, sources.length) }, worker));
  if (state.error !== null) return { error: state.error };
  return { images, paths: sources.map((x) => x!.path) };
}

async function prepareOne(ctx: Ctx, src: { bucket: "product-images" | "generation-assets"; path: string }, i: number): Promise<PreparedInput | string> {
  try {
    const { data: blob } = await ctx.supabase.storage.from(src.bucket).download(src.path);
    if (!blob) return "source_unavailable";
    // The stored bytes as-is for PNG/JPEG/WebP — except a photo carrying an
    // EXIF orientation flag, which is turned upright the way the customer saw
    // it in the uploader; anything else (AVIF) becomes a PNG. Both recorded
    // per photo (the platform's rule outside Retusz).
    const prepared = await prepareReferenceImage(Buffer.from(await blob.arrayBuffer()), src.path);
    const mime = prepared.mime as EditMime;
    if (!(EDIT_MIMES as readonly string[]).includes(mime)) return "source_unsupported";
    const bytes = Buffer.from(prepared.base64, "base64");
    if (bytes.length > OPENAI_EDIT_MAX_IMAGE_BYTES) return "source_too_large";
    return { bytes, mime, filename: editFilename(i, mime), source: src.path, transform: prepared.transform, sourceSha: prepared.sourceSha256 };
  } catch {
    return "source_unsupported";
  }
}

type Called = {
  kind: "called"; t0: number; jobId: string; eventId: string; wallet: string;
  promptSha256: string; images: PreparedInput[]; outcome: SunburstOutcome;
};
type Sent = Called | { kind: "late" | "busy" | "failed" | "lost" | "again" } | { kind: "recover"; attempts: number };

/** Phase 2 — inside the OpenAI lane: nothing here waits for anything but
 *  the database and the one call. */
async function chargeAndCall(ctx: Ctx, prep: Prepared): Promise<Sent> {
  const { supabase, runId, owner, input } = ctx;
  const callMs = callBudgetMs(input);
  // The lane may have queued, the reading may have been slow: the whole
  // call and the finish after it must still fit, judged NOW, before the step
  // is begun or anything is charged.
  if (!("error" in prep) && ctx.deadlineAt - ctx.deps.now() < callMs + FINISH_RESERVE_MS) return { kind: "late" };

  const t0 = ctx.deps.now();
  const lease = Math.max(30, Math.ceil((ctx.deadlineAt - t0) / 1000) + 30);
  const b = await beginStep(supabase, runId, owner, STEP.compose, -1, "compose", "image_edit", lease);
  if (b.state === "done") return { kind: "again" };
  if (b.state === "busy") return { kind: "busy" };
  if (b.state === "not_owner") return { kind: "lost" };
  if (b.state === "failed" || b.state === "skipped") {
    await close(ctx, "failed", b.error ?? "compose_failed");
    return { kind: "failed" };
  }
  if (b.state !== "run") return { kind: "busy" };
  // Begun before by an invocation that is gone: recovered, never re-sent.
  if (b.attempts > 0) return { kind: "recover", attempts: b.attempts };

  const stepFail = async (code: string): Promise<Sent> => {
    await finishStep(supabase, runId, owner, STEP.compose, -1, {
      status: "failed", attempts: 1, providerSlug: "openai", model: input.config.model,
      cost: { basis: "unknown" }, errorCode: code, durationMs: ctx.deps.now() - t0,
    });
    await close(ctx, "failed", code);
    return { kind: "failed" };
  };
  if ("error" in prep) return stepFail(prep.error);

  // Everything that can refuse does so BEFORE anything is charged.
  const config = await readThumbnailConfig(supabase);
  const { prompt } = await readPublishedPrompt(supabase, config);
  if (!prompt || !prompt.approved) return stepFail("prompt_unavailable");
  if (prompt.digest !== input.prompt.digest) return stepFail("prompt_changed");
  const cred = await openaiCredential(supabase);
  if (!cred) return stepFail("provider_unavailable");
  const balance = await freshBalance(supabase, ctx.workspaceId);
  if (balance < input.quote.thumbnailCredits) return stepFail("insufficient_credits");
  const wallet = (await walletId(supabase, ctx.workspaceId)) ?? "";

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
      retouched_paths: input.retouch ? prep.paths : [],
      run_id: runId,
    } as Json,
  }).select("id").single();
  if (jobErr || !job) return stepFail("job_create_failed");
  await patchRun(supabase, runId, owner, { job_id: job.id });

  const usage = await startUsage(supabase, {
    serverToken: dispatchToken(),
    userId: ctx.userId, workspaceId: ctx.workspaceId, walletId: wallet,
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

  // THE ONE CALL — its timeout measured now, leaving room for the finish.
  const timeoutMs = Math.max(1, Math.min(callMs, ctx.deadlineAt - ctx.deps.now() - FINISH_RESERVE_MS));
  const outcome = await ctx.deps.callSunburst({
    apiKey: cred.apiKey, baseUrl: cred.baseUrl,
    spec: {
      model: input.config.model, prompt: prompt.text, size: input.config.size, quality: input.config.quality,
      images: prep.images.map(({ bytes, mime, filename }) => ({ bytes, mime, filename })),
    },
    expectedImageSha256: prep.images.map((img) => sha256(img.bytes)),
    timeoutMs,
  });
  return {
    kind: "called", t0, jobId: job.id, eventId: usage.eventId, wallet,
    promptSha256: prompt.sha256, images: prep.images, outcome,
  };
}

/** Phase 3 — outside the lane: the call recorded, then the delivery. */
async function recordAndDeliver(ctx: Ctx, c: Called): Promise<ComposeOutcome> {
  const { supabase, runId, owner, input } = ctx;
  const { outcome } = c;
  const cost = sunburstCost(outcome.ok ? outcome.answer.usage : outcome.usage, input.config.token_prices);
  const costMicros = cost.known ? cost.usdMicros : undefined;
  const sentImages = c.images.map((img, i) => ({
    index: i, source_path: img.source, transform: img.transform, source_sha256: img.sourceSha,
    sent_sha256: sha256(img.bytes), mime: img.mime, bytes: img.bytes.length,
  }));
  // ADMIN-ONLY record (the step output): the full request, plain hashes.
  const adminRequest: Record<string, Json> = {
    provider: "openai", endpoint: "images.edits", model: input.config.model, size: input.config.size,
    quality: input.config.quality, background: "opaque", output_format: "png", n: 1,
    prompt_version: input.prompt.version, prompt_sha256: c.promptSha256, prompt_digest: input.prompt.digest,
    photos: input.photos.length, retouched: input.retouch,
    boundary: (outcome.boundary ?? null) as unknown as Json, inputs: sentImages as unknown as Json,
  };
  // The job row is readable by the workspace: no provider, model or
  // endpoint, no plain prompt hash, no request-body hash — the keyed digest
  // and what was sent from the customer's own photos.
  const jobRequest: Record<string, Json> = {
    size: input.config.size, quality: input.config.quality, n: 1,
    prompt_version: input.prompt.version, prompt_digest: input.prompt.digest,
    photos: input.photos.length, retouched: input.retouch, inputs: sentImages as unknown as Json,
  };

  if (!outcome.ok) {
    await failUsage(supabase, {
      serverToken: dispatchToken(), eventId: c.eventId, walletId: c.wallet,
      error: outcome.error, apiCostUsdMicros: costMicros,
    });
    if (!outcome.notSent) await recordCall(ctx, c.eventId, c.jobId, outcome, cost);
    await jobFailed(ctx, c.jobId, outcome.error, { provider_request: jobRequest });
    await finishStep(supabase, runId, owner, STEP.compose, -1, {
      status: "failed", attempts: 1, providerSlug: "openai", model: input.config.model,
      cost: { basis: "unknown" }, errorCode: outcome.error, durationMs: ctx.deps.now() - c.t0,
    });
    await close(ctx, "failed", outcome.error);
    return "failed";
  }
  await recordCall(ctx, c.eventId, c.jobId, outcome, cost);

  const meta = await imageMeta(outcome.image);
  const response = {
    size: outcome.answer.size, quality: outcome.answer.quality, background: outcome.answer.background,
    output_format: outcome.answer.outputFormat, data_count: outcome.answer.dataCount, created: outcome.answer.created,
    mime: outcome.mime, bytes: outcome.image.length, sha256: sha256(outcome.image),
    width: meta.width, height: meta.height, http_status: outcome.httpStatus, duration_ms: outcome.durationMs,
  };
  await finishStep(supabase, runId, owner, STEP.compose, -1, {
    status: "succeeded", attempts: 1, providerSlug: "openai", model: input.config.model,
    inputTokens: outcome.answer.usage?.inputTokens ?? null, outputTokens: outcome.answer.usage?.outputTokens ?? null,
    units: 1, unitKind: "image",
    cost: cost.known ? { basis: "estimated", usdMicros: cost.usdMicros } : { basis: "unknown" },
    output: {
      job_id: c.jobId, usage_event_id: c.eventId, request_id: outcome.requestId,
      request: adminRequest,
      response: response as unknown as Json,
      usage: (outcome.answer.usage ?? null) as unknown as Json,
      cost_usd_micros: costMicros ?? null,
      cost_breakdown: cost.known ? (cost.breakdown as unknown as Json) : null,
      cost_unknown_reason: cost.known ? null : cost.reason,
    },
    durationMs: ctx.deps.now() - c.t0,
  });

  // 3 — at once, in this invocation, while the answer is in memory.
  await progress(ctx, { stage: "finish" });
  return deliver(ctx, {
    jobId: c.jobId, eventId: c.eventId, wallet: c.wallet, image: outcome.image, mime: outcome.mime,
    costMicros: costMicros ?? null, requestId: outcome.requestId, jobRequest, response,
  });
}

/** The composition step was found "running": an earlier invocation began it
 *  and is gone. What it left is read before the step is taken again. */
async function recoverComposeStep(ctx: Ctx): Promise<ComposeOutcome> {
  const jobId = await composeJobId(ctx);
  if (jobId === "unknown") return "busy";
  const asset = jobId ? await jobAsset(ctx, jobId) : null;
  if (asset === "unknown") return "busy";
  const b = await beginStep(ctx.supabase, ctx.runId, ctx.owner, STEP.compose, -1, "compose", "image_edit", RECOVERY_LEASE_S);
  if (b.state === "done") return "again";
  if (b.state === "busy") return "busy";
  if (b.state === "not_owner") return "lost";
  if (b.state === "failed" || b.state === "skipped") { await close(ctx, "failed", b.error ?? "compose_failed"); return "failed"; }
  if (b.state !== "run") return "busy";
  return recoverCompose(ctx, b.attempts, { jobId, asset });
}

/**
 * A composition whose invocation died during or right after the call:
 *   · its file is in the library → recorded as succeeded; the finish step
 *     then closes it as delivered (job completed, charge closed);
 *   · otherwise its answer was never stored, so there is nothing to deliver:
 *     every file of the job is removed and the charge released now (the
 *     reconciler would do the same, later). Never a second request.
 */
async function recoverCompose(ctx: Ctx, attempts: number,
  known?: { jobId: string | null; asset: JobAsset | null }): Promise<ComposeOutcome> {
  const { supabase, runId, owner } = ctx;
  let jobId: string | null;
  let asset: JobAsset | null;
  if (known) ({ jobId, asset } = known);
  else {
    const j = await composeJobId(ctx);
    if (j === "unknown") return "busy";
    const a = j ? await jobAsset(ctx, j) : null;
    if (a === "unknown") return "busy";
    jobId = j; asset = a;
  }
  if (jobId && asset) {
    await finishStep(supabase, runId, owner, STEP.compose, -1, {
      status: "succeeded", attempts: attempts + 1, providerSlug: "openai", model: ctx.input.config.model,
      units: 1, unitKind: "image", cost: { basis: "unknown" }, output: { job_id: jobId, recovered: true }, durationMs: 0,
    });
    return "again";
  }
  if (!(await releaseCompose(ctx, jobId, "compose_interrupted"))) return "busy";
  await finishStep(supabase, runId, owner, STEP.compose, -1, {
    status: "failed", attempts: attempts + 1, providerSlug: "openai", model: ctx.input.config.model,
    cost: { basis: "unknown" }, errorCode: "compose_interrupted", durationMs: 0,
  });
  await close(ctx, "failed", interruptedCode(ctx));
  return "failed";
}

/**
 * RELEASE the composition: every file of its job is removed FIRST (a
 * refunded result is never left readable), then the charge is refunded
 * (once — closed events are left as they are) and the job marked failed.
 * False when that could not be done now: nothing is refunded, the next call
 * tries again.
 */
async function releaseCompose(ctx: Ctx, jobId: string | null, code: string): Promise<boolean> {
  if (!jobId) return true;
  if (!(await removeJobFiles(ctx, jobId))) return false;
  const event = await eventOfJob(ctx, jobId);
  if (event === "unknown") return false;
  if (event?.status === "pending") {
    await failUsage(ctx.supabase, {
      serverToken: dispatchToken(), eventId: event.id, walletId: (await walletId(ctx.supabase, ctx.workspaceId)) ?? "", error: code,
    });
  }
  await jobFailed(ctx, jobId, code);
  return true;
}

/** A composition stopped by the customer's cancel reads as cancelled. */
const interruptedCode = (ctx: Ctx) => (ctx.run.error === "cancel_requested" ? "cancelled" : "compose_interrupted");

type Delivery = {
  jobId: string; eventId: string; wallet: string; image: Buffer; mime: EditMime;
  costMicros: number | null; requestId: string | null; jobRequest: Record<string, Json>; response: Record<string, unknown>;
};

/**
 * THE FINISH, from the answer in memory: the local 2560×2560 file under a
 * name chosen now (nobody can create it first), the library rows, the job
 * completed — and only then the charge closes. On any failure every file of
 * the job is removed and the composition refunded.
 */
async function deliver(ctx: Ctx, d: Delivery): Promise<ComposeOutcome> {
  const { supabase, runId, owner, input } = ctx;
  const t0 = ctx.deps.now();
  // Begun once more on a transient error: dropping a paid answer costs the
  // customer a refund and the operator the provider's bill.
  let b = await beginStep(supabase, runId, owner, STEP.finish, -1, "finish", "tool", 120);
  if (b.state === "busy") b = await beginStep(supabase, runId, owner, STEP.finish, -1, "finish", "tool", 120);
  const begun = b.state === "run";
  const attempts = b.state === "run" ? b.attempts : 0;
  const fail = async (code: string): Promise<ComposeOutcome> => {
    // Nothing paid for stays readable: the files go first; if they cannot,
    // nothing is refunded yet and the next call releases both.
    if (!(await removeJobFiles(ctx, d.jobId))) return "busy";
    await failUsage(supabase, {
      serverToken: dispatchToken(), eventId: d.eventId, walletId: d.wallet, error: code, apiCostUsdMicros: d.costMicros ?? undefined,
    });
    await jobFailed(ctx, d.jobId, code, { provider_request: d.jobRequest });
    if (begun) {
      await finishStep(supabase, runId, owner, STEP.finish, -1, {
        status: "failed", attempts: attempts + 1, cost: { basis: "estimated", usdMicros: 0 },
        errorCode: code, durationMs: ctx.deps.now() - t0,
      });
    }
    await close(ctx, "failed", code);
    return "failed";
  };
  if (b.state === "not_owner") {
    // Another driver holds the run now: it finds nothing delivered and closes
    // it. The charge is released here already rather than left to wait.
    await failUsage(supabase, { serverToken: dispatchToken(), eventId: d.eventId, walletId: d.wallet, error: "finish_lost" });
    return "lost";
  }
  if (!begun) return fail("finish_failed");

  let fin: FinishResult;
  try {
    fin = await ctx.deps.finish(d.image, input.config.finish);
  } catch (e) {
    return fail(e instanceof FinishError ? e.code : "finish_failed");
  }
  const path = await storeNew(ctx, d.jobId, "", fin.ext, fin.bytes, fin.mime);
  if (!path) return fail("storage_failed");

  const { data: gen, error: genErr } = await supabase.from("generations").insert({
    job_id: d.jobId, workspace_id: ctx.workspaceId, quality_status: "skipped",
  }).select("id").single();
  if (genErr || !gen) return fail("library_failed");
  const { data: asset, error: assetErr } = await supabase.from("generation_assets").insert({
    generation_id: gen.id, asset_type: "image", storage_path: path, width: fin.width, height: fin.height,
    metadata: { tool: THUMBNAIL_TOOL_KEY, postprocess: fin.postprocess } as Json,
  }).select("id").single();
  if (assetErr || !asset) return fail("library_failed");

  // The job is COMPLETED before the charge closes: a charged result is
  // always one the library shows. If that write cannot be made now, the
  // charge stays open — the next call (or the reconciler, which sees the
  // file) closes it as delivered.
  const completed = await markJobCompleted(ctx, d.jobId, {
    latency_ms: Date.now() - Date.parse(ctx.run.created_at), request_id: d.requestId,
  }, {
    provider_request: d.jobRequest,
    provider_output: [{
      provider_returned_width: d.response.width ?? null, provider_returned_height: d.response.height ?? null,
      provider_mime: d.mime, provider_bytes: d.image.length, provider_sha256: d.response.sha256 ?? null,
      stored_path: path, stored_width: fin.width, stored_height: fin.height, stored_sha256: fin.sha256,
      transformed_after_provider: true, postprocess: fin.postprocess,
    }] as unknown as Json,
  });
  if (!completed) return "busy";

  await completeUsage(supabase, dispatchToken(), d.eventId, 1, {
    apiCostUsdMicros: d.costMicros ?? undefined,
    providerRequestId: d.requestId,
    executor: { providerSlug: "openai", modelSlug: input.config.model },
  });
  await derivatives(supabase, asset.id, path, fin.bytes);
  // The provider's own answer, kept next to the delivered file for quality
  // review — written only now that it is paid for, under a fresh name.
  const rawExt = d.mime === "image/png" ? "png" : d.mime === "image/webp" ? "webp" : "jpg";
  const rawPath = await storeNew(ctx, d.jobId, "raw-", rawExt, d.image, d.mime).catch(() => null);
  await supabase.from("notifications").insert({
    user_id: ctx.userId, type: "generation_done", title: "generation_done", body: "thumbnail ×1", href: "/library",
  });
  await supabase.rpc("log_activity", {
    p_workspace_id: ctx.workspaceId, p_action: "generation.completed",
    p_entity_type: "generation_job", p_entity_id: d.jobId,
    p_metadata: {
      tool: THUMBNAIL_TOOL_KEY, photos: input.photos.length,
      retouched: input.retouch, credits: input.quote.thumbnailCredits, run_id: runId,
    },
  });
  const delivered = {
    path, job_id: d.jobId, generation_id: gen.id, asset_id: asset.id, raw_path: rawPath,
    width: fin.width, height: fin.height, mime: fin.mime, bytes: fin.bytes.length, sha256: fin.sha256,
    source: fin.source, inner: fin.inner, margin_px: fin.marginPx, checks: fin.checks,
    finish: { target: fin.config.target, margin_percent: fin.config.marginPercent, brightness_percent: fin.config.brightnessPercent, kernel: fin.config.kernel, format: fin.config.format },
    postprocess: fin.postprocess,
  };
  await finishStep(supabase, runId, owner, STEP.finish, -1, {
    status: "succeeded", attempts: attempts + 1, cost: { basis: "estimated", usdMicros: 0 },
    output: delivered as unknown as Json, durationMs: ctx.deps.now() - t0,
  });
  await closeOk(ctx, delivered as unknown as Record<string, unknown>, d.costMicros);
  return "ok";
}

/**
 * The composition was recorded but its finish never completed (the
 * invocation died in between). The answer was only ever in memory, so:
 * delivered already → closed as delivered; otherwise released.
 */
async function resumeFinish(ctx: Ctx, compose: StepRunRow): Promise<ComposeOutcome> {
  const { supabase, runId, owner } = ctx;
  const out = outputOf(compose);
  const jobId = typeof out.job_id === "string" ? out.job_id : ctx.run.job_id;
  const costMicros = typeof out.cost_usd_micros === "number" ? out.cost_usd_micros : null;
  // Read before the step is taken: an unreadable answer leaves it untouched.
  const asset = jobId ? await jobAsset(ctx, jobId) : null;
  if (asset === "unknown") return "busy";
  const b = await beginStep(supabase, runId, owner, STEP.finish, -1, "finish", "tool", RECOVERY_LEASE_S);
  if (b.state === "busy") return "busy";
  if (b.state === "not_owner") return "lost";
  if (b.state === "done") { await closeOk(ctx, outputOf({ output: b.output }), costMicros); return "ok"; }
  if (b.state === "failed" || b.state === "skipped") { await close(ctx, "failed", b.error ?? "finish_failed"); return "failed"; }
  if (b.state !== "run") return "busy";

  if (jobId && asset) {
    // DELIVERED before the invocation died: the job is completed and the
    // charge closed (in that order), then the run.
    if (!(await markJobCompleted(ctx, jobId))) return "busy";
    const event = await eventOfJob(ctx, jobId);
    if (event === "unknown") return "busy";
    if (event?.status === "pending") {
      await completeUsage(supabase, dispatchToken(), event.id, 1, {
        apiCostUsdMicros: costMicros ?? undefined, executor: { providerSlug: "openai", modelSlug: ctx.input.config.model },
      });
    }
    const delivered = { path: asset.path, job_id: jobId, width: asset.width, height: asset.height, recovered: true };
    await finishStep(supabase, runId, owner, STEP.finish, -1, {
      status: "succeeded", attempts: b.attempts + 1, cost: { basis: "estimated", usdMicros: 0 },
      output: delivered as unknown as Json, durationMs: 0,
    });
    await closeOk(ctx, delivered, costMicros);
    return "ok";
  }
  if (!(await releaseCompose(ctx, jobId, "compose_interrupted"))) return "busy";
  await finishStep(supabase, runId, owner, STEP.finish, -1, {
    status: "failed", attempts: b.attempts + 1, cost: { basis: "estimated", usdMicros: 0 }, errorCode: "compose_interrupted", durationMs: 0,
  });
  await close(ctx, "failed", interruptedCode(ctx));
  return "failed";
}

type JobAsset = { path: string; width: number | null; height: number | null };

/** The library file of a job in this workspace: null when there is none,
 *  "unknown" when it could not be read. */
async function jobAsset(ctx: Ctx, jobId: string): Promise<JobAsset | null | "unknown"> {
  const { data: gens, error } = await ctx.supabase.from("generations")
    .select("generation_assets(storage_path, width, height)").eq("job_id", jobId).limit(5);
  if (error || !gens) return "unknown";
  for (const g of gens as { generation_assets?: { storage_path: string; width: number | null; height: number | null }[] }[]) {
    const a = g.generation_assets?.find((x) => typeof x.storage_path === "string" && x.storage_path.startsWith(`${ctx.workspaceId}/`));
    if (a) return { path: a.storage_path, width: a.width ?? null, height: a.height ?? null };
  }
  return null;
}

/** The composition's job: the run's own reference, or — when that write was
 *  lost — the job tagged with this run. */
async function composeJobId(ctx: Ctx): Promise<string | null | "unknown"> {
  if (ctx.run.job_id) return ctx.run.job_id;
  const { data, error } = await ctx.supabase.from("generation_jobs").select("id")
    .eq("workspace_id", ctx.workspaceId).eq("user_id", ctx.userId)
    .contains("settings", { operation: THUMBNAIL_OPERATION, run_id: ctx.runId })
    .limit(1);
  if (error || !data) return "unknown";
  return data[0]?.id ?? null;
}

/**
 * Mark a delivered composition's job completed (with its price), checked
 * and tried twice. False when it could not be written: the caller then
 * leaves the charge open for the next call rather than charge for a result
 * the library would hide.
 */
async function markJobCompleted(ctx: Ctx, jobId: string,
  fields: Record<string, Json> = {}, settingsExtra: Record<string, Json> = {}): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 250));
    const { data: row, error: readErr } = await ctx.supabase.from("generation_jobs")
      .select("status, settings").eq("id", jobId).maybeSingle();
    if (readErr || !row) continue;
    const extra = Object.keys(settingsExtra).length > 0;
    if (row.status === "completed" && !extra && Object.keys(fields).length === 0) return true;
    const { data, error } = await ctx.supabase.from("generation_jobs").update({
      status: "completed", credits_charged: ctx.input.quote.thumbnailCredits, completed_at: new Date().toISOString(),
      ...fields,
      ...(extra ? { settings: { ...((row.settings ?? {}) as Record<string, Json>), ...settingsExtra } as Json } : {}),
    }).eq("id", jobId).select("id");
    if (!error && Array.isArray(data) && data.length === 1) return true;
  }
  return false;
}

/** Upload under a fresh random name in the job's folder (never over an
 *  existing object): a name nobody could know before. Null on failure. */
async function storeNew(ctx: Ctx, jobId: string, prefix: string, ext: string, bytes: Buffer, mime: string): Promise<string | null> {
  const bucket = ctx.supabase.storage.from("generation-assets");
  for (let attempt = 0; attempt < 2; attempt++) {
    const path = `${ctx.workspaceId}/${jobId}/${prefix}${randomUUID()}.${ext}`;
    try {
      const { error } = await bucket.upload(path, bytes, { contentType: mime, upsert: false });
      if (!error) return path;
    } catch {
      // A fresh name next time; whatever may have been written is removed
      // with the job's folder if the delivery fails.
    }
  }
  return null;
}

/** Remove every object in the job's folder (the delivered file, its
 *  derivatives, the raw answer). True only when the folder is known empty. */
async function removeJobFiles(ctx: Ctx, jobId: string): Promise<boolean> {
  const bucket = ctx.supabase.storage.from("generation-assets");
  const folder = `${ctx.workspaceId}/${jobId}`;
  try {
    const { data, error } = await bucket.list(folder, { limit: 100 });
    if (error || !data) return false;
    const paths = data.filter((o) => typeof o.name === "string" && o.name.length > 0).map((o) => `${folder}/${o.name}`);
    if (paths.length === 0) return true;
    const { error: rmErr } = await bucket.remove(paths);
    return !rmErr;
  } catch {
    return false;
  }
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

/** Credits actually charged by the Retusz passes of this run. */
function retouchCredits(steps: StepRunRow[]): number {
  return steps.filter((s) => s.position === STEP.retouch && s.status === "succeeded")
    .reduce((n, s) => n + (Number(outputOf(s).credits) || 0), 0);
}

/** Keep the run's `credits` at what was charged so far — also for a run that
 *  ends outside `close` (a cancel, the invocation limit). */
async function syncCredits(ctx: Ctx, steps: StepRunRow[]): Promise<void> {
  const paid = retouchCredits(steps);
  if (paid === (ctx.run.credits ?? 0)) return;
  if (await patchRun(ctx.supabase, ctx.runId, ctx.owner, { credits: paid })) ctx.run = { ...ctx.run, credits: paid };
}

async function close(ctx: Ctx, status: "ok" | "failed", error: string | null, extra: Record<string, Json> = {}): Promise<void> {
  const steps = await readStepRuns(ctx.supabase, ctx.runId);
  await patchRun(ctx.supabase, ctx.runId, ctx.owner, {
    status, error: error ?? "",
    credits: retouchCredits(steps) + (status === "ok" ? ctx.input?.quote.thumbnailCredits ?? 0 : 0),
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

/** The composition's ledger event: null when there is none, "unknown" when
 *  it could not be read. */
async function eventOfJob(ctx: Ctx, jobId: string): Promise<{ id: string; status: string } | null | "unknown"> {
  const { data, error } = await ctx.supabase.from("usage_events").select("id, status")
    .eq("generation_job_id", jobId).eq("service_slug", THUMBNAIL_SERVICE)
    .order("created_at", { ascending: false }).limit(1);
  if (error || !data) return "unknown";
  return data[0] ? { id: data[0].id, status: data[0].status } : null;
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
