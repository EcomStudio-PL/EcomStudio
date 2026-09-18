import "server-only";
import type { Client } from "@/lib/services/workspace";

/**
 * THE TWO DIALS THE SENDING MAILBOX NEEDS, and the kill switch above them.
 *
 * Stored in `app_settings` under a key of the newsletter's own. NOT under
 * `notifications`: that row carries `dispatch_hash`, the published hash of the
 * server's proof-of-identity, and a careless write to it would lock every
 * unattended path in the product out of the database at once.
 *
 * THE RATE IS NOT A PERFORMANCE SETTING. GrovBase sends through one shared
 * mailbox on shared hosting, and the SMTP password is the same credential the
 * admin inbox polls IMAP with. Sending too fast does not make a campaign
 * arrive sooner; it gets the identity throttled, and the throttle takes the
 * signup mail and the inbox down with it. The default is deliberately timid.
 */

export const NEWSLETTER_SETTINGS_KEY = "newsletter";

export type NewsletterSettings = {
  /** §74's kill switch. Marketing only — it can never affect auth mail. */
  paused: boolean;
  /** Messages per hour. The worker paces itself to stay under it. */
  ratePerHour: number;
  /** How many a single worker invocation may claim. Bounded by the platform's
   *  function timeout more than by the mailbox. */
  batchSize: number;
  lastRunAt: string | null;
  lastRunSent: number;
  lastRunFailed: number;
  lastError: string | null;
};

export const DEFAULT_SETTINGS: NewsletterSettings = {
  paused: false,
  // Six a minute. Slow enough that a shared mailbox never notices, and fast
  // enough that a list of a few thousand goes out overnight. An operator who
  // knows their provider's real ceiling can raise it.
  ratePerHour: 360,
  batchSize: 20,
  lastRunAt: null,
  lastRunSent: 0,
  lastRunFailed: 0,
  lastError: null,
};

export function toSettings(value: unknown): NewsletterSettings {
  const raw = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as
    Record<string, unknown>;
  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = typeof v === "number" ? v : Number.parseInt(String(v ?? ""), 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };
  return {
    paused: raw.paused === true,
    ratePerHour: num(raw.ratePerHour, DEFAULT_SETTINGS.ratePerHour, 10, 20_000),
    batchSize: num(raw.batchSize, DEFAULT_SETTINGS.batchSize, 1, 100),
    lastRunAt: typeof raw.lastRunAt === "string" ? raw.lastRunAt : null,
    lastRunSent: num(raw.lastRunSent, 0, 0, 1_000_000),
    lastRunFailed: num(raw.lastRunFailed, 0, 0, 1_000_000),
    lastError: typeof raw.lastError === "string" ? raw.lastError : null,
  };
}

export async function readSettings(supabase: Client): Promise<NewsletterSettings> {
  const { data } = await supabase
    .from("app_settings").select("value").eq("key", NEWSLETTER_SETTINGS_KEY).maybeSingle();
  return toSettings(data?.value);
}

/** Merge and write. Read-modify-write rather than a blind upsert so the
 *  worker's run stamps and the operator's dials cannot erase each other. */
export async function writeSettings(
  supabase: Client, patch: Partial<NewsletterSettings>,
): Promise<NewsletterSettings> {
  const current = await readSettings(supabase);
  const next = toSettings({ ...current, ...patch });
  await supabase.from("app_settings").upsert(
    { key: NEWSLETTER_SETTINGS_KEY, value: next as never },
    { onConflict: "key" },
  );
  return next;
}

/** How long to wait between messages to honour the hourly rate. */
export const paceMs = (ratePerHour: number): number =>
  Math.max(0, Math.round(3_600_000 / Math.max(1, ratePerHour)));
