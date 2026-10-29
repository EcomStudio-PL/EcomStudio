/**
 * GROVBASE SHOT V2 · ETAP 4 — the quality decision, in CODE.
 *
 * The vision model reports findings (a category from the published list, a
 * confidence, random/systematic); the decision is made here against the
 * config, because „fałszywe odrzucenie też kosztuje pełną generację, więc
 * próg odrzucenia musi mieć tolerancję”:
 *
 *   reject_always  → rejected at ≥ reject_confidence, in every shot;
 *   reject_hero    → rejected at ≥ reject_confidence only in a whole-product shot;
 *   tolerate       → recorded, never rejects;
 *   a reject-level finding between warn and reject confidence → delivered
 *   with quality 'warning'; below warn → ignored.
 *
 * Plus the code's own colour check (color.ts), which only ever adds a
 * finding when its measurement was conclusive.
 *
 * Retry (spec „Reakcja na błąd”): at most ONE more generation per shot, from
 * scratch, never an edit. A random error retries the same prompt; a
 * systematic one (marked so, or the same category in both candidates)
 * retries with the QC correction placed through {{shot_correction}}.
 */
import { ERROR_KINDS, qcCategory, type EngineConfig, type ErrorKind, type QcLevel } from "@/lib/grovshot-v2/config";
import type { RawQc } from "@/lib/grovshot-v2/stages";

export type QcFinding = {
  category: string;
  level: QcLevel;
  kind: ErrorKind;
  confidence: number;
  detail: string;
  source: "model" | "code";
};

export type QcVerdict = "passed" | "warning" | "rejected";

export type QcDecision = {
  verdict: QcVerdict;
  rejecting: QcFinding[];
  warnings: QcFinding[];
  tolerated: QcFinding[];
  /** Categories the model named that the config does not know (dropped). */
  unknown: string[];
  errorKind: ErrorKind | null;
  correction: string | null;
  productBox: { x: number; y: number; w: number; h: number } | null;
};

const clamp01 = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const s = (v: unknown, max = 300): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export function decideQc(
  raw: RawQc,
  ctx: { config: EngineConfig; isHero: boolean; codeFindings?: QcFinding[] },
): QcDecision {
  const { config } = ctx;
  const findings: QcFinding[] = [];
  const unknown: string[] = [];
  for (const f of Array.isArray(raw.findings) ? raw.findings.slice(0, 30) : []) {
    const id = s(f?.category, 60);
    const cat = qcCategory(config, id);
    if (!cat) { if (id) unknown.push(id); continue; }
    findings.push({
      category: cat.id,
      level: cat.level,
      kind: (ERROR_KINDS as readonly string[]).includes(String(f?.kind)) ? (f!.kind as ErrorKind) : cat.kind,
      confidence: clamp01(f?.confidence),
      detail: s(f?.detail, 300),
      source: "model",
    });
  }
  // The product is not in the picture at all: nothing to deliver.
  if (raw.product_visible === false) {
    findings.push({ category: "product_missing", level: "reject_always", kind: "random", confidence: 1, detail: "product_not_visible", source: "code" });
  }
  findings.push(...(ctx.codeFindings ?? []));

  const counts = (f: QcFinding) => f.level === "reject_always" || (f.level === "reject_hero" && ctx.isHero);
  const rejecting = findings.filter((f) => counts(f) && f.confidence >= config.qc.reject_confidence);
  const warnings = findings.filter((f) => counts(f) && f.confidence >= config.qc.warn_confidence && f.confidence < config.qc.reject_confidence);
  const tolerated = findings.filter((f) => !rejecting.includes(f) && !warnings.includes(f));
  const verdict: QcVerdict = rejecting.length > 0 ? "rejected" : warnings.length > 0 ? "warning" : "passed";
  const errorKind: ErrorKind | null = rejecting.length === 0 ? null : rejecting.some((f) => f.kind === "systematic") ? "systematic" : "random";

  let correction: string | null = null;
  if (errorKind === "systematic") {
    // The model's own short correction; without one, the admin-written
    // labels of what was rejected (never invented wording).
    correction = s(raw.correction, 300)
      || rejecting.filter((f) => f.kind === "systematic").map((f) => qcCategory(config, f.category)?.label ?? f.category).join("; ").slice(0, 300)
      || null;
  }

  const b = raw.product_box;
  const box = b && clamp01(b.w) > 0 && clamp01(b.h) > 0
    ? { x: clamp01(b.x), y: clamp01(b.y), w: clamp01(b.w), h: clamp01(b.h) }
    : null;
  return { verdict, rejecting, warnings, tolerated, unknown: [...new Set(unknown)].slice(0, 10), errorKind, correction, productBox: box };
}

/** The candidate to deliver: passed before warning, fewer warnings, then
 *  the lower strongest warning, then the earlier candidate. */
export function pickBest(decisions: readonly (QcDecision | null)[]): number | null {
  let best: number | null = null;
  const score = (d: QcDecision) => [d.verdict === "passed" ? 0 : 1, d.warnings.length, Math.max(0, ...d.warnings.map((w) => w.confidence))];
  decisions.forEach((d, i) => {
    if (!d || d.verdict === "rejected") return;
    if (best === null) { best = i; return; }
    const a = score(d);
    const b = score(decisions[best]!);
    for (let k = 0; k < a.length; k++) {
      if (a[k] < b[k]) { best = i; return; }
      if (a[k] > b[k]) return;
    }
  });
  return best;
}

export type RetryPlan = { retry: false } | { retry: true; mode: "same" | "amended"; correction: string | null };

/**
 * After round 0: retry at most once. `decisions[i] === null` means candidate
 * i produced no image (a transport failure): that is no quality signal, and
 * a shot with no image at all may still use its single retry.
 */
export function planRetry(decisions: readonly (QcDecision | null)[], config: EngineConfig, roundsUsed: number): RetryPlan {
  if (pickBest(decisions) !== null) return { retry: false };
  if (roundsUsed >= config.retry.max_rounds) return { retry: false };
  const judged = decisions.filter((d): d is QcDecision => d !== null);
  if (judged.length === 0) return { retry: true, mode: "same", correction: null };
  // „Powtarza się przy każdej próbie”: one category rejected in every candidate.
  const repeated = judged.length >= 2
    && judged[0].rejecting.some((f) => judged.every((d) => d.rejecting.some((g) => g.category === f.category)));
  const systematic = repeated || judged.some((d) => d.errorKind === "systematic");
  if (!systematic) return { retry: true, mode: "same", correction: null };
  const corrections = [...new Set(judged.map((d) => d.correction).filter((c): c is string => !!c))];
  const fallback = [...new Set(judged.flatMap((d) => d.rejecting.map((f) => qcCategory(config, f.category)?.label ?? f.category)))].join("; ");
  const correction = (corrections.join(" ") || fallback).slice(0, 600) || null;
  return { retry: true, mode: correction ? "amended" : "same", correction };
}
