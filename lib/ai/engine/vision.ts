import "server-only";
import { ProviderError, type ReferenceImage } from "@/lib/ai/types";

/**
 * Vision layer for the prompt engine — REAL image understanding, never
 * templates pretending to be analysis. Everything above talks in terms of
 * "images + instruction + schema → JSON", so the backend behind it is
 * interchangeable.
 *
 * Production reliability rule: one provider having a bad day must never stop a
 * customer from getting their prompts. Each backend is tried in turn, and a
 * quota, rate-limit, auth or outage failure moves on to the next configured
 * provider automatically. Only a genuinely bad request stops the chain.
 */

/** Google analysis model + ordered id fallbacks (Google retires ids). */
export const VISION_MODEL = "gemini-flash-latest";
export const VISION_FALLBACKS = ["gemini-3.5-flash", "gemini-3-flash-preview", "gemini-2.5-flash"];

/** OpenAI vision models, tried in order; an unknown id falls to the next. */
export const OPENAI_VISION_MODELS = ["gpt-5", "gpt-4.1", "gpt-4o"];

export type VisionCredential = { apiKey: string; baseUrl?: string | null };
export type VisionProvider = "google" | "openai";

/** One configured backend the chain may use. */
export type VisionBackend = {
  provider: VisionProvider;
  cred: VisionCredential;
  /** Preferred model id; the backend still falls through its own id list. */
  model?: string;
};

export type VisionRequest = {
  images: ReferenceImage[];
  system: string;
  user: string;
  /** Gemini-flavoured schema (OpenAPI 3 subset), converted per backend. */
  schema: Record<string, unknown>;
};

/** What actually happened, for internal logging — never shown to customers. */
export type VisionOutcome = {
  provider: VisionProvider;
  model: string;
  latencyMs: number;
  /** Set when an earlier backend was skipped, with why. */
  fallbackFrom?: VisionProvider;
  fallbackReason?: string;
};

/** Transient states worth one more attempt on the SAME model. */
const TRANSIENT = new Set(["analysis_overloaded", "analysis_unreachable", "analysis_invalid", "analysis_empty"]);
/** Provider-level problems: this provider cannot serve us right now, so the
 *  chain should move to the next one instead of failing the request. */
const PROVIDER_DOWN = new Set([
  "analysis_rate_limited", "analysis_unavailable", "analysis_overloaded",
  "analysis_unreachable", "analysis_timeout", "analysis_quota",
]);
const RETRY_DELAYS_MS = [1_500, 5_000];

export function isProviderFailure(safeMessage: string): boolean {
  return PROVIDER_DOWN.has(safeMessage);
}

/**
 * Run the request against the first backend that can serve it. Quota,
 * rate-limit, auth and outage failures move to the next backend; a malformed
 * request (which every provider would reject) stops immediately.
 */
export async function callVisionJson<T>(
  backends: VisionBackend[], req: VisionRequest
): Promise<{ data: T; outcome: VisionOutcome }> {
  if (backends.length === 0) throw new ProviderError("analysis_unavailable");
  let lastError: unknown = new ProviderError("analysis_unavailable");
  let skippedFrom: VisionProvider | undefined;
  let skippedReason: string | undefined;

  for (const backend of backends) {
    const started = Date.now();
    try {
      const { data, model } = await runBackend<T>(backend, req);
      return {
        data,
        outcome: {
          provider: backend.provider, model, latencyMs: Date.now() - started,
          fallbackFrom: skippedFrom, fallbackReason: skippedReason,
        },
      };
    } catch (e) {
      lastError = e;
      const safe = e instanceof ProviderError ? e.safeMessage : "analysis_error";
      if (!isProviderFailure(safe)) throw e;
      // Remember why we left this provider so the next success can log it.
      skippedFrom = backend.provider;
      skippedReason = safe;
    }
  }
  throw lastError;
}

