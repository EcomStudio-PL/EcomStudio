/**
 * TRIAL WATERMARK — the customer side's arithmetic, with no React in it.
 *
 * Everything the lock chip, the lightbox plate, the unlock dialog and the
 * bulk dialog decide is decided here, as plain functions over the shapes in
 * `lib/trial-watermark/types.ts`: which images are marked, how many days a
 * line may promise, which plan card is highlighted, how long to wait before
 * asking again, whether a download link is still good, and how a batch of
 * "unlock everything" moves the counter. None of it grants anything — the
 * server judges every unlock — so a wrong answer here can only ever show the
 * wrong words, never hand over a clean file.
 *
 * Replies from the API are read through `parse*` and never trusted as typed:
 * a body that does not have the documented shape becomes an error, exactly as
 * the server's own RPC wrappers treat a malformed answer.
 */
import {
  daysUntil,
  type GalleryTrial, type TrialBulkResult, type TrialPaywallPlan, type TrialStatusResult, type TrialUnlockResult,
} from "@/lib/trial-watermark/types";
import { TRIAL_WATERMARK_RANGES } from "@/lib/trial-watermark/config";
import { CARD_ORDER } from "@/components/plan/pricing-config";

type T = (key: string, vars?: Record<string, string | number>) => string;

/* ── what an item is ─────────────────────────────────────────────────────── */

/** The clean original still exists and can be unlocked. */
export const isLocked = (trial: GalleryTrial | null | undefined): boolean => trial?.state === "locked";

/**
 * The pixels on screen carry the mark — locked, expired or unavailable alike.
 * A marked file is never fed to a model (R5): the editing tiles and the
 * regenerate canvas refuse it, whatever happens to its original.
 */
export const isMarked = (trial: GalleryTrial | null | undefined): boolean =>
  trial?.state === "locked" || trial?.state === "expired" || trial?.state === "unavailable";

/**
 * Whole days left. The server's own count comes first: the library's first
 * page is rendered on the server, and a figure recomputed from the client's
 * clock could disagree with that HTML across a day boundary. The expiry is the
 * fallback for an item that carries no count.
 */
export function daysLeftOf(trial: GalleryTrial | null | undefined, now: number = Date.now()): number | null {
  if (!trial || trial.state !== "locked") return null;
  return typeof trial.daysLeft === "number" ? trial.daysLeft : daysUntil(trial.expiresAt, now);
}

/**
 * Less than a day to go. With an exact expiry this is the clock; with only a
 * day count it is "1": `daysLeft` is rounded UP, so 1 means (0, 24 h].
 */
export function underADay(expiresAt: string | null | undefined, daysLeft: number | null, now: number = Date.now()): boolean {
  const at = expiresAt ? Date.parse(expiresAt) : NaN;
  if (Number.isFinite(at)) return at - now <= 86_400_000;
  return daysLeft !== null && daysLeft <= 1;
}

/** "Wersja bez znaku wodnego dostępna jeszcze 3 dni" — one key for 1, one for the rest. */
export function availableLine(t: T, days: number | null): string {
  if (days === null) return t("genv3.wm.availablePlain");
  return days <= 1 ? t("genv3.wm.availableOne") : t("genv3.wm.available", { n: days });
}

/** "3 dni" — the short form for the chip and the list rows. */
export function daysShort(t: T, days: number | null): string | null {
  if (days === null) return null;
  return days <= 1 ? t("genv3.wm.daysShortOne") : t("genv3.wm.daysShort", { n: days });
}

/** The neutral line for a marked file whose original is gone — no CTA, no promise. */
export function goneLine(t: T, trial: GalleryTrial | null | undefined): string | null {
  if (trial?.state === "expired") return t("genv3.wm.expired");
  if (trial?.state === "unavailable") return t("genv3.wm.unavailable");
  return null;
}

/* ── after an unlock ─────────────────────────────────────────────────────── */

/** What changes on a card once its clean file has replaced the marked one. */
export type TrialAssetPatch = {
  path: string;
  url: string;
  thumbUrl: string;
  previewUrl: string;
  hasThumb: boolean;
  trial: GalleryTrial;
};

export const UNLOCKED_TRIAL: GalleryTrial = { state: "unlocked", expiresAt: null, daysLeft: null };

export function unlockedPatch(r: { path: string; url: string; thumbUrl: string; previewUrl: string; hasThumb: boolean }): TrialAssetPatch {
  return { path: r.path, url: r.url, thumbUrl: r.thumbUrl, previewUrl: r.previewUrl, hasThumb: r.hasThumb, trial: UNLOCKED_TRIAL };
}

/** Patch ONE ASSET of a list — favourite and delete work per generation, an
 *  unlock per image, so the other images of the same job stay as they are. */
export function patchAsset<I extends { assetId: string }>(list: I[], assetId: string, patch: Partial<I>): I[] {
  let hit = false;
  const next = list.map((i) => {
    if (i.assetId !== assetId) return i;
    hit = true;
    return { ...i, ...patch };
  });
  return hit ? next : list;
}

