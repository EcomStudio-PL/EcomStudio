import "server-only";
import { callVisionJson, type VisionBackend, type VisionOutcome } from "./vision";
import {
  IMAGE_VIEWS, REFERENCE_ROLES, SCENE_TYPES,
  type FeatureManifest, type ImageAnalysis, type ImageView, type SceneConcept,
  type SceneType, type SessionInput, type SupportingReference,
} from "./types";

/**
 * SCENE STRATEGY + DIVERSITY ENGINE.
 * Designs the requested number of scene concepts (5-10) FOR THIS SPECIFIC
 * PRODUCT (a TV remote gets a family-couch scene; a soldering iron gets a
 * workbench macro — never the same set for everything), assigns references per
 * scene, and refuses angles the references cannot support (fidelity >
 * novelty: no rear hero shot when no rear photo exists).
 */

export const SCENE_SCHEMA = {
  type: "OBJECT",
  properties: {
    scenery_category: {
      type: "STRING",
      enum: ["kitchen", "garden", "living_room", "bedroom", "bathroom", "office", "workshop", "outdoor", "sport", "kids", "beauty", "tech", "generic"],
    },
    brand_domain_pl: { type: "STRING" },
    concepts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          scene_type: { type: "STRING", enum: [...SCENE_TYPES] },
          title: { type: "STRING" },
          customer_title: { type: "STRING" },
          customer_description: { type: "STRING" },
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
          scene_text_pl: { type: "STRING" },
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
          "scene_type", "title", "customer_title", "customer_description",
          "scene_description", "environment", "camera_distance",
          "camera_angle", "lighting", "human_presence", "product_placement",
          "physical_contact", "product_orientation", "marketing_purpose",
          "scene_text_pl",
          "required_views", "primary_reference", "supporting_references",
          "product_specific_negatives",
        ],
      },
    },
  },
  required: ["scenery_category", "brand_domain_pl", "concepts"],
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

/** Roles that only clarify a detail — never a product-identity source. */
const CONTEXT_ROLES = new Set(["SCENE_ONLY", "USAGE", "SCALE", "DIMENSIONS"]);

/**
 * REFERENCE SELECTION. The engine deliberately uses MORE of what the seller
 * uploaded — typically 3-6 references per scene — because every extra verified
 * angle is fidelity the model would otherwise have to invent. It still never
 * dumps the whole library into every prompt: each supporting image must carry
 * a distinct role, scene-only images can never define the product, and the
 * primary reference always stays the single source of truth for geometry.
 */
const MAX_SUPPORTING = 5;
const MIN_SUPPORTING = 2;

export function clampRefs(c: SceneConcept, imageCount: number, analyses: ImageAnalysis[]): SceneConcept {
  const usable = analyses.filter((a) => !a.scene_reference_only);
  const bestPrimary = [...usable].sort((x, y) => y.primary_candidate_score - x.primary_candidate_score)[0];
  let primary = Math.trunc(c.primary_reference);
  const primaryAnalysis = analyses.find((a) => a.image_number === primary);
  if (primary < 1 || primary > imageCount || primaryAnalysis?.scene_reference_only) {
    primary = bestPrimary?.image_number ?? 1;
  }

  const taken = new Set<number>([primary]);
  const supporting = (c.supporting_references ?? [])
    .filter((s) => {
      const n = Math.trunc(s.image);
      if (n < 1 || n > imageCount || taken.has(n)) return false;
      const a = analyses.find((x) => x.image_number === n);
      // A scene-only image may still ride along as context (usage, scale) but
      // must never be handed a product-defining role.
      if (a?.scene_reference_only && !CONTEXT_ROLES.has(s.role)) return false;
      taken.add(n);
      return true;
    })
    .slice(0, MAX_SUPPORTING);

  // Under-using references is the cheapest way to lose fidelity, so the
  // remaining verified views are attached (best first) until the scene carries
  // a useful set. Each gets the role its own analysis reports.
  if (supporting.length < MIN_SUPPORTING) {
    const extras = analyses
      .filter((a) => !taken.has(a.image_number) && !a.scene_reference_only && a.product_quality !== "poor")
      .sort((x, y) => y.primary_candidate_score - x.primary_candidate_score);
    for (const extra of extras) {
      if (supporting.length >= MIN_SUPPORTING) break;
      const role = extra.roles.find((r) => !CONTEXT_ROLES.has(r) && r !== "PRIMARY_GEOMETRY" && r !== "PRIMARY_REFERENCE")
        ?? roleForView(extra.view);
      supporting.push({
        image: extra.image_number, role,
        reason: `additional verified view of the product (${extra.view.replace("_", " ")})`,
      });
      taken.add(extra.image_number);
    }
  }
  return { ...c, primary_reference: primary, supporting_references: supporting };
}

