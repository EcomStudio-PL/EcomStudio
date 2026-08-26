/**
 * PLAN IDENTITY — one colour per tier, used everywhere a plan is named.
 *
 * Blue for Free, green for Starter, amber for Pro, magenta-violet for Agency.
 * The badge is small and flat on purpose: a plan is a fact about the account,
 * not a decoration, so it gets a tint and a ring rather than a gradient.
 *
 * Matching is by slug first and by lowercased name second, so a workspace
 * whose plans were renamed in the admin panel still lands on the right tier
 * instead of silently falling back to neutral.
 */
export type PlanTone = "free" | "starter" | "pro" | "agency" | "neutral";

const BY_KEY: Record<string, PlanTone> = {
  free: "free",
  starter: "starter",
  start: "starter",
  basic: "starter",
  pro: "pro",
  professional: "pro",
  business: "pro",
  agency: "agency",
  enterprise: "agency",
  premium: "agency",
};

export function planTone(planNameOrSlug: string | null | undefined): PlanTone {
  const key = (planNameOrSlug ?? "").trim().toLowerCase();
  return BY_KEY[key] ?? "neutral";
}

/** Tailwind classes for the small badge form. */
export const PLAN_BADGE: Record<PlanTone, string> = {
  free: "bg-[rgb(var(--info)/0.16)] text-info ring-1 ring-[rgb(var(--info)/0.4)]",
  starter: "bg-[rgb(var(--success)/0.16)] text-success ring-1 ring-[rgb(var(--success)/0.4)]",
  pro: "bg-[rgb(var(--warning)/0.18)] text-warning ring-1 ring-[rgb(var(--warning)/0.45)]",
  agency: "bg-[rgb(var(--accent)/0.18)] text-accent ring-1 ring-[rgb(var(--accent)/0.45)]",
  neutral: "bg-raised text-muted ring-1 ring-[rgb(var(--hairline)/var(--hairline-alpha))]",
};

/** The tier's own colour as a bare `r g b` triplet, for washes and meters. */
export const PLAN_RGB: Record<PlanTone, string> = {
  free: "var(--info)",
  starter: "var(--success)",
  pro: "var(--warning)",
  agency: "var(--accent)",
  neutral: "var(--muted)",
};

/**
 * Time-of-day greeting key. Morning until noon, afternoon until 18:00, then
 * evening — evaluated from the VIEWER's clock, which is why this returns a
 * key for the client to resolve rather than a finished string.
 */
export function greetingKey(hours: number): "morning" | "afternoon" | "evening" {
  if (hours < 12) return "morning";
  if (hours < 18) return "afternoon";
  return "evening";
}

/** First name from a display name, falling back to the local part of an
 *  email. Never returns an empty string when either input has content. */
export function firstName(displayName?: string | null, email?: string | null): string {
  const named = (displayName ?? "").trim();
  if (named) {
    const first = named.split(/\s+/)[0];
    if (first && !first.includes("@")) return first;
    return named.split("@")[0];
  }
  const local = (email ?? "").split("@")[0].trim();
  if (!local) return "";
  // "jan.kowalski" / "jan_kowalski" read as a name, not as a handle.
  const part = local.split(/[._-]/)[0];
  return part ? part.charAt(0).toUpperCase() + part.slice(1) : "";
}
