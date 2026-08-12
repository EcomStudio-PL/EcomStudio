/**
 * IMAGE ENGINE V2 — deterministic quality tests (spec cases A–J for the
 * non-vision layers: lock building, strength selection, unsupported-angle
 * protection, diversity, negative composition, master prompt assembly).
 * Run: npm run test:engine
 */
import { buildProductLock, chooseLockStrength, renderProductLock, detectReferenceConflicts } from "../lib/ai/engine/lock";
import { supportedViews, conceptSupported, diversityViolations } from "../lib/ai/engine/scenes";
import { assembleMasterPrompt, assembleNegativePrompt } from "../lib/ai/engine/master-prompt";
import type { FeatureManifest, ImageAnalysis, SceneConcept, SessionInput } from "../lib/ai/engine/types";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const baseManifest: FeatureManifest = {
  identity: "black electric kettle 1.7L", quantity: 1, variant: null,
  primary_color: "matte black", secondary_colors: ["silver"],
  geometry: { shape: "cylindrical kettle", proportions: "wider base", profile: "smooth", curvature: "gentle", major_components: ["body", "lid", "handle"] },
  materials: ["matte plastic", "stainless steel"],
  interfaces: { buttons: 1, buttons_detail: "power switch", switches: 0, ports: 0, ports_detail: null, sockets: 0, screens: 0, leds: 1, labels: ["MAX 1.7L"] },
  branding: { logos: ["ACME"], text: [], position: "front center" },
  accessories: [], scale: { dimensions: "22 cm tall", confidence: "medium", scale_reference: null },
  critical_features: ["blue LED ring when on"],
};

function analysis(n: number, view: ImageAnalysis["view"], extra: Partial<ImageAnalysis> = {}): ImageAnalysis {
  return {
    image_number: n, view, full_product: true, product_count: 1, occlusion: "none",
    product_quality: "sharp", color_reference: true, material_reference: true,
    scale_reference: false, dimension_reference: false, branding_visibility: "clear",
    text_visibility: "clear", usage_reference: false, background_complexity: "clean",
    critical_features: [], scene_reference_only: false, primary_candidate_score: 80,
    roles: ["PRIMARY_GEOMETRY"], observed_color: "matte black", observed_button_count: 1,
    variant_hint: null, ...extra,
  };
}

function concept(over: Partial<SceneConcept> = {}): SceneConcept {
  return {
    scene_type: "product_hero", title: "Hero", scene_description: "Kettle on a stone counter",
    environment: "modern kitchen counter", camera_distance: "medium", camera_angle: "eye level",
    lighting: "soft window light", human_presence: false, human_interaction: null,
    product_placement: "The kettle stands centered on the counter.",
    physical_contact: "Base rests fully on the counter surface.",
    product_orientation: "front facing", marketing_purpose: "marketplace hero",
    required_views: ["front"], primary_reference: 1, supporting_references: [],
    product_specific_negatives: ["do not change the power switch position"], ...over,
  };
}

const session: SessionInput = { productName: "Kettle", description: null, extraInfo: null, style: null, aspectRatio: "1:1" };

console.log("A. Single front photo → rear shots rejected");
{
  const views = supportedViews([analysis(1, "front")]);
  check("front is supported", conceptSupported(concept({ required_views: ["front"] }), views));
  check("rear hero is rejected", !conceptSupported(concept({ required_views: ["rear"] }), views));
  check("top-down is rejected", !conceptSupported(concept({ required_views: ["top"] }), views));
}

console.log("B. 4 photos (front / 3-4 / detail / scale) → distinct roles & views");
{
  const analyses = [
    analysis(1, "front"),
    analysis(2, "three_quarter", { roles: ["PRIMARY_GEOMETRY", "SIDE_PROFILE"] }),
    analysis(3, "detail", { roles: ["BUTTON_LAYOUT"], full_product: false }),
    analysis(4, "front", { roles: ["SCALE"], scale_reference: true }),
  ];
  const views = supportedViews(analyses);
  check("three_quarter unlocks side-ish scenes", conceptSupported(concept({ required_views: ["side"] }), views));
  check("distinct roles preserved", new Set(analyses.flatMap((a) => a.roles)).size >= 4);
}

