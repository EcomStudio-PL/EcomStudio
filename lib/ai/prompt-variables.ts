/**
 * PROMPT VARIABLES — the registry and the compiler.
 *
 * Client-safe on purpose: the admin editor imports the registry to render the
 * variable chips, and the compiler is plain string code the preview and the
 * server share. Nothing in this file is secret — the prompts that USE these
 * variables are, and they never pass through here on the client.
 *
 * SYNTAX (the admin writes it into a prompt):
 *   {{name}}            REQUIRED. No value → the run stops before any charge.
 *   {{name?}}           OPTIONAL. No value → the placeholder disappears.
 *   {{name|fallback}}   OPTIONAL with an explicit, admin-written fallback.
 *
 * THE REGISTRY IS PER TOOL AND IT IS HONEST: a variable is listed for a tool
 * only when that tool's server path can actually produce it. A value is never
 * invented — an unresolved required variable is an error, not a guess.
 *
 * TRUST. Everything that did not come from the admin is UNTRUSTED DATA:
 * customer text, product fields, planner scenes, model analyses, knowledge
 * hints, previous workflow outputs. Such values are sanitised (control
 * characters, our own delimiters and `{{`/`}}` removed, length capped) and the
 * multi-line ones are wrapped in a DATA block that says, inside the prompt,
 * that it is data and never an instruction. Compilation is one pass, so a
 * value that contains `{{…}}` can never expand into another variable.
 */

export type VariableSource = "customer" | "product" | "system" | "ai" | "knowledge" | "workflow";

export type VariableDef = {
  key: string;
  source: VariableSource;
  /** "inline" values are flattened to one line; "block" values are wrapped in
   *  a delimited DATA block. Trusted system values are inserted as they are. */
  render: "inline" | "block" | "trusted";
  /** Longest value the compiler will insert, in characters. */
  max: number;
  /** A realistic value for the admin's compile preview. Never used at runtime. */
  sample: string;
  /** Resolving it costs a model call; the server resolves it only when the
   *  prompt actually references it. */
  costly?: boolean;
  /** "trusted" values must match this; anything else counts as missing. A
   *  trusted slot is inserted without a DATA fence, so it only ever takes
   *  values from a closed set (a ratio, a size, tak/nie…). */
  allow?: RegExp;
  /** Keep the characters exactly (no compatibility folding: ™ stays ™).
   *  Controls, invisible characters and our markers are still removed. */
  exact?: boolean;
};

export const DATA_OPEN = "<<<DANE_KLIENTA";
export const DATA_CLOSE = "DANE_KLIENTA>>>";

const V = {
  product_name: { key: "product_name", source: "product", render: "inline", max: 120, sample: "Czajnik elektryczny Aurora 1,7 l" },
  product_description: { key: "product_description", source: "product", render: "block", max: 1200, sample: "Stal szczotkowana, podświetlany poziom wody, podstawa 360°." },
  extra_info: { key: "extra_info", source: "product", render: "block", max: 2000, sample: "Zestaw zawiera podstawę i filtr." },
  style: { key: "style", source: "customer", render: "block", max: 300, sample: "jasno, skandynawsko" },
  session_type: { key: "session_type", source: "system", render: "trusted", max: 40, sample: "advertising", allow: /^(advertising|lifestyle)$/ },
  scene: { key: "scene", source: "ai", render: "block", max: 1500, sample: "Jasny blat kuchenny z marmuru, poranne światło z okna po lewej." },
  scene_title: { key: "scene_title", source: "ai", render: "inline", max: 120, sample: "Poranna kuchnia" },
  human_presence: { key: "human_presence", source: "ai", render: "trusted", max: 3, sample: "nie", allow: /^(tak|nie)$/ },
  aspect_ratio: { key: "aspect_ratio", source: "system", render: "trusted", max: 12, sample: "4:5", allow: /^(auto|\d{1,2}:\d{1,2})$/ },
  resolution: { key: "resolution", source: "system", render: "trusted", max: 8, sample: "2K", allow: /^[1248]K$/ },
  tool_name: { key: "tool_name", source: "system", render: "trusted", max: 80, sample: "fashion_flat_lay", allow: /^[a-z_]{1,60}$/ },
  image_count: { key: "image_count", source: "system", render: "trusted", max: 3, sample: "2", allow: /^\d{1,3}$/ },
  fidelity_rules: { key: "fidelity_rules", source: "system", render: "trusted", max: 4000, sample: "PRODUCT LOCK — NON-NEGOTIABLE FIDELITY RULES: …" },
  product_analysis: { key: "product_analysis", source: "ai", render: "block", max: 2000, sample: "Kategoria: AGD. Materiały: stal, tworzywo. Kolory: srebrny, czarny. Elementy: włącznik, wskaźnik LED.", costly: true },
  knowledge_hints: { key: "knowledge_hints", source: "knowledge", render: "block", max: 1500, sample: "Sprawdziło się: jasne tło, cień kontaktowy." },
  knowledge_scene: { key: "knowledge_scene", source: "knowledge", render: "block", max: 600, sample: "Minimalistyczny blat, miękkie boczne światło." },
  hint: { key: "hint", source: "customer", render: "block", max: 1000, sample: "Ułóż koszulę bardziej płasko." },
  user_prompt: { key: "user_prompt", source: "customer", render: "block", max: 6000, sample: "Buty na drewnianej ławce w parku." },
  negative_prompt: { key: "negative_prompt", source: "customer", render: "block", max: 1000, sample: "bez tekstu" },
  previous: { key: "previous", source: "workflow", render: "block", max: 4000, sample: "(wynik poprzedniego kroku)" },
} satisfies Record<string, VariableDef>;

