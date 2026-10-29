import "server-only";
import type { Client } from "@/lib/services/workspace";
import { dispatchToken } from "@/lib/server/server-token";
import { STAGE_ROLES } from "@/lib/grovshot-v2/config";
import { credentialOf, type ProviderState } from "@/lib/server/grovshot-v2/backends";
import type { GrovshotAdmin } from "@/lib/server/grovshot-v2/admin";

/**
 * GROVBASE SHOT V2 — THE READINESS CENTRE (/admin/ai → GrovShot → Silnik V2).
 *
 * Every line is read now from what the engine itself would use — the
 * published config's roles and their keys, the published texts, the image
 * model, the worker, the margin gate, the last FULL test — and says OK only
 * when that piece really is. Nothing here turns anything on; "ready" is never
 * shown while one line is not.
 */

export type CheckStatus = "ok" | "missing" | "published" | "drafts" | "error" | "blocked" | "pass" | "unverified";
export type Check = { key: string; status: CheckStatus; good: boolean; detail: string | null };

export type AnthropicUsage = { calls: number; input: number; output: number; cached: number; usdMicros: number; unknown: number };

export type Readiness = {
  checks: Check[];
  /** Every line good — the production test included. */
  ready: boolean;
  anthropic: { state: ProviderState; lastError: { code: string; at: string; model: string | null } | null; usage: AnthropicUsage };
  lastTest: { id: string; mode: "prompts" | "full" | null; status: string; at: string; delivered: number } | null;
};

/** An open order nobody has driven for this long is an orphan (the worker
 *  ticks every minute and takes the oldest first). */
const ORPHAN_AFTER_MS = 5 * 60_000;

export async function readReadiness(supabase: Client, admin: GrovshotAdmin): Promise<Readiness> {
  const { state, stages, economics, runs } = admin;
  const anthropic = await credentialOf(supabase, "anthropic").catch(() => ({ state: "no_key" as const }));
  const checks: Check[] = [];
  const add = (key: string, status: CheckStatus, detail: string | null = null) =>
    checks.push({ key, status, good: status === "ok" || status === "published" || status === "pass", detail });

  add("anthropic_key", anthropic.state === "ok" ? "ok" : "missing", anthropic.state === "ok" ? null : anthropic.state);
  for (const role of STAGE_ROLES) {
    const r = state.roles.find((x) => x.role === role);
    if (!r) { add(`model_${role}`, "missing", state.configOk ? "not_configured" : "config_unpublished"); continue; }
    const label = `${r.primary.provider} / ${r.primary.model}${r.primary.effort ? ` · ${r.primary.effort}` : ""}`
      + (r.fallback ? ` → ${r.fallback.provider} / ${r.fallback.model}` : "");
    add(`model_${role}`, r.usable ? "ok" : "missing", r.usable ? label : `${label} · ${r.primary.state}`);
  }
  add("nano_banana", state.model ? "ok" : "missing", state.model?.identifier ?? null);
  const unpublished = stages.filter((s) => s.published === null).map((s) => s.key.replace("grovshot_v2_", ""));
  add("templates", unpublished.length === 0 && state.configOk ? "published" : "drafts", unpublished.length ? unpublished.join(", ") : null);

  // The queue: the server can act for an order (its token), and no open order
  // has been left without a driver.
  const { data: open } = await supabase.from("ai_engine_runs").select("id, locked_until, updated_at")
    .in("run_kind", ["grovshot", "grovshot_test"]).in("status", ["queued", "running"]).limit(50);
  const now = Date.now();
  const orphans = (open ?? []).filter((r) => (!r.locked_until || Date.parse(r.locked_until) < now)
    && now - Date.parse(r.updated_at) > ORPHAN_AFTER_MS).length;
  add("queue", dispatchToken() && orphans === 0 ? "ok" : "error", !dispatchToken() ? "no_server_token" : orphans > 0 ? `orphans:${orphans}` : null);
  add("budget", economics?.customerAllowed ? "ok" : "blocked", economics ? null : "economics_unavailable");

  const tests = runs.filter((r) => r.kind === "grovshot_test");
  const passed = tests.find((r) => r.mode === "full" && (r.status === "ok" || r.status === "partial")
    && r.shots.some((s) => s.state === "delivered"));
  add("production_test", passed ? "pass" : "unverified", passed ? passed.id.slice(0, 8) : null);

  // Anthropic: its last error and what it was used for, over the recent orders.
  const usage: AnthropicUsage = { calls: 0, input: 0, output: 0, cached: 0, usdMicros: 0, unknown: 0 };
  let lastError: Readiness["anthropic"]["lastError"] = null;
  for (const r of runs) {
    for (const s of r.calls) {
      if (s.provider !== "anthropic") continue;
      usage.calls += 1; usage.input += s.input ?? 0; usage.output += s.output ?? 0; usage.cached += s.cached ?? 0;
      if (s.usdMicros === null) usage.unknown += 1; else usage.usdMicros += s.usdMicros;
      if (!s.ok && s.error && (!lastError || r.createdAt > lastError.at)) lastError = { code: s.error, at: r.createdAt, model: s.model };
    }
  }
  const last = tests[0];
  return {
    checks,
    ready: checks.every((c) => c.good),
    anthropic: { state: anthropic.state, lastError, usage },
    lastTest: last ? { id: last.id, mode: last.mode, status: last.status, at: last.createdAt, delivered: last.shots.filter((s) => s.state === "delivered").length } : null,
  };
}
