import { EARLY_ACCESS_SUPPORTED } from "@/lib/launch/campaign";

/**
 * THE PRE-LAUNCH CAMPAIGN SETTINGS — the private `prelaunch` row, as the admin
 * edits it.
 *
 * CLIENT-SAFE ON PURPOSE (no "server-only", no server imports): the panel in
 * Strony WWW validates with exactly the rules the save action applies, so the
 * field that is wrong says so before anything is sent, and the "visible on the
 * page" summary is computed by the same function the server would use. The
 * same split as lib/trial-watermark/config.ts.
 *
 * WHAT THIS ROW DECIDES. Every number the landing page may promise — the launch
 * date, X (credits at start), Y (credits per confirmed referral), the standard
 * figure X is compared with — sits here next to its own approval switch.
 * prelaunch_public_config (0144) hands the page only the approved ones, and
 * the SQL re-validates each value against the same ranges (anything out of
 * range is "not approved", S5). The generic /admin/system editor neither lists
 * nor writes this row (PRELAUNCH_SETTING_KEY below).
 *
 * WHAT IT NEVER TOUCHES. Registration itself (platform_access) is read for a
 * warning and never written; the price-lock promise can only be approved while
 * the pricing offer really runs a premiere; early access cannot be approved at
 * all while no mechanism exists (EARLY_ACCESS_SUPPORTED, lib/launch/campaign.ts).
 */

export const PRELAUNCH_SETTING_KEY = "prelaunch";

export type PrelaunchCampaignConfig = {
  /** ISO instant with offset, e.g. "2026-11-20T10:00:00+01:00". */
  launchAt: string | null;
  launchAtApproved: boolean;
  signupCredits: number | null;
  signupCreditsApproved: boolean;
  referralCredits: number | null;
  referralCreditsApproved: boolean;
  /** The comparison figure in "Zamiast standardowych {standard}" — owner-entered (D2). */
  standardCredits: number | null;
  standardCreditsApproved: boolean;
  /** Rewarded referrals per person. */
  referralCap: number;
  earlyAccessHours: number | null;
  earlyAccessApproved: boolean;
  priceLockApproved: boolean;
  /** Credits are actually granted (prelaunch_reward_ensure). */
  rewardsActive: boolean;
  /** No new reward claims after this instant (D6). */
  rewardClaimUntil: string | null;
  /** Lifetime of a double opt-in link. */
  optinTtlHours: number;
  /** Global double opt-in mails per hour (S13). */
  optinHourlyCap: number;
};

export const PRELAUNCH_DEFAULTS: PrelaunchCampaignConfig = {
  launchAt: null, launchAtApproved: false,
  signupCredits: null, signupCreditsApproved: false,
  referralCredits: null, referralCreditsApproved: false,
  standardCredits: null, standardCreditsApproved: false,
  referralCap: 10,
  earlyAccessHours: null, earlyAccessApproved: false,
  priceLockApproved: false,
  rewardsActive: false,
  rewardClaimUntil: null,
  optinTtlHours: 72,
  optinHourlyCap: 300,
};

/** Integer ranges — §1.1 / R2.1, mirrored by the SQL clamps. */
export const PRELAUNCH_RANGES = {
  signupCredits: { min: 0, max: 10000 },
  referralCredits: { min: 0, max: 10000 },
  standardCredits: { min: 0, max: 10000 },
  referralCap: { min: 0, max: 1000 },
  earlyAccessHours: { min: 1, max: 720 },
  optinTtlHours: { min: 1, max: 336 },
  optinHourlyCap: { min: 1, max: 10000 },
} as const;
export type RangedField = keyof typeof PRELAUNCH_RANGES;

/** The stored key of every value this panel owns. Anything else on the row
 *  (v, campaign, survey_bonus_policy, marketing_required,
 *  referral_requires_account — owner and legal decisions) is kept as stored. */
