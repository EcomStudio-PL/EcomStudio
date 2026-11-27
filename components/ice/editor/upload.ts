"use client";
import { createClient } from "@/lib/supabase/client";
import { deriveMedia } from "@/lib/media-derive";
import { ICE_GIF_MIME, isIceMime, maxBytesFor, uploadMaxBytes, ICE_MAX_SAMPLE_BYTES, type IceMime } from "@/lib/ice/sniff";
import type { IceAsset, IceTransport } from "@/lib/ice/types";

/**
 * ONE FILE INTO THE LIBRARY, the editor's way:
 *
 *   1. the server hands out a fresh path (and refuses a format or size it
 *      will not take — checked again here first, to fail fast);
 *   2. the browser uploads straight to Storage (the file never passes through
 *      the app server; the bucket's own rules still apply);
 *   3. the server reads the stored file's first bytes and its real size, and
 *      only then makes it a library asset;
 *   4. pictures get their smaller copies (the same derive step every other
 *      uploader uses), and the asset is read back with its dimensions.
 *
 * The same library every other screen uses — no second store.
 */

export type UploadOutcome = { ok: true; asset: IceAsset } | { ok: false; error: string };

/** `gif`: the place being filled takes an animated GIF (a /home carousel
 *  tile) — everywhere else a GIF is refused here as before. */
export type UploadOpts = { sample?: boolean; kind?: "image" | "video"; gif?: boolean };

export function precheck(file: File, opts: UploadOpts = {}): string | null {
  const gif = file.type === ICE_GIF_MIME && Boolean(opts.gif) && !opts.sample;
  if (!gif && !isIceMime(file.type)) return "format";
  if (opts.kind && !file.type.startsWith(`${opts.kind}/`)) return "asset_kind";
  if (file.size > (opts.sample ? ICE_MAX_SAMPLE_BYTES : gif ? uploadMaxBytes(ICE_GIF_MIME) : maxBytesFor(file.type as IceMime))) return "too_large";
  return null;
}

export async function uploadOne(
  transport: IceTransport,
  file: File,
  opts: UploadOpts = {},
): Promise<UploadOutcome> {
  const early = precheck(file, opts);
  if (early) return { ok: false, error: early };
  try {
    const ticket = await transport.uploadTicket({ name: file.name, size: file.size, type: file.type });
    if (!ticket.ok) return { ok: false, error: ticket.error };
    if (transport.putFile) {
      if (!(await transport.putFile(ticket.data.path, file))) return { ok: false, error: "upload_failed" };
    } else {
      const supabase = createClient();
      const { error } = await supabase.storage.from("media").upload(ticket.data.path, file, {
        contentType: file.type, upsert: false, cacheControl: "3600",
      });
      if (error) return { ok: false, error: "upload_failed" };
    }
    const reg = await transport.registerUpload({ path: ticket.data.path, name: file.name });
    if (!reg.ok) return { ok: false, error: reg.error };
    let asset = reg.data;
    // A GIF keeps its animation only as itself: no still WebP copies (they
    // would land in its srcset and the page would paint a frozen frame).
    if (asset.kind === "image" && asset.mime !== ICE_GIF_MIME) {
      if (!transport.putFile) await deriveMedia(asset.id);
      const fresh = await transport.assets([asset.id]);
      if (fresh.ok && fresh.data[0]) asset = fresh.data[0];
    }
    return { ok: true, asset };
  } catch {
    return { ok: false, error: "network" };
  }
}
