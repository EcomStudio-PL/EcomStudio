/**
 * WELCOME BONUS — the shape of the offer, shared by client and server.
 *
 * Client-safe on purpose: the modal, the notification row and the admin
 * preview all render from these types, while everything that touches the
 * database or grants credits lives in lib/server/welcome-bonus.ts.
 *
 * The survey questions are DATA, not markup. An admin can rename a question,
 * reorder it, add options or switch it off; what they cannot do is inject
 * anything that renders as anything other than text on a chip.
 */

export type QuestionType = "SINGLE_SELECT" | "MULTI_SELECT";

export type SurveyOption = {
  /** Stored answer value — stable, so renaming a label keeps old data legible. */
  value: string;
  /** What the chip says. Falls back to the i18n default when the admin has
   *  not overridden it. */
  label?: string;
};

export type SurveyQuestion = {
  key: string;
  type: QuestionType;
  /** Admin override; empty means "use the built-in translated copy". */
  label?: string;
  options: SurveyOption[];
  required: boolean;
  enabled: boolean;
};

/**
 * The default survey. Question one is the acquisition source that used to sit
 * in the signup form — asked here instead, where answering it is worth 150
 * credits to the customer rather than being one more box before they have an
 * account at all.
 */
export const DEFAULT_QUESTIONS: readonly SurveyQuestion[] = [
  {
    key: "acquisition_source",
    type: "SINGLE_SELECT",
    required: true,
    enabled: true,
    options: [
      { value: "google" }, { value: "youtube" }, { value: "tiktok_instagram" },
      { value: "facebook" }, { value: "referral" }, { value: "other" },
    ],
  },
  {
    key: "sales_channels",
    type: "MULTI_SELECT",
    required: false,
    enabled: true,
    options: [
      { value: "allegro" }, { value: "amazon" }, { value: "shopify" },
      { value: "woocommerce" }, { value: "etsy" }, { value: "own_store" },
      { value: "not_selling_yet" }, { value: "other" },
    ],
  },
  {
    key: "product_categories",
    type: "MULTI_SELECT",
    required: false,
    enabled: true,
    options: [
      { value: "fashion" }, { value: "home" }, { value: "electronics" },
      { value: "beauty" }, { value: "food" }, { value: "sport" },
      { value: "kids" }, { value: "automotive" }, { value: "other" },
    ],
  },
  {
    key: "primary_use_cases",
    type: "MULTI_SELECT",
    required: false,
    enabled: true,
    options: [
      { value: "product_photos" }, { value: "social" }, { value: "marketplace" },
      { value: "ads" }, { value: "video" }, { value: "editing" },
    ],
  },
] as const;

/** Copy an admin may override. Empty string = use the translated default. */
export type BonusCopy = {
  notificationTitle: string;
  notificationBody: string;
  modalTitle: string;
  modalSubtitle: string;
  cta: string;
  successTitle: string;
  successBody: string;
};

export const EMPTY_COPY: BonusCopy = {
  notificationTitle: "", notificationBody: "", modalTitle: "",
  modalSubtitle: "", cta: "", successTitle: "", successBody: "",
};

export type BonusConfig = {
  active: boolean;
  amount: number;
  hours: number;
  campaignVersion: number;
  /** Media-library URL for the gift icon; empty falls back to the system one. */
  icon: string;
  badge: string;
  copy: BonusCopy;
  /** Only used when `mobileOverride` is on — otherwise mobile reads `copy`. */
  mobileOverride: boolean;
  mobileCopy: BonusCopy;
  questions: SurveyQuestion[];
};

export const BONUS_DEFAULTS: BonusConfig = {
  active: true,
  amount: 150,
  hours: 72,
  campaignVersion: 1,
  icon: "",
  badge: "BONUS",
  copy: EMPTY_COPY,
  mobileOverride: false,
  mobileCopy: EMPTY_COPY,
  questions: DEFAULT_QUESTIONS.map((q) => ({ ...q, options: [...q.options] })),
};

/** What the customer's browser is allowed to know about their own offer. */
export type OfferView = {
  status: "ELIGIBLE" | "CLAIMED" | "EXPIRED";
  amount: number;
  /** Seconds left, computed on the SERVER. The countdown ticks this down for
   *  presentation only — a page refresh re-reads it, and a device clock has no
   *  say in whether the offer is still open. */
  secondsLeft: number;
  expiresAt: string;
};

/* ── placeholders ───────────────────────────────────────────────────────── */

/**
 * The whitelist. Admin copy may reference these and nothing else — an unknown
 * {{token}} is left exactly as typed rather than resolved, so a typo shows up
 * as a typo instead of silently rendering someone else's data.
 *
 * No eval, no Function, no template engine: this is a lookup in a map.
 */
export const BONUS_PLACEHOLDERS = ["credits", "hours", "first_name", "expires_at"] as const;
export type BonusPlaceholder = (typeof BONUS_PLACEHOLDERS)[number];

export function renderPlaceholders(
  text: string,
  values: Partial<Record<BonusPlaceholder, string | number>>,
): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, raw: string) => {
    const key = raw.toLowerCase() as BonusPlaceholder;
    if (!(BONUS_PLACEHOLDERS as readonly string[]).includes(key)) return whole;
    const value = values[key];
    return value === undefined || value === null ? whole : String(value);
  });
}

/* ── countdown ──────────────────────────────────────────────────────────── */

/**
 * "How long is left" at two levels of precision, because the two places that
 * show it want different things: the notification list wants a glanceable
 * phrase, the modal wants an actual clock.
 *
 * Both take SECONDS FROM THE SERVER. Neither reads the device clock.
 */
export function remainingParts(seconds: number): { d: number; h: number; m: number; s: number } {
  const total = Math.max(0, Math.floor(seconds));
  return {
    d: Math.floor(total / 86400),
    h: Math.floor((total % 86400) / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}

/** mm:ss precision for the modal — "71:42:18". */
export function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * Which phrasing the notification list should use, per §55: days while there
 * is more than a day, hours and minutes under a day, minutes only under an
 * hour. Returns the i18n key plus its values, so the caller translates.
 */
export function remainingPhrase(seconds: number): { key: string; values: Record<string, number> } {
  const { d, h, m } = remainingParts(seconds);
  if (seconds <= 0) return { key: "bonus.leftNone", values: {} };
  if (d >= 1) return { key: "bonus.leftDays", values: { n: d + (h >= 12 ? 1 : 0) } };
  if (h >= 1) return { key: "bonus.leftHours", values: { h, m } };
  return { key: "bonus.leftMinutes", values: { m: Math.max(1, m) } };
}

/* ── validation ─────────────────────────────────────────────────────────── */

/** The answers a claim is allowed to carry: known questions, known options,
 *  and every enabled+required question actually answered. The server runs
 *  this before it will grant anything. */
export function validateAnswers(
  questions: readonly SurveyQuestion[],
  answers: Record<string, string[]>,
): { ok: true; clean: Record<string, string[]> } | { ok: false; missing: string } {
  const clean: Record<string, string[]> = {};
  for (const q of questions) {
    if (!q.enabled) continue;
    const allowed = new Set(q.options.map((o) => o.value));
    // Unknown option values are dropped, not rejected: an admin editing the
    // options while someone has the modal open should not fail their claim.
    const picked = (answers[q.key] ?? []).filter((v) => allowed.has(v));
    const limited = q.type === "SINGLE_SELECT" ? picked.slice(0, 1) : picked.slice(0, 12);
    if (q.required && limited.length === 0) return { ok: false, missing: q.key };
    if (limited.length > 0) clean[q.key] = limited;
  }
  return { ok: true, clean };
}
