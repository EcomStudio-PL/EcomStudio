import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Client } from "@/lib/services/workspace";
import { StripeApiError, StripeNotConfiguredError, stripeGet } from "@/lib/stripe/client";
import { PREVIEW_EDGE, PREVIEW_QUALITY, THUMB_EDGE, THUMB_QUALITY, previewPathFor, thumbPathFor } from "@/lib/thumbs";
import { TRIAL_WATERMARK_DEFAULTS, parseTrialWatermarkConfig } from "@/lib/trial-watermark/config";
import {
  daysUntil,
  type TrialBulkResult, type TrialPaywallPlan, type TrialPaywallResult, type TrialStatusReply,
  type TrialUnlockResult, type TrialUnlockSurface, type TrialWmEvent,
} from "@/lib/trial-watermark/types";
import { CARD_ORDER, featureOn, planPresentation } from "@/components/plan/pricing-config";
import { planCheckoutHref } from "@/components/plan/pricing-model";
import type { PricingPageData } from "@/components/plan/pricing-types";
import { openOriginal } from "./crypto";
import { unwrapOriginalKey } from "./keys";
import { TRIAL_ORIGINALS_BUCKET } from "./pipeline";
import {
  rpcConfigRead, rpcEntitlement, rpcLog, rpcMarkPurged, rpcNextBatch, rpcPurgeHeartbeat, rpcPurgeList, rpcStates,
  rpcSweepNow, rpcUnlockAbort, rpcUnlockBegin, rpcUnlockFinish,
  type EntitlementReply, type StateRow,
} from "./rpc";

/**
 * TRIAL WATERMARK — what the CUSTOMER does with a marked image: look at its
 * state, open the paywall, unlock it (one, or all of them), and the retention
 * purge that runs behind them.
 *
 * AN UNLOCK IS TWO-PHASE (R3), and every step below that is not the database
 * is undone when the database does not commit:
 *
 *   gate     the database's entitlement for the workspace, then — for a
 *            Stripe subscription — Stripe's own answer (R11). The verdict is
 *            handed to SQL as `p_live_ok`; SQL is still the judge.
 *   begin    locked → unlocking, a 10-minute lease and a target path SQL
 *            derives (`{ws}/{job}/u-{original}.{ext}`). The wrapped key leaves
 *            the database only in this answer.
 *   promote  the blob is downloaded, its key unwrapped, the clean bytes
 *            opened and checked against the hash SQL holds, then written to
 *            the target — never over anything (upsert:false; an object
 *            already there must BE these bytes, R25) — with fresh `_t`/`_p`
 *            derivatives beside it (R12).
 *   finish   the asset is repointed, the key destroyed and `watermark_unlocked`
 *            written, in one transaction, inside the lease.
 *   clean    the marked file, its derivatives and the blob go (best effort).
 *
 * ANY OUTCOME THAT IS NOT A COMMIT removes the target and its derivatives in
 * the same request, through `unlock_abort` — whose answer, not this request's
 * own begin, names what may be removed: a concurrent request may already have
 * committed that very path as the customer's file.
 *
 * Nothing here trusts a path, a state or a count from the browser. The routes
 * hand in an asset id, the workspace comes from the session, and every
 * figure in a bulk event is read back from rows the server wrote.
 */

const ASSETS = "generation-assets";

/** Signed links handed to the gallery/lightbox patch: the gallery's own TTL. */
const GALLERY_TTL = 3600;

/** Items one bulk request unlocks at most (R31). */
export const BULK_BATCH = 4;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isTrialUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const inside = (workspaceId: string, p: string | null | undefined): p is string =>
  typeof p === "string" && p.startsWith(`${workspaceId}/`) && !p.includes("..");

type Bucket = ReturnType<Client["storage"]["from"]>;

/* ── the asset as its member sees it ──────────────────────────────────── */

export type AssetView = {
  id: string;
  workspaceId: string;
  storagePath: string;
  thumb: string | null;
  preview: string | null;
  /** The producing feature, for analytics ("generator" when none claimed it). */
  tool: string;
};

/**
 * One generation asset, read with the member's own session — RLS decides
 * what exists. `null` = not visible; `"error"` = the read itself failed.
 */
async function readAsset(supabase: Client, assetId: string): Promise<AssetView | null | "error"> {
  const { data, error } = await supabase
    .from("generation_assets")
    .select("id, storage_path, metadata, generations!inner(workspace_id, generation_jobs(settings))")
    .eq("id", assetId)
    .maybeSingle();
  if (error) return "error";
  if (!data) return null;
  const gen = data.generations as unknown as {
    workspace_id: string; generation_jobs: { settings: { operation?: unknown } | null } | null;
  } | null;
  if (!gen?.workspace_id) return null;
  const meta = (data.metadata ?? null) as { thumb?: unknown; preview?: unknown } | null;
  const op = gen.generation_jobs?.settings?.operation;
  return {
    id: data.id,
    workspaceId: gen.workspace_id,
    storagePath: data.storage_path,
    thumb: typeof meta?.thumb === "string" ? meta.thumb : null,
    preview: typeof meta?.preview === "string" ? meta.preview : null,
    tool: typeof op === "string" && op ? op : "generator",
  };
}