/* ── the paywall's plan cards ────────────────────────────────────────────── */

/** The card order of /plany (Starter, PRO, Business), then anything else by price. */
export function orderPlans(plans: TrialPaywallPlan[]): TrialPaywallPlan[] {
  const rank = (slug: string) => {
    const i = CARD_ORDER.indexOf(slug);
    return i < 0 ? CARD_ORDER.length : i;
  };
  return [...plans].sort((a, b) => rank(a.slug) - rank(b.slug) || a.priceCents - b.priceCents);
}

/** The highlighted card: whatever the catalogue marks `featured`, else PRO. */
export function highlightedPlanIds(plans: TrialPaywallPlan[]): Set<string> {
  const featured = plans.filter((p) => p.featured);
  return new Set((featured.length > 0 ? featured : plans.filter((p) => p.slug === "pro")).map((p) => p.id));
}

/** Where "Wybierz plan" may go: the plan's own checkout intent, and only an
 *  in-app path — never a URL that leaves GrovBase. */
export function safeHref(href: string | null | undefined): string | null {
  return typeof href === "string" && href.startsWith("/") && !href.startsWith("//") ? href : null;
}

/* ── waiting for a payment to be confirmed ───────────────────────────────── */

/** Gaps between status checks after checkout: quick at first, then patient. */
export const CONFIRM_DELAYS_MS = [2000, 3000, 4000, 5000, 6000, 8000, 10_000, 12_000, 15_000, 15_000, 20_000, 20_000] as const;
/** About two minutes of asking before the dialog says "still processing". */
export const CONFIRM_BUDGET_MS = 120_000;

/** The wait before the next check, or null once the budget would be exceeded. */
export function nextConfirmDelay(attempt: number, elapsedMs: number, budgetMs: number = CONFIRM_BUDGET_MS): number | null {
  const delay = CONFIRM_DELAYS_MS[Math.min(Math.max(0, attempt), CONFIRM_DELAYS_MS.length - 1)];
  return elapsedMs + delay > budgetMs ? null : delay;
}

/* ── the short-lived download link ───────────────────────────────────────── */

/** Refresh this long before the link dies, so a slow fetch never meets a 400. */
export const LINK_MARGIN_MS = 5000;

/**
 * When a signed download link stops working. The storage token is a JWT whose
 * `exp` is the truth; without one, the SHORTEST lifetime the admin can set is
 * assumed, so the dialog may refresh a link needlessly but never hands over a
 * dead one.
 */
export function linkExpiresAt(url: string, receivedAt: number): number {
  try {
    const token = new URL(url, "https://x.invalid").searchParams.get("token");
    const part = token?.split(".")[1];
    if (part) {
      const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
      const json = JSON.parse(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "="))) as { exp?: unknown };
      if (typeof json.exp === "number" && Number.isFinite(json.exp)) return json.exp * 1000;
    }
  } catch { /* not a token we can read — fall through to the floor */ }
  return receivedAt + TRIAL_WATERMARK_RANGES.signedUrlTtlSeconds.min * 1000;
}

export function needsFreshLink(url: string | null, receivedAt: number, now: number = Date.now()): boolean {
  return !url || now >= linkExpiresAt(url, receivedAt) - LINK_MARGIN_MS;
}

/* ── reading the API's answers ───────────────────────────────────────────── */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const TRIAL_STATES = ["locked", "unlocked", "expired", "unavailable"] as const;

type Unlocked = { assetId: string; path: string; url: string; thumbUrl: string; previewUrl: string; hasThumb: boolean };

function readUnlocked(v: unknown): Unlocked | null {
  if (!isObj(v) || !str(v.assetId) || !str(v.path) || !str(v.url) || !str(v.thumbUrl) || !str(v.previewUrl)) return null;
  return { assetId: v.assetId, path: v.path, url: v.url, thumbUrl: v.thumbUrl, previewUrl: v.previewUrl, hasThumb: v.hasThumb === true };
}

/** POST /api/trial-originals/unlock → TrialUnlockResult, or an error. */
export function parseUnlock(json: unknown, httpStatus: number): TrialUnlockResult {
  if (!isObj(json)) return { state: "error", error: `http_${httpStatus}` };
  if (json.state === "unlocked") {
    const u = readUnlocked(json);
    return u && str(json.downloadUrl) ? { state: "unlocked", ...u, downloadUrl: json.downloadUrl } : { state: "error", error: "malformed" };
  }
  if (json.state === "not_entitled") {
    return { state: "not_entitled", pending: json.pending === true, hasLiveSubscription: json.hasLiveSubscription === true };
  }
  if (json.state === "expired" || json.state === "unavailable" || json.state === "not_found") return { state: json.state };
  return { state: "error", error: str(json.error) ? json.error : `http_${httpStatus}` };
}

