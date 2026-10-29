import "server-only";
import { createHash } from "node:crypto";
import type { Client } from "@/lib/services/workspace";
import { resolveEngine } from "@/lib/server/ai-engine";
import { getUsableModels, type UsableModel } from "@/lib/ai/router";
import { readTokenPrices, readUnitPrices } from "@/lib/server/ai-usage";
import { textCapableBackends } from "@/lib/server/prompt-engine";
import { imageCallCost, type TokenPrice, type UnitPrice } from "@/lib/ai/usage-cost";
import { priceFor } from "@/lib/ai/types";
import { parseEngineConfig, type EngineConfig } from "@/lib/grovshot-v2/config";
import { grovshotTemplateProblems } from "@/lib/grovshot-v2/gate";
import { GROVSHOT_V2_KEYS, GROVSHOT_V2_MODEL_IDENTIFIER, type GrovshotStageKey } from "@/lib/grovshot-v2/stages";

/**
 * GROVBASE SHOT V2 — WHAT THE ENGINE RUNS ON, READ LIVE.
 *
 * Everything comes from what an admin published: the five stage templates
 * and the engine config (ai_tool_prompts, one key each), the Nano Banana Pro
 * model row (its prices per size, its ratios and sizes), the text/vision
 * backends of the GrovShot planner chain and the provider price lists. A
 * missing piece is a BLOCKER, named — the engine never substitutes a
 * built-in text or a guessed price for it.
 */

export { GROVSHOT_V2_MODEL_IDENTIFIER };

export type StageBody = { key: GrovshotStageKey; version: number; text: string; sha256: string };

export type V2Model = {
  id: string;
  identifier: string;
  providerSlug: string;
  resolutions: string[];
  ratios: string[];
  maxRefs: number;
  /** Credits per delivered image, per size (ai_models.pricing). */
  pricing: Record<string, number>;
  model: UsableModel;
};

export type EngineState = {
  ready: boolean;
  blockers: string[];
  bodies: Partial<Record<GrovshotStageKey, StageBody>>;
  config: EngineConfig | null;
  model: V2Model | null;
  textBackends: number;
  /** The planner chain's backends, in order (provider + preferred model). */
  textModels: { provider: string; model: string | null }[];
  unitPrices: UnitPrice[];
  tokenPrices: TokenPrice[];
};

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** One stage key's PUBLISHED body (grovbase mode only), or why not. */
async function publishedBody(supabase: Client, key: GrovshotStageKey): Promise<StageBody | string> {
  const engine = await resolveEngine(supabase, key);
  if (!engine) return `${key}:unreadable`;
  if (engine.mode !== "grovbase") return `${key}:mode`;
  if (engine.promptVersion === null) return `${key}:unpublished`;
  // A version is published but no key opens it: not "nothing published",
  // and never a reason to run on something else.
  if (!engine.systemPrompt?.trim()) return `${key}:unopenable`;
  const problems = grovshotTemplateProblems(key, engine.systemPrompt);
  if (problems.length > 0) return `${key}:invalid`;
  return { key, version: engine.promptVersion, text: engine.systemPrompt, sha256: sha(engine.systemPrompt) };
}

export async function readEngineState(supabase: Client): Promise<EngineState> {
  const blockers: string[] = [];
  const [bodiesList, usable, backends, unitPrices, tokenPrices] = await Promise.all([
    Promise.all(GROVSHOT_V2_KEYS.map((k) => publishedBody(supabase, k))),
    getUsableModels(supabase).catch(() => [] as UsableModel[]),
    textCapableBackends(supabase).catch(() => []),
    readUnitPrices(supabase),
    readTokenPrices(supabase),
  ]);
  const bodies: EngineState["bodies"] = {};
  for (const b of bodiesList) {
    if (typeof b === "string") blockers.push(b);
    else bodies[b.key] = b;
  }
  let config: EngineConfig | null = null;
  if (bodies.grovshot_v2_config) {
    const parsed = parseEngineConfig(bodies.grovshot_v2_config.text);
    if (parsed.ok) config = parsed.config;
    else blockers.push("config_invalid");
  }
  const m = usable.find((x) => x.model_identifier === GROVSHOT_V2_MODEL_IDENTIFIER);
  const model: V2Model | null = m && m.capabilities_ui.supportsReferenceImages ? {
    id: m.id, identifier: m.model_identifier, providerSlug: m.provider_slug,
    resolutions: m.capabilities_ui.resolutions, ratios: m.capabilities_ui.ratios,
    maxRefs: Math.max(1, Math.min(6, m.max_reference_images || 6)),
    pricing: Object.fromEntries(m.capabilities_ui.resolutions.map((r) => [r, priceFor(m, r)])),
    model: m,
  } : null;
  if (!model) blockers.push("model_unavailable");
  if (backends.length === 0) blockers.push("text_backend_unavailable");
  return {
    ready: blockers.length === 0, blockers, bodies, config, model, textBackends: backends.length,
    textModels: backends.map((b) => ({ provider: b.provider, model: b.model ?? null })), unitPrices, tokenPrices,
  };
}

/** The official provider price of one NBP image at a size (USD micros), or
 *  null when the price list has none — never a guess. */
export function imageUnitPrice(state: Pick<EngineState, "unitPrices" | "tokenPrices" | "model">, resolution: string): number | null {
  if (!state.model) return null;
  const c = imageCallCost(state.unitPrices, state.tokenPrices, state.model.providerSlug, state.model.identifier, 1, {
    resolution, quality: null,
    perImageFallbackUsdMicros: (state.model.model as { internal_cost_usd_micros?: number | null }).internal_cost_usd_micros ?? null,
    inputTokens: null, thoughtTokens: null,
  });
  return c.base.basis === "unknown" ? null : c.base.usdMicros;
}
