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
  /** Render qualities this model lets the customer pick ("Jakość"). Empty
   *  for every model without the knob — then no field is shown at all. */
  qualities: string[];
  /** quality → size → credits; absent quality falls back to `pricing`. */
  qualityPricing: Record<string, Record<string, number>>;
};

/** Credits for ONE image at the given size (and quality, where the model has
 *  one) — managed mode adds the engine surcharge, exactly like the server's
 *  originCost. */
export function unitPrice(m: GenModel | undefined, resolution: string, mode: GenMode, quality?: string): number {
  if (!m) return 0;
  const byQuality = quality ? m.qualityPricing?.[quality]?.[resolution] : undefined;
  const base = byQuality ?? m.pricing[resolution] ?? Object.values(m.pricing)[0] ?? 0;
  return base + (mode === "managed" ? m.surcharge : 0);
}

/** Snap a value to the model's capability list (first entry when absent). */
export function snapTo(list: string[], value: string): string {
  return list.includes(value) ? value : list[0] ?? value;
}

/** The quality a model would actually render at for a requested one:
 *  the request if the model offers it, else "medium", else its first
 *  declared quality — and undefined for a model with no quality knob. Used
 *  for every price shown, so a tile never quotes a quality it cannot do. */
export function snapQuality(m: Pick<GenModel, "qualities"> | undefined, value: string): string | undefined {
  const list = m?.qualities ?? [];
  if (list.length === 0) return undefined;
  if (list.includes(value)) return value;
  return list.includes("medium") ? "medium" : list[0];
}

export type UploadedRef = { key: string; path: string; url: string };

/** One row of "Opisy ujęć". Everything starts EMPTY: the reference is only
 *  ever set by the customer picking a photo — uploading photos never assigns
 *  them to shots. `refIndex` is 1-based into the uploaded reference pool. */
export type BriefState = { text: string; keepFraming: boolean; refIndex: number | null };

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
  /** Render quality the job was made at (from its settings), when the
   *  model has the knob — a retake keeps it, so the quote must know it. */
  quality: string | null;
  /** Images the job asked for and the credits it charged — the details
   *  view's "how this was made" figures. Shared by every asset of a job. */
  quantity: number | null;
  credits: number | null;
  /** Reference / inspiration photo counts; thumbnails are signed lazily. */
  referenceCount: number;
  inspirationCount: number;
  model: string | null;
  modelId: string | null;
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
