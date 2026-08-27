import type { FeatureManifest, SceneConcept, SessionInput } from "./types";

/**
 * SYSTEM STYLE BASELINE — the built-in commercial look of GrovBase.
 *
 * The seller never has to write the big advertising prompt: the wrapper is
 * baked in here and the scene-specific concept is inserted into it. The
 * baseline is a QUALITY intention (bright, fresh, contrasty, premium,
 * photographic), not a literal outdoor template — a kitchen appliance, a
 * bathroom fitting and a workshop tool each get lighting that belongs to
 * their own world. Style never touches the product; it only shapes the photo.
 */

export type StyleContext = "outdoor" | "interior" | "studio";

const OUTDOOR = /outdoor|garden|terrace|balcony|beach|park|street|forest|mountain|patio|yard|rooftop|poolside|camping|trail|driveway|dziedziniec|ogr[oó]d/i;
const STUDIO = /studio|seamless|backdrop|cyclorama|packshot|plain background|white background|podium|pedestal|infinity curve/i;

/** Where the photograph happens, read from the concept the engine designed. */
export function styleContext(c: Pick<SceneConcept, "environment" | "scene_description" | "scene_type">): StyleContext {
  const text = `${c.environment} ${c.scene_description}`;
  if (STUDIO.test(text) || c.scene_type === "premium_packshot") return "studio";
  if (OUTDOOR.test(text)) return "outdoor";
  return "interior";
}

/** Lighting language that fits the scene instead of forcing blue sky on a
 *  bathroom shelf. Each option keeps the same intent: bright, clean, contrasty,
 *  physically real. */
const BASE_LIGHT: Record<StyleContext, string> = {
  outdoor:
    "Bright natural daylight with a clear directional key, crisp but controlled shadows and clean specular highlights on the product.",
  interior:
    "Bright, fresh interior light — a large natural window key with soft fill, gentle falloff, clean controlled shadows and realistic highlights on the product surfaces.",
  studio:
    "High-end commercial studio lighting — large soft key with a subtle rim separating the product from the background, clean gradient falloff and a realistic contact shadow.",
};

/** The always-on quality intention appended to every generated prompt. */
export const STYLE_BASELINE = [
  "Professional advertising photography for a premium e-commerce listing.",
  "Clean, premium and realistic: bright, fresh and contrasty like high-end commercial product photography.",
  "Colors read clean, vivid and true to the references; materials read as real materials with real reflections and real micro-texture.",
  "The environment looks polished, high-end and believable — never staged clip-art, never a cheap CGI set.",
  "Ultra realistic, sharp focus on the product, photographic depth of field, no illustration or 3D-render look.",
  "No text overlays, no badges, no icons, no infographic elements, no collage unless explicitly requested.",
].join(" ");

/** Lighting for this concept: the scene's own lighting idea, grounded in the
 *  baseline that matches where the scene actually takes place. */
export function styleLighting(c: SceneConcept): string {
  return `${c.lighting.trim().replace(/[.]$/, "")}. ${BASE_LIGHT[styleContext(c)]}`;
}

/**
 * Camera language. The concept supplies distance and angle; the baseline adds
 * the lens feel and depth of field that make a commercial photograph read as
 * photography — while keeping the whole product sharp, because a blurred
 * product cannot be verified against the references.
 */
const LENS: Record<SceneConcept["camera_distance"], string> = {
  wide: "wide-to-normal lens perspective (28-35 mm equivalent), deep enough focus to keep the whole product sharp",
  medium: "normal lens perspective (50 mm equivalent), natural proportions, product fully sharp with a gently softened background",
  close: "short telephoto perspective (85 mm equivalent), shallow but controlled depth of field with the entire product in focus",
  macro: "macro perspective with true close-focus detail, the referenced surface fully sharp, background falling off softly",
};

export function styleCamera(c: SceneConcept): string {
  return [
    `Camera distance: ${c.camera_distance}. ${c.camera_angle.trim().replace(/[.]$/, "")}.`,
    `${LENS[c.camera_distance] ?? LENS.medium}.`,
    "No perspective distortion of the product, no fisheye, no tilted horizon unless the concept asks for it.",
  ].join(" ");
}

/**
 * The seller's own style note wins over the baseline wording for MOOD only —
 * it can never relax product fidelity, so it is inserted as a styling
 * preference, not as a licence to restyle the product.
 */
export function styleFinalQuality(session: SessionInput, manifest: FeatureManifest): string {
  const lines = [
    STYLE_BASELINE,
    `The photograph must be instantly recognisable as ${manifest.identity} exactly as shown in the references.`,
    "Product fidelity outranks scene beauty: if a styling idea would alter the product, change the styling and keep the product.",
  ];
  if (session.style?.trim()) {
    lines.push(`Seller styling preference (applies to scene, mood and colour grade only, never to the product): ${session.style.trim()}.`);
  }
  return lines.join(" ");
}
