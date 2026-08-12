import type {
  FeatureManifest, ImageAnalysis, LockStrength, ProductLock, ReferenceConflict, SceneConcept,
} from "./types";

/**
 * PRODUCT LOCK V3 — the core quality mechanism of EcomStudio.
 *
 * The lock exists as structured data (stored on the session, auditable) AND is
 * rendered into every master prompt. Creativity belongs to the scene; the
 * product is an already-manufactured physical object that is never redesigned.
 *
 * V2 added reference-conflict detection, explicit numeric constraints and a
 * fidelity-first strength ladder. V3 groups the constraints the way the
 * product actually exists — identity, geometry, interfaces, branding,
 * accessories, scale — states them as verifiable facts, promotes confident
 * dimensions and branding placement to HARD, and derives the per-scene
 * "critical details to preserve" list that rides in its own prompt section.
 */

/** Normalised colour word, so "matte black" and "Black" compare equal. */
function colorKey(value: string): string {
  return value.toLowerCase()
    .replace(/\b(matte|matt|glossy|gloss|satin|metallic|dark|light|deep|soft|pure)\b/g, "")
    .replace(/[^a-ząćęłńóśźż ]/g, " ")
    .trim().split(/\s+/).slice(-1)[0] ?? "";
}

/**
 * REFERENCE CONFLICTS: two photos may show different variants of the same
 * listing (a black unit and a blue one, four buttons and six). Merging them
 * produces a product that does not exist, so disagreements are detected,
 * resolved in favour of the best primary-candidate image, and written into the
 * prompt as an explicit instruction.
 */
export function detectReferenceConflicts(
  analyses: ImageAnalysis[], manifest: FeatureManifest
): ReferenceConflict[] {
  const conflicts: ReferenceConflict[] = [];
  const usable = analyses.filter((a) => !a.scene_reference_only && a.product_quality !== "poor");
  if (usable.length < 2) return conflicts;

  const authoritative = [...usable].sort((a, b) => b.primary_candidate_score - a.primary_candidate_score)[0];

  // Colour variants
  const byColor = new Map<string, number[]>();
  for (const a of usable) {
    const key = colorKey(a.observed_color ?? "");
    if (!key) continue;
    byColor.set(key, [...(byColor.get(key) ?? []), a.image_number]);
  }
  if (byColor.size > 1) {
    conflicts.push({
      kind: "color",
      detail: `references disagree on colour: ${[...byColor.entries()].map(([c, imgs]) => `${c} (image ${imgs.join(", ")})`).join(" vs ")}`,
      images: usable.map((a) => a.image_number),
      resolution: `${manifest.primary_color} — the colour of image ${authoritative.image_number}`,
    });
  }

  // Button-count variants
  const counts = new Map<number, number[]>();
  for (const a of usable) {
    if (!Number.isFinite(a.observed_button_count) || a.observed_button_count <= 0) continue;
    if (!a.full_product && a.view !== "detail" && a.view !== "macro") continue;
    counts.set(a.observed_button_count, [...(counts.get(a.observed_button_count) ?? []), a.image_number]);
  }
  if (counts.size > 1) {
    conflicts.push({
      kind: "buttons",
      detail: `references disagree on the number of buttons: ${[...counts.entries()].map(([n, imgs]) => `${n} (image ${imgs.join(", ")})`).join(" vs ")}`,
      images: usable.map((a) => a.image_number),
      resolution: `exactly ${manifest.interfaces.buttons} button${manifest.interfaces.buttons === 1 ? "" : "s"}`,
    });
  }

  // Unit-count variants (single unit photographed next to a multipack shot)
  const units = new Map<number, number[]>();
  for (const a of usable) {
    if (!a.full_product || a.product_count <= 0) continue;
    units.set(a.product_count, [...(units.get(a.product_count) ?? []), a.image_number]);
  }
  if (units.size > 1) {
    conflicts.push({
      kind: "quantity",
      detail: `references show different unit counts: ${[...units.entries()].map(([n, imgs]) => `${n} (image ${imgs.join(", ")})`).join(" vs ")}`,
      images: usable.map((a) => a.image_number),
      resolution: `exactly ${manifest.quantity} unit${manifest.quantity === 1 ? "" : "s"} in the sold set`,
    });
  }

  // Explicit revision/variant hints from the analysis
  const hints = new Map<string, number[]>();
  for (const a of usable) {
    const h = a.variant_hint?.trim().toLowerCase();
    if (!h || h === "none" || h === "n/a") continue;
    hints.set(h, [...(hints.get(h) ?? []), a.image_number]);
  }
  if (hints.size > 1) {
    conflicts.push({
      kind: "variant",
      detail: `references may show different product versions: ${[...hints.entries()].map(([h, imgs]) => `${h} (image ${imgs.join(", ")})`).join(" vs ")}`,
      images: usable.map((a) => a.image_number),
      resolution: `${manifest.variant ?? manifest.identity} — the version shown in image ${authoritative.image_number}`,
    });
  }

  return conflicts;
}

