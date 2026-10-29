/**
 * GROVBASE SHOT V2 — WHAT AN ORDER EARNS AND COSTS (client-safe, pure).
 *
 * The customer pays the model price per DELIVERED image (ai_models.pricing,
 * per size — unchanged by V2). GrovBase pays every call: the three analysis
 * stages, each candidate, each QC call, the one retry. This module projects
 * both for an order of N shots under three named scenarios and gives the
 * gross margin against the billing floor (billing.min_margin_percent).
 *
 * The scenarios are ASSUMPTIONS, stated here and on the admin screen — not
 * measurements. Real numbers come from finished orders (Diagnostyka):
 *   best     every shot accepted on its first candidate, no retry, all delivered;
 *   typical  the spec's mix: 40% of shots with people / complex scenes (2
 *            candidates), 25% use the one retry, 90% delivered;
 *   worst    every shot uses its whole paid-image allowance, every QC call is
 *            asked twice, the plan is redone once — and every shot delivered
 *            (the most a delivered order can cost).
 * `nothing` is the boundary loss: the worst spend with nothing delivered.
 *
 * A text/vision call without a published token price is counted at the
 * config's estimate and flagged — never as free.
 */
import type { EngineConfig } from "@/lib/grovshot-v2/config";

export const ECON_SCENARIOS = ["best", "typical", "worst", "nothing"] as const;
export type EconScenario = (typeof ECON_SCENARIOS)[number];

export const TYPICAL_ASSUMPTIONS = { complexShare: 0.4, retryShare: 0.25, deliveredShare: 0.9 } as const;

export type EconInput = {
  shots: number;
  /** Credits per delivered image at this size (ai_models.pricing). */
  unitCredits: number;
  /** Official provider price of one image at this size (USD micros). */
  imageUsdMicros: number;
  /** One text/vision call: its known cost, or null (then the config's estimate). */
  textCallUsdMicros: number | null;
  billing: { plnPerCredit: number; usdToPln: number; minMarginPercent: number };
  config: Pick<EngineConfig, "candidates" | "retry" | "budget" | "limits" | "qc">;
};

export type EconRow = {
  scenario: EconScenario;
  images: number;
  textCalls: number;
  delivered: number;
  costUsd: number;
  revenuePln: number;
  costPln: number;
  marginPercent: number | null;
  /** At or above the billing floor. */
  meetsFloor: boolean;
  /** Text calls were counted at the estimate (no published price). */
  estimated: boolean;
};

const STAGE_CALLS = 3; // Etap 0, 1, 2

export function projectOrder(input: EconInput, scenario: EconScenario): EconRow {
  const { shots: n, config } = input;
  const perImage = input.imageUsdMicros + config.budget.image_token_allowance_usd_micros;
  const textCall = input.textCallUsdMicros ?? config.budget.unknown_text_call_usd_micros;
  const cap = config.limits.max_paid_images_per_shot;
  const qcPerImage = scenario === "worst" || scenario === "nothing" ? 1 + config.qc.reask : 1;

  let imagesPerShot: number;
  let delivered: number;
  let stageCalls = STAGE_CALLS;
  if (scenario === "best") {
    imagesPerShot = 1;
    delivered = n;
  } else if (scenario === "typical") {
    const first = 1 + TYPICAL_ASSUMPTIONS.complexShare * (config.candidates.people_or_complex - 1)
      + (1 - TYPICAL_ASSUMPTIONS.complexShare) * (config.candidates.default - 1);
    const retry = config.retry.max_rounds > 0 ? TYPICAL_ASSUMPTIONS.retryShare * config.retry.candidates : 0;
    imagesPerShot = Math.min(cap, first + retry);
    delivered = Math.round(n * TYPICAL_ASSUMPTIONS.deliveredShare * 100) / 100;
  } else {
    imagesPerShot = cap;
    delivered = scenario === "worst" ? n : 0;
    stageCalls = STAGE_CALLS + config.limits.replans;
  }
  const images = n * imagesPerShot;
  const textCalls = stageCalls + images * qcPerImage;
  const costUsd = (images * perImage + textCalls * textCall) / 1_000_000;
  const revenuePln = delivered * input.unitCredits * input.billing.plnPerCredit;
  const costPln = costUsd * input.billing.usdToPln;
  const marginPercent = revenuePln > 0 ? ((revenuePln - costPln) / revenuePln) * 100 : null;
  return {
    scenario, images: round2(images), textCalls: round2(textCalls), delivered,
    costUsd: round4(costUsd), revenuePln: round2(revenuePln), costPln: round2(costPln),
    marginPercent: marginPercent === null ? null : Math.round(marginPercent * 10) / 10,
    meetsFloor: marginPercent !== null && marginPercent >= input.billing.minMarginPercent,
    estimated: input.textCallUsdMicros === null,
  };
}

export const ECON_SHOT_COUNTS = [1, 3, 5, 10] as const;

/**
 * May V2 be offered to CUSTOMERS at these prices? Only when the typical
 * order of every offered size (1, 3, 5, 10 shots) meets the billing floor
 * with text calls priced from a published list. Admins may test regardless.
 */
export function customerRolloutAllowed(rows: readonly EconRow[]): boolean {
  const typical = rows.filter((r) => r.scenario === "typical");
  return typical.length > 0 && typical.every((r) => r.meetsFloor && !r.estimated);
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const round4 = (x: number) => Math.round(x * 10_000) / 10_000;
