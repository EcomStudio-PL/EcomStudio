/**
 * GROVBASE SHOT — STEP 3: THE SHOT PLAN, checked mechanically in code.
 *
 * Structure first (never passed on): exactly the ordered number of shots,
 * numbered 1…N, closed vocabularies, references that are real photos (Z ids
 * of the card, ≤ 6, no repeats), a scene sentence. Then the rules of "jak
 * działa automatyzacja" and the spec, as code:
 *   · the same frame type at most twice; golden hour at most twice;
 *   · every seller "detal" photo gets its own detail shot (as far as the
 *     ordered count allows — the rest is a recorded CONFLICT, never an extra
 *     shot); use and detail shots roughly half and half;
 *   · persons and hands per the people table of the knowledge version (a
 *     product used in hand / a passive product relaxes its column);
 *   · different places and scenes; references in the scene's product state,
 *     never another variant; a whole-product shot never has a fragment-only
 *     reference, a detail shot always also a whole view;
 *   · the creative direction from the knowledge base; scale anchors that do
 *     not contradict the card's dimensions.
 * Shots an admin fixed in a manual plan are hard constraints: they are
 * written back as given and a rule broken only by fixed shots is not a
 * violation (the auto-planned part is judged against what they occupy) — it
 * is an OVERRIDE, shown to the admin; only one that touches the product's
 * honesty still stops the shot.
 *
 * SEVERITY (23.11.2026) is a property of the rule, typed here, never read from
 * the model's free text: a HARD violation means the image would show a wrong
 * product (another variant, a state the photos do not have, a fragment for
 * the whole, copies the listing does not sell) — after the references are
 * corrected by code (refs.ts) such a shot is not generated and not paid for
 * (planGate). Everything else is SOFT: the order goes on, the admin sees a
 * warning, the plan is never called verified. Pure.
 */
import { COPIES, FRAMES, LIGHTS, SETTINGS, type Copies, type Frame, type Light, type SceneSetting } from "@/lib/grovshot-shot/contract";
import { PEOPLE, SHOT_TYPES, norm, type KbParsed, type People, type PeopleRow, type ShotType } from "@/lib/grovshot-shot/kb";
import { largestCm, normState, photoId, photoNumber, type ProductCard } from "@/lib/grovshot-shot/card";

export const MAX_REFS = 6;
export const MAX_SAME_FRAME = 2;
export const MAX_GOLDEN = 2;
/** Detail share among use + detail shots ("mniej więcej po połowie"), checked from 4 such shots. */
export const DETAIL_SHARE: [number, number] = [0.3, 0.7];
/** A scale anchor may imply the product's largest dimension within ±30 % of the card's. */
export const SCALE_TOLERANCE = 0.3;
/** The PDF's table, used only when a knowledge version has none readable. */
export const DEFAULT_PEOPLE_TABLE: PeopleRow[] = [
  { from: 1, to: 2, persons: [0, 0], hands: [0, 1] },
  { from: 3, to: 5, persons: [1, 1], hands: [1, 1] },
  { from: 6, to: 10, persons: [2, 3], hands: [1, 2] },
];

export type PlanShot = {
  numer: number; argument: string; typ: ShotType; kierunek: string; miejsce: string; swiatlo: string; swiatlo_typ: Light;
  kadr: Frame; ludzie: People; stan: string; caly_produkt: boolean;
  /** Photo numbers in SEND order: "zdjęcie 1" of the prompt is referencje[0]. */
  referencje: number[];
  opis: string;
  /** Whole-product shots: the product's largest dimension the scene's anchors give. Detail shots: the
   *  fragment's own size — never compared with the whole product (scale_unknown instead). */
  skala_cm: number | null;
  /** Indoor or outdoor (23.11.2026); null on plans written before — prompt B then keeps its earlier line. */
  otoczenie?: SceneSetting | null;
  /** One item (or part of a set), the whole set, N identical items; null on earlier plans. */
  egzemplarze?: Copies | null;
  liczba_egzemplarzy?: number | null;
  /** Set by an admin's manual plan (written back as given). */
  fixed: boolean;
};
export type UserPlanRow = { numer: number; opis?: string; referencje?: number[]; typ?: ShotType };
export type Severity = "hard" | "soft";
export type Violation = {
  code: string; shots: number[]; detail: string;
  /** From the code table below, never from the model's text. Absent on records written before 23.11.2026 (= soft). */
  severity?: Severity;
  /** Broken only by shots an admin fixed: the admin's decision, shown, not sent back to the model. */
  override?: boolean;
};
/** Recorded, never a violation: a detail's scale has no component size to be compared with. */
export type PlanNote = { code: "scale_unknown"; shots: number[]; detail: string };
export type PlanCheck = {
  structural: string[]; violations: Violation[]; conflicts: string[]; shots: PlanShot[];
  overrides: Violation[]; notes: PlanNote[];
};

