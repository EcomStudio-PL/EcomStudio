/**
 * GROVNEWS MONETISATION — the pure rules, shared by the admin screens, the
 * server actions and the tests. No database, no Stripe: the enforcement lives
 * in migration 0123 and lib/server/grovnews-billing.ts. These functions only
 * turn what an admin typed into the one shape the database accepts, so a bad
 * value is refused before it travels anywhere.
 */

import { isUuid } from "@/lib/grovnews";

export const LAUNCH_STATUSES = ["DRAFT", "ACTIVE", "ENDED", "DISABLED"] as const;
export type LaunchStatus = (typeof LAUNCH_STATUSES)[number];

export const ACCESS_MODES = ["DAYS", "FOREVER", "UNTIL"] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];

export const DISCOUNT_TYPES = ["PERCENT", "AMOUNT"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const DISCOUNT_DURATIONS = ["ONCE", "REPEATING"] as const;
export type DiscountDuration = (typeof DISCOUNT_DURATIONS)[number];

/** Launch window presets, in hours from the start. */
export const WINDOW_PRESETS = ["24", "48", "120", "custom"] as const;
export type WindowPreset = (typeof WINDOW_PRESETS)[number];

/** Launch access presets: days, forever, or a custom number of days / a date. */
export const ACCESS_PRESETS = ["30", "90", "365", "forever", "days", "until"] as const;
export type AccessPreset = (typeof ACCESS_PRESETS)[number];

export const PRICE_MIN_CENTS = 200;
export const PRICE_MAX_CENTS = 1_000_000;

/**
 * "29", "29.9", "29,90" → 2990 grosze. Anything else — negative, three
 * decimals, letters, beyond the bounds — is null. Parsed from the digits, not
 * through a float, so 19.99 is 1999 and never 1998.
 */
export function parsePriceZl(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const text = String(raw).trim().replace(",", ".");
  const m = /^(\d{1,5})(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return cents >= PRICE_MIN_CENTS && cents <= PRICE_MAX_CENTS ? cents : null;
}

export type LaunchCampaignInput = {
  name: string;
  window_start: string;
  window_end: string;
  access_mode: AccessMode;
  access_days: number | null;
  access_until: string | null;
  discount_enabled: boolean;
  discount_type: DiscountType | null;
  /** PERCENT: 1–90. AMOUNT: grosze. */
  discount_value: number | null;
  discount_duration: DiscountDuration | null;
  discount_months: number | null;
  eligible_plan_ids: string[];
  code_valid_days: number | null;
};

export type LaunchInputError =
  | "name" | "window" | "access" | "discount" | "months" | "plans" | "validity";

const int = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isSafeInteger(n) ? n : null;
};
const date = (v: unknown): Date | null => {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** An admin's campaign form, as the one shape grovnews_launch_save accepts. */
export function parseLaunchCampaignInput(raw: unknown):
  { ok: true; value: LaunchCampaignInput } | { ok: false; error: LaunchInputError } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "name" };
  const r = raw as Record<string, unknown>;

  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (name.length < 1 || name.length > 120) return { ok: false, error: "name" };

  const start = date(r.window_start);
  const end = date(r.window_end);
  if (!start || !end || end.getTime() <= start.getTime()) return { ok: false, error: "window" };

  const mode = (ACCESS_MODES as readonly string[]).includes(String(r.access_mode)) ? r.access_mode as AccessMode : null;
  if (!mode) return { ok: false, error: "access" };
  const days = mode === "DAYS" ? int(r.access_days) : null;
  const until = mode === "UNTIL" ? date(r.access_until) : null;
  if (mode === "DAYS" && (days === null || days < 1 || days > 3650)) return { ok: false, error: "access" };
  if (mode === "UNTIL" && !until) return { ok: false, error: "access" };

  const enabled = r.discount_enabled === true;
  let discount: Pick<LaunchCampaignInput, "discount_type" | "discount_value" | "discount_duration"
    | "discount_months" | "eligible_plan_ids" | "code_valid_days"> = {
    discount_type: null, discount_value: null, discount_duration: null, discount_months: null,
    eligible_plan_ids: [], code_valid_days: null,
  };
  if (enabled) {
    const type = (DISCOUNT_TYPES as readonly string[]).includes(String(r.discount_type)) ? r.discount_type as DiscountType : null;
    const value = int(r.discount_value);
    if (!type || value === null || value < 1
        || (type === "PERCENT" && value > 90) || (type === "AMOUNT" && value > PRICE_MAX_CENTS)) {
      return { ok: false, error: "discount" };
    }
    const duration = (DISCOUNT_DURATIONS as readonly string[]).includes(String(r.discount_duration))
      ? r.discount_duration as DiscountDuration : null;
    const months = duration === "REPEATING" ? int(r.discount_months) : null;
    if (!duration || (duration === "REPEATING" && (months === null || months < 1 || months > 12))) {
      return { ok: false, error: "months" };
    }
    const plans = Array.isArray(r.eligible_plan_ids) ? [...new Set(r.eligible_plan_ids)] : [];
    if (plans.length < 1 || plans.length > 10 || !plans.every(isUuid)) return { ok: false, error: "plans" };
    const validity = int(r.code_valid_days);
    if (validity === null || validity < 1 || validity > 365) return { ok: false, error: "validity" };
    discount = {
      discount_type: type, discount_value: value, discount_duration: duration, discount_months: months,
      eligible_plan_ids: plans as string[], code_valid_days: validity,
    };
  }

  return {
    ok: true,
    value: {
      name,
      window_start: start.toISOString(),
      window_end: end.toISOString(),
      access_mode: mode,
      access_days: days,
      access_until: until ? until.toISOString() : null,
      discount_enabled: enabled,
      ...discount,
    },
  };
}

