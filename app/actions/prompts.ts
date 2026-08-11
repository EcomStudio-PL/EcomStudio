"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProduct } from "@/lib/services/products";
import { createPromptsFromTemplates } from "@/lib/services/prompts";

export async function createPromptsAction(productId: string): Promise<{ ok: boolean; count?: number; error?: string }> {
  try {
    const supabase = await createClient();
    const product = await getProduct(supabase, productId);
    if (!product) return { ok: false, error: "not_found" };
    const count = await createPromptsFromTemplates(supabase, product, product.product_images);
    await supabase.rpc("log_activity", {
      p_workspace_id: product.workspace_id, p_action: "prompts.created_from_templates",
      p_entity_type: "product", p_entity_id: productId, p_metadata: { count },
    });
    revalidatePath("/prompts");
    return { ok: true, count };
  } catch {
    return { ok: false, error: "generic" };
  }
}
