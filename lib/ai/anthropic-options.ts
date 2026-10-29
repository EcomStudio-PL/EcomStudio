/**
 * Claude request options shared by the server's vision layer and the
 * client-safe GrovShot V2 config validator (no SDK import here).
 */

/** Claude effort levels (`output_config.effort`). */
export const ANTHROPIC_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type AnthropicEffort = (typeof ANTHROPIC_EFFORTS)[number];

export function isAnthropicEffort(v: unknown): v is AnthropicEffort {
  return typeof v === "string" && (ANTHROPIC_EFFORTS as readonly string[]).includes(v);
}
