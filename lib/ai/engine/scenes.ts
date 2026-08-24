import "server-only";
import { callVisionJson, type VisionBackend, type VisionOutcome } from "./vision";

/**
 * SCENE PLANNER v3 — deliberately small.
 *
 * The planner looks at the product (name, description, extra info) and the
 * numbered reference photos and returns ONLY scenes: a short Polish title, a
 * concrete Polish scene description, whether people appear, and which
 * reference photos the scene should use. It writes no style rules, no
 * lighting language, no prompt engineering — the fixed MASTER TEMPLATE owns
 * all of that. Plain code assembles the final prompt afterwards.
 */

export type PlannedScene = {
  title: string;
  scene_description: string;
  human_presence: boolean;
  reference_indices: number[];
};

export const SCENE_SCHEMA = {
  type: "OBJECT",
  properties: {
    concepts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          scene_description: { type: "STRING" },
          human_presence: { type: "BOOLEAN" },
          reference_indices: { type: "ARRAY", items: { type: "INTEGER" } },
        },
        required: ["title", "scene_description", "human_presence", "reference_indices"],
      },
    },
  },
  required: ["concepts"],
};

export const SCENE_SYSTEM = `Jesteś plannerem ujęć sprzedażowych dla fotografii produktowej e-commerce.
Dostajesz nazwę produktu, jego opis, dodatkowe informacje oraz PONUMEROWANE zdjęcia referencyjne.

Zwracasz WYŁĄCZNIE listę scen — nic więcej:
- title: krótki tytuł ujęcia po polsku (2-4 słowa), zrozumiały dla sprzedawcy.
- scene_description: konkretny opis sceny po polsku, 2-4 zdania: co widać, gdzie stoi lub leży produkt, kto i co z nim robi, jaka perspektywa, jaki benefit sprzedażowy pokazuje kadr. Przykład stylu: "Suszarka spożywcza stoi na wyspie kuchennej. Na blacie kobieta z mężem kroją pieczarki, które zaraz będą suszyć. Perspektywa od góry 3/4 pod kątem 45 stopni."
- human_presence: true, jeśli w scenie występuje człowiek lub dłoń.
- reference_indices: numery zdjęć referencyjnych właściwych dla tej sceny (najlepsze geometryczne ujęcie produktu zawsze na pierwszym miejscu).

Zasady scen:
- Sceny mają być RÓŻNORODNE i dobre sprzedażowo: hero/lifestyle, produkt w użyciu, zastosowanie, detal, close-up, funkcja produktu, premium commercial, techniczne zastosowanie — wybieraj te, które pasują do TEGO produktu.
- Każda scena musi być inna (inne otoczenie, inna perspektywa, inny cel sprzedażowy).
- NIE opisuj stylu fotografii, oświetlenia globalnego ani jakości obrazu — to jest poza Twoim zakresem. Opisujesz wyłącznie treść sceny.
- NIE zmieniaj i nie opisuj wyglądu produktu — produkt definiują zdjęcia referencyjne.`;

