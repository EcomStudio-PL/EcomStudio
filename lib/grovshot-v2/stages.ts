/**
 * GROVBASE SHOT V2 — STAGE KEYS, TEMPLATE LAYOUT AND OUTPUT CONTRACTS
 * (client-safe).
 *
 * Each AI stage is an admin-published template under its own tool key
 * (versioned in ai_tool_prompts like every prompt). The OUTPUT of a stage is
 * a code contract, not admin text: the JSON schema below is what the vision /
 * text layer asks the model for, and the stage modules normalise whatever
 * comes back against it. Nothing here is a prompt.
 *
 * TEMPLATE LAYOUT. A vision/text stage template has two sections split by
 * the marker line `### USER ###`: the SYSTEM section (the instruction) may
 * place only system values — config text and closed sets; the USER section
 * (the message the model receives as data) holds every value that came from
 * the customer or from a model. Customer text therefore never reaches a
 * model with system authority. The publish gate refuses any other layout.
 * The shot template (one image prompt) and the config (JSON) have no marker.
 */
import { FIDELITY_MODES, FRAME_TYPES, PEOPLE_MODES, PHOTO_ROLES, RECIPE_IDS, SHOT_PURPOSES } from "@/lib/grovshot-v2/config";

export const GROVSHOT_V2_KEYS = [
  "grovshot_v2_validate", "grovshot_v2_card", "grovshot_v2_plan",
  "grovshot_v2_shot", "grovshot_v2_qc", "grovshot_v2_config",
] as const;
export type GrovshotStageKey = (typeof GROVSHOT_V2_KEYS)[number];

/** The stages that are one model call with a system + user message. */
export const SPLIT_STAGE_KEYS: readonly GrovshotStageKey[] = ["grovshot_v2_validate", "grovshot_v2_card", "grovshot_v2_plan", "grovshot_v2_qc"];

export function isGrovshotV2Key(key: string): key is GrovshotStageKey {
  return (GROVSHOT_V2_KEYS as readonly string[]).includes(key);
}

/** The feature flag that routes a GrovShot lifestyle order to this engine. */
export const GROVSHOT_V2_FLAG = "grovshot_engine_v2";
/** Nano Banana Pro — the spec's generation model (and Retusz's). */
export const GROVSHOT_V2_MODEL_IDENTIFIER = "gemini-3-pro-image";
/** generation_jobs.settings.engine / usage metadata.operation of a V2 shot. */
export const GROVSHOT_V2_ENGINE = "grovshot_v2";

/** Why an order stopped for the customer's input, before anything was
 *  charged (the panel asks; a tile shows the message, never a retry). */
export const GROVSHOT_V2_STOP_CODES: ReadonlySet<string> = new Set(["needs_attention", "needs_dimensions", "blocked_input"]);

export const USER_MARKER = "### USER ###";

/** Split a stage template into its system and user sections (null = not
 *  exactly one marker line, or an empty section). */
export function splitStageTemplate(body: string): { system: string; user: string } | null {
  const lines = body.split(/\r?\n/);
  const at = lines.flatMap((l, i) => (l.trim() === USER_MARKER ? [i] : []));
  if (at.length !== 1) return null;
  const system = lines.slice(0, at[0]).join("\n").trim();
  const user = lines.slice(at[0] + 1).join("\n").trim();
  return system && user ? { system, user } : null;
}

/* ── schema helpers (Gemini OpenAPI subset; no `description` keys) ────────*/

const num = { type: "NUMBER" };
const int = { type: "INTEGER" };
const str = { type: "STRING" };
const bool = { type: "BOOLEAN" };
const strs = { type: "ARRAY", items: str };
const ints = { type: "ARRAY", items: int };
const en = (values: readonly string[]) => ({ type: "STRING", enum: [...values] });
const obj = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "OBJECT", properties, required });
const box = obj({ x: num, y: num, w: num, h: num });

/* ── Stage 0: the photos (no customer text reaches this call) ─────────────*/

export const PHOTO_ISSUES = [
  "blurry", "different_product", "other_variant", "stock_or_render", "cropped",
  "overlay", "warped_text_nearby", "reference_additions",
] as const;
export type PhotoIssueCode = (typeof PHOTO_ISSUES)[number];

