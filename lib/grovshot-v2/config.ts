/**
 * GROVBASE SHOT — LIFESTYLE ENGINE V2 · THE ENGINE CONFIGURATION.
 *
 * Client-safe (the admin editor validates with it, the server runs with it).
 * The configuration is DATA an admin publishes — style recipes, quality
 * footers, the negative base, the QC policy, the people table, budgets — as
 * one JSON body under the tool key `grovshot_v2_config`, versioned like every
 * prompt (draft · publish · rollback). The runtime NEVER falls back to a
 * built-in copy: nothing published, or a body that does not parse, means the
 * engine refuses before any paid call (`config_invalid` / `prompt_unconfigured`).
 *
 * The text values here are style RULES the stage templates place through
 * explicit variables ({{style_light}}, {{quality_footer}}, {{negative_prompt}}
 * …). Nothing in this file is appended to a prompt by code.
 */
import { isAnthropicEffort, type AnthropicEffort } from "@/lib/ai/anthropic-options";

/* ── fixed vocabularies (code contracts, not admin text) ──────────────────*/

/** Kinds of frame a shot plan may use (spec: „Kadr i różnorodność zestawu”). */
export const FRAME_TYPES = ["hero", "wide_environment", "medium", "tight_closeup", "in_hand", "top_down"] as const;
export type FrameType = (typeof FRAME_TYPES)[number];

/** Frames that show the WHOLE product (spec: „cały produkt najwyżej w 2 ujęciach”). */
export const WHOLE_PRODUCT_FRAMES: ReadonlySet<FrameType> = new Set(["hero", "wide_environment"]);

/** Who is in the shot (spec: „Ludzie i zwierzęta”). */
export const PEOPLE_MODES = ["none", "hands", "person", "animal"] as const;
export type PeopleMode = (typeof PEOPLE_MODES)[number];

/** What a shot is for — the auction order (spec: „najpierw produkt i jak działa, potem emocje”). */
export const SHOT_PURPOSES = ["product", "function", "emotion"] as const;
export type ShotPurpose = (typeof SHOT_PURPOSES)[number];

export const FIDELITY_MODES = ["faithful", "free"] as const;
export type FidelityMode = (typeof FIDELITY_MODES)[number];

/** Quality footer variants (spec: „Stopki jakości”). */
export const FOOTER_KINDS = ["interior_hero", "action_people", "macro_detail", "motion", "animals", "beauty"] as const;
export type FooterKind = (typeof FOOTER_KINDS)[number];

/** QC levels (spec: „Etap 4: kontrola jakości”). */
export const QC_LEVELS = ["reject_always", "reject_hero", "tolerate"] as const;
export type QcLevel = (typeof QC_LEVELS)[number];

/** How a rejection is fixed (spec: „Reakcja na błąd”). */
export const ERROR_KINDS = ["random", "systematic"] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

/** The seven tested recipes of the spec + one untested base variant. */
export const RECIPE_IDS = [
  "seasonal_ad", "appliance_food", "premium_interiors", "home_care",
  "outdoor_action", "pet_lifestyle", "beauty_editorial", "base",
] as const;
export type RecipeId = (typeof RECIPE_IDS)[number];
export const TESTED_RECIPE_IDS: readonly RecipeId[] = RECIPE_IDS.filter((r) => r !== "base");

/** What a reference photo shows (spec: „role zdjęć”). */
export const PHOTO_ROLES = ["product", "effect", "packaging", "detail"] as const;
export type PhotoRole = (typeof PHOTO_ROLES)[number];

/* ── shapes ───────────────────────────────────────────────────────────────*/

export type StyleRecipe = {
  id: RecipeId;
  /** Admin label. */
  name: string;
  /** Kategorie, które obsługuje. */
  categories: string[];
  /** Hasło gatunku — the opening of the KIERUNEK block. */
  genre: string;
  /** An example phrase from the tests (np. „grudniowa reklama cukiernicza premium”). */
  genre_example: string;
  light: string;
  scenery: string;
  effects: string;
  product_rules: string;
  forbidden: string[];
  /** „Sprawdzony na” — the products of the 27.10.2026 tests. Empty = untested. */
  tested_on: string[];
  /** False only for the base variant: used when no recipe fits, recorded as such. */
  tested: boolean;
  version: number;
};