/** Try a backend across its own model ids, retrying transient hiccups. */
async function runBackend<T>(backend: VisionBackend, req: VisionRequest): Promise<{ data: T; model: string }> {
  const ids = backend.provider === "google"
    ? dedupe([backend.model ?? VISION_MODEL, ...VISION_FALLBACKS])
    : dedupe([backend.model, ...OPENAI_VISION_MODELS].filter(Boolean) as string[]);

  let lastError: unknown = new ProviderError("analysis_unavailable");
  for (const model of ids) {
    for (let attempt = 0; ; attempt++) {
      try {
        const data = backend.provider === "google"
          ? await callGemini<T>(backend.cred, req, model)
          : await callOpenAI<T>(backend.cred, req, model);
        return { data, model };
      } catch (e) {
        lastError = e;
        const safe = e instanceof ProviderError ? e.safeMessage : "";
        if (TRANSIENT.has(safe) && attempt < RETRY_DELAYS_MS.length) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
          continue;
        }
        // A retired/unknown model id: next id. Anything else leaves this backend.
        if (safe === "analysis_model_missing") break;
        throw e;
      }
    }
  }
  throw lastError;
}

function dedupe(list: string[]): string[] {
  return [...new Set(list.filter(Boolean))];
}

/** Map an HTTP status to the engine's failure vocabulary. */
function classify(status: number): ProviderError | null {
  if (status === 401 || status === 403) return new ProviderError("analysis_unavailable", true);
  if (status === 404) return new ProviderError("analysis_model_missing", true);
  if (status === 429) return new ProviderError("analysis_rate_limited", true);
  if (status === 503) return new ProviderError("analysis_overloaded", true);
  if (status >= 500) return new ProviderError("analysis_error", true);
  if (status >= 400) return new ProviderError("analysis_error", false);
  return null;
}

async function callGemini<T>(cred: VisionCredential, req: VisionRequest, model: string): Promise<T> {
  const base = cred.baseUrl?.replace(/\/$/, "") || "https://generativelanguage.googleapis.com";
  const url = `${base}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cred.apiKey)}`;
  const parts: Record<string, unknown>[] = [
    ...req.images.map((r) => ({ inlineData: { mimeType: r.mime, data: r.base64 } })),
    { text: req.user },
  ];

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: req.schema,
        temperature: 0.4,
        maxOutputTokens: 16384,
      },
    }),
    signal: AbortSignal.timeout(120_000),
  }).catch((e) => {
    throw new ProviderError(e?.name === "TimeoutError" ? "analysis_timeout" : "analysis_unreachable", true);
  });

  const failure = classify(res.status);
  if (failure) throw failure;

  const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return parseJson<T>(text);
}

/**
 * OpenAI vision fallback: chat completions with inline data-URL images and a
 * JSON-object response. The schema travels in the system message because it is
 * expressed in Gemini's dialect; every consumer of this layer already
 * validates and normalises what comes back.
 */
async function callOpenAI<T>(cred: VisionCredential, req: VisionRequest, model: string): Promise<T> {
  const base = cred.baseUrl?.replace(/\/$/, "") || "https://api.openai.com";
  const content: Record<string, unknown>[] = [
    ...req.images.map((r) => ({
      type: "image_url",
      image_url: { url: `data:${r.mime};base64,${r.base64}`, detail: "high" },
    })),
    { type: "text", text: req.user },
  ];
  const system = `${req.system}

Reply with a single JSON object and nothing else. It must match this schema exactly (types are given in the OpenAPI style: OBJECT/ARRAY/STRING/INTEGER/BOOLEAN, and every "required" field must be present):
${JSON.stringify(req.schema)}`;

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cred.apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 16384,
    }),
    signal: AbortSignal.timeout(120_000),
  }).catch((e) => {
    throw new ProviderError(e?.name === "TimeoutError" ? "analysis_timeout" : "analysis_unreachable", true);
  });

  const failure = classify(res.status);
  if (failure) throw failure;

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return parseJson<T>(json.choices?.[0]?.message?.content ?? "");
}

function parseJson<T>(text: string): T {
  if (!text.trim()) throw new ProviderError("analysis_empty", true);
  try {
    return JSON.parse(text) as T;
  } catch {
    // Some models wrap JSON in prose or a code fence; recover the object.
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]) as T; } catch { /* fall through */ }
    }
    throw new ProviderError("analysis_invalid", true);
  }
}
