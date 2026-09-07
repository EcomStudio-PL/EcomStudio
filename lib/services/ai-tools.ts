import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  FEATURE_REGISTRY, type FeatureKey, type FeatureStatus, type FeatureDescriptor,
} from "@/lib/features";

type Client = SupabaseClient<Database>;

/**
 * THE TOOL REGISTRY — one row per customer-facing tool, assembled from the
 * systems that already own each fact.
 *
 *   identity, route, name .......... lib/features.ts (the feature registry)
 *   status ......................... feature_availability
 *   credits, API cost .............. service_catalog
 *   engine mode, models, prompt .... ai_tools / ai_tool_models / ai_tool_prompts
 *   last run, failures ............. usage_events
 *
 * Nothing here is a second source of truth. If a tool's status looks wrong,
 * the answer is on the availability screen; if its price looks wrong, in the
 * catalogue. This module only joins.
 */

/** The tools an operator configures. Category workspaces (/k/moda …) are entry
 *  points into the generator, not separate engines, so they are not listed. */
export const AI_TOOL_KEYS = [
  "prompts", "generator", "retouch",
  "editor", "resize", "compress",
  "tool_upscale", "tool_expand", "tool_watermark",
  "video",
] as const;
export type AiToolKey = (typeof AI_TOOL_KEYS)[number];

export function isAiToolKey(value: string): value is AiToolKey {
  return (AI_TOOL_KEYS as readonly string[]).includes(value);
}

export const ENGINE_MODES = ["off", "grovbase", "user", "hybrid"] as const;
export type EngineMode = (typeof ENGINE_MODES)[number];

/** Which family a tool belongs to on the registry screen. */
export type ToolCategory = "generation" | "editing" | "local" | "video";

const CATEGORY: Record<AiToolKey, ToolCategory> = {
  prompts: "generation", generator: "generation", retouch: "editing",
  editor: "local", resize: "local", compress: "local", tool_watermark: "local",
  tool_upscale: "editing", tool_expand: "editing", video: "video",
};

export type ToolModel = {
  id: string;
  name: string;
  role: "primary" | "fallback" | "allowed";
  providerName: string | null;
  active: boolean;
};

export type ToolRow = {
  key: AiToolKey;
  /** i18n key of the customer-facing name — the same one the menu uses. */
  nameKey: string;
  path: string;
  category: ToolCategory;
  /** From feature_availability, via the registry default when unset. */
  status: FeatureStatus;
  hiddenFromMenu: boolean;
  engineMode: EngineMode;
  /** Has a published hidden prompt, and which version. */
  promptVersion: number | null;
  serviceSlug: string | null;
  /** Credits the catalogue charges for one run. */
  credits: number | null;
  /** Whether the catalogue row is enabled / in maintenance. */
  serviceEnabled: boolean;
  serviceMaintenance: boolean;
  models: ToolModel[];
  allowModelChoice: boolean;
  fallbackEnabled: boolean;
  knowledgeSets: number;
  /** Newest usage event for this tool's service, and how the last 30 days went. */
  lastRunAt: string | null;
  runs30d: number;
  failures30d: number;
  /** True when no `ai_tools` row exists yet — the tool has never been configured. */
  unconfigured: boolean;
};

const descriptorFor = (key: AiToolKey): FeatureDescriptor | undefined =>
  FEATURE_REGISTRY.find((f) => f.key === (key as FeatureKey));

/**
 * Everything the registry screen shows, in five queries rather than five per
 * tool. `usage_events` is read once for the whole window and folded in memory:
 * ten tools would otherwise be ten aggregate round trips for one page.
 */
