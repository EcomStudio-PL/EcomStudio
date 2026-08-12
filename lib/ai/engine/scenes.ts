import "server-only";
import { callVisionJson, type VisionCredential } from "./vision";
import {
  IMAGE_VIEWS, REFERENCE_ROLES, SCENE_TYPES,
  type FeatureManifest, type ImageAnalysis, type ImageView, type SceneConcept, type SessionInput,
} from "./types";

/**
 * SCENE STRATEGY + DIVERSITY ENGINE.
 * Picks 5 scene concepts FOR THIS SPECIFIC PRODUCT (a TV remote gets a
 * family-couch scene; a soldering iron gets a workbench macro — never the
 * same five for everything), assigns the primary + supporting references per
 * scene, and refuses angles the references cannot support (fidelity >
 * novelty: no rear hero shot when no rear photo exists).
 */

const SCENE_SCHEMA = {
  type: "OBJECT",
  properties: {
    concepts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          scene_type: { type: "STRING", enum: [...SCENE_TYPES] },
          title: { type: "STRING" },
          scene_description: { type: "STRING" },
          environment: { type: "STRING" },
          camera_distance: { type: "STRING", enum: ["wide", "medium", "close", "macro"] },
          camera_angle: { type: "STRING" },
          lighting: { type: "STRING" },
          human_presence: { type: "BOOLEAN" },
          human_interaction: { type: "STRING" },
          product_placement: { type: "STRING" },
          physical_contact: { type: "STRING" },
          product_orientation: { type: "STRING" },
          marketing_purpose: { type: "STRING" },
          required_views: { type: "ARRAY", items: { type: "STRING", enum: [...IMAGE_VIEWS] } },
          primary_reference: { type: "INTEGER" },
          supporting_references: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                image: { type: "INTEGER" },
                role: { type: "STRING", enum: [...REFERENCE_ROLES] },
                reason: { type: "STRING" },
              },
              required: ["image", "role", "reason"],
            },
          },
          product_specific_negatives: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: [
          "scene_type", "title", "scene_description", "environment", "camera_distance",
          "camera_angle", "lighting", "human_presence", "product_placement",
          "physical_contact", "product_orientation", "marketing_purpose",
          "required_views", "primary_reference", "supporting_references",
          "product_specific_negatives",
        ],
      },
    },
  },
  required: ["concepts"],
};

/** Views that the references genuinely support (full product, not scene-only). */
export function supportedViews(analyses: ImageAnalysis[]): ImageView[] {
  const views = new Set<ImageView>();
  for (const a of analyses) {
    if (a.scene_reference_only || a.product_quality === "poor") continue;
    views.add(a.view);
    // A three-quarter view carries front + one side information.
    if (a.view === "three_quarter") views.add("front");
  }
  return [...views];
}

/** A scene is renderable only when every view it needs is covered by the
 *  references (unsupported_angle_penalty — the model must not invent the
 *  unseen construction of the product). */
export function conceptSupported(c: SceneConcept, available: ImageView[]): boolean {
  const av = new Set<ImageView>(available);
  const sideOk = av.has("side") || av.has("left") || av.has("right") || av.has("three_quarter");
  for (const v of c.required_views) {
    if (v === "unknown" || v === "detail" || v === "macro") continue; // close-ups reuse any sharp view
    if ((v === "side" || v === "left" || v === "right") && sideOk) continue;
    if (!av.has(v)) return false;
  }
  return true;
}

/** DIVERSITY SCORE: two concepts are "the same photo" when scene type or the
 *  (distance, angle-ish, human, environment) tuple collide. */
export function diversityViolations(concepts: SceneConcept[]): number[] {
  const bad: number[] = [];
  for (let i = 0; i < concepts.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = concepts[i], b = concepts[j];
      if (a.scene_type === b.scene_type) { bad.push(i); break; }
      const sameShape =
        a.camera_distance === b.camera_distance &&
        a.human_presence === b.human_presence &&
        similarText(a.environment, b.environment);
      if (sameShape) { bad.push(i); break; }
    }
  }
  return bad;
}