/**
 * A wrong PRODUCT in the image, not a weaker gallery: another variant, a state
 * the photos do not show (the model would invent it), a fragment or no whole
 * view in a whole-product shot, copies the listing does not sell, a set split
 * into identical items.
 */
export const HARD_VIOLATIONS: ReadonlySet<string> = new Set([
  "ref_other_variant", "state_unknown", "ref_state_mismatch", "whole_with_fragment", "whole_without_whole",
  "detail_without_whole", "count_not_offered", "count_exceeds_offer", "set_split",
]);
/** The product's honesty: these stop a shot even when an admin fixed it. */
export const HONESTY_VIOLATIONS: ReadonlySet<string> = new Set(["ref_other_variant", "count_not_offered", "count_exceeds_offer", "set_split"]);
export const severityOf = (code: string): Severity => (HARD_VIOLATIONS.has(code) ? "hard" : "soft");

const s = (v: unknown, max = 600) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const o = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});

/** An admin's manual plan rows, as stored (1-based shot numbers, photo numbers). */
export function parseUserPlan(raw: unknown, ctx: { shots: number; photoCount: number }): UserPlanRow[] | "invalid" | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) return "invalid";
  const rows: UserPlanRow[] = [];
  for (const r of raw) {
    const x = o(r);
    const numer = Number(x.numer);
    if (!Number.isInteger(numer) || numer < 1 || numer > ctx.shots || rows.some((y) => y.numer === numer)) return "invalid";
    const refs = Array.isArray(x.referencje) ? x.referencje.map((v) => (typeof v === "number" ? v : photoNumber(String(v), ctx.photoCount))) : undefined;
    if (refs && (refs.length === 0 || refs.length > MAX_REFS || refs.some((n) => typeof n !== "number" || n < 1 || n > ctx.photoCount) || new Set(refs).size !== refs.length)) return "invalid";
    const typ = x.typ === undefined || x.typ === "" ? undefined : (SHOT_TYPES as readonly string[]).includes(String(x.typ)) ? x.typ as ShotType : null;
    if (typ === null) return "invalid";
    const opis = x.opis === undefined ? undefined : s(x.opis, 600) || undefined;
    if (!opis && !refs && !typ) continue;
    rows.push({ numer, ...(opis ? { opis } : {}), ...(refs ? { referencje: refs as number[] } : {}), ...(typ ? { typ } : {}) });
  }
  return rows.length ? rows.sort((a, b) => a.numer - b.numer) : null;
}

export function renderUserPlan(rows: UserPlanRow[] | null): string {
  if (!rows?.length) return "";
  return rows.map((r) => `- Ujęcie ${r.numer}:${r.typ ? ` typ ${r.typ};` : ""}${r.referencje ? ` referencje ${r.referencje.map(photoId).join(", ")};` : ""}${r.opis ? ` opis: ${r.opis}` : ""}`).join("\n");
}

function peopleRowFor(table: PeopleRow[] | null, n: number): PeopleRow {
  const t = table?.length ? table : DEFAULT_PEOPLE_TABLE;
  return t.find((r) => n >= r.from && n <= r.to) ?? t[t.length - 1];
}

