/**
 * TRIAL WATERMARK — the one configuration object (app_settings.trial_watermark).
 *
 * Client-safe on purpose: the admin form validates with the same RANGES the
 * server clamps to, so a value the form accepts is a value the generator
 * honours. Nothing here decides who is watermarked — that is
 * `trial_watermark_decide` in the database — and nothing here is ever read by
 * the browser to grant or refuse anything.
 *
 * TWO DIFFERENT THINGS LIVE IN TWO DIFFERENT PLACES.
 *   · How NEW trial images are made (enabled, size, opacity, colours, glow,
 *     the retention a new original is promised) — this row.
 *   · What an ALREADY-MARKED file allows (locked / unlocked / expired, when it
 *     expires) — its own `trial_originals` row, which froze its retention when
 *     it was made. Switching `enabled` off, or shortening the retention later,
 *     never exposes, extends or deletes anything that already exists.
 */

export type TrialWatermarkConfig = {
  /** New trial generations get the mark. false = dormant (the default). */
  enabled: boolean;
  /** Mark width as a share of the image's SHORTER side. */
  widthRatio: number;
  /** Alpha multiplier of the mark itself, 0..1. */
  opacity: number;
  /** Region luminance (0..1, sRGB-encoded Rec.709) above which the dark variant is used. */
  luminanceThreshold: number;
  /** The dark variant's colour, #rrggbb. The light variant is the asset's own white. */
  darkColor: string;
  /** Glow radius as a share of the mark's width. */
  glowRadiusRatio: number;
  /** Alpha multiplier of the glow, 0..1. */
  glowOpacity: number;
  /** Days a not-unlocked clean original is kept, frozen per original at creation. */
  originalRetentionDays: number;
  /** Lifetime of a signed URL to a clean file handed out by an unlock. */
  signedUrlTtlSeconds: number;
  /** Staff (profiles.role = admin) generate clean images. false lets an admin test the trial path. */
  exemptStaff: boolean;
  /**
   * Accounts that lose the staff exemption (D5): one designated test account
   * is watermarked on PROD while exempt_staff stays on for everyone else. It
   * never overrides paid — a paying workspace stays clean whoever acts in it.
   */
  forceTrialUserIds: string[];
};

export const TRIAL_WATERMARK_SETTING_KEY = "trial_watermark";

/** At most this many forced accounts: it is a test switch, not an audience. */
export const TRIAL_WATERMARK_FORCE_MAX = 10;

export const TRIAL_WATERMARK_DEFAULTS: TrialWatermarkConfig = {
  enabled: false,
  widthRatio: 0.5,
  opacity: 0.38,
  luminanceThreshold: 0.55,
  darkColor: "#111111",
  glowRadiusRatio: 0.015,
  glowOpacity: 0.2,
  originalRetentionDays: 30,
  signedUrlTtlSeconds: 60,
  exemptStaff: true,
  forceTrialUserIds: [],
};

export const TRIAL_WATERMARK_RANGES = {
  widthRatio: { min: 0.1, max: 0.9 },
  opacity: { min: 0.05, max: 1 },
  luminanceThreshold: { min: 0, max: 1 },
  glowRadiusRatio: { min: 0, max: 0.1 },
  glowOpacity: { min: 0, max: 1 },
  originalRetentionDays: { min: 1, max: 365 },
  signedUrlTtlSeconds: { min: 10, max: 600 },
} as const;

const HEX = /^#[0-9a-f]{6}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A stored list → its valid uuids, lower-cased, first occurrence kept (as SQL keeps them). */
function forcedIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const id of v) {
    if (typeof id !== "string" || !UUID.test(id)) continue;
    const lower = id.toLowerCase();
    if (!out.includes(lower)) out.push(lower);
  }
  return out;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const numIn = (v: unknown, r: { min: number; max: number }, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) && v >= r.min && v <= r.max ? v : fallback;
const intIn = (v: unknown, r: { min: number; max: number }, fallback: number): number =>
  typeof v === "number" && Number.isInteger(v) && v >= r.min && v <= r.max ? v : fallback;

/**
 * The stored row → a complete, valid config. A missing or out-of-range field
 * falls back to its default alone, so one bad value never resets the rest;
 * `enabled` is true only when the row literally says so.
 */
export function parseTrialWatermarkConfig(raw: unknown): TrialWatermarkConfig {
  const r = isObj(raw) ? raw : {};
  const d = TRIAL_WATERMARK_DEFAULTS;
  const R = TRIAL_WATERMARK_RANGES;
  return {
    enabled: r.enabled === true,
    widthRatio: numIn(r.width_ratio, R.widthRatio, d.widthRatio),
    opacity: numIn(r.opacity, R.opacity, d.opacity),
    luminanceThreshold: numIn(r.luminance_threshold, R.luminanceThreshold, d.luminanceThreshold),
    darkColor: typeof r.dark_color === "string" && HEX.test(r.dark_color) ? r.dark_color.toLowerCase() : d.darkColor,
    glowRadiusRatio: numIn(r.glow_radius_ratio, R.glowRadiusRatio, d.glowRadiusRatio),
    glowOpacity: numIn(r.glow_opacity, R.glowOpacity, d.glowOpacity),
    originalRetentionDays: intIn(r.original_retention_days, R.originalRetentionDays, d.originalRetentionDays),
    signedUrlTtlSeconds: intIn(r.signed_url_ttl_seconds, R.signedUrlTtlSeconds, d.signedUrlTtlSeconds),
    exemptStaff: r.exempt_staff !== false,
    forceTrialUserIds: forcedIds(r.force_trial_user_ids),
  };
}

