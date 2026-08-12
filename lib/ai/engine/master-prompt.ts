import { renderProductLock } from "./lock";
import type {
  FeatureManifest, ImageAnalysis, LockStrength, ProductLock, SceneConcept, SessionInput,
} from "./types";

/**
 * MASTER PROMPT ASSEMBLY — provider-neutral, deterministic and ordered so
 * the product facts always precede the decorative scene description. Every
 * sentence has a function; no keyword spam. Model adapters may later trim or
 * reformat, but never touch the Product Lock, identity or critical features.
 */

const ROLE_LABEL: Record<string, string> = {
  PRIMARY_GEOMETRY: "main geometry and identity",
  MAIN_GEOMETRY: "main geometry and identity",
  FRONT_DETAIL: "front panel details",
  SIDE_PROFILE: "side profile",
  REAR_DETAIL: "rear details",
  BACK_DETAIL: "rear details",
  MATERIAL: "materials and finish",
  BUTTON_LAYOUT: "button layout",
  PORT_LAYOUT: "port layout",
  BRANDING: "branding placement",
  DIMENSIONS: "declared dimensions",
  SCALE: "true physical scale",
  ACCESSORIES: "included accessories",
  USAGE: "how the product is used",
  COLOR: "exact colors",
  MECHANISM: "mechanism construction",
  SCENE_ONLY: "scene inspiration only (not a product source)",
};

export function referenceRoleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role.toLowerCase().replace(/_/g, " ");
}

export function assembleMasterPrompt(input: {
  concept: SceneConcept;
  manifest: FeatureManifest;
  lock: ProductLock;
  strength: LockStrength;
  session: SessionInput;
  imageCount: number;
}): string {
  const { concept: c, manifest: m, lock, strength, session } = input;
  const refNumbers = [c.primary_reference, ...c.supporting_references.map((s) => s.image)];

  const sections: string[] = [];

  sections.push(`TASK:\nCreate one professional e-commerce product photograph: ${c.title}. Purpose: ${c.marketing_purpose}.`);
  sections.push(`FORMAT:\nAspect ratio ${session.aspectRatio}. Photorealistic commercial photography.`);
  sections.push(`REFERENCE IMAGES:\nUse ONLY reference image${refNumbers.length === 1 ? "" : "s"} ${refNumbers.join(", ")} as the product source.`);
  sections.push(`PRIMARY REFERENCE:\nImage ${c.primary_reference} defines the product's geometry, proportions and identity.`);
  if (c.supporting_references.length) {
    sections.push(`SUPPORTING REFERENCES:\n${c.supporting_references.map((s) => `Image ${s.image} — ${referenceRoleLabel(s.role)}: ${s.reason}`).join("\n")}`);
  }
  sections.push(`REFERENCE PRIORITY:\nWhen references disagree, the primary reference wins for shape and identity; supporting references win only for their stated role.`);
  sections.push(renderProductLock(lock, strength));
  if (m.critical_features.length) {
    sections.push(`CRITICAL FEATURES:\n${m.critical_features.map((f) => `- ${f}`).join("\n")}`);
  }
  sections.push(`SCENE:\n${c.scene_description}\nEnvironment: ${c.environment}.`);
  sections.push(`PRODUCT PLACEMENT:\n${c.product_placement} Orientation: ${c.product_orientation}.`);
  sections.push(`PHYSICAL CONTACT:\n${c.physical_contact} Realistic contact shadows, correct perspective and reflections; the product never floats and never intersects other objects.`);
  sections.push(`COMPOSITION:\nCamera distance: ${c.camera_distance}. ${c.camera_angle}`);
  sections.push(`CAMERA:\nProfessional commercial photography look, sharp focus on the product, natural depth of field.`);
  sections.push(`LIGHTING:\n${c.lighting}`);
  if (c.human_presence) {
    sections.push(`HUMAN REALISM:\n${c.human_interaction ?? "A person interacts with the product naturally."}\nTrue photorealistic human: natural skin texture with visible pores and subtle imperfections, realistic hair strands, correct anatomy, correct hands with five fingers per visible hand, realistic nails, natural joints. No fused fingers, no duplicated limbs, no plastic or mannequin skin, no hand/product intersections.`);
  }
  sections.push(`REALISM:\nTrue-to-life photography: physically correct light, shadows and materials. No 3D-render or illustration look.`);
  sections.push(`FINAL QUALITY:\nCrisp commercial-grade output ready for a marketplace listing. The product must be instantly recognisable as the exact referenced item.`);

  return sections.join("\n\n");
}