/** Two scenes are "the same photo" when their descriptions overlap heavily. */
export function diversityViolations(scenes: PlannedScene[]): number[] {
  const bad: number[] = [];
  for (let i = 0; i < scenes.length; i++) {
    for (let j = 0; j < i; j++) {
      if (similarText(scenes[i].scene_description, scenes[j].scene_description)
        || similarText(scenes[i].title, scenes[j].title)) { bad.push(i); break; }
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
  return common / Math.min(wa.size, wb.size) > 0.65;
}

/** Keep reference indices sane: 1-based, unique, within range, never empty. */
export function clampRefs(scene: PlannedScene, imageCount: number): PlannedScene {
  const seen = new Set<number>();
  const refs = (scene.reference_indices ?? [])
    .map((n) => Math.trunc(n))
    .filter((n) => n >= 1 && n <= imageCount && !seen.has(n) && (seen.add(n), true))
    .slice(0, 6);
  return { ...scene, reference_indices: refs.length > 0 ? refs : [1] };
}

/**
 * EXACT-COUNT BACKSTOP. When the planner returns too few usable scenes, the
 * remaining slots are synthesized deterministically from safe, always-
 * renderable shot patterns — a seller who orders 8 shots gets exactly 8.
 */
const SYNTH_SCENES: { title: string; scene: (p: string) => string }[] = [
  { title: "Packshot studyjny", scene: (p) => `${p} stoi centralnie na eleganckim, jednolitym tle studyjnym z delikatnym gradientem, w całości widoczny w kadrze. Ujęcie 3/4 lekko z góry, czysty packshot premium bez dodatkowych obiektów.` },
  { title: "Zdjęcie główne", scene: (p) => `${p} pokazany frontalnie jako główne zdjęcie oferty, na jasnym neutralnym tle, bez rozpraszaczy. Produkt w całości w kadrze, centralnie.` },
  { title: "Detal produktu", scene: (p) => `Zbliżenie na najbardziej charakterystyczny detal produktu ${p}; detal wypełnia kadr, a reszta produktu jest miękko widoczna w tle. Mała głębia ostrości podkreśla jakość wykonania.` },
  { title: "Ujęcie hero", scene: (p) => `${p} jako bohater kadru stoi na powierzchni premium pasującej do jego kategorii, z delikatną głębią i miękko oświetlonym tłem. Ujęcie 3/4 z lekko niskiej perspektywy.` },
  { title: "Skala produktu", scene: (p) => `${p} stoi na realistycznej powierzchni wnętrza obok znanych przedmiotów codziennego użytku, dzięki czemu od razu widać jego prawdziwy rozmiar. Perspektywa na wysokości oczu.` },
  { title: "Konstrukcja i materiały", scene: (p) => `${p} sfotografowany tak, aby czytelnie pokazać konstrukcję i materiały; każdy element funkcyjny jest widoczny. Ujęcie techniczne z lekkiej góry na czystej powierzchni.` },
];

export function synthesizeScenes(existing: PlannedScene[], missing: number, productName: string, imageCount: number): PlannedScene[] {
  if (missing <= 0) return [];
  const usedTitles = new Set(existing.map((s) => s.title.toLowerCase()));
  const out: PlannedScene[] = [];
  for (const tpl of SYNTH_SCENES) {
    if (out.length >= missing) break;
    if (usedTitles.has(tpl.title.toLowerCase())) continue;
    usedTitles.add(tpl.title.toLowerCase());
    out.push({
      title: tpl.title,
      scene_description: tpl.scene(productName),
      human_presence: false,
      reference_indices: Array.from({ length: Math.min(3, Math.max(1, imageCount)) }, (_, i) => i + 1),
    });
  }
  return out;
}

export async function proposeScenes(
  backends: VisionBackend[],
  images: { base64: string; mime: string }[],
  info: { productName: string; description: string | null; extraInfo: string | null; style: string | null },
  opts?: { count?: number; avoidTitles?: string[] }
): Promise<{ scenes: PlannedScene[]; outcome: VisionOutcome }> {
  const count = opts?.count ?? 5;
  const user = [
    `Produkt: ${info.productName}`,
    info.description ? `Opis produktu: ${info.description}` : "",
    info.extraInfo ? `Dodatkowe informacje: ${info.extraInfo}` : "",
    info.style ? `Preferowany styl sprzedawcy: ${info.style}` : "",
    `Zdjęcia referencyjne są ponumerowane 1-${images.length} w kolejności załączenia.`,
    opts?.avoidTitles?.length ? `NIE proponuj scen podobnych do: ${opts.avoidTitles.join("; ")}` : "",
    `Zaproponuj dokładnie ${count} różnych scen.`,
  ].filter(Boolean).join("\n\n");

  const { data: out, outcome } = await callVisionJson<{ concepts: PlannedScene[] }>(
    backends, { images, system: SCENE_SYSTEM, user, schema: SCENE_SCHEMA }
  );

  let scenes = (out.concepts ?? [])
    .filter((s) => typeof s.title === "string" && s.title.trim().length >= 2
      && typeof s.scene_description === "string" && s.scene_description.trim().length >= 30)
    .map((s) => clampRefs({
      title: s.title.trim(),
      scene_description: s.scene_description.trim(),
      human_presence: !!s.human_presence,
      reference_indices: s.reference_indices ?? [],
    }, images.length));

  const bad = new Set(diversityViolations(scenes));
  scenes = scenes.filter((_, i) => !bad.has(i));

  return { scenes: scenes.slice(0, count), outcome };
}
