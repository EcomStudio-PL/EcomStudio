/** Test double of lib/server/grovshot-v2/model-test (no HTTP): a model
 *  answers its minimal request unless gsv2Env().modelPing says otherwise. */
import type { StageModelRef, StageRole } from "@/lib/grovshot-v2/config";
import { gsv2Env } from "./gsv2-env";

export type ModelTestResult =
  | { ok: true; latencyMs: number; input: number | null; output: number | null; usdMicros: number | null }
  | { ok: false; error: string; latencyMs: number | null };

export async function testStageModel(_supabase: unknown, _adminId: string, _role: StageRole, ref: StageModelRef): Promise<ModelTestResult> {
  const ok = gsv2Env().modelPing ? gsv2Env().modelPing!(ref.model) : true;
  return ok ? { ok: true, latencyMs: 1, input: 10, output: 5, usdMicros: 1 } : { ok: false, error: "analysis_model_missing", latencyMs: 1 };
}
