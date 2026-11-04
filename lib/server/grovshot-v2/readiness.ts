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
 * published config's roles and their keys, the published texts, the published
 * knowledge version, the image model, the worker, the margin gate, the last
 * prompt test and the last FULL test — and says OK only when that piece
 * really is. Each line that is not carries a REASON (a sentence, not a code)
 * and the exact page that fixes it. Nothing here turns anything on; "ready"
 * is never shown while one line is not. The flag line is information: V2
 * stays off for customers until the owner switches it on.
 */

export type CheckStatus = "ok" | "missing" | "published" | "drafts" | "error" | "blocked" | "pass" | "unverified" | "off" | "on";
export type Check = {
  key: string; status: CheckStatus; good: boolean; detail: string | null;
  /** aicc.gsv2.why.<reason> — the sentence the admin reads. */
  reason: string | null;
  params?: Record<string, string | number>;
  /** Where it is fixed. */
  href: string | null;
  /** Information only (does not count toward "ready"). */
  info?: boolean;
};

export type AnthropicUsage = { calls: number; input: number; output: number; cached: number; usdMicros: number; unknown: number };
/** Connected (its key passed the connection test) and active (switched on) are different things. */
export type AnthropicFacts = {
  providerId: string | null; state: ProviderState; active: boolean; hasKey: boolean; connected: boolean;
  lastTest: { status: string | null; at: string | null; latencyMs: number | null };
};

export type Readiness = {
  checks: Check[];
  /** Every gating line good — the production test included. */
  ready: boolean;
  anthropic: AnthropicFacts & { lastError: { code: string; at: string; model: string | null } | null; usage: AnthropicUsage };
  lastTest: { id: string; mode: "prompts" | "full" | null; status: string; at: string; delivered: number } | null;
};

/** An open order nobody has driven for this long is an orphan (the worker
 *  ticks every minute and takes the oldest first). */
const ORPHAN_AFTER_MS = 5 * 60_000;

const HREF = {
  providers: "/admin/ai/modele",
  config: "/admin/ai/prompts?tab=engine_v2&stage=grovshot_v2_config",
  stage: (k: string) => `/admin/ai/prompts?tab=engine_v2&stage=grovshot_v2_${k}`,
  knowledge: "/admin/ai/wiedza",
  econ: "/admin/ai/prompts?tab=engine_v2#gsv2-economics",
  test: "/admin/ai/prompts?tab=engine_v2#gsv2-test",
  flags: "/admin/system",
} as const;