/** Fallback role when the analysis reported none usable for a supporting image. */
function roleForView(view: ImageView): SupportingReference["role"] {
  switch (view) {
    case "rear": return "REAR_DETAIL";
    case "side": case "left": case "right": return "SIDE_PROFILE";
    case "front": return "FRONT_DETAIL";
    case "macro": case "detail": return "MATERIAL";
    default: return "COLOR";
  }
}

export const SCENE_SYSTEM = `You are the scene-strategy engine of a product photography platform.
You design DISTINCT professional e-commerce photo concepts for one specific product (the requested count is given in the task).

THE SCENE IS CREATIVE. THE PRODUCT IS NOT.
You may design environment, light, composition, perspective, mood, humans and presentation.
You never redesign the product.

PROVEN SHOT PATTERNS — use the ones that fit THIS product (never force one that does not):
- PROBLEM CONTEXT: the product placed in the real environment of the problem it solves, with the problem visible (e.g. a mouse trap on a barn floor with rodents approaching). Strongest for pest control, repair, cleaning, protection products.
- LIFESTYLE WITH A PERSON: a person naturally performing the activity that leads to using the product (e.g. a couple slicing mushrooms beside a food dehydrator), in a premium environment that matches the product's category. Show the activity, not a posed model.
- CONTROL DETAIL: for any product with buttons, a panel, a dial or a mechanism — a close-up of that control, often with a well-groomed photorealistic hand pressing it, keeping the framing of the reference close-up when one exists.
- PROBLEM → SOLUTION: when the result is visually obvious, one frame split cleanly (e.g. 50/50) between the before state and the after state.
- TECHNICAL VISUALIZATION: when the mechanism is invisible (underground, internal, wireless), one deliberately explanatory scene may visualize it (soil cross-section, radiating waves) — clearly composed, still premium.
- WORK DEMONSTRATION: a product that performs an action shown mid-action with believable dynamics and physically plausible debris/motion.
- Use the seller's stated dimensions and facts from the description inside the scene when they help scale and credibility.

Hard rules:
- Choose scenes that genuinely fit THIS product and its buyer — not a generic set.
- The concepts must differ in scene type, camera distance/angle, environment, human presence, use case and marketing purpose. Never variations of the same photograph.
- customer_title and customer_description are the ONLY texts the seller will read: write them in the seller's language given in the task (default Polish), 2-4 words for the title, one short benefit-oriented sentence for the description. Plain seller language — never mention prompts, references, locks, engines or any internal mechanics.
- FIDELITY OVER NOVELTY: you receive the list of product views actually covered by the references. Never propose a scene that requires an uncovered view (e.g. no full rear shot without a rear reference). required_views must list the views each scene needs.
- References per scene: pick ONE primary_reference (the image that best defines geometry/identity for this scene) plus every supporting reference that genuinely adds a fact this photograph needs — controls, ports, branding, material, colour, accessories, scale, usage. Aim for 3-6 references in total (2-5 supporting): under-using references makes the model invent the product, but do not pad the list with images that repeat a role you already have. Images marked scene-only may only inspire the scene or give scale — never define the product.
- physical_contact must describe REAL physics: full contact with the surface, exact grip, actual mounting — no floating products.
- If human_presence is true, human_interaction must describe the exact grip/pose (which hand, which fingers where), not "person holding product".
- product_specific_negatives: 2-5 short "do not ..." lines protecting THIS product's most fragile facts in THIS scene (e.g. "do not change the four green buttons", "do not add a third device").
- Write the structured fields in English — EXCEPT customer_title / customer_description (seller's language) and scene_text_pl (always Polish).

SCENE_TEXT_PL — THE SHOT DESCRIPTION THAT GOES INTO THE FINAL ADVERTISING PROMPT:
For every concept write scene_text_pl in POLISH: 3-6 concrete sentences describing exactly what is visible in this photograph, in the house style of these examples:
- "Jest to łapka na myszy. Łapka stoi na podłodze w stodole z widocznym bydłem w tle. W stronę łapki biegnie mysz i szczur."
- "Suszarka spożywcza stoi na wyspie kuchennej. Na blacie kobieta z mężem kroją pieczarki i grzyby, które zaraz będą suszyć w suszarce. Perspektywa od góry 3/4 pod kątem 45 stopni."
- "Ujęcie podzielone 50/50 cienką białą linią z widocznymi kretowiskami po lewej stronie, a po prawej stronie brak kretowisk i niezniszczony trawnik."
Rules for scene_text_pl: start by naming the product ("Jest to ..." or the product as subject), state where it stands/lies and on what, who does what with it (exact action), the perspective/kadr when it matters, believable dynamics, and the one benefit this shot sells. Concrete nouns and actions — never vague mood words alone. Do not describe the product's design (the fidelity section handles that), describe the SCENE around it.

SESSION-LEVEL FIELDS:
- scenery_category: the world this product's photos live in (kitchen, garden, living_room, bedroom, bathroom, office, workshop, outdoor, sport, kids, beauty, tech, generic).
- brand_domain_pl: Polish genitive naming the brand's domain for the sentence "jak wizualizacja premium dla ..." — e.g. "marki kuchennej", "marki odstraszaczy", "marki narzędzi ogrodniczych", "marki meblowej".`;