/**
 * The asset AND its trial state, for one workspace: the asset must belong to
 * that workspace (not merely to one of the caller's), and its state comes
 * from `trial_original_states`. `state` is null for an ordinary image.
 */
export async function trialAssetState(
  supabase: Client, workspaceId: string, assetId: string,
): Promise<{ ok: true; asset: AssetView | null; state: StateRow | null } | { ok: false }> {
  if (!isTrialUuid(assetId)) return { ok: true, asset: null, state: null };
  const asset = await readAsset(supabase, assetId);
  if (asset === "error") return { ok: false };
  if (!asset || asset.workspaceId !== workspaceId) return { ok: true, asset: null, state: null };
  const states = await rpcStates(supabase, [assetId]);
  if (!states.ok) return { ok: false };
  return { ok: true, asset, state: states.data.find((s) => s.assetId === assetId) ?? null };
}

/* ── analytics ────────────────────────────────────────────────────────── */

/**
 * One of the seven events, through the only door that may write them
 * (`trial_watermark_log`, token-gated, deduplicated in SQL). Never throws and
 * never stands in the way of what the customer asked for.
 */
export async function logTrialEvent(
  supabase: Client, workspaceId: string, action: TrialWmEvent, entityId: string | null,
  metadata: Record<string, unknown>, dedupe: string | null,
): Promise<boolean> {
  const r = await rpcLog(supabase, workspaceId, action, entityId, metadata, dedupe);
  if (!r.ok) console.error("[trial-watermark] event not written", action, r.code ?? r.error);
  return r.ok && r.data;
}

/* ── the gate: the database, then Stripe (R11) ────────────────────────── */

const LIVE_CACHE_MS = 60_000;
const liveCache = new Map<string, { active: boolean; at: number }>();

/**
 * IS THE SUBSCRIPTION THE DATABASE CALLS ENTITLED ACTIVE AT STRIPE, NOW?
 *
 * The row is GrovBase's copy and trails Stripe by one webhook; an unlock is
 * irreversible, so it is asked of Stripe directly — once per request or bulk
 * batch, remembered for 60 s per subscription. Only an answer is remembered,
 * never a failure. A provider other than Stripe (the local stack's rows) has
 * nobody to ask: the database's word stands.
 */
export async function liveSubscriptionOk(
  ent: EntitlementReply, now: number = Date.now(),
): Promise<{ ok: true; live: boolean } | { ok: false }> {
  if (ent.provider !== "stripe") return { ok: true, live: true };
  const id = ent.providerSubscriptionId;
  // The same refusal as the top-up gate: a Stripe row without an id cannot be
  // checked, so it is not taken on trust.
  if (!id) return { ok: true, live: false };
  const hit = liveCache.get(id);
  if (hit && now - hit.at < LIVE_CACHE_MS) return { ok: true, live: hit.active };
  try {
    const sub = await stripeGet<{ id: string; status: string }>(`/subscriptions/${encodeURIComponent(id)}`);
    const active = sub.status === "active";
    if (liveCache.size > 1000) liveCache.clear();
    liveCache.set(id, { active, at: now });
    return { ok: true, live: active };
  } catch (e) {
    // Stripe's own type and code describe the refusal and carry no credential.
    if (e instanceof StripeApiError) console.error("[trial-watermark] stripe check failed", e.status, e.type ?? "-", e.code ?? "-");
    else console.error("[trial-watermark] stripe check failed", e instanceof StripeNotConfiguredError ? e.name : "error");
    return { ok: false };
  }
}

/** Test seam: forget every remembered Stripe answer. */
export function resetLiveSubscriptionCache(): void {
  liveCache.clear();
}

type Gate =
  | { ok: true; entitlement: EntitlementReply; liveOk: boolean }
  | { ok: false; error: "trial_check_failed" | "stripe_unavailable" };

/**
 * The verdict handed to `unlock_begin`. A workspace the database does not
 * call entitled never reaches Stripe — its answer is `false` and SQL says
 * `not_entitled` (or, for an item that is no longer locked, what it is
 * instead). A Stripe failure changes nothing anywhere: the request stops here.
 */
async function unlockGate(supabase: Client, workspaceId: string): Promise<Gate> {
  const ent = await rpcEntitlement(supabase, workspaceId);
  if (!ent.ok) {
    console.error("[trial-watermark] entitlement unavailable", ent.code ?? ent.error);
    return { ok: false, error: "trial_check_failed" };
  }
  if (!ent.data.entitled) return { ok: true, entitlement: ent.data, liveOk: false };
  const live = await liveSubscriptionOk(ent.data);
  if (!live.ok) return { ok: false, error: "stripe_unavailable" };
  return { ok: true, entitlement: ent.data, liveOk: live.live };
}