export function checkPlan(raw: unknown, ctx: { card: ProductCard; kb: KbParsed; shots: number; userPlan: UserPlanRow[] | null }): PlanCheck {
  const photoCount = ctx.card.zdjecia.length;
  const structural: string[] = [];
  const list = Array.isArray(o(raw).ujecia) ? o(raw).ujecia as unknown[] : null;
  const conflicts = (Array.isArray(o(raw).konflikty) ? o(raw).konflikty as unknown[] : []).map((c) => s(c, 300)).filter(Boolean).slice(0, 20);
  if (!list) return { structural: ["ujecia: brak listy ujęć"], violations: [], conflicts, shots: [], overrides: [], notes: [] };
  if (list.length !== ctx.shots) structural.push(`ujecia: jest ${list.length}, zamówiono dokładnie ${ctx.shots}`);
  const shots: PlanShot[] = [];
  const numbers = new Set<number>();
  for (const item of list) {
    const x = o(item);
    const numer = Number(x.numer);
    const at = Number.isInteger(numer) ? `ujęcie ${numer}` : "ujęcie bez numeru";
    if (!Number.isInteger(numer) || numer < 1 || numer > ctx.shots || numbers.has(numer)) { structural.push(`${at}: numer musi być unikalny, 1…${ctx.shots}`); continue; }
    numbers.add(numer);
    const typ = (SHOT_TYPES as readonly string[]).includes(String(x.typ)) ? x.typ as ShotType : null;
    const ludzie = (PEOPLE as readonly string[]).includes(String(x.ludzie)) ? x.ludzie as People : null;
    const kadr = (FRAMES as readonly string[]).includes(String(x.kadr)) ? x.kadr as Frame : null;
    const swiatlo_typ = (LIGHTS as readonly string[]).includes(String(x.swiatlo_typ)) ? x.swiatlo_typ as Light : null;
    if (!typ) structural.push(`${at}: typ musi być jednym z ${SHOT_TYPES.join(", ")}`);
    if (!ludzie) structural.push(`${at}: ludzie musi być jednym z ${PEOPLE.join(", ")}`);
    if (!kadr) structural.push(`${at}: kadr musi być jednym z ${FRAMES.join(", ")}`);
    if (!swiatlo_typ) structural.push(`${at}: swiatlo_typ musi być jednym z ${LIGHTS.join(", ")}`);
    const rawRefs = Array.isArray(x.referencje) ? x.referencje.map((r) => String(r)) : [];
    const refs = rawRefs.map((r) => photoNumber(r, photoCount));
    if (refs.length === 0) structural.push(`${at}: brak referencji`);
    if (refs.some((r) => r === null)) structural.push(`${at}: nieistniejące referencje ${rawRefs.filter((_, i) => refs[i] === null).join(", ")} (są Z1…Z${photoCount})`);
    if (new Set(refs).size !== refs.length) structural.push(`${at}: powtórzona referencja`);
    if (refs.length > MAX_REFS) structural.push(`${at}: najwyżej ${MAX_REFS} referencji`);
    const opis = s(x.opis);
    if (!opis) structural.push(`${at}: brak jednozdaniowego opisu sceny`);
    if (!s(x.argument)) structural.push(`${at}: brak argumentu sprzedażowego`);
    if (!s(x.miejsce)) structural.push(`${at}: brak miejsca`);
    // 23.11.2026 fields: a plan written before has none of them (null); a value outside the list is an error.
    const otoczenie = x.otoczenie === undefined || x.otoczenie === null ? null
      : (SETTINGS as readonly string[]).includes(String(x.otoczenie)) ? x.otoczenie as SceneSetting : undefined;
    if (otoczenie === undefined) structural.push(`${at}: otoczenie musi być jednym z ${SETTINGS.join(", ")}`);
    const egzemplarze = x.egzemplarze === undefined || x.egzemplarze === null ? null
      : (COPIES as readonly string[]).includes(String(x.egzemplarze)) ? x.egzemplarze as Copies : undefined;
    if (egzemplarze === undefined) structural.push(`${at}: egzemplarze musi być jednym z ${COPIES.join(", ")}`);
    const liczba = typeof x.liczba_egzemplarzy === "number" && Number.isInteger(x.liczba_egzemplarzy) && x.liczba_egzemplarzy >= 2 && x.liczba_egzemplarzy <= 100
      ? x.liczba_egzemplarzy : null;
    if (egzemplarze === "kilka_identycznych" && liczba === null) structural.push(`${at}: przy „kilka_identycznych” podaj liczba_egzemplarzy (2–100)`);
    if (!typ || !ludzie || !kadr || !swiatlo_typ || otoczenie === undefined || egzemplarze === undefined) continue;
    const skala = typeof x.skala_cm === "number" && Number.isFinite(x.skala_cm) && x.skala_cm > 0 ? x.skala_cm : null;
    shots.push({
      numer, argument: s(x.argument, 300), typ, kierunek: s(x.kierunek, 120), miejsce: s(x.miejsce, 300), swiatlo: s(x.swiatlo, 300), swiatlo_typ,
      kadr, ludzie, stan: s(x.stan, 120), caly_produkt: x.caly_produkt === true || typ === "hero",
      referencje: refs.filter((r): r is number => r !== null), opis, skala_cm: skala,
      otoczenie, egzemplarze, liczba_egzemplarzy: egzemplarze === "kilka_identycznych" ? liczba : null, fixed: false,
    });
  }
  shots.sort((a, b) => a.numer - b.numer);

  // The admin's manual rows are hard constraints, written back as given.
  for (const row of ctx.userPlan ?? []) {
    const shot = shots.find((x) => x.numer === row.numer);
    if (!shot) continue;
    if (row.opis) shot.opis = row.opis;
    if (row.referencje) shot.referencje = [...row.referencje];
    if (row.typ) { shot.typ = row.typ; if (row.typ === "hero") shot.caly_produkt = true; }
    shot.fixed = true;
  }
  if (structural.length > 0) return { structural: structural.slice(0, 40), violations: [], conflicts, shots, overrides: [], notes: [] };
  const all = planViolations(shots, ctx);
  return {
    structural, violations: all.filter((v) => !v.override), overrides: all.filter((v) => v.override),
    conflicts: [...conflicts, ...planConflicts(shots, ctx)], shots, notes: planNotes(shots),
  };
}

