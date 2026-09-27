/** Test double for the text/vision chain in the workflow v2 suite: each call
 *  is recorded and answered by the test's handler (or fails on demand). The
 *  meter hook is called like the real layer does, with token counts, so the
 *  runtime's token/cost roll-up is exercised for real. */
import { ProviderError, type ReferenceImage } from "../../lib/ai/types";
export type VisionAttempt = { provider: "google" | "openai"; model: string; ok: boolean; durationMs: number; error?: string; inputTokens?: number; outputTokens?: number; cachedInputTokens?: number };
export type VisionBackend = { provider: "google" | "openai"; cred: { apiKey: string }; model?: string; meter?: (a: VisionAttempt) => void };
export type VisionOutcome = { provider: "google" | "openai"; model: string; latencyMs: number };
export const VISION_MODEL = "gemini-flash-latest";
export const VISION_FALLBACKS: string[] = [];
export const OPENAI_VISION_MODELS = ["gpt-5"];
export const visionCalls: { system: string; user: string; images: ReferenceImage[]; provider: string; model: string }[] = [];
export const visionControl: { handler: (req: { system: string; user: string }) => unknown; fail: string[] } = {
  handler: () => ({ output: "OUT" }), fail: [],
};
export function isProviderFailure() { return false; }
export async function callVisionJson<T>(backends: VisionBackend[], req: { images: ReferenceImage[]; system: string; user: string }): Promise<{ data: T; outcome: VisionOutcome }> {
  const b = backends[0];
  const model = b?.model ?? (b?.provider === "google" ? VISION_MODEL : "gpt-5");
  visionCalls.push({ system: req.system, user: req.user, images: req.images, provider: b?.provider ?? "?", model });
  const code = visionControl.fail.shift();
  if (code) {
    b?.meter?.({ provider: b.provider, model, ok: false, durationMs: 1, error: code });
    throw new ProviderError(code, code !== "analysis_bad_request");
  }
  b?.meter?.({ provider: b.provider, model, ok: true, durationMs: 1, inputTokens: 1000, outputTokens: 200 });
  return { data: visionControl.handler(req) as T, outcome: { provider: b?.provider ?? "openai", model, latencyMs: 1 } };
}