const stepVars = (n: number): VariableDef[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `step${i + 1}`, source: "workflow" as const, render: "block" as const, max: 4000,
    sample: `(wynik kroku ${i + 1})`,
  }));

/* GrovShot Lifestyle Engine V2 (lib/grovshot-v2): one template per stage.
 * Customer text and model output are untrusted blocks and may stand only in
 * a stage's USER section (lib/grovshot-v2/stages.ts); config text (recipes,
 * footers, labels, the negative base) is admin text; numbers and closed
 * values are trusted with an anchored allow-list. Samples are neutral
 * placeholders — this registry ships to the admin's browser. */
const gs = (key: string, source: VariableSource, render: VariableDef["render"], max: number, sample: string, extra: Partial<VariableDef> = {}): VariableDef =>
  ({ key, source, render, max, sample, ...extra });
const GS = {
  photo_count: gs("photo_count", "system", "trusted", 2, "4", { allow: /^(10|[1-9])$/ }),
  shot_count: gs("shot_count", "system", "trusted", 2, "5", { allow: /^(10|[1-9])$/ }),
  is_hero: gs("is_hero", "system", "trusted", 3, "nie", { allow: /^(tak|nie)$/ }),
  dims_estimated: gs("dims_estimated", "system", "trusted", 3, "nie", { allow: /^(tak|nie)$/ }),
  visible_units: gs("visible_units", "ai", "trusted", 2, "3", { allow: /^\d{1,2}$/ }),
  shot_angle_deg: gs("shot_angle_deg", "ai", "trusted", 3, "15", { allow: /^-?\d{1,2}$/ }),
  shot_lens_mm: gs("shot_lens_mm", "ai", "trusted", 3, "70", { allow: /^\d{2,3}$/ }),
  allegro_description: gs("allegro_description", "customer", "block", 20000, "(opis produktu wklejony przez sprzedawcę)"),
  customer_dimensions: gs("customer_dimensions", "customer", "inline", 200, "(wymiary podane przez klienta)"),
  user_shot_plan: gs("user_shot_plan", "customer", "block", 6000, "[{\"row\":1,\"text\":\"…\",\"photo\":2,\"keep_framing\":false}]"),
  validation_summary: gs("validation_summary", "ai", "block", 4000, "[{\"photo\":1,\"status\":\"ok\",\"state\":\"…\",\"angle\":\"…\",\"reasons\":[]}]"),
  product_card: gs("product_card", "ai", "block", 16000, "{\"name\":\"…\",\"construction\":[\"…\"]}"),
  photo_catalog: gs("photo_catalog", "ai", "block", 3000, "[{\"photo\":1,\"role\":\"product\",\"state\":\"…\",\"whole\":true}]"),
  shot_spec: gs("shot_spec", "ai", "block", 6000, "{\"frame_type\":\"hero\",\"product_state\":\"…\"}"),
  // Its violations quote ids slugged from the card (the model's reading of
  // the customer's description): untrusted, USER section only.
  plan_feedback: gs("plan_feedback", "ai", "block", 3000, "[{\"code\":\"frame_repeat\",\"frame\":\"hero\",\"count\":3}]"),
  people_targets: gs("people_targets", "system", "block", 400, "{\"person\":[1,1],\"hands\":[1,1]}"),
  style_recipes: gs("style_recipes", "system", "block", 8000, "[{\"id\":\"…\",\"name\":\"…\",\"categories\":[\"…\"]}]"),
  style_recipe: gs("style_recipe", "system", "block", 6000, "{\"id\":\"…\",\"genre\":\"…\",\"light\":\"…\"}"),
  shared_rules: gs("shared_rules", "system", "block", 6000, "(zasady wspólne z konfiguracji)"),
  banned_cliches: gs("banned_cliches", "system", "inline", 2000, "(zakazane klisze z konfiguracji)"),
  frame_types: gs("frame_types", "system", "inline", 300, "hero, wide_environment, medium, tight_closeup, in_hand, top_down"),
  qc_rules: gs("qc_rules", "system", "block", 10000, "[{\"id\":\"…\",\"level\":\"reject_always\",\"label\":\"…\"}]"),
  style_genre: gs("style_genre", "system", "block", 600, "(hasło gatunku z przepisu)"),
  style_light: gs("style_light", "system", "block", 1500, "(światło z przepisu)"),
  style_scenery: gs("style_scenery", "system", "block", 1500, "(scenografia z przepisu)"),
  style_effects: gs("style_effects", "system", "block", 1500, "(efekty z przepisu)"),
  style_product_rules: gs("style_product_rules", "system", "block", 1500, "(zasady produktu z przepisu)"),
  style_forbidden: gs("style_forbidden", "system", "block", 3000, "(zakazy z przepisu); (zakazane klisze)"),
  quality_footer: gs("quality_footer", "system", "block", 600, "(stopka jakości z konfiguracji)"),
  color_guard: gs("color_guard", "system", "block", 400, "(zdanie chroniące kolor pastelowy z konfiguracji)"),
  shot_frame_type: gs("shot_frame_type", "system", "inline", 120, "(nazwa typu kadru z konfiguracji)"),
  shot_mode: gs("shot_mode", "system", "inline", 120, "(nazwa trybu z konfiguracji)"),
  shot_negative: gs("shot_negative", "ai", "block", 4000, "(baza negative z konfiguracji), (ryzyka z karty)"),
  reference_map: gs("reference_map", "ai", "block", 1500, "1: produkt · zamknięty · przód · całość; 2: …"),
  product_name: gs("product_name", "ai", "inline", 200, "(nazwa produktu z karty)"),
  product_variant: gs("product_variant", "ai", "inline", 200, "(wariant z karty)"),
  product_construction: gs("product_construction", "ai", "block", 1500, "(budowa z karty)"),
  product_counts: gs("product_counts", "ai", "block", 600, "(element): (liczba)"),
  product_colors: gs("product_colors", "ai", "inline", 400, "(kolory z karty)"),
  product_materials: gs("product_materials", "ai", "inline", 400, "(materiały z karty)"),
  // Inscriptions are copied character for character (™, ®, ² stay as they are).
  product_texts: gs("product_texts", "ai", "inline", 400, "(napisy z karty)", { exact: true }),
  product_not: gs("product_not", "ai", "inline", 400, "(czym produkt nie jest)"),
  reference_additions: gs("reference_additions", "ai", "inline", 400, "(dodatki z referencji, których nie kopiujemy)"),
  dims_cm: gs("dims_cm", "ai", "inline", 60, "110 × 30 × 120"),
  dims_in: gs("dims_in", "ai", "inline", 60, "43,3 × 11,8 × 47,2"),
  dims_text: gs("dims_text", "ai", "inline", 200, "(wymiary słowami z karty)"),
  proportion: gs("proportion", "ai", "block", 300, "(proporcja z karty)"),
  scale_anchors: gs("scale_anchors", "ai", "block", 800, "(odniesienia skali z karty)"),
  shot_state: gs("shot_state", "ai", "inline", 200, "(stan produktu w ujęciu)"),
  shot_grip: gs("shot_grip", "ai", "block", 600, "(chwyt z planu)"),
  shot_moment: gs("shot_moment", "ai", "block", 800, "(moment z planu)"),
  shot_motion: gs("shot_motion", "ai", "block", 400, "(element ruchu z planu)"),
  shot_height: gs("shot_height", "ai", "inline", 120, "(wysokość kamery z planu)"),
  shot_distance: gs("shot_distance", "ai", "inline", 120, "(odległość z planu)"),
  shot_placement: gs("shot_placement", "ai", "block", 400, "(położenie elementów w kadrze z planu)"),
  shot_person: gs("shot_person", "ai", "block", 600, "(postać z planu)"),
  shot_scenery: gs("shot_scenery", "ai", "block", 1500, "(scenografia z planu)"),
  shot_correction: gs("shot_correction", "ai", "block", 800, "(poprawka z kontroli jakości)"),
  // Etap 3 — the prompt writer's data (USER section) and its output (the
  // blocks of the image prompt, PROMPT section only).
  plan_overview: gs("plan_overview", "ai", "block", 3000, "[{\"shot\":1,\"title\":\"…\",\"frame_type\":\"hero\",\"place\":\"…\"}]"),
  previous_blocks: gs("previous_blocks", "ai", "block", 9000, "{\"direction\":\"…\",\"product\":\"…\"}"),
  p_direction: gs("p_direction", "ai", "block", 700, "(KIERUNEK — napisany przez autora promptu)"),
  p_product: gs("p_product", "ai", "block", 2400, "(PRODUKT — napisany przez autora promptu)"),
  p_scale: gs("p_scale", "ai", "block", 900, "(SKALA — napisana przez autora promptu)"),
  p_state: gs("p_state", "ai", "block", 900, "(STAN / CHWYT — napisany przez autora promptu)"),
  p_moment: gs("p_moment", "ai", "block", 1200, "(MOMENT — napisany przez autora promptu)"),
  p_frame: gs("p_frame", "ai", "block", 1200, "(KADR — napisany przez autora promptu)"),
  p_person: gs("p_person", "ai", "block", 900, "(POSTAĆ — napisana przez autora promptu)"),
  p_scenery: gs("p_scenery", "ai", "block", 1800, "(SCENOGRAFIA — napisana przez autora promptu)"),
} satisfies Record<string, VariableDef>;

