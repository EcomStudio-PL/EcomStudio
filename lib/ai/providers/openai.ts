import "server-only";
import type { AiModelRecord, GenerationRequest, GenerationResult, ImageProviderAdapter, ProviderCredential } from "../types";
import { ProviderError } from "../types";

const SIZE: Record<string, string> = { "1:1": "1024x1024", "4:5": "1024x1536", "9:16": "1024x1536", "16:9": "1536x1024" };

/** OpenAI Images API (gpt-image-1). Base64 responses; quality mapped from
 *  the requested resolution tier. */
export const openaiAdapter: ImageProviderAdapter = {
  slug: "openai",
  capabilities: { resolutions: ["1K", "2K"], maxQuantity: 4, supportsReferenceImages: false },

  async generate(model: AiModelRecord, req: GenerationRequest, cred: ProviderCredential): Promise<GenerationResult> {
    const base = cred.baseUrl?.replace(/\/$/, "") || "https://api.openai.com";
    const res = await fetch(`${base}/v1/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cred.apiKey}` },
      body: JSON.stringify({
        model: model.model_identifier,
        prompt: `${req.prompt}\n\n${req.productLock.fidelityInstructions}`,
        n: req.quantity,
        size: SIZE[req.aspectRatio] ?? "1024x1024",
        quality: req.resolution === "2K" ? "high" : "medium",
      }),
      signal: AbortSignal.timeout(120_000),
    }).catch((e) => {
      throw new ProviderError(e?.name === "TimeoutError" ? "provider_timeout" : "provider_unreachable", true);
    });
    if (res.status === 401 || res.status === 403) throw new ProviderError("provider_auth_failed");
    if (res.status === 429) throw new ProviderError("provider_rate_limited", true);
    if (!res.ok) throw new ProviderError("provider_error", res.status >= 500);
    const json = (await res.json()) as { data?: { b64_json?: string }[] };
    const images = (json.data ?? []).filter((d) => d.b64_json).map((d) => ({ base64: d.b64_json!, mime: "image/png" }));
    if (!images.length) throw new ProviderError("provider_empty_result");
    return { images };
  },
};
