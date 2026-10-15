"use client";
import { createClient } from "@/lib/supabase/client";
import { deriveMedia } from "@/lib/media-derive";
import { isIceMime, maxBytesFor, ICE_MAX_SAMPLE_BYTES } from "@/lib/ice/sniff";
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

export function precheck(file: File, opts: { sample?: boolean; kind?: "image" | "video" } = {}): string | null {
  if (!isIceMime(file.type)) return "format";
  if (opts.kind && !file.type.startsWith(`${opts.kind}/`)) return "asset_kind";
  if (file.size > (opts.sample ? ICE_MAX_SAMPLE_BYTES : maxBytesFor(file.type))) return "too_large";
  return null;
}

export async function uploadOne(
  transport: IceTransport,
  file: File,
  opts: { sample?: boolean; kind?: "image" | "video" } = {},
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
    if (asset.kind === "image") {
      if (!transport.putFile) await deriveMedia(asset.id);
      const fresh = await transport.assets([asset.id]);
      if (fresh.ok && fresh.data[0]) asset = fresh.data[0];
    }
    return { ok: true, asset };
  } catch {
    return { ok: false, error: "network" };
  }
}