const IMAGE_EDIT_COMMON: VariableDef[] = [
  V.tool_name, V.aspect_ratio, V.resolution, V.image_count, V.fidelity_rules,
  V.product_analysis, V.knowledge_hints, V.knowledge_scene,
];

/**
 * Tools whose every run is an independent task: no knowledge, examples,
 * feedback ranking or earlier results can reach the request, and the admin
 * and customer UIs hide those controls for them.
 */
export const STATELESS_TOOL_KEYS: ReadonlySet<string> = new Set(["retouch", "ecommerce_thumbnail"]);

/**
 * What each tool's server path can really provide. Tools without an entry
 * have no prompt engine at all (local and provider tools).
 */
export const TOOL_VARIABLES: Record<string, VariableDef[]> = {
  // GrovShot: the planner's scene, the product fields the customer typed,
  // the style and session type, plus the analysis and knowledge signals.
  prompts: [
    V.product_name, V.product_description, V.extra_info, V.style, V.session_type,
    V.scene, V.scene_title, V.human_presence, V.aspect_ratio, V.resolution,
    V.fidelity_rules, V.product_analysis, V.knowledge_hints, V.knowledge_scene,
  ],
  // The customer's own prompt, wrapped by a GrovBase instruction (hybrid).
  generator: [
    V.user_prompt, V.negative_prompt, V.product_description, V.aspect_ratio, V.resolution,
    V.fidelity_rules, V.knowledge_hints, V.knowledge_scene,
  ],
  // Retusz is a STATELESS single call: only plain system values may be placed
  // — no tool name, no image analysis, no knowledge/examples (those carry
  // earlier runs and ratings into the request).
  retouch: [V.aspect_ratio, V.resolution, V.image_count, V.fidelity_rules],
  fashion_ghost_mannequin: [...IMAGE_EDIT_COMMON, V.hint],
  fashion_flat_lay: [...IMAGE_EDIT_COMMON, V.hint],
  fashion_iron: IMAGE_EDIT_COMMON,
  fashion_change_person: IMAGE_EDIT_COMMON,
  fashion_change_face: IMAGE_EDIT_COMMON,
  // Miniaturka: a fixed prompt sent 1:1 — no variable of any kind may be
  // placed, so the published text IS the request text (the publish gate
  // refuses any {{…}}).
  ecommerce_thumbnail: [],
  // GrovShot Lifestyle Engine V2 — one registry per stage (lib/grovshot-v2).
  grovshot_v2_validate: [GS.photo_count, V.session_type],
  grovshot_v2_card: [GS.photo_count, GS.validation_summary, GS.allegro_description, GS.customer_dimensions, GS.style_recipes, V.session_type],
  grovshot_v2_plan: [
    GS.shot_count, GS.product_card, GS.photo_catalog, GS.style_recipe, GS.shared_rules, GS.banned_cliches,
    GS.frame_types, GS.people_targets, GS.user_shot_plan, GS.plan_feedback, V.aspect_ratio, V.session_type,
  ],
  grovshot_v2_shot: [
    GS.style_genre, GS.style_light, GS.style_scenery, GS.style_effects, GS.style_product_rules, GS.style_forbidden,
    GS.shared_rules, GS.product_name, GS.product_variant, GS.product_construction, GS.product_counts, GS.visible_units,
    GS.product_colors, GS.color_guard, GS.product_materials, GS.product_texts, GS.product_not, GS.reference_additions,
    GS.reference_map, GS.dims_cm, GS.dims_in, GS.dims_text, GS.dims_estimated, GS.proportion, GS.scale_anchors,
    GS.shot_state, GS.shot_grip, GS.shot_moment, GS.shot_motion, GS.shot_frame_type, GS.shot_mode, GS.shot_angle_deg,
    GS.shot_height, GS.shot_distance, GS.shot_lens_mm, GS.shot_placement, GS.shot_person, GS.shot_scenery,
    GS.shot_correction, GS.quality_footer, GS.shot_negative, V.aspect_ratio, V.resolution, V.fidelity_rules,
    GS.product_card, GS.shot_spec, GS.plan_overview, GS.previous_blocks,
    GS.p_direction, GS.p_product, GS.p_scale, GS.p_state, GS.p_moment, GS.p_frame, GS.p_person, GS.p_scenery,
  ],
  grovshot_v2_qc: [GS.reference_map, GS.product_card, GS.shot_spec, GS.is_hero, GS.qc_rules],
  // The engine config is a JSON body: no placeholder of any kind.
  grovshot_v2_config: [],
};