/**
 * EXACT-COUNT BACKSTOP. The diversity and supported-view filters may reject
 * model-proposed concepts; when the AI refill also comes up short, the
 * remaining slots are synthesized deterministically from safe, always-
 * renderable shot patterns. A seller who orders 8 shots gets exactly 8 —
 * a synthesized packshot or close-up is a real, honest concept, and every
 * card still has "Zmień scenę" if they want the AI to redesign it.
 */
const SYNTH_TEMPLATES: {
  type: SceneType;
  camera: SceneConcept["camera_distance"];
  angle: string;
  environment: string;
  scene: (identity: string) => string;
  scenePl: (identity: string) => string;
  title: Record<string, string>;
  body: Record<string, string>;
}[] = [
  {
    type: "premium_packshot", camera: "medium", angle: "three-quarter view, slightly above eye level",
    environment: "seamless premium studio backdrop with a soft gradient",
    scene: (p) => `${p} presented as a premium studio packshot on a clean seamless backdrop, hero placement in the centre of the frame.`,
    scenePl: (p) => `Jest to ${p}. Produkt stoi centralnie na eleganckim, jednolitym tle studyjnym z delikatnym gradientem, w całości widoczny w kadrze, z czystym marginesem wokół. Ujęcie 3/4 lekko z góry. Czysty packshot premium bez żadnych dodatkowych obiektów.`,
    title: { pl: "Premium packshot", en: "Premium packshot", de: "Premium-Packshot" },
    body: {
      pl: "Czyste studyjne ujęcie produktu na eleganckim tle.",
      en: "A clean studio shot of the product on an elegant backdrop.",
      de: "Eine saubere Studioaufnahme des Produkts auf elegantem Hintergrund.",
    },
  },
  {
    type: "closeup", camera: "close", angle: "close three-quarter detail view",
    environment: "shallow depth of field over a neutral premium surface",
    scene: (p) => `A close-up of the most characteristic detail of ${p}, filling the frame, with the rest of the product softly visible behind it.`,
    scenePl: (p) => `Jest to ${p}. Zbliżenie na najbardziej charakterystyczny detal produktu, który wypełnia kadr; reszta produktu miękko widoczna w tle na neutralnej powierzchni premium. Mała głębia ostrości podkreśla jakość wykonania.`,
    title: { pl: "Detal produktu", en: "Product detail", de: "Produktdetail" },
    body: {
      pl: "Zbliżenie na najważniejszy detal produktu.",
      en: "A close-up of the product's most important detail.",
      de: "Nahaufnahme des wichtigsten Produktdetails.",
    },
  },
  {
    type: "marketplace_hero", camera: "medium", angle: "frontal, straight-on hero view",
    environment: "bright neutral background suitable for a marketplace listing",
    scene: (p) => `${p} shown frontally as the main marketplace listing photo, perfectly lit, no distractions.`,
    scenePl: (p) => `Jest to ${p}. Produkt pokazany frontalnie jako główne zdjęcie oferty, na jasnym, neutralnym tle, idealnie oświetlony, bez żadnych rozpraszaczy. Produkt w całości w kadrze, centralnie.`,
    title: { pl: "Zdjęcie główne", en: "Main listing shot", de: "Hauptbild" },
    body: {
      pl: "Idealne zdjęcie główne do oferty marketplace.",
      en: "The perfect main photo for a marketplace listing.",
      de: "Das perfekte Hauptfoto für ein Marktplatz-Angebot.",
    },
  },
  {
    type: "product_hero", camera: "medium", angle: "low three-quarter hero angle",
    environment: "premium surface matching the product's world, softly lit background",
    scene: (p) => `${p} staged as the hero of the frame on a premium surface that matches its category, with gentle depth behind it.`,
    scenePl: (p) => `Jest to ${p}. Produkt jako bohater kadru stoi na powierzchni premium pasującej do jego kategorii, z delikatną głębią i miękko oświetlonym tłem. Ujęcie 3/4 z lekko niskiej perspektywy podkreśla jego sylwetkę.`,
    title: { pl: "Ujęcie hero", en: "Hero shot", de: "Hero-Aufnahme" },
    body: {
      pl: "Produkt w roli głównej, w eleganckim otoczeniu.",
      en: "The product as the hero in an elegant setting.",
      de: "Das Produkt als Held in eleganter Umgebung.",
    },
  },
  {
    type: "scale_demo", camera: "wide", angle: "eye-level view with context",
    environment: "realistic interior surface with everyday objects for scale",
    scene: (p) => `${p} placed next to familiar everyday objects so its true size reads instantly.`,
    scenePl: (p) => `Jest to ${p}. Produkt stoi na realistycznej powierzchni wnętrza obok znanych przedmiotów codziennego użytku, dzięki czemu od razu widać jego prawdziwy rozmiar. Perspektywa na wysokości oczu.`,
    title: { pl: "Skala produktu", en: "True size", de: "Größenvergleich" },
    body: {
      pl: "Produkt obok znanych przedmiotów — od razu widać rozmiar.",
      en: "The product beside familiar objects — the size reads instantly.",
      de: "Das Produkt neben bekannten Objekten — die Größe ist sofort klar.",
    },
  },
  {
    type: "technical_detail", camera: "close", angle: "slightly top-down technical view",
    environment: "clean neutral surface, even technical lighting",
    scene: (p) => `${p} photographed to clearly show its construction and materials, evenly lit, every functional element readable.`,
    scenePl: (p) => `Jest to ${p}. Ujęcie techniczne z lekkiej góry pokazujące konstrukcję i materiały produktu w równomiernym świetle; każdy element funkcyjny jest czytelny. Neutralna, czysta powierzchnia bez rozpraszaczy.`,
    title: { pl: "Budowa i materiały", en: "Build and materials", de: "Verarbeitung" },
    body: {
      pl: "Czytelne ujęcie konstrukcji i materiałów.",
      en: "A clear view of the build quality and materials.",
      de: "Ein klarer Blick auf Verarbeitung und Materialien.",
    },
  },
];

