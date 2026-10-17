import "server-only";
import { dispatchToken } from "@/lib/server/server-token";
import type { Client } from "@/lib/services/workspace";

/**
 * THE DATABASE CONTRACT of the trial watermark (migration 0143), in one place.
 *
 * Every call goes through the customer's own session (there is no service
 * role); the functions marked TOKEN additionally require the server's
 * dispatch token, so a customer calling them from the browser gets
 * `forbidden`. Nothing here trusts a path, a state or a key that came from a
 * client: the database derives target paths, checks membership with
 * auth.uid(), and judges entitlement from rows only the Stripe webhook writes.
 *
 * Results are returned as `unknown`-validated plain objects; a malformed
 * answer is an error, never a default.
 */

type RpcError = { code?: string; message: string } | null;
type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcError }>;

// The generated Database type does not list these functions; the call is
// still a plain PostgREST RPC with the same client and session. Any client
// with an `rpc` method works — the app's server client, or the session-less
// one the cron uses for the purge.
type AnyClient = Client | { rpc: unknown };
const rpc = (supabase: AnyClient): Rpc => {
  const fn = (supabase as { rpc: (...a: unknown[]) => unknown }).rpc;
  return fn.bind(supabase) as unknown as Rpc;
};

export type RpcResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

async function call(supabase: AnyClient, fn: string, args: Record<string, unknown>): Promise<RpcResult<unknown>> {
  try {
    const { data, error } = await rpc(supabase)(fn, args);
    if (error) return { ok: false, error: error.message || "rpc_failed", code: error.code };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "rpc_failed" };
  }
}

const token = () => dispatchToken();

// ── Decision ────────────────────────────────────────────────────────────────

export type TrialMode = "off" | "paid" | "trial";
export type TrialReason =
  | "disabled" | "free_run" | "staff" | "subscription" | "paid_credits" | "trial" | "forced";
export type DecideReply = { mode: TrialMode; reason: TrialReason; config: Record<string, unknown> };

/** TOKEN · trial_watermark_decide(p_token, p_workspace_id, p_credits) → {mode, reason, config}; never null in SQL. */
export async function rpcDecide(supabase: AnyClient, workspaceId: string, credits: number): Promise<RpcResult<DecideReply | null>> {
  const r = await call(supabase, "trial_watermark_decide", { p_token: token(), p_workspace_id: workspaceId, p_credits: credits });
  if (!r.ok) return r;
  if (r.data === null || r.data === undefined) return { ok: true, data: null };
  const d = r.data;
  if (!isObj(d) || (d.mode !== "off" && d.mode !== "paid" && d.mode !== "trial") || typeof d.reason !== "string") {
    return { ok: false, error: "malformed_decide" };
  }
  return { ok: true, data: { mode: d.mode, reason: d.reason as TrialReason, config: isObj(d.config) ? d.config : {} } };
}

/** TOKEN · trial_watermark_config_read(p_token) → config jsonb (clamped by SQL). */
export async function rpcConfigRead(supabase: AnyClient): Promise<RpcResult<Record<string, unknown>>> {
  const r = await call(supabase, "trial_watermark_config_read", { p_token: token() });
  if (!r.ok) return r;
  return isObj(r.data) ? { ok: true, data: r.data } : { ok: false, error: "malformed_config" };
}

// ── Originals: reserve / attach / release ───────────────────────────────────

export type ReserveArgs = {
  workspaceId: string;
  jobId: string | null;
  /** Producer label for analytics (generator, image_retouch, ecommerce_thumbnail, fashion_*…). */
  operation: string;
  /** The library path the watermarked file will get; null when chosen later (Miniaturka). */
  markedPath: string | null;
  wrappedKey: string;
  kekFingerprint: string;
  cleanSha256: string;
  cleanMime: string;
  cleanBytes: number;
  width: number | null;
  height: number | null;
  /** Mark parameters actually used (variant, luminance, sizes…). No paths. */
  watermark: Record<string, unknown>;
};

