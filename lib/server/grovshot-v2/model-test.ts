import "server-only";
import type { Client } from "@/lib/services/workspace";
import { ProviderError } from "@/lib/ai/types";
import { callVisionJson, type VisionAttempt } from "@/lib/ai/engine/vision";
import { tokenCost } from "@/lib/ai/usage-cost";
import { readTokenPrices, recordProviderCalls } from "@/lib/server/ai-usage";
import type { StageModelRef, StageRole } from "@/lib/grovshot-v2/config";
import { credentialOf } from "@/lib/server/grovshot-v2/backends";

/**
 * GROVBASE SHOT V2 — „Testuj model” in the readiness centre: its own module
 * so the admin page's actions load the vision layer (and the provider SDKs)
 * only when the button is pressed.
 */

export type ModelTestResult =
  | { ok: true; latencyMs: number; input: number | null; output: number | null; usdMicros: number | null }
  | { ok: false; error: string; latencyMs: number | null };

/** The JSON a health check asks for — the smallest structured answer. */
const PING_SCHEMA = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };

/**
 * ONE REAL, MINIMAL REQUEST to a role's model — the admin pressed the button
 * (a few tokens, priced and recorded as the admin's own provider call). The
 * key is opened on the server and never leaves it; the answer is a code,
 * never the provider's message.
 */
export async function testStageModel(supabase: Client, adminId: string, role: StageRole, ref: StageModelRef): Promise<ModelTestResult> {
  const cred = await credentialOf(supabase, ref.provider).catch(() => ({ state: "no_key" as const }));
  if (cred.state !== "ok" || !("apiKey" in cred) || !cred.apiKey) return { ok: false, error: cred.state === "inactive" ? "provider_inactive" : "no_credential", latencyMs: null };
  const attempts: VisionAttempt[] = [];
  const started = Date.now();
  let error: string | null = null;
  try {
    await callVisionJson<{ ok: boolean }>([{
      provider: ref.provider, cred: { apiKey: cred.apiKey, baseUrl: cred.baseUrl ?? null }, model: ref.model,
      ...(ref.provider === "anthropic" && ref.effort ? { effort: ref.effort } : {}),
      meter: (a) => { attempts.push(a); },
    }], {
      images: [], system: "Health check. Answer with the JSON object the schema describes.", user: "Set ok to true.",
      schema: PING_SCHEMA, timeoutMs: 30_000, maxAttemptsPerModel: 1,
    });
  } catch (e) {
    error = e instanceof ProviderError ? e.safeMessage : "analysis_error";
  }
  const latencyMs = Date.now() - started;
  const prices = await readTokenPrices(supabase);
  const a = attempts[0];
  const cost = a ? tokenCost(prices, a.provider, a.model, a.inputTokens, a.outputTokens, a.cachedInputTokens) : null;
  if (a) {
    await recordProviderCalls(supabase, [{
      actorKind: "admin", consumer: "provider_test", userId: adminId, toolKey: "prompts", runRef: `gsv2-model-test:${role}`,
      providerSlug: a.provider, model: a.model, status: a.ok ? "succeeded" : "failed", errorCode: a.ok ? null : (a.error ?? "analysis_error"),
      inputTokens: a.inputTokens ?? null, outputTokens: a.outputTokens ?? null, cachedInputTokens: a.cachedInputTokens ?? null,
      cost: cost ?? { basis: "unknown" }, durationMs: a.durationMs,
    }]);
  }
  if (error) return { ok: false, error: error.slice(0, 60), latencyMs };
  return {
    ok: true, latencyMs, input: a?.inputTokens ?? null, output: a?.outputTokens ?? null,
    usdMicros: cost && cost.basis !== "unknown" ? cost.usdMicros : null,
  };
}