export function synthesizeConcepts(
  existing: SceneConcept[], missing: number, identity: string,
  analyses: ImageAnalysis[], locale: string = "pl",
): SceneConcept[] {
  if (missing <= 0) return [];
  const used = new Set(existing.map((c) => c.scene_type));
  const usable = analyses.filter((a) => !a.scene_reference_only && a.product_quality !== "poor");
  const primary = [...usable].sort((a, b) => b.primary_candidate_score - a.primary_candidate_score)[0]?.image_number ?? 1;
  const lang = ["pl", "en", "de"].includes(locale) ? locale : "pl";

  const out: SceneConcept[] = [];
  for (const tpl of SYNTH_TEMPLATES) {
    if (out.length >= missing) break;
    if (used.has(tpl.type)) continue;
    used.add(tpl.type);
    out.push(clampRefs({
      scene_type: tpl.type,
      title: tpl.title.en,
      customer_title: tpl.title[lang],
      customer_description: tpl.body[lang],
      scene_description: tpl.scene(identity),
      scene_text_pl: tpl.scenePl(identity),
      environment: tpl.environment,
      camera_distance: tpl.camera,
      camera_angle: tpl.angle,
      lighting: "bright, clean commercial lighting appropriate to the setting",
      human_presence: false,
      human_interaction: null,
      product_placement: "The product stands fully inside the frame as the unmistakable subject.",
      physical_contact: "The product rests in full physical contact with the surface beneath it, with a correct contact shadow.",
      product_orientation: "the most recognisable orientation shown in the primary reference",
      marketing_purpose: "reliable conversion shot",
      required_views: [],
      primary_reference: primary,
      supporting_references: [],
      product_specific_negatives: [],
    }, analyses.length, analyses));
  }
  return out;
}