/** TOKEN · trial_original_reserve(...) → {id, object_path}; the row is `pending`. */
export async function rpcReserve(supabase: AnyClient, a: ReserveArgs): Promise<RpcResult<{ id: string; objectPath: string }>> {
  const r = await call(supabase, "trial_original_reserve", {
    p_token: token(), p_workspace_id: a.workspaceId, p_job_id: a.jobId, p_operation: a.operation,
    p_marked_path: a.markedPath, p_wrapped_key: a.wrappedKey, p_kek_fp: a.kekFingerprint,
    p_clean_sha256: a.cleanSha256, p_clean_mime: a.cleanMime, p_clean_bytes: a.cleanBytes,
    p_width: a.width, p_height: a.height, p_watermark: a.watermark,
  });
  if (!r.ok) return r;
  const d = r.data;
  return isObj(d) && typeof d.id === "string" && typeof d.object_path === "string"
    ? { ok: true, data: { id: d.id, objectPath: d.object_path } }
    : { ok: false, error: "malformed_reserve" };
}

/** TOKEN · trial_original_attach(p_token, p_original_id, p_asset_id, p_marked_path, p_marked_sha256) → {ok, expires_at}. */
export async function rpcAttach(
  supabase: AnyClient, originalId: string, assetId: string, markedPath: string, markedSha256: string,
): Promise<RpcResult<{ expiresAt: string | null }>> {
  const r = await call(supabase, "trial_original_attach", {
    p_token: token(), p_original_id: originalId, p_asset_id: assetId, p_marked_path: markedPath, p_marked_sha256: markedSha256,
  });
  if (!r.ok) return r;
  const d = r.data;
  return isObj(d) && d.ok === true
    ? { ok: true, data: { expiresAt: typeof d.expires_at === "string" ? d.expires_at : null } }
    : { ok: false, error: isObj(d) && typeof d.error === "string" ? d.error : "attach_refused" };
}

/** TOKEN · trial_original_release(p_token, p_original_id) → {object_path} (pending → orphaned, key destroyed). */
export async function rpcRelease(supabase: AnyClient, originalId: string): Promise<RpcResult<{ objectPath: string | null }>> {
  const r = await call(supabase, "trial_original_release", { p_token: token(), p_original_id: originalId });
  if (!r.ok) return r;
  const d = r.data;
  return { ok: true, data: { objectPath: isObj(d) && typeof d.object_path === "string" ? d.object_path : null } };
}

// ── Reading states ─────────────────────────────────────────────────────────

export type StateRow = { assetId: string; state: "locked" | "unlocked" | "expired" | "unavailable"; expiresAt: string | null; daysLeft: number | null };

/** MEMBER · trial_original_states(p_asset_ids uuid[]) → rows for assets of the caller's workspaces only. */
export async function rpcStates(supabase: AnyClient, assetIds: string[]): Promise<RpcResult<StateRow[]>> {
  if (assetIds.length === 0) return { ok: true, data: [] };
  const r = await call(supabase, "trial_original_states", { p_asset_ids: assetIds.slice(0, 200) });
  if (!r.ok) return r;
  if (!Array.isArray(r.data)) return { ok: false, error: "malformed_states" };
  const out: StateRow[] = [];
  for (const row of r.data) {
    if (!isObj(row) || typeof row.asset_id !== "string") continue;
    const s = row.state;
    if (s !== "locked" && s !== "unlocked" && s !== "expired" && s !== "unavailable") continue;
    out.push({
      assetId: row.asset_id, state: s,
      expiresAt: typeof row.expires_at === "string" ? row.expires_at : null,
      daysLeft: typeof row.days_left === "number" ? row.days_left : null,
    });
  }
  return { ok: true, data: out };
}

/** MEMBER · trial_original_summary(p_workspace_id) → {locked, nearest_expires_at}. */
export async function rpcSummary(supabase: AnyClient, workspaceId: string): Promise<RpcResult<{ locked: number; nearestExpiresAt: string | null }>> {
  const r = await call(supabase, "trial_original_summary", { p_workspace_id: workspaceId });
  if (!r.ok) return r;
  const d = r.data;
  return isObj(d) && typeof d.locked === "number"
    ? { ok: true, data: { locked: d.locked, nearestExpiresAt: typeof d.nearest_expires_at === "string" ? d.nearest_expires_at : null } }
    : { ok: false, error: "malformed_summary" };
}

