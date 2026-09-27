import "server-only";
import { createHash } from "node:crypto";
import type { ReferenceImage } from "@/lib/ai/types";

/**
 * THE PHOTO A MODEL RECEIVES — the stored original, untouched.
 *
 * Every image an image model is given (Retusz's source, the generator's
 * product references, a Workflow step's input) passes through here, so the
 * rule lives in one place: the bytes the customer uploaded are sent as they
 * are — no resize, no crop, no square, no recompression, no thumbnail. The
 * MIME type is read from the bytes, not guessed from the file name.
 *
 * Exactly two cases are changed, both only so the model sees the SAME picture
 * the customer sees, and both are recorded on the result:
 *   exif_orientation  the file is stored sideways with an EXIF "rotate me"
 *                     flag. The rotation is baked in (JPEG at quality 100 /
 *                     4:4:4, PNG and WebP losslessly) so a provider that
 *                     ignores EXIF does not edit a sideways photo.
 *   transcoded_png    a format the provider does not accept (AVIF, GIF, TIFF)
 *                     is decoded and sent as lossless PNG — same pixels,
 *                     same dimensions.
 */

export type ReferenceTransform = "none" | "exif_orientation" | "transcoded_png";

export type PreparedReference = ReferenceImage & {
  /** sha256 of the bytes as stored (what the customer uploaded). */
  sourceSha256: string;
  /** sha256 of the bytes actually sent — equal to sourceSha256 when untouched. */
  sha256: string;
  bytes: number;
  width: number | null;
  height: number | null;
  transform: ReferenceTransform;
};

const SENDABLE: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function mimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
}

export async function prepareReferenceImage(stored: Buffer, name: string): Promise<PreparedReference> {
  const sourceSha256 = sha(stored);
  const untouched = (mime: string, width: number | null, height: number | null): PreparedReference => ({
    base64: stored.toString("base64"), mime, sourceSha256, sha256: sourceSha256,
    bytes: stored.length, width, height, transform: "none",
  });

  const { default: sharp } = await import("sharp");
  let meta: { format?: string; orientation?: number; width?: number; height?: number };
  try {
    meta = await sharp(stored, { failOn: "none" }).metadata();
  } catch {
    // Unreadable to sharp: send what was stored; the provider decides.
    return untouched(mimeFromName(name), null, null);
  }

  const orientation = meta.orientation ?? 1;
  const w = meta.width ?? null;
  const h = meta.height ?? null;
  const known = meta.format ? SENDABLE[meta.format] : undefined;

  // The normal case: a JPEG, PNG or WebP shown the way it is stored.
  if (known && orientation <= 1) return untouched(known, w, h);

  try {
    const pipeline = sharp(stored, { failOn: "none" }).rotate();
    let out: Buffer;
    let mime: string;
    let transform: ReferenceTransform;
    if (known) {
      transform = "exif_orientation";
      mime = known;
      out = meta.format === "jpeg"
        ? await pipeline.jpeg({ quality: 100, chromaSubsampling: "4:4:4" }).toBuffer()
        : meta.format === "webp"
          ? await pipeline.webp({ lossless: true }).toBuffer()
          : await pipeline.png().toBuffer();
    } else {
      transform = "transcoded_png";
      mime = "image/png";
      out = await pipeline.png().toBuffer();
    }
    const outMeta = await sharp(out).metadata();
    const outSha = sha(out);
    return {
      base64: out.toString("base64"), mime, sourceSha256, sha256: outSha, bytes: out.length,
      width: outMeta.width ?? null, height: outMeta.height ?? null, transform,
    };
  } catch {
    return untouched(known ?? mimeFromName(name), w, h);
  }
}

/** What the admin/trace records about one sent image — never the bytes. */
export function referenceFingerprint(r: PreparedReference) {
  return {
    mime: r.mime, bytes: r.bytes, width: r.width, height: r.height,
    source_sha256: r.sourceSha256, sent_sha256: r.sha256, transform: r.transform,
  };
}
