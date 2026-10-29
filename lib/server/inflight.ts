import "server-only";
import type { Client } from "@/lib/services/workspace";
import { listGalleryItems } from "@/lib/server/gallery";
import { readThumbnailRun } from "@/lib/server/thumbnail/status";
import { THUMBNAIL_OPERATION } from "@/lib/thumbnail/config";
import {
  GROVSHOT_V2_STAGES, JOB_STALE_MS, jobEstimateKey, runEstimateKey, thumbnailStep,
  type InflightEntry, type InflightKind, type InflightRefund, type InflightResolved, type InflightSnapshot, type InflightStage,
} from "@/lib/inflight/types";

/**
 * GENERACJE W TOKU V2 — WHAT IS IN PROGRESS FOR THIS CUSTOMER, AS THE SERVER
 * KNOWS IT. One read for every tile on every page (a tool's gallery, the
 * library, the tab title), in the customer's own session: RLS decides what a
 * job row they may see is, the definer RPCs answer only for their own runs.
 *
 * What a tile may know: tool, status, the REAL stage, when the server started
 * it, how many images it will be, the format, the usual time. Never a model,
 * a provider, a prompt, a cost or an error message from a provider.
 */

type JobRow = {
  id: string; status: string; created_at: string; started_at: string | null; quantity: number | null;
  aspect_ratio: string | null; error_class: string | null; error_message: string | null;
  settings: Record<string, unknown> | null;
};

type RunRow = {
  id: string; status: string; stage: string | null; retouch: boolean; photos: number;
  driving: boolean; cancelling: boolean; created_at: string;
};

/** A GrovShot V2 order (grovshot_runs_active, 0162). */
type V2RunRow = {
  id: string; status: string; stage: string | null; ordered: number | null; planned: number | null;
  delivered: number; settled: number; ratio: string | null; driving: boolean; created_at: string;
};

/** What the tile names a V2 order and its gallery. */
export const GROVSHOT_V2_OPERATION = "grovshot_v2";

const JOB_COLUMNS = "id, status, created_at, started_at, quantity, aspect_ratio, error_class, error_message, settings";

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function slotOf(settings: Record<string, unknown> | null): { tool: string | null; batch: string | null; request: string | null } {
  const slot = settings && typeof settings.slot === "object" && settings.slot ? settings.slot as Record<string, unknown> : null;
  return { tool: str(slot?.tool), batch: str(slot?.batch), request: str(slot?.request) };
}

/** The feature a job belongs to: its slot's tool, else its operation. */
function toolOfJob(row: JobRow): string {
  const slot = slotOf(row.settings);
  if (slot.tool) return slot.tool;
  const op = str(row.settings?.operation);
  if (op === "image_retouch") return "retouch";
  if (op === THUMBNAIL_OPERATION) return "ecommerce_thumbnail";
  return op ?? "generator";
}

// The estimate is the same for everybody for minutes at a time; one read per
// instance per five minutes is plenty.
let estimateCache: { at: number; medians: Record<string, number> } | null = null;
async function medians(supabase: Client): Promise<Record<string, number>> {
  if (estimateCache && Date.now() - estimateCache.at < 5 * 60_000) return estimateCache.medians;
  const { data, error } = await supabase.rpc("generation_duration_estimates");
  const raw = (error ? null : data) as { medians?: Record<string, unknown> } | null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw?.medians ?? {})) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  // A failed read is not cached: the next poll asks again.
  if (!error) estimateCache = { at: Date.now(), medians: out };
  return out;
}

function runStage(stage: string | null): InflightStage | null {
  return stage === "retouch" || stage === "compose" || stage === "finish" ? stage : null;
}

/** "The credits came back" only when the ledger says so — the same rule as
 *  the notification (lib/server/user-notifications.ts). */
