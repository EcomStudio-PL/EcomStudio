"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import * as products from "@/lib/services/products";
import * as images from "@/lib/services/images";
import type { Enums, TablesInsert } from "@/lib/database.types";

type Result = { ok: boolean; error?: string };

async function ctx() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) throw new Error("no_workspace");
  return { supabase, user, workspace };
}

export async function createProductAction(_prev: Result | null, formData: FormData): Promise<Result> {
  let id = "";
  try {
    const { supabase, user, workspace } = await ctx();
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { ok: false, error: "name_required" };
    const created = await products.createProduct(supabase, {
      workspace_id: workspace.id,
      owner_id: user.id,
      name,
      description: String(formData.get("description") ?? "").trim() || null,
      category: String(formData.get("category") ?? "").trim() || null,
      marketplace: String(formData.get("marketplace") ?? "") || null,
      instructions: String(formData.get("instructions") ?? "").trim() || null,
    });
    id = created.id;
    await supabase.rpc("log_activity", {
      p_workspace_id: workspace.id, p_action: "product.created",
      p_entity_type: "product", p_entity_id: id,
    });
  } catch {
    return { ok: false, error: "generic" };
  }
  revalidatePath("/products");
  redirect(`/products/${id}`);
}

export async function updateProductAction(_prev: Result | null, formData: FormData): Promise<Result> {
  try {
    const { supabase, workspace } = await ctx();
    const id = String(formData.get("id"));
    await products.updateProduct(supabase, id, {
      name: String(formData.get("name") ?? "").trim(),
      description: String(formData.get("description") ?? "").trim() || null,
      category: String(formData.get("category") ?? "").trim() || null,
      marketplace: String(formData.get("marketplace") ?? "") || null,
      instructions: String(formData.get("instructions") ?? "").trim() || null,
      status: String(formData.get("status") ?? "draft") as Enums<"product_status">,
    });
    await supabase.rpc("log_activity", {
      p_workspace_id: workspace.id, p_action: "product.updated",
      p_entity_type: "product", p_entity_id: id,
    });
    revalidatePath(`/products/${id}`);
    revalidatePath("/products");
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}

export async function deleteProductAction(id: string): Promise<Result> {
  try {
    const { supabase, workspace } = await ctx();
    await products.deleteProduct(supabase, id);
    await supabase.rpc("log_activity", {
      p_workspace_id: workspace.id, p_action: "product.deleted",
      p_entity_type: "product", p_entity_id: id,
    });
  } catch {
    return { ok: false, error: "generic" };
  }
  revalidatePath("/products");
  redirect("/products");
}

/** Register a product_images row after the browser uploaded the file to Storage. */
export async function registerUploadedImage(input: {
  productId: string; storagePath: string; sortOrder: number; isPrimary: boolean;
}): Promise<Result> {
  try {
    const { supabase } = await ctx();
    const row: TablesInsert<"product_images"> = {
      product_id: input.productId,
      storage_path: input.storagePath,
      sort_order: input.sortOrder,
      is_primary: input.isPrimary,
    };
    const { error } = await supabase.from("product_images").insert(row);
    if (error) return { ok: false, error: "generic" };
    revalidatePath(`/products/${input.productId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}

export async function setPrimaryImageAction(productId: string, imageId: string): Promise<Result> {
  try {
    const { supabase } = await ctx();
    await images.setPrimaryImage(supabase, productId, imageId);
    revalidatePath(`/products/${productId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}

export async function deleteImageAction(productId: string, imageId: string): Promise<Result> {
  try {
    const { supabase } = await ctx();
    await images.deleteImage(supabase, imageId);
    revalidatePath(`/products/${productId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}

export async function moveImageAction(productId: string, imageId: string, dir: -1 | 1): Promise<Result> {
  try {
    const { supabase } = await ctx();
    await images.moveImage(supabase, productId, imageId, dir);
    revalidatePath(`/products/${productId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}
