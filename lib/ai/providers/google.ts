import "server-only";
import type { AiModelRecord, GenerationRequest, GenerationResult, ImageProviderAdapter, ProviderCredential } from "../types";
import { ProviderError, sanitizeUpstreamMessage, timeoutFor } from "../types";

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
/** Below this there is no realistic chance of an image coming back, so the
 *  loop stops rather than spending a call it knows will time out. Generous
 *  enough that a healthy call is never refused; small enough that it only
 *  bites at the very end of a budget. */
const MIN_USEFUL_CALL_MS = 15_000;

export const googleAdapter: ImageProviderAdapter = {
  slug: "google",
  // Gemini takes the ratio verbatim, so everything it advertises is exact.
  // It has no "auto", and the extra shapes stay off this list until they are
  // verified against a live key rather than assumed from documentation.
  capabilities: {
    resolutions: [], maxQuantity: 4, supportsReferenceImages: true,
    ratios: ["1:1", "3:4", "4:5", "16:9", "9:16"],
    exactRatios: ["1:1", "3:4", "4:5", "16:9", "9:16"],
  },

  /**
   * N IMAGES IS N SEQUENTIAL CALLS HERE, so the worst case scales with the
   * quantity — four images can take four times the per-call timeout below.
   *
   * The runner used to assume one flat ceiling for every provider, which was
   * the OpenAI adapter's single 180 s request. On this adapter that assumption
   * let a four-image attempt START with far less time left than it could need,
   * and an attempt that overruns the route is killed with its charge already
   * taken — precisely the failure the deadline exists to prevent. The adapter
   * knows its own shape; the runner should not have to guess it.
   */
  worstCaseMs(quantity: number): number {
    return Math.max(1, quantity) * 95_000; // the 90 s below, plus the round trip
  },

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

    // QUANTITY IS N SEPARATE PAID CALLS, so a failure at call 4 of 4 must not
    // throw away — and make the runner buy again — the three images Google has
    // already produced and billed. They are carried out WITH the error: the
    // error still travels, so provider health still degrades, the attempt
    // still lands in the job's trail and the operator is still told. Only the
    // images stop being discarded.
    const images: GenerationResult["images"] = [];
    // Summed over the per-image requests, from each response's usageMetadata.
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    for (let i = 0; i < req.quantity; i++) {
      // THE DEADLINE IS CHECKED PER IMAGE, because each image is its own
      // request. Stopping here hands back what was produced through the
      // partial path below; running on would be killed by the platform with
      // the charge already taken and nobody left to refund it.
      const budget = timeoutFor(90_000, req.deadlineAt);
      /*
        A FLOOR, NOT JUST A SIGN TEST.

        `budget > 0` is not the same as "enough time to get an image back".
        The runner starts an attempt when one image's worth remains, so after
        the first image there can be a few seconds left — and firing a
        five-second request at an endpoint that routinely takes tens of
        seconds buys a guaranteed timeout that the provider may still bill.
        Below this floor the honest move is to stop and hand back what exists.
      */
      if (budget <= MIN_USEFUL_CALL_MS) {
        if (images.length === 0) throw new ProviderError("provider_timeout", true);
        throw new ProviderError("provider_timeout", true, undefined, undefined, images);
      }
      try {
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
          signal: AbortSignal.timeout(budget),
        }).catch((e) => {
          throw new ProviderError(e?.name === "TimeoutError" ? "provider_timeout" : "provider_unreachable", true);
        });
        if (!res.ok) throw await classifyGoogleError(res);
        const json = (await res.json()) as {
          candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] } }[];
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
        };
        const meta = json.usageMetadata;
        if (typeof meta?.promptTokenCount === "number") inputTokens = (inputTokens ?? 0) + meta.promptTokenCount;
        if (typeof meta?.candidatesTokenCount === "number" || typeof meta?.thoughtsTokenCount === "number") {
          outputTokens = (outputTokens ?? 0) + (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0);
        }
        const inline = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
        if (!inline?.data) throw new ProviderError("provider_empty_result");
        images.push({ base64: inline.data, mime: inline.mimeType || "image/png" });
      } catch (e) {
        // The FIRST call failing means nothing was produced and nothing was
        // billed, so it throws clean and the runner retries and falls back
        // exactly as it does today.
        if (images.length === 0) throw e;
        if (e instanceof ProviderError) { e.partial = images; throw e; }
        throw new ProviderError("provider_error", false, undefined, undefined, images);
      }
    }
    return {
      images,
      usage: inputTokens === undefined && outputTokens === undefined ? undefined : { inputTokens, outputTokens },
    };
  },
};
