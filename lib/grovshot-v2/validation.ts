/**
 * GROVBASE SHOT V2 · ETAP 0 — the decision on the input, in CODE.
 *
 * The models only REPORT; what happens next is decided here, against the
 * thresholds of the published config, so the same report always leads to the
 * same outcome:
 *
 *   act  (confidence ≥ act_confidence)  → acted on: a photo is excluded or
 *        kept for reading data only, an order is blocked;
 *   ask  (ask ≤ confidence < act)       → the customer is asked to confirm
 *        BEFORE anything is charged („Kontynuuj mimo to” keeps the photo);
 *   below ask                            → ignored (no invented problems).
 *
 * The photo gates (other product, stock photo, licensed character, blur…)
 * come from a call that never sees the customer's description, so pasted
 * text cannot talk its way past them. The description-dependent checks
 * (dimensions, description-vs-photo conflicts) come from the card stage and
 * are decided by `decideAfterCard` — still before any charge.
 *
 * Customer messages are CODES (+ photo numbers); the client translates them.
 * Model prose never reaches the customer.
 */
import type { EngineConfig } from "@/lib/grovshot-v2/config";
import { PHOTO_ISSUES, type PhotoIssueCode, type RawValidation } from "@/lib/grovshot-v2/stages";

export type PhotoStatus = "ok" | "analysis_only" | "excluded";

export const NOTE_CODES = [
  "photo_blurry", "photo_other_product", "photo_other_variant", "photo_stock", "photo_cropped",
  "photo_overlay", "photo_additions", "description_conflict", "dimensions_missing",
  "dimensions_ambiguous", "dimensions_estimated", "licensed_character", "no_usable_photo",
  "mixed_products", "no_clean_photo", "no_whole_photo", "user_photo_excluded", "plan_short",
] as const;
export type NoteCode = (typeof NOTE_CODES)[number];

/** A customer-visible note: a code, the photo it concerns, and whether the
 *  customer must confirm it before the order may go on. */
export type CustomerNote = { code: NoteCode; photo?: number; ask?: boolean };

export type ValidationVerdict = "proceed" | "attention" | "needs_dimensions" | "blocked";

export type ValidatedPhoto = {
  number: number;
  status: PhotoStatus;
  state: string;
  angle: string;
  /** Issues acted on or asked about (codes only). */
  reasons: PhotoIssueCode[];
};

export type ValidationResult = {
  verdict: ValidationVerdict;
  photos: ValidatedPhoto[];
  notes: CustomerNote[];
  licensed: boolean;
};

const clamp01 = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const text = (v: unknown, max = 300): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Issue → what an acted-on issue does to the photo, and its note code. */
const EFFECT: Record<PhotoIssueCode, { act: PhotoStatus | "note"; note: NoteCode; askable: boolean }> = {
  blurry: { act: "excluded", note: "photo_blurry", askable: true },
  different_product: { act: "excluded", note: "photo_other_product", askable: true },
  other_variant: { act: "excluded", note: "photo_other_variant", askable: true },
  stock_or_render: { act: "excluded", note: "photo_stock", askable: true },
  cropped: { act: "analysis_only", note: "photo_cropped", askable: false },
  overlay: { act: "analysis_only", note: "photo_overlay", askable: false },
  warped_text_nearby: { act: "analysis_only", note: "photo_overlay", askable: false },
  reference_additions: { act: "note", note: "photo_additions", askable: false },
};

const RANK: Record<PhotoStatus, number> = { ok: 0, analysis_only: 1, excluded: 2 };
const worse = (a: PhotoStatus, b: PhotoStatus): PhotoStatus => (RANK[b] > RANK[a] ? b : a);

function verdictOf(blocked: boolean, ask: boolean, dims: boolean, acknowledge: boolean): ValidationVerdict {
  if (blocked) return "blocked";
  if (!acknowledge && dims) return "needs_dimensions";
  if (!acknowledge && ask) return "attention";
  return "proceed";
}

