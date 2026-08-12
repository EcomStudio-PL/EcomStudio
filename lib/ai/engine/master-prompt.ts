import { criticalDetails, renderProductLock } from "./lock";
import { styleCamera, styleFinalQuality, styleLighting } from "./style";
import type {
  FeatureManifest, ImageAnalysis, LockStrength, ProductLock, SceneConcept, SessionInput,
} from "./types";

/**
 * MASTER PROMPT ASSEMBLY — the built-in commercial wrapper of EcomStudio.
 *
 * The seller writes nothing: the engine assembles a full advertising prompt
 * around the scene concept it designed. The section ORDER is mandatory and
 * deterministic — product truth (references, priority, lock, critical
 * details) always precedes anything decorative, because whatever the model
 * reads first is what it treats as the subject. Scene, camera, light and mood
 * follow; the negative constraints and the quality floor close it.
 */

const ROLE_LABEL: Record<string, string> = {
  PRIMARY_GEOMETRY: "source of truth for product geometry, identity and proportions",
  PRIMARY_REFERENCE: "source of truth for product geometry, identity and proportions",
  MAIN_GEOMETRY: "source of truth for product geometry, identity and proportions",
  FRONT_DETAIL: "front panel details",
  SIDE_PROFILE: "side profile and thickness",
  REAR_DETAIL: "rear construction details",
  BACK_DETAIL: "rear construction details",
  MATERIAL: "materials and finish",
  BUTTON_LAYOUT: "button layout and count",
  PORT_LAYOUT: "port and socket layout",
  BRANDING: "branding wording and placement",
  DIMENSIONS: "declared dimensions",
  SCALE: "true physical scale",
  ACCESSORIES: "included accessories and their count",
  USAGE: "how the product is used and held",
  COLOR: "exact colors",
  MECHANISM: "mechanism construction",
  SCENE_ONLY: "scene inspiration only — never a product source",
};

export function referenceRoleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role.toLowerCase().replace(/_/g, " ");
}

/** Compact role label for the prompt cards, where the full prompt-side
 *  sentence would not fit. */
const ROLE_SHORT: Record<string, string> = {
  PRIMARY_GEOMETRY: "geometry & identity",
  PRIMARY_REFERENCE: "geometry & identity",
  MAIN_GEOMETRY: "geometry & identity",
  FRONT_DETAIL: "front details",
  SIDE_PROFILE: "side profile",
  REAR_DETAIL: "rear details",
  BACK_DETAIL: "rear details",
  MATERIAL: "materials",
  BUTTON_LAYOUT: "buttons",
  PORT_LAYOUT: "ports",
  BRANDING: "branding",
  DIMENSIONS: "dimensions",
  SCALE: "scale",
  ACCESSORIES: "accessories",
  USAGE: "usage",
  COLOR: "colors",
  MECHANISM: "mechanism",
  SCENE_ONLY: "scene only",
};

