import "server-only";
import type { Client } from "@/lib/services/workspace";
import type { ReferenceImage } from "@/lib/ai/types";
import { ProviderError } from "@/lib/ai/types";
import { callVisionJson, openAiSystemText, type VisionAttempt, type VisionBackend } from "@/lib/ai/engine/vision";
import { TOOL_VARIABLES, compileTemplate, parsePlaceholders, sanitizeValue, type CompileValues } from "@/lib/ai/prompt-variables";
import { tokenCost, type Cost, type TokenPrice } from "@/lib/ai/usage-cost";
import { recordProviderCalls, type Consumer } from "@/lib/server/ai-usage";
import { splitStageTemplate, type GrovshotStageKey } from "@/lib/grovshot-v2/stages";
import type { EngineConfig } from "@/lib/grovshot-v2/config";
import { sha256 } from "@/lib/server/grovshot-v2/media";

/**
 * ONE AI STAGE CALL (Etap 0, 1, 2 or 4) — the published template, compiled,
 * and nothing else.
 *
 *   system message = the template's SYSTEM section, compiled (config text
 *                    and closed values only — the publish gate guarantees it);
 *   user message   = the template's USER section, compiled (the customer's
 *                    and the models' data);
 *   images         = what the stage was given, in order.
 *
 * The vision layer adds the output contract (the JSON schema) — for OpenAI
 * as a fixed suffix of the system text (`openAiSystemText`), which the trace
 * below hashes exactly as sent. Deadline-aware: one request per model, a
 * timeout that fits what is left of the invocation, and only as many
 * backends as that time can hold. A value longer than its variable allows
 * fails the call before it is made (`variable_too_long`) — nothing is cut
 * silently.
 */

export type StageKey = Exclude<GrovshotStageKey, "grovshot_v2_shot" | "grovshot_v2_config">;

export type StageCall = {
  key: StageKey;
  body: string;
  values: CompileValues;
  images: ReferenceImage[];
  schema: Record<string, unknown>;
  timeoutMs: number;
  deadlineAt: number;
  backends: VisionBackend[];
  models?: EngineConfig["models"];
  tokenPrices: readonly TokenPrice[];
  now: () => number;
};

export type StageTrace = {
  provider: string | null;
  model: string | null;
  system_sha256: string;
  user_sha256: string;
  images: number;
  attempts: { provider: string; model: string; ok: boolean; ms: number; error?: string; in?: number; out?: number }[];
  duration_ms: number;
};

export type StageResult<T> =
  | { ok: true; data: T; trace: StageTrace; cost: Cost; unknownCalls: number; attempts: VisionAttempt[] }
  | { ok: false; error: string; trace: StageTrace | null; cost: Cost; unknownCalls: number; attempts: VisionAttempt[] };

const STAGE_MODEL_KEY: Record<StageKey, keyof EngineConfig["models"]> = {
  grovshot_v2_validate: "validate", grovshot_v2_card: "card", grovshot_v2_plan: "plan", grovshot_v2_qc: "qc",
};

/** The published per-stage model, first; the chain's own order otherwise. */
function orderBackends(backends: VisionBackend[], key: StageKey, models?: EngineConfig["models"]): VisionBackend[] {
  const pick = models?.[STAGE_MODEL_KEY[key]];
  if (!pick) return backends;
  const preferred = backends.filter((b) => b.provider === pick.provider).map((b) => ({ ...b, model: pick.model }));
  return [...preferred, ...backends.filter((b) => b.provider !== pick.provider)];
}

/** Every referenced value within its variable's limit — or the call fails
 *  (the name of the first one that is not). */
export function checkLimits(key: GrovshotStageKey, template: string, values: CompileValues): string | null {
  const defs = new Map((TOOL_VARIABLES[key] ?? []).map((d) => [d.key, d]));
  for (const name of new Set(parsePlaceholders(template).map((p) => p.name))) {
    const def = defs.get(name);
    const v = values[name];
    if (!def || typeof v !== "string") continue;
    // Measured after the same cleaning the compiler applies, before its cap.
    if (sanitizeValue(v, { ...def, max: Number.MAX_SAFE_INTEGER }).length > def.max) return name;
  }
  return null;
}