/** A rule broken only by fixed shots is the admin's decision (an override), not a violation. */
const auto = (xs: PlanShot[]) => xs.filter((x) => !x.fixed);

/**
 * Every rule the plan breaks, typed hard / soft. A rule broken only by shots
 * an admin fixed comes back as an `override` (never sent to the model as a
 * correction).
 */
export function planViolations(shots: PlanShot[], ctx: { card: ProductCard; kb: KbParsed; shots: number }): Violation[] {
  const v: Violation[] = [];
  const add = (code: string, involved: PlanShot[], detail: string) => {
    const a = auto(involved);
    const severity = severityOf(code);
    if (a.length > 0) v.push({ code, shots: a.map((x) => x.numer), detail, severity });
    else if (involved.length > 0) v.push({ code, shots: involved.map((x) => x.numer), detail, severity, override: true });
  };
  const n = shots.length;
  const photo = (k: number) => ctx.card.zdjecia.find((p) => p.n === k);
  const hasWhole = ctx.card.zdjecia.some((p) => p.rola === "calosc");

  // Frame types and golden hour.
  for (const f of FRAMES) {
    const same = shots.filter((x) => x.kadr === f);
    if (same.length > MAX_SAME_FRAME) add("frame_repeat", same, `kadr „${f}” w ${same.length} ujęciach (${same.map((x) => x.numer).join(", ")}) – najwyżej ${MAX_SAME_FRAME}`);
  }
  const golden = shots.filter((x) => x.swiatlo_typ === "zlota_godzina");
  if (golden.length > MAX_GOLDEN) add("golden_hour", golden, `złota godzina w ${golden.length} ujęciach (${golden.map((x) => x.numer).join(", ")}) – najwyżej ${MAX_GOLDEN}`);

  // People table (persons include animals: "Ludzie i zwierzęta").
  const row = peopleRowFor(ctx.kb.peopleTable, ctx.shots);
  const persons = shots.filter((x) => x.ludzie === "postacie");
  const hands = shots.filter((x) => x.ludzie === "dlonie");
  const personsMax = ctx.card.flagi.includes("pasywny") ? n : row.persons[1];
  const handsMax = ctx.card.flagi.includes("w_dloni") ? n : row.hands[1];
  if (persons.length > personsMax) add("people_persons", persons, `postacie w ${persons.length} ujęciach – przy ${ctx.shots} zdjęciach najwyżej ${personsMax}`);
  if (persons.length < row.persons[0]) add("people_persons", shots.filter((x) => x.ludzie !== "postacie"), `postacie w ${persons.length} ujęciach – przy ${ctx.shots} zdjęciach co najmniej ${row.persons[0]}`);
  if (hands.length > handsMax) add("people_hands", hands, `dłonie w ${hands.length} ujęciach – przy ${ctx.shots} zdjęciach najwyżej ${handsMax}`);
  if (hands.length < row.hands[0]) add("people_hands", shots.filter((x) => x.ludzie !== "dlonie"), `dłonie w ${hands.length} ujęciach – przy ${ctx.shots} zdjęciach co najmniej ${row.hands[0]}`);

  // Use and detail roughly half and half.
  const uses = shots.filter((x) => x.typ === "uzycie");
  const details = shots.filter((x) => x.typ === "detal");
  if (uses.length + details.length >= 4) {
    const share = details.length / (uses.length + details.length);
    if (share < DETAIL_SHARE[0] || share > DETAIL_SHARE[1]) {
      add("use_detail_balance", share < DETAIL_SHARE[0] ? uses : details, `ujęcia użycia ${uses.length}, detali ${details.length} – powinno być mniej więcej po połowie`);
    }
  }

  // Seller detail photos get their own detail shot (as far as the count allows).
  const detailPhotos = ctx.card.zdjecia.filter((p) => p.rola === "detal");
  const covered = detailPhotos.filter((p) => details.some((x) => x.referencje[0] === p.n));
  const required = Math.min(detailPhotos.length, Math.floor(ctx.shots / 2));
  if (covered.length < required) {
    const missing = detailPhotos.filter((p) => !covered.includes(p)).map((p) => p.id);
    add("detail_photo_uncovered", shots, `zdjęcia detali ${missing.join(", ")} nie mają własnego ujęcia detalu (z tym zdjęciem jako pierwszą referencją) – wymagane co najmniej ${required}`);
  }

  // Places and scenes differ.
  const seenPlace = new Map<string, PlanShot[]>();
  for (const x of shots.filter((y) => y.typ !== "detal")) {
    const k = norm(x.miejsce);
    seenPlace.set(k, [...(seenPlace.get(k) ?? []), x]);
  }
  for (const [place, xs] of seenPlace) if (xs.length > 1) add("place_repeat", xs, `to samo miejsce „${place}” w ujęciach ${xs.map((x) => x.numer).join(", ")}`);
  const seenScene = new Map<string, PlanShot[]>();
  for (const x of shots) seenScene.set(norm(x.opis), [...(seenScene.get(norm(x.opis)) ?? []), x]);
  for (const [, xs] of seenScene) if (xs.length > 1) add("scene_repeat", xs, `identyczny opis sceny w ujęciach ${xs.map((x) => x.numer).join(", ")}`);

  // References: the scene's state, never another variant; whole vs fragment.
  const states = new Set(ctx.card.stany.map((x) => normState(x.stan)));
  for (const x of shots) {
    if (!states.has(normState(x.stan))) add("state_unknown", [x], `ujęcie ${x.numer}: stan „${x.stan}” nie występuje w karcie (${ctx.card.stany.map((y) => y.stan).join(", ")})`);
    for (const k of x.referencje) {
      const p = photo(k);
      if (p?.rola === "inny_wariant") add("ref_other_variant", [x], `ujęcie ${x.numer}: ${p.id} pokazuje inny wariant produktu`);
    }
    // The scene's state must be SHOWN by at least one reference (24.11.2026):
    // a clean whole photo of another state next to the photo of the right
    // state is identity, not a conflict; no photo of the state at all is.
    const stated = x.referencje.map(photo).filter((p): p is NonNullable<typeof p> => !!p && p.rola !== "opakowanie" && p.rola !== "inny_wariant" && !!p.stan);
    // Another state is allowed ONLY as a clean whole photo standing in for a
    // whole view the card does not have in the scene's state (identity next
    // to the state photo); a part or usage photo of another state, or a whole
    // of another state when one of the right state exists, makes a hybrid.
    const sceneSt = normState(x.stan);
    if (states.has(sceneSt) && stated.length > 0) {
      const wholeInState = ctx.card.zdjecia.some((p) => p.rola === "calosc" && (p.forma ?? "zdjecie") === "zdjecie" && !!p.stan && normState(p.stan) === sceneSt);
      const foreign = stated.filter((p) => normState(p.stan) !== sceneSt && (p.rola !== "calosc" || wholeInState));
      if (!stated.some((p) => normState(p.stan) === sceneSt)) {
        add("ref_state_mismatch", [x], `ujęcie ${x.numer}: żadne zdjęcie (${stated.map((p) => `${p.id}: „${p.stan}”`).join(", ")}) nie pokazuje stanu sceny „${x.stan}”`);
      } else if (foreign.length) {
        add("ref_state_mismatch", [x], `ujęcie ${x.numer}: ${foreign.map((p) => `${p.id} pokazuje stan „${p.stan}”`).join(", ")}, scena – „${x.stan}”`);
      }
    }
    const roles = x.referencje.map((k) => photo(k)?.rola);
    if (x.caly_produkt) {
      if (roles.includes("detal")) add("whole_with_fragment", [x], `ujęcie ${x.numer} pokazuje cały produkt, a ma referencję z samym fragmentem (${x.referencje.filter((k) => photo(k)?.rola === "detal").map(photoId).join(", ")})`);
      if (hasWhole && !roles.includes("calosc")) add("whole_without_whole", [x], `ujęcie ${x.numer} pokazuje cały produkt bez referencji całości`);
    }
    if (x.typ === "detal" && hasWhole && !roles.includes("calosc")) add("detail_without_whole", [x], `ujęcie detalu ${x.numer} nie ma referencji całości produktu`);
    if (ctx.kb.directions.length > 0 && !ctx.kb.directions.some((d) => norm(d) === norm(x.kierunek))) {
      add("direction_unknown", [x], `ujęcie ${x.numer}: kierunek „${x.kierunek}” spoza tabeli kierunków kreatywnych`);
    }
  }

  // Scale anchors against the card — whole-product shots only: a detail's
  // skala_cm is the size of its fragment (4,5 cm of a 36,5 cm case is right),
  // and the card names no component's size to compare it with (planNotes).
  const largest = largestCm(ctx.card);
  if (largest) {
    for (const x of shots.filter((y) => y.skala_cm !== null && y.typ !== "detal")) {
      const ratio = x.skala_cm! / largest;
      if (Math.abs(ratio - 1) > SCALE_TOLERANCE) add("scale_conflict", [x], `ujęcie ${x.numer}: kotwice skali dają ${x.skala_cm} cm, karta – ${largest} cm`);
    }
  }

  // How many items the shot shows, against what the listing sells (cards and plans from 23.11.2026 on).
  const offer = ctx.card.oferta;
  if (offer) {
    for (const x of shots) {
      if (x.egzemplarze === "kilka_identycznych") {
        if (offer.typ === "komplet") add("set_split", [x], `ujęcie ${x.numer}: komplet pokazany jako kilka identycznych produktów – pokaż jeden komplet`);
        else if (offer.typ !== "kilka_sztuk") add("count_not_offered", [x], `ujęcie ${x.numer}: kilka identycznych egzemplarzy, a aukcja sprzedaje jeden – pokaż jeden egzemplarz`);
        else if (offer.sztuk !== null && (x.liczba_egzemplarzy ?? 0) > offer.sztuk) {
          add("count_exceeds_offer", [x], `ujęcie ${x.numer}: ${x.liczba_egzemplarzy} egzemplarzy, a w ofercie ${offer.sztuk}`);
        }
      }
      if (x.egzemplarze === "komplet" && offer.typ !== "komplet") add("set_not_offered", [x], `ujęcie ${x.numer}: „komplet”, a aukcja sprzedaje ${offer.typ === "jeden" ? "jeden przedmiot" : "identyczne sztuki"}`);
      if (x.typ === "hero" && offer.typ === "komplet" && x.egzemplarze === "jeden") add("set_incomplete_hero", [x], `ujęcie ${x.numer}: hero kompletu pokazuje tylko jeden element`);
    }
  }
  return v;
}

