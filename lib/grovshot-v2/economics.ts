/**
 * GROVBASE SHOT V2 — WHAT AN ORDER EARNS AND COSTS (client-safe, pure).
 *
 * The customer pays the model price per DELIVERED image (ai_models.pricing,
 * per size — unchanged by V2). GrovBase pays every call: the three analysis
 * stages, the prompt writer per shot, each candidate, each QC call, the one
 * retry. This module projects
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
 * A text/vision call — or an image call's tokens — without a published
 * token price is counted at the config's estimate and flagged, never as free.
 */
import type { EngineConfig, StageRole } from "@/lib/grovshot-v2/config";

export const ECON_SCENARIOS = ["best", "typical", "worst", "nothing"] as const;
export type EconScenario = (typeof ECON_SCENARIOS)[number];

/** amendedShare: of the retries, the part that is SYSTEMATIC — the prompt
 *  writer is asked again (a random retry reuses the same prompt). */
export const TYPICAL_ASSUMPTIONS = { complexShare: 0.4, retryShare: 0.25, deliveredShare: 0.9, amendedShare: 0.5 } as const;

export type EconInput = {
  shots: number;
  /** Credits per delivered image at this size (ai_models.pricing). */
  unitCredits: number;
  /** Official provider price of one image at this size (USD micros). */
  imageUsdMicros: number;
  /** One image call's tokens at their known price, or null (then the config's allowance). */
  imageTokenUsdMicros: number | null;
  /** One call of each text/vision role at its model's published price, or
   *  null (then the config's estimate, flagged). */
  roleCalls: Record<StageRole, number | null>;
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
  /** Text calls or image tokens were counted at the estimate (no published price). */
  estimated: boolean;
};

export function projectOrder(input: EconInput, scenario: EconScenario): EconRow {
  const { shots: n, config } = input;
  const perImage = input.imageUsdMicros + (input.imageTokenUsdMicros ?? config.budget.image_token_allowance_usd_micros);
  const call = (role: StageRole) => input.roleCalls[role] ?? config.budget.unknown_text_call_usd_micros;
  const cap = config.limits.max_paid_images_per_shot;
  const qcPerImage = scenario === "worst" || scenario === "nothing" ? 1 + config.qc.reask : 1;

  let imagesPerShot: number;
  let delivered: number;
  let plans = 1;
  // Prompt-writer calls per shot: one, plus one for each AMENDED retry.
  let writesPerShot = 1;
  if (scenario === "best") {
    imagesPerShot = 1;
    delivered = n;
  } else if (scenario === "typical") {
    const first = 1 + TYPICAL_ASSUMPTIONS.complexShare * (config.candidates.people_or_complex - 1)
      + (1 - TYPICAL_ASSUMPTIONS.complexShare) * (config.candidates.default - 1);
    const retries = config.retry.max_rounds > 0 ? TYPICAL_ASSUMPTIONS.retryShare : 0;
    imagesPerShot = Math.min(cap, first + retries * config.retry.candidates);
    writesPerShot = 1 + retries * TYPICAL_ASSUMPTIONS.amendedShare;
    delivered = Math.round(n * TYPICAL_ASSUMPTIONS.deliveredShare * 100) / 100;
  } else {
    imagesPerShot = cap;
    delivered = scenario === "worst" ? n : 0;
    plans = 1 + config.limits.replans;
    writesPerShot = 1 + config.retry.max_rounds;
  }
  const images = n * imagesPerShot;
  const qcCalls = images * qcPerImage;
  const writes = n * writesPerShot;
  const textCalls = 2 + plans + writes + qcCalls;
  const textCost = call("validate") + call("card") + plans * call("plan") + writes * call("prompt") + qcCalls * call("qc");
  const costUsd = (images * perImage + textCost) / 1_000_000;
  const revenuePln = delivered * input.unitCredits * input.billing.plnPerCredit;
  const costPln = costUsd * input.billing.usdToPln;
  const marginPercent = revenuePln > 0 ? ((revenuePln - costPln) / revenuePln) * 100 : null;
  return {
    scenario, images: round2(images), textCalls: round2(textCalls), delivered,
    costUsd: round4(costUsd), revenuePln: round2(revenuePln), costPln: round2(costPln),
    marginPercent: marginPercent === null ? null : Math.round(marginPercent * 10) / 10,
    meetsFloor: marginPercent !== null && marginPercent >= input.billing.minMarginPercent,
    estimated: Object.values(input.roleCalls).some((v) => v === null) || input.imageTokenUsdMicros === null,
  };
}

export const ECON_SHOT_COUNTS = [1, 3, 5, 10] as const;

/**
 * May V2 be offered to CUSTOMERS at these prices? Only when the typical
 * order of every offered size (1, 3, 5, 10 shots) meets the billing floor
 * with text calls and image tokens priced from a published list. Admins may test regardless.
 */
export function customerRolloutAllowed(rows: readonly EconRow[]): boolean {
  const typical = rows.filter((r) => r.scenario === "typical");
  return typical.length > 0 && typical.every((r) => r.meetsFloor && !r.estimated);
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const round4 = (x: number) => Math.round(x * 10_000) / 10_000;
