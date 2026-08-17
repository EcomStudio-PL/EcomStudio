import "server-only";
import type { FeatureManifest, ProductLock, SceneConcept } from "./types";

/**
 * PROMPT TEMPLATE ENGINE — the PDF playbook as code.
 *
 * The reference PDF shows the house prompt style: a fixed Polish opening
 * ("Stwórz zdjęcie reklamowe."), a fixed scenery block (fresh contrasty
 * climate, bright daylight, premium environment, the literal quality
 * signature "Ultra realistic, 8k, cinematic daylight, sharp focus, realistic
 * materials, premium real estate visualization"), and then ONE variable block
 * that concretely describes what is visible in this exact shot.
 *
 * This module turns that into the engine: the constant sections are template
 * text (adapted per product category), the product-fidelity section is
 * rendered from verified manifest facts, and only the shot description varies
 * per card. The composed FULL PROMPT is the single source of truth for image
 * generation — the negative prompt stays a technical helper on the side.
 */

export const PROMPT_TEMPLATE_VERSION = 1;

/* ── template_scene_by_category ────────────────────────────────────────── */

export const SCENERY_CATEGORIES = [
  "kitchen", "garden", "living_room", "bedroom", "bathroom", "office",
  "workshop", "outdoor", "sport", "kids", "beauty", "tech", "generic",
] as const;
export type SceneryCategory = (typeof SCENERY_CATEGORIES)[number];

/** Colour-world of the scenery block, in the PDF's own register. */
const CATEGORY_PALETTE: Record<SceneryCategory, string> = {
  kitchen: "ciepłe odcienie drewna, głęboką zieleń świeżych ziół, wyrazisty kontrast, czyste biele i nowoczesne antracytowe detale",
  garden: "ciepłe odcienie drewna, głęboką zieleń roślin, wyrazisty kontrast, czyste biele i nowoczesne antracytowe detale",
  living_room: "ciepłe odcienie drewna, miękkie naturalne tkaniny, wyrazisty kontrast, czyste biele i nowoczesne antracytowe detale",
  bedroom: "miękkie naturalne tkaniny, ciepłe odcienie drewna, spokojne jasne beże i czyste biele",
  bathroom: "czyste biele, jasny kamień, chrom i szkło, świeże akcenty zieleni",
  office: "czyste biele, chłodne szarości, naturalne drewno biurka i nowoczesne antracytowe detale",
  workshop: "wyrazisty kontrast, czyste biele i nowoczesne detale",
  outdoor: "naturalną zieleń, ciepłe światło słoneczne, kamień i drewno, wyrazisty kontrast",
  sport: "energiczny kontrast, czyste biele, dynamiczne światło i nowoczesne detale",
  kids: "jasne, ciepłe i przyjazne kolory, czyste biele i naturalne drewno",
  beauty: "czyste biele, delikatne pastele, marmur i szkło, miękkie refleksy",
  tech: "czyste biele, chłodne szarości, wyrazisty kontrast i nowoczesne antracytowe detale",
  generic: "ciepłe odcienie drewna, wyrazisty kontrast, czyste biele i nowoczesne antracytowe detale",
};

export function normalizeSceneryCategory(raw: unknown): SceneryCategory {
  const v = String(raw ?? "").toLowerCase().trim();
  return (SCENERY_CATEGORIES as readonly string[]).includes(v) ? (v as SceneryCategory) : "generic";
}

/* ── template_intro ────────────────────────────────────────────────────── */

export function templateIntro(): string {
  return "Stwórz zdjęcie reklamowe.";
}

/* ── template_scene_base + template_quality_block ──────────────────────── */

const QUALITY_SIGNATURE =
  "Ultra realistic, 8k, cinematic daylight, sharp focus, realistic materials, premium real estate visualization.";

export function templateSceneryBlock(category: SceneryCategory, brandDomainPl: string): string {
  const brand = brandDomainPl.trim() || "marki premium";
  return [
    "Sceneria:",
    "Scena ma mieć świeży i kontrastowy klimat, jak na profesjonalnej fotografii reklamowej. " +
      "Światło ma być jasne, dzienne, z wyraźnymi cieniami i ciepłymi refleksami. " +
      `Kolorystyka powinna przypominać ${CATEGORY_PALETTE[category]}.`,
    "Otoczenie ma wyglądać luksusowo, zadbanie i realistycznie, jak wizualizacja premium dla " +
      `${brand}. ${QUALITY_SIGNATURE}`,
  ].join("\n");
}

/* ── composition by output format ──────────────────────────────────────── */

