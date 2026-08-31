import "server-only";
import type { AiModelRecord, GenerationRequest, GenerationResult, ImageProviderAdapter, ProviderCredential } from "../types";
import { ProviderError, sanitizeUpstreamMessage } from "../types";

/**
 * Google's 429 body decides everything: a per-minute quota violation is a
 * genuine rate limit (retry after RetryInfo.retryDelay), while a plan/billing
 * quota ("check your plan and billing details", per-day quotaIds) means the
 * key has no capacity at all — retrying is pointless and the router should
 * fall back to another provider.
 */
async function classifyGoogleError(res: Response): Promise<ProviderError> {
  let status = "", message = "", reasons: string[] = [], quotaIds = "", retryDelayMs: number | undefined;
  try {
    const parsed = JSON.parse(await res.text()) as {
      error?: {
        status?: string; message?: string;
        details?: { "@type"?: string; reason?: string; retryDelay?: string; violations?: { quotaId?: string }[] }[];
      };
    };
    status = parsed.error?.status ?? "";
    message = parsed.error?.message ?? "";
    for (const d of parsed.error?.details ?? []) {
      if (d.reason) reasons.push(d.reason);
      if (d.retryDelay) {
        const seconds = Number(String(d.retryDelay).replace(/s$/i, ""));
        if (Number.isFinite(seconds)) retryDelayMs = seconds * 1000;
      }
      quotaIds += (d.violations ?? []).map((v) => v.quotaId ?? "").join(",");
    }
  } catch { /* non-JSON body */ }

  const upstream = {
    status: res.status, type: status, code: reasons.join(",") || quotaIds.slice(0, 80) || undefined,
    message: sanitizeUpstreamMessage(message), requestId: null, retryAfterMs: retryDelayMs,
  };

  if (res.status === 401 || res.status === 403) return new ProviderError("provider_auth_failed", false, status || "auth", upstream);
  if (res.status === 429) {
    const perMinute = /PerMinute/i.test(quotaIds);
    const billing = /plan and billing|billing details/i.test(message) || /PerDay/i.test(quotaIds);
    return billing && !perMinute
      ? new ProviderError("provider_quota", false, "quota_exhausted", upstream)
      : new ProviderError("provider_rate_limited", true, "rate_limited", upstream);
  }
  if (res.status === 404) return new ProviderError("model_unavailable", false, "model_not_found", upstream);
  if (res.status === 400 && /safety|blocked/i.test(message)) {
    return new ProviderError("content_policy", false, "safety", upstream);
  }
  if (res.status === 400) return new ProviderError("provider_invalid_request", false, "invalid_request", upstream);
  return new ProviderError("provider_error", res.status >= 500, `http_${res.status}`, upstream);
}

/** Google Gemini image generation (gemini-2.5-flash-image family) via the
 *  REST generateContent endpoint. Reference images go inline as base64;
 *  the model returns inline base64 images. One image per call — quantity
 *  is handled by sequential calls so a partial failure can still refund. */
export const googleAdapter: ImageProviderAdapter = {
  slug: "google",
  // Gemini takes the ratio verbatim — 3:4 renders natively here, which is
  // why only google-backed models may advertise it.
  capabilities: { resolutions: [], maxQuantity: 4, supportsReferenceImages: true, ratios: ["1:1", "3:4", "4:5", "16:9", "9:16"] },

  async generate(model: AiModelRecord, req: GenerationRequest, cred: ProviderCredential): Promise<GenerationResult> {
    const base = cred.baseUrl?.replace(/\/$/, "") || "https://generativelanguage.googleapis.com";
    const url = `${base}/v1beta/models/${model.model_identifier}:generateContent?key=${encodeURIComponent(cred.apiKey)}`;

    const parts: Record<string, unknown>[] = [
      ...req.referenceImages.map((r) => ({ inlineData: { mimeType: r.mime, data: r.base64 } })),
      { text: `${req.prompt}\n\n${req.productLock.fidelityInstructions}` },
    ];

    // Gemini 3 image models accept an explicit output size; the 2.5 flash
    // image model only knows aspect ratio.
    const imageConfig: Record<string, unknown> = { aspectRatio: req.aspectRatio };
    if (req.resolution && (model.supported_resolutions ?? []).includes(req.resolution) && req.resolution !== "1K") {
      imageConfig.imageSize = req.resolution;
    }

    const images: GenerationResult["images"] = [];
    for (let i = 0; i < req.quantity; i++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            imageConfig,
          },
        }),
        signal: AbortSignal.timeout(90_000),
      }).catch((e) => {
        throw new ProviderError(e?.name === "TimeoutError" ? "provider_timeout" : "provider_unreachable", true);
      });
      if (!res.ok) throw await classifyGoogleError(res);
      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] } }[];
      };
      const inline = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
      if (!inline?.data) throw new ProviderError("provider_empty_result");
      images.push({ base64: inline.data, mime: inline.mimeType || "image/png" });
    }
    return { images };
  },
};