// ── Entitlement & unlock ───────────────────────────────────────────────────

export type EntitlementReply = {
  entitled: boolean;
  pending: boolean;
  hasLiveSubscription: boolean;
  planSlug: string | null;
  status: string | null;
  provider: string | null;
  providerSubscriptionId: string | null;
};

/** TOKEN · trial_watermark_entitlement(p_token, p_workspace_id) — DB view of "active paid subscription now". */
export async function rpcEntitlement(supabase: AnyClient, workspaceId: string): Promise<RpcResult<EntitlementReply>> {
  const r = await call(supabase, "trial_watermark_entitlement", { p_token: token(), p_workspace_id: workspaceId });
  if (!r.ok) return r;
  const d = r.data;
  if (!isObj(d) || typeof d.entitled !== "boolean") return { ok: false, error: "malformed_entitlement" };
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    ok: true,
    data: {
      entitled: d.entitled, pending: d.pending === true, hasLiveSubscription: d.has_live_subscription === true,
      planSlug: str(d.plan_slug), status: str(d.status), provider: str(d.provider),
      providerSubscriptionId: str(d.provider_subscription_id),
    },
  };
}

export type BeginReply =
  | { state: "ready"; originalId: string; workspaceId: string; jobId: string | null; objectPath: string; wrappedKey: string; kekFingerprint: string; cleanSha256: string; cleanMime: string; targetPath: string }
  | { state: "unlocked"; storagePath: string }
  | { state: "not_entitled" | "expired" | "unavailable" | "not_found" | "busy" };

/**
 * TOKEN · trial_original_unlock_begin(p_token, p_asset_id, p_live_ok) — judges
 * membership, entitlement (DB AND the caller's live Stripe verdict) and expiry
 * once, under a row lock; moves locked → unlocking with a lease and the
 * DB-derived target path. A second begin inside the lease resumes the same target.
 */
export async function rpcUnlockBegin(supabase: AnyClient, assetId: string, liveOk: boolean): Promise<RpcResult<BeginReply>> {
  const r = await call(supabase, "trial_original_unlock_begin", { p_token: token(), p_asset_id: assetId, p_live_ok: liveOk });
  if (!r.ok) return r;
  const d = r.data;
  if (!isObj(d) || typeof d.state !== "string") return { ok: false, error: "malformed_begin" };
  if (d.state === "ready") {
    const need = ["original_id", "workspace_id", "object_path", "wrapped_key", "kek_fp", "clean_sha256", "clean_mime", "target_path"];
    if (!need.every((k) => typeof d[k] === "string")) return { ok: false, error: "malformed_begin" };
    return {
      ok: true,
      data: {
        state: "ready", originalId: d.original_id as string, workspaceId: d.workspace_id as string,
        jobId: typeof d.job_id === "string" ? d.job_id : null, objectPath: d.object_path as string,
        wrappedKey: d.wrapped_key as string, kekFingerprint: d.kek_fp as string,
        cleanSha256: d.clean_sha256 as string, cleanMime: d.clean_mime as string, targetPath: d.target_path as string,
      },
    };
  }
  if (d.state === "unlocked") {
    return typeof d.storage_path === "string"
      ? { ok: true, data: { state: "unlocked", storagePath: d.storage_path } }
      : { ok: false, error: "malformed_begin" };
  }
  if (["not_entitled", "expired", "unavailable", "not_found", "busy"].includes(d.state)) {
    return { ok: true, data: { state: d.state as "not_entitled" | "expired" | "unavailable" | "not_found" | "busy" } };
  }
  return { ok: false, error: "malformed_begin" };
}

export type FinishReply =
  | { state: "unlocked"; already: boolean; storagePath: string; oldPaths: string[]; objectPath: string | null }
  | { state: "lease_lost" | "not_found" | "deleted" };

