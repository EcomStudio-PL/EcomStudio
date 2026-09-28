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
  req: Pick<GenerationRequest, "prompt" | "aspectRatio" | "resolution" | "referenceImages" | "promptFirst">,
): ProviderRequestShape {
  if (providerSlug === "google") {
    const plan = buildGeminiImageRequest(model, req);
    return { operation: plan.operation, aspectRatio: plan.aspectRatio, imageSize: plan.imageSize };
  }
  // Other providers receive "auto" as a value of their own (OpenAI's size
  // "auto": the provider picks), so it is recorded as sent.
  return {
    operation: req.referenceImages.length > 0 ? "IMAGE_EDIT" : "IMAGE_GENERATION",
    aspectRatio: req.aspectRatio,
    imageSize: req.resolution ?? null,
  };
}

/**
 * The per-request limit a tool's "Limit czasu" really gives. Never below
 * 30 s: an image model cannot answer sooner, and a shorter limit would only
 * make every call time out (the panel accepts 5 s). Undefined = the adapter's
 * own ceiling. The route budget still bounds it from above.
 */
export const MIN_CALL_TIMEOUT_MS = 30_000;
export function effectiveCallTimeout(ms: number | null | undefined): number | undefined {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return undefined;
  return Math.max(MIN_CALL_TIMEOUT_MS, Math.trunc(ms));
}

/** Code points, the unit the prompt editor counts in. */
export function promptLength(text: string): number {
  return Array.from(text).length;
}

/** Below this the source is flagged LOW SOURCE RESOLUTION in the admin
 *  diagnostics — a note for reading results, never a block or a change. */
export const LOW_SOURCE_MEGAPIXELS = 1;

/* ── the admin dry-run manifest (built in lib/server/engine/request-manifest.ts) ──*/

export type ManifestSource = "published" | "unavailable" | "none";

export type RequestManifest = {
  /** Workflow ON: runs follow the published workflow's own steps, not the
   *  single call described here. */
  workflowEnabled: boolean;
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
    /** STRICT: no variables — the published text goes out 1:1. TEMPLATE:
     *  only the variables below are substituted. */
    strict: boolean;
    /** Variables the sample compile actually filled. */
    resolved: string[];
  };
  config: {
    operation: "IMAGE_EDIT" | "IMAGE_GENERATION";
    /** "input_photo": nothing sent, the output keeps the photo's shape (Gemini);
     *  "provider_choice": "auto" sent, the provider picks (non-Gemini models);
     *  "nearest_supported": the photo's shape snapped to a listed ratio. */
    ratioWhenOriginal: "input_photo" | "provider_choice" | "nearest_supported";
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
  /** The recorded (keyed) digest equals today's published text (no-variable prompts). */
  matchesPublished: boolean | null;
  ratioRequested: string | null;
  ratioSent: string | null;
  sizeSent: string | null;
  timeoutMs: number | null;
  maxAttempts: number | null;
  /** Attempts that failed before the result (retries actually made). */
  failedAttempts: number;
  inputs: {
    mime: string; bytes: number; width: number | null; height: number | null; sourceSha256: string; sentSha256: string; transform: string;
    /** Informational only — a small source is never blocked or changed. */
    megapixels: number | null; lowResolution: boolean;
  }[];
  /** How the sent ratio was decided (USER_SELECTED / ORIGINAL_OMITTED / PROVIDER_AUTO) and from what. */
  aspectMode: string | null;
  sourceAspect: number | null;
  resolvedAspect: string | null;
  /** What the provider returned vs what was stored (generation_jobs.settings.provider_output). */
  outputs: {
    requestedSize: string | null; providerWidth: number | null; providerHeight: number | null;
    providerMime: string | null; providerBytes: number | null;
    storedWidth: number | null; storedHeight: number | null; storedBytes: number | null; transformed: boolean | null;
    providerSha256: string | null; storedSha256: string | null; storedEqual: boolean | null;
    /** Image parts the response carried / interim (thought) drafts skipped / finish reason. */
    imageParts: number | null; thoughtSkipped: number | null; finishReason: string | null;
  }[];
  /** The keyed digest of the final prompt as sent (settings.provider_request). */
  digest: string | null;
};
