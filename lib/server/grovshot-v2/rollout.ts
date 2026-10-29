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

/** Is every stage model priced from a published token list? */
function textModelsPriced(state: EngineState, config: EngineConfig | null): boolean {
  const priced = (provider: string, model: string | null) =>
    model !== null && state.tokenPrices.some((p) => p.providerSlug === provider && p.model === model);
  const first = state.textModels[0];
  if (!first) return false;
  const stageModels = (["validate", "card", "plan", "qc"] as const).map((k) => config?.models[k] ?? { provider: first.provider, model: first.model });
  return stageModels.every((m) => priced(m.provider, m.model ?? null));
}

export function economicsFor(state: EngineState, billing: BillingConfig): V2Economics | null {
  if (!state.config || !state.model) return null;
  const config = state.config;
  const textPriced = textModelsPriced(state, config);
  const tables: EconTable[] = state.model.resolutions.map((resolution) => {
    const unitCredits = state.model!.pricing[resolution] ?? 0;
    const imageUsdMicros = imageUnitPrice(state, resolution);
    const rows = imageUsdMicros === null || unitCredits <= 0 ? [] : ECON_SHOT_COUNTS.flatMap((shots) =>
      ECON_SCENARIOS.map((scenario) => ({
        shots,
        ...projectOrder({
          shots, unitCredits, imageUsdMicros,
          textCallUsdMicros: textPriced ? config.budget.vision_call_usd_micros : null,
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

