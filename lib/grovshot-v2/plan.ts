/**
 * GROVBASE SHOT V2 · ETAP 2 — the SHOT PLAN, checked in code.
 *
 * The planner (a text model, fed the card and the recipe) directs the
 * session; this module holds it to the spec's rules („Etap 2: reguły planu
 * ujęć”) and turns it into shots the later stages can execute:
 *
 *   HARD rules (a violation triggers the ONE re-plan the config allows):
 *     · shot count, each frame type ≤ 2×, whole product ≤ 2 shots,
 *     · people / hands / animals within the table („Ludzie i zwierzęta”),
 *     · a seasonal motif only on a seasonal product,
 *     · the customer's plan rows honoured,
 *     · every shot's state has a photo (no part nobody has seen).
 *   DETERMINISTIC fixes (always applied, recorded):
 *     · references re-selected from the card (same state only, the whole
 *       product next to a close-up, the customer's chosen photo first),
 *     · visible units of a set clamped to 3 when people are in the frame,
 *     · lens clamped to 50–100 mm, the auction order product → function →
 *       emotion when the customer gave no order.
 *   Candidates per shot and the quality footer are decided HERE, not by the
 *   model: 2 for people, animals and high-risk scenes, otherwise 1.
 */
import {
  FIDELITY_MODES, FRAME_TYPES, PEOPLE_MODES, SHOT_PURPOSES, WHOLE_PRODUCT_FRAMES, peopleRow,
  type EngineConfig, type FidelityMode, type FooterKind, type FrameType, type PeopleMode, type RecipeId, type ShotPurpose,
} from "@/lib/grovshot-v2/config";
import type { ProductCard } from "@/lib/grovshot-v2/card";
import { RISK_LEVELS, type RiskLevel } from "@/lib/grovshot-v2/stages";

export type UserRow = { text?: string; keepFraming?: boolean; refIndex?: number };

export type Shot = {
  index: number;
  title: string;
  summary: string;
  argument_id: string;
  argument: string;
  purpose: ShotPurpose;
  use: string;
  place: string;
  frame_type: FrameType;
  camera: { angle_deg: number; height: string; distance: string; lens_mm: number; placement: string };
  fidelity_mode: FidelityMode;
  product_state: string;
  /** Photo numbers (1-based upload order) in SEND order. */
  references: number[];
  people: PeopleMode;
  person: string;
  grip: string;
  moment: string;
  motion: string;
  vehicle_motion: boolean;
  scenery: string;
  visible_units: number | null;
  risk: RiskLevel;
  risks: string[];
  seasonal_motif: boolean;
  user_row: number | null;
  candidates: 1 | 2;
  footer: FooterKind;
  whole: boolean;
};

export type PlanViolation =
  | { code: "count"; expected: number; got: number }
  | { code: "frame_repeat"; frame: FrameType; count: number }
  | { code: "whole_cap"; count: number }
  | { code: "people_over"; mode: "person" | "hands" | "animal"; count: number; max: number }
  | { code: "people_under"; mode: "person" | "hands"; count: number; min: number }
  | { code: "season"; shot: number }
  | { code: "user_row_missing"; row: number }
  | { code: "state_uncovered"; shot: number }
  | { code: "whole_missing"; shot: number }
  | { code: "argument_duplicate"; argument: string; count: number }
  | { code: "non_action_outside_hero"; shot: number; argument: string };

export type PlanCheck = {
  shots: Shot[];
  violations: PlanViolation[];
  fixes: string[];
  /** Planned shots that cannot be made (their indices in the model's plan). */
  dropped: number[];
  /** Customer-visible notes (codes + row numbers). */
  notes: { code: "user_photo_excluded"; row: number }[];
};

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const s = (v: unknown, max = 600): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(String(v)) ? (v as T) : fallback;
const int = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

/** Frames that look at a part of the product: they get the whole as a second reference. */
const CLOSE_FRAMES: ReadonlySet<FrameType> = new Set(["tight_closeup", "in_hand", "medium"]);
const PURPOSE_ORDER: Record<ShotPurpose, number> = { product: 0, function: 1, emotion: 2 };

/** What the people table allows for this order (spec table + exceptions). */
export function peopleTargets(config: EngineConfig, shots: number, card: ProductCard) {
  const row = peopleRow(config, shots);
  return {
    person: row.person,
    // Products used in the hand: hands may be in most shots.
    hands: card.handheld ? ([row.hands[0], shots] as [number, number]) : row.hands,
    // Products for animals: the animal is the hero — not capped by the person column.
    animals: card.for_animals ? ([0, shots] as [number, number]) : ([0, row.person[1]] as [number, number]),
    handheld: card.handheld,
    for_animals: card.for_animals,
  };
}

