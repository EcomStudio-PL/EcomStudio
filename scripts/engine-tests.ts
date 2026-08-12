/**
 * IMAGE ENGINE V2 — deterministic quality tests (spec cases A–J for the
 * non-vision layers: lock building, strength selection, unsupported-angle
 * protection, diversity, negative composition, master prompt assembly).
 * Run: npm run test:engine
 */
import { buildProductLock, chooseLockStrength, renderProductLock, detectReferenceConflicts, criticalDetails } from "../lib/ai/engine/lock";
import { supportedViews, conceptSupported, diversityViolations, clampRefs } from "../lib/ai/engine/scenes";
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
  check("five fingers rule present", prompt.includes("exactly five fingers on each visible hand"));
  check("in-hand forces MAXIMUM", chooseLockStrength(c, { ...baseManifest, geometry: { ...baseManifest.geometry, major_components: ["body"] }, interfaces: { ...baseManifest.interfaces, buttons: 1, leds: 0 } }) === "MAXIMUM");
  const neg = assembleNegativePrompt(c, baseManifest);
  check("human negatives included", neg.includes("fused fingers"));
}

console.log("F. Product on a table → physical contact + shadows in prompt");
{
  const prompt = assembleMasterPrompt({ concept: concept(), manifest: baseManifest, lock: buildProductLock(baseManifest), strength: "MEDIUM", session, imageCount: 1 });
  check("PHYSICAL CONTACT section present", prompt.includes("PHYSICAL CONTACT"));
  check("contact shadow demanded", prompt.includes("contact shadow"));
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
  for (const n of [1, 2, 5, 7]) check(`prompt names reference ${n}`, prompt.includes(`Image ${n}`));
  check("unselected references stay out", !prompt.includes("Image 8"));
  check("references capped at 6", 1 + c.supporting_references.length <= 6);
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
  // PART 6 mandatory order — product truth first, scene decor after.
  const order = [
    "TASK\n", "FORMAT\n", "REFERENCE IMAGES\n", "PRIMARY REFERENCE:", "REFERENCE PRIORITY\n",
    "PRODUCT LOCK — EXACT PRODUCT PRESERVATION", "CRITICAL DETAILS TO PRESERVE\n", "SCENE\n",
    "PRODUCT PLACEMENT & PHYSICAL CONTACT\n", "COMPOSITION\n", "CAMERA\n", "LIGHTING\n",
    "REALISM\n", "NEGATIVE CONSTRAINTS\n", "FINAL QUALITY REQUIREMENTS\n",
  ];
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
  check("capped at 26", parts.length <= 26);
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

console.log("M. V3 ordering: no scene word appears before the product lock");
{
  const c = concept({ scene_description: "Kettle on a sunlit marble counter", environment: "bright scandinavian kitchen" });
  const prompt = assembleMasterPrompt({ concept: c, manifest: baseManifest, lock: buildProductLock(baseManifest), strength: "HIGH", session, imageCount: 3 });
  const lockAt = prompt.indexOf("PRODUCT LOCK — EXACT PRODUCT PRESERVATION");
  check("scene description comes after the lock", prompt.indexOf("sunlit marble counter") > lockAt);
  check("environment comes after the lock", prompt.indexOf("scandinavian kitchen") > lockAt);
  check("lighting comes after the lock", prompt.indexOf("LIGHTING\n") > lockAt);
  check("references come before the lock", prompt.indexOf("REFERENCE PRIORITY\n") < lockAt);
  check("negatives are inside the prompt too", prompt.includes("NEGATIVE CONSTRAINTS"));
  check("locked-object wording present", prompt.includes("already manufactured physical object"));
  check("no hybrid variants", prompt.includes("Do not combine conflicting variants"));
}

console.log("N. Reference usage: 3-6 per prompt, roles intact, scene-only never defines product");
{
  const analyses = [
    analysis(1, "front", { primary_candidate_score: 95 }),
    analysis(2, "three_quarter", { primary_candidate_score: 88, roles: ["SIDE_PROFILE"] }),
    analysis(3, "detail", { primary_candidate_score: 40, roles: ["BUTTON_LAYOUT"], full_product: false }),
    analysis(4, "front", { primary_candidate_score: 30, roles: ["SCENE_ONLY"], scene_reference_only: true }),
    analysis(5, "rear", { primary_candidate_score: 70, roles: ["REAR_DETAIL"] }),
    analysis(6, "macro", { primary_candidate_score: 35, roles: ["MATERIAL"], full_product: false }),
  ];
  const thin = clampRefs(concept({ primary_reference: 1, supporting_references: [] }), 6, analyses);
  check("a lone primary is enriched to at least 3 references", 1 + thin.supporting_references.length >= 3);
  check("enrichment never picks a scene-only image", thin.supporting_references.every((s) => s.image !== 4));

  const rich = clampRefs(concept({
    primary_reference: 1,
    supporting_references: [
      { image: 2, role: "SIDE_PROFILE", reason: "profile" },
      { image: 3, role: "BUTTON_LAYOUT", reason: "controls" },
      { image: 5, role: "REAR_DETAIL", reason: "back" },
      { image: 6, role: "MATERIAL", reason: "finish" },
    ],
  }), 6, analyses);
  check("five well-argued references are kept", 1 + rich.supporting_references.length === 5);
  check("roles survive selection", rich.supporting_references.map((s) => s.role).join() === "SIDE_PROFILE,BUTTON_LAYOUT,REAR_DETAIL,MATERIAL");

  const spam = clampRefs(concept({
    primary_reference: 1,
    supporting_references: [2, 3, 5, 6, 2, 3].map((image) => ({ image, role: "COLOR" as const, reason: "x" })),
  }), 6, analyses);
  check("never more than 6 references total", 1 + spam.supporting_references.length <= 6);
  check("no duplicate reference numbers", new Set(spam.supporting_references.map((s) => s.image)).size === spam.supporting_references.length);

  const sceneOnly = clampRefs(concept({
    primary_reference: 1,
    supporting_references: [{ image: 4, role: "PRIMARY_GEOMETRY", reason: "steal identity" }],
  }), 6, analyses);
  check("scene-only image is refused a product role", sceneOnly.supporting_references.every((s) => s.image !== 4 || s.role !== "PRIMARY_GEOMETRY"));
}

console.log("O. Critical details + adaptive style baseline");
{
  const m = { ...baseManifest, interfaces: { ...baseManifest.interfaces, buttons: 4, ports: 2, ports_detail: "USB-C and DC" } };
  const details = criticalDetails(m, { camera_distance: "macro", human_presence: false, scene_type: "macro_detail" });
  check("counts listed as critical details", details.some((d) => d.includes("4 button")) && details.some((d) => d.includes("2 port")));
  check("branding listed as critical detail", details.some((d) => d.includes("ACME")));
  check("critical list stays focused", details.length <= 12);

  const indoor = assembleMasterPrompt({ concept: concept({ environment: "modern kitchen counter" }), manifest: m, lock: buildProductLock(m), strength: "HIGH", session, imageCount: 2 });
  const outdoor = assembleMasterPrompt({ concept: concept({ environment: "sunny garden terrace", scene_description: "Kettle on an outdoor table" }), manifest: m, lock: buildProductLock(m), strength: "HIGH", session, imageCount: 2 });
  check("interior scene gets interior light", indoor.includes("window key"));
  check("outdoor scene gets daylight", outdoor.includes("natural daylight"));
  check("blue sky is not forced indoors", !indoor.includes("natural daylight with a clear directional key"));
  check("commercial baseline always present", indoor.includes("premium") && outdoor.includes("premium"));
  check("seller style stays scene-only", assembleMasterPrompt({
    concept: concept(), manifest: m, lock: buildProductLock(m), strength: "HIGH",
    session: { ...session, style: "warm nordic" }, imageCount: 2,
  }).includes("never to the product"));
}

console.log("P. Negative engine: conditional device and set groups");
{
  const device = { ...baseManifest, interfaces: { ...baseManifest.interfaces, buttons: 4, ports: 2 } };
  const negDevice = assembleNegativePrompt(concept(), device);
  check("device negatives applied", negDevice.includes("invented buttons") && negDevice.includes("wrong port count"));
  const set = { ...baseManifest, accessories: [{ name: "charging dock", count: 2, color: "black" }] };
  check("set negatives applied", assembleNegativePrompt(concept(), set).includes("duplicated accessories"));
  const plain = { ...baseManifest, interfaces: { buttons: 0, buttons_detail: null, switches: 0, ports: 0, ports_detail: null, sockets: 0, screens: 0, leds: 0, labels: [] }, accessories: [] };
  const negPlain = assembleNegativePrompt(concept(), plain);
  check("no device negatives for a plain object", !negPlain.includes("wrong port count"));
  check("colour is always protected", negPlain.includes("body colour other than matte black"));
  const unbranded = { ...plain, branding: { logos: [], text: [], position: null } };
  check("unbranded products ban invented logos", assembleNegativePrompt(concept(), unbranded).includes("added to an unbranded product"));
}

console.log(failures === 0 ? "\nALL ENGINE TESTS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
