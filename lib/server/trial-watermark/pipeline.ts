import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Client } from "@/lib/services/workspace";
import { parseTrialWatermarkConfig, type TrialWatermarkConfig } from "@/lib/trial-watermark/config";
import { newOriginalKey, openOriginal, sealOriginal } from "./crypto";
import { unwrapOriginalKey, wrapOriginalKey } from "./keys";
import {
  rpcAttach, rpcDecide, rpcMarkPurged, rpcRelease, rpcReserve, rpcSource,
  type DecideReply, type ReserveArgs, type RpcResult, type SourceReply, type TrialMode, type TrialReason, type TrialRpcClient,
} from "./rpc";
import type { TrialWatermarkInfo } from "./engine";

/**
 * TRIAL WATERMARK — what a PRODUCER does with it (generation.ts, Miniaturka,
 * the paid tools' and Workflow ON's refusals).
 *
 *   decide   once per run, BEFORE anything is inserted or charged: off, paid
 *            (clean output) or trial (marked output, clean original kept).
 *            The database decides; nothing here guesses. A decision that
 *            cannot be had is an error, never "off" — except a null answer
 *            off production, which is what the frozen test fakes give.
 *   seal     the marked file, from the exact bytes that would otherwise be
 *            stored. The engine (sharp + the asset) is loaded here, on the
 *            trial branch only.
 *   stash    the clean bytes, sealed under a key of their own, into the
 *            private `trial-originals` bucket next to a `pending` row.
 *   attach   the row bound to the library asset that shows the marked file
 *            (`locked`). A failed attach is healed by the database's sweep.
 *   release  a stash whose image was not delivered: the row orphaned, its key
 *            destroyed, the blob removed.
 *
 * Anything that fails on the trial branch means THE IMAGE IS NOT DELIVERED
 * (the caller skips it and refunds) — never "delivered clean".
 */

export const TRIAL_ORIGINALS_BUCKET = "trial-originals";

export type TrialDecision = {
  mode: TrialMode;
  /** The database's reason, stamped on the run's usage row. "unavailable" =
   *  no decision function answered (outside production only). */
  reason: TrialReason | "unavailable";
  config: TrialWatermarkConfig;
};
export type TrialDecisionResult = TrialDecision | { error: "trial_check_failed" };

/**
 * Errors worth one more try: the request never got a real answer (network,
 * a gateway page instead of JSON) or Postgres gave up for a reason that is
 * not about this call (connection, timeout, serialisation, deadlock, load).
 * A missing function, a refusal or a malformed answer is final.
 */
const TRANSIENT_CODES = new Set([
  "08000", "08001", "08003", "08004", "08006", "57014", "57P01", "40001", "40P01", "53300",
  "PGRST000", "PGRST001", "PGRST002", "PGRST003",
]);
function transient(r: { ok: false; error: string; code?: string }): boolean {
  if (r.error.startsWith("malformed_")) return false;
  return !r.code || TRANSIENT_CODES.has(r.code);
}

/** One more try, on a transient error only. */
async function retryTransient<T>(attempt: () => Promise<RpcResult<T>>): Promise<RpcResult<T>> {
  const first = await attempt();
  return first.ok || !transient(first) ? first : attempt();
}

/**
 * THE DECISION — fail closed (R2).
 *
 *   · an RPC error of any kind (a missing function included), after one more
 *     try on a transient one → `trial_check_failed`;
 *   · a malformed answer (not an object, a mode outside off/paid/trial) → the
 *     same;
 *   · a null answer → `off` only outside production (VERCEL_ENV), else the
 *     same. The SQL never answers null; only a test fake does.
 */
export async function decideTrialWatermark(
  supabase: TrialRpcClient, a: { workspaceId: string; credits: number },
): Promise<TrialDecisionResult> {
  const credits = Math.max(0, Math.trunc(a.credits) || 0);
  const r: RpcResult<DecideReply | null> = await retryTransient(() => rpcDecide(supabase, a.workspaceId, credits));
  if (!r.ok) {
    console.error("[trial-watermark] decision unavailable", r.code ?? r.error);
    return { error: "trial_check_failed" };
  }
  if (r.data === null) {
    if (process.env.VERCEL_ENV === "production") {
      console.error("[trial-watermark] decision unavailable", "null_decide");
      return { error: "trial_check_failed" };
    }
    return { mode: "off", reason: "unavailable", config: parseTrialWatermarkConfig(null) };
  }
  return { mode: r.data.mode, reason: r.data.reason, config: parseTrialWatermarkConfig(r.data.config) };
}

/** The usage-row stamp of a decision (server-built metadata, never forgeable). */
export function trialStamp(d: TrialDecision): { trial_watermark: TrialMode; trial_watermark_reason: string } {
  return { trial_watermark: d.mode, trial_watermark_reason: d.reason };
}

/* ── the marked file ───────────────────────────────────────────────────── */

