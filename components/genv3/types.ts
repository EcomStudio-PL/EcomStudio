/**
 * GENERATOR V3 — shared client types.
 *
 * Everything here is display identity + capability + pricing. Providers,
 * endpoints and hidden prompts are backend infrastructure and never take
 * this shape.
 */

export type GenMode = "managed" | "custom";

export type GenModel = {
  id: string;
  name: string;
  badge: string | null;
  badgeTone: string | null;
  description: string | null;
  /** Credits per image per output size, from the admin price table. */
  pricing: Record<string, number>;
  resolutions: string[];
  ratios: string[];
  /** Max images per run for this model (adapter ∧ admin cap). */
  maxOutputs: number;
  supportsRefs: boolean;
  /** Credits added per image when the GrovBase engine writes the prompt. */
  surcharge: number;
};

/** Credits for ONE image at the given size — managed mode adds the engine
 *  surcharge, exactly like the server's originCost. */
export function unitPrice(m: GenModel | undefined, resolution: string, mode: GenMode): number {
  if (!m) return 0;
  const base = m.pricing[resolution] ?? Object.values(m.pricing)[0] ?? 0;
  return base + (mode === "managed" ? m.surcharge : 0);
}

/** Snap a value to the model's capability list (first entry when absent). */
export function snapTo(list: string[], value: string): string {
  return list.includes(value) ? value : list[0] ?? value;
}

export type UploadedRef = { key: string; path: string; url: string };

export type BriefState = { text: string; keepFraming: boolean };

export type GallerySessionType = "advertising" | "lifestyle";

export type GalleryItem = {
  generationId: string;
  assetId: string;
  path: string;
  url: string;
  thumbUrl: string;
  width: number | null;
  height: number | null;
  ratio: string | null;
  resolution: string | null;
  model: string | null;
  product: string | null;
  sessionType: GallerySessionType | null;
  origin: "engine" | "custom" | null;
  prompt: string | null;
  favorite: boolean;
  note: string | null;
  createdAt: string;
  /** Client-side: generated in this browser session (drives "NOWE"). */
  fresh?: boolean;
};

/** Badge tone → Badge component tone. Admin can override per model; the
 *  defaults keep the vocabulary consistent app-wide. */
const BADGE_DEFAULT_TONE: Record<string, string> = {
  recommended: "green",
  high_quality: "amber",
  best_value: "blue",
  fast: "info",
  new: "indigo",
  premium: "indigo",
  experimental: "neutral",
};
const KNOWN_TONES = new Set(["neutral", "green", "amber", "red", "blue", "info", "indigo", "success"]);

export function badgeToneOf(badge: string | null, override: string | null):
  "neutral" | "green" | "amber" | "red" | "blue" | "info" | "indigo" | "success" {
  const tone = (override && KNOWN_TONES.has(override) ? override : null)
    ?? (badge ? BADGE_DEFAULT_TONE[badge] : null)
    ?? "neutral";
  return tone as ReturnType<typeof badgeToneOf>;
}
