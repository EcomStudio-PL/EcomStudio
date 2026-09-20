import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import {
  PREVIEW_EDGE, PREVIEW_QUALITY, THUMB_EDGE, THUMB_QUALITY, previewPathFor, thumbPathFor,
} from "@/lib/thumbs";

export const dynamic = "force-dynamic";
// sharp is a native module; it cannot run on the edge runtime.
export const runtime = "nodejs";

/**
 * BACKFILL ONE THUMBNAIL — for assets made before the generator wrote them.
 *
 * The library never blocks on this. It renders what it has (the original,
 * which is what it had to use before), and then asks for a derivative for the
 * few assets actually on screen that lack one, a handful at a time. The next
 * visit is fast, and a history nobody opens is never processed at all — which
 * is the whole reason this is a request rather than a migration job.
 *
 * WHAT MAKES IT SAFE. The original is read with the MEMBER'S OWN session, so
 * RLS decides what they may touch; an asset in another workspace 404s here
 * exactly as it would anywhere else. The row update goes through
 * `set_asset_derivatives` (0083), which re-checks membership in the database,
 * pins both paths into that workspace's own folder and can only merge those
 * two keys.
 *
 * It is idempotent: an asset that already has a thumb returns it untouched.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });

  const body = await request.json().catch(() => null) as { assetId?: unknown } | null;
  const assetId = typeof body?.assetId === "string" ? body.assetId : null;
  if (!assetId) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  // RLS does the authorising: this select returns nothing for an asset the
  // member cannot see, and the workspace is checked again below anyway.
  const { data: asset } = await supabase
    .from("generation_assets")
    .select("id, storage_path, asset_type, metadata, generations!inner(workspace_id)")
    .eq("id", assetId)
    .maybeSingle();
  if (!asset) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const owner = (asset.generations as unknown as { workspace_id: string } | null)?.workspace_id;
  if (owner !== workspace.id) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const existing = (asset.metadata as { thumb?: string } | null)?.thumb;
  if (existing) return NextResponse.json({ ok: true, path: existing, reused: true });
  // Only images have a derivative to make. A video's poster is written by
  // whatever produces the video; there is nothing to resize here.
  if (asset.asset_type !== "image") {
    return NextResponse.json({ ok: false, error: "not_an_image" }, { status: 400 });
  }

  const { data: file, error: dlError } = await supabase.storage
    .from("generation-assets").download(asset.storage_path);
  if (dlError || !file) return NextResponse.json({ ok: false, error: "download_failed" }, { status: 502 });

  let thumb: Buffer;
  let preview: Buffer;
  try {
    const { default: sharp } = await import("sharp");
    const source = Buffer.from(await file.arrayBuffer());
    const derive = (edge: number, quality: number) =>
      sharp(source, { failOn: "none" })
        .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
        // `.webp()` drops EXIF and every other ancillary chunk on the way out,
        // so the derivative carries no camera or prompt metadata.
        .webp({ quality })
        .toBuffer();
    [thumb, preview] = await Promise.all([
      derive(THUMB_EDGE, THUMB_QUALITY),
      derive(PREVIEW_EDGE, PREVIEW_QUALITY),
    ]);
  } catch {
    return NextResponse.json({ ok: false, error: "resize_failed" }, { status: 500 });
  }

  const path = thumbPathFor(asset.storage_path);
  const pPath = previewPathFor(asset.storage_path);
  // A derivative at a derived path never changes, so it may be held for a
  // year. The URL that reaches the browser is still a signed, expiring one —
  // this is what the CDN and the browser cache the BYTES under.
  const opts = {
    contentType: "image/webp", upsert: true,
    cacheControl: "31536000, immutable",
  } as const;
  const bucket = supabase.storage.from("generation-assets");
  const [upThumb, upPreview] = await Promise.all([
    bucket.upload(path, thumb, opts),
    bucket.upload(pPath, preview, opts),
  ]);
  if (upThumb.error) return NextResponse.json({ ok: false, error: "upload_failed" }, { status: 500 });

  const { error: rpcError } = await supabase.rpc("set_asset_derivatives", {
    asset_id: assetId, thumb_path: path, preview_path: upPreview.error ? null : pPath,
  });
  if (rpcError) {
    // The bytes are harmless on their own; without the row they are simply
    // never read, and the next attempt overwrites them.
    return NextResponse.json({ ok: false, error: "record_failed" }, { status: 500 });
  }

  const { data: signed } = await bucket.createSignedUrls([path, pPath], 3600);
  const urlFor = (p: string) => signed?.find((s) => s.path === p)?.signedUrl ?? null;
  return NextResponse.json({
    ok: true, path, url: urlFor(path),
    previewUrl: upPreview.error ? null : urlFor(pPath),
    bytes: thumb.length,
  });
}
