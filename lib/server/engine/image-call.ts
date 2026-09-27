import "server-only";
import type { Client } from "@/lib/services/workspace";
import { resolveModelCandidate } from "@/lib/server/generation";
import {
  ProviderError, effectiveQuality, modelQualities,
  type AspectRatio, type GeneratedImage, type Quality, type ReferenceImage, type Resolution,
} from "@/lib/ai/types";
import { unitCost, type Cost, type UnitPrice } from "@/lib/ai/usage-cost";
import { isRetriable } from "@/lib/ai/workflow-values";
import {
  PROVIDER_CALL_BUDGET_MS, fitsInBudget, getProviderHealth, providerBlocked,
  recordProviderFailure, recordProviderSuccess, retryDelayMs, sleep, withProviderLimit,
} from "@/lib/server/provider-router";

/**
 * ONE IMAGE FROM ONE IMAGE-MODEL STEP — with the same routing rules as every
 * generation: the step's model first, its fallback next; transient failures
 * (429, 5xx, timeout, network) retried with backoff and the provider's own
 * Retry-After; quota/auth failures mark the provider's health and move on;
 * a bad request (content policy, invalid prompt or image) is NOT retried.
 *
 * It never touches the ledger: the workflow charged the customer once, at the
 * start. It returns the image, the executor that REALLY answered (after any
 * fallback) and one trace entry per request actually sent.
 *
 * The step's prompt is an admin's text: it reaches the model exactly as
 * compiled, with nothing appended — the Product Lock only where the admin
 * wrote {{fidelity_rules}} in the step. References are the images the step
 * was given (the seller's untouched photos or an earlier step's image), sent
 * through the same adapter and request builder as every other image call.
 */

export type ImageCallInput = {
  candidateModelIds: string[];
  prompt: string;
  references: ReferenceImage[];
  aspectRatio: AspectRatio;
  resolution?: Resolution | null;
  quality?: Quality | null;
  maxAttempts: number;
  /** Epoch ms the call must be back by (the invocation budget, not a quality cap). */
  deadlineAt: number;
  unitPrices: readonly UnitPrice[];
};

export type ImageAttempt = {
  providerSlug: string; model: string; ok: boolean; ms: number; errorCode?: string;
  cost: Cost; inputTokens?: number | null; outputTokens?: number | null;
};

export type ImageCallResult =
  | { ok: true; image: GeneratedImage; providerSlug: string; model: string; modelId: string; attempts: ImageAttempt[]; cost: Cost }
  /** `retryLater`: there was no time left to finish — the step is resumed by
   *  the next invocation instead of being failed. */
  | { ok: false; error: string; retryLater: boolean; attempts: ImageAttempt[] };

