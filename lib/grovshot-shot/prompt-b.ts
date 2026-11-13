/**
 * GROVBASE SHOT — PROMPT B: "the photos ARE the product" (13.11.2026).
 *
 * Why (diagnosis on the PROD orders of 07.11 and 13.11, nutcracker / Tefal /
 * bag): the reference photos reached Nano Banana Pro intact and in order,
 * yet the prompt A around them was 2.4–4.4 k characters in which the product
 * was RE-DESCRIBED in words three to four times (binding, PRODUKT, STAN,
 * KADR, risks in NEGATIVE), flag rules written for other categories were
 * pasted verbatim (`swieci` — grow lamps — on a figurine and an air fryer:
 * "glowing elements glow a uniform saturated colour along their whole
 * length"; `elektronika`: "neutral or cool light" inside a warm Christmas
 * recipe), the NEGATIVE named the very objects it meant to keep out
 * ("druga figurka", "druga kula", "figurka w rozmiarze człowieka", "bordo",
 * "granat") — the image model has no negative channel, every word is
 * context — and the scale anchors written by the text model contradicted
 * the dimensions ("half the height of a door" for 50 cm = 100 cm; "twice a
 * cup" = ~16 cm), which is exactly the shot a regeneration fixed for the
 * product and broke for the size.
 *
 * Prompt B keeps the same modules (no extra paid call) but assembles them in
 * the order of authority, each kept short, once:
 *
 *   1. WIĄZANIE   which pictures ARE this product (and what the others are);
 *                 appearance comes from the photos, not from the category
 *   2. PRODUKT    only what is easy to confuse (the module itself, ≤ 60 words)
 *   3. SCENA      the recipe's genre line, the moment, the person, the set
 *   4. KADR I SKALA  the frame; the size from the card's own numbers plus ONE
 *                 anchor computed by code (always arithmetically right) —
 *                 proportion claims elsewhere are dropped
 *   5. OGRANICZENIA  short, positive, no foreign objects named
 *
 * Kept from the knowledge base: the recipe (its genre line), the footers,
 * and the flag blocks that describe the SCENE or protect fidelity (soft
 * product size, pastel colour, season, pets, passive products, mist).
 * Left out: `swieci` and `elektronika` (they re-light and re-colour the
 * product), the NEGATIVE list, the card's risks as text. Pure.
 */
import { pickFooter, recipeById, type KbParsed } from "@/lib/grovshot-shot/kb";
import type { CardPhoto, ProductCard } from "@/lib/grovshot-shot/card";
import type { PlanShot } from "@/lib/grovshot-shot/plan";
import { formOf, type RefDecisionV2 } from "@/lib/grovshot-shot/refs";
import { PRODUCT_PREFIX, wordCount, type PromptModule, type ProductModules, type SceneModules } from "@/lib/grovshot-shot/prompt";

export const PROMPT_B_VERSION = "b1";
export const B_LIMITS = {
  product: 60, genre: 45, moment: 45, person: 30, set: 55, state: 30, frame: 60, detail: 110, dims: 25,
} as const;
/** Flag blocks that describe the scene or protect the product's own look. */
export const B_KEEP_FLAGS = new Set(["miekki", "pastelowy", "sezonowy", "sezon_uzycia", "dla_zwierzat", "pasywny", "mgielka"]);