export type TrialMarked = {
  bytes: Buffer;
  mime: string;
  sha256: string;
  /** The mark actually drawn (variant, luminance, sizes). Kept on the
   *  original's own row only — never on a member-readable job record. */
  info: TrialWatermarkInfo;
  /** The clean file's format as sharp read it (the marked file keeps it). */
  cleanMime: string;
};

const MIME: Record<TrialWatermarkInfo["format"], string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/**
 * The watermarked version of `clean` — same format, same upright size. Null
 * when it cannot be made (unsupported format, unreadable file, missing or
 * altered asset): the caller then does not deliver the image at all.
 */
export async function sealTrialOutput(clean: Buffer, config: TrialWatermarkConfig): Promise<TrialMarked | null> {
  try {
    // Loaded on the trial branch only: an off or paid run never touches the
    // engine or reads the asset.
    const { applyTrialWatermark } = await import("./engine");
    const out = await applyTrialWatermark(clean, config);
    return { bytes: out.bytes, mime: out.mime, sha256: sha256(out.bytes), info: out.info, cleanMime: MIME[out.info.format] };
  } catch (e) {
    console.error("[trial-watermark] mark not made", e instanceof Error ? e.message : "error");
    return null;
  }
}

/* ── the clean original ────────────────────────────────────────────────── */

export type TrialStash = { originalId: string; objectPath: string };

/**
 * `trial_original_reserve` WITH THE ORIGINAL'S ID CHOSEN HERE (rpc.ts
 * `rpcReserve`, `p_id`).
 *
 * The key wrap (keys.ts, AAD "GBWK1|id") and the blob's own authentication
 * (crypto.ts, AAD "GBWM1|ws|id") both bind to the original's id, and both
 * have to exist before the row does: the row stores the wrapped key. So the
 * id is a fresh UUID made by the server; the answer must name the same id and
 * an object path inside the workspace, or the row is released and the image
 * not delivered.
 */
async function reserveOriginal(supabase: Client, a: ReserveArgs): Promise<RpcResult<{ id: string; objectPath: string }>> {
  const r = await rpcReserve(supabase, a);
  return r.ok ? { ok: true, data: { id: r.data.id, objectPath: r.data.objectPath } } : r;
}

/**
 * Keep the CLEAN bytes of a trial image: sealed (AES-256-GCM, a key of their
 * own, wrapped under the server's key), reserved as a `pending` row, uploaded
 * to `trial-originals` at the path the database chose (never over an
 * existing object). Null when any of it fails — the row is released and the
 * blob removed, and the caller does not deliver the image.
 */
export async function stashTrialOriginal(supabase: Client, a: {
  workspaceId: string; jobId: string | null; operation: string;
  /** The library path the marked file will get; null when it is chosen later (Miniaturka). */
  markedPath: string | null;
  clean: Buffer; marked: TrialMarked;
}): Promise<TrialStash | null> {
  const originalId = randomUUID();
  let wrapped: { wrapped: string; fingerprint: string };
  let blob: Buffer;
  try {
    const dek = newOriginalKey();
    wrapped = wrapOriginalKey(dek, originalId);
    blob = sealOriginal(a.clean, dek, a.workspaceId, originalId);
    dek.fill(0);
  } catch (e) {
    // No server key: nothing could ever open it again — not delivered.
    console.error("[trial-watermark] original not sealed", e instanceof Error ? e.message : "error");
    return null;
  }
  const reserved = await reserveOriginal(supabase, {
    id: originalId, workspaceId: a.workspaceId, jobId: a.jobId, operation: a.operation, markedPath: a.markedPath,
    wrappedKey: wrapped.wrapped, kekFingerprint: wrapped.fingerprint,
    cleanSha256: sha256(a.clean), cleanMime: a.marked.cleanMime, cleanBytes: a.clean.length,
    width: a.marked.info.width, height: a.marked.info.height,
    watermark: a.marked.info as unknown as Record<string, unknown>,
  });
  if (!reserved.ok) {
    console.error("[trial-watermark] original not reserved", reserved.code ?? reserved.error);
    return null;
  }
  const { id, objectPath } = reserved.data;
  if (id !== originalId || !objectPath.startsWith(`${a.workspaceId}/`) || objectPath.includes("..")) {
    await releaseTrialOriginal(supabase, id);
    return null;
  }
  let uploaded = false;
  try {
    const { error } = await supabase.storage.from(TRIAL_ORIGINALS_BUCKET)
      .upload(objectPath, blob, { contentType: "application/octet-stream", upsert: false });
    uploaded = !error;
  } catch {
    uploaded = false;
  }
  if (!uploaded) {
    await releaseTrialOriginal(supabase, originalId, objectPath);
    return null;
  }
  return { originalId, objectPath };
}

/** Bind the stash to the library asset showing the marked file (→ locked).
 *  False on any refusal; the database's sweep heals a pending row whose
 *  marked file is in the library. */
export async function attachTrialOriginal(supabase: TrialRpcClient, a: {
  originalId: string; assetId: string; markedPath: string; markedSha256: string;
}): Promise<boolean> {
  const r = await rpcAttach(supabase, a.originalId, a.assetId, a.markedPath, a.markedSha256);
  if (!r.ok) console.error("[trial-watermark] original not attached", r.code ?? r.error);
  return r.ok;
}

