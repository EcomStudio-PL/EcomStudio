import "server-only";
import type { Client } from "@/lib/services/workspace";
import { photoToolPath, providerStatuses } from "@/lib/server/image-tools";
import { resolveConceptModels } from "@/lib/server/concept-generation";
import { getUsableModels } from "@/lib/ai/router";
import { RETOUCH_MODEL_IDENTIFIER } from "@/lib/server/retouch";
import { FASHION_MODEL_IDENTIFIER } from "@/lib/server/fashion";
import { EXPAND_PROVIDERS, UPSCALE_PROVIDERS } from "@/lib/images/providers";
import { PHOTO_TOOL_KEYS, apiPathKind } from "@/lib/services/ai-tools";
import type { PhotoToolSlug } from "@/lib/images/tools";
import { findUnitPrice, type UnitPrice } from "@/lib/ai/usage-cost";
import { readUnitPrices } from "@/lib/server/ai-usage";

/**
 * WHICH API A TOOL REALLY CALLS — read from the same sources the runtime reads,
 * so the admin panel shows the path a customer's run takes, not a setting that
 * nothing consumes.
 *
 *   assigned         the tool runs on the model assigned in this panel
 *                    (primary + optional fallback), with its long-standing
 *                    model as the default when nothing is assigned  — Retusz
 *   fixed            one model by API identifier, shared by a module — Moda
 *   concept_chain    GrovShot: the generation settings' concept model, then
 *                    the provider priority, then any usable model
 *   customer_choice  the generator: the customer picks among visible models
 *   capability       upscale / expand: the first vendor with a key, in a
 *                    fixed order; the four photo tools: ONE pinned vendor
 *                    (Photoroom), with the endpoint and key environment
 *   local            no API at all (sharp, on our server)
 *   none             not live yet (video)
 */

export type PathModel = {
  id: string;
  providerSlug: string;
  providerName: string;
  model: string;
  /** The API identifier (what the provider is called with). */
  identifier: string;
  /** Model and provider both active. Whether the key works is the provider
   *  card's verdict, shown there. */
  ready: boolean;
  /** What ONE image costs GrovBase at the provider: the per-unit price list
   *  first, the model's flat per-image cost next; null = UNKNOWN (never 0). */
  costPerImageUsdMicros: number | null;
  costSource: "unit_price" | "model_flat" | "unknown";
};

export type ToolApiPath =
  | { kind: "assigned"; primary: PathModel | null; fallback: PathModel | null; defaulted: boolean }
  | { kind: "fixed"; primary: PathModel | null }
  | { kind: "concept_chain"; primary: PathModel | null; fallback: PathModel | null }
  | { kind: "customer_choice"; models: number; list: PathModel[] }
  | { kind: "capability"; chain: {
      slug: string; label: string; configured: boolean;
      /** Photo tools: the exact endpoint called and the key's environment. */
      endpoint?: string; environment?: "live" | "sandbox" | null;
    }[] }
  | { kind: "local" }
  | { kind: "none" };

type ModelRow = {
  id: string; model_identifier: string; name: string; display_name: string | null; active: boolean;
  internal_cost_usd_micros: number | null;
  ai_providers: { slug: string; name: string; active: boolean } | null;
};

const MODEL_COLUMNS = "id, model_identifier, name, display_name, active, internal_cost_usd_micros, ai_providers(slug, name, active)";

const toPath = (m: ModelRow | null | undefined, prices: readonly UnitPrice[] = []): PathModel | null => {
  if (!m) return null;
  const providerSlug = m.ai_providers?.slug ?? "?";
  // Quoted at the default output size (1K): per-size official rows (0133)
  // match it first, a catch-all row still matches after them.
  const listed = findUnitPrice(prices, providerSlug, m.model_identifier, "image", "1K", "*");
  const flat = m.internal_cost_usd_micros && m.internal_cost_usd_micros > 0 ? m.internal_cost_usd_micros : null;
  return {
    id: m.id,
    providerSlug,
    providerName: m.ai_providers?.name ?? "?",
    model: m.display_name || m.name || m.model_identifier,
    identifier: m.model_identifier,
    ready: m.active && Boolean(m.ai_providers?.active),
    costPerImageUsdMicros: listed ? listed.usdMicrosPerUnit : flat,
    costSource: listed ? "unit_price" : flat ? "model_flat" : "unknown",
  };
};

async function modelsById(supabase: Client, ids: string[]): Promise<Map<string, ModelRow>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from("ai_models")
    .select(MODEL_COLUMNS).in("id", ids);
  return new Map(((data ?? []) as unknown as ModelRow[]).map((m) => [m.id, m]));
}

async function modelByIdentifier(supabase: Client, identifier: string): Promise<ModelRow | null> {
  const { data } = await supabase.from("ai_models")
    .select(MODEL_COLUMNS)
    .eq("model_identifier", identifier).eq("active", true).limit(1).maybeSingle();
  return (data as unknown as ModelRow | null) ?? null;
}

