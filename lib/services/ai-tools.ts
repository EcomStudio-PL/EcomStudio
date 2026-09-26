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
 *   status, menu visibility ........ feature_availability (written only by
 *                                    app/actions/features.ts)
 *   credits, API cost .............. service_catalog
 *   engine mode, models, prompt .... ai_tools / ai_tool_models / ai_tool_prompts
 *   last run, failures ............. usage_events
 *
 * Nothing here is a second source of truth. A status is changed through the
 * availability actions, a price in the service catalogue (Admin → Usługi);
 * this module only joins.
 */

/** The tools an operator configures. Category workspaces (/k/moda …) are entry
 *  points into the generator, not separate engines, so they are not listed. */
export const AI_TOOL_KEYS = [
  "prompts", "generator", "retouch",
  "editor", "resize", "compress",
  "tool_upscale", "tool_expand", "tool_watermark",
  "video",
  // Moda. Each is model-driven and prompt-driven, so each gets the full set of
  // admin tabs — this is where their prompts are written and published.
  "fashion_ghost_mannequin", "fashion_flat_lay", "fashion_iron", "fashion_change_person",
  "fashion_change_face",
] as const;
export type AiToolKey = (typeof AI_TOOL_KEYS)[number];

export function isAiToolKey(value: string): value is AiToolKey {
  return (AI_TOOL_KEYS as readonly string[]).includes(value);
}

export const ENGINE_MODES = ["off", "grovbase", "user", "hybrid", "workflow"] as const;
export type EngineMode = (typeof ENGINE_MODES)[number];

/**
 * WHICH MODES A TOOL CAN REALLY RUN. A mode appears in the admin picker only
 * when the tool's server path implements it — the panel never offers a switch
 * that would decide nothing, and the save action refuses anything else.
 *
 *   prompts   GrovShot. A published template replaces the built-in master
 *             template; with none published it runs exactly as before.
 *   generator The customer's own prompt ('user', today's behaviour) or that
 *             prompt wrapped by a GrovBase instruction ('hybrid').
 *   retouch   A published prompt replaces the built-in one; a workflow may
 *             prepare analysis steps before the one billed image step.
 *   fashion_* The operator's prompt (the seller hint rides along as separated
 *             DATA, as the tool always did), or a workflow.
 *   the rest  No prompt engine: local pixel tools, specialised provider tools
 *             and the unreleased video tool.
 */
export const TOOL_ENGINE_MODES: Record<AiToolKey, readonly EngineMode[]> = {
  prompts: ["grovbase"],
  generator: ["user", "hybrid"],
  retouch: ["grovbase", "workflow"],
  editor: ["off"], resize: ["off"], compress: ["off"], tool_watermark: ["off"],
  tool_upscale: ["off"], tool_expand: ["off"], video: ["off"],
  fashion_ghost_mannequin: ["grovbase", "workflow"],
  fashion_flat_lay: ["grovbase", "workflow"],
  fashion_iron: ["grovbase", "workflow"],
  fashion_change_person: ["grovbase", "workflow"],
  fashion_change_face: ["grovbase", "workflow"],
};

/** Whether a tool has a prompt engine at all. */
export function toolHasPromptEngine(key: AiToolKey): boolean {
  return TOOL_ENGINE_MODES[key].some((m) => m !== "off");
}

/** Tools that can run a multi-step workflow. */
export function toolSupportsWorkflow(key: AiToolKey): boolean {
  return TOOL_ENGINE_MODES[key].includes("workflow");
}

/** Which family a tool belongs to on the registry screen. */
export type ToolCategory = "generation" | "editing" | "local" | "video";

const CATEGORY: Record<AiToolKey, ToolCategory> = {
  prompts: "generation", generator: "generation", retouch: "editing",
  editor: "local", resize: "local", compress: "local", tool_watermark: "local",
  tool_upscale: "editing", tool_expand: "editing", video: "video",
  fashion_ghost_mannequin: "generation", fashion_flat_lay: "generation",
  fashion_iron: "generation", fashion_change_person: "generation",
  fashion_change_face: "generation",
};

/** Which tools actually run through the ai_models path (`runGeneration`).
 *  The paid micro-tools reach a provider by capability instead, so offering
 *  them a model picker would be a control that decides nothing. */
/**
 * Tools whose RUNTIME reads the model assignment made in this panel
 * (ai_tool_models primary / fallback). For every other tool the model comes
 * from somewhere else (the customer's choice, the concept chain, a fixed
 * identifier, a capability chain) and the panel shows that path read-only
 * instead of a picker that would change nothing.
 */
