/**
 * GROVBASE SHOT — THE REFERENCES OF A SHOT, decided by code (not by Claude).
 *
 * After the B diagnosis (2026-11-08): the image request itself was correct
 * (inline photos, right order, untouched bytes), but whole-product shots were
 * sent with a close-up or a graphic first, a single small photo, or no
 * explicit statement of which picture IS the product. These rules close that:
 *
 *   whole-product shot (every plan type but "detal"):
 *     1. the first references are clean photos of the WHOLE product — the
 *        card's own analysis of each photo (rola "calosc", forma "zdjecie"),
 *        never the plan's label; front first, then 3/4, at most two;
 *     2. the plan's other photos follow (details after the whole product);
 *     3. a graphic (dimension arrows, lines, overlaid text) is never a main
 *        reference: it goes last, marked auxiliary; a collage or a photo with
 *        other products is dropped;
 *     4. at most `max` images (configurable);
 *     5. no clean whole-product photo at all → the shot is BLOCKED (never
 *        generated from a description alone).
 *   detail shot: the planned detail photo stays first; graphics move last as
 *   auxiliary; collages are dropped; the limit applies.
 *
 * Every change is recorded (`corrections`) and the binding block is built
 * from the FINAL order, so "zdjęcie 1" always means the first image part.
 * Pure.
 */
import type { CardPhoto, ProductCard } from "@/lib/grovshot-shot/card";
import type { KbParsed } from "@/lib/grovshot-shot/kb";
import type { PlanShot } from "@/lib/grovshot-shot/plan";

import { PHOTO_FORMS, PHOTO_VIEWS, type PhotoForm, type PhotoView } from "@/lib/grovshot-shot/contract";

export { PHOTO_FORMS, PHOTO_VIEWS };

export type RefCorrection = {
  code: "added_whole" | "moved_whole_first" | "moved_after_whole" | "aux_graphic" | "skipped_graphic" | "limited" | "blocked_no_whole" | "dropped_v2";
  photos: number[];
};
export type RefDecision = { refs: number[]; aux: number[]; corrections: RefCorrection[]; blocked: boolean };

/** What a photo IS — the card's own field, or (cards written before it existed) read from its notes. */
export function formOf(p: CardPhoto): PhotoForm {
  if (p.forma && (PHOTO_FORMS as readonly string[]).includes(p.forma)) return p.forma as PhotoForm;
  const text = `${p.widok} ${p.nie_kopiowac.join(" ")}`.toLowerCase();
  if (/kola[zż]/.test(text)) return "kolaz";
  if (/strza[łl]k|wymiar|linie? techn|napis[a-z]* (na|dodan)|infografik/.test(text)) return "grafika";
  return "zdjecie";
}
export function viewOf(p: CardPhoto): PhotoView {
  if (p.ujecie && (PHOTO_VIEWS as readonly string[]).includes(p.ujecie)) return p.ujecie as PhotoView;
  const w = p.widok.toLowerCase();
  if (/3\s*\/\s*4|trzy czwarte/.test(w)) return "3_4";
  if (/prz[óo]d|front|na wprost/.test(w)) return "przod";
  if (/ty[łl]/.test(w)) return "tyl";
  if (/bok|profil/.test(w)) return "bok";
  if (/g[óo]r/.test(w)) return "gora";
  return "inne";
}

const VIEW_RANK: Record<PhotoView, number> = { przod: 0, "3_4": 1, bok: 2, gora: 3, tyl: 4, inne: 5 };

/** Clean photos of the whole product, best first (front, then 3/4, then the rest; the seller's order on ties). */
export function wholeCandidates(card: ProductCard): number[] {
  return card.zdjecia
    .filter((p) => p.rola === "calosc" && formOf(p) === "zdjecie")
    .sort((a, b) => VIEW_RANK[viewOf(a)] - VIEW_RANK[viewOf(b)] || a.n - b.n)
    .map((p) => p.n);
}

