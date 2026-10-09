import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { Client } from "@/lib/services/workspace";
import { isPhotoTool, type PhotoToolSlug } from "@/lib/images/tools";
import type { DeliverInput, DeliverResult } from "@/lib/server/image-tools";
import { THUMB_EDGE, THUMB_QUALITY, thumbPathFor } from "@/lib/thumbs";

/**
 * THE FOUR PHOTO TOOLS — what sits around the shared runner.
 *
 * `runTool` (lib/server/image-tools.ts) is still the one place a run happens:
 * provider, price, reservation, refund, trace. This module only handles the
 * parts that are specific to a screen whose photos live in Storage:
 *
 *   in   — the photo the browser uploaded to its own workspace folder, read
 *          back on the server (a body over Vercel's 4.5 MB request limit never
 *          reaches the function), and made into an input every endpoint
 *          accepts without changing what the product looks like;
 *   out  — the finished image stored in the workspace's private bucket and
 *          recorded in `tool_results`, the table the Library's "Narzędzia" tab
 *          already lists. A paid result is kept the moment it exists, so a
 *          refresh, a closed tab or a dropped response never loses it.
 */

/** Where the panel uploads its photos (bucket `product-images`, RLS-keyed by
 *  the workspace id as the first path segment, like Retusz and Moda). */
export const PHOTO_SOURCE_BUCKET = "product-images";
/** Where results are kept — the same bucket and folder "Zapisz" always used. */
export const PHOTO_RESULT_BUCKET = "generation-assets";

/** A storage path this workspace may hand to a tool: its own folder, a plain
 *  name, nothing that walks out of it. The same shape Retusz accepts. */
export function validSourcePath(path: unknown, workspaceId: string): path is string {
  return typeof path === "string"
    && path.length > 0 && path.length <= 300
    && path.startsWith(`${workspaceId}/`)
    && !path.includes("..")
    && /^[\w\-./]+$/.test(path);
}

/** Download a photo the browser uploaded. RLS decides access — a path outside
 *  the caller's workspace returns nothing. */
