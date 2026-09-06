import "server-only";
import { cache } from "react";
import type { Client } from "@/lib/services/workspace";
import {
  BONUS_DEFAULTS, DEFAULT_QUESTIONS, EMPTY_COPY,
  type BonusConfig, type BonusCopy, type OfferView, type SurveyQuestion,
} from "@/lib/welcome-bonus";

/**
 * WELCOME BONUS — server side.
 *
 * Three jobs: read the campaign configuration, make sure a newly verified
 * account has an offer, and answer "what does this customer's offer look like
 * right now". Granting credits is NOT here — that is one SECURITY DEFINER
 * function (claim_welcome_bonus) doing the whole thing in one transaction, so
 * the lock, the survey write and the ledger entry cannot come apart.
 *
 * Failure posture matches the rest of the product: a broken config row means
 * the bonus is simply off, never a crash and never a database error shown to
 * a customer.
 */

export const BONUS_SETTINGS_KEY = "welcome_bonus";
export const BONUS_CONTENT_KEY = "welcome_bonus_content";

/** The store keeps flat scalars under one key (so the generic /admin/system
 *  editor can render them) and the structured half under another. */
type FlatRow = {
  active?: boolean; amount?: number; hours?: number;
  campaign_version?: number; icon?: string; badge?: string;
};
type ContentRow = {
  copy?: Partial<BonusCopy>;
  mobile_override?: boolean;
  mobile_copy?: Partial<BonusCopy>;
  questions?: SurveyQuestion[];
};

function coerceCopy(value: Partial<BonusCopy> | undefined): BonusCopy {
  const v = value ?? {};
  const str = (x: unknown) => (typeof x === "string" ? x.slice(0, 400) : "");
  return {
    notificationTitle: str(v.notificationTitle),
    notificationBody: str(v.notificationBody),
    modalTitle: str(v.modalTitle),
    modalSubtitle: str(v.modalSubtitle),
    cta: str(v.cta),
    successTitle: str(v.successTitle),
    successBody: str(v.successBody),
  };
}

/** A stored question list is only trusted as far as it type-checks; anything
 *  malformed falls back to the built-in set rather than rendering nothing. */
function coerceQuestions(value: unknown): SurveyQuestion[] {
  if (!Array.isArray(value) || value.length === 0) {
    return DEFAULT_QUESTIONS.map((q) => ({ ...q, options: [...q.options] }));
  }
  const out: SurveyQuestion[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const q = raw as Partial<SurveyQuestion>;
    if (typeof q.key !== "string" || q.key === "") continue;
    const type = q.type === "MULTI_SELECT" ? "MULTI_SELECT" : "SINGLE_SELECT";
    const options = Array.isArray(q.options)
      ? q.options
          .filter((o): o is { value: string; label?: string } =>
            Boolean(o) && typeof (o as { value?: unknown }).value === "string")
          .map((o) => ({ value: o.value.slice(0, 60), label: typeof o.label === "string" ? o.label.slice(0, 120) : undefined }))
      : [];
    if (options.length === 0) continue;
    out.push({
      key: q.key.slice(0, 60),
      type,
      label: typeof q.label === "string" ? q.label.slice(0, 200) : undefined,
      options,
      required: q.required === true,
      enabled: q.enabled !== false,
    });
  }
  return out.length > 0 ? out : DEFAULT_QUESTIONS.map((q) => ({ ...q, options: [...q.options] }));
}

/**
 * The campaign, as configured. One read per request — the layout, the modal
 * and the notification list all ask for it during the same render.
 */
export const getBonusConfig = cache(async (supabase: Client): Promise<BonusConfig> => {
  try {
    const { data, error } = await supabase
      .from("app_settings").select("key, value")
      .in("key", [BONUS_SETTINGS_KEY, BONUS_CONTENT_KEY]);
    if (error) return BONUS_DEFAULTS;
    const rows = new Map((data ?? []).map((r) => [r.key as string, r.value]));
    const flat = (rows.get(BONUS_SETTINGS_KEY) ?? {}) as FlatRow;
    const content = (rows.get(BONUS_CONTENT_KEY) ?? {}) as ContentRow;

    const int = (v: unknown, fallback: number, min: number, max: number) => {
      const n = typeof v === "number" ? v : Number.parseInt(String(v ?? ""), 10);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
    };
    return {
      active: flat.active !== false,
      amount: int(flat.amount, BONUS_DEFAULTS.amount, 1, 100_000),
      // A window shorter than an hour is almost certainly a typo, and one
      // longer than a month stops being a welcome offer.
      hours: int(flat.hours, BONUS_DEFAULTS.hours, 1, 24 * 30),
      campaignVersion: int(flat.campaign_version, 1, 1, 1_000_000),
      icon: typeof flat.icon === "string" ? flat.icon.slice(0, 500) : "",
      badge: typeof flat.badge === "string" && flat.badge.trim() !== ""
        ? flat.badge.trim().slice(0, 24) : BONUS_DEFAULTS.badge,
      copy: coerceCopy(content.copy),
      mobileOverride: content.mobile_override === true,
      mobileCopy: coerceCopy(content.mobile_copy),
      questions: coerceQuestions(content.questions),
    };
  } catch {
    return BONUS_DEFAULTS;
  }
});

/** Which copy applies on this surface. Mobile falls back to the desktop text
 *  field by field, so an admin who overrides one line does not have to retype
 *  the other six. */
