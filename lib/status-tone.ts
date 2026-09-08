import type { FeatureStatus } from "@/lib/features";

/**
 * ONE STATUS VOCABULARY, USED EVERYWHERE A MODULE'S STATE IS SHOWN.
 *
 * Four states, four colours, and the colour carries the meaning:
 *
 *   ACTIVE       green    it runs
 *   MAINTENANCE  orange   needs attention now
 *   COMING_SOON  purple   planned, not built yet
 *   DISABLED     grey     switched off on purpose
 *
 * A module an operator turned off is not a failure, so it does not take the
 * red that a real error needs to keep for itself — and "wkrótce" is not a
 * warning, so it does not take the orange.
 *
 * This lives here rather than in one of the panels because three screens show
 * the same four states: the tools registry, the tool workspace header and the
 * feature availability switchboard. When they disagree, the colour stops
 * meaning anything.
 */
export const STATUS_TONE: Record<FeatureStatus, "success" | "warning" | "accent" | "neutral"> = {
  ACTIVE: "success",
  COMING_SOON: "accent",
  MAINTENANCE: "warning",
  DISABLED: "neutral",
};

/** The same four states as a bare dot — for rows too dense for a badge. */
export const STATUS_DOT: Record<FeatureStatus, string> = {
  ACTIVE: "bg-success",
  COMING_SOON: "bg-accent2",
  MAINTENANCE: "bg-warning",
  DISABLED: "bg-muted",
};

/** …and as a tinted chip, where a dot alone would not be readable. */
export const STATUS_CHIP: Record<FeatureStatus, string> = {
  ACTIVE: "bg-[rgb(var(--success)/0.14)] text-success",
  COMING_SOON: "bg-accent2-soft text-accent2",
  MAINTENANCE: "bg-[rgb(var(--warning)/0.14)] text-warning",
  DISABLED: "bg-raised text-muted",
};