export async function loadSource(supabase: Client, path: string): Promise<Buffer | null> {
  const { data } = await supabase.storage.from(PHOTO_SOURCE_BUCKET).download(path);
  if (!data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/**
 * THE LONGEST SIDE EACH ENDPOINT TAKES. Photoroom documents 6000 px for the
 * Remove Background API and downscales anything above 5000 px on the Image
 * Editing API itself; anything larger is reduced here, proportionally, so a
 * request is never refused (and never silently cropped) for its size.
 */
export const MAX_SIDE: Record<PhotoToolSlug, number> = {
  remove_bg: 6000, white_bg: 6000, ai_background: 5000, ai_shadow: 5000,
};

const PASS_FORMATS = new Set(["jpeg", "png", "webp"]);

/**
 * MADE INTO AN INPUT EVERY ENDPOINT ACCEPTS — and nothing more. A JPEG, PNG
 * or WebP that is upright and within size goes as-is, byte for byte. Only an
 * AVIF (the cutout endpoint does not list it), an EXIF-rotated photo (so the
 * provider sees what the seller sees) or an oversized one is re-encoded — as
 * lossless PNG, with the proportions kept.
 */
export async function prepareInput(bytes: Buffer, tool: PhotoToolSlug): Promise<{ bytes: Buffer; mime: string } | null> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try { meta = await sharp(bytes, { failOn: "none" }).metadata(); }
  catch { return null; }
  if (!meta.width || !meta.height || !meta.format) return null;
  const rotated = (meta.orientation ?? 1) > 1;
  const longest = Math.max(meta.width, meta.height);
  const limit = MAX_SIDE[tool];
  if (PASS_FORMATS.has(meta.format) && !rotated && longest <= limit) {
    return { bytes, mime: meta.format === "jpeg" ? "image/jpeg" : `image/${meta.format}` };
  }
  if (!["jpeg", "png", "webp", "avif", "heif"].includes(meta.format)) return null;
  let pipeline = sharp(bytes, { failOn: "none" }).rotate();
  if (longest > limit) pipeline = pipeline.resize({ width: limit, height: limit, fit: "inside", withoutEnlargement: true });
  return { bytes: await pipeline.png({ compressionLevel: 6 }).toBuffer(), mime: "image/png" };
}

/** What the browser may know about a run's settings — the choices it made
 *  itself, never a preset's prompt. Stored with the result for the history. */
export function settingsSummary(tool: PhotoToolSlug, settings: unknown): Record<string, string> {
  const s = (settings ?? {}) as Record<string, unknown>;
  const pick = (k: string) => (typeof s[k] === "string" ? String(s[k]).slice(0, 40) : undefined);
  const out: Record<string, string | undefined> = { format: pick("format") };
  if (tool === "white_bg") out.color = pick("color");
  if (tool === "ai_shadow") { out.style = pick("style"); out.background = pick("background"); out.color = pick("color"); }
  if (tool === "ai_background") {
    out.preset = pick("preset") || undefined;
    if (!out.preset) out.custom = "1";
  }
  return Object.fromEntries(Object.entries(out).filter((e): e is [string, string] => Boolean(e[1])));
}

const extOf = (mime: string) => (mime.includes("webp") ? "webp" : mime.includes("jpeg") ? "jpg" : mime.includes("tiff") ? "tif" : "png");

/**
 * The `deliver` hook handed to runTool: the finished image into the private
 * bucket, then its row in `tool_results`. A row that cannot be written takes
 * its file back out, and the run is then refunded by the runner — a result is
 * either kept AND listed, or not delivered at all.
 *
 * A GRID THUMBNAIL IS WRITTEN WITH IT (lib/thumbs.ts: 640 px WebP), and its
 * path goes into the row at INSERT time — `tool_results` has no UPDATE policy,
 * so a derivative made later could never be recorded. The panel's gallery
 * paints the thumbnail; the original is what "Pobierz" and the comparison
 * open. A thumbnail that fails is simply absent: the grid falls back to the
 * original rather than to a broken image.
 */
export function storeResult(supabase: Client, ctx: {
  workspaceId: string; userId: string; tool: PhotoToolSlug;
  sourcePath: string; guidancePath: string | null; settings: unknown;
}): (out: DeliverInput) => Promise<DeliverResult> {
  return async (out) => {
    const path = `${ctx.workspaceId}/tools/${randomUUID()}.${extOf(out.mime)}`;
    const bucket = supabase.storage.from(PHOTO_RESULT_BUCKET);
    const { error } = await bucket.upload(path, out.bytes, { contentType: out.mime, upsert: false });
    if (error) return { ok: false, error: "storage_failed" };
    const thumb = await makeThumb(out.bytes);
    const thumbPath = thumbPathFor(path);
    const thumbKept = thumb
      ? !(await bucket.upload(thumbPath, thumb, { contentType: "image/webp", upsert: false })).error
      : false;
    const { data: row, error: rowError } = await supabase.from("tool_results").insert({
      workspace_id: ctx.workspaceId, user_id: ctx.userId, tool_slug: ctx.tool,
      storage_path: path, mime_type: out.mime, file_size: out.bytes.length,
      metadata: {
        width: out.width, height: out.height,
        ...(thumbKept ? { thumb: thumbPath } : {}),
        source_path: ctx.sourcePath,
        ...(ctx.guidancePath ? { guidance_path: ctx.guidancePath } : {}),
        environment: out.environment,
        provider: out.providerSlug,
        ...(out.endpoint ? { endpoint: out.endpoint } : {}),
        credits: out.credits,
        ...(out.usageEventId ? { usage_event_id: out.usageEventId } : {}),
        ...(out.meta.seed ? { seed: out.meta.seed } : {}),
        ...(out.meta.uncertainty ? { uncertainty: out.meta.uncertainty } : {}),
        settings: settingsSummary(ctx.tool, ctx.settings),
      },
    }).select("id").single();
    if (rowError || !row) {
      await bucket.remove(thumbKept ? [path, thumbPath] : [path]);
      return { ok: false, error: "storage_failed" };
    }
    return { ok: true, id: row.id, path };
  };
}

/** The grid copy: 640 px on the longer side, WebP (keeps a cutout's alpha). */
async function makeThumb(bytes: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(bytes, { failOn: "none" })
      .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer();
  } catch {
    return null;
  }
}

/* ── history ─────────────────────────────────────────────────────────────*/

