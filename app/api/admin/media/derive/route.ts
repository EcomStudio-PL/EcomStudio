import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
// sharp is a native module; it cannot run on the edge runtime.
export const runtime = "nodejs";

/**
 * SMALLER COPIES OF A MEDIA IMAGE, AND ITS TRUE SIZE.
 *
 * The brief is blunt about this: a marketing page must not hand a 2400px
 * original to a 390px phone, and it must not shift its layout while the
 * pictures land. Both need facts the upload alone does not provide, so this
 * route reads the file back once and records:
 *
 *   WIDTH AND HEIGHT — so the renderer can print them and the browser can
 *   reserve the box. This is the whole of the CLS story for a CMS page.
 *
 *   THREE WEBP VARIANTS at 640 / 1024 / 1600, stored ALONGSIDE the original
 *   under `_w<width>.webp`. The original is never touched, never replaced and
 *   never downgraded — it stays the `src` and the largest candidate, which is
 *   what "nie pogarszaj pliku użytkownika" means in practice.
 *
 * Called once per upload, after the file has landed, so nothing waits on it.
 * An image narrower than a variant is skipped rather than upscaled: blowing a
 * 480px logo up to 1600 makes a bigger file that looks worse.
 *
 * ADMIN ONLY, TWICE: the role is checked here, and the `media_assets` write
 * goes through the caller's own client, where 0085's `is_admin()` policy is
 * the thing that actually decides.
 */

const VARIANTS = [640, 1024, 1600] as const;
const QUALITY = 78;
/** Past this, resizing in a request is the wrong place to do it. */
const MAX_BYTES = 30 * 1024 * 1024;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as { assetId?: unknown } | null;
  const assetId = typeof body?.assetId === "string" ? body.assetId : null;
  if (!assetId) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const { data: asset } = await supabase.from("media_assets")
    .select("id, kind, storage_path, size_bytes, width, variants")
    .eq("id", assetId).maybeSingle();
  if (!asset) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  // An external URL is somebody else's file; we do not copy or re-host it.
  if (!asset.storage_path) return NextResponse.json({ ok: false, error: "not_stored" }, { status: 400 });
  if (asset.kind !== "image") return NextResponse.json({ ok: false, error: "not_an_image" }, { status: 400 });
  if ((asset.size_bytes ?? 0) > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "too_large" }, { status: 413 });
  }
  // Idempotent: an asset that already has both facts is left alone.
  const hasVariants = asset.variants && Object.keys(asset.variants as object).length > 0;
  if (asset.width && hasVariants) return NextResponse.json({ ok: true, reused: true });

  const bucket = supabase.storage.from("media");
  const { data: file, error: dlError } = await bucket.download(asset.storage_path);
  if (dlError || !file) return NextResponse.json({ ok: false, error: "download_failed" }, { status: 502 });

  let width = 0;
  let height = 0;
  const made: { edge: number; buffer: Buffer }[] = [];
  try {
    const { default: sharp } = await import("sharp");
    const source = Buffer.from(await file.arrayBuffer());
    const meta = await sharp(source, { failOn: "none" }).metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;

    for (const edge of VARIANTS) {
      // Never upscale. A copy wider than the original is bigger AND worse.
      if (width && edge >= width) continue;
      const buffer = await sharp(source, { failOn: "none" })
        .resize({ width: edge, withoutEnlargement: true })
        // `.webp()` drops EXIF on the way out, so a derivative carries no
        // camera, location or authoring metadata onto a public page.
        .webp({ quality: QUALITY })
        .toBuffer();
      made.push({ edge, buffer });
    }
  } catch {
    return NextResponse.json({ ok: false, error: "resize_failed" }, { status: 500 });
  }

  // A derivative at a derived path never changes, so it may be cached for a
  // year. The `media` bucket is public, so this is the URL the browser keeps.
  const opts = {
    contentType: "image/webp", upsert: true,
    cacheControl: "31536000, immutable",
  } as const;

  const variants: Record<string, string> = {};
  for (const { edge, buffer } of made) {
    const path = variantPath(asset.storage_path, edge);
    const { error } = await bucket.upload(path, buffer, opts);
    // One failed size is not a failed upload: the others still help, and the
    // original is always there as the fallback candidate.
    if (error) continue;
    variants[String(edge)] = bucket.getPublicUrl(path).data.publicUrl;
  }
  // The original is the largest candidate, so a browser choosing by width has
  // something to pick when the viewport is wide.
  if (width) variants[String(width)] = bucket.getPublicUrl(asset.storage_path).data.publicUrl;

  const { error: saveError } = await supabase.from("media_assets").update({
    width: width || null,
    height: height || null,
    variants: variants as never,
    updated_at: new Date().toISOString(),
  }).eq("id", assetId);
  if (saveError) return NextResponse.json({ ok: false, error: "record_failed" }, { status: 500 });

  return NextResponse.json({ ok: true, width, height, variants: Object.keys(variants).length });
}

/** `1737-photo.jpg` → `1737-photo_w640.webp`, beside the original. */
function variantPath(path: string, edge: number): string {
  const dot = path.lastIndexOf(".");
  const stem = dot > 0 ? path.slice(0, dot) : path;
  return `${stem}_w${edge}.webp`;
}
