import "server-only";
import { createClient as createSupabase } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type { Client } from "@/lib/services/workspace";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { fetchWithSkewRetry } from "@/lib/supabase/skew-retry";
import { dispatchToken } from "@/lib/server/server-token";

/**
 * GROVBASE SHOT V2 — WHAT THE SERVER MAY DO FOR AN ORDER (migration 0163).
 *
 * After an order is accepted (in the customer's own session), every step runs
 * in a trusted SERVER context: the anonymous client with the server token —
 * no customer token, so nothing stops when it expires and nothing depends on
 * an open page. Each call below names the ORDER and the LEASE this invocation
 * holds; the database refuses anything that is not that order's (its
 * workspace, its jobs, its idempotency keys, its quoted price) and acts as the
 * order's owner only inside those functions. No table is written directly.
 */

/** The server's own client: the anonymous key + the dispatch token in
 *  `x-grovbase-server` (0157). Null when the server has no token. */
export function serverClient(): Client | null {
  const token = dispatchToken();
  if (!token) return null;
  return createSupabase<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "x-grovbase-server": token }, fetch: fetchWithSkewRetry() },
  }) as unknown as Client;
}

/** One order, as the invocation that holds its lease. */
export type Srv = { supabase: Client; runId: string; owner: string };

const T = () => dispatchToken() ?? "";
const base = (s: Srv) => ({ p_token: T(), p_run_id: s.runId, p_owner: s.owner });

/** Untyped RPC door for the 0163 functions (not in the generated types until
 *  they are regenerated) — the arguments are the functions' exact names. */
async function call<T>(s: Srv, fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error: boolean }> {
  try {
    const { data, error } = await (s.supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)(fn, { ...base(s), ...args });
    return { data: (error ? null : data) as T | null, error: Boolean(error) };
  } catch {
    return { data: null, error: true };
  }
}

export type SrvContext = {
  profile: { blocked: boolean | null; blocked_until: string | null; blocked_reason: string | null } | null;
  member: boolean;
  walletId: string | null;
  balance: number | null;
};

/** The owner's account state and the wallet, read fresh. Null = unreadable. */
export async function srvContext(s: Srv): Promise<SrvContext | null> {
  const { data } = await call<{ profile: SrvContext["profile"]; member: boolean; wallet_id: string | null; balance: number | null }>(s, "grovshot_srv_context", {});
  if (!data) return null;
  return { profile: data.profile ?? null, member: data.member === true, walletId: data.wallet_id ?? null, balance: typeof data.balance === "number" ? data.balance : null };
}

export async function srvAnalysis(s: Srv): Promise<{ validate: unknown; card: unknown } | null> {
  const { data } = await call<{ validate: unknown; card: unknown }>(s, "grovshot_srv_analysis", {});
  return data;
}

export async function srvMirror(s: Srv, session: Record<string, Json>, concepts: Record<string, Json>[]):
  Promise<{ sessionId: string; concepts: { id: string; priority: number }[] } | null> {
  const { data } = await call<{ session_id: string; concepts: { id: string; priority: number }[] }>(s, "grovshot_srv_mirror", { p_session: session, p_concepts: concepts });
  return data?.session_id ? { sessionId: data.session_id, concepts: Array.isArray(data.concepts) ? data.concepts : [] } : null;
}

export async function srvJobCreate(s: Srv, job: Record<string, Json>): Promise<string | null> {
  const { data } = await call<string>(s, "grovshot_srv_job_create", { p_job: job });
  return typeof data === "string" ? data : null;
}

export async function srvJobUpdate(s: Srv, jobId: string, status: "completed" | "failed",
  opts: { error?: string; latencyMs?: number; settings?: Record<string, Json> } = {}): Promise<boolean> {
  const { data } = await call<boolean>(s, "grovshot_srv_job_update", {
    p_job_id: jobId, p_status: status, p_error: opts.error ?? null, p_latency_ms: opts.latencyMs ?? null, p_settings: opts.settings ?? null,
  });
  return data === true;
}

export async function srvJobs(s: Srv, item: number | null): Promise<{ id: string; status: string; settings: Record<string, unknown> }[] | null> {
  const { data, error } = await call<{ id: string; status: string; settings: Record<string, unknown> }[]>(s, "grovshot_srv_jobs", { p_item: item });
  return error ? null : Array.isArray(data) ? data : [];
}

export async function srvLibraryAdd(s: Srv, a: {
  jobId: string; path: string; width: number | null; height: number | null; quality: "passed" | "warning"; score: number; shot: number;
}): Promise<{ generationId: string; assetId: string } | null> {
  const { data } = await call<{ generation_id: string; asset_id: string }>(s, "grovshot_srv_library_add", {
    p_job_id: a.jobId, p_path: a.path, p_width: a.width, p_height: a.height, p_quality: a.quality, p_score: a.score, p_shot: a.shot,
  });
  return data?.generation_id && data.asset_id ? { generationId: data.generation_id, assetId: data.asset_id } : null;
}

