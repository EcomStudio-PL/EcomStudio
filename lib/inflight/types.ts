/**
 * GENERACJE W TOKU V2 — the shapes the server's in-progress view and the
 * browser's tiles share. Client-safe: no server import, no secret, no prompt.
 *
 * A tile is always a SERVER fact: a job row (`generation_jobs`) or a
 * Miniaturka run (`ai_engine_runs`) that exists, is paid for and is being
 * worked on. The browser never invents one — a click shows only a short
 * "sending" state until the server accepts it.
 */
import type { GalleryItem } from "@/lib/server/gallery";

export type InflightKind = "job" | "run";

/** The REAL step a run is on, never a timer's guess. GrovShot V2 orders
 *  report the six stages of their pipeline (Analizowanie produktu …
 *  Przygotowywanie wyników). */
export type InflightStage =
  | "generate" | "retouch" | "compose" | "finish"
  | "analyze" | "plan" | "scenes" | "images" | "qc" | "results";

export const GROVSHOT_V2_STAGES: readonly InflightStage[] = ["analyze", "plan", "scenes", "images", "qc", "results"];

export type InflightEntry = {
  /** The job id, or the Miniaturka run id. */
  id: string;
  kind: InflightKind;
  /** Feature key the tile names ("generator", "retouch", "ecommerce_thumbnail" …). */
  tool: string;
  /** `generation_jobs.settings.operation` — which gallery it belongs to. */
  operation: string | null;
  status: "queued" | "running";
  stage: InflightStage | null;
  /** "etap 2/3" — only for a multi-step run that reports its step. */
  step: { index: number; count: number } | null;
  /** GrovShot V2: shots finished (delivered or not) of the shots planned — a
   *  server fact, not a percentage. */
  shots?: { done: number; total: number } | null;
  /** When the SERVER started it — the timer counts from here, not from a click. */
  startedAt: string;
  /** Images this tile will become. */
  expected: number;
  ratio: string | null;
  batch: string | null;
  /** The browser's request id, when it sent one (recovers a lost answer). */
  request: string | null;
  /** Median of finished work like this one, or null (too few samples). */
  estimateMs: number | null;
  /** Only while the server says it waits and nothing was sent yet. */
  cancellable: boolean;
};

export type InflightRefund = "refunded" | "pending" | "not_charged" | "unknown";

export type InflightResolved = {
  id: string;
  kind: InflightKind;
  tool: string;
  operation: string | null;
  outcome: "done" | "partial" | "failed" | "cancelled";
  items: GalleryItem[];
  delivered: number;
  expected: number;
  /** A safe error code (never a provider message). */
  error: string | null;
  refund: InflightRefund;
  /** Credits the ledger returned, when it says so. */
  refundedCredits: number | null;
};

export type InflightLimit = { max: number; active: number; plan: string };

export type InflightSnapshot = {
  ok: true;
  active: InflightEntry[];
  resolved: InflightResolved[];
  limit: InflightLimit | null;
  balance: number | null;
  serverNow: string;
};

/** A job counts as in progress this long at most (no route lives past 300 s). */
export const JOB_STALE_MS = 15 * 60_000;

/** "etap n/m" for a Miniaturka run: Retusz on is three steps, off is two. */
export function thumbnailStep(stage: InflightStage | null, retouch: boolean): { index: number; count: number } | null {
  if (!stage || stage === "generate") return null;
  const order: InflightStage[] = retouch ? ["retouch", "compose", "finish"] : ["compose", "finish"];
  const index = order.indexOf(stage);
  return index < 0 ? null : { index: index + 1, count: order.length };
}

/** The estimate bucket of a job: what 0161's `generation_duration_estimates` keys by. */
export function jobEstimateKey(operation: string | null, conceptId: string | null, quantity: number): string {
  const op = operation || (conceptId ? "concept" : "generator");
  return `${op}:${Math.min(Math.max(Math.trunc(quantity) || 1, 1), 4)}`;
}

export function runEstimateKey(retouch: boolean): string {
  return `ecommerce_thumbnail:${retouch ? "retouch" : "plain"}`;
}

/** Past twice the usual time — the tile then says it may take longer. */
export function isSlow(elapsedMs: number, estimateMs: number | null): boolean {
  return estimateMs !== null && estimateMs > 0 && elapsedMs > estimateMs * 2;
}

/** "0:23", "1:05", "12:40" — minutes and seconds since the server start. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "ok. 40 s" / "ok. 2 min" — the usual time, rounded to what a person reads. */
export function estimateParts(ms: number): { unit: "s" | "min"; n: number } {
  const s = Math.round(ms / 1000);
  if (s < 90) return { unit: "s", n: Math.max(5, Math.round(s / 5) * 5) };
  return { unit: "min", n: Math.max(2, Math.round(s / 60)) };
}