const STORED: Record<keyof PrelaunchCampaignConfig, string> = {
  launchAt: "launch_at", launchAtApproved: "launch_at_approved",
  signupCredits: "signup_credits", signupCreditsApproved: "signup_credits_approved",
  referralCredits: "referral_credits", referralCreditsApproved: "referral_credits_approved",
  standardCredits: "standard_credits", standardCreditsApproved: "standard_credits_approved",
  referralCap: "referral_cap",
  earlyAccessHours: "early_access_hours", earlyAccessApproved: "early_access_approved",
  priceLockApproved: "price_lock_approved",
  rewardsActive: "rewards_active",
  rewardClaimUntil: "reward_claim_until",
  optinTtlHours: "optin_ttl_hours",
  optinHourlyCap: "optin_hourly_cap",
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const intIn = (v: unknown, r: { min: number; max: number }): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= r.min && v <= r.max ? v : null;
const instant = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" && Number.isFinite(Date.parse(v)) ? v.trim() : null;

/** The stored row, read leniently: anything malformed is the default, and an
 *  approval is only as good as the value it approves. */
export function parsePrelaunchCampaign(raw: unknown): PrelaunchCampaignConfig {
  if (!isObj(raw)) return { ...PRELAUNCH_DEFAULTS };
  const R = PRELAUNCH_RANGES;
  return {
    launchAt: instant(raw.launch_at),
    launchAtApproved: raw.launch_at_approved === true,
    signupCredits: intIn(raw.signup_credits, R.signupCredits),
    signupCreditsApproved: raw.signup_credits_approved === true,
    referralCredits: intIn(raw.referral_credits, R.referralCredits),
    referralCreditsApproved: raw.referral_credits_approved === true,
    standardCredits: intIn(raw.standard_credits, R.standardCredits),
    standardCreditsApproved: raw.standard_credits_approved === true,
    referralCap: intIn(raw.referral_cap, R.referralCap) ?? PRELAUNCH_DEFAULTS.referralCap,
    earlyAccessHours: intIn(raw.early_access_hours, R.earlyAccessHours),
    earlyAccessApproved: raw.early_access_approved === true,
    priceLockApproved: raw.price_lock_approved === true,
    rewardsActive: raw.rewards_active === true,
    rewardClaimUntil: instant(raw.reward_claim_until),
    optinTtlHours: intIn(raw.optin_ttl_hours, R.optinTtlHours) ?? PRELAUNCH_DEFAULTS.optinTtlHours,
    optinHourlyCap: intIn(raw.optin_hourly_cap, R.optinHourlyCap) ?? PRELAUNCH_DEFAULTS.optinHourlyCap,
  };
}

/** The row to store: the stored row with this panel's keys replaced. */
export function serializePrelaunchCampaign(config: PrelaunchCampaignConfig, stored: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = isObj(stored) ? { ...stored } : {};
  for (const [field, key] of Object.entries(STORED) as [keyof PrelaunchCampaignConfig, string][]) {
    out[key] = config[field];
  }
  return out;
}

/* ── Europe/Warsaw wall clock ────────────────────────────────────────────── */

const ZONE = "Europe/Warsaw";
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The Warsaw wall clock at an instant, as a UTC-epoch number of the same
 *  digits (so two wall clocks compare with ===). */
function warsawWall(at: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(at)).map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
}

export type WarsawResult =
  | { ok: true; iso: string; ms: number }
  | { ok: false; reason: "format" | "nonexistent" | "ambiguous" };

/**
 * "2026-11-20" + "10:00" in POLISH time → an instant, on the server's clock
 * rules rather than the admin's browser (the CMS datetime field converts with
 * the browser's zone, which is wrong for an admin abroad).
 *
 * Warsaw is UTC+1 in winter and UTC+2 in summer, so a wall-clock time maps to
 * the instants `wall − 1 h` and `wall − 2 h`; whichever of them reads back as
 * the same wall clock is the answer. On the spring-forward night (e.g.
 * 2027-03-28 02:30) NEITHER does — that time never happens; on the fall-back
 * night (e.g. 2026-10-25 02:30) BOTH do — it happens twice. Both are refused
 * rather than guessed: a launch announced for a moment that does not exist, or
 * exists twice, is a countdown nobody can trust.
 */
