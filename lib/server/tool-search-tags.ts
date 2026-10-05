import "server-only";
import { cache } from "react";
import type { Client } from "@/lib/services/workspace";

/**
 * ADMIN SEARCH TAGS FOR THE GLOBAL TOOL SEARCH — server read.
 *
 * `ai_tools` is admin-only under RLS; every visitor reads ONLY the tags,
 * through the definer function `tool_search_tags()` (migration 0134).
 * Search metadata only: these strings never reach a prompt, a model or a
 * request, and they never change which tools a visitor may see — the palette
 * filters with menuVisible() before matching.
 *
 * Failure posture: any error is "no tags" — the search then behaves exactly
 * as it did before tags existed.
 */
export const readToolSearchTags = cache(async (supabase: Client): Promise<Record<string, string[]>> => {
  try {
    const { data, error } = await supabase.rpc("tool_search_tags");
    if (error || !Array.isArray(data)) return {};
    const out: Record<string, string[]> = {};
    for (const row of data) {
      if (typeof row?.tool_key === "string" && Array.isArray(row.search_tags)) {
        out[row.tool_key] = row.search_tags.filter((t): t is string => typeof t === "string");
      }
    }
    return out;
  } catch {
    return {};
  }
});