/** Stage 0: the photo gates. */
export function decideValidation(
  raw: RawValidation,
  ctx: { photoCount: number; acknowledge: boolean },
  cfg: EngineConfig["validation"],
): ValidationResult {
  const act = cfg.act_confidence;
  const ask = cfg.ask_confidence;
  const notes: CustomerNote[] = [];
  const askNotes: CustomerNote[] = [];
  const reported = new Map<number, NonNullable<RawValidation["photos"]>[number]>();
  for (const p of Array.isArray(raw.photos) ? raw.photos : []) {
    const n = typeof p?.number === "number" ? Math.round(p.number) : NaN;
    if (n >= 1 && n <= ctx.photoCount && !reported.has(n)) reported.set(n, p);
  }

  let otherProductActed = 0;
  const photos: ValidatedPhoto[] = [];
  for (let n = 1; n <= ctx.photoCount; n++) {
    const p = reported.get(n);
    let status: PhotoStatus = "ok";
    const reasons: PhotoIssueCode[] = [];
    // A photo the model said nothing about has no evidence of a problem. One
    // it plainly called another product counts as that issue, acted on.
    const issues = Array.isArray(p?.issues) ? [...p.issues] : [];
    if (p?.same_product === false && !issues.some((i) => i?.code === "different_product")) {
      issues.push({ code: "different_product", confidence: act, detail: "" });
    }
    for (const issue of issues) {
      const code = String(issue?.code) as PhotoIssueCode;
      if (!(PHOTO_ISSUES as readonly string[]).includes(code)) continue;
      const conf = clamp01(issue?.confidence);
      const eff = EFFECT[code];
      if (conf >= act) {
        if (eff.act !== "note") status = worse(status, eff.act);
        if (code === "different_product") otherProductActed++;
        reasons.push(code);
        notes.push({ code: eff.note, photo: n });
      } else if (conf >= ask) {
        if (eff.askable) {
          // Asked, not acted on: the photo stays usable once the customer confirms.
          reasons.push(code);
          askNotes.push({ code: eff.note, photo: n, ask: true });
        } else if (eff.act !== "note") {
          // Overlays and crops are cheap to be careful about: the photo is
          // still read for data, just never sent as a generation reference.
          status = worse(status, eff.act);
          reasons.push(code);
          notes.push({ code: eff.note, photo: n });
        } else {
          notes.push({ code: eff.note, photo: n });
        }
      }
    }
    photos.push({ number: n, status, state: text(p?.state, 120), angle: text(p?.angle, 120), reasons: [...new Set(reasons)] });
  }

  // Order-level decisions. Blocking ones cannot be confirmed away.
  const blocked: CustomerNote[] = [];
  const licensed = licensedDecision(raw.licensed_character, cfg);
  if (licensed === "block") blocked.push({ code: "licensed_character" });
  else if (licensed === "ask") askNotes.push({ code: "licensed_character", ask: true });
  else if (licensed === "note") notes.push({ code: "licensed_character" });
  if (ctx.photoCount >= 2 && otherProductActed * 2 >= ctx.photoCount) blocked.push({ code: "mixed_products" });
  if (photos.every((p) => p.status === "excluded")) blocked.push({ code: "no_usable_photo" });
  // Only data-only photos left (arrows, phones, dimension lines on every
  // shot): such a photo is never sent to the image model — the customer is
  // asked for one clean photo of the product (spec: Etap 0, pkt 3).
  else if (!photos.some((p) => p.status === "ok")) blocked.push({ code: "no_clean_photo" });

  const verdict = verdictOf(blocked.length > 0, askNotes.length > 0, false, ctx.acknowledge);
  const all = verdict === "blocked" ? [...blocked, ...notes] : [...notes, ...askNotes];
  return { verdict, photos, notes: dedupeNotes(all).slice(0, 30), licensed: licensed !== null };
}

/**
 * A licensed character (spec: „Decyzja do podjęcia” — not ours to take):
 * at act confidence the published policy decides; between ask and act the
 * customer is asked (unless the policy only records it); below ask nothing.
 */
function licensedDecision(
  l: { suspected?: boolean; confidence?: number } | undefined, cfg: EngineConfig["validation"],
): "block" | "ask" | "note" | null {
  if (l?.suspected !== true) return null;
  const conf = clamp01(l.confidence);
  if (conf < cfg.ask_confidence) return null;
  if (cfg.licensed_policy === "allow") return "note";
  if (conf >= cfg.act_confidence) return cfg.licensed_policy === "block" ? "block" : "ask";
  return "ask";
}

/** What the card stage reported that depends on the description. */
export type CardSignals = {
  dimensions: { in_description: boolean; ambiguous: boolean; scale_critical: boolean; confidence: number };
  conflicts: number;
  licensed: { suspected: boolean; confidence: number };
  /** Some reference photo shows the WHOLE product. */
  wholePhoto: boolean;
};

/**
 * After the card: the description-dependent checks. The card can only ADD
 * a block (a licensed character it noticed) — never lift one from Stage 0.
 */
export function decideAfterCard(
  v: ValidationResult,
  card: CardSignals,
  ctx: { customerDimensions: string | null; acknowledge: boolean },
  cfg: EngineConfig["validation"],
): ValidationResult {
  if (v.verdict === "blocked") return v;
  const notes = [...v.notes];
  const licensed = licensedDecision(card.licensed, cfg);
  if (licensed === "block") {
    return { ...v, verdict: "blocked", licensed: true, notes: dedupeNotes([{ code: "licensed_character" }, ...notes]) };
  }
  if (licensed === "ask") notes.push({ code: "licensed_character", ask: true });
  else if (licensed === "note") notes.push({ code: "licensed_character" });
  if (card.conflicts > 0) notes.push({ code: "description_conflict" });
  // No photo of the whole product: the model would assemble it from parts
  // (spec: szafka, szczoteczka). The customer is asked for one; confirmed,
  // the plan keeps to views the photos cover (no hero, no wide shot).
  if (!card.wholePhoto) notes.push({ code: "no_whole_photo", ask: true });
  const d = card.dimensions;
  const conf = clamp01(d.confidence);
  let dims = false;
  if (!ctx.customerDimensions?.trim()) {
    if (d.in_description && d.ambiguous && conf >= cfg.ask_confidence) {
      dims = true;
      notes.push({ code: "dimensions_ambiguous", ask: true });
    } else if (!d.in_description && d.scale_critical && conf < cfg.act_confidence) {
      // Not in the description, the size decides the shot, and the model is
      // not sure of its own estimate: the customer is asked (spec Etap 0 pkt 5).
      dims = true;
      notes.push({ code: "dimensions_missing", ask: true });
    } else if (!d.in_description) {
      notes.push({ code: "dimensions_estimated" });
    }
  }
  const ask = notes.some((n) => n.ask);
  return {
    ...v, licensed: v.licensed || licensed !== null,
    verdict: verdictOf(false, ask, dims, ctx.acknowledge), notes: dedupeNotes(notes).slice(0, 30),
  };
}

function dedupeNotes(list: CustomerNote[]): CustomerNote[] {
  const seen = new Set<string>();
  return list.filter((n) => {
    const k = `${n.code}:${n.photo ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** {{validation_summary}} for the card stage — data (JSON), no prose. */
export function validationForPrompt(v: ValidationResult): string {
  return JSON.stringify(v.photos.map((p) => ({ photo: p.number, status: p.status, state: p.state, angle: p.angle, reasons: p.reasons })));
}