export const MODEL_ASSIGNMENT_RUNTIME: ReadonlySet<string> = new Set(["retouch"]);

/** Where a tool's model/provider really comes from at run time — the one
 *  answer the registry line, the tool page and the API-path card share. */
export type ApiPathKind = "local" | "assigned" | "customer_choice" | "concept_chain" | "fixed" | "capability" | "none";

export function apiPathKind(toolKey: string, category?: string): ApiPathKind {
  if (category === "local" || ["editor", "resize", "compress", "tool_watermark"].includes(toolKey)) return "local";
  if (MODEL_ASSIGNMENT_RUNTIME.has(toolKey)) return "assigned";
  if (toolKey === "generator") return "customer_choice";
  if (toolKey === "prompts") return "concept_chain";
  if (toolKey.startsWith("fashion_")) return "fixed";
  if (toolKey === "tool_upscale" || toolKey === "tool_expand") return "capability";
  return "none";
}

const MODEL_DRIVEN: readonly AiToolKey[] = [
  "prompts", "generator", "retouch", "video",
  "fashion_ghost_mannequin", "fashion_flat_lay", "fashion_iron", "fashion_change_person",
  "fashion_change_face",
];

/** One tool's `ai_tools` row as the admin forms edit it. */
export type ToolConfigValues = {
  toolKey: string;
  engineMode: EngineMode;
  serviceSlug: string | null;
  allowModelChoice: boolean;
  fallbackEnabled: boolean;
  timeoutMs: number;
  maxAttempts: number;
  notes: string | null;
};

/** The form sections that write `ai_tools`: the workspace's "Podstawowe"
 *  (service + note), the panel's "Kredyty" (service only) and "Silnik". */
export type ToolConfigSection = "basics" | "billing" | "engine";

/**
 * WHAT ONE SECTION SAVES: its own fields, laid over the row as it was last
 * saved (`initial`, which the server refreshes after every save).
 *
 * `saveToolConfigAction` writes the whole row, and the Narzędzia i silniki
 * screen shows a tool's engine and billing sections side by side. If each
 * saved its whole local copy, saving one would quietly write back the other's
 * stale values — an engine change reverted by a price-list change.
 */
export function mergeToolConfig(
  section: ToolConfigSection,
  initial: ToolConfigValues,
  form: ToolConfigValues,
): ToolConfigValues {
  switch (section) {
    case "engine":
      return { ...initial, engineMode: form.engineMode, timeoutMs: form.timeoutMs, maxAttempts: form.maxAttempts };
    case "billing":
      return { ...initial, serviceSlug: form.serviceSlug };
    default:
      return { ...initial, serviceSlug: form.serviceSlug, notes: form.notes };
  }
}

/**
 * Tools whose IMAGES are charged by the model's own price list, not by their
 * service_catalog row: every one of them reaches `runGeneration`, which bills
 * `priceFor(model, resolution)` (lib/server/generation.ts), and Retusz and the
 * Moda tools pass the model's per-size price as `costOverride`
 * (lib/server/retouch.ts, lib/server/fashion.ts). GrovShot's images go the same
 * way through lib/server/concept-generation.ts. The admin panel must not show
 * a catalogue number as their price.
 */
export const MODEL_PRICED: readonly AiToolKey[] = [
  "prompts", "generator", "retouch",
  "fashion_ghost_mannequin", "fashion_flat_lay", "fashion_iron", "fashion_change_person",
  "fashion_change_face",
];

export const TOOL_TABS = ["basics", "engine", "models", "knowledge", "economics", "history"] as const;
export type ToolTab = (typeof TOOL_TABS)[number];

/**
 * The tabs this particular tool deserves. A compression tool has no engine to
 * configure and no model to choose; showing it seven tabs of empty panels
 * would be worse than showing it two.
 */