const COMPOSITION_BY_FORMAT: Record<string, string> = {
  "1:1": "Kompozycja kwadratowa 1:1: produkt centralnie w kadrze, w całości widoczny, z czystym marginesem wokół — jak idealne zdjęcie główne oferty.",
  "4:5": "Kompozycja pionowa 4:5: produkt wyraźnie na pierwszym planie, kadr nieco wyższy niż szerszy, otoczenie domknięte górą i dołem.",
  "16:9": "Kompozycja szeroka 16:9, kinowa: produkt wyraźny na pierwszym planie, otoczenie buduje kontekst po bokach kadru.",
  "9:16": "Kompozycja pionowa 9:16: produkt duży i czytelny nawet na małym ekranie telefonu, otoczenie prowadzi wzrok w pionie.",
};

export function templateCompositionLine(aspectRatio: string): string {
  return COMPOSITION_BY_FORMAT[aspectRatio] ?? COMPOSITION_BY_FORMAT["1:1"];
}

/* ── template_fidelity_block ───────────────────────────────────────────── */

/** The Product Lock merged INTO the full prompt, in Polish, from verified
 *  manifest facts — exact colours, exact counts, materials, branding, and a
 *  hard ban on hybrids of different reference photos. */
export function templateFidelityBlock(m: FeatureManifest, lock: ProductLock): string {
  const lines: string[] = [
    `Na zdjęciach referencyjnych jest dokładnie ten produkt: ${m.identity}. Odwzoruj go 1:1.`,
    "Zachowaj dokładny wygląd, konstrukcję, proporcje i geometrię produktu ze zdjęć referencyjnych. " +
      "Nie zmieniaj designu, nie usuwaj elementów, nie dodawaj obcych funkcji, nie zmieniaj mechaniki działania.",
  ];
  const colors = [m.primary_color, ...m.secondary_colors].filter(Boolean).join(", ");
  if (colors) lines.push(`Kolory produktu dokładnie jak na referencjach: ${colors}. Nie zmieniaj żadnego koloru.`);
  if (m.quantity > 1) lines.push(`W kadrze dokładnie ${m.quantity} sztuki produktu — ani mniej, ani więcej.`);
  else lines.push("W kadrze dokładnie jedna sztuka produktu — nie duplikuj jej.");

  const i = m.interfaces;
  const counts: string[] = [];
  if (i.buttons > 0) counts.push(`przycisków: dokładnie ${i.buttons}${i.buttons_detail ? ` (${i.buttons_detail})` : ""}`);
  if (i.ports > 0) counts.push(`portów/gniazd: dokładnie ${i.ports}${i.ports_detail ? ` (${i.ports_detail})` : ""}`);
  if (i.screens > 0) counts.push(`ekranów/wyświetlaczy: dokładnie ${i.screens}`);
  if (i.switches > 0) counts.push(`przełączników: dokładnie ${i.switches}`);
  if (i.leds > 0) counts.push(`diod/kontrolek: dokładnie ${i.leds}`);
  if (counts.length) lines.push(`Elementy obsługi bez żadnych zmian — ${counts.join("; ")}. Układ i wygląd paneli dokładnie jak na referencjach.`);

  if (m.materials.length) lines.push(`Materiały dokładnie jak na referencjach: ${m.materials.join(", ")}.`);

  const brandingBits = [...m.branding.logos, ...m.branding.text].filter(Boolean);
  if (brandingBits.length) {
    lines.push(`Na produkcie wyłącznie oryginalne napisy i logo: ${brandingBits.join(", ")}${m.branding.position ? ` (${m.branding.position})` : ""}. Nie zmieniaj ich, nie przesuwaj i nie tłumacz.`);
  } else {
    lines.push("Produkt nie ma żadnych napisów ani logo — nie dodawaj własnych.");
  }

  if (m.accessories.length) {
    lines.push(`Akcesoria w zestawie dokładnie takie i w takiej liczbie: ${m.accessories
      .map((a) => `${a.name} × ${a.count}${a.color ? ` (${a.color})` : ""}`).join(", ")}.`);
  }
  if (m.scale.dimensions) lines.push(`Zachowaj realną skalę produktu: ${m.scale.dimensions}.`);
  if (m.critical_features.length) lines.push(`Kluczowe cechy, które muszą być zachowane: ${m.critical_features.join("; ")}.`);
  lines.push("Nie łącz cech z różnych zdjęć referencyjnych w jedną hybrydę. Przy jakiejkolwiek rozbieżności między referencjami wzorem jest zdjęcie główne.");
  for (const c of lock.conflicts) lines.push(`Rozbieżność w referencjach rozstrzygnięta: ${c.resolution}.`);

  return ["Dokładne odwzorowanie produktu:", ...lines].join("\n");
}

