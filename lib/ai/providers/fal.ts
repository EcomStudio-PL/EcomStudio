import "server-only";
import type { AiModelRecord, GenerationRequest, GenerationResult, ImageProviderAdapter, ProviderCredential } from "../types";
import { ProviderError, sanitizeUpstreamMessage } from "../types";

const SIZE: Record<string, Record<string, { width: number; height: number }>> = {
  "1K": {
    "1:1": { width: 1024, height: 1024 },
    "4:5": { width: 1024, height: 1280 },
    "16:9": { width: 1344, height: 768 },
    "9:16": { width: 768, height: 1344 },
  },
  "2K": {
    "1:1": { width: 1440, height: 1440 },
    "4:5": { width: 1152, height: 1440 },
    "16:9": { width: 1440, height: 810 },
    "9:16": { width: 810, height: 1440 },
  },
};

/** fal.ai synchronous run endpoint (FLUX Pro family). Returns hosted image
 *  URLs which the caller downloads and re-stores — nothing user-facing ever
 *  points at fal's CDN. FLUX 1.1 Pro is text-to-image (no reference input). */
export const falAdapter: ImageProviderAdapter = {
  slug: "fal",
  capabilities: { resolutions: ["1K", "2K"], maxQuantity: 4, supportsReferenceImages: false },

  async generate(model: AiModelRecord, req: GenerationRequest, cred: ProviderCredential): Promise<GenerationResult> {
    const base = cred.baseUrl?.replace(/\/$/, "") || "https://fal.run";
    // Endpoint is data, not code: an admin can point any fal model at its
    // path via ai_models.metadata.fal_endpoint (e.g. "fal-ai/flux-pro/v1.1",
    // "fal-ai/flux-kontext", …) without a deploy.
    const path = ((model.metadata as { fal_endpoint?: string } | null)?.fal_endpoint)
      || (model.model_identifier === "flux-pro-1.1" ? "fal-ai/flux-pro/v1.1" : model.model_identifier);
    const size = SIZE[req.resolution ?? "1K"]?.[req.aspectRatio] ?? SIZE["1K"]["1:1"];

    const res = await fetch(`${base}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Key ${cred.apiKey}` },
      body: JSON.stringify({
        prompt: `${req.prompt}\n\n${req.productLock.fidelityInstructions}`,
        image_size: size,
        num_images: req.quantity,
        enable_safety_checker: true,
      }),
      signal: AbortSignal.timeout(120_000),
    }).catch((e) => {
      throw new ProviderError(e?.name === "TimeoutError" ? "provider_timeout" : "provider_unreachable", true);
    });
    if (!res.ok) {
      // fal answers 403 both for a bad key AND for a locked/unfunded account
      // ("User is locked. Reason: TOP_UP.") — only the body tells them apart.
      let detail = "";
      try { detail = String((JSON.parse(await res.text()) as { detail?: unknown }).detail ?? ""); } catch { /* ignore */ }
      const upstream = {
        status: res.status, message: sanitizeUpstreamMessage(detail),
        requestId: res.headers.get("x-fal-request-id"), code: undefined as string | undefined,
      };
      if (res.status === 429) throw new ProviderError("provider_rate_limited", true, "rate_limited", upstream);
      if (/locked|top.?up|balance|exhausted|insufficient/i.test(detail)) {
        throw new ProviderError("provider_quota", false, "account_locked_top_up", upstream);
      }
      if (res.status === 401 || res.status === 403) throw new ProviderError("provider_auth_failed", false, "auth", upstream);
      if (res.status === 404) throw new ProviderError("model_unavailable", false, "endpoint_not_found", upstream);
      if (res.status === 422 || res.status === 400) throw new ProviderError("provider_invalid_request", false, `http_${res.status}`, upstream);
      throw new ProviderError("provider_error", res.status >= 500, `http_${res.status}`, upstream);
    }
    const json = (await res.json()) as { images?: { url: string; width?: number; height?: number; content_type?: string }[] };
    if (!json.images?.length) throw new ProviderError("provider_empty_result");
    return {
      images: json.images.map((i) => ({
        url: i.url, mime: i.content_type || "image/jpeg", width: i.width, height: i.height,
      })),
    };
  },
};