/** {{people_targets}} for the plan template — data. */
export function renderPeopleTargets(t: ReturnType<typeof peopleTargets>): string {
  return JSON.stringify({ person: t.person, hands: t.hands, animals: t.animals, handheld: t.handheld, for_animals: t.for_animals });
}

/** {{user_shot_plan}} — the customer's rows, numbered like the shots (data). */
export function renderUserPlan(rows: readonly UserRow[] | undefined): string {
  const out = (rows ?? []).map((r, i) => ({ row: i + 1, text: r.text?.trim() ?? "", photo: r.refIndex ?? null, keep_framing: !!r.keepFraming }))
    .filter((r) => r.text || r.photo !== null);
  return out.length > 0 ? JSON.stringify(out) : "";
}

function footerFor(shot: Pick<Shot, "people" | "frame_type" | "vehicle_motion" | "motion">, recipe: RecipeId): FooterKind {
  if (shot.vehicle_motion) return "motion";
  if (shot.people === "animal") return "animals";
  if (shot.people === "person" || shot.people === "hands") return recipe === "beauty_editorial" ? "beauty" : "action_people";
  if (shot.frame_type === "tight_closeup") return "macro_detail";
  if (shot.frame_type === "medium" && shot.motion) return "action_people";
  return "interior_hero";
}

export function candidatesFor(shot: Pick<Shot, "people" | "risk">, config: EngineConfig): 1 | 2 {
  const many = shot.people !== "none" || shot.risk === "high";
  return (many ? config.candidates.people_or_complex : config.candidates.default) === 2 ? 2 : 1;
}

/**
 * Deterministic reference choice for one shot. Same input → same photos in
 * the same order; the order IS the numbering the prompt uses („zdjęcie 1”).
 */
export function selectReferences(
  shot: { frame_type: FrameType; product_state: string; planned: number[]; forced: number | null },
  card: ProductCard, cap: number,
): number[] {
  const refs = card.photos.filter((p) => p.reference);
  const byNo = new Map(refs.map((p) => [p.photo, p]));
  const sameState = (n: number) => byNo.get(n)?.state === shot.product_state;
  const isProduct = (n: number) => byNo.get(n)?.role !== "packaging" && byNo.get(n)?.role !== "effect";
  const out: number[] = [];
  const add = (n: number | null | undefined) => {
    if (n != null && byNo.has(n) && !out.includes(n) && out.length < cap) out.push(n);
  };

  // 1. The customer's chosen photo leads (the shot's state follows it).
  if (shot.forced !== null && byNo.has(shot.forced)) add(shot.forced);
  // 2. The planner's photos, same state, product photos before effect photos.
  for (const n of shot.planned) if (sameState(n) && isProduct(n)) add(n);
  // 3. Nothing planned fits: the card's photos of that state — whole first.
  if (out.length === 0) {
    const ofState = refs.filter((p) => p.state === shot.product_state && isProduct(p.photo));
    ofState.sort((a, b) => Number(b.whole) - Number(a.whole) || a.photo - b.photo);
    add(ofState[0]?.photo);
  }
  if (out.length === 0) return [];
  // 4. A close-up always travels with the whole product (same state).
  if (CLOSE_FRAMES.has(shot.frame_type) && !out.some((n) => byNo.get(n)?.whole)) {
    const whole = refs.filter((p) => p.whole && p.state === shot.product_state && isProduct(p.photo)).sort((a, b) => a.photo - b.photo)[0];
    add(whole?.photo);
  }
  // 5. The complementary photo: an effect-of-use photo the planner named.
  for (const n of shot.planned) if (byNo.get(n)?.role === "effect") { add(n); break; }
  return out;
}

