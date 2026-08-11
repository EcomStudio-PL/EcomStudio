import type { Client } from "./workspace";
import type { AspectRatio } from "@/lib/ai/types";

export const MATERIAL_TYPES = [
  "product_hero","packshot","premium_lifestyle","product_in_use","closeup",
  "macro_detail","scale","technical","benefit","social_ad","marketplace_gallery",
] as const;
export type MaterialType = (typeof MATERIAL_TYPES)[number];
export const ASPECT_RATIOS: AspectRatio[] = ["1:1", "4:5", "16:9", "9:16"];

export async function listJobs(supabase: Client, workspaceId: string, limit = 50) {
  const { data } = await supabase
    .from("generation_jobs")
    .select("*, products(name), ai_models(name)")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function listAssets(supabase: Client, workspaceId: string, limit = 60) {
  const { data } = await supabase
    .from("generations")
    .select("*, generation_assets(*), products(name)")
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