export function referenceRoleShort(role: string): string {
  return ROLE_SHORT[role] ?? role.toLowerCase().replace(/_/g, " ");
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
  const sections: string[] = [];

  // 1. TASK
  sections.push(`TASK\nCreate one professional advertising photograph of: ${m.identity}${session.productName ? ` — "${session.productName}"` : ""}.\nConcept: ${c.title}. Marketing purpose: ${c.marketing_purpose}.`);

  // 2. FORMAT
  sections.push(`FORMAT\nAspect ratio ${session.aspectRatio}.\nOne single coherent photograph. No collage, no split frame, no multi-panel layout unless explicitly requested.`);

  // 3. REFERENCE IMAGES — roles before anything scenic.
  const refLines = [
    `PRIMARY REFERENCE:\nImage ${c.primary_reference}\nRole: ${referenceRoleLabel("PRIMARY_GEOMETRY")}.`,
  ];
  if (c.supporting_references.length) {
    refLines.push(`SUPPORTING REFERENCES:\n${c.supporting_references
      .map((s) => `Image ${s.image}: ${referenceRoleLabel(s.role)} — ${s.reason}`)
      .join("\n")}`);
  }
  sections.push(`REFERENCE IMAGES\nThe attached reference photographs show the real product that must appear in this photograph.\n${refLines.join("\n\n")}`);

  // 4. REFERENCE PRIORITY
  sections.push(`REFERENCE PRIORITY\nProduct geometry, proportions and identity must follow the PRIMARY REFERENCE.\nSupporting references may only clarify the detail assigned to them; they never override the primary reference on shape or identity.\nScene-only references must not redefine the product.\nWhen references disagree, follow the primary reference and never merge two versions into one object.`);

  // 5. PRODUCT LOCK
  sections.push(renderProductLock(lock, strength));

  // 6. CRITICAL DETAILS TO PRESERVE — scene-aware shortlist.
  const critical = criticalDetails(m, c);
  if (critical.length) {
    sections.push(`CRITICAL DETAILS TO PRESERVE\n${critical.map((f) => `- ${f}`).join("\n")}`);
  }

  // 7. SCENE — the creative half starts only here.
  sections.push(`SCENE\n${c.scene_description}\nEnvironment: ${c.environment}.`);

  // 8. PRODUCT PLACEMENT & PHYSICAL CONTACT
  sections.push(`PRODUCT PLACEMENT & PHYSICAL CONTACT\n${c.product_placement}\nOrientation: ${c.product_orientation}.\n${c.physical_contact}\nThe product rests in real physical contact with what supports it: full contact with the surface, a correct contact shadow directly beneath it, correct occlusion where objects overlap. The product never floats, never hovers, never intersects another object, and is never cut by geometry that should be behind it.`);

  // 9. COMPOSITION
  sections.push(`COMPOSITION\nThe product is the unmistakable subject and the largest point of interest in frame; everything else supports it.\nCamera distance: ${c.camera_distance}. Framing keeps the whole product inside the frame with clean breathing room and no distracting clutter overlapping it.`);

  // 10. CAMERA
  sections.push(`CAMERA\n${styleCamera(c)}`);

  // 11. LIGHTING
  sections.push(`LIGHTING\n${styleLighting(c)}`);

  // 12. HUMAN REALISM
  if (c.human_presence) {
    sections.push(`HUMAN REALISM\n${c.human_interaction ?? "A person interacts with the product naturally."}\nTrue photorealistic human: natural skin texture with visible pores and subtle imperfections, realistic hair strands, correct anatomy and correct joints.\nHands: exactly five fingers on each visible hand, natural grip with realistic finger placement and realistic contact pressure, realistic nails, correct hand-to-product scale. Fingers wrap around the product surface and never pass through it, never fuse, and never duplicate.`);
  }

  // 13. REALISM
  sections.push(`REALISM\nPhysically correct light, shadows, reflections and perspective. Real materials behaving like real materials. Correct scale relationships between every object in frame. No floating objects, no impossible intersections, no 3D-render or illustration look.`);

  // 14. NEGATIVE CONSTRAINTS + FINAL QUALITY
  sections.push(`NEGATIVE CONSTRAINTS\nDo not produce any of the following: ${assembleNegativePrompt(c, m, lock)}.`);
  sections.push(`FINAL QUALITY REQUIREMENTS\n${styleFinalQuality(session, m)}\nUltra realistic commercial product photography, sharp product detail, realistic materials, photographic and not illustrative. No unnecessary text, icons, graphics or 3D overlays.`);

  return sections.join("\n\n");
}

/**
 * NEGATIVE PROMPT ENGINE — PRODUCT-SPECIFIC → CONDITIONAL → GLOBAL, ranked so
 * the most fragile product facts come first and survive any provider-side
 * truncation. Conditional groups switch on what the product and the scene
 * actually are (a human in frame, an interfaced device, a multi-item set).
 */