/* ── storage, never overwriting ───────────────────────────────────────── */

function alreadyExists(error: unknown): boolean {
  const e = error as { statusCode?: unknown; status?: unknown; message?: unknown } | null;
  return e?.statusCode === "409" || e?.status === 409 || (typeof e?.message === "string" && /already exists|duplicate/i.test(e.message));
}

/**
 * Write `bytes` at `path` without ever replacing anything (R12/R25). An
 * object already there counts only when it IS these bytes — re-read and
 * compared by hash; anything else is removed and the write tried once more.
 */
async function putExact(
  bucket: Bucket, path: string, bytes: Buffer, opts: { contentType: string; cacheControl?: string },
): Promise<boolean> {
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { error } = await bucket.upload(path, bytes, { ...opts, upsert: false });
      if (!error) return true;
      if (!alreadyExists(error)) return false;
      const { data: file } = await bucket.download(path);
      if (file && sha256(Buffer.from(await file.arrayBuffer())) === sha256(bytes)) return true;
      if (attempt === 0) await bucket.remove([path]);
    }
  } catch {
    // A network failure is a failed write; the caller undoes what it began.
  }
  return false;
}

/** The target and both its derivatives — what an uncommitted unlock leaves. */
async function removeTarget(supabase: Client, workspaceId: string, target: string): Promise<void> {
  if (!inside(workspaceId, target)) return;
  try {
    await supabase.storage.from(ASSETS).remove([target, thumbPathFor(target), previewPathFor(target)]);
  } catch {
    // Retried by the next call that sees this row (status, unlock).
  }
}

/**
 * Undo an uncommitted unlock: `unlock_abort` returns the row to `locked` and
 * names the target to remove — or names nothing, when the row is unlocked
 * (then that path is the customer's file, committed by another request).
 * Also used for a row that can no longer be unlocked (expired, deleted) to
 * clear a target an earlier, interrupted request left behind.
 */
async function abortUnlock(supabase: Client, workspaceId: string, assetId: string): Promise<string | null> {
  const r = await rpcUnlockAbort(supabase, assetId);
  if (!r.ok) {
    console.error("[trial-watermark] unlock not aborted", r.code ?? r.error);
    return null;
  }
  if (r.data.targetPath) await removeTarget(supabase, workspaceId, r.data.targetPath);
  // The row's state after the abort ("locked", "unlocked", …): null only when
  // the abort itself could not be had.
  return r.data.state;
}

/**
 * After a commit: the marked file and its derivatives leave the library, the
 * blob leaves `trial-originals` (marked purged once storage confirms it).
 * Best effort; the purge collects a blob left here.
 */
async function cleanCommitted(
  supabase: Client, workspaceId: string, storagePath: string, oldPaths: string[], objectPath: string | null,
): Promise<void> {
  const keep = new Set([storagePath, thumbPathFor(storagePath), previewPathFor(storagePath)]);
  const old = oldPaths.filter((p) => inside(workspaceId, p) && !keep.has(p));
  try {
    if (old.length > 0) await supabase.storage.from(ASSETS).remove(old);
  } catch {
    // A leftover marked file is the watermarked picture — harmless.
  }
  if (!inside(workspaceId, objectPath)) return;
  try {
    const { data, error } = await supabase.storage.from(TRIAL_ORIGINALS_BUCKET).remove([objectPath]);
    if (error || !Array.isArray(data)) return;
    const removed = data.map((o) => (o as { name?: unknown }).name).filter((n): n is string => typeof n === "string" && n.length > 0);
    if (removed.length > 0) await rpcMarkPurged(supabase, removed);
  } catch {
    // Left for the purge; its key is destroyed already.
  }
}

/* ── one unlock ───────────────────────────────────────────────────────── */

type Committed = { path: string; thumb: string | null; preview: string | null };

type One =
  | ({ state: "unlocked" } & Committed)
  | { state: "not_entitled" | "expired" | "unavailable" | "not_found" }
  | { state: "error"; error: "busy" | "unlock_failed" };

/** Derivatives of the clean file — the generator's own recipe. */
async function deriveClean(clean: Buffer): Promise<{ thumb: Buffer; preview: Buffer } | null> {
  try {
    const { default: sharp } = await import("sharp");
    const derive = (edge: number, quality: number) =>
      sharp(clean, { failOn: "none" })
        .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
        // `.webp()` drops EXIF and every other ancillary chunk on the way out.
        .webp({ quality })
        .toBuffer();
    const [thumb, preview] = await Promise.all([derive(THUMB_EDGE, THUMB_QUALITY), derive(PREVIEW_EDGE, PREVIEW_QUALITY)]);
    return { thumb, preview };
  } catch {
    // None, then: the library rebuilds them from the clean file.
    return null;
  }
}

