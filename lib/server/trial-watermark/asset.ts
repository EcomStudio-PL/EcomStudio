import "server-only";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import sharp from "sharp";

/**
 * THE GROVBASE TRIAL MARK — the exact PNG the owner supplied, byte for byte.
 *
 * It lives next to this module, OUTSIDE public/, so no URL serves it: it is
 * read from disk by the server only (next.config.mjs traces it into every
 * server function with outputFileTracingIncludes). Nothing redraws, re-fonts
 * or regenerates it: the file is checked against its sha256 and dimensions on
 * load, and a mismatch is an error — the caller then refuses to deliver the
 * image rather than deliver it clean.
 *
 * Every visible pixel of the asset is pure white; only its ALPHA carries the
 * logo, the line "Wygenerowano z użyciem" and grovbase.com. Both colour
 * variants (the original white and the dark one) are therefore built from
 * that alpha mask alone.
 */

export const TRIAL_WATERMARK_ASSET_PATH = "lib/server/trial-watermark/assets/grovbase-watermark.png";
export const TRIAL_WATERMARK_ASSET_SHA256 = "3360d4eb31580d26ef40ed5cb8c9ccae3f852dad6fffa2c634ed87da1e203146";
export const TRIAL_WATERMARK_ASSET_WIDTH = 3328;
export const TRIAL_WATERMARK_ASSET_HEIGHT = 1528;

export class TrialWatermarkAssetError extends Error {
  constructor(public readonly code: "asset_missing" | "asset_mismatch" | "asset_unreadable") {
    super(code);
  }
}

export type WatermarkMask = {
  /** One byte per pixel: the asset's alpha, 0..255. */
  alpha: Buffer;
  width: number;
  height: number;
};

let cached: Promise<WatermarkMask> | null = null;

async function load(): Promise<WatermarkMask> {
  let file: Buffer;
  try {
    file = readFileSync(path.join(process.cwd(), TRIAL_WATERMARK_ASSET_PATH));
  } catch {
    throw new TrialWatermarkAssetError("asset_missing");
  }
  if (createHash("sha256").update(file).digest("hex") !== TRIAL_WATERMARK_ASSET_SHA256) {
    throw new TrialWatermarkAssetError("asset_mismatch");
  }
  try {
    const meta = await sharp(file).metadata();
    if (meta.width !== TRIAL_WATERMARK_ASSET_WIDTH || meta.height !== TRIAL_WATERMARK_ASSET_HEIGHT || meta.channels !== 4) {
      throw new TrialWatermarkAssetError("asset_mismatch");
    }
    const { data, info } = await sharp(file).extractChannel(3).raw().toBuffer({ resolveWithObject: true });
    if (info.channels !== 1 || info.width !== TRIAL_WATERMARK_ASSET_WIDTH || info.height !== TRIAL_WATERMARK_ASSET_HEIGHT) {
      throw new TrialWatermarkAssetError("asset_mismatch");
    }
    return { alpha: data, width: info.width, height: info.height };
  } catch (e) {
    if (e instanceof TrialWatermarkAssetError) throw e;
    throw new TrialWatermarkAssetError("asset_unreadable");
  }
}

/** The asset's alpha mask, loaded and verified once per process. A failed load is retried next time. */
export function watermarkMask(): Promise<WatermarkMask> {
  if (!cached) {
    cached = load();
    cached.catch(() => { cached = null; });
  }
  return cached;
}

/** For the admin page: is the asset present and exactly the approved file? */
export async function watermarkAssetStatus(): Promise<{ ok: true; sha256: string; width: number; height: number } | { ok: false; code: string }> {
  try {
    const m = await watermarkMask();
    return { ok: true, sha256: TRIAL_WATERMARK_ASSET_SHA256, width: m.width, height: m.height };
  } catch (e) {
    return { ok: false, code: e instanceof TrialWatermarkAssetError ? e.code : "asset_unreadable" };
  }
}
