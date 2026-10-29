/** GrovShot V2 tests — what the stubbed settings / keyring answer, set per
 *  test (scripts/grovshot-v2-tests.ts). Never a real price, key or model. */
import type { StageBody } from "@/lib/server/grovshot-v2/settings";
import type { GrovshotStageKey } from "@/lib/grovshot-v2/stages";

export type Gsv2Env = {
  bodies: Partial<Record<GrovshotStageKey, StageBody>>;
  modelReady: boolean;
  pricing: Record<string, number>;
  imagePrice: Record<string, number | null>;
  /** Every role's provider key state (the config's models answer, or not). */
  roleState: "ok" | "inactive" | "no_key";
  tokenPrices: { providerSlug: string; model: string; inputPerMTok: number; outputPerMTok: number; cachedInputPerMTok?: number | null }[];
  ringUp: boolean;
};

const g = globalThis as unknown as { __GSV2_ENV?: Gsv2Env };

export function gsv2Env(): Gsv2Env {
  g.__GSV2_ENV ??= {
    bodies: {}, modelReady: true, pricing: { "1K": 7, "2K": 7, "4K": 12 }, imagePrice: { "1K": 134_000, "2K": 134_000, "4K": 240_000 },
    roleState: "ok", tokenPrices: [], ringUp: true,
  };
  return g.__GSV2_ENV;
}