/* ── template_human_realism_block + template_constraints_block ─────────── */

const HUMAN_REALISM_PL =
  "Jeśli w kadrze jest człowiek lub dłoń: pełen fotorealizm — naturalna skóra z widoczną fakturą, porami i naturalnymi lekkimi przebarwieniami, realistyczne włosy, poprawna anatomia. " +
  "Każda widoczna dłoń ma dokładnie pięć palców, naturalny chwyt, widoczną fakturę skóry i paznokci; palce realnie dotykają produktu i nigdy przez niego nie przenikają. Zero plastikowego wyglądu.";

export function templateConstraintsBlock(opts: { humanPresence: boolean }): string {
  const lines = [
    "Nie dodawaj żadnych napisów, liczb, znaków wodnych, logotypów ani grafik poza napisami widocznymi na samym produkcie.",
    "Produkt nie lewituje: pełny kontakt z podłożem lub dłonią i poprawny cień kontaktowy bezpośrednio pod produktem.",
    "Nie zmieniaj liczby elementów produktu ani zestawu.",
    "Żadnych dodatkowych obiektów niezgodnych z produktem i opisaną sceną.",
    "Jedno spójne zdjęcie — bez kolażu i bez dzielenia kadru, chyba że opis ujęcia wyraźnie tego wymaga.",
    "Zdjęcie ma wyglądać jak prawdziwa fotografia reklamowa, nie jak render 3D, grafika ani ilustracja.",
  ];
  if (opts.humanPresence) lines.push(HUMAN_REALISM_PL);
  return ["Ograniczenia:", ...lines.map((l) => `- ${l}`)].join("\n");
}

/* ── template_scene_block_dynamic ──────────────────────────────────────── */

/** The variable "[Tu należy opisać co ma być widoczne na zdjęciu]" section.
 *  Normally the planner writes it (scene_text_pl); this fallback renders a
 *  concrete Polish description from the concept's structured fields so QA can
 *  always repair a too-generic card without losing the ordered count. */
export function sceneTextFallback(c: SceneConcept, identity: string): string {
  const bits = [
    `Jest to ${identity}.`,
    c.scene_description ? `Scena: ${c.scene_description}` : "",
    c.environment ? `Otoczenie: ${c.environment}.` : "",
    c.product_placement ? `Ułożenie produktu: ${c.product_placement}` : "",
    c.human_presence && c.human_interaction ? `Osoba w kadrze: ${c.human_interaction}` : "",
    `Perspektywa i kadr: ${c.camera_angle}, dystans ${c.camera_distance}.`,
    c.lighting ? `Światło: ${c.lighting}.` : "",
  ].filter(Boolean);
  return bits.join(" ");
}

/* ── the composer ──────────────────────────────────────────────────────── */

export type TemplatePromptInput = {
  concept: SceneConcept;
  manifest: FeatureManifest;
  lock: ProductLock;
  aspectRatio: string;
  category: SceneryCategory;
  brandDomainPl: string;
};

/** SECTION ORDER (the PDF's order, extended): intro → scenery (with format
 *  composition) → exact product fidelity → the concrete shot → constraints. */
export function composeTemplatePrompt(input: TemplatePromptInput): string {
  const { concept: c, manifest: m, lock } = input;
  const sceneText = (c.scene_text_pl ?? "").trim() || sceneTextFallback(c, m.identity);
  return [
    templateIntro(),
    `${templateSceneryBlock(input.category, input.brandDomainPl)}\n${templateCompositionLine(input.aspectRatio)}`,
    templateFidelityBlock(m, lock),
    `Ujęcie:\n${sceneText}`,
    templateConstraintsBlock({ humanPresence: c.human_presence }),
  ].join("\n\n");
}

/* ── QA VALIDATION ─────────────────────────────────────────────────────── */

/** A stored prompt must be a complete house-style advertising prompt — never
 *  a bare fragment like "szara sofa w salonie". */
export function validateTemplatePrompt(prompt: string): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (!prompt.startsWith("Stwórz zdjęcie reklamowe.")) problems.push("missing_intro");
  if (!prompt.includes("Sceneria:")) problems.push("missing_scenery");
  if (!prompt.includes("Ultra realistic, 8k, cinematic daylight")) problems.push("missing_quality_signature");
  if (!prompt.includes("Dokładne odwzorowanie produktu:")) problems.push("missing_fidelity");
  if (!prompt.includes("Ograniczenia:")) problems.push("missing_constraints");
  const scene = prompt.split("Ujęcie:")[1]?.split("Ograniczenia:")[0]?.trim() ?? "";
  if (scene.length < 100) problems.push("scene_too_generic");
  return { ok: problems.length === 0, problems };
}
