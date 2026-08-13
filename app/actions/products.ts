"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import * as products from "@/lib/services/products";
import * as images from "@/lib/services/images";
import type { Enums, TablesInsert } from "@/lib/database.types";
import { validateRows, type ImportRow } from "@/lib/services/csv";

/** Import limits: one action call stays well inside the request budget, and
 *  a batch of 200 rows is a comfortable insert size for Postgres. */
const MAX_IMPORT_ROWS = 500;
const IMPORT_BATCH = 200;

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

/**
 * BULK IMPORT — a mapped CSV becomes products in batches.
 *
 * The client sends already-mapped rows (never a file), the server re-validates
 * them and writes in chunks so a 5000-row catalogue is a few dozen inserts
 * rather than a few thousand round trips. Rows without a name are refused
 * here as well as in the browser; duplicate SKUs are imported, since a seller
 * re-uploading a corrected file is a normal thing to do.
 */
export async function importProductsAction(rows: ImportRow[]): Promise<{
  ok: true; imported: number; skipped: number; failed: number;
} | { ok: false; error: string }> {
  try {
    const { supabase, user, workspace } = await ctx();
    const usable = (rows ?? []).slice(0, MAX_IMPORT_ROWS);
    const errors = validateRows(usable);
    const badLines = new Set(errors.filter((e) => e.level === "error").map((e) => e.line));

    const payload: TablesInsert<"products">[] = [];
    usable.forEach((r, i) => {
      if (badLines.has(i + 2)) return;
      const name = r.name!.trim();
      // Brand, price and tags have no dedicated columns; they are kept as
      // structured metadata rather than silently dropped.
      const metadata: Record<string, string> = {};
      if (r.brand) metadata.brand = r.brand;
      if (r.price) metadata.price = r.price;
      if (r.tags) metadata.tags = r.tags;
      payload.push({
        workspace_id: workspace.id,
        owner_id: user.id,
        name: name.slice(0, 200),
        category: r.category?.slice(0, 120) ?? null,
        sku: r.sku?.slice(0, 80) ?? null,
        description: r.description?.slice(0, 4000) ?? null,
        extra_info: r.extra_info?.slice(0, 8000) ?? null,
        marketplace: r.marketplace?.slice(0, 40) ?? null,
        metadata: (Object.keys(metadata).length ? metadata : {}) as never,
        status: "draft",
      });
    });

    let imported = 0;
    let failed = 0;
    for (let i = 0; i < payload.length; i += IMPORT_BATCH) {
      const batch = payload.slice(i, i + IMPORT_BATCH);
      const { error } = await supabase.from("products").insert(batch);
      if (error) failed += batch.length;
      else imported += batch.length;
    }

    if (imported > 0) {
      await supabase.rpc("log_activity", {
        p_workspace_id: workspace.id, p_action: "products.imported",
        p_entity_type: "product",
        p_metadata: { imported, skipped: badLines.size, failed },
      });
      revalidatePath("/products");
    }
    return { ok: true, imported, skipped: badLines.size, failed };
  } catch {
    return { ok: false, error: "import_failed" };
  }
}