/** The committed asset's own derivative paths (an earlier or concurrent commit). */
async function committedView(supabase: Client, workspaceId: string, assetId: string, path: string): Promise<Committed> {
  const asset = await readAsset(supabase, assetId);
  const own = asset && asset !== "error" && asset.workspaceId === workspaceId && asset.storagePath === path ? asset : null;
  return { path, thumb: own?.thumb ?? null, preview: own?.preview ?? null };
}

/**
 * A failure after `ready` that is not the whole story: two clicks on one
 * asset both get `ready` for the same target, and when the first commits it
 * removes the blob the second was about to read. The abort has already run
 * (and, the row being unlocked, removed nothing); its answer — or, when the
 * abort itself failed, the asset's state — says whether this was in fact a
 * success by someone else.
 */
async function settleFailure(
  supabase: Client, workspaceId: string, assetId: string, abortState: string | null, fallback: One,
): Promise<One> {
  if (abortState !== null && abortState !== "unlocked") return fallback;
  if (abortState === null) {
    const states = await rpcStates(supabase, [assetId]);
    const unlocked = states.ok && states.data.some((s) => s.assetId === assetId && s.state === "unlocked");
    if (!unlocked) return fallback;
  }
  const asset = await readAsset(supabase, assetId);
  if (!asset || asset === "error" || asset.workspaceId !== workspaceId) return fallback;
  return { state: "unlocked", path: asset.storagePath, thumb: asset.thumb, preview: asset.preview };
}

/**
 * begin → promote → finish for ONE asset of `workspaceId`, under a gate the
 * caller already judged. Every non-committed outcome after `ready` aborts.
 */
async function unlockOne(supabase: Client, a: {
  workspaceId: string; assetId: string; liveOk: boolean; via: "single" | "bulk"; bulkId: string | null;
}): Promise<One> {
  const begin = await rpcUnlockBegin(supabase, a.assetId, a.liveOk);
  if (!begin.ok) {
    console.error("[trial-watermark] unlock not begun", begin.code ?? begin.error);
    return { state: "error", error: "unlock_failed" };
  }
  const b = begin.data;
  if (b.state === "unlocked") return { state: "unlocked", ...await committedView(supabase, a.workspaceId, a.assetId, b.storagePath) };
  if (b.state === "busy") return { state: "error", error: "busy" };
  if (b.state === "expired" || b.state === "unavailable") {
    // Never unlockable again: a target an interrupted request left goes now.
    await abortUnlock(supabase, a.workspaceId, a.assetId);
    return { state: b.state };
  }
  if (b.state !== "ready") return { state: b.state };

  if (b.workspaceId !== a.workspaceId || !inside(a.workspaceId, b.objectPath) || !inside(a.workspaceId, b.targetPath)) {
    await abortUnlock(supabase, a.workspaceId, a.assetId);
    return { state: "error", error: "unlock_failed" };
  }

  // PROMOTE. Any failure from here to the finish is undone by the abort.
  const bucket = supabase.storage.from(ASSETS);
  let thumbPath: string | null = null;
  let previewPath: string | null = null;
  try {
    const { data: blob } = await supabase.storage.from(TRIAL_ORIGINALS_BUCKET).download(b.objectPath);
    if (!blob) throw new Error("original_missing");
    const dek = unwrapOriginalKey(b.wrappedKey, b.kekFingerprint, b.originalId);
    const clean = openOriginal(Buffer.from(await blob.arrayBuffer()), dek, b.workspaceId, b.originalId);
    dek.fill(0);
    if (sha256(clean) !== b.cleanSha256) throw new Error("original_mismatch");
    // The original keeps the storage default cache, as every generated file does.
    if (!await putExact(bucket, b.targetPath, clean, { contentType: b.cleanMime })) throw new Error("target_not_written");
    const derived = await deriveClean(clean);
    if (derived) {
      // A derivative at a derived path never changes: let the CDN hold it.
      // SECONDS ONLY — storage-js prepends "max-age=" itself (generation.ts).
      const opts = { contentType: "image/webp", cacheControl: "31536000, immutable" };
      const tPath = thumbPathFor(b.targetPath);
      const pPath = previewPathFor(b.targetPath);
      const [t, p] = await Promise.all([putExact(bucket, tPath, derived.thumb, opts), putExact(bucket, pPath, derived.preview, opts)]);
      thumbPath = t ? tPath : null;
      previewPath = p ? pPath : null;
    }
  } catch (e) {
    // Codes only — never a key, a path or a payload.
    console.error("[trial-watermark] unlock not promoted", e instanceof Error ? e.message : "error");
    const aborted = await abortUnlock(supabase, a.workspaceId, a.assetId);
    return settleFailure(supabase, a.workspaceId, a.assetId, aborted, { state: "error", error: "unlock_failed" });
  }

  const finish = await rpcUnlockFinish(supabase, a.assetId, thumbPath, previewPath, a.via, a.bulkId);
  if (!finish.ok || finish.data.state !== "unlocked") {
    console.error("[trial-watermark] unlock not committed", finish.ok ? finish.data.state : finish.code ?? finish.error);
    // A lost reply may still have committed: abort then names nothing to remove.
    const aborted = await abortUnlock(supabase, a.workspaceId, a.assetId);
    if (finish.ok && (finish.data.state === "not_found" || finish.data.state === "deleted")) return { state: "not_found" };
    return settleFailure(supabase, a.workspaceId, a.assetId, aborted, { state: "error", error: "unlock_failed" });
  }
  const f = finish.data;
  await cleanCommitted(supabase, a.workspaceId, f.storagePath, f.oldPaths, f.objectPath);
  if (f.already) return { state: "unlocked", ...await committedView(supabase, a.workspaceId, a.assetId, f.storagePath) };
  return { state: "unlocked", path: f.storagePath, thumb: thumbPath, preview: previewPath };
}

