import "server-only";
import type { Client } from "@/lib/services/workspace";
import { STEP } from "@/lib/thumbnail/config";

/**
 * WHAT THE CUSTOMER'S PANEL IS TOLD ABOUT ONE RUN — read through
 * `thumbnail_run_status`, which answers only for the caller's own run in a
 * workspace they belong to.
 *
 * Deliberately little: whether it is working, done or failed (with a safe
 * error code), the finished file, and — for a retry — the photos it was
 * started with and how many Retusz results are already paid for. Never how
 * the run is made: no stages, no steps, no intermediate files, no model,
 * provider, prompt, usage or cost. That stays server-side (admin
 * diagnostics); hiding it in the browser alone would not be enough.
 *
 * Files are signed with the CUSTOMER's session, so storage policies decide:
 * a path outside their workspace cannot be signed here.
 */

export type ThumbnailRunView = {
  id: string;
  status: "queued" | "running" | "ok" | "failed";
  error: string | null;
  /** The customer asked to stop; the run stops once nothing is in flight. */
  cancelling: boolean;
  driving: boolean;
  retouch: boolean;
  /** The customer's own uploads the run was started with (a retry reuses them). */
  photos: string[];
  /** Retusz results already paid for — a retry reuses them for free. */
  retouchedCount: number;
  result: { url: string; path: string; width: number | null; height: number | null } | null;
  createdAt: string;
  finishedAt: string | null;
};

type Step = { position: number; status: string; path: string | null; width: number | null; height: number | null };
type Raw = {
  id: string; status: string; error: string | null; created_at: string; finished_at: string | null; driving: boolean;
  photos: string[]; retouch: boolean;
  /** 0140 shape. */
  retouched_count?: number; result?: { path?: string | null; width?: number | null; height?: number | null } | null;
  /** 0139 shape (read only while 0140 is not applied). */
  steps?: Step[]; outputs?: { path?: string }[] | null;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The member's view of their run: null when there is no such run of
 *  theirs, "unavailable" when it could not be read right now (the panel
 *  keeps driving instead of giving the run up). */
export async function readThumbnailRun(supabase: Client, runId: string, opts: { sign?: boolean } = {}): Promise<ThumbnailRunView | null | "unavailable"> {
  const { data, error } = await supabase.rpc("thumbnail_run_status", { p_run_id: runId });
  if (error) return "unavailable";
  const raw = data as Raw | null;
  if (!raw?.id) return null;
  const status = (["queued", "running", "ok", "failed"].includes(raw.status) ? raw.status : "failed") as ThumbnailRunView["status"];
  const steps = Array.isArray(raw.steps) ? raw.steps : [];
  const finish = steps.find((s) => s.position === STEP.finish && s.status === "succeeded");
  const finalPath = (typeof raw.result?.path === "string" && raw.result.path) || finish?.path || raw.outputs?.[0]?.path || null;
  const retouchedCount = typeof raw.retouched_count === "number"
    ? raw.retouched_count
    : steps.filter((s) => s.position === STEP.retouch && s.status === "succeeded").length;

  let url: string | null = null;
  if (opts.sign !== false && status === "ok" && finalPath) {
    const { data: signed } = await supabase.storage.from("generation-assets").createSignedUrl(finalPath, 3600);
    url = signed?.signedUrl ?? null;
  }
  return {
    id: raw.id,
    status,
    error: status === "failed" ? (raw.error ?? "common_error") : null,
    cancelling: raw.error === "cancel_requested" && (status === "queued" || status === "running"),
    driving: Boolean(raw.driving),
    retouch: Boolean(raw.retouch),
    photos: Array.isArray(raw.photos) ? raw.photos.filter((p): p is string => typeof p === "string") : [],
    retouchedCount,
    result: status === "ok" && finalPath ? {
      url: url ?? "", path: finalPath,
      width: num(raw.result?.width) ?? num(finish?.width),
      height: num(raw.result?.height) ?? num(finish?.height),
    } : null,
    createdAt: raw.created_at,
    finishedAt: raw.finished_at,
  };
}

/** The member's newest run in this workspace that is still open — what the
 *  panel resumes after a refresh. */
export async function latestOpenThumbnailRun(supabase: Client, workspaceId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("thumbnail_runs_recent", { p_workspace_id: workspaceId, p_limit: 5 });
  if (error || !Array.isArray(data)) return null;
  const open = (data as { id: string; status: string; created_at: string }[])
    .find((r) => (r.status === "queued" || r.status === "running") && Date.now() - Date.parse(r.created_at) < 6 * 3600_000);
  return open?.id ?? null;
}

export async function cancelThumbnailRun(supabase: Client, runId: string): Promise<"cancelled" | "requested" | "finished" | "not_found"> {
  const { data, error } = await supabase.rpc("thumbnail_run_cancel", { p_run_id: runId });
  const state = (error ? null : (data as { state?: string } | null)?.state) ?? "not_found";
  return state === "cancelled" || state === "requested" || state === "finished" ? state : "not_found";
}