/** One anchor variable per block of the IMAGE PROMPT (the shot template's
 *  PROMPT section), in the spec's fixed order (Etap 3: KIERUNEK, PRODUKT,
 *  SKALA, STAN/CHWYT, MOMENT, KADR, POSTAĆ, SCENOGRAFIA, STOPKA, NEGATIVE
 *  PROMPT). The publish gate checks the order. */
export const GROVSHOT_V2_SHOT_BLOCKS = [
  "p_direction", "p_product", "p_scale", "p_state", "p_moment",
  "p_frame", "p_person", "p_scenery", "quality_footer", "shot_negative",
] as const;

/** The writer's output: placed only in the PROMPT section (they do not
 *  exist while the writer is being asked). */
export const GROVSHOT_V2_WRITER_OUTPUTS: ReadonlySet<string> = new Set([
  "p_direction", "p_product", "p_scale", "p_state", "p_moment", "p_frame", "p_person", "p_scenery",
]);

/** Placeholders a V2 stage template must place, or the stage cannot do its
 *  job (the shot prompt names the photos in send order and always ends with
 *  the footer and the negative prompt — spec, Etap 3). */
export const GROVSHOT_V2_REQUIRED: Record<string, string[]> = {
  grovshot_v2_validate: ["photo_count"],
  grovshot_v2_card: ["photo_count", "allegro_description", "validation_summary"],
  grovshot_v2_plan: ["shot_count", "product_card", "photo_catalog"],
  grovshot_v2_shot: ["reference_map", "product_card", "shot_spec", ...GROVSHOT_V2_SHOT_BLOCKS],
  grovshot_v2_qc: ["reference_map", "qc_rules"],
};