export function buildProductLock(m: FeatureManifest, analyses: ImageAnalysis[] = []): ProductLock {
  const hard: string[] = [];
  const strong: string[] = [];
  const soft: string[] = [];

  // 1. IDENTITY — what the object IS. Everything else describes this object.
  hard.push(`Identity: ${m.identity}${m.variant ? ` (variant: ${m.variant})` : ""}. This exact manufactured item, not a similar product from the same category.`);
  hard.push(`Exact quantity: ${m.quantity} identical product unit${m.quantity === 1 ? "" : "s"} — never more, never fewer.`);
  hard.push(`Primary color: ${m.primary_color}${m.secondary_colors.length ? `; secondary colors: ${m.secondary_colors.join(", ")}` : ""}. Colors must match the references exactly — no recolouring, no "premium" finish swap, no colour grading applied to the product body.`);

  // 2. GEOMETRY — silhouette, proportions, structure.
  hard.push(`Silhouette and geometry: ${m.geometry.shape}; proportions: ${m.geometry.proportions}. Keep the width-to-height-to-depth relationship of the references — do not stretch, slim, round off or bulk up the body.`);
  if (m.geometry.major_components.length)
    hard.push(`Structural parts (all must appear, none added, none merged): ${m.geometry.major_components.join(", ")}.`);

  // 3. INTERFACES — the countable details a model drifts on first.
  const i = m.interfaces;
  const interfaceFacts: string[] = [];
  if (i.buttons > 0) interfaceFacts.push(`exactly ${i.buttons} button${i.buttons === 1 ? "" : "s"}${i.buttons_detail ? ` (${i.buttons_detail})` : ""}`);
  if (i.switches > 0) interfaceFacts.push(`exactly ${i.switches} switch${i.switches === 1 ? "" : "es"}`);
  if (i.ports > 0) interfaceFacts.push(`exactly ${i.ports} port${i.ports === 1 ? "" : "s"}${i.ports_detail ? ` (${i.ports_detail})` : ""}`);
  if (i.sockets > 0) interfaceFacts.push(`exactly ${i.sockets} socket${i.sockets === 1 ? "" : "s"}`);
  if (i.screens > 0) interfaceFacts.push(`exactly ${i.screens} screen${i.screens === 1 ? "" : "s"}`);
  if (i.leds > 0) interfaceFacts.push(`exactly ${i.leds} LED indicator${i.leds === 1 ? "" : "s"}`);
  if (interfaceFacts.length)
    hard.push(`Controls and connections — keep count AND placement exactly as referenced: ${interfaceFacts.join("; ")}. Never add, remove, resize, restyle or relocate any of them, and never invent a screen layout that is not in the references.`);
  if (i.labels.length) hard.push(`Labels/markings that must stay unchanged and legible: ${i.labels.join(", ")}.`);

  // 4. BRANDING — visible marks stay; nothing new is ever invented.
  if (m.branding.logos.length || m.branding.text.length) {
    hard.push(`Branding stays exactly as in the references: ${[...m.branding.logos, ...m.branding.text].join(", ")}${m.branding.position ? `, positioned at ${m.branding.position}` : ""}. Never invent, translate, move, mirror, resize or restyle branding, and never add a second logo.`);
  } else {
    hard.push("The product carries no visible branding in the references — do not invent any logo, brand name, model number or product text on it.");
  }
  for (const f of m.critical_features) hard.push(f);

  // 5. ACCESSORIES — a set is defined by its exact contents.
  if (m.accessories.length) {
    hard.push(`Included accessories — exact set: ${m.accessories.map((a) => `${a.count}× ${a.name}${a.color ? ` (${a.color})` : ""}`).join(", ")}. No accessory may be added, removed, duplicated or recoloured; each keeps the placement logic of the references.`);
  }

  // 6. SCALE — a confidently known size is a hard fact, an inferred one is not.
  if (m.scale.dimensions) {
    const line = `True physical size: ${m.scale.dimensions}${m.scale.scale_reference ? ` (scale reference: ${m.scale.scale_reference})` : ""}. Keep believable real-world scale against every other object in frame.`;
    if (m.scale.confidence === "high") hard.push(line); else strong.push(line);
  }

  if (m.materials.length) strong.push(`Materials and finish: ${m.materials.join(", ")}. Real material behaviour — matte stays matte, gloss stays gloss.`);
  if (m.geometry.profile) strong.push(`Side profile / thickness: ${m.geometry.profile}.`);
  if (m.geometry.curvature) strong.push(`Curvature: ${m.geometry.curvature}.`);

  soft.push("Minor surface micro-texture and reflections may follow the scene lighting as long as identity, colour and geometry are untouched.");

  return { hard, strong, soft, conflicts: detectReferenceConflicts(analyses, m) };
}