/**
 * TOKEN · trial_original_unlock_finish(p_token, p_asset_id, p_thumb_path,
 * p_preview_path, p_via, p_bulk_id) — commits an `unlocking` row inside its
 * lease: repoints the asset to the target, records derivatives (null = none,
 * the library rebuilds them), rewrites Miniaturka run outputs that named the
 * marked file, destroys the key, writes `watermark_unlocked`.
 */
export async function rpcUnlockFinish(
  supabase: AnyClient, assetId: string, thumbPath: string | null, previewPath: string | null,
  via: "single" | "bulk", bulkId: string | null,
): Promise<RpcResult<FinishReply>> {
  const r = await call(supabase, "trial_original_unlock_finish", {
    p_token: token(), p_asset_id: assetId, p_thumb_path: thumbPath, p_preview_path: previewPath, p_via: via, p_bulk_id: bulkId,
  });
  if (!r.ok) return r;
  const d = r.data;
  if (!isObj(d) || typeof d.state !== "string") return { ok: false, error: "malformed_finish" };
  if (d.state === "unlocked" && typeof d.storage_path === "string") {
    return {
      ok: true,
      data: {
        state: "unlocked", already: d.already === true, storagePath: d.storage_path,
        oldPaths: Array.isArray(d.old_paths) ? d.old_paths.filter((p): p is string => typeof p === "string") : [],
        objectPath: typeof d.object_path === "string" ? d.object_path : null,
      },
    };
  }
  if (d.state === "lease_lost" || d.state === "not_found" || d.state === "deleted") return { ok: true, data: { state: d.state } };
  return { ok: false, error: "malformed_finish" };
}

/** TOKEN · trial_original_unlock_abort(p_token, p_asset_id) — unlocking → locked (the target was not committed). */
export async function rpcUnlockAbort(supabase: AnyClient, assetId: string): Promise<RpcResult<{ targetPath: string | null }>> {
  const r = await call(supabase, "trial_original_unlock_abort", { p_token: token(), p_asset_id: assetId });
  if (!r.ok) return r;
  const d = r.data;
  return { ok: true, data: { targetPath: isObj(d) && typeof d.target_path === "string" ? d.target_path : null } };
}

/** TOKEN · trial_original_next_batch(p_token, p_workspace_id, p_limit, p_skip) → {asset_ids, remaining}. */
export async function rpcNextBatch(
  supabase: AnyClient, workspaceId: string, limit: number, skip: string[],
): Promise<RpcResult<{ assetIds: string[]; remaining: number }>> {
  const r = await call(supabase, "trial_original_next_batch", { p_token: token(), p_workspace_id: workspaceId, p_limit: limit, p_skip: skip });
  if (!r.ok) return r;
  const d = r.data;
  return isObj(d) && Array.isArray(d.asset_ids) && typeof d.remaining === "number"
    ? { ok: true, data: { assetIds: d.asset_ids.filter((x): x is string => typeof x === "string"), remaining: d.remaining } }
    : { ok: false, error: "malformed_batch" };
}

// ── Miniaturka: the clean pass behind a watermarked Retusz tile ─────────────

export type SourceReply = {
  status: "pending" | "locked" | "unlocking" | "unlocked" | "expired" | "deleted" | "orphaned";
  originalId: string;
  objectPath: string;
  /** Present only while the original can still be opened (pending/locked/unlocking, unexpired). */
  wrappedKey: string | null;
  kekFingerprint: string | null;
  cleanSha256: string;
  cleanMime: string;
  unlockedPath: string | null;
};

/**
 * TOKEN · trial_original_source(p_token, p_workspace_id, p_marked_path) →
 * null when that library path never was a trial image (definitive), else the
 * row. Scoped to the caller's own workspace and to paths inside it.
 */
