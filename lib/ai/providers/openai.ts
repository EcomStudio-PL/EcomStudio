import "server-only";
import type { AiModelRecord, GenerationRequest, GenerationResult, ImageProviderAdapter, ProviderCredential } from "../types";
import { ProviderError } from "../types";

const SIZE: Record<string, string> = { "1:1": "1024x1024", "4:5": "1024x1536", "9:16": "1024x1536", "16:9": "1536x1024" };
const MAX_REFS = 6;

/**
 * OpenAI Images API (gpt-image-1).
 * With reference images the request goes to /v1/images/edits as multipart —
 * that is what carries the actual product into the generation, so product
 * fidelity depends on it. Without references it falls back to
 * /v1/images/generations. Quality comes from the display-model config
 * (GPT Image 2 Medium and High share one endpoint and differ only here).
 */
export const openaiAdapter: ImageProviderAdapter = {
  slug: "openai",
  capabilities: { resolutions: ["1K", "2K"], maxQuantity: 4, supportsReferenceImages: true },

  async generate(model: AiModelRecord, req: GenerationRequest, cred: ProviderCredential): Promise<GenerationResult> {
    const base = cred.baseUrl?.replace(/\/$/, "") || "https://api.openai.com";
    const prompt = `${req.prompt}\n\n${req.productLock.fidelityInstructions}`;
    const size = SIZE[req.aspectRatio] ?? "1024x1024";
    const quality = ((model.metadata as { quality?: string } | null)?.quality)
      ?? (req.resolution === "2K" || req.resolution === "4K" ? "high" : "medium");
    const refs = req.referenceImages.slice(0, model.max_reference_images || MAX_REFS);

    const path = refs.length > 0 ? "/v1/images/edits" : "/v1/images/generations";
    const send = (highFidelity: boolean) => fetch(`${base}${path}`, {
      method: "POST",
      headers: refs.length > 0
        ? { Authorization: `Bearer ${cred.apiKey}` }
        : { "Content-Type": "application/json", Authorization: `Bearer ${cred.apiKey}` },
      body: refs.length > 0
        ? editForm(model.model_identifier, prompt, size, quality, req.quantity, refs, highFidelity)
        : JSON.stringify({ model: model.model_identifier, prompt, n: req.quantity, size, quality }),
      signal: AbortSignal.timeout(180_000),
    }).catch((e) => {
      throw new ProviderError(e?.name === "TimeoutError" ? "provider_timeout" : "provider_unreachable", true);
    });

    // Ask for the strongest reference-fidelity mode the endpoint offers — this
    // is what keeps the actual product, not a lookalike. If this account or
    // API version does not accept the parameter, the 400 is retried once
    // without it rather than failing a generation the user paid for.
    let res = await send(refs.length > 0);
    if (res.status === 400 && refs.length > 0) res = await send(false);

    if (res.status === 401 || res.status === 403) throw new ProviderError("provider_auth_failed");
    if (res.status === 429) throw new ProviderError("provider_rate_limited", true);
    if (!res.ok) throw new ProviderError("provider_error", res.status >= 500);

    const json = (await res.json()) as { data?: { b64_json?: string }[] };
    const images = (json.data ?? []).filter((d) => d.b64_json).map((d) => ({ base64: d.b64_json!, mime: "image/png" }));
    if (!images.length) throw new ProviderError("provider_empty_result");
    return { images, providerMetadata: { requestId: res.headers.get("x-request-id") ?? undefined } };
  },
};

/** Multipart body for the edits endpoint: every reference goes in as image[]. */
function editForm(
  modelId: string, prompt: string, size: string, quality: string,
  quantity: number, refs: { base64: string; mime: string }[], highFidelity: boolean
): FormData {
  const form = new FormData();
  form.append("model", modelId);
  form.append("prompt", prompt);
  form.append("n", String(quantity));
  form.append("size", size);
  form.append("quality", quality);
  // Preserve the referenced object as closely as the model allows.
  if (highFidelity) form.append("input_fidelity", "high");
  refs.forEach((r, i) => {
    const ext = r.mime.includes("png") ? "png" : r.mime.includes("webp") ? "webp" : "jpg";
    form.append("image[]", new Blob([Buffer.from(r.base64, "base64")], { type: r.mime }), `ref${i + 1}.${ext}`);
  });
  return form;
}