/**
 * CRITICAL DETAILS TO PRESERVE — the short, scene-aware shortlist that gets
 * its own prompt section right after the lock. The full lock states every
 * fact; this list re-states the handful most at risk in THIS photograph
 * (what the camera will actually see up close), because a model follows a
 * focused list far better than a long one.
 */
export function criticalDetails(
  m: FeatureManifest,
  scene: Pick<SceneConcept, "camera_distance" | "human_presence" | "scene_type">
): string[] {
  const out: string[] = [];
  const i = m.interfaces;
  const closeUp = scene.camera_distance === "close" || scene.camera_distance === "macro";

  if (i.buttons > 0) out.push(`${i.buttons} button${i.buttons === 1 ? "" : "s"}${i.buttons_detail ? ` — ${i.buttons_detail}` : ""}, same count, same layout, same size`);
  if (i.ports > 0) out.push(`${i.ports} port${i.ports === 1 ? "" : "s"}${i.ports_detail ? ` — ${i.ports_detail}` : ""}, same count and same position`);
  if (i.screens > 0) out.push(`${i.screens} screen${i.screens === 1 ? "" : "s"} with the referenced shape and bezel — no invented interface graphics`);
  if (i.leds > 0) out.push(`${i.leds} LED indicator${i.leds === 1 ? "" : "s"} in the referenced position`);
  if (i.switches > 0) out.push(`${i.switches} switch${i.switches === 1 ? "" : "es"} unchanged`);
  if (m.branding.logos.length || m.branding.text.length)
    out.push(`branding "${[...m.branding.logos, ...m.branding.text].join('", "')}"${m.branding.position ? ` at ${m.branding.position}` : ""} — identical wording, identical placement`);
  if (i.labels.length) out.push(`printed markings: ${i.labels.join(", ")} — legible and unchanged`);
  if (m.quantity > 1) out.push(`${m.quantity} identical units visible together`);
  if (m.accessories.length)
    out.push(`accessories exactly as sold: ${m.accessories.map((a) => `${a.count}× ${a.name}`).join(", ")}`);
  out.push(`${m.primary_color} body colour${m.secondary_colors.length ? ` with ${m.secondary_colors.join(" / ")} accents` : ""}`);
  if (closeUp && m.materials.length) out.push(`true material rendering at close range: ${m.materials.join(", ")}`);
  if (scene.human_presence && m.scale.dimensions) out.push(`real size (${m.scale.dimensions}) — correct proportion against the person`);
  for (const f of m.critical_features) out.push(f);

  const seen = new Set<string>();
  return out.filter((l) => {
    const k = l.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 12);
}

/**
 * Fidelity-first strength ladder. Anything with countable controls, multiple
 * parts, an unusual body, a human hand or a known conflict goes MAXIMUM; a
 * plain packshot of a simple object is the only case that relaxes to LOW.
 */
export function chooseLockStrength(
  scene: Pick<SceneConcept, "scene_type" | "human_presence" | "physical_contact">,
  m: FeatureManifest,
  conflicts: ReferenceConflict[] = []
): LockStrength {
  const i = m.interfaces;
  const controlCount = i.buttons + i.switches + i.ports + i.sockets + i.screens;
  const denseInterfaces = controlCount >= 4;
  const anyInterface = controlCount > 0 || i.leds > 0;
  const complexSet = m.quantity > 1 || m.accessories.reduce((s, a) => s + a.count, 0) >= 3;
  const mechanical = m.geometry.major_components.length >= 4;
  const branded = m.branding.logos.length > 0 || m.branding.text.length > 0;
  const inHand = scene.human_presence && /hand|held|grip|finger|palm|holding|wear/i.test(scene.physical_contact);

  // A disagreement between references is the single biggest fidelity risk.
  if (conflicts.length > 0) return "MAXIMUM";
  if (denseInterfaces || complexSet || mechanical || inHand) return "MAXIMUM";
  if (scene.human_presence || anyInterface) return "HIGH";
  const plainPackshot =
    scene.scene_type === "premium_packshot" || scene.scene_type === "product_hero" ||
    scene.scene_type === "marketplace_hero";
  if (plainPackshot && !branded && m.critical_features.length === 0) return "MEDIUM";
  return "HIGH";
}

const STRENGTH_PREAMBLE: Record<LockStrength, string> = {
  LOW: "Reproduce the product faithfully from the references.",
  MEDIUM: "Reproduce the product faithfully from the references; the listed facts are binding.",
  HIGH: "Reproduce the product with strict fidelity — every listed fact is binding and verifiable against the references.",
  MAXIMUM: "ABSOLUTE product fidelity. Every listed fact is a hard constraint; when a scene idea conflicts with product fidelity, fidelity wins and the scene changes.",
};

/** Render the structured lock into the PRODUCT LOCK prompt section. */
export function renderProductLock(lock: ProductLock, strength: LockStrength): string {
  const lines: string[] = [
    `PRODUCT LOCK — EXACT PRODUCT PRESERVATION (${strength}):`,
    "Treat the referenced product as an already manufactured physical object that exists and is being photographed.",
    "Do not redesign it. Do not reinterpret it. Do not simplify it. Do not improve it. Do not modernise it.",
    "Do not replace it with a similar product from the same category. Do not create a better-looking variant.",
    "Do not combine conflicting variants from different references into one hybrid object.",
    STRENGTH_PREAMBLE[strength],
    "Preserve exact identity, geometry, proportions, silhouette, dimensions, visible structure, colors, materials, component count, component placement, buttons, ports, panels, labels, branding and accessories.",
    "Adapt the environment to the product. Never adapt the product to the environment.",
    "",
    "Non-negotiable product facts (HARD LOCK):",
    ...lock.hard.map((l) => `- ${l}`),
  ];
  if (lock.strong.length) {
    lines.push("", "Strict product facts (STRONG LOCK):", ...lock.strong.map((l) => `- ${l}`));
  }
  if (lock.conflicts.length) {
    lines.push("", "REFERENCE CONFLICTS — the references are not identical. Never blend them:",
      ...lock.conflicts.map((c) => `- ${c.detail}. Render ONLY: ${c.resolution}.`));
  }
  if ((strength === "LOW" || strength === "MEDIUM") && lock.soft.length) {
    lines.push("", "Soft context:", ...lock.soft.map((l) => `- ${l}`));
  }
  return lines.join("\n");
}