/** What is recorded without being a violation. */
export function planNotes(shots: PlanShot[]): PlanNote[] {
  const details = shots.filter((x) => x.typ === "detal" && x.skala_cm !== null);
  return details.length
    ? [{ code: "scale_unknown", shots: details.map((x) => x.numer), detail: `ujęcia detalu ${details.map((x) => x.numer).join(", ")}: skala fragmentu bez wymiaru komponentu w karcie – nie porównywana z całością` }]
    : [];
}

export type PlanGate = {
  /** Shots that are not generated (and not charged): their hard violations, after the reference correction. */
  blocked: Map<number, string[]>;
  hard: Violation[];
  soft: Violation[];
  /** Hard rules broken by shots an admin fixed that do not touch honesty: shown, generated. */
  overridden: Violation[];
  /** No violation and no override left: the only state the admin may read as "verified". */
  verified: boolean;
};

/**
 * The last check before any paid image call, on the plan AS IT WILL BE SENT
 * (references already corrected by refs.ts): a hard violation stops its
 * shots; an admin's fixed shot is stopped only for a matter of honesty.
 */
export function planGate(violations: Violation[]): PlanGate {
  const blocked = new Map<number, string[]>();
  const hard: Violation[] = [];
  const soft: Violation[] = [];
  const overridden: Violation[] = [];
  for (const x of violations) {
    const severity = x.severity ?? severityOf(x.code);
    if (severity !== "hard") { soft.push(x); continue; }
    if (x.override && !HONESTY_VIOLATIONS.has(x.code)) { overridden.push(x); continue; }
    hard.push(x);
    for (const n of x.shots) blocked.set(n, [...(blocked.get(n) ?? []), x.code]);
  }
  return { blocked, hard, soft, overridden, verified: violations.length === 0 };
}