/** A config → the stored row (snake_case, versioned). */
export function serializeTrialWatermarkConfig(c: TrialWatermarkConfig): Record<string, unknown> {
  return {
    v: 1,
    enabled: c.enabled,
    width_ratio: c.widthRatio,
    opacity: c.opacity,
    luminance_threshold: c.luminanceThreshold,
    dark_color: c.darkColor.toLowerCase(),
    glow_radius_ratio: c.glowRadiusRatio,
    glow_opacity: c.glowOpacity,
    original_retention_days: c.originalRetentionDays,
    signed_url_ttl_seconds: c.signedUrlTtlSeconds,
    exempt_staff: c.exemptStaff,
    force_trial_user_ids: c.forceTrialUserIds.map((id) => id.toLowerCase()),
  };
}

export type TrialWatermarkInvalid =
  | "enabled" | "widthRatio" | "opacity" | "luminanceThreshold" | "darkColor"
  | "glowRadiusRatio" | "glowOpacity" | "originalRetentionDays" | "signedUrlTtlSeconds" | "exemptStaff"
  | "forceTrialUserIds";

/**
 * STRICT validation of an admin edit: unlike the reader, nothing is silently
 * replaced — the first invalid field is reported and nothing is saved.
 */
export function validateTrialWatermarkInput(
  input: unknown,
): { ok: true; config: TrialWatermarkConfig } | { ok: false; field: TrialWatermarkInvalid } {
  if (!isObj(input)) return { ok: false, field: "enabled" };
  const R = TRIAL_WATERMARK_RANGES;
  const num = (k: keyof typeof R, int = false) => {
    const v = input[k];
    return typeof v === "number" && Number.isFinite(v) && (!int || Number.isInteger(v)) && v >= R[k].min && v <= R[k].max;
  };
  if (typeof input.enabled !== "boolean") return { ok: false, field: "enabled" };
  if (!num("widthRatio")) return { ok: false, field: "widthRatio" };
  if (!num("opacity")) return { ok: false, field: "opacity" };
  if (!num("luminanceThreshold")) return { ok: false, field: "luminanceThreshold" };
  if (typeof input.darkColor !== "string" || !HEX.test(input.darkColor)) return { ok: false, field: "darkColor" };
  if (!num("glowRadiusRatio")) return { ok: false, field: "glowRadiusRatio" };
  if (!num("glowOpacity")) return { ok: false, field: "glowOpacity" };
  if (!num("originalRetentionDays", true)) return { ok: false, field: "originalRetentionDays" };
  if (!num("signedUrlTtlSeconds", true)) return { ok: false, field: "signedUrlTtlSeconds" };
  if (typeof input.exemptStaff !== "boolean") return { ok: false, field: "exemptStaff" };
  // Every entry a uuid, none twice, at most TRIAL_WATERMARK_FORCE_MAX — a
  // typo is refused rather than dropped, so the list saved is the list typed.
  const force: unknown[] | null = Array.isArray(input.forceTrialUserIds) ? input.forceTrialUserIds : null;
  if (!force || force.length > TRIAL_WATERMARK_FORCE_MAX
    || !force.every((id): id is string => typeof id === "string" && UUID.test(id))
    || new Set(force.map((id) => id.toLowerCase())).size !== force.length) {
    return { ok: false, field: "forceTrialUserIds" };
  }
  return {
    ok: true,
    config: {
      enabled: input.enabled,
      widthRatio: input.widthRatio as number,
      opacity: input.opacity as number,
      luminanceThreshold: input.luminanceThreshold as number,
      darkColor: (input.darkColor as string).toLowerCase(),
      glowRadiusRatio: input.glowRadiusRatio as number,
      glowOpacity: input.glowOpacity as number,
      originalRetentionDays: input.originalRetentionDays as number,
      signedUrlTtlSeconds: input.signedUrlTtlSeconds as number,
      exemptStaff: input.exemptStaff,
      forceTrialUserIds: force.map((id) => id.toLowerCase()),
    },
  };
}

/**
 * The admin preview (app/actions/trial-watermark-admin.ts): what it accepts
 * and what it hands back. The 10 MB cap is the action's; an UPLOAD is also
 * bound by the server-action body limit (next.config.mjs, 4.5 MB — Vercel's
 * own request ceiling), so a larger photo is previewed from the media library,
 * which the server reads itself.
 */
export const TRIAL_WATERMARK_PREVIEW = {
  maxBytes: 10 * 1024 * 1024,
  uploadMaxBytes: Math.floor(4.5 * 1024 * 1024) - 64 * 1024,
  maxSide: 1600,
} as const;
