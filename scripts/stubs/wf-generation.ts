/** Test double for lib/server/generation.ts in the workflow v2 suite:
 *  `resolveModelCandidate` hands back FAKE adapters whose behaviour each test
 *  scripts (succeed, fail retriably, fail for good, return a partial), and
 *  every provider request is recorded. `runGeneration` records the single
 *  billed call of the OFF path. Nothing here reaches a network. */
import type { GenerateInput, GenerateOutput } from "../../lib/server/generation";
import { ProviderError, type ReferenceImage } from "../../lib/ai/types";
export type { GenerateInput, GenerateOutput };

export type FakeBehaviour = "ok" | "rate_limited" | "quota" | "invalid" | "timeout";
export const imageCalls: { modelId: string; provider: string; prompt: string; refs: ReferenceImage[]; at: number }[] = [];
export const modelScript = new Map<string, FakeBehaviour[]>();
export const fakeModels = new Map<string, { providerSlug: string; identifier: string; costMicros: number | null }>();
export const generationCalls: GenerateInput[] = [];
let seq = 0;

export async function runGeneration(_s: unknown, _u: string, _w: string, input: GenerateInput): Promise<GenerateOutput> {
  generationCalls.push(input);
  return { ok: true, jobId: "job-off", productId: null, images: [{ url: "https://x/1.png", path: "ws/job-off/0.png" }], credits: 7 };
}

export async function resolveModelCandidate(_s: unknown, modelId: string) {
  const m = fakeModels.get(modelId);
  if (!m) return null;
  const model = {
    id: modelId, model_identifier: m.identifier, name: m.identifier, display_name: m.identifier,
    supported_resolutions: ["1K"], supported_aspect_ratios: ["1:1", "4:5"], supports_reference_images: true,
    max_reference_images: 6, internal_cost_usd_micros: m.costMicros, metadata: {}, pricing: {}, credit_cost: 1,
  };
  const adapter = {
    capabilities: { supportsReferenceImages: true, ratios: ["1:1", "4:5"] },
    worstCaseMs: () => 1000,
    async generate(_model: unknown, req: { prompt: string; referenceImages?: ReferenceImage[] }) {
      imageCalls.push({ modelId, provider: m.providerSlug, prompt: req.prompt, refs: req.referenceImages ?? [], at: Date.now() });
      const next = modelScript.get(modelId)?.shift() ?? "ok";
      // Parallel children really overlap in time (WF17).
      await new Promise((r) => setTimeout(r, 15));
      if (next === "rate_limited") throw new ProviderError("provider_rate_limited", true);
      if (next === "timeout") throw new ProviderError("provider_timeout", true);
      if (next === "quota") throw new ProviderError("provider_quota", false);
      if (next === "invalid") throw new ProviderError("provider_invalid_request", false);
      seq++;
      return { images: [{ base64: Buffer.from(`IMG:${modelId}:${seq}`).toString("base64"), mime: "image/png" }] };
    },
  };
  return { model, providerSlug: m.providerSlug, adapter, apiKey: "k", baseUrl: null };
}

export function resetGeneration() {
  imageCalls.length = 0; modelScript.clear(); generationCalls.length = 0;
}
