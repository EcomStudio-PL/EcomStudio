/**
 * GROVBASE SHOT — ENGINE SETTINGS (app_settings key "grovshot_shot"), the
 * image retry policy and the order status. Pure.
 *
 * The settings name the Claude model of each step, the GLOBAL concurrency
 * limits (text/vision calls and Nano Banana Pro calls, across every server
 * instance), the order's spend allowance and the scenarios. An order pins
 * the settings it started with (input.settings) — a change applies to new
 * orders only.
 */
import { CLAUDE_STAGE_MODELS, isStageModelRef, type StageModel } from "@/lib/grovshot-v2/config";

export const SHOT_STEPS = ["card", "plan", "prompt"] as const;
export type ShotStep = (typeof SHOT_STEPS)[number];

export type ShotSettings = {
  models: Record<ShotStep, StageModel>;
  limits: {
    /** Claude calls of the engine in flight at once, every instance together. */
    text_concurrency: number;
    /** Nano Banana Pro calls of the engine in flight at once, every instance together. */
    image_concurrency: number;
  };
  /** Text/vision spend one order may reach (USD), on top of its images. */
  text_budget_usd: number;
  /** The minimum description length a customer must paste (stage 2 form). */
  description_min_chars: number;
  scenarios: { lifestyle: boolean; reklamowa: boolean };
  /** Admin diagnostics: days the full network-boundary payloads are kept
   *  (then only their summary), and the daily ceiling of an admin's paid
   *  single-shot experiments (USD, every admin together). */
  diagnostics: { retention_days: number; experiment_daily_budget_usd: number };
};

/** The defaults: Sonnet 5.5 for the card, the plan and the prompts (no Opus by default). */
export const DEFAULT_SHOT_SETTINGS: ShotSettings = {
  models: {
    card: { provider: "anthropic", model: "claude-sonnet-5-5", effort: "medium" },
    plan: { provider: "anthropic", model: "claude-sonnet-5-5", effort: "medium" },
    prompt: { provider: "anthropic", model: "claude-sonnet-5-5", effort: "medium" },
  },
  // Until the accounts' real limits are read (Anthropic rate-limit headers,
  // Google AI Studio quota): the per-instance limits the app already runs with.
  limits: { text_concurrency: 2, image_concurrency: 2 },
  text_budget_usd: 1.5,
  description_min_chars: 80,
  scenarios: { lifestyle: true, reklamowa: false },
  diagnostics: { retention_days: 30, experiment_daily_budget_usd: 2 },
};

export const LIMIT_RANGE = { min: 1, max: 20 } as const;
export const RETENTION_RANGE = { min: 1, max: 365 } as const;

export function parseShotSettings(raw: unknown): { ok: true; settings: ShotSettings } | { ok: false; errors: string[] } {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  if (!r) return { ok: true, settings: DEFAULT_SHOT_SETTINGS };
  const errors: string[] = [];
  const models = { ...DEFAULT_SHOT_SETTINGS.models };
  const m = (r.models && typeof r.models === "object" ? r.models : {}) as Record<string, unknown>;
  for (const step of SHOT_STEPS) {
    if (m[step] === undefined) continue;
    if (!isStageModelRef(m[step])) { errors.push(`models.${step}`); continue; }
    const ref = m[step] as StageModel;
    models[step] = { provider: ref.provider, model: ref.model, ...(ref.effort ? { effort: ref.effort } : {}) };
  }
  const lim = (r.limits && typeof r.limits === "object" ? r.limits : {}) as Record<string, unknown>;
  const int = (v: unknown, d: number, key: string) => {
    if (v === undefined) return d;
    if (typeof v !== "number" || !Number.isInteger(v) || v < LIMIT_RANGE.min || v > LIMIT_RANGE.max) { errors.push(key); return d; }
    return v;
  };
  const limits = {
    text_concurrency: int(lim.text_concurrency, DEFAULT_SHOT_SETTINGS.limits.text_concurrency, "limits.text_concurrency"),
    image_concurrency: int(lim.image_concurrency, DEFAULT_SHOT_SETTINGS.limits.image_concurrency, "limits.image_concurrency"),
  };
  const budget = r.text_budget_usd === undefined ? DEFAULT_SHOT_SETTINGS.text_budget_usd : r.text_budget_usd;
  if (typeof budget !== "number" || !(budget > 0 && budget <= 20)) errors.push("text_budget_usd");
  const minChars = r.description_min_chars === undefined ? DEFAULT_SHOT_SETTINGS.description_min_chars : r.description_min_chars;
  if (typeof minChars !== "number" || !Number.isInteger(minChars) || minChars < 0 || minChars > 5000) errors.push("description_min_chars");
  const sc = (r.scenarios && typeof r.scenarios === "object" ? r.scenarios : {}) as Record<string, unknown>;
  const scenarios = {
    lifestyle: sc.lifestyle === undefined ? true : sc.lifestyle === true,
    reklamowa: sc.reklamowa === true,
  };
  const dg = (r.diagnostics && typeof r.diagnostics === "object" ? r.diagnostics : {}) as Record<string, unknown>;
  const days = dg.retention_days === undefined ? DEFAULT_SHOT_SETTINGS.diagnostics.retention_days : dg.retention_days;
  if (typeof days !== "number" || !Number.isInteger(days) || days < RETENTION_RANGE.min || days > RETENTION_RANGE.max) errors.push("diagnostics.retention_days");
  const exp = dg.experiment_daily_budget_usd === undefined ? DEFAULT_SHOT_SETTINGS.diagnostics.experiment_daily_budget_usd : dg.experiment_daily_budget_usd;
  if (typeof exp !== "number" || !(exp >= 0 && exp <= 50)) errors.push("diagnostics.experiment_daily_budget_usd");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    settings: {
      models, limits, text_budget_usd: budget as number, description_min_chars: minChars as number, scenarios,
      diagnostics: { retention_days: days as number, experiment_daily_budget_usd: exp as number },
    },
  };
}