/* ── signing ──────────────────────────────────────────────────────────── */

type SignedItem = { path: string; url: string; thumbUrl: string; previewUrl: string; hasThumb: boolean };

/** One signing call for a set of committed assets, as the gallery signs them. */
async function signCommitted(supabase: Client, items: Committed[]): Promise<(SignedItem | null)[]> {
  const paths = new Set<string>();
  for (const c of items) {
    paths.add(c.path);
    if (c.thumb) paths.add(c.thumb);
    if (c.preview) paths.add(c.preview);
  }
  const map = new Map<string, string>();
  if (paths.size > 0) {
    const { data } = await supabase.storage.from(ASSETS).createSignedUrls([...paths], GALLERY_TTL);
    data?.forEach((s) => { if (s.signedUrl && s.path) map.set(s.path, s.signedUrl); });
  }
  return items.map((c) => {
    const url = map.get(c.path);
    if (!url) return null;
    const thumbUrl = (c.thumb && map.get(c.thumb)) || url;
    return { path: c.path, url, thumbUrl, hasThumb: thumbUrl !== url, previewUrl: (c.preview && map.get(c.preview)) || url };
  });
}

/** The config's download-link lifetime (D3: unlock/status links only). */
async function downloadTtl(supabase: Client): Promise<number> {
  const r = await rpcConfigRead(supabase);
  return r.ok ? parseTrialWatermarkConfig(r.data).signedUrlTtlSeconds : TRIAL_WATERMARK_DEFAULTS.signedUrlTtlSeconds;
}

async function signDownload(supabase: Client, path: string, ttl: number): Promise<string | null> {
  const { data } = await supabase.storage.from(ASSETS).createSignedUrl(path, ttl);
  return data?.signedUrl ?? null;
}

/* ── the three things a customer asks ─────────────────────────────────── */

/**
 * POST /api/trial-originals/unlock — one asset of the caller's CURRENT
 * workspace (an asset of another workspace is "not_found", as anywhere else).
 */
export async function unlockTrialAsset(supabase: Client, a: { workspaceId: string; assetId: string }): Promise<TrialUnlockResult> {
  const asset = await readAsset(supabase, a.assetId);
  if (asset === "error") return { state: "error", error: "trial_check_failed" };
  if (!asset || asset.workspaceId !== a.workspaceId) return { state: "not_found" };

  const gate = await unlockGate(supabase, a.workspaceId);
  if (!gate.ok) return { state: "error", error: gate.error };
  const one = await unlockOne(supabase, { workspaceId: a.workspaceId, assetId: a.assetId, liveOk: gate.liveOk, via: "single", bulkId: null });
  if (one.state === "not_entitled") {
    return { state: "not_entitled", pending: gate.entitlement.pending, hasLiveSubscription: gate.entitlement.hasLiveSubscription };
  }
  if (one.state === "error") return { state: "error", error: one.error };
  if (one.state !== "unlocked") return { state: one.state };

  const [signed] = await signCommitted(supabase, [one]);
  const download = signed ? await signDownload(supabase, one.path, await downloadTtl(supabase)) : null;
  // Committed, but no link could be made: the library shows the clean file on
  // its next read; the dialog says so rather than offering a dead button.
  if (!signed || !download) return { state: "error", error: "sign_failed" };
  return { state: "unlocked", assetId: a.assetId, ...signed, downloadUrl: download };
}

/**
 * GET /api/trial-originals/status — what the dialog polls (after a checkout,
 * on reopening). The database's view of entitlement; the unlock itself
 * re-judges it, Stripe included.
 */