export async function proposeScenes(
  backends: VisionBackend[],
  images: { base64: string; mime: string }[],
  analyses: ImageAnalysis[],
  manifest: FeatureManifest,
  info: SessionInput,
  opts?: { count?: number; avoidSceneTypes?: string[]; customerLanguage?: string }
): Promise<{ concepts: SceneConcept[]; outcome: VisionOutcome; sceneryCategory: string; brandDomainPl: string }> {
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
    `Seller language for customer_title and customer_description: ${opts?.customerLanguage ?? "Polish"}.`,
    `Design exactly ${count} clearly different concept${count === 1 ? "" : "s"}.`,
  ].filter(Boolean).join("\n\n");

  const { data: out, outcome } = await callVisionJson<{
    concepts: SceneConcept[]; scenery_category?: string; brand_domain_pl?: string;
  }>(backends, { images, system: SCENE_SYSTEM, user, schema: SCENE_SCHEMA });

  let concepts = (out.concepts ?? []).map((c) => clampRefs(c, images.length, analyses));

  // UNSUPPORTED ANGLE PROTECTION (server-side backstop)
  concepts = concepts.filter((c) => conceptSupported(c, available));

  // DIVERSITY backstop: drop colliding concepts (the weaker/later one).
  const bad = new Set(diversityViolations(concepts));
  concepts = concepts.filter((_, i) => !bad.has(i));

  return {
    concepts: concepts.slice(0, count), outcome,
    sceneryCategory: out.scenery_category ?? "generic",
    brandDomainPl: out.brand_domain_pl ?? "",
  };
}
