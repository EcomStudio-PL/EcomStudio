import "server-only";
import type { Client } from "@/lib/services/workspace";
import { billingFrom, type BillingConfig } from "@/lib/images/pricing";
import {
  ECON_SCENARIOS, ECON_SHOT_COUNTS, customerRolloutAllowed, projectOrder, type EconRow,
} from "@/lib/grovshot-v2/economics";
import { STAGE_ROLES, type EngineConfig, type StageRole } from "@/lib/grovshot-v2/config";
import { findTokenPrice } from "@/lib/ai/usage-cost";
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
  /** The lowest credits per image at which the TYPICAL order of every size
   *  meets the floor (same assumptions) — information for the owner's price
   *  decision; never applied. Null: no price / above the search range. */
  breakEvenCredits: number | null;
};

export type V2Economics = {
  billing: BillingConfig;
  /** Every role's model is priced from the published list. */
  textPriced: boolean;
  /** One call of each role, USD micros (null = no published price). */
  roleCalls: Record<StageRole, number | null>;
  /** The image model's tokens are priced from the published list. */
  imageTokensPriced: boolean;
  tables: EconTable[];
  /** Typical orders meet the floor at every size, text priced from a list. */
  customerAllowed: boolean;
  /** A projection on the newest DRAFT config (nothing published yet): shown
   *  to the admin, never used by the gate (customerAllowed is then false). */
  preview: boolean;
  previewVersion: number | null;
};

/**
 * Tokens one call of each text/vision role is assumed to use for this
 * projection — stated, conservative (thinking counts as output): the photo
 * check and the card read every photo; the plan and the prompt writer are
 * text; QC reads the shot's references and one candidate. Each includes the
 * expert rules the stage reads ({{knowledge_rules}}, up to KNOWLEDGE_LIMITS
 * characters ≈ 3 characters per token for Polish text).
 */
export const ROLE_CALL_TOKENS: Record<StageRole, { input: number; output: number }> = {
  // Measured on PROD (04.11, three photo checks of a 7-photo order): 13 654
  // input tokens, 1 000–1 099 output — rounded up.
  validate: { input: 14_000, output: 1_500 },
  card: { input: 12_000, output: 4_000 },
  plan: { input: 11_500, output: 6_000 },
  prompt: { input: 9_000, output: 2_500 },
  qc: { input: 9_000, output: 1_500 },
};

/**
 * One call of each role at the PUBLISHED token price of the model that role
 * is configured to ask first. Null for a role whose model has no published
 * price — the projection then uses the config's estimate and says so, and
 * the customer gate stays shut. No floor and no guessed figure.
 */
export function roleCallCosts(state: EngineState, config: EngineConfig | null): Record<StageRole, number | null> {
  return Object.fromEntries(STAGE_ROLES.map((role) => {
    const m = config?.models[role];
    const price = m ? findTokenPrice(state.tokenPrices, m.provider, m.model) : null;
    const t = ROLE_CALL_TOKENS[role];
    return [role, price ? Math.ceil((t.input * price.inputPerMTok + t.output * price.outputPerMTok) / 1_000_000) : null];
  })) as Record<StageRole, number | null>;
}

/** Tokens one image call is assumed to use beyond its per-image price (the
 *  shot's reference photos and prompt in, the model's thinking out) —
 *  stated, conservative. */
export const IMAGE_CALL_TOKENS = { input: 6_000, thinking: 1_500 } as const;

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

export function economicsFor(
  state: EngineState, billing: BillingConfig, opts: { draft?: { config: EngineConfig; version: number } } = {},
): V2Economics | null {
  const preview = !state.config && Boolean(opts.draft);
  const config = state.config ?? opts.draft?.config ?? null;
  if (!config || !state.model) return null;
  const roleCalls = roleCallCosts(state, config);
  const textPriced = Object.values(roleCalls).every((v) => v !== null);
  const imageTokens = imageTokenCost(state, config);
  const tables: EconTable[] = state.model.resolutions.map((resolution) => {
    const unitCredits = state.model!.pricing[resolution] ?? 0;
    const imageUsdMicros = imageUnitPrice(state, resolution);
    const project = (credits: number) => ECON_SHOT_COUNTS.flatMap((shots) =>
      ECON_SCENARIOS.map((scenario) => ({
        shots,
        ...projectOrder({
          shots, unitCredits: credits, imageUsdMicros: imageUsdMicros!,
          imageTokenUsdMicros: imageTokens,
          roleCalls,
          billing, config,
        }, scenario),
      })));
    const rows = imageUsdMicros === null || unitCredits <= 0 ? [] : project(unitCredits);
    let breakEvenCredits: number | null = null;
    if (imageUsdMicros !== null) {
      for (let c = 1; c <= 300; c++) {
        if (project(c).filter((r) => r.scenario === "typical").every((r) => r.meetsFloor)) { breakEvenCredits = c; break; }
      }
    }
    return { resolution, unitCredits, imageUsdMicros, rows, breakEvenCredits };
  });
  // Every size the customer can order must pass — not only the cheapest.
  const allowed = !preview && tables.length > 0 && tables.every((t) => t.rows.length > 0 && customerRolloutAllowed(t.rows));
  return {
    billing, textPriced, roleCalls, imageTokensPriced: imageTokens !== null, tables, customerAllowed: allowed,
    preview, previewVersion: preview ? opts.draft!.version : null,
  };
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

