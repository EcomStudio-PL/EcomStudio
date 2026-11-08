/**
 * GROVBASE SHOT — STEP 4: THE PROMPT, assembled by code from modules.
 *
 *   KIERUNEK      knowledge base, the order's recipe (verbatim)
 *   PRODUKT       Claude, once per order (call 1)
 *   SKALA         Claude, once per order (call 1)
 *   reguły spec.  knowledge base, the card's flags (verbatim)
 *   STAN / CHWYT, MOMENT, KADR, POSTAĆ, SCENOGRAFIA
 *                 Claude, every shot at once (call 2)
 *   STOPKA        knowledge base, picked by code (shot type, recipe, flag, people)
 *   NEGATIVE      knowledge base + the card's risks + the recipe's and the
 *                 shot's additions + what the referenced photos must not lend
 *
 * A detail shot takes the shorter pattern: KIERUNEK, the detail copied 1:1
 * from its reference, KADR, the detail footer, NEGATIVE. Nothing else is
 * ever added — the stored text is exactly what Nano Banana Pro receives. Pure.
 *
 * Since 2026-11-08 (the B diagnosis) every prompt OPENS with the image-binding
 * block (refs.ts, numbered from the final reference order), PRODUKT starts
 * with "Produkt identyczny jak na zdjęciach referencyjnych." and stays short,
 * a sentence repeated across modules is said once, and the negative keeps a
 * bounded list (card risks and scene additions capped).
 */
import { pickFooter, recipeById, type KbParsed } from "@/lib/grovshot-shot/kb";
import type { ProductCard } from "@/lib/grovshot-shot/card";
import type { PlanShot } from "@/lib/grovshot-shot/plan";
import { bindingBlock, type RefDecision } from "@/lib/grovshot-shot/refs";

export type ProductModules = { produkt: string; skala: string };
export type SceneModules = {
  numer: number; stan_chwyt: string; moment: string; kadr: string; postac: string; scenografia: string; detal: string; negative_dopiski: string[];
};
export type PromptModule = { name: string; source: "kb" | "model" | "code"; text: string };
export type AssembledPrompt = { text: string; modules: PromptModule[]; footer: string; pattern: "full" | "detail" };

export const PRODUCT_MAX = 3_000;
export const MODULE_MAX = 1_500;
export const PRODUCT_PREFIX = "Produkt identyczny jak na zdjęciach referencyjnych.";
export type PromptLimits = { productWords: number; scaleWords: number };
export const DEFAULT_PROMPT_LIMITS: PromptLimits = { productWords: 60, scaleWords: 45 };
const RISKS_MAX = 5;
const SCENE_NEGATIVE_MAX = 6;
const NEGATIVE_ITEM_MAX = 120;

export const wordCount = (t: string) => t.split(/\s+/).filter(Boolean).length;
/** Words after the fixed first sentence of PRODUKT. */
const productBodyWords = (t: string) => wordCount(t.startsWith(PRODUCT_PREFIX) ? t.slice(PRODUCT_PREFIX.length) : t);
const NEGATED = /(^|[\s.,;:])(nie jest|to nie|nie mylić|nie pomylić)\b/i;

/** At most `max` words, cut at the last full sentence that fits (never mid-sentence when one fits). */
export function trimWords(t: string, max: number): string {
  if (wordCount(t) <= max) return t;
  const sentences = t.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [t];
  let out = "";
  for (const x of sentences) {
    const next = `${out} ${x.trim()}`.trim();
    if (wordCount(next) > max) break;
    out = next;
  }
  return out || t.split(/\s+/).slice(0, max).join(" ");
}

/** PRODUKT as the image model must get it: the fixed first sentence, then at most N words. */
export function normalizeProduct(m: ProductModules, limits: PromptLimits = DEFAULT_PROMPT_LIMITS): { modules: ProductModules; trimmed: boolean } {
  let body = m.produkt.startsWith(PRODUCT_PREFIX) ? m.produkt.slice(PRODUCT_PREFIX.length).trim() : m.produkt;
  // Sentences that name what the product is NOT invite exactly that object into the picture.
  body = (body.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [body]).map((x) => x.trim()).filter((x) => x && !NEGATED.test(x)).join(" ");
  const cut = trimWords(body, limits.productWords);
  const skala = trimWords(m.skala, limits.scaleWords);
  return { modules: { produkt: `${PRODUCT_PREFIX} ${cut}`.trim(), skala }, trimmed: cut !== body || skala !== m.skala };
}

