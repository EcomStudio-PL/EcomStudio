/**
 * GROVBASE SHOT V2 · ETAP 3 — the values of one shot prompt.
 *
 * No model is involved: the published `grovshot_v2_shot` template (the ten
 * blocks KIERUNEK … NEGATIVE PROMPT, written by the admin) is compiled with
 * the values below. Every value is ATOMIC data from the card, the plan, the
 * chosen recipe and the published config: a number, a model-written phrase,
 * an admin-written label, or a list of those joined by a fixed separator.
 * Code writes no word of the prompt — every sentence around the values is
 * the template's, every label is the config's. Nothing is appended after the
 * compile, and the adapter sends the compiled text as it is. The photos are
 * named in the exact order they are sent („zdjęcie 1” = the first image of
 * the request).
 */
import type { EngineConfig, StyleRecipe } from "@/lib/grovshot-v2/config";
import type { ProductCard } from "@/lib/grovshot-v2/card";
import type { Shot } from "@/lib/grovshot-v2/plan";
import type { CompileValues } from "@/lib/ai/prompt-variables";

/** The only list formatter: input strings and a fixed separator. */
export const list = (items: readonly (string | number | null | undefined)[], sep = ", "): string =>
  items.map((x) => (x === null || x === undefined ? "" : String(x).trim())).filter(Boolean).join(sep);

const dedupe = (items: readonly string[]) => {
  const seen = new Set<string>();
  return items.filter((x) => {
    const k = x.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

const stateLabel = (card: ProductCard, id: string) => card.states.find((x) => x.id === id)?.label || "";

/** {{reference_map}} — what each sent photo is, in send order:
 *  `1: rola · stan · kąt · zakres; 2: …` (labels from the config). */
export function referenceMap(card: ProductCard, refs: readonly number[], labels: EngineConfig["labels"]): string {
  return list(refs.map((n, i) => {
    const p = card.photos.find((x) => x.photo === n);
    if (!p) return `${i + 1}`;
    return `${i + 1}: ${list([labels.photo_roles[p.role], stateLabel(card, p.state), p.angle, p.whole ? labels.whole : labels.part], " · ")}`;
  }), "; ");
}

const fmt = (x: number) => String(x).replace(".", ",");
const inch = (cm: number) => (cm / 2.54).toFixed(1).replace(".", ",");

/** Width × depth × height in cm and in inches (spec: „wymiary w cm i calach”). */
export function dimensionValues(card: ProductCard): { dims_cm: string; dims_in: string; dims_text: string; dims_estimated: string } {
  const d = card.dimensions;
  const nums = [d.width_cm, d.depth_cm, d.height_cm].filter((x): x is number => x !== null);
  return {
    dims_cm: list(nums.map(fmt), " × "),
    dims_in: list(nums.map(inch), " × "),
    dims_text: d.text,
    dims_estimated: d.estimate ? "tak" : "nie",
  };
}

export type ShotPromptInput = {
  shot: Shot;
  card: ProductCard;
  recipe: StyleRecipe;
  config: EngineConfig;
  aspectRatio: string;
  resolution: string;
  /** The Product Lock text — compiled in only where the template places {{fidelity_rules}}. */
  fidelityRules: string;
  /** Amended retry only: the QC correction(s). */
  correction?: string | null;
};

export function shotValues(input: ShotPromptInput): CompileValues {
  const { shot, card, recipe, config } = input;
  const labels = config.labels;
  const negative = dedupe([
    ...config.negative_base.split(","),
    ...card.risks,
    ...card.reference_additions,
    ...shot.risks,
  ].map((x) => x.trim()));
  return {
    style_genre: recipe.genre,
    style_light: recipe.light,
    style_scenery: recipe.scenery,
    style_effects: recipe.effects,
    style_product_rules: recipe.product_rules,
    style_forbidden: list(dedupe([...recipe.forbidden, ...config.banned_cliches]), "; "),
    shared_rules: list(config.shared_rules, "\n"),
    product_name: card.name,
    product_variant: card.variant,
    product_construction: list(card.construction),
    // The full set only where the whole product is in an empty frame; with
    // people the plan's visible count (clamped to 3 for sets) is what counts.
    product_counts: shot.whole && shot.people === "none" ? list(card.counts.map((c) => `${c.element}: ${c.count}`), "; ") : "",
    visible_units: shot.visible_units !== null && !(shot.whole && shot.people === "none") ? String(shot.visible_units) : "",
    product_colors: list(card.colors.map((c) => c.name)),
    color_guard: card.colors.some((c) => c.pastel) ? labels.pastel_guard : "",
    product_materials: list(card.materials),
    product_texts: list(card.texts, "; "),
    product_not: list(card.is_not, "; "),
    reference_additions: list(card.reference_additions, "; "),
    reference_map: referenceMap(card, shot.references, labels),
    ...dimensionValues(card),
    proportion: card.proportion,
    scale_anchors: list(card.scale_anchors, "; "),
    shot_state: stateLabel(card, shot.product_state),
    shot_grip: shot.grip,
    shot_moment: shot.moment,
    shot_motion: shot.motion,
    shot_frame_type: labels.frame_types[shot.frame_type],
    shot_mode: labels.fidelity_modes[shot.fidelity_mode],
    shot_angle_deg: String(shot.camera.angle_deg),
    shot_height: shot.camera.height,
    shot_distance: shot.camera.distance,
    shot_lens_mm: String(shot.camera.lens_mm),
    shot_placement: shot.camera.placement,
    shot_person: shot.person,
    shot_scenery: shot.scenery,
    shot_correction: input.correction?.trim() ?? "",
    quality_footer: config.footers[shot.footer],
    shot_negative: list(negative),
    aspect_ratio: input.aspectRatio,
    resolution: input.resolution,
    fidelity_rules: input.fidelityRules,
  };
}

/** {{shot_spec}} for the QC stage — the planned shot, as data. */
export function shotSpec(shot: Shot, card: ProductCard): string {
  return JSON.stringify({
    frame_type: shot.frame_type, whole_product: shot.whole, product_state: stateLabel(card, shot.product_state) || shot.product_state,
    people: shot.people, person: shot.person, grip: shot.grip, moment: shot.moment, visible_units: shot.visible_units,
    argument: shot.argument, scenery: shot.scenery,
  });
}

/** {{qc_rules}} — the published QC categories (data). */
export function qcRules(config: EngineConfig): string {
  return JSON.stringify(config.qc.categories.map((c) => ({ id: c.id, level: c.level, kind: c.kind, label: c.label })));
}

/** {{style_recipes}} for the card stage: id, name, categories, tested (data). */
export function recipeCatalog(config: EngineConfig): string {
  return JSON.stringify(config.recipes.map((r) => ({ id: r.id, name: r.name, categories: r.categories, tested: r.tested })));
}

/** {{style_recipe}} for the plan stage: the chosen recipe (data). */
export function recipeForPlan(recipe: StyleRecipe): string {
  const { version: _v, tested_on: _t, ...rest } = recipe;
  return JSON.stringify(rest);
}
