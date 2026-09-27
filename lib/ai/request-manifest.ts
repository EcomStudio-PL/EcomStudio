import type { AiModelRecord, GenerationRequest } from "./types";
import { buildGeminiImageRequest } from "./providers/google-request";

/**
 * WHAT A PROVIDER WAS REALLY ASKED — derived from the same builder the
 * adapter sends, never from what the UI or the admin panel claims. Stored on
 * the job (generation_jobs.settings.provider_request) and shown in the admin
 * dry-run, so a question like "which model, which ratio, which size, was the
 * photo attached, did anything get added to the prompt" is answered by the
 * record rather than by guessing. Never contains the prompt or the image
 * bytes — their length and SHA-256 only.
 */

export type PromptPolicy = "exact" | "product_lock";

export type ProviderRequestShape = {
  operation: "IMAGE_EDIT" | "IMAGE_GENERATION";
  /** The ratio sent, or null when none was (the input photo's shape wins). */
  aspectRatio: string | null;
  /** The size sent, or null when none was (the model's default). */
  imageSize: string | null;
};

export function describeProviderRequest(
  providerSlug: string,
  model: Pick<AiModelRecord, "supported_resolutions">,
  req: Pick<GenerationRequest, "prompt" | "aspectRatio" | "resolution" | "referenceImages">,
): ProviderRequestShape {
  if (providerSlug === "google") {
    const plan = buildGeminiImageRequest(model, req);
    return { operation: plan.operation, aspectRatio: plan.aspectRatio, imageSize: plan.imageSize };
  }
  return {
    operation: req.referenceImages.length > 0 ? "IMAGE_EDIT" : "IMAGE_GENERATION",
    aspectRatio: req.aspectRatio === "auto" ? null : req.aspectRatio,
    imageSize: req.resolution ?? null,
  };
}

/** Code points, the unit the prompt editor counts in. */
export function promptLength(text: string): number {
  return Array.from(text).length;
}

/* ── the admin dry-run manifest (built in lib/server/engine/request-manifest.ts) ──*/

export type ManifestSource = "published" | "built_in" | "unavailable" | "none";

export type RequestManifest = {
  model: { provider: string; name: string; identifier: string } | null;
  /** The fallback model's name, or null when fallback is off. */
  fallback: string | null;
  prompt: {
    source: ManifestSource;
    version: number | null;
    mode: string;
    policy: PromptPolicy | null;
    /** Of the text the provider receives (compiled with sample values when
     *  the prompt has variables). */
    chars: number | null;
    sha256: string | null;
    /** No variables: the text sent is the published text byte for byte. */
    identical: boolean | null;
    variables: string[];
    /** Knowledge variables the admin placed; [] = no knowledge is injected. */
    knowledge: string[];
    /** Blocks the runner adds around the prompt ([] = none). */
    appended: ("product_lock" | "customer_hint")[];
  };
  config: {
    operation: "IMAGE_EDIT" | "IMAGE_GENERATION";
    /** "input_photo": nothing sent, the output keeps the photo's shape;
     *  "nearest_supported": the photo's shape snapped to a listed ratio. */
    ratioWhenOriginal: "input_photo" | "nearest_supported";
    ratios: string[];
    /** Each size the customer can pick → what imageSize carries (null = not sent). */
    sizes: { resolution: string; sent: string | null }[];
    timeoutMs: number | null;
    maxAttempts: number;
    budgetMs: number;
  };
  lastRun: LastRun | null;
};

export type LastRun = {
  at: string;
  status: string;
  provider: string | null;
  identifier: string | null;
  fallbackUsed: boolean | null;
  operation: string | null;
  policy: string | null;
  appended: boolean | null;
  chars: number | null;
  sha256: string | null;
  /** The recorded prompt hash equals today's published text (no-variable prompts). */
  matchesPublished: boolean | null;
  ratioRequested: string | null;
  ratioSent: string | null;
  sizeSent: string | null;
  timeoutMs: number | null;
  maxAttempts: number | null;
  /** Attempts that failed before the result (retries actually made). */
  failedAttempts: number;
  inputs: { mime: string; bytes: number; width: number | null; height: number | null; sourceSha256: string; sentSha256: string; transform: string }[];
};
