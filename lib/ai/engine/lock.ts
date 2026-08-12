import type { FeatureManifest, LockStrength, ProductLock, SceneConcept } from "./types";

/**
 * PRODUCT LOCK ENGINE — the core quality mechanism of EcomStudio.
 * The lock exists as structured data (stored on the session) AND is rendered
 * into every master prompt. Creativity belongs to the scene; the product is
 * an already-manufactured physical object and is never redesigned.
 */

export function buildProductLock(m: FeatureManifest): ProductLock {
  const hard: string[] = [];
  const strong: string[] = [];
  const soft: string[] = [];

  hard.push(`Product identity: ${m.identity}${m.variant ? ` (variant: ${m.variant})` : ""}.`);
  hard.push(`Exact quantity: ${m.quantity} identical product unit${m.quantity === 1 ? "" : "s"} — never more, never fewer.`);
  hard.push(`Primary color: ${m.primary_color}${m.secondary_colors.length ? `; secondary colors: ${m.secondary_colors.join(", ")}` : ""}. Colors must match the references exactly.`);
  hard.push(`Geometry: ${m.geometry.shape}; proportions: ${m.geometry.proportions}.`);
  if (m.geometry.major_components.length)
    hard.push(`Major components (all must appear, none added): ${m.geometry.major_components.join(", ")}.`);

  const i = m.interfaces;
  const interfaceFacts: string[] = [];
  if (i.buttons > 0) interfaceFacts.push(`exactly ${i.buttons} button${i.buttons === 1 ? "" : "s"}${i.buttons_detail ? ` (${i.buttons_detail})` : ""}`);
  if (i.switches > 0) interfaceFacts.push(`${i.switches} switch${i.switches === 1 ? "" : "es"}`);
  if (i.ports > 0) interfaceFacts.push(`${i.ports} port${i.ports === 1 ? "" : "s"}${i.ports_detail ? ` (${i.ports_detail})` : ""}`);
  if (i.sockets > 0) interfaceFacts.push(`${i.sockets} socket${i.sockets === 1 ? "" : "s"}`);
  if (i.screens > 0) interfaceFacts.push(`${i.screens} screen${i.screens === 1 ? "" : "s"}`);
  if (i.leds > 0) interfaceFacts.push(`${i.leds} LED indicator${i.leds === 1 ? "" : "s"}`);
  if (interfaceFacts.length)
    hard.push(`Controls and connections — keep count and placement exactly: ${interfaceFacts.join("; ")}.`);
  if (i.labels.length) hard.push(`Labels/markings that must stay unchanged and legible: ${i.labels.join(", ")}.`);

  if (m.branding.logos.length || m.branding.text.length) {
    hard.push(`Branding stays exactly as in the references: ${[...m.branding.logos, ...m.branding.text].join(", ")}${m.branding.position ? ` at ${m.branding.position}` : ""}. Never invent, move or restyle branding.`);
  }
  for (const f of m.critical_features) hard.push(f);

  if (m.materials.length) strong.push(`Materials and finish: ${m.materials.join(", ")}.`);
  if (m.geometry.profile) strong.push(`Profile: ${m.geometry.profile}.`);
  if (m.geometry.curvature) strong.push(`Curvature: ${m.geometry.curvature}.`);
  if (m.accessories.length)
    strong.push(`Included accessories — exact set: ${m.accessories.map((a) => `${a.count}× ${a.name}${a.color ? ` (${a.color})` : ""}`).join(", ")}. No accessory may be added, removed or recolored.`);
  if (m.scale.dimensions)
    strong.push(`True physical size: ${m.scale.dimensions}${m.scale.scale_reference ? ` (scale reference: ${m.scale.scale_reference})` : ""}. Keep believable real-world scale.`);

  soft.push("Minor surface micro-texture may follow the scene lighting as long as identity is untouched.");

  return { hard, strong, soft };
}

/**
 * The system picks the lock strength from the scene — the user can override
 * in advanced settings but never has to. Fidelity risk grows with hands,
 * mechanics, dense controls and multi-item sets.
 */
export function chooseLockStrength(scene: Pick<SceneConcept, "scene_type" | "human_presence" | "physical_contact">, m: FeatureManifest): LockStrength {
  const i = m.interfaces;
  const denseInterfaces = i.buttons + i.switches + i.ports + i.sockets >= 4;
  const complexSet = m.quantity > 1 || m.accessories.reduce((s, a) => s + a.count, 0) >= 3;
  const mechanical = m.geometry.major_components.length >= 4;
  const inHand = scene.human_presence && /hand|held|grip|finger|palm|holding/i.test(scene.physical_contact);

  if (denseInterfaces || complexSet || mechanical) return "MAXIMUM";
  if (inHand) return "MAXIMUM";
  if (scene.human_presence) return "STRONG";
  if (scene.scene_type === "premium_packshot" || scene.scene_type === "product_hero" || scene.scene_type === "marketplace_hero")
    return "STANDARD";
  return "STRONG";
}

const STRENGTH_PREAMBLE: Record<LockStrength, string> = {
  STANDARD: "Reproduce the product faithfully from the references.",
  STRONG: "Reproduce the product with strict fidelity — every listed fact is binding.",
  MAXIMUM: "ABSOLUTE product fidelity. Every listed fact is a hard constraint; when scene ideas conflict with product fidelity, fidelity wins.",
};

/** Render the structured lock into the PRODUCT LOCK prompt section. */
export function renderProductLock(lock: ProductLock, strength: LockStrength): string {
  const lines: string[] = [
    `PRODUCT LOCK (${strength}):`,
    "Treat the reference product as an already manufactured physical object.",
    "Do not redesign it. Do not reinterpret it. Do not simplify it. Do not improve it.",
    "Do not replace it with a similar product. Do not invent a new variant.",
    STRENGTH_PREAMBLE[strength],
    "Preserve exact geometry, proportions, colors, materials, component count, component placement, buttons, ports, labels, branding and accessories.",
    "Adapt the environment to the product. Never adapt the product to the environment.",
    "",
    "Non-negotiable product facts:",
    ...lock.hard.map((l) => `- ${l}`),
  ];
  if (lock.strong.length) {
    lines.push("", "Strict product facts:", ...lock.strong.map((l) => `- ${l}`));
  }
  if (strength !== "MAXIMUM" && lock.soft.length) {
    lines.push("", ...lock.soft.map((l) => `- ${l}`));
  }
  return lines.join("\n");
}