/** One finished result, as a panel's gallery shows it. */
export type PhotoResult = {
  id: string;
  tool: PhotoToolSlug;
  url: string | null;
  /** The grid copy (640 px WebP), or null when there is none — then `url`. */
  thumbUrl: string | null;
  /** The photo it was made from, for the before/after comparison. */
  sourceUrl: string | null;
  /** Its storage path in the workspace's own folder — how a panel recognises
   *  the result of a request whose answer never reached it. */
  sourcePath: string | null;
  width: number | null;
  height: number | null;
  mime: string;
  bytes: number;
  createdAt: string;
  environment: "live" | "sandbox" | "local" | null;
  credits: number | null;
  settings: Record<string, string>;
  /** Photoroom's cutout uncertainty (0 confident … 1 unsure), when reported. */
  uncertainty: number | null;
};

export const HISTORY_PAGE = 24;

type Row = {
  id: string; tool_slug: string; storage_path: string; mime_type: string;
  file_size: number; created_at: string; metadata: unknown;
};

/** The newest results of ONE tool for this workspace, signed for an hour. */
export async function listPhotoResults(supabase: Client, workspaceId: string, tool: PhotoToolSlug, opts: {
  before?: string | null; limit?: number;
} = {}): Promise<{ items: PhotoResult[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? HISTORY_PAGE, 1), 48);
  let q = supabase.from("tool_results")
    .select("id, tool_slug, storage_path, mime_type, file_size, created_at, metadata")
    .eq("workspace_id", workspaceId).eq("tool_slug", tool)
    .order("created_at", { ascending: false }).limit(limit + 1);
  if (opts.before) q = q.lt("created_at", opts.before);
  const { data } = await q;
  const rows = ((data ?? []) as Row[]).filter((r) => isPhotoTool(r.tool_slug));
  const page = rows.slice(0, limit);
  const meta = (r: Row) => (r.metadata && typeof r.metadata === "object" ? r.metadata : {}) as Record<string, unknown>;

  const thumbOf = (r: Row) => {
    const t = meta(r).thumb;
    return typeof t === "string" && t.startsWith(`${workspaceId}/`) ? t : null;
  };
  const resultPaths = page.flatMap((r) => [r.storage_path, thumbOf(r)].filter((p): p is string => Boolean(p)));
  const sourcePaths = page.map((r) => meta(r).source_path).filter((p): p is string => typeof p === "string" && validSourcePath(p, workspaceId));
  const [results, sources] = await Promise.all([
    resultPaths.length ? supabase.storage.from(PHOTO_RESULT_BUCKET).createSignedUrls(resultPaths, 3600) : { data: [] },
    sourcePaths.length ? supabase.storage.from(PHOTO_SOURCE_BUCKET).createSignedUrls(sourcePaths, 3600) : { data: [] },
  ]);
  const signed = new Map<string, string>();
  for (const s of [...(results.data ?? []), ...(sources.data ?? [])]) {
    if (s.path && s.signedUrl) signed.set(s.path, s.signedUrl);
  }
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  const items = page.map((r): PhotoResult => {
    const m = meta(r);
    const env = m.environment;
    const unc = typeof m.uncertainty === "string" ? Number(m.uncertainty) : num(m.uncertainty);
    return {
      id: r.id,
      tool: r.tool_slug as PhotoToolSlug,
      url: signed.get(r.storage_path) ?? null,
      thumbUrl: (thumbOf(r) ? signed.get(thumbOf(r)!) : undefined) ?? signed.get(r.storage_path) ?? null,
      sourceUrl: typeof m.source_path === "string" ? signed.get(m.source_path) ?? null : null,
      sourcePath: typeof m.source_path === "string" && validSourcePath(m.source_path, workspaceId) ? m.source_path : null,
      width: num(m.width), height: num(m.height),
      mime: r.mime_type, bytes: r.file_size, createdAt: r.created_at,
      environment: env === "live" || env === "sandbox" || env === "local" ? env : null,
      credits: num(m.credits),
      settings: (m.settings && typeof m.settings === "object" ? m.settings : {}) as Record<string, string>,
      uncertainty: unc != null && Number.isFinite(unc) ? unc : null,
    };
  });
  return { items, nextCursor: rows.length > limit ? page[page.length - 1]?.created_at ?? null : null };
}
