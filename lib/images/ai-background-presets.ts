/**
 * "DODAJ TŁO AI" — THE SCENE PRESETS.
 *
 * The operator's list of ready scenes ("Studio premium", "Kuchnia", …). It is
 * data, not code: the list lives in one PRIVATE `app_settings` row
 * (`ai_background_presets`, migration 0138), edited on the tool's own admin
 * page and read by the server through a token-gated function. Nothing here is
 * a built-in prompt — with the row empty there are no presets at all and the
 * panel offers only the seller's own description.
 *
 * WHAT TRAVELS WHERE. The browser only ever sees `{ key, label }`
 * (`publicPresets`); the prompt behind a key is resolved on the server at run
 * time. A preset's prompt is GrovBase's own wording and never reaches a
 * customer.
 *
 * Client-safe on purpose (no server imports): the admin editor validates with
 * the same rules the server applies.
 */

export type PresetLocale = "pl" | "en" | "de";

export type AiBackgroundPreset = {
  /** Stable id the panel sends back. Lowercase, digits, `_` and `-`. */
  key: string;
  label: Record<PresetLocale, string>;
  /** The scene sent to Photoroom as `background.prompt`. Server-only. */
  prompt: string;
  /** Let Photoroom expand the prompt (`background.expandPrompt.mode=ai.auto`). */
  expandPrompt: boolean;
  enabled: boolean;
};

export const PRESET_KEY_RE = /^[a-z0-9_-]{1,40}$/;
export const PRESET_LIMIT = 24;
export const PRESET_LABEL_MAX = 40;
export const PRESET_PROMPT_MAX = 500;
const LOCALES: readonly PresetLocale[] = ["pl", "en", "de"];

const text = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

/**
 * Anything stored, made safe: unknown fields dropped, every string capped, a
 * preset without a key, a Polish label or a prompt left out, duplicates
 * collapsed to the first. Accepts the stored `{ v, presets }` document or a
 * bare array.
 */
export function parsePresets(raw: unknown): AiBackgroundPreset[] {
  const doc = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const list = Array.isArray(raw) ? raw : Array.isArray(doc?.presets) ? (doc!.presets as unknown[]) : [];
  const out: AiBackgroundPreset[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (out.length >= PRESET_LIMIT) break;
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const key = typeof p.key === "string" ? p.key.trim() : "";
    if (!PRESET_KEY_RE.test(key) || seen.has(key)) continue;
    const labels = (p.label && typeof p.label === "object" ? p.label : {}) as Record<string, unknown>;
    const pl = text(labels.pl, PRESET_LABEL_MAX);
    const prompt = text(p.prompt, PRESET_PROMPT_MAX);
    if (!pl || !prompt) continue;
    seen.add(key);
    out.push({
      key,
      label: {
        pl,
        en: text(labels.en, PRESET_LABEL_MAX) || pl,
        de: text(labels.de, PRESET_LABEL_MAX) || pl,
      },
      prompt,
      expandPrompt: p.expandPrompt === true,
      enabled: p.enabled !== false,
    });
  }
  return out;
}

/** The stored document for a list — what the admin action writes. */
export function presetsDocument(list: AiBackgroundPreset[]): { v: 1; presets: AiBackgroundPreset[] } {
  return { v: 1, presets: parsePresets(list) };
}

/** What the customer's panel receives: enabled presets, a label, no prompt. */
export type PublicPreset = { key: string; label: string };

export function publicPresets(list: readonly AiBackgroundPreset[], locale: string): PublicPreset[] {
  const lang: PresetLocale = (LOCALES as readonly string[]).includes(locale) ? (locale as PresetLocale) : "pl";
  return list.filter((p) => p.enabled).map((p) => ({ key: p.key, label: p.label[lang] || p.label.pl }));
}
