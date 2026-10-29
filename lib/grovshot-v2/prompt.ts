/**
 * GROVBASE SHOT V2 · ETAP 3 — the values of one shot prompt.
 *
 * Two steps, both explicit. (1) The PROMPT WRITER (a text model, Claude by
 * default) is asked with the shot template's SYSTEM + USER sections and the
 * data below (the shared card, this shot's plan, the photo map, the other
 * shots); it answers with this shot's eight blocks as JSON, which
 * `checkWrite` validates. (2) The template's PROMPT section — the ten blocks
 * KIERUNEK … NEGATIVE PROMPT, written by the admin — is compiled with those
 * blocks, the config's footer and the negative (config base + card risks +
 * the writer's additions). Code writes no word of the prompt; nothing is
 * appended after the compile, and the adapter sends the compiled text as it
 * is. The photos are named in the exact order they are sent („zdjęcie 1” =
 * the first image of the request), and a block may name only those.
 */
import type { EngineConfig, StyleRecipe } from "@/lib/grovshot-v2/config";
import type { ProductCard } from "@/lib/grovshot-v2/card";
import type { Shot } from "@/lib/grovshot-v2/plan";
import type { CompileValues } from "@/lib/ai/prompt-variables";
import type { RawWrite } from "@/lib/grovshot-v2/stages";

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
  /** The writer's blocks for this shot (the image prompt only). */
  blocks?: WriterBlocks | null;
};

/** The writer's eight blocks, validated (`checkWrite`). */
export type WriterBlocks = {
  direction: string; product: string; scale: string; state_grip: string; moment: string;
  frame: string; person: string; scenery: string; negative_additions: string[];
};

/** Per-block size limits (characters) — the variables' own maxima. */
const BLOCK_MAX: Record<Exclude<keyof WriterBlocks, "negative_additions">, number> = {
  direction: 700, product: 2400, scale: 900, state_grip: 900, moment: 1200, frame: 1200, person: 900, scenery: 1800,
};

/**
 * Is the writer's answer usable for THIS shot? Every block present and within
 * its size, a person only when the plan has one, and every „zdjęcie N” it
 * names among the N photos this shot sends (the request numbers them 1…N in
 * the plan's order) — a prompt that names a photo the request does not carry
 * would point the image model at nothing.
 */
export function checkWrite(raw: RawWrite | null | undefined, ctx: { refs: number; people: Shot["people"] }):
  { ok: true; blocks: WriterBlocks } | { ok: false; problems: string[] } {
  const r = raw ?? {};
  const problems: string[] = [];
  const text = (k: keyof typeof BLOCK_MAX): string => {
    const v = typeof r[k] === "string" ? (r[k] as string).trim() : "";
    if (v.length > BLOCK_MAX[k]) problems.push(`too_long:${k}`);
    return v;
  };
  const blocks: WriterBlocks = {
    direction: text("direction"), product: text("product"), scale: text("scale"), state_grip: text("state_grip"),
    moment: text("moment"), frame: text("frame"), person: text("person"), scenery: text("scenery"),
    negative_additions: (Array.isArray(r.negative_additions) ? r.negative_additions : [])
      .filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter((x) => x && x.length <= 120).slice(0, 20),
  };
  for (const k of ["direction", "product", "scale", "state_grip", "moment", "frame", "scenery"] as const) {
    if (!blocks[k]) problems.push(`missing:${k}`);
  }
  if (ctx.people !== "none" && !blocks.person) problems.push("missing:person");
  for (const k of Object.keys(BLOCK_MAX) as (keyof typeof BLOCK_MAX)[]) {
    for (const m of blocks[k].matchAll(/zdj(?:ę|e)ci(?:e|u|a|em)\s+(?:nr\s*)?(\d{1,2})/gi)) {
      const n = Number(m[1]);
      if (!(n >= 1 && n <= ctx.refs)) problems.push(`photo_out_of_range:${k}:${n}`);
    }
  }
  return problems.length > 0 ? { ok: false, problems: [...new Set(problems)] } : { ok: true, blocks };
}

/** {{plan_overview}} — the set's other shots, so each prompt stays distinct. */
export function planOverview(shots: readonly Shot[]): string {
  return JSON.stringify(shots.map((x) => ({ shot: x.index + 1, title: x.title, frame_type: x.frame_type, place: x.place, argument: x.argument })));
}

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
    shot_negative: list(dedupe([...negative, ...(input.blocks?.negative_additions ?? [])])),
    p_direction: input.blocks?.direction ?? "",
    p_product: input.blocks?.product ?? "",
    p_scale: input.blocks?.scale ?? "",
    p_state: input.blocks?.state_grip ?? "",
    p_moment: input.blocks?.moment ?? "",
    p_frame: input.blocks?.frame ?? "",
    p_person: input.blocks?.person ?? "",
    p_scenery: input.blocks?.scenery ?? "",
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