/**
 * NEGATIVE PROMPT ENGINE — GLOBAL + CONDITIONAL + PRODUCT-SPECIFIC, ranked so
 * the most fragile product facts come first and the list stays short.
 */
const GLOBAL_NEGATIVES = [
  "different product than the references",
  "redesigned, simplified or 'improved' product",
  "wrong colors or wrong proportions",
  "invented text, invented logos, watermarks",
  "cartoon, illustration or 3D-render look",
];

const CONTACT_NEGATIVES = [
  "floating or levitating product",
  "missing contact shadow",
  "impossible intersections with surfaces or objects",
];

const HUMAN_NEGATIVES = [
  "deformed or fused fingers",
  "extra or missing fingers",
  "duplicated or missing limbs",
  "broken anatomy",
  "plastic doll-like skin or mannequin look",
  "hand clipping through the product",
];

export function assembleNegativePrompt(c: SceneConcept, m: FeatureManifest, lock?: ProductLock): string {
  const i = m.interfaces;
  // Counts the model is most likely to drift on, stated as explicit bans.
  const numeric: string[] = [];
  if (i.buttons > 0) numeric.push(`any number of buttons other than ${i.buttons}`);
  if (i.ports > 0) numeric.push(`any number of ports other than ${i.ports}`);
  if (i.screens > 0) numeric.push(`any number of screens other than ${i.screens}`);
  if (m.accessories.length) numeric.push("missing, added or duplicated accessories");
  if (m.branding.logos.length || m.branding.text.length) numeric.push("changed, moved or invented branding");

  const productSpecific = [
    ...c.product_specific_negatives,
    ...(m.quantity > 1
      ? [`showing more or fewer than ${m.quantity} product units`]
      : ["duplicating the product"]),
    ...numeric,
    // A detected variant conflict is the likeliest way to get a wrong product.
    ...(lock?.conflicts ?? []).map((x) => `blending reference variants — render only ${x.resolution}`),
  ];
  const lines = [
    ...productSpecific,                       // 1. product facts first
    ...CONTACT_NEGATIVES,                     // 2. physics of this scene
    ...(c.human_presence ? HUMAN_NEGATIVES : []), // 3. human errors when relevant
    ...GLOBAL_NEGATIVES,                      // 4. global safety net
  ];
  // Dedupe, keep it tight — priority order guarantees the important ones stay.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lines) {
    const key = l.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(l.trim().replace(/[;.]+$/, ""));
    if (out.length >= 18) break;
  }
  // Semicolons separate entries so entries may contain commas themselves.
  return out.join("; ");
}

/** Human-readable per-reference rationale for the prompt card UI. */
export function referenceRationale(c: SceneConcept, analyses: ImageAnalysis[]): { image: number; label: string }[] {
  const primary = analyses.find((a) => a.image_number === c.primary_reference);
  const rows = [{
    image: c.primary_reference,
    label: primary ? `${referenceRoleLabel("PRIMARY_GEOMETRY")} (${primary.view.replace("_", " ")})` : referenceRoleLabel("PRIMARY_GEOMETRY"),
  }];
  for (const s of c.supporting_references) rows.push({ image: s.image, label: referenceRoleLabel(s.role) });
  return rows;
}
