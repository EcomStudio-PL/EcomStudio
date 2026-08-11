import type { TablesInsert, TablesUpdate } from "@/lib/database.types";
import type { Client } from "./workspace";

export const MARKETPLACES = ["allegro", "amazon", "woocommerce", "social", "meta_ads", "other"] as const;
export const PRODUCT_STATUSES = ["draft", "ready", "processing", "completed", "archived"] as const;

export async function listProducts(supabase: Client, workspaceId: string, limit = 100) {
  const { data, error } = await supabase
    .from("products")
    .select("*, product_images(id, storage_path, is_primary, sort_order)")
    .eq("workspace_id", workspaceId)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getProduct(supabase: Client, id: string) {
  const { data, error } = await supabase
    .from("products")
    .select("*, product_images(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (data) data.product_images.sort((a, b) => a.sort_order - b.sort_order);
  return data;
}

export async function createProduct(supabase: Client, input: TablesInsert<"products">) {
  const { data, error } = await supabase.from("products").insert(input).select("id").single();
  if (error) throw error;
  return data;
}

export async function updateProduct(supabase: Client, id: string, patch: TablesUpdate<"products">) {
  const { error } = await supabase.from("products").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteProduct(supabase: Client, id: string) {
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) throw error;
}
