import "server-only";
import { randomUUID } from "node:crypto";
import type { Json } from "@/lib/database.types";
import type { Client } from "@/lib/services/workspace";
import { PREVIEW_EDGE, PREVIEW_QUALITY, THUMB_EDGE, THUMB_QUALITY, previewPathFor, thumbPathFor } from "@/lib/thumbs";

/**
 * GROVBASE SHOT V2 — the library side of a delivered shot, and its undoing.
 * The same rules Miniaturka's finish follows (lib/server/thumbnail/run.ts),
 * for one job of many in a run:
 *   · a file is stored under a name chosen now (nobody can create it first);
 *   · a refund always removes the job's library rows FIRST, then its files —
 *     nothing refunded stays readable; when that cannot be confirmed, nothing
 *     is refunded yet and the next invocation tries again;
 *   · a read that fails is "unknown", never "nothing there".
 */

const BUCKET = "generation-assets";

export async function markJobCompleted(
  supabase: Client, jobId: string, credits: number,
  fields: Record<string, Json> = {}, settingsExtra: Record<string, Json> = {},
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 250));
    const { data: row, error: readErr } = await supabase.from("generation_jobs").select("status, settings").eq("id", jobId).maybeSingle();
    if (readErr || !row) continue;
    const extra = Object.keys(settingsExtra).length > 0;
    if (row.status === "completed" && !extra && Object.keys(fields).length === 0) return true;
    const { data, error } = await supabase.from("generation_jobs").update({
      status: "completed", credits_charged: credits, completed_at: new Date().toISOString(),
      ...fields,
      ...(extra ? { settings: { ...((row.settings ?? {}) as Record<string, Json>), ...settingsExtra } as Json } : {}),
    }).eq("id", jobId).select("id");
    if (!error && Array.isArray(data) && data.length === 1) return true;
  }
  return false;
}

export async function jobFailed(supabase: Client, jobId: string, code: string): Promise<void> {
  await supabase.from("generation_jobs").update({
    status: "failed", error_message: code.slice(0, 200), error_class: code.slice(0, 80),
    completed_at: new Date().toISOString(), credits_charged: 0,
  }).eq("id", jobId);
}

/** Upload under a fresh random name in `folder`. Null on failure. */
export async function storeNew(supabase: Client, folder: string, ext: string, bytes: Buffer, mime: string): Promise<string | null> {
  const bucket = supabase.storage.from(BUCKET);
  const tried: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const path = `${folder}/${randomUUID()}.${ext}`;
    try {
      const { error } = await bucket.upload(path, bytes, { contentType: mime, upsert: false });
      if (!error) {
        if (tried.length > 0) await bucket.remove(tried).catch(() => null);
        return path;
      }
    } catch { /* a fresh name next time */ }
    tried.push(path);
  }
  return null;
}

export type JobAsset = { id: string | null; path: string; generationId: string | null };

/** The library file of a job in this workspace; null = none, "unknown" = unreadable. */
export async function jobAsset(supabase: Client, workspaceId: string, jobId: string): Promise<JobAsset | null | "unknown"> {
  const { data: gens, error } = await supabase.from("generations")
    .select("id, generation_assets(id, storage_path)").eq("job_id", jobId).limit(5);
  if (error || !gens) return "unknown";
  for (const g of gens as { id: string; generation_assets?: { id?: string; storage_path: string }[] }[]) {
    const a = g.generation_assets?.find((x) => typeof x.storage_path === "string" && x.storage_path.startsWith(`${workspaceId}/`));
    if (a) return { id: typeof a.id === "string" ? a.id : null, path: a.storage_path, generationId: g.id };
  }
  return null;
}

/** Remove the job's library rows through the library's own delete. True only when none are left. */
export async function removeLibraryRows(supabase: Client, jobId: string): Promise<boolean> {
  const list = async (): Promise<string[] | null> => {
    const { data, error } = await supabase.from("generations").select("id").eq("job_id", jobId).limit(20);
    return error || !data ? null : data.map((g) => g.id);
  };
  const ids = await list();
  if (ids === null) return false;
  for (const genId of ids) {
    const { error } = await supabase.rpc("delete_generation", { gen_id: genId });
    if (error) return false;
  }
  const left = ids.length === 0 ? [] : await list();
  return left !== null && left.length === 0;
}

/** Remove every object in `folder`. True only when it is known empty. */
export async function removeFolder(supabase: Client, folder: string): Promise<boolean> {
  const bucket = supabase.storage.from(BUCKET);
  try {
    const { data, error } = await bucket.list(folder, { limit: 100 });
    if (error || !data) return false;
    const paths = data.filter((o) => typeof o.name === "string" && o.name.length > 0).map((o) => `${folder}/${o.name}`);
    if (paths.length === 0) return true;
    const { error: rmErr } = await bucket.remove(paths);
    if (rmErr) return false;
    const { data: after, error: afterErr } = await bucket.list(folder, { limit: 100 });
    return !afterErr && Array.isArray(after) && after.every((o) => !o.name);
  } catch {
    return false;
  }
}

/** The ledger event of a shot's charge, by its idempotency key (server-written). */
export async function eventByKey(supabase: Client, key: string): Promise<{ id: string; status: string; jobId: string | null } | null | "unknown"> {
  const { data, error } = await supabase.from("usage_events").select("id, status, generation_job_id")
    .eq("idempotency_key", key).order("created_at", { ascending: false }).limit(1);
  if (error || !data) return "unknown";
  return data[0] ? { id: data[0].id, status: data[0].status, jobId: data[0].generation_job_id ?? null } : null;
}

export async function eventStatus(supabase: Client, eventId: string): Promise<string | null | "unknown"> {
  const { data, error } = await supabase.from("usage_events").select("status").eq("id", eventId).maybeSingle();
  if (error) return "unknown";
  return data?.status ?? null;
}

export async function derivatives(supabase: Client, assetId: string, path: string, bytes: Buffer): Promise<void> {
  try {
    const { default: sharp } = await import("sharp");
    const derive = (edge: number, quality: number) => sharp(bytes, { failOn: "none" })
      .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true }).webp({ quality }).toBuffer();
    const [thumb, preview] = await Promise.all([derive(THUMB_EDGE, THUMB_QUALITY), derive(PREVIEW_EDGE, PREVIEW_QUALITY)]);
    const opts = { contentType: "image/webp", upsert: true, cacheControl: "31536000, immutable" } as const;
    const bucket = supabase.storage.from(BUCKET);
    const [t, p] = await Promise.all([bucket.upload(thumbPathFor(path), thumb, opts), bucket.upload(previewPathFor(path), preview, opts)]);
    if (t.error) return;
    await supabase.rpc("set_asset_derivatives", {
      asset_id: assetId, thumb_path: thumbPathFor(path), preview_path: p.error ? null : previewPathFor(path),
    });
  } catch {
    // The library falls back to the original until the backfill makes one.
  }
}

export async function walletId(supabase: Client, workspaceId: string): Promise<string | null> {
  const { data } = await supabase.from("credit_wallets").select("id").eq("workspace_id", workspaceId).maybeSingle();
  return data?.id ?? null;
}

export async function freshBalance(supabase: Client, workspaceId: string): Promise<number | null> {
  const { data, error } = await supabase.from("credit_wallets").select("balance").eq("workspace_id", workspaceId).maybeSingle();
  if (error) return null;
  return data?.balance ?? 0;
}