export type QcCategory = {
  id: string;
  level: QcLevel;
  /** What a repeat of this error usually means (the QC model may override). */
  kind: ErrorKind;
  label: string;
};

export type PeopleRow = {
  /** Shot counts this row covers (inclusive). */
  min_shots: number;
  max_shots: number;
  /** [min, max] full-figure shots (person or animal). */
  person: [number, number];
  /** [min, max] hands-only shots. */
  hands: [number, number];
};

/** The text/vision roles of the engine, each with its own model. */
export const STAGE_ROLES = ["validate", "card", "plan", "prompt", "qc"] as const;
export type StageRole = (typeof STAGE_ROLES)[number];
/** Providers a text/vision role can run on (image models are separate). */
export const STAGE_PROVIDERS = ["anthropic", "openai", "google"] as const;
export type StageProvider = (typeof STAGE_PROVIDERS)[number];
export type StageModelRef = { provider: StageProvider; model: string; effort?: AnthropicEffort };
/** The Claude models an admin picks from (official API ids; any other id
 *  that the config parser accepts may still be typed in). */
export const CLAUDE_STAGE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"] as const;
/** The same shape check the config parser applies to one role's model. */
export function isStageModelRef(m: unknown): m is StageModelRef {
  if (!m || typeof m !== "object" || Array.isArray(m)) return false;
  const r = m as Record<string, unknown>;
  return (STAGE_PROVIDERS as readonly string[]).includes(String(r.provider))
    && /^[a-z0-9][a-z0-9.\-]{1,60}$/.test(String(r.model))
    && (r.effort === undefined || (r.provider === "anthropic" && isAnthropicEffort(r.effort)));
}
/** A role's model — and a second one ONLY when an admin set it: the engine
 *  never falls back to anything that is not written here. */
export type StageModel = StageModelRef & { fallback?: StageModelRef };