/** GET /api/trial-originals/status → TrialStatusResult, or null when unreadable. */
export function parseStatus(json: unknown): TrialStatusResult | null {
  if (!isObj(json)) return null;
  const s = json.state;
  if (s !== "not_found" && !(TRIAL_STATES as readonly unknown[]).includes(s)) return null;
  return {
    state: s as TrialStatusResult["state"],
    daysLeft: typeof json.daysLeft === "number" ? json.daysLeft : null,
    entitled: json.entitled === true,
    pending: json.pending === true,
    planSlug: str(json.planSlug) ? json.planSlug : null,
    thumbUrl: str(json.thumbUrl) ? json.thumbUrl : null,
    downloadUrl: str(json.downloadUrl) ? json.downloadUrl : null,
  };
}

/** POST /api/trial-originals/unlock-all → one batch, or an error. */
export function parseBulk(json: unknown, httpStatus: number): TrialBulkResult {
  if (!isObj(json)) return { state: "error", error: `http_${httpStatus}` };
  if (json.state === "ok") {
    if (!str(json.bulkId) || !Array.isArray(json.unlocked) || !Array.isArray(json.failed) || typeof json.remaining !== "number") {
      return { state: "error", error: "malformed" };
    }
    const unlocked = json.unlocked.map(readUnlocked).filter((u): u is Unlocked => u !== null);
    const failed = json.failed
      .filter((f): f is Record<string, unknown> => isObj(f) && str(f.assetId))
      .map((f) => ({ assetId: f.assetId as string, reason: str(f.reason) ? f.reason : "failed" }));
    return { state: "ok", bulkId: json.bulkId, unlocked, failed, remaining: Math.max(0, json.remaining), done: json.done === true };
  }
  if (json.state === "not_entitled") {
    return { state: "not_entitled", pending: json.pending === true, hasLiveSubscription: json.hasLiveSubscription === true };
  }
  return { state: "error", error: str(json.error) ? json.error : `http_${httpStatus}` };
}

/** The sentence for an error code. Unknown codes get the generic one. */
export function errorKey(code: string): string {
  switch (code) {
    case "busy": return "genv3.wm.err.busy";
    case "stripe_unavailable": return "genv3.wm.err.stripeUnavailable";
    case "rate_limited": return "genv3.wm.err.rateLimited";
    case "trial_check_failed": return "genv3.wm.err.checkFailed";
    // The unlock COMMITTED; only the links could not be made. A retry (an
    // idempotent second unlock) answers with fresh ones.
    case "sign_failed": return "genv3.wm.err.signFailed";
    default: return "genv3.wm.err.generic";
  }
}

/* ── "Usuń znak wodny ze wszystkich" ─────────────────────────────────────── */

/** At most this many images may ever be skipped per call (the route's cap). */
export const BULK_SKIP_MAX = 200;
/** A ceiling on batches per run — far above any real library, so only a
 *  server that keeps answering "not done" without moving can reach it. */
export const BULK_MAX_BATCHES = 400;

export type BulkProgress = {
  bulkId: string | null;
  unlocked: number;
  failed: { assetId: string; reason: string }[];
  /** The server's count of locked originals still left (excluding the skipped). */
  remaining: number | null;
  /** "Odblokowano X z Y" — Y. */
  total: number;
  done: boolean;
  /** A batch that neither unlocked nor failed anything new: stop asking. */
  stalled: boolean;
  batches: number;
};

export const bulkStart = (expected: number): BulkProgress => ({
  bulkId: null, unlocked: 0, failed: [], remaining: null, total: Math.max(0, expected), done: false, stalled: false, batches: 0,
});

export function bulkAdvance(p: BulkProgress, r: Extract<TrialBulkResult, { state: "ok" }>): BulkProgress {
  // An image that failed before is not news: the skip list should have kept
  // it out, and counting it twice would push Y past the real number.
  const known = new Set(p.failed.map((f) => f.assetId));
  const fresh: BulkProgress["failed"] = [];
  for (const f of r.failed) {
    if (known.has(f.assetId)) continue;
    known.add(f.assetId);
    fresh.push(f);
  }
  const failed = [...p.failed, ...fresh];
  const unlocked = p.unlocked + r.unlocked.length;
  const moved = r.unlocked.length > 0 || fresh.length > 0;
  return {
    bulkId: r.bulkId, unlocked, failed, remaining: r.remaining,
    total: unlocked + failed.length + r.remaining,
    done: r.done, stalled: !r.done && !moved, batches: p.batches + 1,
  };
}

export const bulkContinues = (p: BulkProgress): boolean => !p.done && !p.stalled && p.batches < BULK_MAX_BATCHES;

/** The skip list for the next call: every image that already failed this run. */
export const bulkSkip = (p: BulkProgress): string[] => p.failed.slice(0, BULK_SKIP_MAX).map((f) => f.assetId);
