/** Test double for the text/vision chain: records each call and answers with
 *  a deterministic output; `failNext` makes the next N calls fail. */
import { ProviderError } from "../../lib/ai/types";
export type VisionBackend = { provider: "google" | "openai"; cred: { apiKey: string }; model?: string };
export const visionCalls: { system: string; user: string; images: number }[] = [];
export const visionControl = { failNext: 0, counter: 0 };
export async function callVisionJson<T>(_b: VisionBackend[], req: { images: unknown[]; system: string; user: string }): Promise<{ data: T; outcome: { provider: "openai"; model: string; latencyMs: number } }> {
  visionCalls.push({ system: req.system, user: req.user, images: req.images.length });
  if (visionControl.failNext > 0) { visionControl.failNext--; throw new ProviderError("analysis_overloaded", true); }
  visionControl.counter++;
  const data = { output: `OUT${visionControl.counter}`, category: "AGD", materials: ["stal"], colors: ["srebrny"], item_count: 1, key_features: ["włącznik"], visible_text: [] };
  return { data: data as unknown as T, outcome: { provider: "openai", model: "stub", latencyMs: 1 } };
}
