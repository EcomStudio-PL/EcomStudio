/** Test double of the two GrovShot planner helpers the V2 driver borrows. */
import type { PromptKeyring, Sealed } from "./gsv2-prompt-vault";

export async function textCapableBackends() {
  return [{ provider: "google" as const, cred: { apiKey: "test-key" }, model: "gemini-2.5-flash" }];
}
export function encryptConceptPayload(ring: PromptKeyring, prompt: string, negative: string, meta?: Record<string, unknown>): Sealed {
  return ring.seal(JSON.stringify({ p: prompt, n: negative, ...(meta ?? {}) }));
}