/** Variables available inside a workflow step at `position` (1-based). */
export function workflowVariables(toolKey: string, position: number): VariableDef[] {
  const base = TOOL_VARIABLES[toolKey] ?? [];
  if (position <= 1) return base;
  return [...base, V.previous, ...stepVars(position - 1)];
}

export function variableRegistry(toolKey: string, workflow = false): VariableDef[] {
  return workflow ? workflowVariables(toolKey, 8) : TOOL_VARIABLES[toolKey] ?? [];
}

/* ── parsing ──────────────────────────────────────────────────────────────*/

export type Placeholder = {
  raw: string;
  name: string;
  optional: boolean;
  fallback: string | null;
};

// {{ name }}, {{name?}}, {{name|fallback text}}. The fallback may not contain
// braces or newlines, which keeps the grammar unambiguous.
const TOKEN = /\{\{\s*([a-z][a-z0-9_]{0,40})\s*(\?|\|([^{}\n]{0,200}))?\s*\}\}/g;

export function parsePlaceholders(template: string): Placeholder[] {
  const out: Placeholder[] = [];
  for (const m of template.matchAll(TOKEN)) {
    const hasFallback = m[2]?.startsWith("|") ?? false;
    out.push({
      raw: m[0],
      name: m[1],
      optional: Boolean(m[2]),
      fallback: hasFallback ? (m[3] ?? "").trim() : null,
    });
  }
  return out;
}

