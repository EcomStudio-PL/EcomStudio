import "server-only";
import { ProviderError, type ReferenceImage } from "@/lib/ai/types";

/**
 * Vision backend for the prompt engine. Uses the Gemini generateContent REST
 * API with schema-constrained JSON output — REAL image understanding, never
 * templates pretending to be analysis. The layer is swappable: everything
 * above talks in terms of "images + instruction + schema → JSON".
 */

/** Default analysis model + ordered fallbacks. Google retires model ids over
 *  time, so a 404 on one id transparently falls through to the next instead
 *  of breaking the whole Prompty flow. The admin can override the primary id
 *  in app_settings("image_engine").analysis_model. */
export const VISION_MODEL = "gemini-flash-latest";
export const VISION_FALLBACKS = ["gemini-3.5-flash", "gemini-3-flash-preview", "gemini-2.5-flash"];

export type VisionCredential = { apiKey: string; baseUrl?: string | null };

export type VisionInput = {
  cred: VisionCredential;
  images: ReferenceImage[];
  system: string;
  user: string;
  /** Gemini responseSchema (OpenAPI 3 subset). */
  schema: Record<string, unknown>;
  model?: string;
};

/** Runs the analysis against the configured model, transparently retrying on
 *  the fallback ids when a model id is retired (404) or momentarily missing. */
/** Transient upstream states worth retrying on the SAME model. */
const TRANSIENT = new Set(["analysis_overloaded", "analysis_unreachable", "analysis_invalid", "analysis_empty"]);
const RETRY_DELAYS_MS = [1_500, 5_000];

export async function callVisionJson<T>(input: VisionInput): Promise<T> {
  const primary = input.model ?? VISION_MODEL;
  const chain = [primary, ...VISION_FALLBACKS.filter((m) => m !== primary)];
  let lastError: unknown = new ProviderError("analysis_unavailable");
  for (const model of chain) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await callVisionModel<T>(input, model);
      } catch (e) {
        lastError = e;
        const safe = e instanceof ProviderError ? e.safeMessage : "";
        // Model overload / a malformed answer: same model, short backoff.
        if (TRANSIENT.has(safe) && attempt < RETRY_DELAYS_MS.length) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
          continue;
        }
        // A retired/unknown model id: fall through to the next id in the chain.
        // Quota and auth problems apply to every model of the same key, so they stop here.
        if (safe === "analysis_model_missing") break;
        throw e;
      }
    }
  }
  throw lastError;
}

async function callVisionModel<T>(input: VisionInput, model: string): Promise<T> {
  const base = input.cred.baseUrl?.replace(/\/$/, "") || "https://generativelanguage.googleapis.com";
  const url = `${base}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(input.cred.apiKey)}`;

  const parts: Record<string, unknown>[] = [
    ...input.images.map((r) => ({ inlineData: { mimeType: r.mime, data: r.base64 } })),
    { text: input.user },
  ];

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: input.system }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: input.schema,
        temperature: 0.4,
        maxOutputTokens: 16384,
      },
    }),
    signal: AbortSignal.timeout(120_000),
  }).catch((e) => {
    throw new ProviderError(e?.name === "TimeoutError" ? "analysis_timeout" : "analysis_unreachable", true);
  });

  if (res.status === 401 || res.status === 403) throw new ProviderError("analysis_unavailable");
  if (res.status === 404) throw new ProviderError("analysis_model_missing", true);
  if (res.status === 429) throw new ProviderError("analysis_rate_limited", true);
  if (res.status === 503) throw new ProviderError("analysis_overloaded", true);
  if (!res.ok) throw new ProviderError("analysis_error", res.status >= 500);

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new ProviderError("analysis_empty");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError("analysis_invalid", true);
  }
}