const GLOBAL_NEGATIVES = [
  "a different product than the references",
  "redesigned, restyled, simplified or 'improved' product",
  "deformed product, wrong proportions or wrong colors",
  "missing parts or invented parts",
  "duplicated product",
  "invented text, invented logos, random branding, watermarks",
  "collage, split frame, multiple panels",
  "graphic overlays, badges, icons, arrows, infographic elements",
  "cartoon, illustration or 3D-render look",
];

const CONTACT_NEGATIVES = [
  "floating or levitating product",
  "missing contact shadow",
  "impossible contact or intersections with surfaces and objects",
];

const HUMAN_NEGATIVES = [
  "extra fingers, missing fingers or fused fingers",
  "extra hands, duplicated or missing limbs",
  "bad anatomy, broken joints",
  "plastic doll-like skin or mannequin look",
  "hand clipping through or intersecting the product",
  "unnatural grip or wrong hand-to-product scale",
];

const DEVICE_NEGATIVES = [
  "invented buttons or removed buttons",
  "moved or restyled labels and markings",
  "wrong port count or rearranged ports",
  "invented screen layout or fake interface graphics",
];

const SET_NEGATIVES = [
  "missing accessories",
  "duplicated accessories",
  "accessories in the wrong color",
];

export function assembleNegativePrompt(c: SceneConcept, m: FeatureManifest, lock?: ProductLock): string {
  const i = m.interfaces;
  // Counts the model is most likely to drift on, stated as explicit bans.
  const numeric: string[] = [];
  if (i.buttons > 0) numeric.push(`any number of buttons other than ${i.buttons}`);
  if (i.ports > 0) numeric.push(`any number of ports other than ${i.ports}`);
  if (i.screens > 0) numeric.push(`any number of screens other than ${i.screens}`);
  if (i.leds > 0) numeric.push(`any number of indicator lights other than ${i.leds}`);
  if (m.branding.logos.length || m.branding.text.length) numeric.push("changed, moved, translated or invented branding");
  else numeric.push("any logo or brand text added to an unbranded product");

  const isDevice = i.buttons + i.ports + i.screens + i.sockets + i.switches + i.leds > 0;
  const isSet = m.quantity > 1 || m.accessories.length > 0;

  const productSpecific = [
    ...c.product_specific_negatives,
    ...(m.quantity > 1
      ? [`showing more or fewer than ${m.quantity} product units`]
      : ["duplicating the product"]),
    `a body colour other than ${m.primary_color}`,
    ...numeric,
    // A detected variant conflict is the likeliest way to get a wrong product.
    ...(lock?.conflicts ?? []).map((x) => `blending reference variants — render only ${x.resolution}`),
  ];
  const lines = [
    ...productSpecific,                            // 1. this product's facts
    ...(isDevice ? DEVICE_NEGATIVES : []),         // 2. interfaced-product errors
    ...(isSet && m.accessories.length ? SET_NEGATIVES : []), // 3. set integrity
    ...CONTACT_NEGATIVES,                          // 4. physics of this scene
    ...(c.human_presence ? HUMAN_NEGATIVES : []),  // 5. human errors when relevant
    ...GLOBAL_NEGATIVES,                           // 6. global safety net
  ];
  // Dedupe, keep it tight — priority order guarantees the important ones stay.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lines) {
    const key = l.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(l.trim().replace(/[;.]+$/, ""));
    if (out.length >= 26) break;
  }
  // Semicolons separate entries so entries may contain commas themselves.
  return out.join("; ");
}

/** Human-readable per-reference rationale for the prompt card UI. */
export function referenceRationale(c: SceneConcept, analyses: ImageAnalysis[]): { image: number; label: string }[] {
  const primary = analyses.find((a) => a.image_number === c.primary_reference);
  const rows = [{
    image: c.primary_reference,
    label: primary ? `primary reference (${primary.view.replace("_", " ")})` : "primary reference",
  }];
  for (const s of c.supporting_references) rows.push({ image: s.image, label: referenceRoleLabel(s.role) });
  return rows;
}
