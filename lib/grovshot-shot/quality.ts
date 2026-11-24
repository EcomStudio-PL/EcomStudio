/**
 * GROVBASE SHOT — DELIVERY IS NOT QUALITY (23.11.2026).
 *
 * An order's `ok` and a round's `reference_check.ok` say that the request
 * carried the right photos and the right prompt, and that an image came back
 * and was delivered. Neither looked at the IMAGE: the number of steps of a
 * ladder, the digits on an LCD, the panels of a pen, the spikes on both
 * shoes. So every delivered shot is `unverified` until something did look:
 *
 *   delivery_status  delivered / not_delivered (the order's own record)
 *   quality_status   unverified → passed | flagged | failed
 *
 * This module is the skeleton that runs without any paid model: which shots
 * need a human look (the risky categories, a probe or cable on the card, a
 * plan warning on the shot) and the pure transition of a manual review. A
 * semantic QC model may later fill `passed` / `flagged` — with its own cost
 * cap and no automatic re-generation; it does not exist yet. Billing is not
 * touched: a delivered image is charged as before, whatever this says. Pure.
 */
import type { ProductCard } from "@/lib/grovshot-shot/card";

export const QUALITY_STATUSES = ["unverified", "passed", "flagged", "failed"] as const;
export type QualityStatus = (typeof QUALITY_STATUSES)[number];

/** The categories where an image can look right and still be the wrong product. */
export const REVIEW_FLAGS: Readonly<Record<string, string>> = {
  ekran: "lcd_layout_digits",
  drabinka: "step_count_geometry",
  kojec: "panels_connectors",
  raczki: "spikes_both_shoes",
};
/** A probe, cable or hose on the card: its connection and length are easy to invent. */
const CABLE = /sond|przew[oó]d|kabel|kabl|w[ąa][żz]/i;

export type ShotQuality = {
  quality_status: QualityStatus;
  /** A person should look before the image is called good. */
  review: boolean;
  reasons: string[];
};

/** At assembly: what a delivered image of this shot will need (never "passed" here). */
export function shotQualityPlan(o: {
  card: Pick<ProductCard, "flagi" | "budowa">;
  shot: { typ: string };
  /** Soft plan violations left on this shot (codes). */
  warnings?: string[];
}): ShotQuality {
  const reasons: string[] = [];
  for (const f of o.card.flagi) if (REVIEW_FLAGS[f]) reasons.push(`review:${REVIEW_FLAGS[f]}`);
  if (o.card.budowa.elementy.some((e) => CABLE.test(e))) reasons.push("review:cable_probe");
  for (const w of o.warnings ?? []) reasons.push(`plan_warning:${w}`);
  return { quality_status: "unverified", review: reasons.some((r) => r.startsWith("review:")), reasons: [...new Set(reasons)] };
}

export type QualityReview = { decision: "passed" | "flagged" | "failed"; by: string; at: string; note?: string };

/**
 * A manual review (admin): the only way an image becomes `passed` today. A
 * failed image is a record for the admin (refund / regeneration stay their
 * own, explicit actions — nothing here charges, refunds or re-generates).
 */
export function applyReview(q: ShotQuality, r: QualityReview): ShotQuality & { review_by: string; review_at: string; review_note?: string } {
  if (!(QUALITY_STATUSES as readonly string[]).includes(r.decision) || !r.by || !r.at) throw new Error("invalid_review");
  return {
    ...q, quality_status: r.decision, review: false, review_by: r.by, review_at: r.at,
    ...(r.note ? { review_note: r.note.slice(0, 500) } : {}),
  };
}
