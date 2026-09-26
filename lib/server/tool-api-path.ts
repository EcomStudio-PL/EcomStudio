import "server-only";
import type { Client } from "@/lib/services/workspace";
import { providerStatuses } from "@/lib/server/image-tools";
import { resolveConceptModels } from "@/lib/server/concept-generation";
import { getUsableModels } from "@/lib/ai/router";
import { RETOUCH_MODEL_IDENTIFIER } from "@/lib/server/retouch";
import { FASHION_MODEL_IDENTIFIER } from "@/lib/server/fashion";
import { EXPAND_PROVIDERS, UPSCALE_PROVIDERS } from "@/lib/images/providers";
import { apiPathKind } from "@/lib/services/ai-tools";

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
 *                    fixed order
 *   local            no API at all (sharp, on our server)
 *   none             not live yet (video)
 */

export type PathModel = {
  id: string;
  providerSlug: string;
  providerName: string;
  model: string;
  /** Model and provider both active. Whether the key works is the provider
   *  card's verdict, shown there. */
  ready: boolean;
};

export type ToolApiPath =
  | { kind: "assigned"; primary: PathModel | null; fallback: PathModel | null; defaulted: boolean }
  | { kind: "fixed"; primary: PathModel | null }
  | { kind: "concept_chain"; primary: PathModel | null; fallback: PathModel | null }
  | { kind: "customer_choice"; models: number }
  | { kind: "capability"; chain: { slug: string; label: string; configured: boolean }[] }
  | { kind: "local" }
  | { kind: "none" };

type ModelRow = {
  id: string; model_identifier: string; name: string; display_name: string | null; active: boolean;
  ai_providers: { slug: string; name: string; active: boolean } | null;
};

const toPath = (m: ModelRow | null | undefined): PathModel | null => m ? {
  id: m.id,
  providerSlug: m.ai_providers?.slug ?? "?",
  providerName: m.ai_providers?.name ?? "?",
  model: m.display_name || m.name || m.model_identifier,
  ready: m.active && Boolean(m.ai_providers?.active),
} : null;

async function modelsById(supabase: Client, ids: string[]): Promise<Map<string, ModelRow>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from("ai_models")
    .select("id, model_identifier, name, display_name, active, ai_providers(slug, name, active)").in("id", ids);
  return new Map(((data ?? []) as unknown as ModelRow[]).map((m) => [m.id, m]));
}

async function modelByIdentifier(supabase: Client, identifier: string): Promise<ModelRow | null> {
  const { data } = await supabase.from("ai_models")
    .select("id, model_identifier, name, display_name, active, ai_providers(slug, name, active)")
    .eq("model_identifier", identifier).eq("active", true).limit(1).maybeSingle();
  return (data as unknown as ModelRow | null) ?? null;
}

export async function readToolApiPath(supabase: Client, toolKey: string): Promise<ToolApiPath> {
  const kind = apiPathKind(toolKey);
  if (kind === "local") return { kind: "local" };
  if (kind === "none") return { kind: "none" };

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
    const usable = await getUsableModels(supabase);
    return { kind: "customer_choice", models: usable.filter((m) => m.visible_custom !== false).length };
  }

  if (kind === "concept_chain") {
    const chain = await resolveConceptModels(supabase);
    const rows = await modelsById(supabase, chain.slice(0, 2).map((m) => m.id));
    return { kind: "concept_chain", primary: toPath(rows.get(chain[0]?.id ?? "")), fallback: toPath(rows.get(chain[1]?.id ?? "")) };
  }

  if (kind === "fixed") {
    return { kind: "fixed", primary: toPath(await modelByIdentifier(supabase, FASHION_MODEL_IDENTIFIER)) };
  }

  if (kind === "assigned") {
    const [{ data: assigned }, { data: tool }] = await Promise.all([
      supabase.from("ai_tool_models").select("model_id, role").eq("tool_key", toolKey).in("role", ["primary", "fallback"]),
      supabase.from("ai_tools").select("fallback_enabled").eq("tool_key", toolKey).maybeSingle(),
    ]);
    const primaryId = assigned?.find((a) => a.role === "primary")?.model_id ?? null;
    const fallbackId = tool?.fallback_enabled ? assigned?.find((a) => a.role === "fallback")?.model_id ?? null : null;
    const rows = await modelsById(supabase, [primaryId, fallbackId].filter((x): x is string => Boolean(x)));
    const primary = primaryId ? toPath(rows.get(primaryId)) : toPath(await modelByIdentifier(supabase, RETOUCH_MODEL_IDENTIFIER));
    return { kind: "assigned", primary, fallback: fallbackId ? toPath(rows.get(fallbackId)) : null, defaulted: !primaryId };
  }

  return { kind: "none" };
}