export async function readToolRegistry(
  supabase: Client,
  availability: Partial<Record<FeatureKey, { status: FeatureStatus; hiddenFromMenu: boolean }>>,
): Promise<ToolRow[]> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [toolsRes, modelsRes, promptsRes, knowledgeRes, servicesRes, usageRes] = await Promise.all([
    supabase.from("ai_tools").select("*"),
    supabase.from("ai_tool_models").select("tool_key, model_id, role, sort_order"),
    supabase.from("ai_tool_prompts").select("tool_key, version").eq("status", "published"),
    supabase.from("ai_tool_knowledge").select("tool_key").eq("enabled", true),
    supabase.from("service_catalog").select("slug, credits_cost, enabled, maintenance_mode"),
    supabase.from("usage_events")
      .select("service_slug, status, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20000),
  ]);

  const modelIds = [...new Set((modelsRes.data ?? []).map((m) => m.model_id))];
  const { data: modelRows } = modelIds.length
    ? await supabase.from("ai_models")
        .select("id, name, display_name, active, ai_providers(name)")
        .in("id", modelIds)
    : { data: [] as never[] };

  const modelById = new Map(
    ((modelRows ?? []) as unknown as {
      id: string; name: string; display_name: string | null; active: boolean;
      ai_providers: { name: string } | null;
    }[]).map((m) => [m.id, m]),
  );
  const modelsByTool = new Map<string, ToolModel[]>();
  for (const link of (modelsRes.data ?? []).sort((a, b) => a.sort_order - b.sort_order)) {
    const model = modelById.get(link.model_id);
    if (!model) continue;
    const list = modelsByTool.get(link.tool_key) ?? [];
    list.push({
      id: model.id,
      name: model.display_name || model.name,
      role: link.role as ToolModel["role"],
      providerName: model.ai_providers?.name ?? null,
      active: model.active,
    });
    modelsByTool.set(link.tool_key, list);
  }

  const promptVersion = new Map((promptsRes.data ?? []).map((p) => [p.tool_key, p.version]));
  const knowledgeCount = new Map<string, number>();
  for (const k of knowledgeRes.data ?? []) {
    knowledgeCount.set(k.tool_key, (knowledgeCount.get(k.tool_key) ?? 0) + 1);
  }
  const service = new Map((servicesRes.data ?? []).map((s) => [s.slug, s]));
  const configured = new Map((toolsRes.data ?? []).map((t) => [t.tool_key, t]));

  // One pass over the window, keyed by the service each tool bills.
  const usage = new Map<string, { last: string | null; runs: number; failures: number }>();
  for (const e of usageRes.data ?? []) {
    const u = usage.get(e.service_slug) ?? { last: null, runs: 0, failures: 0 };
    u.runs += 1;
    if (e.status === "failed" || e.status === "refunded") u.failures += 1;
    if (!u.last || e.created_at > u.last) u.last = e.created_at;
    usage.set(e.service_slug, u);
  }

  return AI_TOOL_KEYS.map((key): ToolRow => {
    const descriptor = descriptorFor(key);
    const row = configured.get(key);
    const state = availability[key as FeatureKey];
    const svc = row?.service_slug ? service.get(row.service_slug) : undefined;
    const stats = row?.service_slug ? usage.get(row.service_slug) : undefined;
    return {
      key,
      nameKey: descriptor?.nameKey ?? `admin.aiTools.name.${key}`,
      path: descriptor?.path ?? "",
      category: CATEGORY[key],
      status: state?.status ?? "ACTIVE",
      hiddenFromMenu: state?.hiddenFromMenu ?? false,
      engineMode: (row?.engine_mode as EngineMode) ?? "off",
      promptVersion: promptVersion.get(key) ?? null,
      serviceSlug: row?.service_slug ?? null,
      credits: svc?.credits_cost ?? null,
      serviceEnabled: svc?.enabled ?? true,
      serviceMaintenance: svc?.maintenance_mode ?? false,
      models: modelsByTool.get(key) ?? [],
      allowModelChoice: row?.allow_model_choice ?? false,
      fallbackEnabled: row?.fallback_enabled ?? false,
      knowledgeSets: knowledgeCount.get(key) ?? 0,
      lastRunAt: stats?.last ?? null,
      runs30d: stats?.runs ?? 0,
      failures30d: stats?.failures ?? 0,
      unconfigured: !row,
    };
  });
}

/** The prompt history for one tool. The BODY is deliberately not selected —
 *  a hidden prompt never travels to a list view. */
export type PromptVersionRow = {
  id: string;
  version: number;
  status: string;
  summary: string | null;
  reason: string | null;
  source: string;
  createdAt: string;
  publishedAt: string | null;
  authorName: string | null;
};

export async function readPromptHistory(supabase: Client, toolKey: string): Promise<PromptVersionRow[]> {
  const { data } = await supabase
    .from("ai_tool_prompts")
    .select("id, version, status, summary, reason, source, created_at, published_at, created_by")
    .eq("tool_key", toolKey)
    .order("version", { ascending: false })
    .limit(50);
  const rows = data ?? [];
  const authorIds = [...new Set(rows.map((r) => r.created_by).filter(Boolean))] as string[];
  const { data: authors } = authorIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", authorIds)
    : { data: [] as { id: string; full_name: string | null; email: string }[] };
  const nameById = new Map((authors ?? []).map((a) => [a.id, a.full_name ?? a.email]));
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    status: r.status,
    summary: r.summary,
    reason: r.reason,
    source: r.source,
    createdAt: r.created_at,
    publishedAt: r.published_at,
    authorName: r.created_by ? nameById.get(r.created_by) ?? null : null,
  }));
}