/** Names the template references, deduplicated — the server resolves only
 *  these (a costly variable nobody uses is never paid for). */
export function referencedNames(template: string): Set<string> {
  return new Set(parsePlaceholders(template).map((p) => p.name));
}

/** Leftover `{{` that did not parse as a placeholder: almost always a typo the
 *  admin wants to hear about before publishing. */
export function malformedPlaceholders(template: string): string[] {
  const stripped = template.replace(TOKEN, "");
  return [...stripped.matchAll(/\{\{[^}\n]{0,60}\}?\}?/g)].map((m) => m[0]).slice(0, 10);
}

/* ── sanitising ───────────────────────────────────────────────────────────*/

/** Drop C0 controls (except tab, LF, CR), DEL and C1 controls. */
function stripControls(value: string): string {
  let out = "";
  for (const ch of value) {
    const c = ch.codePointAt(0) ?? 0;
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || (c >= 127 && c <= 159)) continue;
    out += ch;
  }
  return out;
}

/** Make an untrusted value safe to place inside an admin prompt. */
/** An exact value keeps its characters (™, ®, accents) — only the fullwidth
 *  and small-form ASCII look-alikes NFKC would fold are folded, so a marker
 *  or a placeholder cannot be forged from them either. */
function foldDelimiters(value: string): string {
  return value
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[\uFE5B\uFE5C\uFE64\uFE65]/g, (c) => ({ "\uFE5B": "{", "\uFE5C": "}", "\uFE64": "<", "\uFE65": ">" })[c] ?? c);
}

