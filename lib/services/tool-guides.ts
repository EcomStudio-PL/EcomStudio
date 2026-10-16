import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { guideSurface, photoSlugOf, type GuideToolKey } from "@/lib/tool-guides";

type Client = SupabaseClient<Database>;

/**
 * TOOL GUIDES — the reads and writes that need a caller's client.
 *
 * Transport-agnostic like every service here: the route, the server actions
 * and a future mobile API call the same functions with the caller's client,
 * so RLS — not this file — decides who may do what.
 */

/** The `operation` a tool's generations carry (lib/server/gallery.ts filters
 *  by it). The generators list the whole workspace: no filter. */
function operationOf(tool: GuideToolKey): string | null {
  if (tool === "retouch") return "image_retouch";
  if (tool === "prompts" || tool === "generator") return null;
  return tool; // ecommerce_thumbnail, fashion_* — operation === tool key
}

/**
 * Does this workspace already have a result in the gallery this tool's screen
 * shows? Exactly the gallery's own dataset: a finished generation with the
 * tool's operation (or any, on the generators), or a stored photo-tool
 * result. `null` when the read fails — the caller then leaves the gallery as
 * it is rather than calling a failure "empty". The batch tools keep their
 * queue in the browser, so there is nothing to ask the database.
 */
export async function hasToolResults(supabase: Client, workspaceId: string, tool: GuideToolKey): Promise<boolean | null> {
  const surface = guideSurface(tool);
  if (surface === "batch") return false;
  if (surface === "photo") {
    const { data, error } = await supabase.from("tool_results").select("id")
      .eq("workspace_id", workspaceId).eq("tool_slug", photoSlugOf(tool)!).limit(1);
    return error ? null : (data ?? []).length > 0;
  }
  let q = supabase.from("generations").select("id, generation_jobs!inner(status, settings)")
    .eq("workspace_id", workspaceId)
    .eq("generation_jobs.status", "completed");
  const op = operationOf(tool);
  if (op) q = q.eq("generation_jobs.settings->>operation", op);
  const { data, error } = await q.limit(1);
  return error ? null : (data ?? []).length > 0;
}

/** The highest tutorial version this user has seen (0 = none). Their own
 *  preferences row, by RLS (prefs_all_own). */
export async function readSeenVersion(supabase: Client, userId: string, tool: GuideToolKey): Promise<number> {
  const { data } = await supabase.from("user_preferences").select("metadata").eq("user_id", userId).maybeSingle();
  const seen = (data?.metadata as { tool_tutorials?: Record<string, unknown> } | null)?.tool_tutorials?.[tool];
  return typeof seen === "number" && Number.isFinite(seen) ? seen : 0;
}

/** Mark a version seen — one atomic merge in the database (0142), so two
 *  tools marked from two tabs never lose each other. */
export async function markSeen(supabase: Client, tool: GuideToolKey, version: number): Promise<boolean> {
  const { error } = await supabase.rpc("mark_tool_tutorial_seen", { p_tool_key: tool, p_version: version });
  return !error;
}

/* ── ADMIN ─────────────────────────────────────────────────────────────── */

export type GuideRow = Database["public"]["Tables"]["tool_guides"]["Row"];

/** The stored row (admin RLS). `null` = never saved: the shipped default. */
export async function readGuideRow(supabase: Client, tool: GuideToolKey): Promise<GuideRow | null | "unavailable"> {
  const { data, error } = await supabase.from("tool_guides").select("*").eq("tool_key", tool).maybeSingle();
  if (error) return "unavailable";
  return data;
}

/** The pictures currently assigned to a guide's slots: key → asset id and the
 *  row's updated_at (the base a compare-and-set write needs). `null` when the
 *  read fails — "no slots" would turn a removal into a silent no-op. */
export async function readGuideSlots(supabase: Client, keys: string[]): Promise<Map<string, { mediaId: string | null; updatedAt: string }> | null> {
  const { data, error } = await supabase.from("media_slots").select("slot_key, media_id, updated_at").in("slot_key", keys);
  if (error) return null;
  return new Map((data ?? []).map((r) => [r.slot_key, { mediaId: r.media_id, updatedAt: r.updated_at }]));
}
