import "server-only";
import type { Client } from "@/lib/services/workspace";
import { dispatchToken } from "@/lib/server/server-token";
import { resolveEngine } from "@/lib/server/ai-engine";
import { promptDigest } from "@/lib/server/prompt-digest";
import { readProviderKey } from "@/lib/server/provider-credentials";
import { featureBlockedForApi } from "@/lib/server/feature-availability";
import { engineToolConfigured } from "@/lib/server/engine/tool-run";
import { RETOUCH_DEFAULT_RESOLUTION, retouchModel, retouchPrice, retouchSizes } from "@/lib/server/retouch";
import { sha256 } from "@/lib/ai/providers/openai-thumbnail-request";
import {
  THUMBNAIL_REFERENCE_PROMPT_SHA256, THUMBNAIL_SERVICE, THUMBNAIL_TOOL_KEY,
  parseThumbnailConfig, type ThumbnailConfig,
} from "@/lib/thumbnail/config";

/**
 * WHAT MINIATURKA NEEDS BEFORE IT MAY TAKE A CREDIT — read fresh, every time.
 *
 *   the settings row      app_settings.thumbnail (private, token-gated read)
 *   the prompt            published in Admin → Silnik, and approved: its text
 *                         hashes to the release reference, or an operator
 *                         approved exactly this version
 *   the price             service_catalog.tool_thumbnail, enabled, > 0
 *   the provider          OpenAI active, with a key
 *   Retusz (optional)     Retusz's own model, price at 2K and published prompt,
 *                         Workflow OFF (the frozen single-call path)
 *
 * Nothing here is cached across requests: a price or a prompt the operator
 * changes is the one the next run sees. Nothing here is sent to a browser
 * except the codes and the numbers the panel shows.
 */

export type ThumbnailBlocker =
  | "server_unconfigured" | "config_unreadable" | "prompt_unconfigured" | "prompt_unreadable"
  | "prompt_not_approved" | "price_unconfigured" | "service_disabled" | "maintenance"
  | "provider_inactive" | "no_key";

export type PublishedPrompt = {
  /** The decrypted text — SERVER MEMORY ONLY. */
  text: string;
  version: number | null;
  /** Plain SHA-256 (admin view and the run's admin-only record). */
  sha256: string;
  /** Keyed digest (safe to store where a customer could read it). */
  digest: string;
  /** Matches the release reference, or the operator's approval. */
  approved: boolean;
  approvedBy: "reference" | "operator" | null;
};

export type RetouchOffer =
  | { available: true; unit: number; resolution: string }
  | { available: false; reason: "model_unavailable" | "workflow_on" | "prompt_unconfigured" | "feature_unavailable" | "size_unavailable" };

export type ThumbnailState = {
  ready: boolean;
  blockers: ThumbnailBlocker[];
  config: ThumbnailConfig | null;
  /** Credits for the composition, when priced. */
  thumbnailCredits: number | null;
  retouch: RetouchOffer;
  prompt: PublishedPrompt | null;
};

export async function readThumbnailConfig(supabase: Client): Promise<ThumbnailConfig | null> {
  const token = dispatchToken();
  if (!token) return null;
  try {
    const { data, error } = await supabase.rpc("thumbnail_config_read", { p_token: token });
    if (error || !data || typeof data !== "object") return null;
    return parseThumbnailConfig(data);
  } catch {
    return null;
  }
}

/** The published prompt, opened in server memory, and whether it may run. */
export async function readPublishedPrompt(supabase: Client, config: ThumbnailConfig | null):
  Promise<{ prompt: PublishedPrompt | null; blocker: ThumbnailBlocker | null }> {
  const engine = await resolveEngine(supabase, THUMBNAIL_TOOL_KEY);
  if (!engine) return { prompt: null, blocker: "prompt_unconfigured" };
  const usable = engine.mode === "grovbase" || engine.mode === "hybrid";
  // Never trimmed: the text that was published is the text that is sent.
  const text = usable ? engine.systemPrompt : null;
  if (!text || !text.trim()) {
    return { prompt: null, blocker: engine.promptVersion !== null ? "prompt_unreadable" : "prompt_unconfigured" };
  }
  const digest = promptDigest(text);
  if (!digest) return { prompt: null, blocker: "server_unconfigured" };
  const plain = sha256(text);
  const byReference = plain === THUMBNAIL_REFERENCE_PROMPT_SHA256;
  const byOperator = Boolean(config?.approvedPrompt && config.approvedPrompt.digest === digest);
  const prompt: PublishedPrompt = {
    text, version: engine.promptVersion, sha256: plain, digest,
    approved: byReference || byOperator,
    approvedBy: byReference ? "reference" : byOperator ? "operator" : null,
  };
  return { prompt, blocker: prompt.approved ? null : "prompt_not_approved" };
}