/** Sentences end at . ! ? followed by a capital letter — "ok. 3 m", "np. kubek", "35 mm. Figurka" split right. */
const sentences = (t: string) => t.split(/(?<=[.!?])\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ„"])/).map((x) => x.trim()).filter(Boolean);

/** Whole sentences up to `max` words; the first sentence is kept whole even when longer (never cut mid-sentence). */
export function capSentences(t: string, max: number): string {
  const out: string[] = [];
  let words = 0;
  for (const x of sentences(t)) {
    const w = wordCount(x);
    if (out.length > 0 && words + w > max) break;
    out.push(x);
    words += w;
  }
  return out.join(" ");
}

/** Size claims the text model writes into scene modules; in B the size has ONE source (scaleBlock). */
const PROPORTION = /(propor|razy (wy[żz]sz|ni[żz]sz|wi[ęe]ksz|mniejsz|d[łl]u[żz]sz)|si[ęe]ga (do|mniej|wy)|po[łl]ow[aęy] (wysoko|d[łl]ugo|szeroko)|wysoko[śs]ci (drzwi|klamki|okna|ramy|sto[łl]u|blatu|kolan|pasa|bioder|ramion|podbr)|wielko[śs]ci (talerza|d[łl]oni|kubka|fili[żz]anki|jab[łl]ka|kartki))/i;
export function stripProportionClaims(t: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const kept = sentences(t).filter((x) => { if (PROPORTION.test(x)) { removed.push(x); return false; } return true; });
  return { text: kept.join(" "), removed };
}

/**
 * The frame's own arithmetic: "odległość 3 m, obiektyw 35 mm, figurka
 * zajmuje 45% wysokości kadru" puts a 78 cm object in a 16:9 frame — for a
 * 50 cm product. The model resolves such a contradiction by resizing the
 * product. Full-frame equivalent (36 × 24 mm), the frame's height at the
 * stated distance; a share that implies a size outside ×0.65–×1.5 of the
 * card's is dropped (distance and lens stay, they are consistent cues).
 */
export function framingCheck(kadr: string, heightCm: number | null, aspectRatio: string | null): { text: string; removed: string[]; implied: number | null } {
  const dist = /odleg[łl]o[śs][ćc][^\d]{0,14}(\d+(?:[.,]\d+)?)\s*m\b/i.exec(kadr);
  const lens = /obiektyw[^\d]{0,8}(\d{2,3})\s*mm/i.exec(kadr);
  const share = /(\d{1,3})\s*%\s*wysoko[śs]ci kadru/i.exec(kadr);
  if (!heightCm || !dist || !lens || !share) return { text: kadr, removed: [], implied: null };
  const [w, h] = (aspectRatio ?? "3:2").split(":").map(Number);
  const ar = w > 0 && h > 0 ? w / h : 1.5;
  const sensorV = ar >= 1 ? Math.min(24, 36 / ar) : Math.min(36, 24 / ar);
  const frameCm = Number(dist[1].replace(",", ".")) * 100 * (sensorV / Number(lens[1]));
  const implied = Math.round((Number(share[1]) / 100) * frameCm);
  const ratio = implied / heightCm;
  if (ratio >= 0.65 && ratio <= 1.5) return { text: kadr, removed: [], implied };
  // Only the share goes; the composition around it ("w centrum kadru") stays.
  const clause = /,?\s*(?:zajmuje|wype[łl]nia|ma)\s+(?:ok\.\s*|oko[łl]o\s*)?\d{1,3}\s*%\s*wysoko[śs]ci kadru/i;
  const m = clause.exec(kadr);
  if (m) return { text: kadr.replace(clause, "").replace(/\s+,/g, ",").replace(/,\s*\./g, ".").replace(/\s{2,}/g, " ").trim(), removed: [m[0].replace(/^,\s*/, "")], implied };
  const removed: string[] = [];
  const kept = sentences(kadr).filter((x) => { if (/%\s*wysoko[śs]ci kadru/i.test(x)) { removed.push(x); return false; } return true; });
  return { text: kept.join(" "), removed, implied };
}

const fmt = (x: number) => (Math.round(x * 10) / 10).toLocaleString("pl-PL");
/** Everyday objects whose size a model knows, in cm. */
const ANCHORS: { name: string; cm: number; dim: "h" | "l" }[] = [
  { name: "dłoni dorosłej osoby", cm: 18, dim: "l" },
  { name: "kubka", cm: 10, dim: "h" },
  { name: "kartki A4 ustawionej pionowo", cm: 30, dim: "h" },
  { name: "butelki wody 1,5 l", cm: 33, dim: "h" },
  { name: "stołu", cm: 75, dim: "h" },
  { name: "drzwi wewnętrznych", cm: 200, dim: "h" },
];
const DIM = { h: { nom: "wysokość", gen: "wysokości" }, l: { nom: "długość", gen: "długości" } } as const;
const FRACTIONS: [number, string][] = [[0.25, "1/4"], [1 / 3, "1/3"], [0.5, "połowa"], [2 / 3, "2/3"], [0.75, "3/4"]];

/** One anchor, chosen so the ratio is easy to picture (≈ 0.5–3×), computed from the card's number. */
export function codeAnchor(cm: number): string | null {
  if (!(cm > 0)) return null;
  let best: { a: (typeof ANCHORS)[number]; r: number } | null = null;
  for (const a of ANCHORS) {
    const r = cm / a.cm;
    if (r < 0.45 || r > 3.2) continue;
    // Closest to ~1.25× (easy to picture), heights before a hand.
    const score = (x: { a: (typeof ANCHORS)[number]; r: number }) => Math.abs(Math.log(x.r / 1.25)) + (x.a.dim === "l" ? 0.15 : 0);
    if (!best || score({ a, r }) < score(best)) best = { a, r };
  }
  if (!best) return null;
  const { a, r } = best;
  const d = DIM[a.dim];
  if (r < 0.85) {
    const f = FRACTIONS.reduce((x, y) => (Math.abs(y[0] - r) < Math.abs(x[0] - r) ? y : x));
    return `ok. ${f[1]} ${d.gen} ${a.name} (${a.cm} cm)`;
  }
  if (r <= 1.15) return `mniej więcej ${d.nom} ${a.name} (${a.cm} cm)`;
  return `ok. ${fmt(Math.round(r * 2) / 2)} × ${d.nom} ${a.name} (${a.cm} cm)`;
}

/** The size: the card's own numbers, and one code anchor. */
export function scaleBlock(card: ProductCard): string {
  const w = card.wymiary;
  const parts = [
    w.wysokosc_cm ? `wysokość ${fmt(w.wysokosc_cm)} cm` : null,
    w.szerokosc_cm ? `szerokość ${fmt(w.szerokosc_cm)} cm` : null,
    w.glebokosc_cm ? `głębokość ${fmt(w.glebokosc_cm)} cm` : null,
  ].filter(Boolean) as string[];
  const dims = parts.length ? parts.join(", ") : capSentences(w.tekst, B_LIMITS.dims);
  if (!dims) return "";
  const main = w.wysokosc_cm ?? Math.max(w.szerokosc_cm ?? 0, w.glebokosc_cm ?? 0);
  const anchor = main ? codeAnchor(main) : null;
  const assumed = w.zrodlo === "zalozenie" ? " (orientacyjnie)" : "";
  return `Rzeczywisty rozmiar produktu: ${dims}${assumed}${anchor ? `, czyli ${anchor}` : ""}. Zachowaj tę skalę względem otoczenia i ludzi.`;
}

const shortName = (card: ProductCard) =>
  card.produkt.nazwa.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim().slice(0, 90).replace(/[,;:\s]+$/, "");
const listPl = (ns: number[]) => (ns.length <= 1 ? String(ns[0] ?? "") : `${ns.slice(0, -1).join(", ")} i ${ns[ns.length - 1]}`);
const opisOf = (p: CardPhoto | undefined) => (p?.widok ?? "").replace(/[()]/g, "").split(/[,;]/)[0].slice(0, 70).trim();

/** Which picture is what — built from the card, for ANY reference list (also prompt A's, for a like-for-like test). */
export function bindingB(card: ProductCard, refs: number[], aux: number[], pattern: "full" | "detail"): string {
  const byN = new Map(card.zdjecia.map((p) => [p.n, p]));
  const pos = (n: number) => refs.indexOf(n) + 1;
  const name = shortName(card);
  const isWhole = (n: number) => { const p = byN.get(n); return !!p && p.rola === "calosc" && formOf(p) === "zdjecie" && !aux.includes(n); };
  const lines: string[] = [];
  if (pattern === "detail") {
    const main = refs[0];
    lines.push(`Zdjęcie 1 to fotografia fragmentu tego produktu (${name}): ${opisOf(byN.get(main))}. Odtwórz ten fragment dokładnie tak jak na zdjęciu 1 – kształt, kolory, materiał, liczbę i układ elementów; zmień tylko tło i światło.`);
    const ctx = refs.slice(1).filter(isWhole);
    if (ctx.length) lines.push(`${ctx.length > 1 ? "Zdjęcia" : "Zdjęcie"} ${listPl(ctx.map(pos))} ${ctx.length > 1 ? "pokazują" : "pokazuje"} cały produkt – tylko dla zgodności kolorów i materiałów.`);
    for (const n of refs.slice(1)) if (!isWhole(n) && !aux.includes(n)) lines.push(`Zdjęcie ${pos(n)} pokazuje inny fragment tego samego produktu (${opisOf(byN.get(n))}).`);
  } else {
    const wholes = refs.filter(isWhole);
    const list = listPl(wholes.map(pos));
    lines.push(wholes.length > 1
      ? `Zdjęcia ${list} to fotografie dokładnie tego produktu: ${name}.`
      : `Zdjęcie ${list || 1} to fotografia dokładnie tego produktu: ${name}.`);
    lines.push("Umieść w scenie ten sam przedmiot, odwzorowany wiernie według zdjęć: kształt i budowa, proporcje, kolory, materiały, liczba i układ elementów, napisy i logo w ich miejscach. Wygląd produktu bierz ze zdjęć, a nie z wyobrażenia o typowym produkcie tej kategorii.");
    for (const n of refs) {
      if (wholes.includes(n) || aux.includes(n)) continue;
      const p = byN.get(n);
      lines.push(p?.rola === "uzycie"
        ? `Zdjęcie ${pos(n)} pokazuje sposób użycia tego samego produktu (${opisOf(p)}) – odwzoruj ułożenie, wygląd produktu bierz ze zdjęć całości.`
        : `Zdjęcie ${pos(n)} pokazuje fragment tego samego produktu (${opisOf(p)}) – to część tego jednego przedmiotu, nie osobny obiekt.`);
    }
  }
  for (const n of aux) lines.push(`Zdjęcie ${pos(n)} to grafika pomocnicza: bierz z niej tylko wygląd produktu, bez strzałek, linii, liczb i napisów.`);
  return lines.join(" ");
}

export type AssembledPromptB = {
  text: string; modules: PromptModule[]; footer: string; pattern: "full" | "detail"; variant: "b"; version: string;
  binding: string; notes: { removed_proportion: string[]; flags_dropped: string[]; flags_kept: string[]; product_words: number };
};

/** The final prompt B of one shot — exactly what the image model receives. */
export function assemblePromptB(o: {
  kb: KbParsed; card: ProductCard; shot: Pick<PlanShot, "typ" | "ludzie" | "caly_produkt">; product: ProductModules; scene: SceneModules;
  refs: Pick<RefDecisionV2, "refs" | "aux">;
  /** The order's format ("16:9") — the frame arithmetic needs it. */
  aspectRatio?: string | null;
}): AssembledPromptB {
  const { kb, card, shot, scene } = o;
  const recipe = recipeById(kb, card.przepis_stylu);
  if (!recipe) throw new Error("recipe_missing");
  const footer = pickFooter(kb, { type: shot.typ, people: shot.ludzie }, { recipeId: recipe.id, flags: card.flagi });
  const pattern: "full" | "detail" = shot.typ === "detal" ? "detail" : "full";
  const removed: string[] = [];
  const clean = (t: string, max: number) => {
    // "(Z4)" is the card's internal photo id — the image model knows only "zdjęcie N".
    const r = stripProportionClaims(t.replace(/\s*\(Z\d{1,2}\)/g, "").replace(/\bZ\d{1,2}\b/g, "").replace(/[ \t]{2,}/g, " "));
    removed.push(...r.removed);
    return capSentences(r.text, max);
  };
  const binding = bindingB(card, o.refs.refs, o.refs.aux, pattern);
  // The recipe's genre line + "a real photo" — its light rules stay with the scene writer.
  const genre = capSentences(recipe.direction, B_LIMITS.genre);
  const modules: PromptModule[] = [{ name: "WIĄZANIE ZDJĘĆ", source: "code", text: binding }];
  const flags = new Set(card.flagi);
  const kept = kb.special.filter((sp) => flags.has(sp.flag) && sp.block && B_KEEP_FLAGS.has(sp.flag));
  const dropped = kb.special.filter((sp) => flags.has(sp.flag) && sp.block && !B_KEEP_FLAGS.has(sp.flag)).map((sp) => sp.flag);
  let productWords = 0;
  if (pattern === "detail") {
    modules.push({ name: "DETAL", source: "model", text: clean(scene.detal, B_LIMITS.detail) });
    modules.push({ name: "SCENA", source: "kb", text: genre });
    modules.push({ name: "KADR", source: "model", text: clean(scene.kadr, B_LIMITS.frame) });
    modules.push({ name: "OGRANICZENIA", source: "code", text: `Tylko ten fragment produktu, ostry i dokładnie jak na zdjęciu 1. Rekwizyty gładkie, bez napisów i logo. ${footer.text}` });
  } else {
    const body = o.product.produkt.startsWith(PRODUCT_PREFIX) ? o.product.produkt.slice(PRODUCT_PREFIX.length).trim() : o.product.produkt;
    const product = capSentences(body.split(/(?<=[.!?])\s+/).filter((x) => !/(nie jest|to nie|nie mylić|nie pomylić)/i.test(x)).join(" "), B_LIMITS.product);
    productWords = wordCount(product);
    if (product) modules.push({ name: "PRODUKT", source: "model", text: `Cechy, których nie wolno pomylić: ${product}` });
    const sceneText = [
      genre,
      clean(scene.moment, B_LIMITS.moment),
      shot.ludzie !== "brak" && scene.postac ? clean(scene.postac, B_LIMITS.person) : "",
      clean(scene.scenografia, B_LIMITS.set),
      scene.stan_chwyt ? clean(scene.stan_chwyt, B_LIMITS.state) : "",
      ...kept.map((sp) => sp.block as string),
    ].filter(Boolean).join(" ");
    modules.push({ name: "SCENA", source: "model", text: sceneText });
    const scale = scaleBlock(card);
    const framed = framingCheck(clean(scene.kadr, B_LIMITS.frame), card.wymiary.wysokosc_cm, o.aspectRatio ?? null);
    removed.push(...framed.removed);
    modules.push({ name: "KADR I SKALA", source: "model", text: [framed.text, scale].filter(Boolean).join(" ") });
    const whole = shot.typ === "hero" || shot.caly_produkt;
    const many = flags.has("wiele_sztuk");
    const constraints = [
      many ? "Produkt w liczbie sztuk takiej jak na zdjęciach." : "Jeden egzemplarz produktu.",
      whole ? "Produkt widoczny w całości, niczym niezasłonięty, ostry." : "Produkt ostry i rozpoznawalny.",
      shot.ludzie !== "brak" ? "Ludzie naturalni, z poprawnymi dłońmi, nie patrzą w obiektyw." : "",
      "Rekwizyty gładkie, bez napisów i logo. Wnętrza europejskie, bez flar i słońca w kadrze.",
      footer.text,
    ].filter(Boolean).join(" ");
    modules.push({ name: "OGRANICZENIA", source: "code", text: constraints });
  }
  const final = modules.filter((m) => m.text.trim());
  return {
    text: final.map((m) => m.text).join("\n\n"), modules: final, footer: footer.key, pattern, variant: "b", version: PROMPT_B_VERSION,
    binding, notes: { removed_proportion: removed, flags_dropped: dropped, flags_kept: kept.map((sp) => sp.flag), product_words: productWords },
  };
}