/** The two leading whole-product photos: the best one, and a different view when there is one. */
function leadWhole(card: ProductCard): number[] {
  const all = wholeCandidates(card);
  if (all.length === 0) return [];
  const first = all[0];
  const firstView = viewOf(card.zdjecia.find((p) => p.n === first) as CardPhoto);
  const second = all.find((n) => n !== first && viewOf(card.zdjecia.find((p) => p.n === n) as CardPhoto) !== firstView) ?? all[1];
  return second ? [first, second] : [first];
}

export function selectReferences(shot: Pick<PlanShot, "typ" | "referencje">, card: ProductCard, opts: { max: number }): RefDecision {
  const byN = new Map(card.zdjecia.map((p) => [p.n, p]));
  const planned = [...new Set(shot.referencje)].filter((n) => byN.has(n));
  const corrections: RefCorrection[] = [];
  const graphicsAux: number[] = [];
  const skipped: number[] = [];
  const keep: number[] = [];
  for (const n of planned) {
    const f = formOf(byN.get(n) as CardPhoto);
    if (f === "kolaz" || f === "inne_produkty") skipped.push(n);
    else if (f === "grafika") graphicsAux.push(n);
    else keep.push(n);
  }
  if (skipped.length) corrections.push({ code: "skipped_graphic", photos: skipped });

  let refs: number[];
  if (shot.typ === "detal") {
    // The planned detail stays the first reference — unless it is a graphic and a real photo exists.
    refs = keep.length ? keep : graphicsAux.splice(0, 1);
  } else {
    const lead = leadWhole(card);
    if (lead.length === 0) {
      corrections.push({ code: "blocked_no_whole", photos: [] });
      return { refs: [], aux: [], corrections, blocked: true };
    }
    const added = lead.filter((n) => !planned.includes(n));
    if (added.length) corrections.push({ code: "added_whole", photos: added });
    const misplaced = lead.filter((n, i) => planned.includes(n) && planned.indexOf(n) !== i);
    if (misplaced.length) corrections.push({ code: "moved_whole_first", photos: misplaced });
    const pushedBack = keep.filter((n, i) => i < lead.length && !lead.includes(n));
    if (pushedBack.length) corrections.push({ code: "moved_after_whole", photos: pushedBack });
    refs = [...lead, ...keep.filter((n) => !lead.includes(n))];
  }
  if (graphicsAux.length) corrections.push({ code: "aux_graphic", photos: graphicsAux });
  let aux = graphicsAux.filter((n) => !refs.includes(n));
  const all = [...refs, ...aux];
  const max = Math.max(1, opts.max);
  if (all.length > max) {
    const dropped = all.slice(max);
    corrections.push({ code: "limited", photos: dropped });
    refs = refs.filter((n) => !dropped.includes(n));
    aux = aux.filter((n) => !dropped.includes(n));
  }
  return { refs: [...refs, ...aux], aux, corrections, blocked: false };
}

/* ── V2 (fidelity, 13.11.2026): photos first, every choice with its reason ──
 *
 * The 13.11 diagnosis on PROD orders: the photos DID reach the model (inline,
 * in order, hashes equal) — but whole-product shots were still sent with
 * photos of another kind behind the product photos: the folded pack
 * ("opakowanie") of a bag, close-ups, usage crops. Spec 03.11 (nutcracker):
 * "w ujęciach z całym produktem dołączamy tylko widoki całości"; 10.11/12.11:
 * an infographic or another variant as a reference makes a different product.
 *
 *   whole-product shot (hero, or caly_produkt): ONLY clean whole-product
 *     photos of the scene's state — the best one (front first), then a second
 *     view. Detail, usage, packaging, variant and graphic photos are dropped,
 *     each with its reason (what they show is described in words instead).
 *   detail shot: the planned detail first, then ONE whole-product photo as
 *     context; a planned graphic only as the last, auxiliary image.
 *   partial use shot: the whole product first (identity), then the planned
 *     usage/detail photos of the same state (the pose to copy).
 *   anywhere: never a collage, a photo with other products, another variant.
 * No clean whole-product photo → blocked (never drawn from a description).
 */
