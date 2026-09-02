import "server-only";
import type { AiModelRecord, GenerationRequest, GenerationResult, ImageProviderAdapter, ProviderCredential } from "../types";
import { ProviderError, sanitizeUpstreamMessage } from "../types";

const SIZE: Record<string, string> = { "1:1": "1024x1024", "4:5": "1024x1536", "9:16": "1024x1536", "16:9": "1536x1024" };
// Fallback when the model row sets no cap of its own; the panel allows 10.
const MAX_REFS = 10;

/**
 * OpenAI Images API (gpt-image-1).
 * With reference images the request goes to /v1/images/edits as multipart —
 * that is what carries the actual product into the generation, so product
 * fidelity depends on it. Without references it falls back to
 * /v1/images/generations. Quality is the request's validated choice
 * ("Jakość"), else a per-row pin, else a guess from the output size.
 */
export const openaiAdapter: ImageProviderAdapter = {
  slug: "openai",
  capabilities: { resolutions: ["1K", "2K"], maxQuantity: 4, supportsReferenceImages: true, ratios: ["1:1", "4:5", "16:9", "9:16"] },

  async generate(model: AiModelRecord, req: GenerationRequest, cred: ProviderCredential): Promise<GenerationResult> {
    const base = cred.baseUrl?.replace(/\/$/, "") || "https://api.openai.com";
    const prompt = `${req.prompt}\n\n${req.productLock.fidelityInstructions}`;
    const size = SIZE[req.aspectRatio] ?? "1024x1024";
    // The customer's choice first (already validated against the model's
    // declared qualities), then a pinned per-row quality, then the old
    // size-based guess for rows that say nothing.
    const quality = req.quality
      ?? ((model.metadata as { quality?: string } | null)?.quality)
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

    if (!res.ok) throw await classifyOpenAiError(res);

    const json = (await res.json()) as { data?: { b64_json?: string }[] };
    const images = (json.data ?? []).filter((d) => d.b64_json).map((d) => ({ base64: d.b64_json!, mime: "image/png" }));
    if (!images.length) throw new ProviderError("provider_empty_result");
    return { images, providerMetadata: { requestId: res.headers.get("x-request-id") ?? undefined } };
  },
};

/**
 * REAL upstream classification. A 429 is NOT one thing: OpenAI uses it both
 * for "slow down" (retryable) and for "your account has no funds"
 * (insufficient_quota — retrying is pointless, fall back to another
 * provider). Everything is preserved for the admin as sanitized codes.
 */
async function classifyOpenAiError(res: Response): Promise<ProviderError> {
  let type = "", code = "", message = "";
  try {
    const parsed = JSON.parse(await res.text()) as { error?: { type?: string; code?: string; message?: string } };
    type = parsed.error?.type ?? "";
    code = parsed.error?.code ?? "";
    message = parsed.error?.message ?? "";
  } catch { /* non-JSON body */ }

  const retryAfter = Number(res.headers.get("retry-after"));
  const upstream = {
    status: res.status, type, code,
    message: sanitizeUpstreamMessage(message),
    requestId: res.headers.get("x-request-id"),
    retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
  };

  if (res.status === 401) return new ProviderError("provider_auth_failed", false, code || "invalid_key", upstream);
  if (res.status === 403) return new ProviderError("provider_auth_failed", false, code || "access_denied", upstream);
  if (res.status === 429) {
    const quota = code === "insufficient_quota" || type === "insufficient_quota" || /quota|billing/i.test(message);
    return quota
      ? new ProviderError("provider_quota", false, code || "insufficient_quota", upstream)
      : new ProviderError("provider_rate_limited", true, code || "rate_limit_exceeded", upstream);
  }
  if (res.status === 404 || code === "model_not_found" || /model .* (does not exist|not found)/i.test(message)) {
    return new ProviderError("model_unavailable", false, code || "model_not_found", upstream);
  }
  if (res.status === 400 && (code === "content_policy_violation" || /content policy|safety system/i.test(message))) {
    return new ProviderError("content_policy", false, code || "content_policy_violation", upstream);
  }
  if (res.status === 400 || res.status === 422) {
    return new ProviderError("provider_invalid_request", false, code || "invalid_request", upstream);
  }
  return new ProviderError("provider_error", res.status >= 500 || res.status === 408, code || `http_${res.status}`, upstream);
}

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