export type EngineConfig = {
  v: 1;
  recipes: StyleRecipe[];
  /** Zasady wspólne dla wszystkich przepisów. */
  shared_rules: string[];
  /** Lista zakazanych klisz AI (grows with tests). */
  banned_cliches: string[];
  footers: Record<FooterKind, string>;
  negative_base: string;
  people_table: PeopleRow[];
  candidates: {
    /** Hero, details, top-down. */
    default: number;
    /** Shots with people or animals, and complex (high-risk) scenes. */
    people_or_complex: number;
  };
  retry: {
    /** Extra generation rounds per shot after a QC rejection (spec: max 1). */
    max_rounds: 0 | 1;
    candidates: 1;
    /** A candidate that came back with NO image (a transport failure) is
     *  re-issued this many times with the same prompt. Separate from the
     *  quality retry and never counted as one (brief §12). */
    transport_reissues: 0 | 1;
  };
  validation: {
    /** At or above: acted on (photo excluded, order blocked). */
    act_confidence: number;
    /** Between ask and act: the customer is asked to confirm. Below: ignored. */
    ask_confidence: number;
    /** Licensed characters (spec: „Decyzja do podjęcia”). At act confidence:
     *  block the order, ask the customer, or only record it. Between ask and
     *  act the customer is always asked. The product decision is the owner's. */
    licensed_policy: "block" | "ask" | "allow";
  };
  qc: {
    categories: QcCategory[];
    /** A reject-level finding counts only at or above this confidence. */
    reject_confidence: number;
    /** Reject-level findings between warn and reject: delivered as 'warning'. */
    warn_confidence: number;
    /** One QC request's timeout. */
    timeout_ms: number;
    /** A QC call that failed is asked once more (0 = never). A candidate
     *  nobody could check is never delivered. */
    reask: 0 | 1;
    color: {
      enabled: boolean;
      /** Max hue difference (degrees, CIELAB hue angle) before a colour shift is reported. */
      hue_max_deg: number;
      hue_max_deg_pastel: number;
      /** Allowed chroma ratio candidate/reference. */
      chroma_ratio_min: number;
      chroma_ratio_max: number;
      /** Below this chroma the reference colour is near-neutral: hue is meaningless. */
      neutral_chroma: number;
      /** Max std-dev of L* in a sample: above it the region is not one colour. */
      max_l_std: number;
      /** Smallest sample box, as a fraction of the image area. */
      min_box_area: number;
    };
  };
  budget: {
    /** Internal API spend allowed per order: base + shots × per_shot (USD micros). */
    base_usd_micros: number;
    per_shot_usd_micros: number;
    /** Reserved before each vision/text call whose real cost is not known in advance. */
    vision_call_usd_micros: number;
    /** Counted for a call whose provider reports no price (unseeded token prices). */
    unknown_text_call_usd_micros: number;
    /** Allowance on top of the per-image price for reported input/thinking tokens. */
    image_token_allowance_usd_micros: number;
  };
  limits: {
    max_refs_per_shot: number;
    shot_concurrency: number;
    runs_per_hour: number;
    /** Orders a member may start per day that end before any charge (stopped
     *  at the input check): the analysis is GrovBase's cost. */
    uncharged_runs_per_day: number;
    /** Paid image requests per shot, every round and re-issue included —
     *  what „Próby” is for one image elsewhere (spec: 2 candidates + 1 retry). */
    max_paid_images_per_shot: number;
    /** Re-plans allowed when the plan breaks a hard rule (before any charge). */
    replans: 0 | 1;
  };
  /** The model of every text/vision role (all five required). Nothing else
   *  is ever asked: no planner chain, no implicit fallback. */
  models: Record<StageRole, StageModel>;
  /**
   * The words the shot prompt uses for the code's closed values. They are
   * admin text (published, versioned) so that no word of the image prompt is
   * written by code: code only picks the label of a value.
   */
  labels: {
    photo_roles: Record<PhotoRole, string>;
    frame_types: Record<FrameType, string>;
    fidelity_modes: Record<FidelityMode, string>;
    whole: string;
    part: string;
    /** Placed through {{color_guard}} only when the card marks a pastel colour
     *  (spec: „przy pastelowych produktach osobne zdanie chroniące kolor”). */
    pastel_guard: string;
  };
};

/* ── parsing ──────────────────────────────────────────────────────────────*/

export type ConfigParse = { ok: true; config: EngineConfig } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown, max = 4000): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const isNum = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const isInt = (v: unknown, min: number, max: number): v is number => isNum(v, min, max) && Number.isInteger(v);
const strList = (v: unknown, max = 60, each = 600): v is string[] =>
  Array.isArray(v) && v.length <= max && v.every((s) => isStr(s, each));

/**
 * Parse and check a published configuration. Every field is required and
 * range-checked: a half-valid config is refused as a whole, never patched with
 * defaults (the defaults would be a built-in config by another name).
 */