export async function trialStatus(
  supabase: Client, a: { workspaceId: string; assetId: string },
): Promise<TrialStatusReply> {
  const read = await trialAssetState(supabase, a.workspaceId, a.assetId);
  if (!read.ok) return { state: "error", error: "trial_check_failed" };
  const ent = await rpcEntitlement(supabase, a.workspaceId);
  if (!ent.ok) return { state: "error", error: "trial_check_failed" };
  const { asset, state } = read;
  const base = { entitled: ent.data.entitled, pending: ent.data.pending, planSlug: ent.data.planSlug };
  if (!asset || !state) return { state: "not_found", daysLeft: null, thumbUrl: null, downloadUrl: null, ...base };

  // An original that can never be unlocked again: clear whatever an
  // interrupted unlock may have left at its target (R3).
  if (state.state === "expired" || state.state === "unavailable") await abortUnlock(supabase, a.workspaceId, a.assetId);

  const [signed] = await signCommitted(supabase, [{ path: asset.storagePath, thumb: asset.thumb, preview: asset.preview }]);
  const downloadUrl = state.state === "unlocked"
    ? await signDownload(supabase, asset.storagePath, await downloadTtl(supabase))
    : null;
  return {
    state: state.state,
    daysLeft: state.state === "locked" ? state.daysLeft ?? daysUntil(state.expiresAt) : null,
    thumbUrl: signed?.thumbUrl ?? null,
    downloadUrl,
    ...base,
  };
}

/**
 * POST /api/trial-originals/unlock-all — ONE batch (≤ 4) of the workspace's
 * unlockable originals, oldest first, inside a wall-clock budget; the client
 * calls again with `skip` = what failed until `done`. One gate per batch.
 *
 * On the batch that finishes the run, `watermark_bulk_unlocked` is written
 * once per bulk id, with counts the server reads back itself: the
 * `watermark_unlocked` events SQL wrote under this bulk id, and the skipped
 * items that really are still locked — never the client's numbers.
 */
export async function unlockNextBatch(supabase: Client, a: {
  workspaceId: string; bulkId: string; skip: string[]; deadline: number;
}): Promise<TrialBulkResult> {
  const gate = await unlockGate(supabase, a.workspaceId);
  if (!gate.ok) return { state: "error", error: gate.error };
  if (!gate.entitlement.entitled || !gate.liveOk) {
    return { state: "not_entitled", pending: gate.entitlement.pending, hasLiveSubscription: gate.entitlement.hasLiveSubscription };
  }
  const batch = await rpcNextBatch(supabase, a.workspaceId, BULK_BATCH, a.skip);
  if (!batch.ok) {
    console.error("[trial-watermark] bulk batch unavailable", batch.code ?? batch.error);
    return { state: "error", error: "trial_check_failed" };
  }

  const committed: { assetId: string; c: Committed }[] = [];
  const failed: { assetId: string; reason: string }[] = [];
  let untried = 0;
  for (const assetId of batch.data.assetIds) {
    // Sequential, and only while the request still has time (R31/R35): an
    // item not tried stays locked and comes back in the next batch.
    if (Date.now() >= a.deadline) { untried++; continue; }
    const one = await unlockOne(supabase, { workspaceId: a.workspaceId, assetId, liveOk: true, via: "bulk", bulkId: a.bulkId });
    if (one.state === "unlocked") committed.push({ assetId, c: one });
    else failed.push({ assetId, reason: one.state === "error" ? one.error : one.state });
  }

  const signed = await signCommitted(supabase, committed.map((x) => x.c));
  const unlocked: Extract<TrialBulkResult, { state: "ok" }>["unlocked"] = [];
  committed.forEach((x, i) => {
    const s = signed[i];
    if (s) unlocked.push({ assetId: x.assetId, ...s });
    // Committed but unsigned: clean in the library, just not patched here.
    else failed.push({ assetId: x.assetId, reason: "sign_failed" });
  });

  const remaining = batch.data.remaining + untried;
  const done = remaining === 0;
  if (done) await noteBulkDone(supabase, a.workspaceId, a.bulkId, [...a.skip, ...failed.map((f) => f.assetId)]);
  return { state: "ok", bulkId: a.bulkId, unlocked, failed, remaining, done };
}

