import "server-only";
import type { AiModelRecord, GenerationRequest, GenerationResult, ImageProviderAdapter, ProviderCredential } from "../types";
import { ProviderError, sanitizeUpstreamMessage, timeoutFor } from "../types";
import {
  INTERACTIONS_API_REVISION, INTERACTIONS_PATH, buildGeminiImageRequest, buildRetouchInteraction, pickGeminiFinalImage,
  pickInteractionFinalImage, retouchInteractionViolation, type GeminiResponse, type InteractionResponse,
} from "./google-request";
import { captureInteractionBoundary } from "./google-boundary";

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

/** Google Gemini image models (Nano Banana family) via the REST
 *  generateContent endpoint. The body comes from buildGeminiImageRequest —
 *  the one request builder every caller shares. Reference images go inline
 *  as base64; the model returns inline base64 images. One image per call —
 *  quantity is handled by sequential calls so a partial failure can still
 *  refund. */
/**
 * ONE CALL'S CEILING. A reasoning image model (Gemini 3 Pro Image) thinks
 * before it draws, and a 4K edit legitimately takes far longer than a 1K
 * one. This protects the route from a hung request; it is not a quality
 * knob, and it is never shorter than such a call needs. The route budget
 * (GENERATION_BUDGET_MS) still bounds it from above.
 */
export const GOOGLE_CALL_CAP_MS = 180_000;
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
    // An edit with no ratio sent keeps the input photo's own shape.
    inputShapedOutput: true,
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
    return Math.max(1, quantity) * (GOOGLE_CALL_CAP_MS + 5_000); // the cap, plus the round trip
  },

  async generate(model: AiModelRecord, req: GenerationRequest, cred: ProviderCredential): Promise<GenerationResult> {
    // RETUSZ: its own minimal, stateless path (Interactions API, store:false).
    if (req.strictSingleImage) return generateRetouch(model, req, cred);
    const base = cred.baseUrl?.replace(/\/$/, "") || "https://generativelanguage.googleapis.com";
    const url = `${base}/v1beta/models/${model.model_identifier}:generateContent?key=${encodeURIComponent(cred.apiKey)}`;

    // The prompt goes out verbatim — see buildGeminiImageRequest.
    const { body } = buildGeminiImageRequest(model, req);
    const payload = JSON.stringify(body);

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
    let thoughtTokens: number | undefined;
    for (let i = 0; i < req.quantity; i++) {
      // THE DEADLINE IS CHECKED PER IMAGE, because each image is its own
      // request. Stopping here hands back what was produced through the
      // partial path below; running on would be killed by the platform with
      // the charge already taken and nobody left to refund it.
      const budget = timeoutFor(req.callTimeoutMs ?? GOOGLE_CALL_CAP_MS, req.deadlineAt);
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
        const floor = new ProviderError("provider_timeout", true, undefined, undefined, images);
        if (inputTokens !== undefined || outputTokens !== undefined) floor.usage = { inputTokens, outputTokens, thoughtTokens };
        throw floor;
      }
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          signal: AbortSignal.timeout(budget),
        }).catch((e) => {
          throw new ProviderError(e?.name === "TimeoutError" ? "provider_timeout" : "provider_unreachable", true);
        });
        if (!res.ok) throw await classifyGoogleError(res);
        const json = (await res.json()) as GeminiResponse & {
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
        };
        const meta = json.usageMetadata;
        if (typeof meta?.promptTokenCount === "number") inputTokens = (inputTokens ?? 0) + meta.promptTokenCount;
        if (typeof meta?.candidatesTokenCount === "number" || typeof meta?.thoughtsTokenCount === "number") {
          outputTokens = (outputTokens ?? 0) + (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0);
        }
        if (typeof meta?.thoughtsTokenCount === "number") thoughtTokens = (thoughtTokens ?? 0) + meta.thoughtsTokenCount;
        // The FINAL render — interim thought images are skipped (see
        // pickGeminiFinalImage); what the response carried is recorded.
        const pick = pickGeminiFinalImage(json);
        if (!pick.image) {
          const empty = new ProviderError("provider_empty_result", false, pick.finishReason ?? undefined);
          empty.usage = inputTokens === undefined && outputTokens === undefined ? undefined : { inputTokens, outputTokens, thoughtTokens };
          throw empty;
        }
        images.push({
          base64: pick.image.data, mime: pick.image.mimeType,
          response: { imageParts: pick.imageParts, thoughtImagesSkipped: pick.thoughtImages, finishReason: pick.finishReason },
        });
      } catch (e) {
        // The FIRST call failing means nothing was produced and nothing was
        // billed, so it throws clean and the runner retries and falls back
        // exactly as it does today.
        // What the responses so far REPORTED travels with the failure, so the
        // billed tokens are recorded rather than lost (response data only).
        const reported = inputTokens === undefined && outputTokens === undefined ? undefined : { inputTokens, outputTokens, thoughtTokens };
        if (images.length === 0) {
          if (e instanceof ProviderError && reported) e.usage = reported;
          throw e;
        }
        if (e instanceof ProviderError) { e.partial = images; if (reported) e.usage = reported; throw e; }
        const wrapped = new ProviderError("provider_error", false, undefined, undefined, images);
        if (reported) wrapped.usage = reported;
        throw wrapped;
      }
    }
    return {
      images,
      usage: inputTokens === undefined && outputTokens === undefined ? undefined : { inputTokens, outputTokens, thoughtTokens },
    };
  },
};