function similarText(a: string, b: string): boolean {
  const wa = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const wb = new Set(b.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  if (wa.size === 0 || wb.size === 0) return false;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / Math.min(wa.size, wb.size) > 0.6;
}

function clampRefs(c: SceneConcept, imageCount: number, analyses: ImageAnalysis[]): SceneConcept {
  const usable = analyses.filter((a) => !a.scene_reference_only);
  const bestPrimary = [...usable].sort((x, y) => y.primary_candidate_score - x.primary_candidate_score)[0];
  let primary = Math.trunc(c.primary_reference);
  const primaryAnalysis = analyses.find((a) => a.image_number === primary);
  if (primary < 1 || primary > imageCount || primaryAnalysis?.scene_reference_only) {
    primary = bestPrimary?.image_number ?? 1;
  }
  // 2-4 references per scene: primary + up to 3 supporting, never scene-only
  // images as identity sources, never duplicates, never ALL images blindly.
  const supporting = (c.supporting_references ?? [])
    .filter((s) => {
      const n = Math.trunc(s.image);
      if (n < 1 || n > imageCount || n === primary) return false;
      const a = analyses.find((x) => x.image_number === n);
      return !(a?.scene_reference_only && s.role !== "SCENE_ONLY" && s.role !== "USAGE" && s.role !== "SCALE");
    })
    .slice(0, 3);

  // A single reference throws away fidelity information the user already
  // uploaded, so when another usable image exists the best remaining one is
  // attached with the role its own analysis reports.
  if (supporting.length === 0) {
    const extra = analyses
      .filter((a) => a.image_number !== primary && !a.scene_reference_only && a.product_quality !== "poor")
      .sort((x, y) => y.primary_candidate_score - x.primary_candidate_score)[0];
    if (extra) {
      const role = extra.roles.find((r) => r !== "MAIN_GEOMETRY" && r !== "SCENE_ONLY") ?? "COLOR";
      supporting.push({
        image: extra.image_number, role,
        reason: `additional verified view of the product (${extra.view.replace("_", " ")})`,
      });
    }
  }
  return { ...c, primary_reference: primary, supporting_references: supporting };
}

const SYSTEM = `You are the scene-strategy engine of a product photography platform.
You design 5 DISTINCT professional e-commerce photo concepts for one specific product.

THE SCENE IS CREATIVE. THE PRODUCT IS NOT.
You may design environment, light, composition, perspective, mood, humans and presentation.
You never redesign the product.

Hard rules:
- Choose scenes that genuinely fit THIS product and its buyer — not a generic set.
- The 5 concepts must differ in scene type, camera distance/angle, environment, human presence, use case and marketing purpose. Never five variations of the same photograph.
- FIDELITY OVER NOVELTY: you receive the list of product views actually covered by the references. Never propose a scene that requires an uncovered view (e.g. no full rear shot without a rear reference). required_views must list the views each scene needs.
- References per scene: pick ONE primary_reference (the image that best defines geometry/identity for this scene) and only the 1-3 supporting references that add needed facts (controls, scale, material...). Do not use all images everywhere. Images marked scene-only may only inspire the scene or give scale — never define the product.
- physical_contact must describe REAL physics: full contact with the surface, exact grip, actual mounting — no floating products.
- If human_presence is true, human_interaction must describe the exact grip/pose (which hand, which fingers where), not "person holding product".
- product_specific_negatives: 2-5 short "do not ..." lines protecting THIS product's most fragile facts in THIS scene (e.g. "do not change the four green buttons", "do not add a third device").
- Write everything in English (prompts are consumed by image models).`;

export async function proposeScenes(
  cred: VisionCredential,
  images: { base64: string; mime: string }[],
  analyses: ImageAnalysis[],
  manifest: FeatureManifest,
  info: SessionInput,
  opts?: { count?: number; avoidSceneTypes?: string[]; model?: string }
): Promise<SceneConcept[]> {
  const count = opts?.count ?? 5;
  const available = supportedViews(analyses);
  const user = [
    `Product: ${info.productName}`,
    `Feature manifest (verified facts): ${JSON.stringify(manifest)}`,
    `Per-image analysis: ${JSON.stringify(analyses.map(({ image_number, view, roles, scene_reference_only, primary_candidate_score, critical_features }) => ({ image_number, view, roles, scene_reference_only, primary_candidate_score, critical_features })))}`,
    `Views covered by the references: ${available.join(", ") || "none"}. Scenes must not require any other view of the product.`,
    info.style ? `Preferred style from the seller: ${info.style}` : "",
    opts?.avoidSceneTypes?.length ? `Do NOT use these scene types (already used): ${opts.avoidSceneTypes.join(", ")}` : "",
    `Output aspect ratio: ${info.aspectRatio}.`,
    `Design exactly ${count} clearly different concept${count === 1 ? "" : "s"}.`,
  ].filter(Boolean).join("\n\n");

  const out = await callVisionJson<{ concepts: SceneConcept[] }>({
    cred, images, system: SYSTEM, user, schema: SCENE_SCHEMA, model: opts?.model,
  });

  let concepts = (out.concepts ?? []).map((c) => clampRefs(c, images.length, analyses));

  // UNSUPPORTED ANGLE PROTECTION (server-side backstop)
  concepts = concepts.filter((c) => conceptSupported(c, available));

  // DIVERSITY backstop: drop colliding concepts (the weaker/later one).
  const bad = new Set(diversityViolations(concepts));
  concepts = concepts.filter((_, i) => !bad.has(i));

  return concepts.slice(0, count);
}
