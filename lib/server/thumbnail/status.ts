import "server-only";
import type { Client } from "@/lib/services/workspace";
import { STEP, type ThumbnailQuote, type ThumbnailStage } from "@/lib/thumbnail/config";

/**
 * WHAT THE CUSTOMER'S PANEL IS TOLD ABOUT ONE RUN — read through
 * `thumbnail_run_status`, which answers only for the caller's own run in a
 * workspace they belong to. Never the model, the prompt, a provider usage
 * figure or a cost: the stage, each photo's Retusz state with its result (for
 * the preview), the finished file, and a safe error code.
 *
 * Files are signed with the CUSTOMER's session, so storage policies decide:
 * a path outside their workspace cannot be signed here.
 */

export type ThumbnailRunView = {
  id: string;
  status: "queued" | "running" | "ok" | "failed";
  stage: ThumbnailStage | "failed";
  error: string | null;
  /** The customer asked to stop; the run stops at its next step boundary. */
  cancelling: boolean;
  driving: boolean;
  retouch: boolean;
  quote: ThumbnailQuote | null;
  photos: { index: number; path: string; url: string | null; retouch: { status: string; url: string | null; error: string | null } | null }[];
  composeStatus: string | null;
  result: { url: string; path: string; width: number | null; height: number | null; jobId: string | null } | null;
  createdAt: string;
  finishedAt: string | null;
};

type Raw = {
  id: string; status: string; error: string | null; progress: Record<string, unknown> | null; outputs: { path?: string }[] | null;
  credits: number | null; job_id: string | null; created_at: string; finished_at: string | null; driving: boolean;
  photos: string[]; retouch: boolean; quote: ThumbnailQuote | null;
  steps: { position: number; item: number; status: string; error: string | null; path: string | null; job_id: string | null; width: number | null; height: number | null }[];
};

const STAGES: readonly string[] = ["prepare", "retouch", "compose", "finish", "done"];

export async function readThumbnailRun(supabase: Client, runId: string, opts: { sign?: boolean } = {}): Promise<ThumbnailRunView | null> {
  const { data, error } = await supabase.rpc("thumbnail_run_status", { p_run_id: runId });
  const raw = (error ? null : data) as Raw | null;
  if (!raw?.id) return null;
  const status = (["queued", "running", "ok", "failed"].includes(raw.status) ? raw.status : "failed") as ThumbnailRunView["status"];
  const stageRaw = String(raw.progress?.stage ?? "prepare");
  const stage = (status === "failed" ? "failed" : status === "ok" ? "done" : STAGES.includes(stageRaw) ? stageRaw : "prepare") as ThumbnailRunView["stage"];
  const steps = Array.isArray(raw.steps) ? raw.steps : [];
  const photos = Array.isArray(raw.photos) ? raw.photos : [];
  const finish = steps.find((s) => s.position === STEP.finish && s.status === "succeeded");
  const finalPath = finish?.path ?? raw.outputs?.[0]?.path ?? null;

  // One batched signing call per bucket.
  const sign = opts.sign !== false;
  const assetPaths = [
    ...steps.filter((s) => s.position === STEP.retouch && s.path).map((s) => s.path as string),
    ...(finalPath ? [finalPath] : []),
  ];
  const urls = new Map<string, string>();
  if (sign && assetPaths.length) {
    const { data: signed } = await supabase.storage.from("generation-assets").createSignedUrls(assetPaths, 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(`a:${s.path}`, s.signedUrl);
  }
  if (sign && photos.length) {
    const { data: signed } = await supabase.storage.from("product-images").createSignedUrls(photos, 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(`p:${s.path}`, s.signedUrl);
  }

  const compose = steps.find((s) => s.position === STEP.compose);
  return {
    id: raw.id,
    status,
    stage,
    error: status === "failed" ? (raw.error ?? "common_error") : null,
    cancelling: raw.error === "cancel_requested" && (status === "queued" || status === "running"),
    driving: Boolean(raw.driving),
    retouch: Boolean(raw.retouch),
    quote: raw.quote && typeof raw.quote === "object" && "total" in raw.quote ? raw.quote : null,
    photos: photos.map((path, index) => {
      const s = steps.find((x) => x.position === STEP.retouch && x.item === index);
      return {
        index, path, url: urls.get(`p:${path}`) ?? null,
        retouch: raw.retouch ? {
          status: s?.status ?? "pending",
          url: s?.path ? urls.get(`a:${s.path}`) ?? null : null,
          error: s?.status === "failed" ? s.error : null,
        } : null,
      };
    }),
    composeStatus: compose?.status ?? null,
    result: status === "ok" && finalPath ? {
      url: urls.get(`a:${finalPath}`) ?? "", path: finalPath,
      width: typeof finish?.width === "number" ? finish.width : null,
      height: typeof finish?.height === "number" ? finish.height : null,
      jobId: finish?.job_id ?? raw.job_id,
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
