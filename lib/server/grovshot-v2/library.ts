import "server-only";
import { randomUUID } from "node:crypto";
import type { Json } from "@/lib/database.types";
import { PREVIEW_EDGE, PREVIEW_QUALITY, THUMB_EDGE, THUMB_QUALITY, previewPathFor, thumbPathFor } from "@/lib/thumbs";
import {
  srvContext, srvDerivatives, srvEvent, srvJobUpdate, srvLibraryRemove, srvLibraryRows, srvStorageGrant, type Srv,
} from "@/lib/server/grovshot-v2/srv";

/**
 * GROVBASE SHOT V2 — the library side of a delivered shot, and its undoing.
 * The same rules Miniaturka's finish follows (lib/server/thumbnail/run.ts),
 * for one job of many in a run:
 *   · a file is stored under a name chosen now (nobody can create it first);
 *   · a refund always removes the job's library rows FIRST, then its files —
 *     nothing refunded stays readable; when that cannot be confirmed, nothing
 *     is refunded yet and the next invocation tries again;
 *   · a read that fails is "unknown", never "nothing there".
 * Everything goes through the order's server functions (srv.ts, 0163); a
 * storage object is armed for this order just before it is touched.
 */

const BUCKET = "generation-assets";

export async function markJobCompleted(
  srv: Srv, jobId: string, fields: { latencyMs?: number } = {}, settingsExtra: Record<string, Json> = {},
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 250));
    if (await srvJobUpdate(srv, jobId, "completed", {
      latencyMs: fields.latencyMs, settings: Object.keys(settingsExtra).length > 0 ? settingsExtra : undefined,
    })) return true;
  }
  return false;
}

export async function jobFailed(srv: Srv, jobId: string, code: string): Promise<void> {
  await srvJobUpdate(srv, jobId, "failed", { error: code });
}

/** Upload under a fresh random name in `folder`. Null on failure. */
export async function storeNew(srv: Srv, folder: string, ext: string, bytes: Buffer, mime: string): Promise<string | null> {
  const bucket = srv.supabase.storage.from(BUCKET);
  const tried: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const path = `${folder}/${randomUUID()}.${ext}`;
    try {
      if (!(await srvStorageGrant(srv, BUCKET, [path], ["read", "write", "delete"]))) { tried.push(path); continue; }
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
export async function jobAsset(srv: Srv, workspaceId: string, jobId: string): Promise<JobAsset | null | "unknown"> {
  const rows = await srvLibraryRows(srv, jobId);
  if (rows === null) return "unknown";
  const a = rows.find((x) => typeof x.storage_path === "string" && x.storage_path.startsWith(`${workspaceId}/`));
  return a ? { id: a.asset_id ?? null, path: a.storage_path as string, generationId: a.generation_id } : null;
}

/** Remove the job's library rows. True only when none are left. */
export async function removeLibraryRows(srv: Srv, jobId: string): Promise<boolean> {
  return srvLibraryRemove(srv, jobId);
}

/** Remove every object in `folder`. True only when it is known empty. */
export async function removeFolder(srv: Srv, folder: string): Promise<boolean> {
  const bucket = srv.supabase.storage.from(BUCKET);
  try {
    if (!(await srvStorageGrant(srv, BUCKET, [`${folder}/`], ["read", "delete"], true))) return false;
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
export async function eventByKey(srv: Srv, key: string): Promise<{ id: string; status: string; jobId: string | null } | null | "unknown"> {
  return srvEvent(srv, { key });
}

export async function eventStatus(srv: Srv, eventId: string): Promise<string | null | "unknown"> {
  const e = await srvEvent(srv, { eventId });
  return e === "unknown" ? "unknown" : e?.status ?? null;
}

export async function derivatives(srv: Srv, assetId: string, path: string, bytes: Buffer): Promise<void> {
  try {
    const { default: sharp } = await import("sharp");
    const derive = (edge: number, quality: number) => sharp(bytes, { failOn: "none" })
      .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true }).webp({ quality }).toBuffer();
    const [thumb, preview] = await Promise.all([derive(THUMB_EDGE, THUMB_QUALITY), derive(PREVIEW_EDGE, PREVIEW_QUALITY)]);
    const opts = { contentType: "image/webp", upsert: true, cacheControl: "31536000, immutable" } as const;
    if (!(await srvStorageGrant(srv, BUCKET, [thumbPathFor(path), previewPathFor(path)], ["read", "write"]))) return;
    const bucket = srv.supabase.storage.from(BUCKET);
    const [t, p] = await Promise.all([bucket.upload(thumbPathFor(path), thumb, opts), bucket.upload(previewPathFor(path), preview, opts)]);
    if (t.error) return;
    await srvDerivatives(srv, assetId, thumbPathFor(path), p.error ? null : previewPathFor(path));
  } catch {
    // The library falls back to the original until the backfill makes one.
  }
}

export async function walletId(srv: Srv): Promise<string | null> {
  return (await srvContext(srv))?.walletId ?? null;
}

export async function freshBalance(srv: Srv): Promise<number | null> {
  const c = await srvContext(srv);
  return c === null ? null : c.balance ?? 0;
}