export function toolTabs(row: { key: AiToolKey; engineMode: EngineMode; serviceSlug: string | null }): ToolTab[] {
  const tabs: ToolTab[] = ["basics"];
  const modelDriven = MODEL_DRIVEN.includes(row.key);
  // The engine tab is always offered on a model-driven tool: it is how a tool
  // that has no engine yet is given one.
  if (modelDriven || row.engineMode !== "off") tabs.push("engine");
  if (modelDriven) tabs.push("models");
  if (row.engineMode !== "off") tabs.push("knowledge");
  if (row.serviceSlug) tabs.push("economics", "history");
  return tabs;
}

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
  /** Has a published workflow, and which version (optional: older callers
   *  build rows without it). */
  workflowVersion?: number | null;
  /** How retrieval balances proven examples against variety. */
  knowledgeStrategy?: "proven" | "diverse";
  serviceSlug: string | null;
  /** Credits the catalogue charges for one run. */
  credits: number | null;
  /** Whether the catalogue row is enabled / in maintenance. */
  serviceEnabled: boolean;
  serviceMaintenance: boolean;
  models: ToolModel[];
  allowModelChoice: boolean;
  fallbackEnabled: boolean;
  /**
   * The stored request policy and note. Every save of `ai_tools` writes the
   * whole row, so a form that edits one part must be handed the real values of
   * the rest — the defaults here are the table's own, for a tool never saved.
   */
  timeoutMs: number;
  maxAttempts: number;
  notes: string | null;
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

  const [toolsRes, modelsRes, promptsRes, knowledgeRes, servicesRes, usageRes, workflowsRes] = await Promise.all([
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
    supabase.from("ai_tool_workflows").select("tool_key, version").eq("status", "published"),
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
  const workflowVersion = new Map((workflowsRes.data ?? []).map((w) => [w.tool_key, w.version]));
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
      workflowVersion: workflowVersion.get(key) ?? null,
      knowledgeStrategy: row?.knowledge_strategy === "diverse" ? "diverse" : "proven",
      serviceSlug: row?.service_slug ?? null,
      credits: svc?.credits_cost ?? null,
      serviceEnabled: svc?.enabled ?? true,
      serviceMaintenance: svc?.maintenance_mode ?? false,
      models: modelsByTool.get(key) ?? [],
      allowModelChoice: row?.allow_model_choice ?? false,
      fallbackEnabled: row?.fallback_enabled ?? false,
      timeoutMs: row?.timeout_ms ?? 120000,
      maxAttempts: row?.max_attempts ?? 1,
      notes: row?.notes ?? null,
      knowledgeSets: knowledgeCount.get(key) ?? 0,
      lastRunAt: stats?.last ?? null,
      runs30d: stats?.runs ?? 0,
      failures30d: stats?.failures ?? 0,
      unconfigured: !row,
    };
  });
}

/** A model an operator can assign to a tool, as the model picker lists it. */
export type PickableModelRow = {
  id: string;
  name: string;
  providerName: string;
  active: boolean;
  credits: number;
};

/** Every model in the catalogue, in its own order — the model picker's list. */
export async function readPickableModels(supabase: Client): Promise<PickableModelRow[]> {
  const { data } = await supabase
    .from("ai_models")
    .select("id, name, display_name, active, credit_cost, ai_providers(name)")
    .order("sort_order", { ascending: true });
  return ((data ?? []) as unknown as {
    id: string; name: string; display_name: string | null; active: boolean;
    credit_cost: number; ai_providers: { name: string } | null;
  }[]).map((m) => ({
    id: m.id,
    name: m.display_name || m.name,
    providerName: m.ai_providers?.name ?? "—",
    active: m.active,
    credits: m.credit_cost,
  }));
}

/** The price list rows a tool may be billed through. Read, never written. */
export async function readBillingServices(supabase: Client): Promise<{ slug: string; name: string; credits: number }[]> {
  const { data } = await supabase
    .from("service_catalog").select("slug, name, credits_cost").order("category").order("name");
  return (data ?? []).map((s) => ({ slug: s.slug, name: s.name, credits: s.credits_cost }));
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

/** Workflow version history for one tool. Step prompts are never selected. */
export type WorkflowVersionRow = {
  id: string;
  version: number;
  status: string;
  summary: string | null;
  reason: string | null;
  stepCount: number;
  createdAt: string;
  publishedAt: string | null;
  authorName: string | null;
};

export async function readWorkflowHistory(supabase: Client, toolKey: string): Promise<WorkflowVersionRow[]> {
  const { data } = await supabase
    .from("ai_tool_workflows")
    .select("id, version, status, summary, reason, created_at, published_at, created_by, ai_tool_workflow_steps(id)")
    .eq("tool_key", toolKey)
    .order("version", { ascending: false })
    .limit(50);
  const rows = (data ?? []) as unknown as {
    id: string; version: number; status: string; summary: string | null; reason: string | null;
    created_at: string; published_at: string | null; created_by: string | null;
    ai_tool_workflow_steps: { id: string }[] | null;
  }[];
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
    stepCount: r.ai_tool_workflow_steps?.length ?? 0,
    createdAt: r.created_at,
    publishedAt: r.published_at,
    authorName: r.created_by ? nameById.get(r.created_by) ?? null : null,
  }));
}
