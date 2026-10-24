/**
 * INTELIGENTNY PROMPT — the contract both sides of the wire share.
 *
 * The customer's own idea goes to a cheap text model once per click and comes
 * back as a precise photographic prompt, which lands in the SAME textarea the
 * customer typed into. From there it is just their text: they can read it,
 * change it, and Generate sends exactly what is visible (the generator's
 * "Własny prompt" passthrough is untouched — nothing is appended later).
 *
 * This file is imported by the browser, so it holds limits, codes and pure
 * helpers only. The instruction the model gets is server-side
 * (lib/server/smart-prompt.ts) and never leaves the server.
 */

export const SMART_PROMPT_SERVICE = "smart_prompt";
/** The private app_settings row (migration 0149). Written only by
 *  saveSmartPromptSettingsAction — never by the raw settings editor. */
export const SMART_PROMPT_SETTING_KEY = "smart_prompt";
/** Same cap as the editor (components/genv3/workspace.tsx PROMPT_MAX). */
export const SMART_PROMPT_MAX = 4000;
/** Shorter than this is not an idea a model can work from. */
export const SMART_PROMPT_MIN = 3;
/** Operator instruction cap (Admin → AI → Generator). */
export const SMART_PROMPT_INSTRUCTION_MAX = 8000;
/** Reference paths read for the cached analysis lookup (never downloaded). */
export const SMART_PROMPT_MAX_REFS = 10;
/** A version number the customer can reach by clicking; beyond it the
 *  request is malformed rather than curious. */
export const SMART_PROMPT_MAX_VARIATION = 999;

export const SMART_PROMPT_PROVIDERS = ["auto", "google", "openai"] as const;
export type SmartPromptProvider = (typeof SMART_PROMPT_PROVIDERS)[number];

/** What the customer's screen is told — a price and whether to offer it. */
export type SmartPromptOffer = { available: boolean; credits: number };

/** The private settings row (app_settings.smart_prompt), parsed. */
export type SmartPromptConfig = {
  provider: SmartPromptProvider;
  /** Preferred model id for that provider; null = the chain's own model. */
  model: string | null;
  /** Operator instruction; null = the built-in server instruction. */
  instruction: string | null;
};

/** Error codes the route answers with (translated as genv3.smart.err.*). */
export const SMART_PROMPT_ERRORS = [
  "unauthenticated", "invalid_input", "too_short", "too_long", "unavailable",
  "insufficient_credits", "duplicate_request", "provider_failed", "empty_result",
  "result_too_long", "maintenance", "no_workspace", "feature_unavailable", "account_blocked",
] as const;
export type SmartPromptError = (typeof SMART_PROMPT_ERRORS)[number];

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/;

/**
 * The settings row, or null when it cannot be trusted — and null makes the
 * feature unavailable (never a guessed default). A blank model or instruction
 * is a deliberate "use the default", not an error.
 */
export function parseSmartPromptConfig(raw: unknown): SmartPromptConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  if (v.v !== 1) return null;
  const provider = typeof v.provider === "string" && (SMART_PROMPT_PROVIDERS as readonly string[]).includes(v.provider)
    ? (v.provider as SmartPromptProvider) : null;
  if (!provider) return null;
  const modelRaw = typeof v.model === "string" ? v.model.trim() : v.model == null ? "" : null;
  if (modelRaw === null || (modelRaw && !MODEL_ID.test(modelRaw))) return null;
  const instrRaw = typeof v.instruction === "string" ? v.instruction : v.instruction == null ? "" : null;
  if (instrRaw === null || instrRaw.length > SMART_PROMPT_INSTRUCTION_MAX) return null;
  // A model id without a provider has nothing to apply to.
  if (modelRaw && provider === "auto") return null;
  return {
    provider,
    model: modelRaw || null,
    instruction: instrRaw.trim() ? instrRaw : null,
  };
}

/** The document the admin form writes (the inverse of the parser). */
export function smartPromptDocument(c: SmartPromptConfig): { v: 1; provider: SmartPromptProvider; model: string; instruction: string } {
  return { v: 1, provider: c.provider, model: c.model ?? "", instruction: c.instruction ?? "" };
}

/**
 * What the model returned, made safe to put in the textarea — or null.
 *
 * Only packaging is removed (a code fence, wrapping quotes, a "Prompt:" label
 * the model was told not to write). The words are never edited, and a text
 * over the cap is REFUSED rather than cut: a prompt clipped mid-sentence would
 * be a different prompt from the one the customer paid for.
 */
export function cleanEnhancedPrompt(raw: unknown, max = SMART_PROMPT_MAX): { ok: true; text: string } | { ok: false; error: "empty_result" | "result_too_long" } {
  if (typeof raw !== "string") return { ok: false, error: "empty_result" };
  let text = raw.replace(/\r\n?/g, "\n").trim();
  const fence = /^```[a-z]*\n([\s\S]*?)\n```$/i.exec(text);
  if (fence) text = fence[1].trim();
  text = text.replace(/^\*{0,2}(?:ulepszony\s+prompt|prompt|improved\s+prompt|enhanced\s+prompt|verbesserter\s+prompt)\*{0,2}\s*:\s*/i, "");
  const pairs: [string, string][] = [['"', '"'], ["„", "”"], ["“", "”"], ["«", "»"], ["'", "'"]];
  for (const [a, b] of pairs) {
    if (text.length > 1 && text.startsWith(a) && text.endsWith(b) && !text.slice(1, -1).includes(b)) {
      text = text.slice(1, -1).trim();
      break;
    }
  }
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return { ok: false, error: "empty_result" };
  if (text.length > max) return { ok: false, error: "result_too_long" };
  return { ok: true, text };
}

/** A request id the browser mints per deliberate click. */
export function isRequestId(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
