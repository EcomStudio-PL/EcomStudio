"use client";
import type { IceAsset, IceTransport } from "@/lib/ice/types";
import { uploadOne } from "./upload";

/**
 * A STILL FOR A CLIP OR AN ANIMATED GIF, made once in the admin's browser
 * (27.11.2026) — the first frame the browser can decode, drawn onto a canvas
 * (HTMLVideoElement / <img> + Canvas: no library, no server conversion),
 * uploaded to the SAME library as an ordinary JPEG, and assigned as the slot's
 * poster (poster_media_id) when the slot is saved. It is a library file like
 * any other: generated when the file is chosen, never again on a page view.
 *
 * A file the browser cannot decode (a codec it lacks, a cross-origin file
 * without CORS) is an ERROR the panel shows — never an empty or black poster
 * saved quietly; the admin can then pick a poster from the library.
 */

const MAX_WIDTH = 1920;
const TIMEOUT_MS = 20_000;

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const scale = w > MAX_WIDTH ? MAX_WIDTH / w : 1;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  return c;
}

function toJpeg(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b && b.size > 0 ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.88);
  });
}

function withTimeout<R>(p: Promise<R>): Promise<R> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS);
    p.then((v) => { clearTimeout(id); resolve(v); }, (e) => { clearTimeout(id); reject(e); });
  });
}

/** The first decodable frame of a clip. */
async function videoFrame(src: string, crossOrigin: boolean): Promise<Blob> {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  if (crossOrigin) v.crossOrigin = "anonymous";
  try {
    await withTimeout(new Promise<void>((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = () => reject(new Error("decode"));
      v.src = src;
    }));
    // A hair past 0: some encoders leave frame 0 black or empty until the
    // first keyframe is presented; seeking makes the browser present one.
    await withTimeout(new Promise<void>((resolve, reject) => {
      v.onseeked = () => resolve();
      v.onerror = () => reject(new Error("decode"));
      v.currentTime = Math.min(0.05, Number.isFinite(v.duration) ? v.duration / 2 : 0.05);
    }));
    if (!v.videoWidth || !v.videoHeight) throw new Error("decode");
    const c = canvasOf(v.videoWidth, v.videoHeight);
    c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
    return await toJpeg(c);
  } finally {
    v.removeAttribute("src");
    v.load();
  }
}

/** The first frame of an animated GIF (drawImage paints an animated image's
 *  first frame). */
async function gifFrame(src: string, crossOrigin: boolean): Promise<Blob> {
  const img = new Image();
  if (crossOrigin) img.crossOrigin = "anonymous";
  img.src = src;
  await withTimeout(img.decode());
  if (!img.naturalWidth || !img.naturalHeight) throw new Error("decode");
  const c = canvasOf(img.naturalWidth, img.naturalHeight);
  c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
  return toJpeg(c);
}

/**
 * Makes and uploads the still of `asset` (a clip, or a GIF). `file` is the
 * uploaded file itself when there is one (read locally — no download); a
 * library file is read from its URL.
 */
export async function makeStill(
  transport: IceTransport,
  asset: IceAsset,
  file?: File,
): Promise<{ ok: true; poster: IceAsset } | { ok: false; error: string }> {
  const local = file ? URL.createObjectURL(file) : null;
  try {
    const src = local ?? asset.url;
    const blob = asset.kind === "video" ? await videoFrame(src, !local) : await gifFrame(src, !local);
    const base = (asset.title ?? "plik").replace(/\.[a-zA-Z0-9]{2,5}$/, "").slice(0, 60) || "plik";
    const still = new File([blob], `${base}-poster.jpg`, { type: "image/jpeg" });
    const up = await uploadOne(transport, still, { kind: "image" });
    return up.ok ? { ok: true, poster: up.asset } : { ok: false, error: up.error };
  } catch {
    return { ok: false, error: "poster_failed" };
  } finally {
    if (local) URL.revokeObjectURL(local);
  }
}