/** Check and normalise the planner's output. Pure: same input, same plan. */
export function checkPlan(
  rawValue: unknown,
  ctx: { card: ProductCard; shots: number; userRows: readonly UserRow[] | undefined; config: EngineConfig },
): PlanCheck {
  const { card, config } = ctx;
  const raw = isObj(rawValue) && Array.isArray(rawValue.shots) ? rawValue.shots.filter(isObj) : [];
  const violations: PlanViolation[] = [];
  const fixes: string[] = [];
  const dropped: number[] = [];
  const notes: PlanCheck["notes"] = [];
  const isReference = (n: number | undefined) => n !== undefined && card.photos.some((p) => p.photo === n && p.reference);
  (ctx.userRows ?? []).forEach((row, i) => {
    if (row.refIndex !== undefined && !isReference(row.refIndex)) notes.push({ code: "user_photo_excluded", row: i + 1 });
  });
  if (raw.length < ctx.shots) violations.push({ code: "count", expected: ctx.shots, got: raw.length });
  if (raw.length > ctx.shots) fixes.push(`truncated:${raw.length}`);

  const stateIds = new Set(card.states.map((x) => x.id));
  const sellingIds = new Set(card.selling_points.map((x) => x.id));
  const cap = Math.max(1, Math.min(6, config.limits.max_refs_per_shot));
  const maxSet = Math.max(0, ...card.counts.map((c) => c.count));

  const shots: Shot[] = [];
  raw.slice(0, ctx.shots).forEach((r, i) => {
    const frame_type = pick(r.frame_type, FRAME_TYPES, "medium");
    const people = pick(r.people, PEOPLE_MODES, "none");
    const userRow = int(r.user_row, 0, 10, 0);
    const brief = userRow > 0 ? ctx.userRows?.[userRow - 1] : undefined;
    const forced = brief?.refIndex ?? null;
    // The customer's photo decides the state (never two states in one frame).
    const forcedState = forced !== null ? card.photos.find((p) => p.photo === forced && p.reference)?.state : undefined;
    let product_state = forcedState ?? (stateIds.has(s(r.product_state, 60)) ? s(r.product_state, 60) : "");
    if (!product_state) {
      // An unknown state: the state of the first planned photo, else the first state.
      const firstPlanned = (Array.isArray(r.reference_photos) ? r.reference_photos : [])
        .map((n) => card.photos.find((p) => p.photo === n && p.reference)).find(Boolean);
      product_state = firstPlanned?.state ?? card.states[0].id;
      fixes.push(`state:${i + 1}`);
    }
    const planned = (Array.isArray(r.reference_photos) ? r.reference_photos : [])
      .filter((n): n is number => typeof n === "number").map((n) => Math.round(n));
    const references = selectReferences({ frame_type, product_state, planned, forced }, card, cap);
    if (references.length === 0) {
      violations.push({ code: "state_uncovered", shot: i + 1 });
      dropped.push(i);
      return;
    }
    // The whole product only where a photo shows it whole (spec: the model
    // „składa produkt z fragmentów” otherwise).
    if (WHOLE_PRODUCT_FRAMES.has(frame_type) && !card.photos.some((p) => p.reference && p.whole && p.state === product_state)) {
      violations.push({ code: "whole_missing", shot: i + 1 });
      dropped.push(i);
      return;
    }
    if (references.join() !== planned.slice(0, references.length).join()) fixes.push(`refs:${i + 1}`);

    const camera = isObj(r.camera) ? r.camera : {};
    const lens = int(camera.lens_mm, 50, 100, 70);
    if (typeof camera.lens_mm === "number" && camera.lens_mm !== lens) fixes.push(`lens:${i + 1}`);
    const risk = pick(r.risk, RISK_LEVELS, "medium");
    let visible = typeof r.visible_units === "number" && r.visible_units > 0 ? Math.round(r.visible_units) : null;
    // Spec: many pieces in a scene with people — at most 2–3 visible.
    if (people !== "none" && maxSet > 3 && (visible === null || visible > 3)) { visible = 3; fixes.push(`units:${i + 1}`); }
    const named = s(r.argument_id, 40);
    const argument_id = sellingIds.has(named) ? named : card.selling_points[0].id;
    if (argument_id !== named) fixes.push(`argument:${i + 1}`);
    const shot: Shot = {
      index: i,
      title: s(r.title, 80) || card.selling_points.find((x) => x.id === argument_id)!.text.slice(0, 80),
      summary: s(r.summary, 240),
      argument_id,
      argument: s(r.argument, 240) || card.selling_points.find((x) => x.id === argument_id)!.text,
      purpose: pick(r.purpose, SHOT_PURPOSES, "function"),
      use: s(r.use, 200),
      place: s(r.place, 160),
      frame_type,
      camera: {
        angle_deg: int(camera.angle_deg, -90, 90, 0),
        height: s(camera.height, 120),
        distance: s(camera.distance, 120),
        lens_mm: lens,
        placement: s(camera.placement, 300),
      },
      fidelity_mode: brief?.keepFraming ? "faithful" : pick(r.fidelity_mode, FIDELITY_MODES, "faithful"),
      product_state,
      references,
      people,
      person: people === "none" ? "" : s(r.person, 500),
      grip: people === "hands" || people === "person" ? s(r.grip, 500) : "",
      moment: s(r.moment, 700),
      motion: s(r.motion, 300),
      vehicle_motion: r.vehicle_motion === true,
      scenery: s(r.scenery, 1400),
      visible_units: visible,
      risk,
      risks: Array.isArray(r.risks) ? [...new Set(r.risks.map((x) => s(x, 120)).filter(Boolean))].slice(0, 8) : [],
      seasonal_motif: r.seasonal_motif === true,
      user_row: userRow > 0 && brief ? userRow : null,
      candidates: 1,
      footer: "interior_hero",
      whole: WHOLE_PRODUCT_FRAMES.has(frame_type),
    };
    shot.candidates = candidatesFor(shot, config);
    shot.footer = footerFor(shot, card.recipe_id);
    shots.push(shot);
  });

  // Variety: each frame type at most twice (as far as the count allows).
  const perFrame = new Map<FrameType, number>();
  for (const sh of shots) perFrame.set(sh.frame_type, (perFrame.get(sh.frame_type) ?? 0) + 1);
  const limit = Math.max(2, Math.ceil(ctx.shots / FRAME_TYPES.length));
  for (const [frame, count] of perFrame) if (count > limit) violations.push({ code: "frame_repeat", frame, count });
  const whole = shots.filter((sh) => sh.whole).length;
  if (whole > 2) violations.push({ code: "whole_cap", count: whole });

  const t = peopleTargets(config, ctx.shots, card);
  const count = (m: PeopleMode) => shots.filter((sh) => sh.people === m).length;
  const persons = count("person") + (card.for_animals ? 0 : count("animal"));
  if (persons > t.person[1]) violations.push({ code: "people_over", mode: "person", count: persons, max: t.person[1] });
  if (count("hands") > t.hands[1]) violations.push({ code: "people_over", mode: "hands", count: count("hands"), max: t.hands[1] });
  if (card.for_animals && count("animal") > t.animals[1]) violations.push({ code: "people_over", mode: "animal", count: count("animal"), max: t.animals[1] });
  // Below the table: one re-plan is worth it; after that the plan stands (a
  // person is never written into a scene by code).
  // The table's „cała postać” is the living subject: for a product made for
  // animals the animal hero fills it (spec: „zwierzę jest bohaterem”).
  const living = count("person") + count("animal");
  if (shots.length === ctx.shots && living < t.person[0]) violations.push({ code: "people_under", mode: "person", count: living, min: t.person[0] });
  if (shots.length === ctx.shots && count("hands") < t.hands[0]) violations.push({ code: "people_under", mode: "hands", count: count("hands"), min: t.hands[0] });

  if (!card.season.seasonal) for (const sh of shots) if (sh.seasonal_motif) violations.push({ code: "season", shot: sh.index + 1 });
  // One shot = one selling point (when the card has enough of them), and an
  // argument with nothing to show in action belongs in the hero only.
  if (ctx.shots <= card.selling_points.length) {
    const perArg = new Map<string, number>();
    for (const sh of shots) perArg.set(sh.argument_id, (perArg.get(sh.argument_id) ?? 0) + 1);
    for (const [argument, n] of perArg) if (n > 1) violations.push({ code: "argument_duplicate", argument, count: n });
  }
  for (const sh of shots) {
    const sp = card.selling_points.find((x) => x.id === sh.argument_id);
    if (sp && !sp.has_action && sh.frame_type !== "hero") violations.push({ code: "non_action_outside_hero", shot: sh.index + 1, argument: sp.id });
  }
  (ctx.userRows ?? []).forEach((row, i) => {
    if ((row.text?.trim() || row.refIndex) && !shots.some((sh) => sh.user_row === i + 1)) violations.push({ code: "user_row_missing", row: i + 1 });
  });

  // The auction order — only when the customer did not number the shots.
  const ordered = (ctx.userRows ?? []).some((r) => r.text?.trim() || r.refIndex)
    ? shots
    : [...shots].sort((a, b) => Number(b.frame_type === "hero") - Number(a.frame_type === "hero")
      || PURPOSE_ORDER[a.purpose] - PURPOSE_ORDER[b.purpose] || a.index - b.index);
  if (ordered.some((sh, i) => sh !== shots[i])) fixes.push("order");
  ordered.forEach((sh, i) => { sh.index = i; });
  return { shots: ordered, violations, fixes, dropped, notes };
}

/** Violations a re-plan should try to fix (all of them are hard rules). */
export const needsReplan = (c: PlanCheck): boolean => c.violations.length > 0;

/** After the re-plan: what still makes the order impossible (before any
 *  charge). Everything else stands with the violation recorded. */
export function fatalPlan(c: PlanCheck): "plan_empty" | null {
  return c.shots.length === 0 ? "plan_empty" : null;
}

/** {{plan_feedback}} — the violations, as data for the single re-plan. */
export function renderPlanFeedback(violations: readonly PlanViolation[]): string {
  return JSON.stringify(violations);
}