export function warsawToInstant(date: string, time: string): WarsawResult {
  const d = DATE_RE.exec(date.trim());
  const t = TIME_RE.exec(time.trim());
  if (!d || !t) return { ok: false, reason: "format" };
  const [y, mo, day, h, mi] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])];
  if (y < 2020 || y > 2100) return { ok: false, reason: "format" };
  const wall = Date.UTC(y, mo - 1, day, h, mi);
  const check = new Date(wall);
  // 2026-02-30 would silently become 2 March.
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== day) {
    return { ok: false, reason: "format" };
  }
  const hits = [1, 2].filter((offset) => warsawWall(wall - offset * 3_600_000) === wall);
  if (hits.length === 0) return { ok: false, reason: "nonexistent" };
  if (hits.length > 1) return { ok: false, reason: "ambiguous" };
  const offset = hits[0]!;
  return { ok: true, iso: `${d[0]}T${t[0]}:00+0${offset}:00`, ms: wall - offset * 3_600_000 };
}

/** An instant → its Warsaw date and time, for the form. */
export function instantToWarsaw(iso: string | null): { date: string; time: string } | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const wall = new Date(warsawWall(ms)).toISOString();
  return { date: wall.slice(0, 10), time: wall.slice(11, 16) };
}

/* ── the save input ─────────────────────────────────────────────────────── */

export type WallInput = { date: string; time: string };

/** What the panel sends. Numbers are numbers (or null for "empty"). */
export type PrelaunchCampaignInput = {
  launch: WallInput & { approved: boolean };
  signupCredits: { value: number | null; approved: boolean };
  referralCredits: { value: number | null; approved: boolean };
  standardCredits: { value: number | null; approved: boolean };
  referralCap: number | null;
  priceLockApproved: boolean;
  rewardsActive: boolean;
  /** Empty date AND time = no end. */
  rewardClaimUntil: WallInput;
  optinTtlHours: number | null;
  optinHourlyCap: number | null;
};

export type CampaignField =
  | "launch" | "signupCredits" | "referralCredits" | "standardCredits" | "referralCap"
  | "priceLock" | "earlyAccess" | "rewardsActive" | "rewardClaimUntil" | "optinTtlHours" | "optinHourlyCap";

export type CampaignInvalidReason =
  | "shape" | "range" | "required" | "format" | "nonexistent" | "ambiguous" | "past"
  | "unsupported" | "not_above_standard";

export type CampaignValidation =
  | { ok: true; config: PrelaunchCampaignConfig }
  | { ok: false; field: CampaignField; reason: CampaignInvalidReason };

export type CampaignContext = {
  now: number;
  /** premiereState(now) from lib/server/pricing-offer.ts is "active". */
  premiereActive: boolean;
  /** user_defaults.welcome_credits — what an account really gets at birth. */
  welcomeCredits: number | null;
  /** The row as stored before this save. */
  before: PrelaunchCampaignConfig;
};

const bad = (field: CampaignField, reason: CampaignInvalidReason): CampaignValidation => ({ ok: false, field, reason });
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isWall = (v: unknown): v is WallInput => isObj(v) && typeof v.date === "string" && typeof v.time === "string";
const isLaunch = (v: unknown): v is WallInput & { approved: boolean } => isWall(v) && isBool((v as { approved?: unknown }).approved);

/**
 * STRICT: one wrong field and nothing is saved. The order of the fields is the
 * order of the form, so the first error reported is the first one on screen.
 *
 *  · an empty value can never be approved (`required`) — nor can 0 credits,
 *    which the page would otherwise print as a promise of nothing;
 *  · X must beat what an account already gets at birth (D2.3), or the offer
 *    line "N kredytów na start" is not an offer;
 *  · a launch date is approved only for the future, unless it is the one
 *    already approved and untouched (saving another field after launch day
 *    must not be blocked by the date that just passed);
 *  · the price lock can be switched ON only while the premiere offer runs;
 *  · early access is not editable at all while unsupported: the stored values
 *    are kept exactly as they are.
 */
