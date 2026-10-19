/**
 * THE LAUNCH PAGE'S BEFORE/AFTER GALLERIES — the stored shape and its rules.
 *
 * Each gallery (MINIATURKI, RETUSZ, MODA) is one CMS block of type
 * `launch_gallery` on the launch page: its list of pairs lives in the block's
 * content, so a pair added in the visual editor is a DRAFT until the page is
 * published, has a version in the page history, and can be rolled back — the
 * CMS's own draft → publish → version model, not a second one.
 *
 * A half is a picture from the media library (its public URL, which is what
 * every CMS block stores) plus an optional crop: a focal point and a zoom,
 * applied when the picture is painted. The file itself is never cropped.
 *
 * Shared by the server (validation on save), the renderer (what a visitor
 * sees) and the editor (what an admin may submit) — one definition of a valid
 * pair, so "incomplete pairs are never published" is checked in one place.
 */

export const GALLERY_KEYS = ["thumbs", "retouch", "fashion"] as const;
export type GalleryKey = (typeof GALLERY_KEYS)[number];
export const GALLERY_BLOCK_TYPE = "launch_gallery";

/** Sort order of each gallery's block, after the launch block (0). */
export const GALLERY_SORT: Record<GalleryKey, number> = { thumbs: 10, retouch: 20, fashion: 30 };

export const GALLERY_MAX_ITEMS = 40;
export const GALLERY_CAPTION_MAX = 160;
export const GALLERY_LOCALES = ["pl", "en", "de"] as const;
export type GalleryLocale = (typeof GALLERY_LOCALES)[number];

/** The frame of one half — the same bounds as the media slots' crop (0141). */
export type GalleryCrop = { x: number; y: number; zoom: number };
export type GalleryHalf = { url: string; crop?: GalleryCrop };
export type GalleryItem = {
  id: string;
  before: GalleryHalf | null;
  after: GalleryHalf | null;
  caption?: Partial<Record<GalleryLocale, string>>;
};
export type GalleryContent = { gallery: GalleryKey; items: GalleryItem[] };

export const isGalleryKey = (v: unknown): v is GalleryKey =>
  typeof v === "string" && (GALLERY_KEYS as readonly string[]).includes(v);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Control, bidi, zero-width and angle brackets — the same family 0141's
 *  content_text_ok refuses, so a caption can never smuggle markup or hide
 *  text from the person reviewing it. */
// eslint-disable-next-line no-control-regex
const BAD_TEXT_RE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿<>]/;

/** Only pictures from THIS project's public media bucket. */
export function mediaPublicPrefix(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/media/`;
}

function cleanCrop(input: unknown): GalleryCrop | undefined | null {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== "object") return null;
  const { x, y, zoom } = input as Record<string, unknown>;
  if (typeof x !== "number" || typeof y !== "number" || typeof zoom !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) return null;
  if (x < 0 || x > 100 || y < 0 || y > 100 || zoom < 1 || zoom > 2.5) return null;
  const r = (n: number) => Math.round(n * 100) / 100;
  return { x: r(x), y: r(y), zoom: r(zoom) };
}

function cleanHalf(input: unknown, prefix: string | null): GalleryHalf | null | "invalid" {
  if (input === null || input === undefined) return null;
  if (typeof input !== "object") return "invalid";
  const { url, crop } = input as Record<string, unknown>;
  if (typeof url !== "string" || url.length === 0 || url.length > 1024) return "invalid";
  if (prefix !== null && (!url.startsWith(prefix) || url.length === prefix.length || url.includes(".."))) return "invalid";
  const c = cleanCrop(crop);
  if (c === null) return "invalid";
  return c ? { url, crop: c } : { url };
}

function cleanCaption(input: unknown): Partial<Record<GalleryLocale, string>> | undefined | "invalid" {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== "object") return "invalid";
  const out: Partial<Record<GalleryLocale, string>> = {};
  for (const locale of GALLERY_LOCALES) {
    const v = (input as Record<string, unknown>)[locale];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v !== "string") return "invalid";
    const t = v.trim();
    if (t.length > GALLERY_CAPTION_MAX || BAD_TEXT_RE.test(t)) return "invalid";
    if (t) out[locale] = t;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export type GalleryValidation =
  | { ok: true; items: GalleryItem[] }
  | { ok: false; error: "too_many" | "bad_item" | "duplicate_id"; index?: number };

/**
 * STRICT: what a save may store. `prefix` = mediaPublicPrefix(SUPABASE_URL);
 * every half must be one of this project's public media files. Incomplete
 * pairs ARE allowed here — a draft may hold a pair whose second half is not
 * chosen yet; publishing and rendering are what refuse them.
 */
export function validateGalleryItems(input: unknown, prefix: string): GalleryValidation {
  if (!Array.isArray(input)) return { ok: false, error: "bad_item" };
  if (input.length > GALLERY_MAX_ITEMS) return { ok: false, error: "too_many" };
  const seen = new Set<string>();
  const items: GalleryItem[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i] as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") return { ok: false, error: "bad_item", index: i };
    const id = typeof raw.id === "string" ? raw.id : "";
    if (!UUID_RE.test(id)) return { ok: false, error: "bad_item", index: i };
    if (seen.has(id.toLowerCase())) return { ok: false, error: "duplicate_id", index: i };
    seen.add(id.toLowerCase());
    const before = cleanHalf(raw.before, prefix);
    const after = cleanHalf(raw.after, prefix);
    const caption = cleanCaption(raw.caption);
    if (before === "invalid" || after === "invalid" || caption === "invalid") return { ok: false, error: "bad_item", index: i };
    items.push({ id: id.toLowerCase(), before, after, ...(caption ? { caption } : {}) });
  }
  return { ok: true, items };
}

/**
 * LENIENT: what a renderer reads out of a stored block. Anything malformed is
 * skipped rather than fatal — a broken item must not take the page down — and
 * no URL prefix is enforced here (the save path already did).
 */
export function readGalleryContent(content: unknown): GalleryContent | null {
  if (!content || typeof content !== "object") return null;
  const { gallery, items } = content as Record<string, unknown>;
  if (!isGalleryKey(gallery)) return null;
  const out: GalleryItem[] = [];
  if (Array.isArray(items)) {
    for (const raw of items.slice(0, GALLERY_MAX_ITEMS)) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const id = typeof r.id === "string" && UUID_RE.test(r.id) ? r.id.toLowerCase() : null;
      if (!id) continue;
      const before = cleanHalf(r.before, null);
      const after = cleanHalf(r.after, null);
      const caption = cleanCaption(r.caption);
      out.push({
        id,
        before: before === "invalid" ? null : before,
        after: after === "invalid" ? null : after,
        ...(caption && caption !== "invalid" ? { caption } : {}),
      });
    }
  }
  return { gallery, items: out };
}

/** Both halves chosen — the only kind of pair a visitor ever sees. */
export const isCompletePair = (item: GalleryItem): boolean => Boolean(item.before?.url && item.after?.url);

/** Indexes of incomplete pairs (1-based for messages). */
export function incompletePairs(items: readonly GalleryItem[]): number[] {
  const out: number[] = [];
  items.forEach((item, i) => { if (!isCompletePair(item)) out.push(i + 1); });
  return out;
}

/** The caption in the viewer's language, falling back the way the launch copy does. */
export function captionFor(item: GalleryItem, locale: string): string {
  const c = item.caption ?? {};
  return (c[locale as GalleryLocale] ?? c.pl ?? c.en ?? "").trim();
}