/**
 * Give up a stash whose image was not delivered: the row is orphaned and its
 * key destroyed (the original is unrecoverable from this moment), then the
 * blob is removed and, once storage confirms it, marked purged. Best effort
 * beyond the first step; the cron purges whatever is left.
 */
export async function releaseTrialOriginal(supabase: Client, originalId: string, knownObjectPath?: string): Promise<void> {
  const r = await rpcRelease(supabase, originalId);
  if (!r.ok) console.error("[trial-watermark] original not released", r.code ?? r.error);
  // The database names the blob only for a row it released (or had already):
  // a row in any other state keeps its blob. Only when the call itself
  // failed is the path this caller uploaded to used instead — that row is
  // still pending, never delivered, and its blob of no use to anyone.
  const path = r.ok ? r.data.objectPath : knownObjectPath ?? null;
  if (!path) return;
  try {
    const { data, error } = await supabase.storage.from(TRIAL_ORIGINALS_BUCKET).remove([path]);
    if (error || !Array.isArray(data)) return;
    const removed = data.map((o) => (o as { name?: unknown }).name).filter((n): n is string => typeof n === "string" && n.length > 0);
    if (removed.length > 0) await rpcMarkPurged(supabase, removed);
  } catch {
    // Left for the purge.
  }
}

/* ── Miniaturka: the clean pass behind a marked Retusz tile ────────────── */

export type TrialSource =
  /** That library path never was a trial image (definitive): the caller's ordinary path. */
  | { kind: "none" }
  /** The clean original, its bytes verified against the hash the database holds. */
  | { kind: "clean"; status: SourceReply["status"]; bytes: Buffer; sha256: string; mime: string }
  /** A clean original exists but this caller may not open it (the run is not a trial one). */
  | { kind: "locked" }
  /** No clean original can be had — expired, deleted, orphaned, or the lookup failed. */
  | { kind: "unavailable"; reason: string };

const OPENABLE: SourceReply["status"][] = ["pending", "locked", "unlocking"];

/**
 * The clean bytes behind a marked library file, for a producer that feeds it
 * to a model (R14). Tri-state on the lookup: a definitive null is "none", any
 * error or malformed answer is "unavailable" — never "none".
 *
 *   pending / locked / unlocking → decrypted ONLY when `allowLocked` (the
 *     composition is itself a trial one, so its result is marked too);
 *     otherwise "locked".
 *   unlocked → the unlocked library file, verified against the clean hash.
 *   expired / deleted / orphaned → "unavailable".
 */
export async function openTrialSource(supabase: Client, a: {
  workspaceId: string; markedPath: string; allowLocked: boolean;
}): Promise<TrialSource> {
  const r = await retryTransient(() => rpcSource(supabase, a.workspaceId, a.markedPath));
  if (!r.ok) return { kind: "unavailable", reason: "source_check_failed" };
  if (r.data === null) return { kind: "none" };
  const s = r.data;
  const inside = (p: string | null): p is string => typeof p === "string" && p.startsWith(`${a.workspaceId}/`) && !p.includes("..");
  try {
    if (OPENABLE.includes(s.status)) {
      if (!a.allowLocked) return { kind: "locked" };
      // The key is handed over only while the original can still be opened.
      if (!s.wrappedKey || !s.kekFingerprint || !inside(s.objectPath)) return { kind: "unavailable", reason: "expired" };
      const { data: file } = await supabase.storage.from(TRIAL_ORIGINALS_BUCKET).download(s.objectPath);
      if (!file) return { kind: "unavailable", reason: "original_missing" };
      const dek = unwrapOriginalKey(s.wrappedKey, s.kekFingerprint, s.originalId);
      const clean = openOriginal(Buffer.from(await file.arrayBuffer()), dek, a.workspaceId, s.originalId);
      dek.fill(0);
      const sha = sha256(clean);
      if (sha !== s.cleanSha256) return { kind: "unavailable", reason: "original_mismatch" };
      return { kind: "clean", status: s.status, bytes: clean, sha256: sha, mime: s.cleanMime };
    }
    if (s.status === "unlocked") {
      if (!inside(s.unlockedPath)) return { kind: "unavailable", reason: "unlocked_missing" };
      const { data: file } = await supabase.storage.from("generation-assets").download(s.unlockedPath);
      if (!file) return { kind: "unavailable", reason: "unlocked_missing" };
      const clean = Buffer.from(await file.arrayBuffer());
      const sha = sha256(clean);
      if (sha !== s.cleanSha256) return { kind: "unavailable", reason: "original_mismatch" };
      return { kind: "clean", status: s.status, bytes: clean, sha256: sha, mime: s.cleanMime };
    }
    return { kind: "unavailable", reason: s.status };
  } catch {
    // A tampered blob, a rotated server key, an unreadable file.
    return { kind: "unavailable", reason: "original_unreadable" };
  }
}