export function validatePrelaunchCampaignInput(raw: unknown, ctx: CampaignContext): CampaignValidation {
  if (!isObj(raw)) return bad("launch", "shape");
  const input = raw as Partial<Record<keyof PrelaunchCampaignInput, unknown>>;
  const R = PRELAUNCH_RANGES;
  const { before } = ctx;

  // Launch date.
  const launch = input.launch;
  if (!isLaunch(launch)) return bad("launch", "shape");
  let launchAt: string | null = null;
  if (launch.date.trim() !== "" || launch.time.trim() !== "") {
    const w = warsawToInstant(launch.date, launch.time);
    if (!w.ok) return bad("launch", w.reason);
    launchAt = w.iso;
    const unchanged = before.launchAtApproved && before.launchAt !== null && Date.parse(before.launchAt) === w.ms;
    if (launch.approved && w.ms <= ctx.now && !unchanged) return bad("launch", "past");
  }
  if (launch.approved && launchAt === null) return bad("launch", "required");

  // Credits: value + approval each.
  const credits = (field: "signupCredits" | "referralCredits" | "standardCredits"): CampaignValidation | { value: number | null; approved: boolean } => {
    const v = input[field];
    if (!isObj(v) || !isBool(v.approved) || !(v.value === null || typeof v.value === "number")) return bad(field, "shape");
    const value = v.value === null ? null : intIn(v.value, R[field]);
    if (v.value !== null && value === null) return bad(field, "range");
    if (v.approved && (value === null || value <= 0)) return bad(field, "required");
    return { value, approved: v.approved };
  };
  const signup = credits("signupCredits");
  if ("ok" in signup) return signup;
  if (signup.approved && ctx.welcomeCredits !== null && (signup.value ?? 0) <= ctx.welcomeCredits) {
    return bad("signupCredits", "not_above_standard");
  }
  const referral = credits("referralCredits");
  if ("ok" in referral) return referral;
  const standard = credits("standardCredits");
  if ("ok" in standard) return standard;

  const cap = intIn(input.referralCap, R.referralCap);
  if (cap === null) return bad("referralCap", typeof input.referralCap === "number" ? "range" : "shape");

  // Price lock: ON only while a premiere runs; an existing ON may be kept.
  if (!isBool(input.priceLockApproved)) return bad("priceLock", "shape");
  if (input.priceLockApproved && !before.priceLockApproved && !ctx.premiereActive) return bad("priceLock", "unsupported");

  if (!isBool(input.rewardsActive)) return bad("rewardsActive", "shape");

  const until = input.rewardClaimUntil;
  if (!isWall(until)) return bad("rewardClaimUntil", "shape");
  let rewardClaimUntil: string | null = null;
  if (until.date.trim() !== "" || until.time.trim() !== "") {
    const w = warsawToInstant(until.date, until.time);
    if (!w.ok) return bad("rewardClaimUntil", w.reason);
    rewardClaimUntil = w.iso;
  }

  const ttl = intIn(input.optinTtlHours, R.optinTtlHours);
  if (ttl === null) return bad("optinTtlHours", typeof input.optinTtlHours === "number" ? "range" : "shape");
  const hourly = intIn(input.optinHourlyCap, R.optinHourlyCap);
  if (hourly === null) return bad("optinHourlyCap", typeof input.optinHourlyCap === "number" ? "range" : "shape");

  return {
    ok: true,
    config: {
      launchAt,
      launchAtApproved: launch.approved,
      signupCredits: signup.value,
      signupCreditsApproved: signup.approved,
      referralCredits: referral.value,
      referralCreditsApproved: referral.approved,
      standardCredits: standard.value,
      standardCreditsApproved: standard.approved,
      referralCap: cap,
      // Not editable while no mechanism exists (EARLY_ACCESS_SUPPORTED) —
      // kept exactly as stored. Making it editable is part of the reviewed
      // change that builds the mechanism, together with its input field.
      earlyAccessHours: before.earlyAccessHours,
      earlyAccessApproved: before.earlyAccessApproved,
      priceLockApproved: input.priceLockApproved,
      rewardsActive: input.rewardsActive,
      rewardClaimUntil,
      optinTtlHours: ttl,
      optinHourlyCap: hourly,
    },
  };
}

/** The form's view of a stored config. */
export function campaignInputFrom(config: PrelaunchCampaignConfig): PrelaunchCampaignInput {
  const launch = instantToWarsaw(config.launchAt);
  const until = instantToWarsaw(config.rewardClaimUntil);
  return {
    launch: { date: launch?.date ?? "", time: launch?.time ?? "", approved: config.launchAtApproved },
    signupCredits: { value: config.signupCredits, approved: config.signupCreditsApproved },
    referralCredits: { value: config.referralCredits, approved: config.referralCreditsApproved },
    standardCredits: { value: config.standardCredits, approved: config.standardCreditsApproved },
    referralCap: config.referralCap,
    priceLockApproved: config.priceLockApproved,
    rewardsActive: config.rewardsActive,
    rewardClaimUntil: { date: until?.date ?? "", time: until?.time ?? "" },
    optinTtlHours: config.optinTtlHours,
    optinHourlyCap: config.optinHourlyCap,
  };
}