export type RefReason = "calosc_najlepsza" | "calosc_inny_kat" | "detal_ujecia" | "kontekst_calosc" | "uzycie_poza" | "grafika_pomocnicza";
export type RefDrop =
  | "fragment_w_ujeciu_calosci" | "uzycie_w_ujeciu_calosci" | "opakowanie" | "inny_wariant" | "inny_stan"
  | "grafika_w_ujeciu_calosci" | "kolaz_lub_inne_produkty" | "limit";
export type RefDecisionV2 = RefDecision & {
  reasons: { photo: number; position: number; reason: RefReason }[];
  dropped: { photo: number; reason: RefDrop }[];
  /** The scene's state could not be matched to any whole-product photo: the best one of any state is used. */
  stateFallback: boolean;
};

const normSt = (x: string) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l").replace(/\s+/g, " ").trim();

export function selectReferencesV2(
  shot: Pick<PlanShot, "typ" | "referencje" | "caly_produkt" | "stan">, card: ProductCard, opts: { max: number },
): RefDecisionV2 {
  const byN = new Map(card.zdjecia.map((p) => [p.n, p]));
  const planned = [...new Set(shot.referencje)].filter((n) => byN.has(n));
  const knownStates = new Set(card.stany.map((x) => normSt(x.stan)));
  const state = shot.stan && knownStates.has(normSt(shot.stan)) ? normSt(shot.stan) : null;
  const sameState = (p: CardPhoto) => !state || !p.stan || normSt(p.stan) === state;
  const dropped: RefDecisionV2["dropped"] = [];
  const drop = (n: number, reason: RefDrop) => { if (!dropped.some((d) => d.photo === n)) dropped.push({ photo: n, reason }); };
  const cleanWhole = (p: CardPhoto) => p.rola === "calosc" && formOf(p) === "zdjecie";
  const rank = (a: CardPhoto, b: CardPhoto) => VIEW_RANK[viewOf(a)] - VIEW_RANK[viewOf(b)] || a.n - b.n;
  let stateFallback = false;
  let wholes = card.zdjecia.filter((p) => cleanWhole(p) && sameState(p)).sort(rank);
  if (wholes.length === 0 && state) { wholes = card.zdjecia.filter(cleanWhole).sort(rank); stateFallback = wholes.length > 0; }
  const lead = (k: number): number[] => {
    if (wholes.length === 0) return [];
    const first = wholes[0];
    if (k === 1) return [first.n];
    const second = wholes.find((p) => p.n !== first.n && viewOf(p) !== viewOf(first)) ?? wholes.find((p) => p.n !== first.n);
    return second ? [first.n, second.n] : [first.n];
  };
  // Never anywhere: collages, other products, other variants.
  const usable = planned.filter((n) => {
    const p = byN.get(n) as CardPhoto;
    const f = formOf(p);
    if (f === "kolaz" || f === "inne_produkty") { drop(n, "kolaz_lub_inne_produkty"); return false; }
    if (p.rola === "inny_wariant") { drop(n, "inny_wariant"); return false; }
    return true;
  });
  const reasons: RefDecisionV2["reasons"] = [];
  let refs: number[] = [];
  let aux: number[] = [];
  const whole = shot.typ === "hero" || shot.caly_produkt === true;
  if (shot.typ === "detal") {
    const photos = usable.filter((n) => formOf(byN.get(n) as CardPhoto) !== "grafika");
    const graphics = usable.filter((n) => formOf(byN.get(n) as CardPhoto) === "grafika");
    const main = photos.find((n) => { const p = byN.get(n) as CardPhoto; return p.rola !== "calosc" && sameState(p); })
      ?? photos.find((n) => sameState(byN.get(n) as CardPhoto)) ?? photos[0] ?? graphics[0];
    if (main === undefined) return { refs: [], aux: [], corrections: [{ code: "blocked_no_whole", photos: [] }], blocked: true, reasons, dropped, stateFallback };
    const context = lead(1).find((n) => n !== main);
    refs = context !== undefined ? [main, context] : [main];
    reasons.push({ photo: main, position: 1, reason: formOf(byN.get(main) as CardPhoto) === "grafika" ? "grafika_pomocnicza" : "detal_ujecia" });
    if (context !== undefined) reasons.push({ photo: context, position: 2, reason: "kontekst_calosc" });
    aux = graphics.filter((n) => n !== main);
    for (const n of usable) if (!refs.includes(n) && !aux.includes(n)) drop(n, sameState(byN.get(n) as CardPhoto) ? "limit" : "inny_stan");
  } else {
    const ld = lead(2);
    if (ld.length === 0) return { refs: [], aux: [], corrections: [{ code: "blocked_no_whole", photos: [] }], blocked: true, reasons, dropped, stateFallback };
    refs = [...ld];
    ld.forEach((n, i) => reasons.push({ photo: n, position: i + 1, reason: i === 0 ? "calosc_najlepsza" : "calosc_inny_kat" }));
    for (const n of usable) {
      if (refs.includes(n)) continue;
      const p = byN.get(n) as CardPhoto;
      const f = formOf(p);
      if (!sameState(p)) { drop(n, "inny_stan"); continue; }
      if (p.rola === "opakowanie") { drop(n, "opakowanie"); continue; }
      if (whole) {
        if (f === "grafika") drop(n, "grafika_w_ujeciu_calosci");
        else if (p.rola === "detal") drop(n, "fragment_w_ujeciu_calosci");
        else if (p.rola === "uzycie") drop(n, "uzycie_w_ujeciu_calosci");
        else if (p.rola === "calosc") drop(n, "limit");
        continue;
      }
      if (f === "grafika") { drop(n, "grafika_w_ujeciu_calosci"); continue; }
      if (p.rola === "detal" || p.rola === "uzycie") { refs.push(n); reasons.push({ photo: n, position: refs.length, reason: "uzycie_poza" }); }
      else drop(n, "limit");
    }
  }
  const max = Math.max(1, opts.max);
  const all = [...refs, ...aux];
  if (all.length > max) {
    for (const n of all.slice(max)) drop(n, "limit");
    const keep = new Set(all.slice(0, max));
    refs = refs.filter((n) => keep.has(n));
    aux = aux.filter((n) => keep.has(n));
  }
  const final = [...refs, ...aux];
  aux.forEach((n) => reasons.push({ photo: n, position: final.indexOf(n) + 1, reason: "grafika_pomocnicza" }));
  return {
    refs: final, aux, blocked: false, stateFallback,
    reasons: reasons.filter((r) => final.includes(r.photo)).map((r) => ({ ...r, position: final.indexOf(r.photo) + 1 })),
    dropped,
    corrections: dropped.length ? [{ code: "dropped_v2", photos: dropped.map((d) => d.photo) }] : [],
  };
}