export function sanitizeValue(value: string, def: Pick<VariableDef, "render" | "max" | "exact">): string {
  // Fold look-alikes first (fullwidth brackets → ASCII) and drop invisible
  // format characters (zero-width space/joiners, BOM), so a marker cannot be
  // smuggled in a form the model reads but the checks below do not.
  let v = stripControls(def.exact ? foldDelimiters(value) : value.normalize("NFKC")).replace(/[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "").replace(/\u{10FFFD}/gu, "");
  // Our delimiters and the placeholder grammar can never be forged from data.
  // Removal is repeated until nothing changes: a single pass could itself
  // assemble a new marker out of the pieces around a removed one.
  let prev: string;
  do {
    prev = v;
    v = v.replace(/D\s*A\s*N\s*E\s*_\s*K\s*L\s*I\s*E\s*N\s*T\s*A/gi, "").replace(/[<>](\s*[<>])+/g, "");
  } while (v !== prev);
  v = v.replace(/\{\{/g, "{ {").replace(/\}\}/g, "} }");
  if (def.render === "inline") v = v.replace(/\s+/g, " ");
  v = v.trim();
  return v.length > def.max ? `${v.slice(0, def.max).trimEnd()}…` : v;
}


/* ── compiling ────────────────────────────────────────────────────────────*/

export type CompileValues = Record<string, string | null | undefined>;

export type CompileResult =
  | { ok: true; text: string; used: string[]; skipped: string[] }
  | { ok: false; error: "variable_missing" | "variable_unknown" | "empty_template"; missing: string[]; unknown: string[] };

/**
 * One pass over the template. Every placeholder is either replaced by its
 * (sanitised) value, by its fallback, by nothing (optional), or the whole
 * compile fails. The output is never partially filled.
 *
 * The compiler is not a second author: outside the placeholders the admin's
 * text is kept exactly. Only where an optional variable came out EMPTY is the
 * gap it left closed — the line breaks touching THAT placeholder folded to at
 * most one blank line, or dropped at the very start or end. Nothing else in
 * the prompt is reflowed.
 */
export function compileTemplate(template: string, defs: VariableDef[], values: CompileValues): CompileResult {
  if (!template.trim()) return { ok: false, error: "empty_template", missing: [], unknown: [] };
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const placeholders = parsePlaceholders(template);
  const unknown = [...new Set(placeholders.filter((p) => !byKey.has(p.name)).map((p) => p.name))];
  if (unknown.length > 0) return { ok: false, error: "variable_unknown", missing: [], unknown };

  const missing = new Set<string>();
  const used = new Set<string>();
  const skipped = new Set<string>();
  const text = template.replace(TOKEN, (_raw, name: string, mod: string | undefined, fb: string | undefined) => {
    const def = byKey.get(name)!;
    const rawValue = values[name];
    const present = typeof rawValue === "string" && rawValue.trim().length > 0;
    // A trusted slot takes only a value from its closed set; anything else is
    // treated as absent (required → the run stops; never inserted raw).
    const trustedOk = !present || def.render !== "trusted" || !def.allow || def.allow.test(rawValue.trim());
    if (present && trustedOk) {
      used.add(name);
      if (def.render === "trusted") return rawValue.trim().slice(0, def.max);
      const clean = sanitizeValue(rawValue, def);
      // The value itself — sanitised (no forged placeholders or markers), but
      // with no GrovBase sentence around it: a variable is its value.
      return clean;
    }
    if (mod?.startsWith("|")) { skipped.add(name); return (fb ?? "").trim() || GAP; }
    if (mod === "?") { skipped.add(name); return GAP; }
    missing.add(name);
    return "";
  });
  if (missing.size > 0) return { ok: false, error: "variable_missing", missing: [...missing], unknown: [] };
  return { ok: true, text: closeGaps(text), used: [...used], skipped: [...skipped] };
}

/** Marks where an optional variable came out empty (a supplementary
 *  private-use code point: never typed in a prompt, and stripped from any
 *  value that carried it). */
const GAP = "\u{10FFFD}";

function closeGaps(text: string): string {
  if (!text.includes(GAP)) return text;
  // Adjacent emptied variables form ONE gap, closed once.
  return text.replace(/\n*(?:\u{10FFFD}\n*)+/gu, (m: string, offset: number, whole: string) => {
    if (offset === 0 || offset + m.length === whole.length) return "";
    const breaks = m.split("\n").length - 1;
    return breaks >= 2 ? "\n\n" : breaks === 1 ? "\n" : "";
  });
}

/** Sample values for the admin compile preview — never used at runtime. */
export function sampleValues(defs: VariableDef[]): CompileValues {
  return Object.fromEntries(defs.map((d) => [d.key, d.sample]));
}