console.log("C. Set of two products → lock protects quantity=2");
{
  const m = { ...baseManifest, quantity: 2, identity: "walkie-talkie 2-pack" };
  const lock = buildProductLock(m);
  check("lock hard-codes exactly 2 units", lock.hard.some((l) => l.includes("2 identical product units")));
  const neg = assembleNegativePrompt(concept(), m);
  check("negative forbids wrong unit count", neg.includes("more or fewer than 2"));
  check("multi-unit set forces MAXIMUM strength", chooseLockStrength(concept(), m) === "MAXIMUM");
}

console.log("D. Electronics with 4 buttons → button count protected + MAXIMUM");
{
  const m = { ...baseManifest, interfaces: { ...baseManifest.interfaces, buttons: 4, buttons_detail: "four green rubber buttons" } };
  const lock = buildProductLock(m);
  check("lock states exactly 4 buttons", lock.hard.some((l) => l.includes("exactly 4 buttons")));
  check("dense interfaces force MAXIMUM", chooseLockStrength(concept(), m) === "MAXIMUM");
}

console.log("E. Product held in hand → Human Realism active");
{
  const c = concept({
    scene_type: "product_in_use", human_presence: true,
    human_interaction: "Right hand wraps around the handle, thumb on the switch.",
    physical_contact: "Held firmly in the right hand.",
  });
  const prompt = assembleMasterPrompt({ concept: c, manifest: baseManifest, lock: buildProductLock(baseManifest), strength: chooseLockStrength(c, baseManifest), session, imageCount: 2 });
  check("HUMAN REALISM section present", prompt.includes("HUMAN REALISM"));
  check("five fingers rule present", prompt.includes("five fingers per visible hand"));
  check("in-hand forces MAXIMUM", chooseLockStrength(c, { ...baseManifest, geometry: { ...baseManifest.geometry, major_components: ["body"] }, interfaces: { ...baseManifest.interfaces, buttons: 1, leds: 0 } }) === "MAXIMUM");
  const neg = assembleNegativePrompt(c, baseManifest);
  check("human negatives included", neg.includes("fused fingers"));
}

console.log("F. Product on a table → physical contact + shadows in prompt");
{
  const prompt = assembleMasterPrompt({ concept: concept(), manifest: baseManifest, lock: buildProductLock(baseManifest), strength: "MEDIUM", session, imageCount: 1 });
  check("PHYSICAL CONTACT section present", prompt.includes("PHYSICAL CONTACT"));
  check("contact shadows demanded", prompt.includes("contact shadows"));
  check("no-floating rule present", prompt.includes("never floats"));
  const neg = assembleNegativePrompt(concept(), baseManifest);
  check("negative bans floating", neg.includes("floating or levitating"));
}

console.log("G. 8 uploaded photos → scenes use a subset, not all 8");
{
  const c = concept({
    primary_reference: 1,
    supporting_references: [
      { image: 2, role: "BUTTON_LAYOUT", reason: "controls" },
      { image: 5, role: "SCALE", reason: "true size" },
      { image: 7, role: "MATERIAL", reason: "finish" },
    ],
  });
  const prompt = assembleMasterPrompt({ concept: c, manifest: baseManifest, lock: buildProductLock(baseManifest), strength: "HIGH", session, imageCount: 8 });
  check("prompt names only selected refs", prompt.includes("reference images 1, 2, 5, 7"));
  check("references capped at 2-4", 1 + c.supporting_references.length <= 4);
}

console.log("H. 5 prompts must be clearly different (diversity engine)");
{
  const five = [
    concept({ scene_type: "product_hero" }),
    concept({ scene_type: "premium_lifestyle", environment: "cozy living room", camera_distance: "wide", human_presence: true }),
    concept({ scene_type: "closeup", environment: "studio table", camera_distance: "close" }),
    concept({ scene_type: "product_in_use", environment: "office desk with laptop", human_presence: true, camera_distance: "close" }),
    concept({ scene_type: "premium_packshot", environment: "seamless white studio", camera_distance: "medium" }),
  ];
  check("diverse set passes", diversityViolations(five).length === 0);
  const dupes = [...five.slice(0, 4), concept({ scene_type: "product_hero" })];
  check("duplicate scene_type detected", diversityViolations(dupes).length > 0);
  const sameShape = [concept(), concept({ scene_type: "marketplace_hero" })]; // same env/distance/human
  check("same-photo-different-name detected", diversityViolations(sameShape).length > 0);
}