async function refundOf(supabase: Client, jobId: string): Promise<{ refund: InflightRefund; credits: number | null }> {
  const { data, error } = await supabase.from("usage_events")
    .select("status, credits_charged, refund_tx_id")
    .eq("generation_job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return { refund: "unknown", credits: null };
  const ev = data?.[0];
  if (!ev) return { refund: "not_charged", credits: null };
  if (ev.status === "refunded" && ev.refund_tx_id && ev.credits_charged > 0) return { refund: "refunded", credits: ev.credits_charged };
  if (ev.status === "pending") return { refund: "pending", credits: null };
  if (ev.status === "failed" && ev.credits_charged === 0) return { refund: "not_charged", credits: null };
  return { refund: "unknown", credits: null };
}

export type TrackRef = { kind: InflightKind; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `job:<uuid>,run:<uuid>` → the refs, at most 30, malformed ones dropped. */
export function parseTrack(raw: string | null): TrackRef[] {
  const out: TrackRef[] = [];
  for (const part of (raw ?? "").split(",").slice(0, 30)) {
    const [kind, id] = part.split(":");
    if ((kind === "job" || kind === "run") && id && UUID.test(id)) out.push({ kind, id: id.toLowerCase() });
  }
  return out;
}

export async function readInflight(
  supabase: Client, userId: string, workspaceId: string, track: TrackRef[],
): Promise<InflightSnapshot & { undrivenRuns: string[]; undrivenV2: string[] }> {
  const now = Date.now();
  const since = new Date(now - JOB_STALE_MS).toISOString();
  const [jobsRes, runsRes, v2Res, limitRes, walletRes, med] = await Promise.all([
    supabase.from("generation_jobs").select(JOB_COLUMNS)
      .eq("workspace_id", workspaceId).eq("user_id", userId)
      .in("status", ["queued", "processing"])
      .gte("created_at", since)
      .not("settings->slot", "is", null)
      .order("created_at", { ascending: true })
      .limit(40),
    supabase.rpc("thumbnail_runs_active", { p_workspace_id: workspaceId }),
    supabase.rpc("grovshot_runs_active", { p_workspace_id: workspaceId }),
    supabase.rpc("generation_limit_state", { p_workspace_id: workspaceId }),
    supabase.from("credit_wallets").select("balance").eq("workspace_id", workspaceId).maybeSingle(),
    medians(supabase),
  ]);

  const active: InflightEntry[] = [];
  for (const row of (jobsRes.data ?? []) as unknown as JobRow[]) {
    const slot = slotOf(row.settings);
    const quantity = Math.max(1, row.quantity ?? 1);
    const key = jobEstimateKey(str(row.settings?.operation), str(row.settings?.concept_id), quantity);
    active.push({
      id: row.id, kind: "job", tool: toolOfJob(row), operation: str(row.settings?.operation),
      status: row.status === "queued" ? "queued" : "running",
      stage: "generate", step: null,
      startedAt: row.started_at ?? row.created_at,
      expected: quantity, ratio: row.aspect_ratio,
      batch: slot.batch, request: slot.request,
      estimateMs: med[key] ?? null,
      // A job is written already sent to work: there is no queue to leave.
      cancellable: false,
    });
  }
  const runs = Array.isArray(runsRes.data) ? runsRes.data as unknown as RunRow[] : [];
  // Open runs nobody is driving right now: the route picks them up again
  // after its answer (never sent to the browser).
  const undrivenRuns = runs.filter((r) => !r.driving).map((r) => r.id);
  for (const run of runs) {
    const stage = runStage(run.stage);
    active.push({
      id: run.id, kind: "run", tool: "ecommerce_thumbnail", operation: THUMBNAIL_OPERATION,
      status: run.status === "queued" ? "queued" : "running",
      stage, step: thumbnailStep(stage, Boolean(run.retouch)),
      startedAt: run.created_at, expected: 1, ratio: "1:1",
      batch: null, request: null,
      estimateMs: med[runEstimateKey(Boolean(run.retouch))] ?? null,
      // Cancel only what has not been picked up: queued, nobody driving it.
      cancellable: run.status === "queued" && !run.driving && !run.cancelling,
    });
  }

  const v2Runs = Array.isArray(v2Res.data) ? v2Res.data as unknown as V2RunRow[] : [];
  const undrivenV2 = v2Runs.filter((r) => !r.driving).map((r) => r.id);
  for (const run of v2Runs) {
    const stage = GROVSHOT_V2_STAGES.includes(run.stage as InflightStage) ? run.stage as InflightStage : null;
    const total = Math.max(1, run.planned ?? run.ordered ?? 1);
    active.push({
      id: run.id, kind: "run", tool: "prompts", operation: GROVSHOT_V2_OPERATION,
      status: run.status === "queued" ? "queued" : "running",
      stage, step: null,
      shots: stage === "images" || stage === "qc" || stage === "results" ? { done: Math.min(run.settled, total), total } : null,
      startedAt: run.created_at, expected: Math.max(1, run.ordered ?? 1), ratio: run.ratio,
      batch: null, request: null, estimateMs: null,
      // An order is analysed before anything is charged; it is not cancelled
      // from a tile (the panel's own stop is the V1/V2 shared rule: none).
      cancellable: false,
    });
  }

  const activeIds = new Set(active.map((a) => a.id));
  const wanted = track.filter((t) => !activeIds.has(t.id));
  const resolved = (await Promise.all(wanted.map((t) =>
    t.kind === "job" ? resolveJob(supabase, workspaceId, t.id, now) : resolveRun(supabase, workspaceId, t.id)))
  ).filter((r): r is InflightResolved => r !== null);

  const lim = (limitRes.error ? null : limitRes.data) as { limit?: number; active?: number; plan?: string } | null;
  return {
    ok: true,
    active,
    resolved,
    limit: lim && typeof lim.limit === "number"
      ? { max: lim.limit, active: typeof lim.active === "number" ? lim.active : 0, plan: lim.plan ?? "free" }
      : null,
    balance: typeof walletRes.data?.balance === "number" ? walletRes.data.balance : null,
    serverNow: new Date(now).toISOString(),
    undrivenRuns,
    undrivenV2,
  };
}

async function resolveJob(supabase: Client, workspaceId: string, id: string, now: number): Promise<InflightResolved | null> {
  const { data } = await supabase.from("generation_jobs").select(JOB_COLUMNS)
    .eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
  if (!data) return null;
  const row = data as unknown as JobRow;
  const tool = toolOfJob(row);
  const operation = str(row.settings?.operation);
  const expected = Math.max(1, row.quantity ?? 1);
  const live = row.status === "queued" || row.status === "processing";
  // Still in progress and not stale: the active list carries it (a member's
  // other workspace, or a job without a slot, is simply not a tile).
  if (live && now - Date.parse(row.started_at ?? row.created_at) < JOB_STALE_MS) return null;

  if (row.status === "completed") {
    const page = await listGalleryItems(supabase, workspaceId, { jobIds: [id], limit: 8 });
    const delivered = page.items.length;
    if (delivered >= expected) {
      return { id, kind: "job", tool, operation, outcome: "done", items: page.items, delivered, expected, error: null, refund: "not_charged", refundedCredits: null };
    }
    // PARTIAL: the images that arrived are kept and priced; the shortfall's
    // refund is claimed only when the ledger shows its receipt.
    const { data: ev } = await supabase.from("usage_events").select("metadata")
      .eq("generation_job_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const receipt = (ev?.metadata as Record<string, unknown> | null)?.partial_refund_tx;
    return {
      id, kind: "job", tool, operation, outcome: "partial", items: page.items, delivered, expected, error: null,
      refund: typeof receipt === "string" && receipt ? "refunded" : "unknown", refundedCredits: null,
    };
  }
  // Failed — or an invocation that died mid-call (still `processing` long
  // after any route could live): its charge is the reconciler's to return.
  const money = await refundOf(supabase, id);
  return {
    id, kind: "job", tool, operation,
    outcome: row.error_class === "cancelled" ? "cancelled" : "failed",
    items: [], delivered: 0, expected,
    error: live ? "interrupted" : (row.error_class ?? row.error_message ?? "common_error"),
    refund: money.refund, refundedCredits: money.credits,
  };
}

type V2Status = {
  status: string; error: string | null; ordered: number | null;
  shots: { shot: number; state: string; reason: string | null; refunded: boolean; job_id: string | null }[];
};

/** A finished GrovShot V2 order: its delivered shots, and the money truth —
 *  a shot that was not delivered was never charged, unless its delivery
 *  failed after the charge (then refunded). */
async function resolveV2(supabase: Client, workspaceId: string, id: string): Promise<InflightResolved | null | "not_v2"> {
  const { data, error } = await supabase.rpc("grovshot_run_status", { p_run_id: id });
  if (error) return null;
  if (!data) return "not_v2";
  const run = data as unknown as V2Status;
  if (run.status === "queued" || run.status === "running") return null;
  const shots = Array.isArray(run.shots) ? run.shots : [];
  const jobIds = shots.map((s) => s.job_id).filter((j): j is string => typeof j === "string" && j.length > 0);
  const page = jobIds.length > 0 ? await listGalleryItems(supabase, workspaceId, { jobIds, limit: 12 }) : { items: [] };
  const expected = Math.max(1, run.ordered ?? shots.length);
  const delivered = jobIds.length;
  const money = await refundOfOrder(supabase, workspaceId, id);
  return {
    id, kind: "run", tool: "prompts", operation: GROVSHOT_V2_OPERATION,
    outcome: delivered === 0 ? "failed" : delivered >= expected ? "done" : "partial",
    items: page.items, delivered, expected,
    error: delivered === 0 ? (run.error ?? shots.find((s) => s.reason)?.reason ?? "common_error") : null,
    refund: money.refund, refundedCredits: money.credits,
  };
}

/** The order's money truth from the LEDGER (refundOf's rule, every charge
 *  of the order): a shot that was not delivered was never charged, unless
 *  its delivery failed after the charge — then refunded, with its receipt. */
async function refundOfOrder(supabase: Client, workspaceId: string, runId: string): Promise<{ refund: InflightRefund; credits: number | null }> {
  const { data, error } = await supabase.from("usage_events")
    .select("status, credits_charged, refund_tx_id")
    .eq("workspace_id", workspaceId).eq("metadata->>run_id", runId).eq("metadata->>operation", GROVSHOT_V2_OPERATION)
    .limit(60);
  if (error) return { refund: "unknown", credits: null };
  const rows = data ?? [];
  if (rows.some((e) => e.status === "pending")) return { refund: "pending", credits: null };
  const back = rows.filter((e) => e.status === "refunded" && e.refund_tx_id && e.credits_charged > 0);
  if (back.length > 0) return { refund: "refunded", credits: back.reduce((s, e) => s + e.credits_charged, 0) };
  if (rows.some((e) => e.status === "refunded" || (e.status === "failed" && e.credits_charged > 0))) return { refund: "unknown", credits: null };
  return { refund: "not_charged", credits: null };
}

async function resolveRun(supabase: Client, workspaceId: string, id: string): Promise<InflightResolved | null> {
  const v2 = await resolveV2(supabase, workspaceId, id);
  if (v2 !== "not_v2") return v2;
  const run = await readThumbnailRun(supabase, id, { sign: false });
  if (!run || run === "unavailable") return null;
  if (run.status === "queued" || run.status === "running") return null;
  const base = { id, kind: "run" as const, tool: "ecommerce_thumbnail", operation: THUMBNAIL_OPERATION, expected: 1 };
  if (run.status === "ok" && run.result?.path) {
    const { data: asset } = await supabase.from("generation_assets")
      .select("generation_id, generations!inner(job_id, workspace_id)")
      .eq("storage_path", run.result.path).eq("generations.workspace_id", workspaceId)
      .limit(1).maybeSingle();
    const jobId = (asset as unknown as { generations?: { job_id?: string } } | null)?.generations?.job_id;
    const page = jobId ? await listGalleryItems(supabase, workspaceId, { jobIds: [jobId], limit: 2 }) : { items: [] };
    return { ...base, outcome: "done", items: page.items, delivered: 1, error: null, refund: "not_charged", refundedCredits: null };
  }
  // The composition's own charge is what a failed run hands back (Retusz
  // passes that succeeded stay paid and stay in the library) — the same job
  // the failure notification reads.
  const { data: compose } = await supabase.from("generation_jobs").select("id")
    .eq("workspace_id", workspaceId).eq("settings->>run_id", id).eq("settings->>operation", THUMBNAIL_OPERATION)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const money = compose?.id ? await refundOf(supabase, compose.id) : { refund: "not_charged" as const, credits: null };
  return {
    ...base,
    outcome: run.error === "cancelled" ? "cancelled" : "failed",
    items: [], delivered: 0, error: run.error ?? "common_error",
    refund: money.refund, refundedCredits: money.credits,
  };
}
