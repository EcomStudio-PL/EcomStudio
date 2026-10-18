/**
 * TRIAL WATERMARK — the shapes shared by the server, the API and the UI.
 * Client-safe: no secrets, no paths of private objects, nothing that grants.
 */

/** What an asset's trial state looks like to its owner. */
export type TrialState =
  /** Watermarked; the clean original is kept and can be unlocked until `expiresAt`. */
  | "locked"
  /** Was a trial image; now an ordinary clean library file. */
  | "unlocked"
  /** Watermarked; the clean original no longer exists (retention ran out). */
  | "expired"
  /** Watermarked; no clean original can be offered (it was never stored or was removed). */
  | "unavailable";

export type GalleryTrial = {
  state: TrialState;
  /** ISO time the clean original stops being available (locked only). */
  expiresAt: string | null;
  /** Whole days left, rounded up; 0 on the last day's final hours never happens — expiry is exact. */
  daysLeft: number | null;
};

/** The 7 analytics events, written to activity_logs under exactly these names. */
export const TRIAL_WM_EVENTS = [
  "watermark_unlock_clicked",
  "watermark_paywall_opened",
  "watermark_plan_selected",
  "watermark_subscription_confirmed",
  "watermark_unlocked",
  "watermark_bulk_unlocked",
  "watermark_original_expired",
] as const;
export type TrialWmEvent = (typeof TRIAL_WM_EVENTS)[number];

/** Where an unlock was started — a closed set, recorded in analytics. */
export const TRIAL_UNLOCK_SURFACES = ["gallery", "lightbox", "library", "library_bulk", "checkout_return"] as const;
export type TrialUnlockSurface = (typeof TRIAL_UNLOCK_SURFACES)[number];

/** Result of POST /api/trial-originals/unlock. */
export type TrialUnlockResult =
  | {
      state: "unlocked";
      assetId: string;
      /** The asset's new storage path (the clean file). */
      path: string;
      /** Signed like the gallery (1 h) — for the patched card/lightbox. */
      url: string;
      thumbUrl: string;
      previewUrl: string;
      hasThumb: boolean;
      /** Short-lived (config TTL) link used only by the dialog's "Pobierz". */
      downloadUrl: string;
    }
  | { state: "not_entitled"; pending: boolean; hasLiveSubscription: boolean }
  | { state: "expired" | "unavailable" | "not_found" }
  | { state: "error"; error: string };

/** Result of GET /api/trial-originals/status. */
export type TrialStatusResult = {
  state: TrialState | "not_found";
  daysLeft: number | null;
  entitled: boolean;
  /** A plan purchase is being confirmed (webhook not yet applied). */
  pending: boolean;
  planSlug: string | null;
  thumbUrl: string | null;
  /** Only for an unlocked asset: a short-lived download link to the clean file. */
  downloadUrl: string | null;
};

/**
 * Everything GET /api/trial-originals/status answers with HTTP 200: the
 * state, or `{state:"error", error:"trial_check_failed"}` when the asset's
 * state or the entitlement could not be read (the dialog asks again).
 */
export type TrialStatusReply = TrialStatusResult | { state: "error"; error: string };

/** One batch of POST /api/trial-originals/unlock-all. */
export type TrialBulkResult =
  | {
      state: "ok";
      bulkId: string;
      unlocked: { assetId: string; path: string; url: string; thumbUrl: string; previewUrl: string; hasThumb: boolean }[];
      failed: { assetId: string; reason: string }[];
      remaining: number;
      done: boolean;
    }
  /** `assetId`: one locked image of the workspace, for the paywall when none was on screen. */
  | { state: "not_entitled"; pending: boolean; hasLiveSubscription: boolean; assetId?: string | null }
  | { state: "error"; error: string };

/** Plan cards for the paywall — real catalogue data, never hard-coded. */
export type TrialPaywallPlan = {
  id: string;
  slug: string;
  name: string;
  /** i18n key of the display name when the catalogue maps one (Agency → "Business"). */
  nameKey: string | null;
  priceCents: number;
  currency: string;
  monthlyCredits: number;
  bonusCredits: number;
  featured: boolean;
  payable: boolean;
  checkoutHref: string | null;
  capabilities: string[];
};

export type TrialPaywallResult =
  | { kind: "entitled" }
  | { kind: "not_locked"; state: TrialState | "not_found" }
  | {
      kind: "paywall";
      paywallId: string;
      daysLeft: number | null;
      plans: TrialPaywallPlan[];
      hasLiveSubscription: boolean;
      pending: boolean;
    }
  | { kind: "error" };

/** Whole days until `expiresAt`, rounded up; 0 when it has passed. */
export function daysUntil(expiresAt: string | null, now: number = Date.now()): number | null {
  if (!expiresAt) return null;
  const ms = Date.parse(expiresAt) - now;
  if (!Number.isFinite(ms)) return null;
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}