/* ── what the page will show ─────────────────────────────────────────────── */

export type VisibleValue =
  | { key: "date"; iso: string }
  | { key: "credits" | "referral" | "standard" | "earlyAccess"; value: number }
  | { key: "priceLock" };

/**
 * THE VALUES A VISITOR WILL SEE — the same filter prelaunch_public_config
 * applies (approved, in range, > 0, a launch date still ahead), plus the two
 * code gates the page adds (the premiere offer for the price lock, the
 * early-access mechanism). Whether a given LINE shows also depends on its
 * copy and its section switch; this lists the values that are allowed out.
 */
export function visibleValues(config: PrelaunchCampaignConfig, ctx: { now: number; premiereActive: boolean }): VisibleValue[] {
  const out: VisibleValue[] = [];
  if (config.launchAtApproved && config.launchAt && Date.parse(config.launchAt) > ctx.now) {
    out.push({ key: "date", iso: config.launchAt });
  }
  const count = (key: "credits" | "referral" | "standard", approved: boolean, value: number | null) => {
    if (approved && value !== null && value > 0) out.push({ key, value });
  };
  count("credits", config.signupCreditsApproved, config.signupCredits);
  count("referral", config.referralCreditsApproved, config.referralCredits);
  count("standard", config.standardCreditsApproved, config.standardCredits);
  if (config.priceLockApproved && ctx.premiereActive) out.push({ key: "priceLock" });
  if (EARLY_ACCESS_SUPPORTED && config.earlyAccessApproved && config.earlyAccessHours) {
    out.push({ key: "earlyAccess", value: config.earlyAccessHours });
  }
  return out;
}

export type PlatformSnapshot = { allowSignup: boolean; signupOpensAt: string | null };

export type LaunchWarning =
  | { kind: "signup_closed" }
  | { kind: "signup_differs"; opensAt: string | null };

/**
 * DOES THE DOOR OPEN WHEN THE COUNTDOWN SAYS IT DOES? (D9)
 *
 * Registration is platform_access — a separate switch with its own optional
 * opening time, which this panel reads and never writes. With an approved
 * launch date:
 *  · signup switched off → nobody can register on launch day, whatever the
 *    countdown says (an opening time does not apply while the switch is off);
 *  · the effective opening (the scheduled time, or "already open" when there
 *    is none) more than an hour away from the launch → the page and the door
 *    disagree.
 */
export function launchWarnings(config: PrelaunchCampaignConfig, platform: PlatformSnapshot | null, now: number): LaunchWarning[] {
  if (!config.launchAtApproved || !config.launchAt || !platform) return [];
  const launchMs = Date.parse(config.launchAt);
  // A launch that has passed is no longer on the page (the public config drops
  // it), so there is no countdown left to disagree with.
  if (!Number.isFinite(launchMs) || launchMs <= now) return [];
  if (!platform.allowSignup) return [{ kind: "signup_closed" }];
  const opens = platform.signupOpensAt ? Date.parse(platform.signupOpensAt) : NaN;
  const effective = Number.isFinite(opens) ? opens : now;
  return Math.abs(effective - launchMs) > 3_600_000
    ? [{ kind: "signup_differs", opensAt: Number.isFinite(opens) ? platform.signupOpensAt : null }]
    : [];
}

/** Everything the panel needs, read by prelaunchCampaignPanelAction. */
export type PrelaunchCampaignPanel = {
  /** false until migration 0144 has seeded (and made private) the row. */
  installed: boolean;
  config: PrelaunchCampaignConfig;
  updatedAt: string | null;
  /** The server's clock at read time — the panel never trusts its own. */
  now: number;
  premiereActive: boolean;
  earlyAccessSupported: boolean;
  platform: PlatformSnapshot | null;
  /** What an account gets at birth today (user_defaults.welcome_credits). */
  welcomeCredits: number | null;
  /** The onboarding survey bonus — it stacks on top of X (survey_bonus_policy). */
  surveyBonus: { active: boolean; amount: number } | null;
};
