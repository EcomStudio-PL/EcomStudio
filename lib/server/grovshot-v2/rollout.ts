import "server-only";
import type { Client } from "@/lib/services/workspace";
import { billingFrom, type BillingConfig } from "@/lib/images/pricing";
import {
  ECON_SCENARIOS, ECON_SHOT_COUNTS, customerRolloutAllowed, projectOrder, type EconRow,
} from "@/lib/grovshot-v2/economics";
import type { EngineConfig } from "@/lib/grovshot-v2/config";
import { imageUnitPrice, readEngineState, type EngineState } from "@/lib/server/grovshot-v2/settings";

/**
 * GROVBASE SHOT V2 — MAY CUSTOMERS GET IT AT TODAY'S PRICES? The flag decides
 * who is ASKED for V2; this decides whether a non-admin may actually be
 * routed to it: only while a typical order of every size meets the billing
 * margin floor with every stage priced from a published list (the brief:
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
  tables: EconTable[];
  /** Typical orders meet the floor at every size, text priced from a list. */
  customerAllowed: boolean;
};

/** Tokens one text/vision stage call is assumed to use for this projection
 *  (several photos in, a JSON answer out) — stated, conservative. */
export const TEXT_CALL_TOKENS = { input: 8_000, output: 2_000 } as const;

/**
 * What one text/vision stage call costs at the PUBLISHED token prices of
 * every stage model (the dearest of them), never below the config's own
 * estimate — so an estimate set to 0 cannot open the customer gate. Null
 * when any stage model has no published price.
 */
export function textCallCost(state: EngineState, config: EngineConfig | null): number | null {
  const first = state.textModels[0];
  if (!first || !config) return null;
  let dearest = 0;
  for (const k of ["validate", "card", "plan", "qc"] as const) {
    const m = config.models[k] ?? { provider: first.provider, model: first.model };
    const price = m.model ? state.tokenPrices.find((p) => p.providerSlug === m.provider && p.model === m.model) : undefined;
    if (!price) return null;
    const cost = (TEXT_CALL_TOKENS.input * price.inputPerMTok + TEXT_CALL_TOKENS.output * price.outputPerMTok) / 1_000_000;
    dearest = Math.max(dearest, Math.ceil(cost));
  }
  return Math.max(dearest, config.budget.vision_call_usd_micros);
}

export function economicsFor(state: EngineState, billing: BillingConfig): V2Economics | null {
  if (!state.config || !state.model) return null;
  const config = state.config;
  const textCall = textCallCost(state, config);
  const textPriced = textCall !== null;
  const tables: EconTable[] = state.model.resolutions.map((resolution) => {
    const unitCredits = state.model!.pricing[resolution] ?? 0;
    const imageUsdMicros = imageUnitPrice(state, resolution);
    const rows = imageUsdMicros === null || unitCredits <= 0 ? [] : ECON_SHOT_COUNTS.flatMap((shots) =>
      ECON_SCENARIOS.map((scenario) => ({
        shots,
        ...projectOrder({
          shots, unitCredits, imageUsdMicros,
          textCallUsdMicros: textCall,
          billing, config,
        }, scenario),
      })));
    return { resolution, unitCredits, imageUsdMicros, rows };
  });
  // Every size the customer can order must pass — not only the cheapest.
  const allowed = tables.length > 0 && tables.every((t) => t.rows.length > 0 && customerRolloutAllowed(t.rows));
  return { billing, textPriced, tables, customerAllowed: allowed };
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