export const SHOT_MODEL_CHOICES = CLAUDE_STAGE_MODELS;

/* ── image retries ("jak działa automatyzacja", krok 5) ───────────────────*/

/** Timeout, 5xx, rate limit: two retries, growing gaps (or Retry-After when longer). */
export const IMAGE_TRANSIENT_DELAYS_MS = [10_000, 30_000] as const;
/** A safety refusal: the same request once more. */
export const IMAGE_SAFETY_RETRIES = 1;
export const IMAGE_MAX_CALLS = 1 + IMAGE_TRANSIENT_DELAYS_MS.length;

export type ImageErrorClass = "transient" | "safety" | "final";
const TRANSIENT = new Set(["provider_timeout", "provider_rate_limited", "provider_error", "provider_unreachable", "round_lost", "model_overloaded"]);
const SAFETY = new Set(["content_policy", "provider_empty_result"]);
export function classifyImageError(code: string | null | undefined): ImageErrorClass {
  if (!code) return "final";
  if (TRANSIENT.has(code)) return "transient";
  if (SAFETY.has(code)) return "safety";
  return "final";
}

/** After the failed calls so far (oldest first): another call, and when. */
export function nextImageAttempt(failures: { cls: ImageErrorClass; retryAfterMs?: number | null }[]): { retry: false } | { retry: true; delayMs: number } {
  if (failures.length === 0) return { retry: true, delayMs: 0 };
  if (failures.length >= IMAGE_MAX_CALLS) return { retry: false };
  const last = failures[failures.length - 1];
  if (last.cls === "final") return { retry: false };
  if (last.cls === "safety") {
    const safety = failures.filter((f) => f.cls === "safety").length;
    return safety > IMAGE_SAFETY_RETRIES ? { retry: false } : { retry: true, delayMs: 0 };
  }
  const transient = failures.filter((f) => f.cls === "transient").length;
  if (transient > IMAGE_TRANSIENT_DELAYS_MS.length) return { retry: false };
  const base = IMAGE_TRANSIENT_DELAYS_MS[Math.min(transient, IMAGE_TRANSIENT_DELAYS_MS.length) - 1];
  return { retry: true, delayMs: Math.min(120_000, Math.max(base, last.retryAfterMs ?? 0)) };
}

/* ── the order status ("jak działa automatyzacja": statusy zlecenia) ───────*/

export const ORDER_STATUSES = ["nowe", "karta", "plan", "prompty", "generacja", "gotowe", "czesciowo_gotowe", "nieudane"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export function orderStatus(run: { status: string; progress?: unknown }): OrderStatus {
  if (run.status === "ok") return "gotowe";
  if (run.status === "partial") return "czesciowo_gotowe";
  if (run.status === "failed" || run.status === "blocked" || run.status === "cancelled") return "nieudane";
  const stage = run.progress && typeof run.progress === "object" ? (run.progress as Record<string, unknown>).stage : null;
  if (run.status === "queued" && !stage) return "nowe";
  if (stage === "analyze") return "karta";
  if (stage === "plan") return "plan";
  if (stage === "scenes") return "prompty";
  if (stage === "images" || stage === "results") return "generacja";
  return run.status === "queued" ? "nowe" : "karta";
}