export const VALIDATE_SCHEMA = obj({
  photos: {
    type: "ARRAY",
    items: obj({
      number: int,
      sharpness: num,
      same_product: bool,
      state: str,
      angle: str,
      issues: { type: "ARRAY", items: obj({ code: en(PHOTO_ISSUES), confidence: num, detail: str }) },
    }),
  },
  licensed_character: obj({ suspected: bool, confidence: num }),
  product_summary: str,
});

export type RawValidation = {
  photos?: { number?: number; sharpness?: number; same_product?: boolean; state?: string; angle?: string;
    issues?: { code?: string; confidence?: number; detail?: string }[] }[];
  licensed_character?: { suspected?: boolean; confidence?: number };
  product_summary?: string;
};

/* ── Stage 1: the product card (photos + the Allegro description) ─────────*/

export const FACT_SOURCES = ["description", "photo", "inference", "customer"] as const;
export type FactSource = (typeof FACT_SOURCES)[number];
export const DIMENSION_SOURCES = ["description", "customer", "estimate"] as const;
export type DimensionSource = (typeof DIMENSION_SOURCES)[number];

export const CARD_SCHEMA = obj({
  product: obj({ name: str, variant: str, category: str }),
  dimensions: obj({
    text: str, width_cm: num, height_cm: num, depth_cm: num, source: en(DIMENSION_SOURCES), confidence: num,
    in_description: bool, ambiguous: bool, scale_critical: bool,
  }),
  proportion: str,
  scale_anchors: strs,
  construction: strs,
  counts: { type: "ARRAY", items: obj({ element: str, count: int }) },
  colors: { type: "ARRAY", items: obj({ name: str, hex: str, pastel: bool }) },
  materials: strs,
  texts: strs,
  is_not: strs,
  states: { type: "ARRAY", items: obj({ id: str, label: str, photos: ints }) },
  angles_available: strs,
  angles_missing: strs,
  photo_roles: { type: "ARRAY", items: obj({ photo: int, role: en(PHOTO_ROLES), state: str, angle: str, whole: bool }) },
  color_sample: obj({ photo: int, x: num, y: num, w: num, h: num }),
  selling_points: { type: "ARRAY", items: obj({ id: str, text: str, has_action: bool }) },
  uses: { type: "ARRAY", items: obj({ use: str, place: str }) },
  audience: obj({ buyer: str, user: str, age: str }),
  honesty_limits: strs,
  season: obj({ seasonal: bool, season: str }),
  risks: strs,
  reference_additions: strs,
  handheld: bool,
  for_animals: bool,
  assembly: bool,
  interchangeable_parts: bool,
  waterproof: bool,
  licensed_character: obj({ suspected: bool, confidence: num }),
  recipe_id: en(RECIPE_IDS),
  conflicts: { type: "ARRAY", items: obj({ field: str, description_says: str, photos_show: str, confidence: num }) },
  facts: { type: "ARRAY", items: obj({ field: str, source: en(FACT_SOURCES), confidence: num }) },
});

/* ── Stage 2: the shot plan ───────────────────────────────────────────────*/

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const PLAN_SCHEMA = obj({
  shots: {
    type: "ARRAY",
    items: obj({
      title: str,
      summary: str,
      argument_id: str,
      argument: str,
      purpose: en(SHOT_PURPOSES),
      use: str,
      place: str,
      frame_type: en(FRAME_TYPES),
      camera: obj({ angle_deg: int, height: str, distance: str, lens_mm: int, placement: str }),
      fidelity_mode: en(FIDELITY_MODES),
      product_state: str,
      reference_photos: ints,
      people: en(PEOPLE_MODES),
      person: str,
      grip: str,
      moment: str,
      motion: str,
      vehicle_motion: bool,
      scenery: str,
      visible_units: int,
      risk: en(RISK_LEVELS),
      risks: strs,
      seasonal_motif: bool,
      user_row: int,
    }),
  },
});

/* ── Stage 4: quality control ─────────────────────────────────────────────*/

/** The QC schema names the categories the published config defines. */
export function qcSchema(categoryIds: readonly string[]): Record<string, unknown> {
  return obj({
    product_visible: bool,
    findings: { type: "ARRAY", items: obj({ category: en(categoryIds), confidence: num, kind: en(["random", "systematic"]), detail: str }) },
    correction: str,
    product_box: box,
  });
}

export type RawQc = {
  product_visible?: boolean;
  findings?: { category?: string; confidence?: number; kind?: string; detail?: string }[];
  correction?: string;
  product_box?: { x?: number; y?: number; w?: number; h?: number };
};
