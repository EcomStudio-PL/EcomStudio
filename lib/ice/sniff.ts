/**
 * WHAT A FILE REALLY IS — read from its first bytes, never from its name or
 * the type the browser claimed. The visual editor accepts exactly these six
 * formats; anything else (a renamed HEIC, a QuickTime clip, a GIF, an SVG) is
 * refused before it becomes a library asset.
 */

export type IceMime = "image/jpeg" | "image/png" | "image/webp" | "image/avif" | "video/mp4" | "video/webm";

export const ICE_IMAGE_MIMES: readonly IceMime[] = ["image/jpeg", "image/png", "image/webp", "image/avif"];
export const ICE_VIDEO_MIMES: readonly IceMime[] = ["video/mp4", "video/webm"];

/** 15 MB for a picture, 50 MB for a clip (the bucket's own ceiling). */
export const ICE_MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const ICE_MAX_VIDEO_BYTES = 50 * 1024 * 1024;
/** A sample photo is handed to a tool, whose own upload takes ≤ 10 MiB. */
export const ICE_MAX_SAMPLE_BYTES = 10 * 1024 * 1024;

export function isIceMime(value: unknown): value is IceMime {
  return typeof value === "string" && (ICE_IMAGE_MIMES as readonly string[]).concat(ICE_VIDEO_MIMES).includes(value);
}

export function kindOf(mime: IceMime): "image" | "video" {
  return mime.startsWith("video/") ? "video" : "image";
}

export function maxBytesFor(mime: IceMime): number {
  return kindOf(mime) === "video" ? ICE_MAX_VIDEO_BYTES : ICE_MAX_IMAGE_BYTES;
}

const ascii = (b: Uint8Array, from: number, len: number) =>
  String.fromCharCode(...Array.from(b.subarray(from, from + len)));

const MP4_BRANDS = new Set(["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "dash", "M4V ", "MSNV"]);

/** The format of the bytes, or null when it is none of the six. */
export function sniff(bytes: Uint8Array): IceMime | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => bytes[i] === v)) return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (ascii(bytes, 4, 4) === "ftyp") {
    const major = ascii(bytes, 8, 4);
    if (major === "avif" || major === "avis") return "image/avif";
    // Compatible brands follow the minor version (bytes 12–15), four by four,
    // up to the box size.
    const boxSize = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
    const end = Math.min(bytes.length, boxSize > 0 ? boxSize : bytes.length);
    const compatible: string[] = [];
    for (let i = 16; i + 4 <= end; i += 4) compatible.push(ascii(bytes, i, 4));
    if (major === "mif1" || major === "msf1") return compatible.includes("avif") || compatible.includes("avis") ? "image/avif" : null;
    if (MP4_BRANDS.has(major)) return "video/mp4";
    return null;
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    // EBML: WebM declares its DocType early; a plain Matroska file is refused.
    return ascii(bytes, 0, Math.min(bytes.length, 64)).includes("webm") ? "video/webm" : null;
  }
  return null;
}

/** A safe object name: letters, digits, dot, dash, underscore; ≤ 80. */
export function safeName(name: string): string {
  const base = name.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[._]+/, "").slice(-80);
  return base || "plik";
}