export async function srvLibraryRows(s: Srv, jobId: string): Promise<{ generation_id: string; asset_id: string | null; storage_path: string | null }[] | null> {
  const { data, error } = await call<{ generation_id: string; asset_id: string | null; storage_path: string | null }[]>(s, "grovshot_srv_library_rows", { p_job_id: jobId });
  return error ? null : Array.isArray(data) ? data : [];
}

/** True only when none of the job's library rows is left. */
export async function srvLibraryRemove(s: Srv, jobId: string): Promise<boolean> {
  const { data, error } = await call<number>(s, "grovshot_srv_library_remove", { p_job_id: jobId });
  return !error && data === 0;
}

export async function srvConceptDone(s: Srv, conceptId: string, jobId: string): Promise<void> {
  await call(s, "grovshot_srv_concept_done", { p_concept_id: conceptId, p_job_id: jobId });
}

export type ChargeResult = { ok: true; eventId: string } | { ok: false; error: string };

/** The charge of one delivered shot: the ORDER's quoted unit, decided in SQL. */
export async function srvUsageStart(s: Srv, a: {
  walletId: string; jobId: string; key: string; providerSlug: string; modelSlug: string; metadata: Record<string, Json>;
}): Promise<ChargeResult> {
  const { data, error } = await call<{ event_id: string | null; status: string }[]>(s, "grovshot_srv_usage_start", {
    p_wallet_id: a.walletId, p_job_id: a.jobId, p_key: a.key, p_provider_slug: a.providerSlug, p_model_slug: a.modelSlug, p_metadata: a.metadata,
  });
  if (error) return { ok: false, error: "unknown" };
  const row = Array.isArray(data) ? data[0] : null;
  if (row?.status === "ok" && row.event_id) return { ok: true, eventId: row.event_id };
  return { ok: false, error: row?.status || "unknown" };
}

export async function srvUsageComplete(s: Srv, eventId: string, costUsdMicros: number | null, providerSlug: string, modelSlug: string): Promise<void> {
  await call(s, "grovshot_srv_usage_complete", {
    p_event_id: eventId, p_api_cost_usd_micros: costUsdMicros, p_provider_slug: providerSlug, p_model_slug: modelSlug,
  });
}

export async function srvUsageFail(s: Srv, eventId: string, code: string, costUsdMicros: number | null = null): Promise<void> {
  await call(s, "grovshot_srv_usage_fail", { p_event_id: eventId, p_error: code, p_api_cost_usd_micros: costUsdMicros });
}

/** One event of this order, by id or by idempotency key; "unknown" when unreadable. */
export async function srvEvent(s: Srv, by: { eventId?: string; key?: string }): Promise<{ id: string; status: string; jobId: string | null } | null | "unknown"> {
  const { data, error } = await call<{ id: string; status: string; job_id: string | null } | null>(s, "grovshot_srv_event", {
    p_event_id: by.eventId ?? null, p_key: by.key ?? null,
  });
  if (error) return "unknown";
  return data?.id ? { id: data.id, status: data.status, jobId: data.job_id ?? null } : null;
}

export async function srvDerivatives(s: Srv, assetId: string, thumb: string, preview: string | null): Promise<void> {
  await call(s, "grovshot_srv_derivatives", { p_asset_id: assetId, p_thumb: thumb, p_preview: preview });
}

export async function srvLog(s: Srv, action: "grovshot_v2.completed" | "generation.completed", entityType: string, entityId: string, metadata: Record<string, Json>): Promise<void> {
  await call(s, "grovshot_srv_log", { p_action: action, p_entity_type: entityType, p_entity_id: entityId, p_metadata: metadata });
}

export async function srvNotifyDone(s: Srv, a: { jobId: string; count: number; generationId: string | null }): Promise<void> {
  const href = a.generationId ? `/library?open=${encodeURIComponent(a.generationId)}` : "/library";
  await call(s, "grovshot_srv_notify", {
    p_href: href,
    p_meta: { tool: "prompts", count: a.count, job_id: a.jobId, ...(a.generationId ? { generation_id: a.generationId } : {}) },
    p_dedupe: `generation_done:${a.jobId}`,
  });
}

/** Arm storage objects of this order for three minutes (exact names, or
 *  folders ending with "/" when `prefix`). */
export async function srvStorageGrant(s: Srv, bucket: "product-images" | "generation-assets", names: string[],
  ops: ("read" | "write" | "delete")[], prefix = false): Promise<boolean> {
  if (names.length === 0) return true;
  const { data } = await call<number>(s, "grovshot_srv_storage_grant", { p_bucket: bucket, p_names: names, p_prefix: prefix, p_ops: ops });
  return typeof data === "number" && data === names.length;
}

/** Orders waiting for a driver (the worker's queue). */
export async function srvDue(supabase: Client, limit: number): Promise<{ id: string; userId: string; workspaceId: string }[]> {
  try {
    const { data, error } = await (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)(
      "grovshot_srv_due", { p_token: T(), p_limit: limit });
    if (error || !Array.isArray(data)) return [];
    return (data as { id: string; user_id: string; workspace_id: string }[]).map((r) => ({ id: r.id, userId: r.user_id, workspaceId: r.workspace_id }));
  } catch {
    return [];
  }
}