export async function callImageModel(supabase: Client, input: ImageCallInput): Promise<ImageCallResult> {
  const attempts: ImageAttempt[] = [];
  const health = await getProviderHealth(supabase);
  const ids = input.candidateModelIds.filter((id, i, arr) => id && arr.indexOf(id) === i);
  let lastError = "model_unavailable";
  let outOfTime = false;

  for (let c = 0; c < ids.length; c++) {
    const resolved = await resolveModelCandidate(supabase, ids[c]);
    if (!resolved) { lastError = "model_unavailable"; continue; }
    const { model, providerSlug, adapter, apiKey, baseUrl } = resolved;
    const isLast = c === ids.length - 1;
    if (providerBlocked(health, providerSlug) && !isLast) continue;

    // Only what this model really supports: resolution, framing, quality.
    const resolutions = (model.supported_resolutions ?? ["1K"]) as Resolution[];
    const resolution = input.resolution && resolutions.includes(input.resolution) ? input.resolution : resolutions[0];
    const ratios = (model.supported_aspect_ratios?.length ? model.supported_aspect_ratios : adapter.capabilities.ratios ?? ["1:1"]) as AspectRatio[];
    // "auto" with an image attached, on an engine that keeps the input's
    // shape: no ratio is imposed on the edit (as on the single-call path).
    const inputShaped = input.aspectRatio === "auto" && adapter.capabilities.inputShapedOutput === true && input.references.length > 0;
    const aspectRatio = inputShaped || ratios.includes(input.aspectRatio) ? input.aspectRatio : (ratios[0] ?? "1:1");
    const quality = effectiveQuality(model, input.quality ?? undefined);
    const supportsRefs = adapter.capabilities.supportsReferenceImages && model.supports_reference_images;
    // A model that cannot carry the references would lose the Product Lock.
    if (input.references.length > 0 && !supportsRefs) { lastError = "references_unsupported"; continue; }
    const refs = supportsRefs ? input.references.slice(0, model.max_reference_images || 6) : [];
    const callMs = adapter.worstCaseMs?.(1) ?? PROVIDER_CALL_BUDGET_MS;
    const priceOf = (images: number) => unitCost(input.unitPrices, providerSlug, model.model_identifier, "image", images, {
      resolution: resolution ?? null, quality: quality ?? null,
      perImageFallbackUsdMicros: (model as { internal_cost_usd_micros?: number | null }).internal_cost_usd_micros ?? null,
    });

    for (let attempt = 1; attempt <= Math.max(1, input.maxAttempts); attempt++) {
      // A provider call is only STARTED when at least one image's worth of
      // time is left; otherwise the step is resumed by the next invocation
      // (with a fresh budget) rather than cut short.
      if (!fitsInBudget(Date.now(), input.deadlineAt, Math.min(callMs, 60_000))) {
        outOfTime = true;
        break;
      }
      const started = Date.now();
      try {
        const result = await withProviderLimit(providerSlug, () => adapter.generate(model, {
          prompt: input.prompt, aspectRatio, resolution, quantity: 1,
          quality: quality && modelQualities(model).includes(quality) ? quality : undefined,
          referenceImages: refs, productLock: { fidelityInstructions: "" },
          deadlineAt: input.deadlineAt,
        }, { apiKey, baseUrl }));
        const image = result.images[0];
        const cost = priceOf(result.images.length);
        attempts.push({
          providerSlug, model: model.model_identifier, ok: Boolean(image), ms: Date.now() - started, cost,
          errorCode: image ? undefined : "provider_empty_result",
          inputTokens: result.usage?.inputTokens ?? null, outputTokens: result.usage?.outputTokens ?? null,
        });
        if (!image) { lastError = "provider_empty_result"; break; }
        if (health.get(providerSlug) && health.get(providerSlug)!.state !== "healthy") await recordProviderSuccess(supabase, providerSlug);
        return { ok: true, image, providerSlug, model: model.model_identifier, modelId: model.id, attempts, cost };
      } catch (e) {
        const pe = e instanceof ProviderError ? e : new ProviderError("provider_error", true);
        lastError = pe.safeMessage;
        const partial = pe.partial?.[0];
        attempts.push({
          providerSlug, model: model.model_identifier, ok: Boolean(partial), ms: Date.now() - started,
          errorCode: pe.safeMessage, cost: priceOf(pe.partial?.length ?? 0),
        });
        await recordProviderFailure(supabase, providerSlug, pe);
        // An image the provider already produced (and billed) is kept.
        if (partial) return { ok: true, image: partial, providerSlug, model: model.model_identifier, modelId: model.id, attempts, cost: priceOf(1) };
        // Not retried: invalid prompt/image, content policy, auth, quota —
        // another attempt on the same provider cannot succeed.
        if (!isRetriable(pe.safeMessage, pe.retriable)) break;
        if (attempt < input.maxAttempts) {
          const delay = retryDelayMs(attempt, pe.upstream?.retryAfterMs);
          if (!fitsInBudget(Date.now() + delay, input.deadlineAt, Math.min(callMs, 60_000))) { outOfTime = true; break; }
          await sleep(delay);
        }
      }
    }
    if (outOfTime) break;
  }
  return { ok: false, error: outOfTime ? "provider_timeout" : lastError, retryLater: outOfTime, attempts };
}