export function copyFor(config: BonusConfig, mobile: boolean): BonusCopy {
  if (!mobile || !config.mobileOverride) return config.copy;
  const m = config.mobileCopy;
  const pick = (a: string, b: string) => (a.trim() !== "" ? a : b);
  return {
    notificationTitle: pick(m.notificationTitle, config.copy.notificationTitle),
    notificationBody: pick(m.notificationBody, config.copy.notificationBody),
    modalTitle: pick(m.modalTitle, config.copy.modalTitle),
    modalSubtitle: pick(m.modalSubtitle, config.copy.modalSubtitle),
    cta: pick(m.cta, config.copy.cta),
    successTitle: pick(m.successTitle, config.copy.successTitle),
    successBody: pick(m.successBody, config.copy.successBody),
  };
}

export type OfferRow = {
  id: string;
  user_id: string;
  campaign_version: number;
  reward_amount: number;
  eligible_at: string;
  expires_at: string;
  claimed_at: string | null;
  status: "ELIGIBLE" | "CLAIMED" | "EXPIRED";
};

/**
 * Make sure a qualifying account has an offer, then return it.
 *
 * Qualifying means: the campaign is on, the account's e-mail is verified, and
 * the account is NEW — created at or after the campaign started. §48: turning
 * the promotion on must not hand 150 credits to every existing customer, so
 * the cutoff is the campaign's own start, recorded the first time the config
 * was saved and defaulting to the offer table's creation date.
 *
 * The 72 hours run from VERIFICATION, not from opening the signup form: the
 * DB function stamps expires_at = eligible_at + hours once, and every later
 * read compares it against the server clock. Refreshing the page, reopening
 * the modal or changing the phone's date does nothing.
 */
export async function ensureOffer(
  supabase: Client,
  user: { id: string; email_confirmed_at?: string | null; created_at?: string },
  config: BonusConfig,
  campaignStart: string | null,
): Promise<OfferRow | null> {
  if (!config.active) return null;
  // Not verified yet — there is nothing to offer. The confirmation flow is
  // untouched; this simply waits for it.
  const verifiedAt = user.email_confirmed_at ?? null;
  if (!verifiedAt) return null;
  // §48 — accounts that predate the campaign are not in it.
  if (campaignStart && user.created_at && user.created_at < campaignStart) return null;

  try {
    const { data, error } = await supabase.rpc("ensure_welcome_bonus_offer", {
      p_user_id: user.id,
      p_amount: config.amount,
      p_hours: config.hours,
      p_campaign_version: config.campaignVersion,
      p_eligible_at: verifiedAt,
    });
    if (error) return null;
    return (data ?? null) as OfferRow | null;
  } catch {
    return null;
  }
}

/** Read an existing offer without creating one — for pages that only display. */
export async function readOffer(supabase: Client, userId: string): Promise<OfferRow | null> {
  try {
    const { data } = await supabase
      .from("welcome_bonus_offers")
      .select("id, user_id, campaign_version, reward_amount, eligible_at, expires_at, claimed_at, status")
      .eq("user_id", userId)
      .order("campaign_version", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data ?? null) as OfferRow | null;
  } catch {
    return null;
  }
}

/**
 * What the browser is told. `secondsLeft` is computed HERE, from the server's
 * own clock against the stored deadline — the client counts down from it for
 * presentation and re-reads it on every load.
 */
export function toView(offer: OfferRow, now = new Date()): OfferView {
  const expires = new Date(offer.expires_at).getTime();
  const secondsLeft = Math.max(0, Math.floor((expires - now.getTime()) / 1000));
  const status = offer.claimed_at
    ? "CLAIMED"
    : secondsLeft <= 0 ? "EXPIRED" : "ELIGIBLE";
  return { status, amount: offer.reward_amount, secondsLeft, expiresAt: offer.expires_at };
}

/** When the campaign started accepting accounts — the §48 cutoff. */
export async function getCampaignStart(supabase: Client): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("app_settings").select("value").eq(  "key", BONUS_CONTENT_KEY).maybeSingle();
    const started = (data?.value as { campaign_started_at?: unknown } | null)?.campaign_started_at;
    return typeof started === "string" && started !== "" ? started : null;
  } catch {
    return null;
  }
}

/**
 * The gift notification. One per offer: the insert is guarded by a lookup on
 * the same type + user, because the app layout runs on every navigation and a
 * customer must not accumulate a notification per page view.
 */
export const BONUS_NOTIFICATION_TYPE = "bonus";

export async function ensureBonusNotification(
  supabase: Client,
  userId: string,
  title: string,
  body: string,
): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("type", BONUS_NOTIFICATION_TYPE)
      .limit(1)
      .maybeSingle();
    if (existing) return;
    await supabase.from("notifications").insert({
      user_id: userId,
      type: BONUS_NOTIFICATION_TYPE,
      title: title.slice(0, 200),
      body: body.slice(0, 400),
      href: "/home?bonus=1",
    });
  } catch {
    // A notification that could not be written is not worth failing a page
    // render over — the modal opens on its own anyway.
  }
}

/** Remove the gift row once the offer is done, so a claimed or expired bonus
 *  does not sit in the bell for ever. */
export async function clearBonusNotification(supabase: Client, userId: string): Promise<void> {
  try {
    await supabase.from("notifications")
      .delete()
      .eq("user_id", userId)
      .eq("type", BONUS_NOTIFICATION_TYPE);
  } catch { /* best effort */ }
}