/** Accepted by the image model: JPEG/PNG/WebP, real bytes, known size; the inline request stays under ~18 MB. */
const REF_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const REF_TOTAL_MAX = 18 * 1024 * 1024;
/** Checked BEFORE the paid call: a reference the model cannot read is never paid for. */
export function referenceProblem(refs: { mime: string; bytes: number; width: number | null; height: number | null }[]): string | null {
  if (refs.length === 0) return "no_reference";
  for (const r of refs) {
    if (!REF_MIMES.has(r.mime)) return "mime";
    if (!(r.bytes > 0)) return "empty";
    if (!r.width || !r.height) return "dimensions";
  }
  const total = refs.reduce((a, r) => a + Math.ceil((r.bytes * 4) / 3), 0);
  return total > REF_TOTAL_MAX ? "too_large" : null;
}

/* ── the binding block: which picture is what, numbered by the final order ──*/

export const DEFAULT_BINDING: Record<string, string> = {
  calosc_1: "Zdjęcie {lista} przedstawia dokładnie produkt, który należy odwzorować. Zachowaj identyczną konstrukcję, proporcje, materiały, kolory, elementy i oznaczenia. Nie zastępuj go innym produktem tej kategorii.",
  calosc_n: "Zdjęcia {lista} przedstawiają dokładnie produkt, który należy odwzorować. Zachowaj identyczną konstrukcję, proporcje, materiały, kolory, elementy i oznaczenia. Nie zastępuj go innym produktem tej kategorii.",
  detal: "Zdjęcie {n} przedstawia detal produktu ({opis}) i służy wyłącznie do wiernego odtworzenia tego elementu.",
  pomocnicze: "Zdjęcie {n} to grafika pomocnicza ({opis}): użyj jej tylko do rozpoznania szczegółów produktu; nie odtwarzaj strzałek, linii, liczb, napisów ani innych elementów grafiki.",
  logo: "Logo i napisy produktu wyłącznie w ich rzeczywistych miejscach na produkcie, nigdy na innych przedmiotach ani w tle.",
  detal_glowny: "Zdjęcie 1 przedstawia detal produktu ({opis}) do odtworzenia 1:1.",
  kontekst: "Zdjęcie {lista} pokazuje cały produkt i służy wyłącznie do zachowania spójności kolorów, materiałów i proporcji.",
};

