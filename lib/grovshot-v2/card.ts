/**
 * GROVBASE SHOT V2 · ETAP 1 — the PRODUCT CARD, normalised in code.
 *
 * The card is the single source of truth every later stage reads (spec:
 * „wszystkie późniejsze etapy czytają z niej, a nie ze zdjęć i opisu”). The
 * vision model writes it; this module makes it safe to rely on: closed sets
 * are enforced, photo numbers are limited to the photos Etap 0 kept, every
 * photo has exactly one state, the recipe is one the config knows, a
 * customer's dimensions win over the model's estimate, and an estimate is
 * marked as one. Nothing is invented: a field the model left empty stays
 * empty, and a card without a product name or a selling point is refused
 * (before any charge).
 */
import { PHOTO_ROLES, RECIPE_IDS, type EngineConfig, type PhotoRole, type RecipeId } from "@/lib/grovshot-v2/config";
import { DIMENSION_SOURCES, FACT_SOURCES, type DimensionSource, type FactSource } from "@/lib/grovshot-v2/stages";
import type { CardSignals, ValidationResult } from "@/lib/grovshot-v2/validation";

export type CardState = { id: string; label: string; photos: number[] };
export type CardPhoto = { photo: number; role: PhotoRole; state: string; angle: string; whole: boolean; reference: boolean };

export type ProductCard = {
  name: string;
  variant: string;
  category: string;
  dimensions: { text: string; width_cm: number | null; height_cm: number | null; depth_cm: number | null; source: DimensionSource; confidence: number; estimate: boolean };
  proportion: string;
  scale_anchors: string[];
  construction: string[];
  counts: { element: string; count: number }[];
  colors: { name: string; hex: string; pastel: boolean }[];
  materials: string[];
  texts: string[];
  is_not: string[];
  states: CardState[];
  angles_available: string[];
  angles_missing: string[];
  photos: CardPhoto[];
  color_sample: { photo: number; x: number; y: number; w: number; h: number } | null;
  selling_points: { id: string; text: string; has_action: boolean }[];
  uses: { use: string; place: string }[];
  audience: { buyer: string; user: string; age: string };
  honesty_limits: string[];
  season: { seasonal: boolean; season: string };
  risks: string[];
  reference_additions: string[];
  handheld: boolean;
  for_animals: boolean;
  assembly: boolean;
  interchangeable_parts: boolean;
  waterproof: boolean;
  recipe_id: RecipeId;
  /** The model picked a recipe the config does not know → base (recorded). */
  recipe_fallback: boolean;
  conflicts: { field: string; description_says: string; photos_show: string }[];
  facts: { field: string; source: FactSource; confidence: number }[];
};

export type CardResult =
  | { ok: true; card: ProductCard; signals: CardSignals }
  | { ok: false; error: "card_incomplete"; reasons: string[] };

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const s = (v: unknown, max = 300): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const list = (v: unknown, maxItems = 12, max = 200): string[] =>
  Array.isArray(v) ? [...new Set(v.map((x) => s(x, max)).filter(Boolean))].slice(0, maxItems) : [];
const objs = (v: unknown, maxItems = 20): Raw[] => (Array.isArray(v) ? v.filter(isObj).slice(0, maxItems) : []);
const pos = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 100000 ? Math.round(v * 10) / 10 : null);
const clamp01 = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(String(v)) ? (v as T) : fallback;

/** A stable, ASCII id from model text (states, selling points). */
export function slug(value: string, fallback: string): string {
  const out = value.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/Ł/g, "L")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return out || fallback;
}