/** What the ordered count cannot satisfy — recorded, never solved by extra shots. */
function planConflicts(shots: PlanShot[], ctx: { card: ProductCard; shots: number }): string[] {
  const out: string[] = [];
  const detailPhotos = ctx.card.zdjecia.filter((p) => p.rola === "detal");
  const details = shots.filter((x) => x.typ === "detal");
  const uncovered = detailPhotos.filter((p) => !details.some((x) => x.referencje[0] === p.n));
  const required = Math.min(detailPhotos.length, Math.floor(ctx.shots / 2));
  if (uncovered.length > 0 && detailPhotos.length > required) {
    out.push(`zdjęcia detali bez własnego ujęcia przy ${ctx.shots} zamówionych: ${uncovered.map((p) => p.id).join(", ")}`);
  }
  return out;
}

export function planFeedback(c: Pick<PlanCheck, "structural" | "violations">): string {
  const lines = [...c.structural, ...c.violations.map((x) => x.detail)];
  return `Poprzedni plan naruszał reguły. Popraw dokładnie te punkty (pozycje ustalone przez administratora zostaw bez zmian) i zwróć cały plan od nowa:\n${lines.map((l) => `- ${l}`).join("\n")}`;
}

/** The plan as the scene writer and the admin read it (photo numbers as Z ids). */
export function planForPrompt(shots: PlanShot[]): string {
  return JSON.stringify(shots.map((x) => ({
    numer: x.numer, typ: x.typ, argument: x.argument, kierunek: x.kierunek, miejsce: x.miejsce, swiatlo: x.swiatlo, kadr: x.kadr,
    ludzie: x.ludzie, stan: x.stan, caly_produkt: x.caly_produkt, referencje: x.referencje.map((n, i) => `zdjęcie ${i + 1} = ${photoId(n)}`), opis: x.opis,
    ...(x.otoczenie ? { otoczenie: x.otoczenie } : {}),
    ...(x.egzemplarze ? { egzemplarze: x.egzemplarze, ...(x.liczba_egzemplarzy ? { liczba_egzemplarzy: x.liczba_egzemplarzy } : {}) } : {}),
  })));
}