export function parseEngineConfig(raw: unknown): ConfigParse {
  let value = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch { return { ok: false, errors: ["json_invalid"] }; }
  }
  const e: string[] = [];
  if (!isObj(value)) return { ok: false, errors: ["not_an_object"] };
  const c = value;
  if (c.v !== 1) e.push("v");

  // Recipes: exactly the seven tested ones of the spec plus the base variant.
  const recipes = Array.isArray(c.recipes) ? c.recipes : [];
  if (!Array.isArray(c.recipes)) e.push("recipes");
  const seen = new Set<string>();
  recipes.forEach((r, i) => {
    const p = `recipes[${i}]`;
    if (!isObj(r)) { e.push(p); return; }
    if (!(RECIPE_IDS as readonly string[]).includes(String(r.id))) e.push(`${p}.id`);
    if (seen.has(String(r.id))) e.push(`${p}.id_duplicate`);
    seen.add(String(r.id));
    for (const k of ["name", "genre", "genre_example", "light", "scenery", "effects", "product_rules"] as const) {
      if (!isStr(r[k], 1500)) e.push(`${p}.${k}`);
    }
    if (!strList(r.categories, 30, 200) || (r.categories as string[]).length === 0) e.push(`${p}.categories`);
    if (!strList(r.forbidden, 40, 300)) e.push(`${p}.forbidden`);
    if (!Array.isArray(r.tested_on) || !(r.tested_on as unknown[]).every((s) => isStr(s, 200))) e.push(`${p}.tested_on`);
    if (typeof r.tested !== "boolean") e.push(`${p}.tested`);
    else if (r.tested !== (r.id !== "base")) e.push(`${p}.tested_flag`);
    if (!isInt(r.version, 1, 100000)) e.push(`${p}.version`);
  });
  for (const id of RECIPE_IDS) if (!seen.has(id)) e.push(`recipes.missing.${id}`);
  if (recipes.length !== RECIPE_IDS.length) e.push("recipes.count");

  if (!strList(c.shared_rules, 40, 600) || (c.shared_rules as string[]).length === 0) e.push("shared_rules");
  if (!strList(c.banned_cliches, 80, 200) || (c.banned_cliches as string[]).length === 0) e.push("banned_cliches");
  if (!isObj(c.footers)) e.push("footers");
  else for (const k of FOOTER_KINDS) if (!isStr(c.footers[k], 600)) e.push(`footers.${k}`);
  if (!isStr(c.negative_base, 2000)) e.push("negative_base");

  // People table: rows cover 1..10 without gaps or overlaps, ranges sane.
  const rows = Array.isArray(c.people_table) ? c.people_table : [];
  if (!Array.isArray(c.people_table) || rows.length === 0) e.push("people_table");
  const covered = new Array(11).fill(0);
  rows.forEach((r, i) => {
    const p = `people_table[${i}]`;
    if (!isObj(r) || !isInt(r.min_shots, 1, 10) || !isInt(r.max_shots, 1, 10) || (r.min_shots as number) > (r.max_shots as number)) { e.push(p); return; }
    const pair = (v: unknown) => Array.isArray(v) && v.length === 2 && isInt(v[0], 0, 10) && isInt(v[1], 0, 10) && v[0] <= v[1];
    if (!pair(r.person)) e.push(`${p}.person`);
    if (!pair(r.hands)) e.push(`${p}.hands`);
    for (let n = r.min_shots as number; n <= (r.max_shots as number); n++) covered[n]++;
  });
  for (let n = 1; n <= 10; n++) if (covered[n] !== 1) { e.push(`people_table.coverage.${n}`); break; }

  if (!isObj(c.candidates) || !isInt(c.candidates.default, 1, 2) || !isInt(c.candidates.people_or_complex, 1, 2)) e.push("candidates");
  if (!isObj(c.retry) || !(c.retry.max_rounds === 0 || c.retry.max_rounds === 1) || c.retry.candidates !== 1
    || !(c.retry.transport_reissues === 0 || c.retry.transport_reissues === 1)) e.push("retry");
  if (!isObj(c.validation) || !isNum(c.validation.act_confidence, 0.5, 1) || !isNum(c.validation.ask_confidence, 0, 1)
    || (c.validation.ask_confidence as number) >= (c.validation.act_confidence as number)
    || !["block", "ask", "allow"].includes(String(c.validation.licensed_policy))) e.push("validation");

  if (!isObj(c.qc)) e.push("qc");
  else {
    const q = c.qc;
    const cats = Array.isArray(q.categories) ? q.categories : [];
    if (cats.length === 0) e.push("qc.categories");
    const ids = new Set<string>();
    cats.forEach((cat, i) => {
      if (!isObj(cat) || !/^[a-z][a-z0-9_]{1,40}$/.test(String(cat.id)) || ids.has(String(cat.id))
        || !(QC_LEVELS as readonly string[]).includes(String(cat.level))
        || !(ERROR_KINDS as readonly string[]).includes(String(cat.kind)) || !isStr(cat.label, 300)) e.push(`qc.categories[${i}]`);
      if (isObj(cat)) ids.add(String(cat.id));
    });
    // The code's own colour finding must be classified by the admin too.
    if (!ids.has("color_shift")) e.push("qc.categories.color_shift");
    if (!isNum(q.reject_confidence, 0.5, 1) || !isNum(q.warn_confidence, 0, 1)
      || (q.warn_confidence as number) >= (q.reject_confidence as number)) e.push("qc.confidence");
    if (!isInt(q.timeout_ms, 20_000, 110_000) || !(q.reask === 0 || q.reask === 1)) e.push("qc.timing");
    if (!isObj(q.color) || typeof q.color.enabled !== "boolean" || !isNum(q.color.hue_max_deg, 1, 180)
      || !isNum(q.color.hue_max_deg_pastel, 1, 180) || !isNum(q.color.chroma_ratio_min, 0.05, 1)
      || !isNum(q.color.chroma_ratio_max, 1, 20) || !isNum(q.color.neutral_chroma, 0, 50)
      || !isNum(q.color.max_l_std, 1, 100) || !isNum(q.color.min_box_area, 0.0001, 0.5)) e.push("qc.color");
  }

  if (!isObj(c.budget) || !isInt(c.budget.base_usd_micros, 0, 20_000_000) || !isInt(c.budget.per_shot_usd_micros, 1, 20_000_000)
    || !isInt(c.budget.vision_call_usd_micros, 0, 5_000_000) || !isInt(c.budget.unknown_text_call_usd_micros, 0, 5_000_000)
    || !isInt(c.budget.image_token_allowance_usd_micros, 0, 5_000_000)) e.push("budget");
  if (!isObj(c.limits) || !isInt(c.limits.max_refs_per_shot, 1, 6) || !isInt(c.limits.shot_concurrency, 1, 4)
    || !isInt(c.limits.runs_per_hour, 1, 200) || !isInt(c.limits.uncharged_runs_per_day, 1, 500)
    || !isInt(c.limits.max_paid_images_per_shot, 1, 6)
    || !(c.limits.replans === 0 || c.limits.replans === 1)) e.push("limits");
  if (!isObj(c.models)) e.push("models");
  else {
    const ref = isStageModelRef;
    for (const k of Object.keys(c.models)) if (!(STAGE_ROLES as readonly string[]).includes(k)) e.push(`models.${k}`);
    for (const k of STAGE_ROLES) {
      const m = c.models[k];
      if (!ref(m)) { e.push(`models.${k}`); continue; }
      const f = (m as Record<string, unknown>).fallback;
      if (f !== undefined && (!ref(f) || (isObj(f) && f.provider === (m as Record<string, unknown>).provider && f.model === (m as Record<string, unknown>).model))) {
        e.push(`models.${k}.fallback`);
      }
    }
  }
  if (!isObj(c.labels)) e.push("labels");
  else {
    const l = c.labels;
    const closed = (v: unknown, keys: readonly string[]) => isObj(v) && keys.every((k) => isStr(v[k], 120)) && Object.keys(v).length === keys.length;
    if (!closed(l.photo_roles, PHOTO_ROLES)) e.push("labels.photo_roles");
    if (!closed(l.frame_types, FRAME_TYPES)) e.push("labels.frame_types");
    if (!closed(l.fidelity_modes, FIDELITY_MODES)) e.push("labels.fidelity_modes");
    if (!isStr(l.whole, 80) || !isStr(l.part, 80)) e.push("labels.whole_part");
    if (!isStr(l.pastel_guard, 400)) e.push("labels.pastel_guard");
  }
  if (e.length > 0) return { ok: false, errors: e.slice(0, 40) };
  return { ok: true, config: value as unknown as EngineConfig };
}

export function recipeById(config: EngineConfig, id: string | null | undefined): StyleRecipe {
  return config.recipes.find((r) => r.id === id) ?? config.recipes.find((r) => r.id === "base")!;
}

export function qcCategory(config: EngineConfig, id: string): QcCategory | null {
  return config.qc.categories.find((c) => c.id === id) ?? null;
}

/** The people row for an order of `shots` (rows cover 1..10 exactly once). */
export function peopleRow(config: EngineConfig, shots: number): PeopleRow {
  return config.people_table.find((r) => shots >= r.min_shots && shots <= r.max_shots) ?? config.people_table[0];
}

/** Internal API spend allowed for an order of `shots` (USD micros). */
export function orderBudget(config: EngineConfig, shots: number): number {
  return config.budget.base_usd_micros + shots * config.budget.per_shot_usd_micros;
}