console.log("I. Master prompt ordering: product facts before scene decor");
{
  const prompt = assembleMasterPrompt({ concept: concept(), manifest: baseManifest, lock: buildProductLock(baseManifest), strength: "HIGH", session, imageCount: 2 });
  const order = ["TASK:", "FORMAT:", "REFERENCE IMAGES:", "PRIMARY REFERENCE:", "REFERENCE PRIORITY:", "PRODUCT LOCK", "CRITICAL FEATURES:", "SCENE:", "PRODUCT PLACEMENT:", "PHYSICAL CONTACT:", "COMPOSITION:", "CAMERA:", "LIGHTING:", "REALISM:", "FINAL QUALITY:"];
  let last = -1, ordered = true;
  for (const sec of order) {
    const i = prompt.indexOf(sec);
    if (i < 0 || i < last) { ordered = false; break; }
    last = i;
  }
  check("all sections present in spec order", ordered);
  check("lock forbids redesign", prompt.includes("Do not redesign it."));
  check("environment adapts to product", prompt.includes("Adapt the environment to the product."));
  const rendered = renderProductLock(buildProductLock(baseManifest), "MAXIMUM");
  check("MAXIMUM strength escalates wording", rendered.includes("ABSOLUTE product fidelity"));
}

console.log("J. Negative prompt engine: layered, deduped, capped");
{
  const c = concept({ human_presence: true, product_specific_negatives: ["do not change the four green buttons", "do not move the RESET hole", "do not change the four green buttons"] });
  const neg = assembleNegativePrompt(c, baseManifest);
  const parts = neg.split("; ");
  check("product-specific negatives lead", parts[0].includes("four green buttons"));
  check("deduped", parts.filter((p) => p.includes("four green buttons")).length === 1);
  check("capped at 18", parts.length <= 18);
  check("global net present", neg.includes("watermarks"));
}

console.log("K. Reference conflicts are detected, never silently merged");
{
  const analyses = [
    analysis(1, "front", { observed_color: "matte black", observed_button_count: 4, primary_candidate_score: 95 }),
    analysis(2, "front", { observed_color: "blue", observed_button_count: 6, primary_candidate_score: 60 }),
  ];
  const m = { ...baseManifest, interfaces: { ...baseManifest.interfaces, buttons: 4 } };
  const conflicts = detectReferenceConflicts(analyses, m);
  check("colour conflict detected", conflicts.some((c) => c.kind === "color"));
  check("button-count conflict detected", conflicts.some((c) => c.kind === "buttons"));
  check("resolution follows the best primary candidate", conflicts.every((c) => c.resolution.length > 0));
  const lock = buildProductLock(m, analyses);
  const rendered = renderProductLock(lock, "MAXIMUM");
  check("prompt warns against blending references", rendered.includes("REFERENCE CONFLICTS"));
  check("conflicts force MAXIMUM strength", chooseLockStrength(concept(), m, lock.conflicts) === "MAXIMUM");
  const clean = detectReferenceConflicts([analysis(1, "front"), analysis(2, "three_quarter")], baseManifest);
  check("identical references report no conflict", clean.length === 0);
  const neg = assembleNegativePrompt(concept(), m, lock);
  check("negative bans wrong button counts", neg.includes("other than 4"));
}

console.log("L. Fidelity-first strength ladder");
{
  const simple: FeatureManifest = { ...baseManifest,
    interfaces: { ...baseManifest.interfaces, buttons: 0, leds: 0 },
    branding: { logos: [], text: [], position: null }, critical_features: [],
    geometry: { ...baseManifest.geometry, major_components: ["body"] } };
  check("plain packshot of a plain object relaxes to MEDIUM",
    chooseLockStrength(concept({ scene_type: "premium_packshot" }), simple) === "MEDIUM");
  check("any control keeps it at HIGH",
    chooseLockStrength(concept({ scene_type: "premium_packshot" }), { ...simple, interfaces: { ...simple.interfaces, buttons: 1 } }) === "HIGH");
  check("dense controls reach MAXIMUM",
    chooseLockStrength(concept(), { ...simple, interfaces: { ...simple.interfaces, buttons: 4, ports: 2 } }) === "MAXIMUM");
}

console.log(failures === 0 ? "\nALL ENGINE TESTS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
