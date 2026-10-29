import "server-only";
import { createHash } from "node:crypto";
import type { Client } from "@/lib/services/workspace";
import type { ReferenceImage } from "@/lib/ai/types";
import { prepareReferenceImage, type PreparedReference } from "@/lib/server/reference-image";
import type { Pixels } from "@/lib/grovshot-v2/color";

/**
 * GROVBASE SHOT V2 — the order's photos, by their BYTES.
 *
 * A storage path is not an identity: a member may replace the object at the
 * same path. So every photo is hashed when the order starts; every later
 * read (the card on a cache hit, each shot's references, QC, a resumed
 * invocation) is checked against that hash and refused on a mismatch BEFORE
 * any paid call (`reference_changed`).
 *
 * Three shapes of the same photo:
 *   · for Nano Banana Pro — the stored original through prepareReferenceImage
 *     (the one rule every image path follows; never cropped or resized);
 *   · for the vision stages — a downscaled JPEG (long edge 1536): the model
 *     reads the product, and a smaller image keeps the call fast and cheap;
 *   · for the colour check — raw RGB at 512 px, oriented like the vision copy
 *     so the boxes the models drew land on the same pixels.
 */

/** One photo of the order, as stored. */
export type OrderPhoto = { number: number; path: string; bytes: Buffer; sha256: string };

const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const VISION_EDGE = 1536;
const PIXEL_EDGE = 512;

export const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

export type PhotoRead = { ok: true; photos: OrderPhoto[] } | { ok: false; error: "photo_unreadable" | "photo_too_large" | "reference_changed" };

/**
 * Read the order's photos in order (numbering = upload order). `expected`
 * shas, when given, must match byte for byte.
 */
export async function readOrderPhotos(
  supabase: Client, paths: readonly string[], expected?: readonly string[] | null,
  only?: readonly number[],
): Promise<PhotoRead> {
  const wanted = (only ?? paths.map((_, i) => i + 1)).filter((n) => n >= 1 && n <= paths.length);
  const out: OrderPhoto[] = [];
  // Read concurrently, kept in the order asked for: the numbering is the
  // order the photos are SENT in, never the order the reads finished in.
  const reads = await Promise.all(wanted.map(async (n) => {
    const path = paths[n - 1];
    try {
      const { data, error } = await supabase.storage.from("product-images").download(path);
      if (error || !data) return { n, error: "photo_unreadable" as const };
      const bytes = Buffer.from(await data.arrayBuffer());
      if (bytes.length > MAX_PHOTO_BYTES) return { n, error: "photo_too_large" as const };
      return { n, photo: { number: n, path, bytes, sha256: sha256(bytes) } };
    } catch {
      return { n, error: "photo_unreadable" as const };
    }
  }));
  for (const r of reads) {
    if ("error" in r && r.error) return { ok: false, error: r.error };
    const p = (r as { photo: OrderPhoto }).photo;
    if (expected && expected[p.number - 1] !== p.sha256) return { ok: false, error: "reference_changed" };
    out.push(p);
  }
  return { ok: true, photos: out };
}

/** The photo as Nano Banana Pro receives it (the shared reference rule). */
export async function forImageModel(p: OrderPhoto): Promise<PreparedReference> {
  return prepareReferenceImage(p.bytes, p.path);
}

/** A downscaled, oriented JPEG for a vision stage. Falls back to the stored
 *  bytes when they cannot be decoded (the provider then decides). */
export async function forVision(bytes: Buffer, mimeHint = "image/jpeg"): Promise<ReferenceImage> {
  try {
    const { default: sharp } = await import("sharp");
    const out = await sharp(bytes, { failOn: "none" }).rotate()
      .resize({ width: VISION_EDGE, height: VISION_EDGE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer();
    return { base64: out.toString("base64"), mime: "image/jpeg" };
  } catch {
    return { base64: bytes.toString("base64"), mime: mimeHint };
  }
}

/** Raw RGB pixels for the colour check, oriented like `forVision`. */
export async function pixelsOf(bytes: Buffer): Promise<Pixels | null> {
  try {
    const { default: sharp } = await import("sharp");
    const { data, info } = await sharp(bytes, { failOn: "none" }).rotate()
      .resize({ width: PIXEL_EDGE, height: PIXEL_EDGE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, channels: info.channels };
  } catch {
    return null;
  }
}

/** Width/height of an image (null when unreadable). */
export async function dimensionsOf(bytes: Buffer): Promise<{ width: number | null; height: number | null }> {
  try {
    const { default: sharp } = await import("sharp");
    const m = await sharp(bytes, { failOn: "none" }).metadata();
    return { width: m.width ?? null, height: m.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}