export async function readReadiness(supabase: Client, admin: GrovshotAdmin): Promise<Readiness> {
  const { state, stages, economics, runs, flag } = admin;
  const [anthropicCred, { data: prov }, { data: activeK }, { count: pendingRules }] = await Promise.all([
    credentialOf(supabase, "anthropic").catch(() => ({ state: "no_key" as const })),
    supabase.from("ai_providers").select("id, active").eq("slug", "anthropic").maybeSingle(),
    supabase.from("knowledge_versions").select("version, delivered_count, activated_at").eq("tool_key", "grovshot_v2").eq("active", true).maybeSingle(),
    supabase.from("knowledge_rules").select("id", { count: "exact", head: true }).eq("tool_key", "grovshot_v2").eq("status", "pending"),
  ]);
  const { data: cred } = prov
    ? await supabase.from("ai_provider_credentials").select("last_test_status, last_tested_at, last_test_latency_ms").eq("provider_id", prov.id).maybeSingle()
    : { data: null };
  const facts: AnthropicFacts = {
    providerId: prov?.id ?? null, state: anthropicCred.state, active: prov?.active === true, hasKey: Boolean(cred), connected: cred?.last_test_status === "connected",
    lastTest: { status: cred?.last_test_status ?? null, at: cred?.last_tested_at ?? null, latencyMs: cred?.last_test_latency_ms ?? null },
  };

  const checks: Check[] = [];
  const add = (key: string, status: CheckStatus, detail: string | null, reason: string | null, href: string | null, params?: Record<string, string | number>, info = false) =>
    checks.push({ key, status, good: info || status === "ok" || status === "published" || status === "pass", detail, reason, href, ...(params ? { params } : {}), ...(info ? { info } : {}) });

  // Anthropic: the key works (connected) AND the provider is switched on (active).
  if (facts.state === "ok") add("anthropic_key", "ok", facts.connected ? "connected · active" : "active", null, null);
  else if (!facts.hasKey) add("anthropic_key", "missing", "no_key", "anthropic_no_key", HREF.providers);
  else if (!facts.active) add("anthropic_key", "missing", facts.connected ? "connected · inactive" : "inactive", facts.connected ? "anthropic_inactive_connected" : "anthropic_inactive", HREF.providers);
  else add("anthropic_key", "error", facts.lastTest.status ?? "no_key", "anthropic_key_unreadable", HREF.providers);

  STAGE_ROLES.forEach((role, i) => {
    const r = state.roles.find((x) => x.role === role);
    const n = i;
    if (!r) {
      if (!state.configOk) add(`model_${role}`, "missing", "config_unpublished", "model_config_unpublished", HREF.config, { n });
      else add(`model_${role}`, "missing", "not_configured", "model_not_configured", HREF.config, { n });
      return;
    }
    const label = `${r.primary.provider} / ${r.primary.model}${r.primary.effort ? ` · ${r.primary.effort}` : ""}`
      + (r.fallback ? ` → ${r.fallback.provider} / ${r.fallback.model}` : "");
    if (r.usable) add(`model_${role}`, "ok", label, null, null);
    else add(`model_${role}`, "missing", `${label} · ${r.primary.state}`, r.primary.state === "inactive" ? "model_provider_inactive" : "model_provider_no_key", HREF.providers, { n, provider: r.primary.provider });
  });
  add("nano_banana", state.model ? "ok" : "missing", state.model?.identifier ?? null, state.model ? null : "nano_banana_missing", state.model ? null : HREF.providers);
  const unpublished = stages.filter((s) => s.published === null).map((s) => s.key.replace("grovshot_v2_", ""));
  const drafts = stages.filter((s) => s.published === null && s.drafts > 0).length;
  if (unpublished.length === 0 && state.configOk) add("templates", "published", stages.map((s) => `${s.key.replace("grovshot_v2_", "")} v${s.published}`).join(", "), null, null);
  else add("templates", "drafts", unpublished.join(", ") || "config_invalid", drafts > 0 ? "templates_drafts" : "templates_none",
    HREF.stage(unpublished[0] ?? "config"), { list: unpublished.join(", "), n: unpublished.length });

  // The expert knowledge the stages read: a published version.
  if (activeK && activeK.delivered_count > 0) add("knowledge", "published", `v${activeK.version} · ${activeK.delivered_count}`, null, null);
  else add("knowledge", "missing", `pending:${pendingRules ?? 0}`, (pendingRules ?? 0) > 0 ? "knowledge_review" : "knowledge_none", HREF.knowledge, { n: pendingRules ?? 0 });

  // The queue: the server can act for an order (its token), and no open order
  // has been left without a driver.
  const { data: open } = await supabase.from("ai_engine_runs").select("id, locked_until, updated_at")
    .in("run_kind", ["grovshot", "grovshot_test"]).in("status", ["queued", "running"]).limit(50);
  const now = Date.now();
  const orphans = (open ?? []).filter((r) => (!r.locked_until || Date.parse(r.locked_until) < now)
    && now - Date.parse(r.updated_at) > ORPHAN_AFTER_MS).length;
  if (!dispatchToken()) add("queue", "error", "no_server_token", "queue_no_token", null);
  else if (orphans > 0) add("queue", "error", `orphans:${orphans}`, "queue_orphans", null, { n: orphans });
  else add("queue", "ok", null, null, null);

  // The margin gate — never opened by hiding an unknown cost.
  if (!economics || economics.preview) {
    add("budget", "blocked", "economics_unavailable", state.configOk ? "budget_no_model" : "budget_config_unpublished", state.configOk ? HREF.providers : HREF.config);
  } else if (economics.customerAllowed) {
    add("budget", "ok", null, null, null);
  } else {
    const t5 = economics.tables.map((tb) => ({ res: tb.resolution, row: tb.rows.find((r) => r.shots === 5 && r.scenario === "typical") }))
      .find((x) => x.row && !x.row.meetsFloor) ?? null;
    const estimated = economics.tables.some((tb) => tb.rows.some((r) => r.estimated));
    add("budget", "blocked", t5?.row ? `5×${t5.res}: ${t5.row.marginPercent ?? "—"}%` : "below_floor",
      estimated ? "budget_estimated" : "budget_below_floor", HREF.econ,
      { floor: economics.billing.minMarginPercent, res: t5?.res ?? "2K", margin: t5?.row?.marginPercent ?? 0, min: economics.tables.find((tb) => tb.resolution === (t5?.res ?? "2K"))?.breakEvenCredits ?? "—" });
  }

  const tests = runs.filter((r) => r.kind === "grovshot_test");
  const promptPass = tests.find((r) => r.mode === "prompts" && (r.status === "ok" || r.status === "partial"));
  add("prompt_test", promptPass ? "pass" : "unverified", promptPass ? promptPass.id.slice(0, 8) : null, promptPass ? null : "prompt_test_missing", promptPass ? null : HREF.test);
  const passed = tests.find((r) => r.mode === "full" && (r.status === "ok" || r.status === "partial")
    && r.shots.some((s) => s.state === "delivered"));
  add("production_test", passed ? "pass" : "unverified", passed ? passed.id.slice(0, 8) : null, passed ? null : "production_test_missing", passed ? null : HREF.test);

  // Information: who the flag routes to V2 (it stays off for customers).
  add("flag", flag.enabled ? "on" : "off", flag.enabled ? `${flag.roles.join(", ") || "*"} · ${flag.rollout ?? 100}%` : null,
    flag.enabled ? "flag_on" : "flag_off", HREF.flags, { roles: flag.roles.join(", ") || "*" }, true);

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
    anthropic: { ...facts, lastError, usage },
    lastTest: last ? { id: last.id, mode: last.mode, status: last.status, at: last.createdAt, delivered: last.shots.filter((s) => s.state === "delivered").length } : null,
  };
}
