/**
 * GROVBASE SHOT — STEP 2: THE PRODUCT CARD, checked in code.
 *
 * The model's JSON against the contract: every photo Z1…Zn described exactly
 * once, roles from the closed list, the recipe and the flags only from the
 * order's knowledge version, states that name real photos. A broken card is
 * never "fixed" with invented fields — the errors go back to the model once
 * (validationFeedback) and a second failure stops the order (nothing paid
 * for an image). Pure.
 */
import { DIM_SOURCES, PHOTO_FORMS, PHOTO_ROLES, PHOTO_VIEWS, type PhotoForm, type PhotoRole, type PhotoView } from "@/lib/grovshot-shot/contract";
import type { KbParsed } from "@/lib/grovshot-shot/kb";

export type CardPhoto = {
  id: string; n: number; rola: PhotoRole; widok: string; stan: string; nie_kopiowac: string[];
  /** What the picture is and from where (cards written before 2026-11-08 have neither; refs.ts reads their notes). */
  forma?: PhotoForm; ujecie?: PhotoView;
};
export type ProductCard = {
  produkt: { nazwa: string; wariant: string; kategoria: string };
  wymiary: { tekst: string; zrodlo: (typeof DIM_SOURCES)[number]; szerokosc_cm: number | null; glebokosc_cm: number | null; wysokosc_cm: number | null; pewne: boolean };
  skala: string[];
  budowa: { elementy: string[]; kolory: string[]; materialy: string[]; liczby: string[] };
  napisy: string[];
  stany: { stan: string; zdjecia: string[] }[];
  zdjecia: CardPhoto[];
  argumenty: string[];
  zastosowania: string[];
  grupa_docelowa: string;
  uczciwosc: string[];
  sezon: { produkt: string; uzycie: string };
  ryzyka: string[];
  flagi: string[];
  przepis_stylu: string;
};

export type CardCheck = { ok: true; card: ProductCard; notes: string[] } | { ok: false; errors: string[] };

const s = (v: unknown, max = 2000) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const ss = (v: unknown, n = 40, max = 400) => (Array.isArray(v) ? v.map((x) => s(x, max)).filter(Boolean).slice(0, n) : []);
const o = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const cm = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 100_000 ? Math.round(v * 10) / 10 : null);
export const photoId = (n: number) => `Z${n}`;
export const photoNumber = (id: string, count: number): number | null => {
  const m = /^Z(\d{1,2})$/.exec(String(id).trim().toUpperCase());
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= count ? n : null;
};
export const normState = (x: string) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/\s+/g, " ").trim();