export function normaliseCard(
  rawValue: unknown,
  ctx: {
    validation: Pick<ValidationResult, "photos">;
    customerDimensions: string | null;
    /** The customer's numbers in cm (width, depth, height), when given. */
    customerDimsCm?: { w: number | null; d: number | null; h: number | null } | null;
  },
  config: Pick<EngineConfig, "recipes" | "validation">,
): CardResult {
  const raw: Raw = isObj(rawValue) ? rawValue : {};
  const product = isObj(raw.product) ? raw.product : {};
  const name = s(product.name, 200);
  const reasons: string[] = [];
  if (!name) reasons.push("name");

  const usable = new Set(ctx.validation.photos.filter((p) => p.status !== "excluded").map((p) => p.number));
  const reference = new Set(ctx.validation.photos.filter((p) => p.status === "ok").map((p) => p.number));
  const photoNum = (v: unknown): number | null => {
    const n = typeof v === "number" ? Math.round(v) : NaN;
    return usable.has(n) ? n : null;
  };

  // States: unique ids, photos limited to the kept photos.
  const states: CardState[] = [];
  for (const st of objs(raw.states, 8)) {
    const label = s(st.label, 120) || s(st.id, 60);
    if (!label) continue;
    let id = slug(s(st.id, 60) || label, `state_${states.length + 1}`);
    while (states.some((x) => x.id === id)) id = `${id}_${states.length + 1}`;
    const photos = [...new Set((Array.isArray(st.photos) ? st.photos : []).map(photoNum).filter((n): n is number => n !== null))];
    states.push({ id, label, photos });
  }
  if (states.length === 0) {
    // One state the model did not name: every kept photo shows it.
    states.push({ id: "default", label: "", photos: [...usable].sort((a, b) => a - b) });
  }

  // Exactly one role row per kept photo; its state is a known state id.
  const rolesIn = new Map<number, Raw>();
  for (const r of objs(raw.photo_roles, 12)) {
    const n = photoNum(r.photo);
    if (n !== null && !rolesIn.has(n)) rolesIn.set(n, r);
  }
  const photos: CardPhoto[] = [...usable].sort((a, b) => a - b).map((n) => {
    const r = rolesIn.get(n) ?? {};
    const stated = s(r.state, 60);
    const byId = states.find((x) => x.id === slug(stated, "") || x.label === stated);
    const listed = states.find((x) => x.photos.includes(n));
    const state = (byId ?? listed ?? states[0]).id;
    const v = ctx.validation.photos.find((p) => p.number === n);
    return {
      photo: n,
      role: pick(r.role, PHOTO_ROLES, "product"),
      state,
      angle: s(r.angle, 80) || v?.angle || "",
      whole: r.whole === true,
      reference: reference.has(n),
    };
  });
  // Keep the state lists in step with the per-photo truth.
  for (const st of states) st.photos = photos.filter((p) => p.state === st.id).map((p) => p.photo);

  const cs = isObj(raw.color_sample) ? raw.color_sample : null;
  let color_sample: ProductCard["color_sample"] = null;
  if (cs) {
    const n = photoNum(cs.photo);
    const [x, y, w, h] = [cs.x, cs.y, cs.w, cs.h].map(clamp01);
    if (n !== null && reference.has(n) && w > 0 && h > 0 && x + w <= 1.0001 && y + h <= 1.0001) color_sample = { photo: n, x, y, w, h };
  }

  const selling: ProductCard["selling_points"] = [];
  for (const sp of objs(raw.selling_points, 12)) {
    const t = s(sp.text, 240);
    if (!t) continue;
    let id = slug(s(sp.id, 40) || t, `sp_${selling.length + 1}`);
    while (selling.some((x) => x.id === id)) id = `${id}_${selling.length + 1}`;
    selling.push({ id, text: t, has_action: sp.has_action === true });
  }
  if (selling.length === 0) reasons.push("selling_points");

  const dim = isObj(raw.dimensions) ? raw.dimensions : {};
  const customer = ctx.customerDimensions?.trim() ? ctx.customerDimensions.trim().slice(0, 200) : null;
  const source: DimensionSource = customer ? "customer" : pick(dim.source, DIMENSION_SOURCES, "estimate");
  const dimensions: ProductCard["dimensions"] = {
    text: customer ?? s(dim.text, 200),
    // The customer's numbers win over the model's reading of them.
    width_cm: customer && ctx.customerDimsCm ? pos(ctx.customerDimsCm.w) : pos(dim.width_cm),
    height_cm: customer && ctx.customerDimsCm ? pos(ctx.customerDimsCm.h) : pos(dim.height_cm),
    depth_cm: customer && ctx.customerDimsCm ? pos(ctx.customerDimsCm.d) : pos(dim.depth_cm),
    source,
    confidence: customer ? 1 : clamp01(dim.confidence),
    estimate: source === "estimate",
  };

  const lic = isObj(raw.licensed_character) ? raw.licensed_character : {};
  const signals: CardSignals = {
    dimensions: {
      in_description: dim.in_description === true,
      ambiguous: dim.ambiguous === true,
      scale_critical: dim.scale_critical === true,
      confidence: clamp01(dim.confidence),
    },
    conflicts: objs(raw.conflicts, 10).filter((c) => s(c.field, 80) && clamp01(c.confidence) >= config.validation.ask_confidence).length,
    licensed: { suspected: lic.suspected === true, confidence: clamp01(lic.confidence) },
    wholePhoto: false,
  };
  const rawRecipe = String(raw.recipe_id ?? "");
  const known = (RECIPE_IDS as readonly string[]).includes(rawRecipe) && config.recipes.some((r) => r.id === rawRecipe);
  const season = isObj(raw.season) ? raw.season : {};
  const audience = isObj(raw.audience) ? raw.audience : {};

  if (reasons.length > 0) return { ok: false, error: "card_incomplete", reasons };
  signals.wholePhoto = photos.some((p) => p.reference && p.whole);
  return {
    ok: true,
    signals,
    card: {
      name,
      variant: s(product.variant, 200),
      category: s(product.category, 120),
      dimensions,
      proportion: s(raw.proportion, 300),
      scale_anchors: list(raw.scale_anchors, 6, 200),
      construction: list(raw.construction, 16, 200),
      counts: objs(raw.counts, 10)
        .map((c) => ({ element: s(c.element, 120), count: typeof c.count === "number" && Number.isInteger(c.count) && c.count > 0 && c.count <= 500 ? c.count : 0 }))
        .filter((c) => c.element && c.count > 0),
      colors: objs(raw.colors, 8)
        .map((c) => ({ name: s(c.name, 80), hex: /^#[0-9a-fA-F]{6}$/.test(s(c.hex, 7)) ? s(c.hex, 7).toLowerCase() : "", pastel: c.pastel === true }))
        .filter((c) => c.name),
      materials: list(raw.materials, 8, 120),
      texts: list(raw.texts, 10, 120),
      is_not: list(raw.is_not, 8, 200),
      states,
      angles_available: list(raw.angles_available, 10, 80),
      angles_missing: list(raw.angles_missing, 10, 80),
      photos,
      color_sample,
      selling_points: selling,
      uses: objs(raw.uses, 12).map((u) => ({ use: s(u.use, 160), place: s(u.place, 120) })).filter((u) => u.use),
      audience: { buyer: s(audience.buyer, 160), user: s(audience.user, 160), age: s(audience.age, 60) },
      honesty_limits: list(raw.honesty_limits, 10, 200),
      season: { seasonal: season.seasonal === true, season: season.seasonal === true ? s(season.season, 60) : "" },
      risks: list(raw.risks, 12, 160),
      reference_additions: list(raw.reference_additions, 8, 160),
      handheld: raw.handheld === true,
      for_animals: raw.for_animals === true,
      assembly: raw.assembly === true,
      interchangeable_parts: raw.interchangeable_parts === true,
      waterproof: raw.waterproof === true,
      recipe_id: known ? (rawRecipe as RecipeId) : "base",
      recipe_fallback: !known,
      conflicts: objs(raw.conflicts, 10)
        .map((c) => ({ field: s(c.field, 80), description_says: s(c.description_says, 200), photos_show: s(c.photos_show, 200) }))
        .filter((c) => c.field),
      facts: objs(raw.facts, 30).map((f) => ({ field: s(f.field, 60), source: pick(f.source, FACT_SOURCES, "inference"), confidence: clamp01(f.confidence) })).filter((f) => f.field),
    },
  };
}

/** The card as the later stages' templates see it ({{product_card}}). */
export function cardForPrompt(card: ProductCard, max = CARD_PROMPT_MAX - 400): string {
  const { facts: _facts, recipe_fallback: _fallback, ...rest } = card;
  const full = JSON.stringify(rest);
  if (full.length <= max) return full;
  // Too long for its variable: shortened the same way every time — lists
  // first, then long texts — the identity fields (name, dimensions, counts,
  // colours, photos) last and least.
  for (const [arr, str] of CARD_TRIM_STEPS) {
    const out = JSON.stringify(trimValue(rest, arr, str, false));
    if (out.length <= max) return out;
  }
  return JSON.stringify(trimValue(rest, 3, 60, false)).slice(0, max);
}

/** {{product_card}}'s limit (lib/ai/prompt-variables.ts). */
export const CARD_PROMPT_MAX = 16_000;
const CARD_TRIM_STEPS: [number, number][] = [[24, 400], [16, 240], [10, 160], [6, 100], [4, 70]];
const CARD_IDENTITY = new Set(["product", "dimensions", "counts", "colors", "photos", "photo_roles", "states"]);

function trimValue(v: unknown, arr: number, str: number, identity: boolean): unknown {
  const a = identity ? Math.max(arr, 16) : arr;
  const s = identity ? Math.max(str, 160) : str;
  if (typeof v === "string") return v.length > s ? `${v.slice(0, s - 1)}…` : v;
  if (Array.isArray(v)) return v.slice(0, a).map((x) => trimValue(x, arr, str, identity));
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trimValue(x, arr, str, identity || CARD_IDENTITY.has(k))]));
  }
  return v;
}

/** {{photo_catalog}} — the photo list the planner sees, as data. The
 *  numbering is the upload order (the planner names photos by it). */
export function photoCatalog(card: ProductCard): string {
  return JSON.stringify(card.photos.map((p) => ({
    photo: p.photo, role: p.role, state: p.state, angle: p.angle, whole: p.whole, reference: p.reference,
  })));
}
