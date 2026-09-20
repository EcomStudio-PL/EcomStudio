import type { Client } from "./workspace";
import type { AspectRatio } from "@/lib/ai/types";

export const MATERIAL_TYPES = [
  "product_hero","packshot","premium_lifestyle","product_in_use","closeup",
  "macro_detail","scale","technical","benefit","social_ad","marketplace_gallery",
] as const;
export type MaterialType = (typeof MATERIAL_TYPES)[number];
export const ASPECT_RATIOS: AspectRatio[] = ["1:1", "4:5", "16:9", "9:16"];

export async function listJobs(supabase: Client, workspaceId: string, limit = 50) {
  // Named columns only: the full row carries multi-KB prompt_text /
  // negative_prompt / settings blobs that the history list never renders —
  // fifty of them per page view was pure transfer waste.
  const { data } = await supabase
    .from("generation_jobs")
    .select("id, status, material_type, aspect_ratio, quantity, credits_charged, error_message, created_at, products(name), ai_models(name)")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function listAssets(supabase: Client, workspaceId: string, limit = 60) {
  /*
    `metadata` IS READ, AND LEAVING IT OUT COST 77x THE BYTES.

    The comment that used to sit here said per-asset metadata is never read by
    any gallery. That was true when it was written and false by the time
    derivatives existed: `metadata.thumb` is where the 22KB grid thumbnail's
    path lives. Without this column the caller cannot know a thumbnail exists,
    so /home and /k/[cat] signed the ORIGINAL and painted a 2MB render into a
    210px tile — measured on production: six home tiles were 12MB instead of
    159KB, twelve category tiles 22MB instead of 273KB.

    quality_check_data stays out; that one really is unread here.
  */
  const { data } = await supabase
    .from("generations")
    .select("id, favorite, created_at, generation_assets(id, storage_path, metadata)")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

/** Active models visible to users (regardless of server credentials — the router gates execution). */
export async function listActiveModels(supabase: Client) {
  const { data } = await supabase
    .from("ai_models")
    .select("*, ai_providers!inner(slug, name, active)")
    .eq("active", true)
    .eq("ai_providers.active", true)
    .order("credit_cost", { ascending: true });
  return data ?? [];
}