const s = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, " ").trim().slice(0, max + 1) : "");
const o = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});

/**
 * `errors` make the module unusable (sent back to Claude once). `notes` are
 * what the code itself fixes at assembly (normalizeProduct: the fixed first
 * sentence, the word limits, sentences naming what the product is not) —
 * recorded, never worth a second paid call.
 */
export function checkProductModules(raw: unknown, limits: PromptLimits = DEFAULT_PROMPT_LIMITS): { modules: ProductModules | null; errors: string[]; notes: string[] } {
  const r = o(raw);
  const produkt = s(r.produkt, PRODUCT_MAX);
  const skala = s(r.skala, MODULE_MAX);
  const errors: string[] = [];
  const notes: string[] = [];
  if (!produkt || !skala) {
    if (!produkt) errors.push("produkt: pusty moduł PRODUKT");
    if (!skala) errors.push("skala: pusty moduł SKALA");
    return { modules: null, errors, notes };
  }
  if (!produkt.startsWith(PRODUCT_PREFIX)) notes.push("product_prefix_added");
  if (productBodyWords(produkt) > limits.productWords) notes.push(`product_trimmed:${productBodyWords(produkt)}>${limits.productWords}`);
  if (NEGATED.test(produkt)) notes.push("product_negation_removed");
  if (wordCount(skala) > limits.scaleWords) notes.push(`scale_trimmed:${wordCount(skala)}>${limits.scaleWords}`);
  return { modules: { produkt, skala }, errors, notes };
}

/** Every planned shot needs its modules; a detail its DETAL, the others MOMENT, KADR, SCENOGRAFIA (POSTAĆ when people are in it). */
export function checkSceneModules(raw: unknown, shots: PlanShot[]): { modules: Map<number, SceneModules>; errors: string[]; missing: number[] } {
  const list = Array.isArray(o(raw).ujecia) ? o(raw).ujecia as unknown[] : [];
  const byNumber = new Map<number, SceneModules>();
  const errors: string[] = [];
  for (const item of list) {
    const x = o(item);
    const numer = Number(x.numer);
    if (!Number.isInteger(numer) || !shots.some((y) => y.numer === numer)) { errors.push(`ujecia: nieznany numer ${String(x.numer)}`); continue; }
    if (byNumber.has(numer)) { errors.push(`ujęcie ${numer}: podane więcej niż raz`); continue; }
    byNumber.set(numer, {
      numer, stan_chwyt: s(x.stan_chwyt, MODULE_MAX), moment: s(x.moment, MODULE_MAX), kadr: s(x.kadr, MODULE_MAX),
      postac: s(x.postac, MODULE_MAX), scenografia: s(x.scenografia, MODULE_MAX), detal: s(x.detal, MODULE_MAX),
      negative_dopiski: Array.isArray(x.negative_dopiski) ? x.negative_dopiski.map((y) => s(y, NEGATIVE_ITEM_MAX)).filter(Boolean).slice(0, SCENE_NEGATIVE_MAX) : [],
    });
  }
  const ok = new Map<number, SceneModules>();
  const missing: number[] = [];
  for (const shot of shots) {
    const m = byNumber.get(shot.numer);
    const at = `ujęcie ${shot.numer}`;
    const problems: string[] = [];
    if (!m) problems.push(`${at}: brak modułów`);
    else {
      const long = (Object.entries(m) as [string, unknown][]).filter(([, v]) => typeof v === "string" && v.length > MODULE_MAX).map(([k]) => k);
      if (long.length) problems.push(`${at}: moduły dłuższe niż ${MODULE_MAX} znaków: ${long.join(", ")}`);
      if (shot.typ === "detal") {
        if (!m.detal) problems.push(`${at} (detal): pusty moduł DETAL`);
        if (!m.kadr) problems.push(`${at} (detal): pusty moduł KADR`);
      } else {
        for (const k of ["moment", "kadr", "scenografia"] as const) if (!m[k]) problems.push(`${at}: pusty moduł ${k.toUpperCase()}`);
        if (shot.ludzie !== "brak" && !m.postac) problems.push(`${at}: pusty moduł POSTAĆ (ludzie: ${shot.ludzie})`);
      }
    }
    if (problems.length) { errors.push(...problems); missing.push(shot.numer); } else ok.set(shot.numer, m!);
  }
  return { modules: ok, errors, missing };
}