/** `watermark_bulk_unlocked`, counted from the server's own rows. */
async function noteBulkDone(supabase: Client, workspaceId: string, bulkId: string, skipped: string[]): Promise<void> {
  try {
    const { count, error } = await supabase
      .from("activity_logs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("action", "watermark_unlocked")
      .eq("metadata->>bulk_id", bulkId);
    if (error) return;
    const ids = [...new Set(skipped.filter(isTrialUuid))].slice(0, 200);
    const states = ids.length > 0 ? await rpcStates(supabase, ids) : { ok: true as const, data: [] as StateRow[] };
    const stillLocked = states.ok ? states.data.filter((s) => s.state === "locked").length : 0;
    const n = count ?? 0;
    // A run that found nothing to do is not a bulk unlock.
    if (n + stillLocked === 0) return;
    await logTrialEvent(supabase, workspaceId, "watermark_bulk_unlocked", null,
      { bulk_id: bulkId, unlocked: n, failed: stillLocked }, bulkId);
  } catch {
    // Analytics only.
  }
}

/* ── the paywall ──────────────────────────────────────────────────────── */

/**
 * The plan cards the paywall shows: the catalogue's paid plans as /plany
 * prices them (`loadPricingPage`), in the cards' own order, named as /plany
 * names them (Agency → "Business"), buyable on exactly the conditions the
 * plan card's CTA applies (`planCta`: payable this period, no live
 * subscription, not the current plan) on the monthly period the paywall
 * shows. `capabilities` are the card's highlight keys that are available
 * today ("yes", never "soon") — rendered with the card's own labels.
 */
export function paywallPlansFrom(data: PricingPageData): TrialPaywallPlan[] {
  const rank = (slug: string) => {
    const i = CARD_ORDER.indexOf(slug);
    return i < 0 ? CARD_ORDER.length : i;
  };
  return data.plans
    .filter((p) => p.priceCents > 0)
    .sort((x, y) => rank(x.slug) - rank(y.slug))
    .map((p) => {
      const look = planPresentation(p.slug);
      const payable = p.payable.monthly && !data.viewer.hasLiveSubscription && data.viewer.currentSlug !== p.slug;
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        nameKey: look.nameKey ?? null,
        priceCents: p.priceCents,
        currency: p.currency,
        monthlyCredits: p.monthlyCredits,
        bonusCredits: p.bonusCredits,
        featured: p.featured,
        payable,
        checkoutHref: payable ? planCheckoutHref(p.id, "monthly") : null,
        capabilities: look.highlights.filter((k) => featureOn(k, p.slug, p.capabilities) === "yes"),
      };
    });
}

/**
 * The paywall for one asset (R16): its state FIRST — an asset that is not
 * locked gets no paywall and no events. Then `watermark_unlock_clicked`; an
 * entitled workspace goes straight to the unlock; anyone else gets a fresh
 * paywall id, `watermark_paywall_opened` (once per id) and the real plans.
 */
export async function openTrialPaywall(supabase: Client, a: {
  workspaceId: string; assetId: string; surface: TrialUnlockSurface; plans: () => Promise<TrialPaywallPlan[]>;
  paywallId: string;
}): Promise<TrialPaywallResult> {
  const read = await trialAssetState(supabase, a.workspaceId, a.assetId);
  if (!read.ok) return { kind: "error" };
  if (!read.asset || !read.state) return { kind: "not_locked", state: "not_found" };
  if (read.state.state !== "locked") return { kind: "not_locked", state: read.state.state };
  const tool = read.asset.tool;

  await logTrialEvent(supabase, a.workspaceId, "watermark_unlock_clicked", a.assetId,
    { asset_id: a.assetId, surface: a.surface, tool }, null);

  const ent = await rpcEntitlement(supabase, a.workspaceId);
  if (!ent.ok) return { kind: "error" };
  if (ent.data.entitled) {
    // The unlock's own verdict (R11), remembered for 60 s — so a row Stripe
    // has already cancelled opens the paywall here instead of sending the
    // dialog to an unlock that refuses it. A Stripe outage is the unlock's to
    // report (stripe_unavailable, with its retry), not a reason to sell.
    const live = await liveSubscriptionOk(ent.data);
    if (!live.ok || live.live) return { kind: "entitled" };
  }

  let plans: TrialPaywallPlan[] = [];
  try {
    plans = await a.plans();
  } catch {
    // An unreadable catalogue: the paywall still opens, with the way to /plan.
    plans = [];
  }
  const daysLeft = read.state.daysLeft ?? daysUntil(read.state.expiresAt);
  await logTrialEvent(supabase, a.workspaceId, "watermark_paywall_opened", a.assetId,
    { paywall_id: a.paywallId, asset_id: a.assetId, surface: a.surface, tool, days_left: daysLeft }, a.paywallId);
  return {
    kind: "paywall", paywallId: a.paywallId, daysLeft, plans,
    hasLiveSubscription: ent.data.hasLiveSubscription, pending: ent.data.pending,
  };
}

export type TrialPlanSelected = { ok: true; href: string } | { ok: false; error: "invalid" | "failed" };

/**
 * "Wybierz plan" on the paywall: the plan must be a paid, active catalogue
 * plan; the checkout link is the one /plany sends. `watermark_plan_selected`
 * is written only for a paywall this workspace really opened for this asset
 * (once per paywall and plan) — it is what the checkout return reads back.
 */
