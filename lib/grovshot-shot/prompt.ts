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
 */
import { pickFooter, recipeById, type KbParsed } from "@/lib/grovshot-shot/kb";
import type { ProductCard } from "@/lib/grovshot-shot/card";
import type { PlanShot } from "@/lib/grovshot-shot/plan";

export type ProductModules = { produkt: string; skala: string };
export type SceneModules = {
  numer: number; stan_chwyt: string; moment: string; kadr: string; postac: string; scenografia: string; detal: string; negative_dopiski: string[];
};
export type PromptModule = { name: string; source: "kb" | "model" | "code"; text: string };
export type AssembledPrompt = { text: string; modules: PromptModule[]; footer: string; pattern: "full" | "detail" };

export const PRODUCT_MAX = 3_000;
export const MODULE_MAX = 1_500;

const s = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, " ").trim().slice(0, max + 1) : "");
const o = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});

export function checkProductModules(raw: unknown): { ok: true; modules: ProductModules } | { ok: false; errors: string[] } {
  const r = o(raw);
  const produkt = s(r.produkt, PRODUCT_MAX);
  const skala = s(r.skala, MODULE_MAX);
  const errors: string[] = [];
  if (!produkt) errors.push("produkt: pusty moduł PRODUKT");
  if (produkt.length > PRODUCT_MAX) errors.push(`produkt: dłuższy niż ${PRODUCT_MAX} znaków`);
  if (!skala) errors.push("skala: pusty moduł SKALA");
  if (skala.length > MODULE_MAX) errors.push(`skala: dłuższa niż ${MODULE_MAX} znaków`);
  return errors.length ? { ok: false, errors } : { ok: true, modules: { produkt, skala } };
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
      negative_dopiski: Array.isArray(x.negative_dopiski) ? x.negative_dopiski.map((y) => s(y, 120)).filter(Boolean).slice(0, 12) : [],
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

const dedupe = (xs: string[]) => {
  const seen = new Set<string>();
  return xs.map((x) => x.trim()).filter((x) => {
    const k = x.toLowerCase();
    if (!x || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/** The final prompt of one shot — exactly what the image model receives. */
export function assemblePrompt(o2: {
  kb: KbParsed; card: ProductCard; shot: PlanShot; product: ProductModules; scene: SceneModules;
}): AssembledPrompt {
  const { kb, card, shot, product, scene } = o2;
  const recipe = recipeById(kb, card.przepis_stylu);
  if (!recipe) throw new Error("recipe_missing");
  const footer = pickFooter(kb, { type: shot.typ, people: shot.ludzie }, { recipeId: recipe.id, flags: card.flagi });
  const noCopy = shot.referencje.flatMap((n) => card.zdjecia.find((p) => p.n === n)?.nie_kopiowac ?? []);
  const negative = dedupe([
    ...kb.negativeItems, ...card.ryzyka, ...recipe.negative, ...noCopy, ...scene.negative_dopiski,
  ]);
  const modules: PromptModule[] = [{ name: "KIERUNEK", source: "kb", text: recipe.direction }];
  let pattern: AssembledPrompt["pattern"] = "full";
  if (shot.typ === "detal") {
    pattern = "detail";
    modules.push({ name: "DETAL", source: "model", text: scene.detal }, { name: "KADR", source: "model", text: scene.kadr });
  } else {
    modules.push({ name: "PRODUKT", source: "model", text: product.produkt }, { name: "SKALA", source: "model", text: product.skala });
    const flags = new Set(card.flagi);
    for (const sp of kb.special) if (flags.has(sp.flag) && sp.block) modules.push({ name: `REGUŁA: ${sp.flag}`, source: "kb", text: sp.block });
    if (scene.stan_chwyt) modules.push({ name: "STAN / CHWYT", source: "model", text: scene.stan_chwyt });
    modules.push({ name: "MOMENT", source: "model", text: scene.moment }, { name: "KADR", source: "model", text: scene.kadr });
    if (shot.ludzie !== "brak" && scene.postac) modules.push({ name: "POSTAĆ", source: "model", text: scene.postac });
    modules.push({ name: "SCENOGRAFIA", source: "model", text: scene.scenografia });
  }
  modules.push({ name: "STOPKA", source: "kb", text: footer.text });
  modules.push({ name: "NEGATIVE", source: "code", text: `Negative: ${negative.join(", ")}.` });
  return { text: modules.map((m) => m.text).join("\n\n"), modules, footer: footer.key, pattern };
}