/**
 * RETUSZ — ONE STATELESS INTERACTION.
 *
 * POST /v1beta/interactions with the body buildRetouchInteraction makes
 * (model + [prompt, photo] + response_modalities image + store:false +
 * response_format {type:image, image_size 2K|4K, aspect_ratio?}). The
 * key travels in `x-goog-api-key` (as the official SDKs send it), never in
 * the URL. Exactly one HTTP request: no loop, no retry here.
 *
 * Before the request: the string about to be sent is parsed back and must be
 * exactly [the prompt, the photo] (retouchInteractionViolation), and the
 * photo inside it must hash to the stored original (strictInputSha256). Any
 * mismatch → `retouch_request_contract_failed`, no HTTP call; the runner
 * releases the reservation.
 */
async function generateRetouch(model: AiModelRecord, req: GenerationRequest, cred: ProviderCredential): Promise<GenerationResult> {
  const base = cred.baseUrl?.replace(/\/$/, "") || "https://generativelanguage.googleapis.com";
  const url = `${base}${INTERACTIONS_PATH}`;
  const payload = JSON.stringify(buildRetouchInteraction(model, req));
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-goog-api-key": cred.apiKey,
    "Api-Revision": INTERACTIONS_API_REVISION,
  };
  // NETWORK BOUNDARY: read back from `payload`, the exact string sent below.
  const captured = captureInteractionBoundary(url, Object.keys(headers), payload, model.model_identifier);
  const violation = retouchInteractionViolation(JSON.parse(payload) as Record<string, unknown>, req, model.model_identifier)
    ?? (req.quantity !== 1 ? "quantity" : null)
    ?? (req.strictInputSha256 && captured.provider_inputs[0]?.sha256 !== req.strictInputSha256 ? "image_sha_mismatch" : null);
  const boundary: Record<string, unknown> = { ...captured, contract_ok: violation === null, contract_violation: violation, http_requests: 0 };
  const fail = (e: ProviderError): never => { e.boundary = boundary; throw e; };
  if (violation) fail(new ProviderError("retouch_request_contract_failed", false, violation));

  const budget = timeoutFor(req.callTimeoutMs ?? GOOGLE_CALL_CAP_MS, req.deadlineAt);
  if (budget <= MIN_USEFUL_CALL_MS) fail(new ProviderError("provider_timeout", true));
  boundary.http_requests = 1;
  const res = await fetch(url, { method: "POST", headers, body: payload, signal: AbortSignal.timeout(budget) })
    .catch((e) => fail(new ProviderError(e?.name === "TimeoutError" ? "provider_timeout" : "provider_unreachable", true)));
  if (!res.ok) fail(await classifyGoogleError(res));
  const json = (await res.json().catch(() => ({}))) as InteractionResponse;
  // The final image by the SDK's own output_image rule; drafts (thought
  // steps) are never kept.
  const pick = pickInteractionFinalImage(json);
  const u = json.usage;
  const usage: GenerationResult["usage"] = u ? {
    inputTokens: u.total_input_tokens,
    outputTokens: u.total_output_tokens === undefined && u.total_thought_tokens === undefined
      ? undefined : (u.total_output_tokens ?? 0) + (u.total_thought_tokens ?? 0),
    thoughtTokens: u.total_thought_tokens,
  } : undefined;
  if (!pick.image) {
    // A billed answer with no final image: its reported tokens still count.
    const empty = new ProviderError("provider_empty_result", false, pick.status ?? undefined);
    empty.usage = usage;
    fail(empty);
  }
  return {
    images: [{
      base64: pick.image!.data, mime: pick.image!.mimeType,
      response: {
        imageParts: pick.outputImages + pick.thoughtImages, thoughtImagesSkipped: pick.thoughtImages, finishReason: pick.status,
        steps: pick.steps, pickedStep: pick.picked,
      },
    }],
    usage,
    providerMetadata: { network_boundary: boundary },
  };
}