const listPl = (ns: number[]) => (ns.length <= 1 ? String(ns[0] ?? "") : `${ns.slice(0, -1).join(", ")} i ${ns[ns.length - 1]}`);
const fill = (t: string, v: { lista?: string; n?: number; opis?: string }) =>
  t.replace(/\{lista\}/g, v.lista ?? "").replace(/\{n\}/g, String(v.n ?? "")).replace(/\{opis\}/g, v.opis ?? "").replace(/\s*\(\s*\)/g, "").trim();
const opisOf = (p: CardPhoto | undefined) => (p?.widok ?? "").replace(/[()]/g, "").slice(0, 90).trim();

/** The block that opens every image prompt: built from the FINAL references. */
export function bindingBlock(kb: Pick<KbParsed, "binding">, card: ProductCard, refs: number[], aux: number[], pattern: "full" | "detail"): { text: string; source: "kb" | "default" } {
  const source = kb.binding ? "kb" : "default";
  const tpl = (k: string) => kb.binding?.[k] ?? DEFAULT_BINDING[k] ?? "";
  const byN = new Map(card.zdjecia.map((p) => [p.n, p]));
  const pos = (n: number) => refs.indexOf(n) + 1;
  const lines: string[] = [];
  if (pattern === "detail") {
    lines.push(fill(tpl("detal_glowny"), { opis: opisOf(byN.get(refs[0])) }));
    const context = refs.slice(1).filter((n) => !aux.includes(n) && byN.get(n)?.rola === "calosc").map(pos);
    if (context.length) lines.push(fill(tpl("kontekst"), { lista: listPl(context) }).replace(/^Zdjęcie (\d+(?:, \d+)* i \d+)/, "Zdjęcia $1"));
    for (const n of refs.slice(1)) if (!aux.includes(n) && byN.get(n)?.rola !== "calosc") lines.push(fill(tpl("detal"), { n: pos(n), opis: opisOf(byN.get(n)) }));
  } else {
    const whole = refs.filter((n) => !aux.includes(n) && byN.get(n)?.rola === "calosc" && formOf(byN.get(n) as CardPhoto) === "zdjecie");
    // Every clean whole-product photo is named as THE product (the leading ones come first by the rules).
    const leading = whole;
    const lista = listPl(leading.map(pos));
    lines.push(fill(tpl(leading.length > 1 ? "calosc_n" : "calosc_1"), { lista }));
    for (const n of refs) {
      if (leading.includes(n) || aux.includes(n)) continue;
      lines.push(fill(tpl("detal"), { n: pos(n), opis: opisOf(byN.get(n)) }));
    }
  }
  for (const n of aux) lines.push(fill(tpl("pomocnicze"), { n: pos(n), opis: opisOf(byN.get(n)) }));
  const logo = tpl("logo");
  if (logo) lines.push(logo);
  return { text: lines.filter(Boolean).join(" "), source };
}