const key = (x: string) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9ł]+/g, " ").trim();
const dedupe = (xs: string[]) => {
  const seen = new Set<string>();
  return xs.map((x) => x.trim()).filter((x) => {
    const k = key(x);
    if (!x || !k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/** A sentence already said by an earlier module is not said again (later modules lose it). */
function onceEach(modules: PromptModule[]): PromptModule[] {
  const said = new Set<string>();
  return modules.map((m) => {
    if (m.name === "NEGATIVE" || m.name === "WIĄZANIE ZDJĘĆ") return m;
    const parts = m.text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [m.text];
    const kept = parts.filter((p) => {
      const k = key(p);
      if (k.length < 12) return true;
      if (said.has(k)) return false;
      said.add(k);
      return true;
    });
    return { ...m, text: kept.map((p) => p.trim()).join(" ").trim() };
  }).filter((m) => m.text);
}

export type AssembleRefs = Pick<RefDecision, "refs" | "aux">;

/** The final prompt of one shot — exactly what the image model receives. */
export function assemblePrompt(o2: {
  kb: KbParsed; card: ProductCard; shot: PlanShot; product: ProductModules; scene: SceneModules;
  /** The FINAL references (refs.ts) — the binding block is numbered from them. Absent: the plan's own, as planned. */
  refs?: AssembleRefs;
  limits?: PromptLimits;
}): AssembledPrompt & { binding: string; bindingSource: "kb" | "default"; productTrimmed: boolean } {
  const { kb, card, shot, scene } = o2;
  const refs = o2.refs ?? { refs: shot.referencje, aux: [] };
  const recipe = recipeById(kb, card.przepis_stylu);
  if (!recipe) throw new Error("recipe_missing");
  const footer = pickFooter(kb, { type: shot.typ, people: shot.ludzie }, { recipeId: recipe.id, flags: card.flagi });
  const noCopy = refs.refs.flatMap((n) => card.zdjecia.find((p) => p.n === n)?.nie_kopiowac ?? []);
  const negative = dedupe([
    ...kb.negativeItems, ...card.ryzyka.slice(0, RISKS_MAX).map((x) => x.slice(0, NEGATIVE_ITEM_MAX)), ...recipe.negative,
    ...noCopy.map((x) => x.slice(0, NEGATIVE_ITEM_MAX)), ...scene.negative_dopiski.slice(0, SCENE_NEGATIVE_MAX),
  ]);
  const pattern: AssembledPrompt["pattern"] = shot.typ === "detal" ? "detail" : "full";
  const binding = bindingBlock(kb, card, refs.refs, refs.aux, pattern);
  const product = normalizeProduct(o2.product, o2.limits);
  const modules: PromptModule[] = [
    { name: "WIĄZANIE ZDJĘĆ", source: binding.source === "kb" ? "kb" : "code", text: binding.text },
    { name: "KIERUNEK", source: "kb", text: recipe.direction },
  ];
  if (pattern === "detail") {
    modules.push({ name: "DETAL", source: "model", text: scene.detal }, { name: "KADR", source: "model", text: scene.kadr });
  } else {
    modules.push({ name: "PRODUKT", source: "model", text: product.modules.produkt }, { name: "SKALA", source: "model", text: product.modules.skala });
    const flags = new Set(card.flagi);
    for (const sp of kb.special) if (flags.has(sp.flag) && sp.block) modules.push({ name: `REGUŁA: ${sp.flag}`, source: "kb", text: sp.block });
    if (scene.stan_chwyt) modules.push({ name: "STAN / CHWYT", source: "model", text: scene.stan_chwyt });
    modules.push({ name: "MOMENT", source: "model", text: scene.moment }, { name: "KADR", source: "model", text: scene.kadr });
    if (shot.ludzie !== "brak" && scene.postac) modules.push({ name: "POSTAĆ", source: "model", text: scene.postac });
    modules.push({ name: "SCENOGRAFIA", source: "model", text: scene.scenografia });
  }
  modules.push({ name: "STOPKA", source: "kb", text: footer.text });
  modules.push({ name: "NEGATIVE", source: "code", text: `Negative: ${negative.join(", ")}.` });
  const final = onceEach(modules);
  return {
    text: final.map((m) => m.text).join("\n\n"), modules: final, footer: footer.key, pattern,
    binding: binding.text, bindingSource: binding.source, productTrimmed: pattern === "full" && product.trimmed,
  };
}