export async function readToolApiPath(supabase: Client, toolKey: string): Promise<ToolApiPath> {
  const kind = apiPathKind(toolKey);
  // Read once per request; every slot below is priced from the same list.
  const prices = await readUnitPrices(supabase);
  const tp = (m: ModelRow | null | undefined) => toPath(m, prices);
  if (kind === "local") return { kind: "local" };
  if (kind === "none") return { kind: "none" };

  if (kind === "capability" && PHOTO_TOOL_KEYS.includes(toolKey)) {
    const p = await photoToolPath(supabase, toolKey.replace(/^tool_/, "") as PhotoToolSlug);
    return { kind: "capability", chain: [{
      slug: p.providerSlug, label: p.label, configured: p.environment !== null,
      endpoint: p.endpoint, environment: p.environment,
    }] };
  }

  if (kind === "capability") {
    const order = (toolKey === "tool_upscale" ? UPSCALE_PROVIDERS : EXPAND_PROVIDERS).map((p) => p.slug);
    const statuses = await providerStatuses(supabase);
    const chain = order
      .map((slug) => statuses.find((s) => s.slug === slug))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .map((s) => ({ slug: s.slug, label: s.label, configured: s.status === "connected" }));
    return { kind: "capability", chain };
  }

  if (kind === "customer_choice") {
    const usable = (await getUsableModels(supabase)).filter((m) => m.visible_custom !== false);
    // THE LIST THE CUSTOMER PICKS FROM — the same filter the generator uses.
    const rows = await modelsById(supabase, usable.map((m) => m.id));
    const list = usable.map((m) => tp(rows.get(m.id))).filter((x): x is PathModel => x !== null);
    return { kind: "customer_choice", models: list.length, list };
  }

  if (kind === "concept_chain") {
    const chain = await resolveConceptModels(supabase);
    const rows = await modelsById(supabase, chain.slice(0, 2).map((m) => m.id));
    return { kind: "concept_chain", primary: tp(rows.get(chain[0]?.id ?? "")), fallback: tp(rows.get(chain[1]?.id ?? "")) };
  }

  if (kind === "fixed") {
    return { kind: "fixed", primary: tp(await modelByIdentifier(supabase, FASHION_MODEL_IDENTIFIER)) };
  }

  if (kind === "assigned") {
    const [{ data: assigned }, { data: tool }] = await Promise.all([
      supabase.from("ai_tool_models").select("model_id, role").eq("tool_key", toolKey).in("role", ["primary", "fallback"]),
      supabase.from("ai_tools").select("fallback_enabled").eq("tool_key", toolKey).maybeSingle(),
    ]);
    const primaryId = assigned?.find((a) => a.role === "primary")?.model_id ?? null;
    const fallbackId = tool?.fallback_enabled ? assigned?.find((a) => a.role === "fallback")?.model_id ?? null : null;
    const rows = await modelsById(supabase, [primaryId, fallbackId].filter((x): x is string => Boolean(x)));
    const primary = primaryId ? tp(rows.get(primaryId)) : tp(await modelByIdentifier(supabase, RETOUCH_MODEL_IDENTIFIER));
    return { kind: "assigned", primary, fallback: fallbackId ? tp(rows.get(fallbackId)) : null, defaulted: !primaryId };
  }

  return { kind: "none" };
}

/**
 * WHAT ACTUALLY DRIVES A TOOL: its prompt mode, whether the Workflow switch is
 * ON, and — when it is — the published version and each step's executor. The
 * "Modele, API i koszty" tab renders this above the model slots so the admin
 * sees the real execution path, not a model setting that a workflow overrides.
 */
export type ExecutionSummary = {
  engineMode: string;
  workflowEnabled: boolean;
  workflow: null | {
    id: string; version: number; maxOutputs: number; concurrency: number;
    steps: { n: number; name: string; operation: string; enabled: boolean; forEach: string | null; maxItems: number | null;
      model: string | null; fallback: string | null; textProvider: string | null; textModel: string | null; toolSlug: string | null }[];
  };
};

export async function readExecutionSummary(supabase: Client, toolKey: string): Promise<ExecutionSummary> {
  const { data: tool } = await supabase.from("ai_tools").select("engine_mode, workflow_enabled").eq("tool_key", toolKey).maybeSingle();
  const base = { engineMode: tool?.engine_mode ?? "off", workflowEnabled: tool?.workflow_enabled === true };
  const { data: wf } = await supabase.from("ai_tool_workflows")
    .select("id, version, max_outputs, concurrency, ai_tool_workflow_steps(position, name, operation, enabled, for_each, max_items, model_id, fallback_model_id, text_provider, text_model, tool_slug)")
    .eq("tool_key", toolKey).eq("status", "published").maybeSingle();
  if (!wf) return { ...base, workflow: null };
  const steps = ((wf as unknown as { ai_tool_workflow_steps: {
    position: number; name: string; operation: string; enabled: boolean; for_each: string | null; max_items: number | null;
    model_id: string | null; fallback_model_id: string | null; text_provider: string | null; text_model: string | null; tool_slug: string | null;
  }[] }).ai_tool_workflow_steps ?? []).sort((a, b) => a.position - b.position);
  const ids = steps.flatMap((s) => [s.model_id, s.fallback_model_id]).filter((x): x is string => Boolean(x));
  const rows = await modelsById(supabase, [...new Set(ids)]);
  const label = (id: string | null) => {
    if (!id) return null;
    const m = rows.get(id);
    return m ? `${m.ai_providers?.name ?? "?"} · ${m.display_name || m.name}` : id.slice(0, 8);
  };
  return {
    ...base,
    workflow: {
      id: wf.id, version: wf.version, maxOutputs: wf.max_outputs ?? 1, concurrency: wf.concurrency,
      steps: steps.map((s) => ({
        n: s.position, name: s.name, operation: s.operation, enabled: s.enabled, forEach: s.for_each, maxItems: s.max_items,
        model: label(s.model_id), fallback: label(s.fallback_model_id),
        textProvider: s.text_provider, textModel: s.text_model, toolSlug: s.tool_slug,
      })),
    },
  };
}