export async function callStage<T>(supabase: Client, call: StageCall, rec: {
  consumer: Consumer; actorKind: "customer" | "admin"; userId: string; workspaceId: string; runRef: string;
}): Promise<StageResult<T>> {
  const none: Cost = { basis: "estimated", usdMicros: 0 };
  const split = splitStageTemplate(call.body);
  if (!split) return { ok: false, error: "template_layout", trace: null, cost: none, unknownCalls: 0, attempts: [] };
  const tooLong = checkLimits(call.key, call.body, call.values);
  if (tooLong) return { ok: false, error: `variable_too_long:${tooLong}`.slice(0, 80), trace: null, cost: none, unknownCalls: 0, attempts: [] };
  const defs = TOOL_VARIABLES[call.key] ?? [];
  const sys = compileTemplate(split.system, defs, call.values);
  const usr = compileTemplate(split.user, defs, call.values);
  if (!sys.ok || !usr.ok) {
    const missing = [...(sys.ok ? [] : sys.missing), ...(usr.ok ? [] : usr.missing)];
    return { ok: false, error: `variable_missing:${missing[0] ?? ""}`.slice(0, 80), trace: null, cost: none, unknownCalls: 0, attempts: [] };
  }

  const left = call.deadlineAt - call.now();
  const timeoutMs = Math.max(5_000, Math.min(call.timeoutMs, left - 10_000));
  // Only as many backends as the time left can hold, at one request each.
  const room = Math.max(1, Math.floor(left / (timeoutMs + 5_000)));
  const attempts: VisionAttempt[] = [];
  const backends = orderBackends(call.backends, call.key, call.models).slice(0, room).map((b) => ({
    ...b, meter: (a: VisionAttempt) => { attempts.push(a); b.meter?.(a); },
  }));
  const started = call.now();
  let data: T | null = null;
  let error: string | null = null;
  let served: { provider: string; model: string } | null = null;
  try {
    const r = await callVisionJson<T>(backends, {
      images: call.images, system: sys.text, user: usr.text, schema: call.schema,
      timeoutMs, maxAttemptsPerModel: 1,
    });
    data = r.data;
    served = { provider: r.outcome.provider, model: r.outcome.model };
  } catch (e) {
    error = e instanceof ProviderError ? e.safeMessage : "analysis_error";
  }

  // The cost of every request actually made — tokens × the admin's price
  // list; unknown when either is missing (never a guessed zero).
  const costs = attempts.map((a) => tokenCost(call.tokenPrices, a.provider, a.model, a.inputTokens, a.outputTokens, a.cachedInputTokens));
  const known = costs.reduce((s, c) => s + (c.basis === "unknown" ? 0 : c.usdMicros), 0);
  const unknownCalls = costs.filter((c) => c.basis === "unknown").length;
  await recordProviderCalls(supabase, attempts.map((a, i) => ({
    actorKind: rec.actorKind, consumer: rec.consumer, userId: rec.userId, workspaceId: rec.workspaceId,
    toolKey: "prompts", runRef: rec.runRef, providerSlug: a.provider, model: a.model,
    status: a.ok ? "succeeded" : "failed", errorCode: a.ok ? null : (a.error ?? "analysis_error"),
    inputTokens: a.inputTokens ?? null, outputTokens: a.outputTokens ?? null, cachedInputTokens: a.cachedInputTokens ?? null,
    cost: costs[i], durationMs: a.durationMs,
  })));

  // What was sent, as digests: the exact system text the provider read (for
  // OpenAI with its schema suffix), the user text, the image count.
  const systemSent = served?.provider === "openai" ? openAiSystemText({ system: sys.text, schema: call.schema }) : sys.text;
  const trace: StageTrace = {
    provider: served?.provider ?? null,
    model: served?.model ?? null,
    system_sha256: sha256(systemSent),
    user_sha256: sha256(usr.text),
    images: call.images.length,
    attempts: attempts.map((a) => ({
      provider: a.provider, model: a.model, ok: a.ok, ms: a.durationMs,
      ...(a.error ? { error: a.error } : {}),
      ...(a.inputTokens != null ? { in: a.inputTokens } : {}),
      ...(a.outputTokens != null ? { out: a.outputTokens } : {}),
    })),
    duration_ms: call.now() - started,
  };
  const cost: Cost = unknownCalls > 0 && known === 0 ? { basis: "unknown" } : { basis: "estimated", usdMicros: known };
  if (data === null) return { ok: false, error: error ?? "analysis_error", trace, cost, unknownCalls, attempts };
  return { ok: true, data, trace, cost, unknownCalls, attempts };
}
