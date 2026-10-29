/** Test double of lib/server/grovshot-v2/settings.ts: the published state
 *  comes from the test's env (scripts/stubs/gsv2-env.ts). */
import { STAGE_ROLES, parseEngineConfig, type EngineConfig } from "@/lib/grovshot-v2/config";
import type { RoleStatus } from "@/lib/server/grovshot-v2/backends";
import { GROVSHOT_V2_KEYS, GROVSHOT_V2_MODEL_IDENTIFIER, type GrovshotStageKey } from "@/lib/grovshot-v2/stages";
import { gsv2Env } from "./gsv2-env";

export { GROVSHOT_V2_MODEL_IDENTIFIER };
export type StageBody = { key: GrovshotStageKey; version: number; text: string; sha256: string };
export type V2Model = {
  id: string; identifier: string; providerSlug: string; resolutions: string[]; ratios: string[]; maxRefs: number;
  pricing: Record<string, number>; model: Record<string, unknown>;
};
export type EngineState = {
  ready: boolean; blockers: string[]; bodies: Partial<Record<GrovshotStageKey, StageBody>>; config: EngineConfig | null;
  model: V2Model | null; roles: RoleStatus[];
  unitPrices: never[]; tokenPrices: ReturnType<typeof gsv2Env>["tokenPrices"];
};

export const NBP_ID = "33333333-3333-4333-8333-333333333333";

export async function readEngineState(): Promise<EngineState> {
  const e = gsv2Env();
  const blockers: string[] = GROVSHOT_V2_KEYS.filter((k) => !e.bodies[k]).map((k) => `${k}:unpublished`);
  const parsed = e.bodies.grovshot_v2_config ? parseEngineConfig(e.bodies.grovshot_v2_config.text) : null;
  if (parsed && !parsed.ok) blockers.push("config_invalid");
  const model: V2Model | null = e.modelReady ? {
    id: NBP_ID, identifier: GROVSHOT_V2_MODEL_IDENTIFIER, providerSlug: "google",
    resolutions: Object.keys(e.pricing), ratios: ["1:1", "4:5", "3:4", "16:9"], maxRefs: 6, pricing: e.pricing, model: {},
  } : null;
  if (!model) blockers.push("model_unavailable");
  const config = parsed?.ok ? parsed.config : null;
  const roles: RoleStatus[] = config ? STAGE_ROLES.map((role) => ({
    role, primary: { ...config.models[role], state: e.roleState }, fallback: null, usable: e.roleState === "ok",
  })) : [];
  for (const r of roles) if (!r.usable) blockers.push(`models.${r.role}:${r.primary.state}`);
  return {
    ready: blockers.length === 0, blockers, bodies: { ...e.bodies }, config,
    model, roles, unitPrices: [], tokenPrices: e.tokenPrices,
  };
}

export function imageUnitPrice(_state: unknown, resolution: string): number | null {
  return gsv2Env().imagePrice[resolution] ?? null;
}