/** The first charge after a discount — the same arithmetic the database uses
 *  to refuse a code whose first charge would fall under 2 zł. Display only. */
export function discountedCents(priceCents: number, type: DiscountType, value: number): number {
  return type === "PERCENT" ? priceCents - Math.round((priceCents * value) / 100) : priceCents - value;
}

/** Money for display, in the viewer's language. */
export function formatMoney(cents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale === "en" ? "en-GB" : locale === "de" ? "de-DE" : "pl-PL", {
    style: "currency", currency: currency || "PLN", minimumFractionDigits: 2,
  }).format(cents / 100);
}

/** A date for the customer, always in Warsaw time (stored in UTC). */
export function formatWarsawDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale === "de" ? "de-DE" : "pl-PL", {
    timeZone: "Europe/Warsaw", day: "numeric", month: "long", year: "numeric",
  }).format(new Date(iso));
}

/* ── the customer's own state (grovnews_my_state) ───────────────────────────── */

export type LaunchView = {
  accessGranted: boolean;
  accessUntil: string | null;
  forever: boolean;
  code: string | null;
  codeExpiresAt: string | null;
  codeRedeemed: boolean;
  discountType: DiscountType | null;
  discountValue: number | null;
  discountDuration: DiscountDuration | null;
  discountMonths: number | null;
  plans: string[];
};

export type PaidView = {
  status: string;
  priceCents: number | null;
  currency: string;
  currentPeriodEnd: string | null;
  paidThrough: string | null;
  cancelAtPeriodEnd: boolean;
  live: boolean;
  hasAccess: boolean;
};

export type GrovNewsState = {
  access: boolean;
  sources: string[];
  offer: { available: boolean; priceCents: number | null; currency: string };
  paid: PaidView | null;
  launch: LaunchView | null;
};

const s = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** grovnews_my_state()'s JSON, read defensively into one typed shape. */
export function parseGrovNewsState(raw: unknown): GrovNewsState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const offer = (r.offer ?? {}) as Record<string, unknown>;
  const paid = r.paid && typeof r.paid === "object" ? r.paid as Record<string, unknown> : null;
  const launch = r.launch && typeof r.launch === "object" ? r.launch as Record<string, unknown> : null;
  return {
    access: r.access === true,
    sources: Array.isArray(r.sources) ? r.sources.filter((x): x is string => typeof x === "string") : [],
    offer: { available: offer.available === true, priceCents: n(offer.price_cents), currency: s(offer.currency) ?? "PLN" },
    paid: paid ? {
      status: s(paid.status) ?? "incomplete",
      priceCents: n(paid.price_cents),
      currency: s(paid.currency) ?? "PLN",
      currentPeriodEnd: s(paid.current_period_end),
      paidThrough: s(paid.paid_through),
      cancelAtPeriodEnd: paid.cancel_at_period_end === true,
      live: paid.live === true,
      hasAccess: paid.has_access === true,
    } : null,
    launch: launch ? {
      accessGranted: launch.access_granted === true,
      accessUntil: s(launch.access_expires_at),
      forever: launch.forever === true,
      code: s(launch.code),
      codeExpiresAt: s(launch.code_expires_at),
      codeRedeemed: launch.code_redeemed === true,
      discountType: (DISCOUNT_TYPES as readonly string[]).includes(String(launch.discount_type)) ? launch.discount_type as DiscountType : null,
      discountValue: n(launch.discount_value),
      discountDuration: (DISCOUNT_DURATIONS as readonly string[]).includes(String(launch.discount_duration)) ? launch.discount_duration as DiscountDuration : null,
      discountMonths: n(launch.discount_months),
      plans: Array.isArray(launch.plans) ? launch.plans.filter((x): x is string => typeof x === "string") : [],
    } : null,
  };
}

/* ── Warsaw wall-clock ⇄ UTC (the admin types Warsaw time; storage is UTC) ── */

const WARSAW = "Europe/Warsaw";

function warsawParts(at: Date): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: WARSAW, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const out: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") out[p.type] = Number(p.value);
  return out;
}

/** Minutes Warsaw is ahead of UTC at that instant (60 in winter, 120 in summer). */
function warsawOffsetMinutes(at: Date): number {
  const p = warsawParts(at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** "2026-10-01T09:30" typed as Warsaw time → ISO in UTC, or null. */
export function warsawLocalToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  // Two passes: the offset at the guess, then at the corrected instant (DST edges).
  let at = guess - warsawOffsetMinutes(new Date(guess)) * 60000;
  at = guess - warsawOffsetMinutes(new Date(at)) * 60000;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO (UTC) → "YYYY-MM-DDTHH:mm" in Warsaw time, for a datetime-local input. */
export function isoToWarsawLocal(iso: string): string {
  const p = warsawParts(new Date(iso));
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Numeric Warsaw date-time for admin tables ("01.10.2026, 09:30"): the same in
 *  the server render and the browser, so it never causes a hydration error. */
export function formatWarsawNumeric(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale === "de" ? "de-DE" : "pl-PL", {
    timeZone: WARSAW, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}
