import { formatLaunchDate, type LaunchTokenValues } from "./tokens";

/**
 * THE PRE-LAUNCH CAMPAIGN AS A VISITOR MAY SEE IT.
 *
 * The values themselves (launch date, X, Y, early-access hours, the standard
 * credits the offer is compared with) live in the PRIVATE `prelaunch` settings
 * row, each behind an approval switch. The database hands the page only the
 * approved ones (prelaunch_public_config, migration 0144); this is their shape.
 */
export type PrelaunchPublicConfig = {
  /** ISO instant, only when approved AND still in the future. */
  launchAt: string | null;
  signupCredits: number | null;
  referralCredits: number | null;
  earlyAccessHours: number | null;
  /** The comparison figure ("instead of the standard N") — owner-approved. */
  standardCredits: number | null;
  priceLock: boolean;
  rewardsActive: boolean;
};

export const EMPTY_PRELAUNCH_CONFIG: PrelaunchPublicConfig = {
  launchAt: null, signupCredits: null, referralCredits: null, earlyAccessHours: null,
  standardCredits: null, priceLock: false, rewardsActive: false,
};

/**
 * NO EARLY-ACCESS MECHANISM EXISTS. Registration is one global switch
 * (platform_access): there is no way to let confirmed waitlist addresses in
 * 24 or 48 hours before everybody else. Until there is, the promise cannot be
 * shown — whatever the admin approves — exactly like the premiere price lock
 * in lib/server/pricing-offer.ts. Turning this on is a reviewed code change
 * together with the mechanism, never a setting.
 */
export const EARLY_ACCESS_SUPPORTED = false;

/** The token values a line may resolve against. Unapproved = absent. */
export function tokenValues(cfg: PrelaunchPublicConfig, locale: string, now: number = Date.now()): LaunchTokenValues {
  return {
    date: formatLaunchDate(cfg.launchAt, locale, now),
    credits: cfg.signupCredits,
    referral: cfg.referralCredits,
    hours: EARLY_ACCESS_SUPPORTED ? cfg.earlyAccessHours : null,
    standard: cfg.standardCredits,
  };
}

/** Parse the database's answer defensively: anything odd is "not approved". */
export function parsePublicConfig(raw: unknown): PrelaunchPublicConfig {
  if (!raw || typeof raw !== "object") return EMPTY_PRELAUNCH_CONFIG;
  const r = raw as Record<string, unknown>;
  const int = (v: unknown, max: number): number | null =>
    typeof v === "number" && Number.isInteger(v) && v > 0 && v <= max ? v : null;
  const at = typeof r.launch_at === "string" && Number.isFinite(Date.parse(r.launch_at)) ? r.launch_at : null;
  return {
    launchAt: at,
    signupCredits: int(r.signup_credits, 10000),
    referralCredits: int(r.referral_credits, 10000),
    earlyAccessHours: int(r.early_access_hours, 720),
    standardCredits: int(r.standard_credits, 10000),
    priceLock: r.price_lock === true,
    rewardsActive: r.rewards_active === true,
  };
}