/** The catalogue row that prices the composition. */
export async function readThumbnailService(supabase: Client):
  Promise<{ credits: number; enabled: boolean; maintenance: boolean; apiCostUsdMicros: number } | null> {
  const { data } = await supabase.from("service_catalog")
    .select("credits_cost, enabled, maintenance_mode, api_cost_usd_micros")
    .eq("slug", THUMBNAIL_SERVICE).maybeSingle();
  if (!data) return null;
  return {
    credits: data.credits_cost, enabled: data.enabled, maintenance: data.maintenance_mode,
    apiCostUsdMicros: Number(data.api_cost_usd_micros ?? 0),
  };
}

/** OpenAI's provider row and whether a key is stored — metadata only. */
async function openaiProvider(supabase: Client): Promise<{ id: string; active: boolean; keyed: boolean; baseUrl: string | null } | null> {
  const { data: provider } = await supabase.from("ai_providers").select("id, active").eq("slug", "openai").maybeSingle();
  if (!provider) return null;
  const token = dispatchToken();
  if (!token) return { id: provider.id, active: provider.active, keyed: false, baseUrl: null };
  const { data: rows } = await supabase.rpc("provider_credential_read", { p_token: token, p_provider_id: provider.id });
  const cred = rows?.[0];
  return { id: provider.id, active: provider.active, keyed: Boolean(cred), baseUrl: cred?.base_url ?? null };
}

/** The decrypted key for the one call — server memory only, never stored. */
export async function openaiCredential(supabase: Client): Promise<{ apiKey: string; baseUrl: string | null } | null> {
  const { data: provider } = await supabase.from("ai_providers").select("id, active").eq("slug", "openai").maybeSingle();
  if (!provider?.active) return null;
  const { data: rows } = await supabase.rpc("provider_credential_read", { p_token: dispatchToken(), p_provider_id: provider.id });
  const cred = rows?.[0];
  if (!cred) return null;
  const apiKey = await readProviderKey(supabase, provider.id, cred);
  return apiKey ? { apiKey, baseUrl: cred.base_url ?? null } : null;
}

/**
 * Retusz as Miniaturka may use it: exactly the standalone tool's single-call
 * path (2K, "original"), its own model and price. Workflow ON is refused —
 * that path returns a run of a different shape and price.
 */
export async function readRetouchOffer(supabase: Client): Promise<RetouchOffer> {
  const [model, configured, blocked] = await Promise.all([
    retouchModel(supabase),
    engineToolConfigured(supabase, "retouch", false),
    featureBlockedForApi(supabase, "retouch"),
  ]);
  if (blocked) return { available: false, reason: "feature_unavailable" };
  if (!model) return { available: false, reason: "model_unavailable" };
  if (model.workflowEnabled) return { available: false, reason: "workflow_on" };
  if (!configured) return { available: false, reason: "prompt_unconfigured" };
  if (!retouchSizes(model).includes(RETOUCH_DEFAULT_RESOLUTION)) return { available: false, reason: "size_unavailable" };
  return { available: true, unit: retouchPrice(model, RETOUCH_DEFAULT_RESOLUTION), resolution: RETOUCH_DEFAULT_RESOLUTION };
}

/** `retouch: false` skips the Retusz offer (the home page needs only "can it
 *  run" and the price of the composition). */
export async function readThumbnailState(supabase: Client, opts: { retouch?: boolean } = {}): Promise<ThumbnailState> {
  const blockers: ThumbnailBlocker[] = [];
  if (!dispatchToken()) blockers.push("server_unconfigured");
  const config = await readThumbnailConfig(supabase);
  if (!config) blockers.push("config_unreadable");
  const [promptRes, service, provider, retouch] = await Promise.all([
    readPublishedPrompt(supabase, config),
    readThumbnailService(supabase),
    openaiProvider(supabase),
    opts.retouch === false
      ? Promise.resolve<RetouchOffer>({ available: false, reason: "model_unavailable" })
      : readRetouchOffer(supabase),
  ]);
  if (promptRes.blocker) blockers.push(promptRes.blocker);
  if (!service || service.credits <= 0) blockers.push("price_unconfigured");
  else if (!service.enabled) blockers.push("service_disabled");
  else if (service.maintenance) blockers.push("maintenance");
  if (!provider?.active) blockers.push("provider_inactive");
  else if (!provider.keyed) blockers.push("no_key");
  return {
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)],
    config,
    thumbnailCredits: service && service.credits > 0 ? service.credits : null,
    retouch,
    prompt: promptRes.prompt,
  };
}
