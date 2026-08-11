import "server-only";
import type { Client } from "@/lib/services/workspace";
import { getAdapter } from "./registry";
import type { AiModelRecord } from "./types";

/**
 * Model router: resolves which (provider, model) can actually serve a request.
 * A model is usable only if it is active in the DB AND its provider adapter
 * is registered AND configured with server-side credentials.
 */
export async function getUsableModels(
  supabase: Client
): Promise<AiModelRecord[]> {
  const { data, error } = await supabase
    .from("ai_models")
    .select("*, ai_providers!inner(slug, active)")
    .eq("active", true)
    .eq("ai_providers.active", true);
  if (error || !data) return [];
  return data.filter((m) => {
    const provider = (m as unknown as { ai_providers: { slug: string } }).ai_providers;
    const adapter = getAdapter(provider.slug);
    return adapter?.isConfigured() ?? false;
  }) as AiModelRecord[];
}