export async function selectTrialPlan(supabase: Client, a: {
  workspaceId: string; paywallId: string; assetId: string; planId: string;
}): Promise<TrialPlanSelected> {
  const { data: plan, error } = await supabase
    .from("subscription_plans")
    .select("id, slug, price_cents, active")
    .eq("id", a.planId)
    .maybeSingle();
  if (error) return { ok: false, error: "failed" };
  if (!plan || plan.active !== true || !(plan.price_cents > 0) || plan.slug === "free") return { ok: false, error: "invalid" };

  const { data: opened } = await supabase
    .from("activity_logs")
    .select("id")
    .eq("workspace_id", a.workspaceId)
    .eq("action", "watermark_paywall_opened")
    .eq("metadata->>dedupe", a.paywallId)
    .eq("metadata->>asset_id", a.assetId)
    .limit(1);
  if ((opened ?? []).length > 0) {
    await logTrialEvent(supabase, a.workspaceId, "watermark_plan_selected", a.assetId,
      { paywall_id: a.paywallId, plan_slug: plan.slug, asset_id: a.assetId }, `${a.paywallId}|${plan.slug}`);
  }
  return { ok: true, href: planCheckoutHref(plan.id, "monthly") };
}

/* ── the checkout return (R17) ────────────────────────────────────────── */

const RETURN_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The asset to offer "Wróć do zdjęcia" for on the checkout status page: the
 * caller's latest `watermark_plan_selected` (only the marker-protected writer
 * can write that name), less than 24 h old, in the caller's current
 * workspace, naming an asset of that workspace that is still locked. Null in
 * every other case — the page then shows exactly what it showed before.
 */
export async function trialReturnAssetId(
  supabase: Client, a: { userId: string; workspaceId: string; now?: number },
): Promise<string | null> {
  try {
    const since = new Date((a.now ?? Date.now()) - RETURN_WINDOW_MS).toISOString();
    const { data, error } = await supabase
      .from("activity_logs")
      .select("workspace_id, metadata, created_at")
      .eq("actor_id", a.userId)
      .eq("action", "watermark_plan_selected")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1);
    const row = !error ? (data ?? [])[0] : undefined;
    if (!row || row.workspace_id !== a.workspaceId) return null;
    const assetId = (row.metadata as { asset_id?: unknown } | null)?.asset_id;
    if (!isTrialUuid(assetId)) return null;
    const read = await trialAssetState(supabase, a.workspaceId, assetId);
    return read.ok && read.state?.state === "locked" ? assetId.toLowerCase() : null;
  } catch {
    return null;
  }
}

/* ── retention: the physical purge (R6) ───────────────────────────────── */

export type TrialPurgeReport = {
  swept: Record<string, unknown> | null;
  listed: number;
  removed: number;
  marked: number;
  error: string | null;
};

/**
 * THE PURGE, from the daily cron with a SESSION-LESS client (anon): the
 * HTTP belt of the sweep, then the armed list, the Storage removal (anon may
 * delete only an armed, key-destroyed blob), then the rows storage confirmed
 * — and a heartbeat whatever happened, so the admin page can tell a purge
 * that runs from one that does not. Inside `budgetMs`; what is left waits
 * for the next day.
 */
export async function purgeTrialOriginals(client: SupabaseClient, opts: { budgetMs: number }): Promise<TrialPurgeReport> {
  const deadline = Date.now() + opts.budgetMs;
  const report: TrialPurgeReport = { swept: null, listed: 0, removed: 0, marked: 0, error: null };
  const fail = (code: string) => { report.error ??= code; };
  try {
    const swept = await rpcSweepNow(client);
    if (swept.ok) report.swept = swept.data;
    else fail("sweep_failed");

    const list = Date.now() < deadline ? await rpcPurgeList(client, 200) : null;
    if (!list) fail("budget");
    else if (!list.ok) fail("list_failed");
    else {
      report.listed = list.data.length;
      const removed: string[] = [];
      for (let i = 0; i < list.data.length; i += 100) {
        if (Date.now() >= deadline) { fail("budget"); break; }
        const { data, error } = await client.storage.from(TRIAL_ORIGINALS_BUCKET).remove(list.data.slice(i, i + 100));
        if (error || !Array.isArray(data)) { fail("remove_failed"); continue; }
        for (const o of data) {
          const name = (o as { name?: unknown }).name;
          if (typeof name === "string" && name.length > 0) removed.push(name);
        }
      }
      report.removed = removed.length;
      // Only what storage confirmed; SQL checks again that the object is gone.
      const marked = await rpcMarkPurged(client, removed);
      if (marked.ok) report.marked = marked.data;
      else fail("mark_failed");
    }
  } catch {
    fail("error");
  }
  const beat = await rpcPurgeHeartbeat(client, { ...report });
  if (!beat.ok) fail("heartbeat_failed");
  return report;
}
