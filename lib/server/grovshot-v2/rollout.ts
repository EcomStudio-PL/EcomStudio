import "server-only";
import type { Client } from "@/lib/services/workspace";
import { billingFrom, type BillingConfig } from "@/lib/images/pricing";
import {
  ECON_SCENARIOS, ECON_SHOT_COUNTS, customerRolloutAllowed, projectOrder, type EconRow,
} from "@/lib/grovshot-v2/economics";
import type { EngineConfig, StageModel } from "@/lib/grovshot-v2/config";
import { findTokenPrice } from "@/lib/ai/usage-cost";
import { OPENAI_VISION_MODELS, VISION_MODEL } from "@/lib/ai/engine/vision";
import { imageUnitPrice, readEngineState, type EngineState } from "@/lib/server/grovshot-v2/settings";

/**
 * GROVBASE SHOT V2 — MAY CUSTOMERS GET IT AT TODAY'S PRICES? The flag decides
 * who is ASKED for V2; this decides whether a non-admin may actually be
 * routed to it: only while a typical order of every size meets the billing
 * margin floor with every stage and the image model's tokens priced from a
 * published list (the brief:
 * never V2 for customers at an unacceptable margin). Prices are never
 * changed here — that is the owner's decision (ai_models.pricing, billing).
 */

export type EconTable = {
  resolution: string; unitCredits: number; imageUsdMicros: number | null;
  rows: (EconRow & { shots: number })[];
};

export type V2Economics = {
  billing: BillingConfig;
  textPriced: boolean;
  /** The image model's tokens are priced from the published list. */
  imageTokensPriced: boolean;
  tables: EconTable[];
  /** Typical orders meet the floor at every size, text priced from a list. */
  customerAllowed: boolean;
};

/** Tokens one text/vision stage call is assumed to use for this projection
 *  (several photos in, a JSON answer out) — stated, conservative. */
export const TEXT_CALL_TOKENS = { input: 8_000, output: 2_000 } as const;

/** Tokens one image call is assumed to use beyond its per-image price (the
 *  shot's reference photos and prompt in, the model's thinking out) —
 *  stated, conservative. */
export const IMAGE_CALL_TOKENS = { input: 6_000, thinking: 1_500 } as const;

/** The model a stage's FIRST request goes to, picked as the runtime picks it
 *  (stage-call.ts, vision.ts): the published per-stage model when the chain
 *  has its provider, else the chain's first backend — its preferred id, or
 *  the first id the vision layer tries. */
function firstStageModel(state: EngineState, pick: StageModel | undefined): { provider: string; model: string } | null {
  if (pick && state.textModels.some((b) => b.provider === pick.provider)) return pick;
  const b = state.textModels[0];
  if (!b) return null;
  return { provider: b.provider, model: b.model ?? (b.provider === "google" ? VISION_MODEL : OPENAI_VISION_MODELS[0]) };
}

/**
 * What one text/vision stage call costs at the PUBLISHED token prices of
 * every stage model (the dearest of them), never below the config's own
 * estimate — so an estimate set to 0 cannot open the customer gate. Null
 * when any stage model has no published price.
 */
export function textCallCost(state: EngineState, config: EngineConfig | null): number | null {
  if (!config) return null;
  let dearest = 0;
  for (const k of ["validate", "card", "plan", "qc"] as const) {
    const m = firstStageModel(state, config.models[k]);
    const price = m ? findTokenPrice(state.tokenPrices, m.provider, m.model) : null;
    if (!price) return null;
    const cost = (TEXT_CALL_TOKENS.input * price.inputPerMTok + TEXT_CALL_TOKENS.output * price.outputPerMTok) / 1_000_000;
    dearest = Math.max(dearest, Math.ceil(cost));
  }
  return Math.max(dearest, config.budget.vision_call_usd_micros);
}

/**
 * The tokens of one image call at the image model's PUBLISHED token prices,
 * never below the config's allowance — so an allowance set to 0 cannot open
 * the gate either. Null when the model has no published token price.
 */
export function imageTokenCost(state: EngineState, config: EngineConfig | null): number | null {
  if (!config || !state.model) return null;
  const price = findTokenPrice(state.tokenPrices, state.model.providerSlug, state.model.identifier);
  if (!price) return null;
  const cost = (IMAGE_CALL_TOKENS.input * price.inputPerMTok + IMAGE_CALL_TOKENS.thinking * price.outputPerMTok) / 1_000_000;
  return Math.max(Math.ceil(cost), config.budget.image_token_allowance_usd_micros);
}

export function economicsFor(state: EngineState, billing: BillingConfig): V2Economics | null {
  if (!state.config || !state.model) return null;
  const config = state.config;
  const textCall = textCallCost(state, config);
  const textPriced = textCall !== null;
  const imageTokens = imageTokenCost(state, config);
  const tables: EconTable[] = state.model.resolutions.map((resolution) => {
    const unitCredits = state.model!.pricing[resolution] ?? 0;
    const imageUsdMicros = imageUnitPrice(state, resolution);
    const rows = imageUsdMicros === null || unitCredits <= 0 ? [] : ECON_SHOT_COUNTS.flatMap((shots) =>
      ECON_SCENARIOS.map((scenario) => ({
        shots,
        ...projectOrder({
          shots, unitCredits, imageUsdMicros,
          imageTokenUsdMicros: imageTokens,
          textCallUsdMicros: textCall,
          billing, config,
        }, scenario),
      })));
    return { resolution, unitCredits, imageUsdMicros, rows };
  });
  // Every size the customer can order must pass — not only the cheapest.
  const allowed = tables.length > 0 && tables.every((t) => t.rows.length > 0 && customerRolloutAllowed(t.rows));
  return { billing, textPriced, imageTokensPriced: imageTokens !== null, tables, customerAllowed: allowed };
}

/** For the flag check: may a NON-admin be routed to V2 at today's prices? */
export async function customerEconomicsAllowed(supabase: Client): Promise<boolean> {
  try {
    const [state, { data: billingRow }] = await Promise.all([
      readEngineState(supabase),
      supabase.from("app_settings").select("value").eq("key", "billing").maybeSingle(),
    ]);
    return economicsFor(state, billingFrom(billingRow?.value))?.customerAllowed === true;
  } catch {
    return false;
  }
}