export function checkCard(raw: unknown, ctx: { photoCount: number; kb: KbParsed }): CardCheck {
  const r = o(raw);
  const errors: string[] = [];
  const notes: string[] = [];
  const produkt = o(r.produkt);
  const nazwa = s(produkt.nazwa, 200);
  if (!nazwa) errors.push("produkt.nazwa: puste – nazwij produkt");

  const w = o(r.wymiary);
  const zrodlo = (DIM_SOURCES as readonly string[]).includes(String(w.zrodlo)) ? w.zrodlo as ProductCard["wymiary"]["zrodlo"] : null;
  if (!zrodlo) errors.push(`wymiary.zrodlo: musi być jednym z ${DIM_SOURCES.join(", ")}`);
  const wymiary = {
    tekst: s(w.tekst, 300), zrodlo: zrodlo ?? "zalozenie", szerokosc_cm: cm(w.szerokosc_cm), glebokosc_cm: cm(w.glebokosc_cm),
    wysokosc_cm: cm(w.wysokosc_cm), pewne: w.pewne === true && zrodlo === "opis",
  } as ProductCard["wymiary"];
  if (!wymiary.tekst) errors.push("wymiary.tekst: puste – podaj wymiary z opisu albo założenie oznaczone jako założenie");

  // Every photo exactly once, in the order received.
  const seen = new Map<number, CardPhoto>();
  for (const p of Array.isArray(r.zdjecia) ? r.zdjecia : []) {
    const x = o(p);
    const n = photoNumber(String(x.id ?? ""), ctx.photoCount);
    if (n === null) { errors.push(`zdjecia: nieznany identyfikator „${s(x.id, 20)}” (są Z1…Z${ctx.photoCount})`); continue; }
    if (seen.has(n)) { errors.push(`zdjecia: Z${n} opisane więcej niż raz`); continue; }
    const rola = (PHOTO_ROLES as readonly string[]).includes(String(x.rola)) ? x.rola as PhotoRole : null;
    if (!rola) { errors.push(`zdjecia.Z${n}.rola: musi być jedną z ${PHOTO_ROLES.join(", ")}`); continue; }
    const forma = (PHOTO_FORMS as readonly string[]).includes(String(x.forma)) ? x.forma as PhotoForm : undefined;
    const ujecie = (PHOTO_VIEWS as readonly string[]).includes(String(x.ujecie)) ? x.ujecie as PhotoView : undefined;
    if (x.forma !== undefined && !forma) errors.push(`zdjecia.Z${n}.forma: musi być jedną z ${PHOTO_FORMS.join(", ")}`);
    if (x.ujecie !== undefined && !ujecie) errors.push(`zdjecia.Z${n}.ujecie: musi być jednym z ${PHOTO_VIEWS.join(", ")}`);
    seen.set(n, {
      id: photoId(n), n, rola, widok: s(x.widok, 300), stan: s(x.stan, 120), nie_kopiowac: ss(x.nie_kopiowac, 20, 200),
      ...(forma ? { forma } : {}), ...(ujecie ? { ujecie } : {}),
    });
  }
  for (let n = 1; n <= ctx.photoCount; n++) if (!seen.has(n)) errors.push(`zdjecia: brak opisu Z${n}`);
  const zdjecia = [...seen.values()].sort((a, b) => a.n - b.n);
  if (zdjecia.length > 0 && !zdjecia.some((p) => p.rola === "calosc")) notes.push("no_whole_view");

  const stany: ProductCard["stany"] = [];
  for (const st of Array.isArray(r.stany) ? r.stany : []) {
    const x = o(st);
    const stan = s(x.stan, 120);
    if (!stan) continue;
    const ids = ss(x.zdjecia, 10, 10);
    const bad = ids.filter((id) => photoNumber(id, ctx.photoCount) === null);
    if (bad.length) errors.push(`stany.${stan}: nieznane zdjęcia ${bad.join(", ")}`);
    stany.push({ stan, zdjecia: ids.map((id) => photoId(photoNumber(id, ctx.photoCount) ?? 0)).filter((id) => id !== "Z0") });
  }
  if (stany.length === 0) errors.push("stany: podaj co najmniej jeden stan produktu i zdjęcia, które go pokazują");
  const known = new Set(stany.map((x) => normState(x.stan)));
  for (const p of zdjecia) {
    if (p.stan && p.rola !== "inny_wariant" && p.rola !== "opakowanie" && !known.has(normState(p.stan))) {
      errors.push(`zdjecia.${p.id}.stan: „${p.stan}” nie występuje w liście „stany”`);
    }
  }

  const argumenty = ss(r.argumenty, 20);
  if (argumenty.length === 0) errors.push("argumenty: podaj argumenty sprzedażowe z opisu");

  const flagNames = new Set(ctx.kb.special.map((x) => x.flag));
  const flagiRaw = ss(r.flagi, 20, 40);
  const unknownFlags = flagiRaw.filter((f) => !flagNames.has(f));
  if (unknownFlags.length) errors.push(`flagi: nieznane ${unknownFlags.join(", ")} (dozwolone: ${[...flagNames].join(", ")})`);
  const flagi = [...new Set(flagiRaw.filter((f) => flagNames.has(f)))];

  const przepis = s(r.przepis_stylu, 40);
  if (!ctx.kb.recipes.some((x) => x.id === przepis)) {
    errors.push(`przepis_stylu: „${przepis}” nie istnieje (dozwolone: ${ctx.kb.recipes.map((x) => x.id).join(", ")})`);
  }

  if (errors.length > 0) return { ok: false, errors: errors.slice(0, 30) };
  const budowa = o(r.budowa);
  const sezon = o(r.sezon);
  return {
    ok: true,
    notes,
    card: {
      produkt: { nazwa, wariant: s(produkt.wariant, 200), kategoria: s(produkt.kategoria, 200) },
      wymiary,
      skala: ss(r.skala, 12),
      budowa: { elementy: ss(budowa.elementy, 30), kolory: ss(budowa.kolory, 20), materialy: ss(budowa.materialy, 20), liczby: ss(budowa.liczby, 20) },
      napisy: ss(r.napisy, 20),
      stany,
      zdjecia,
      argumenty,
      zastosowania: ss(r.zastosowania, 20),
      grupa_docelowa: s(r.grupa_docelowa, 400),
      uczciwosc: ss(r.uczciwosc, 20),
      sezon: { produkt: s(sezon.produkt, 200), uzycie: s(sezon.uzycie, 200) },
      ryzyka: ss(r.ryzyka, 20),
      flagi,
      przepis_stylu: przepis,
    },
  };
}

/** The errors, for the one repeat of the call. */
export function validationFeedback(errors: string[]): string {
  return `Poprzednia odpowiedź nie przeszła walidacji. Popraw dokładnie te błędy i zwróć pełny JSON od nowa:\n${errors.map((e) => `- ${e}`).join("\n")}`;
}

/** The largest dimension of the product in cm (the scale-anchor check), or null. */
export function largestCm(card: ProductCard): number | null {
  const d = [card.wymiary.szerokosc_cm, card.wymiary.glebokosc_cm, card.wymiary.wysokosc_cm].filter((x): x is number => x !== null);
  return d.length ? Math.max(...d) : null;
}