export async function rpcSource(supabase: AnyClient, workspaceId: string, markedPath: string): Promise<RpcResult<SourceReply | null>> {
  const r = await call(supabase, "trial_original_source", { p_token: token(), p_workspace_id: workspaceId, p_marked_path: markedPath });
  if (!r.ok) return r;
  const d = r.data;
  if (d === null || d === undefined) return { ok: true, data: null };
  const statuses = ["pending", "locked", "unlocking", "unlocked", "expired", "deleted", "orphaned"];
  if (!isObj(d) || typeof d.status !== "string" || !statuses.includes(d.status) || typeof d.original_id !== "string"
    || typeof d.object_path !== "string" || typeof d.clean_sha256 !== "string" || typeof d.clean_mime !== "string") {
    return { ok: false, error: "malformed_source" };
  }
  return {
    ok: true,
    data: {
      status: d.status as SourceReply["status"], originalId: d.original_id, objectPath: d.object_path,
      wrappedKey: typeof d.wrapped_key === "string" ? d.wrapped_key : null,
      kekFingerprint: typeof d.kek_fp === "string" ? d.kek_fp : null,
      cleanSha256: d.clean_sha256, cleanMime: d.clean_mime,
      unlockedPath: typeof d.unlocked_path === "string" ? d.unlocked_path : null,
    },
  };
}

// ── Analytics, retention, purge ────────────────────────────────────────────

/** TOKEN · trial_watermark_log(p_token, p_workspace_id, p_action, p_entity_id, p_metadata, p_dedupe) → inserted? */
export async function rpcLog(
  supabase: AnyClient, workspaceId: string, action: string, entityId: string | null,
  metadata: Record<string, unknown>, dedupe: string | null,
): Promise<RpcResult<boolean>> {
  const r = await call(supabase, "trial_watermark_log", {
    p_token: token(), p_workspace_id: workspaceId, p_action: action, p_entity_id: entityId, p_metadata: metadata, p_dedupe: dedupe,
  });
  if (!r.ok) return r;
  return { ok: true, data: r.data === true };
}

/** TOKEN · trial_originals_sweep_now(p_token) → counts (the pg_cron job's HTTP belt). */
export async function rpcSweepNow(supabase: AnyClient): Promise<RpcResult<Record<string, unknown>>> {
  const r = await call(supabase, "trial_originals_sweep_now", { p_token: token() });
  if (!r.ok) return r;
  return { ok: true, data: isObj(r.data) ? r.data : {} };
}

/** TOKEN (anon allowed) · trial_originals_purge_list(p_token, p_limit) → object paths, armed for purge for 10 min. */
export async function rpcPurgeList(supabase: AnyClient, limit: number): Promise<RpcResult<string[]>> {
  const r = await call(supabase, "trial_originals_purge_list", { p_token: token(), p_limit: limit });
  if (!r.ok) return r;
  return Array.isArray(r.data)
    ? { ok: true, data: r.data.filter((x): x is string => typeof x === "string") }
    : { ok: false, error: "malformed_purge_list" };
}

/** TOKEN (anon allowed) · trial_originals_mark_purged(p_token, p_paths) → rows marked. */
export async function rpcMarkPurged(supabase: AnyClient, paths: string[]): Promise<RpcResult<number>> {
  if (paths.length === 0) return { ok: true, data: 0 };
  const r = await call(supabase, "trial_originals_mark_purged", { p_token: token(), p_paths: paths });
  if (!r.ok) return r;
  return { ok: true, data: typeof r.data === "number" ? r.data : 0 };
}

/** TOKEN (anon allowed) · trial_originals_purge_heartbeat(p_token, p_report) — records the last purge run for the admin page. */
export async function rpcPurgeHeartbeat(supabase: AnyClient, report: Record<string, unknown>): Promise<RpcResult<boolean>> {
  const r = await call(supabase, "trial_originals_purge_heartbeat", { p_token: token(), p_report: report });
  if (!r.ok) return r;
  return { ok: true, data: r.data === true };
}

/** ADMIN · trial_watermark_stats(p_days) → counts, funnel, sweep and purge heartbeats. */
export async function rpcStats(supabase: AnyClient, days: number): Promise<RpcResult<Record<string, unknown>>> {
  const r = await call(supabase, "trial_watermark_stats", { p_days: days });
  if (!r.ok) return r;
  return isObj(r.data) ? { ok: true, data: r.data } : { ok: false, error: "malformed_stats" };
}

export type { AnyClient as TrialRpcClient };
