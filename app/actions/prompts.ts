"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProduct } from "@/lib/services/products";
import { createPromptsFromTemplates } from "@/lib/services/prompts";
import { getCurrentWorkspace } from "@/lib/services/workspace";

type Result = { ok: boolean; error?: string };

async function workspaceCtx() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) throw new Error("no_workspace");
  return { supabase, workspace };
}

/** Create or update a workspace-owned custom template. RLS restricts writes to
 *  workspace members; system templates (workspace_id null) are admin-only. */
export async function saveMyTemplateAction(input: {
  id?: string; name: string; shot_type: string; template: string;
  format: string; style: string | null; priority: number; active: boolean;
}): Promise<Result> {
  try {
    const { supabase, workspace } = await workspaceCtx();
    if (!input.name.trim() || !input.template.trim()) return { ok: false, error: "invalid" };
    const row = {
      workspace_id: workspace.id,
      name: input.name.trim(),
      shot_type: input.shot_type.trim() || "custom",
      template: input.template,
      format: input.format,
      style: input.style,
      priority: input.priority,
      active: input.active,
    };
    const { error } = input.id
      ? await supabase.from("prompt_templates").update(row).eq("id", input.id).eq("workspace_id", workspace.id)
      : await supabase.from("prompt_templates").insert(row);
    if (error) return { ok: false, error: "generic" };
    revalidatePath("/prompts");
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}

export async function deleteMyTemplateAction(templateId: string): Promise<Result> {
  try {
    const { supabase, workspace } = await workspaceCtx();
    const { error } = await supabase
      .from("prompt_templates").delete()
      .eq("id", templateId).eq("workspace_id", workspace.id);
    if (error) return { ok: false, error: "generic" };
    revalidatePath("/prompts");
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}

/** Copy a system template into the user's workspace so they can edit the copy. */
export async function duplicateSystemTemplateAction(templateId: string): Promise<Result> {
  try {
    const { supabase, workspace } = await workspaceCtx();
    const { data: tpl } = await supabase
      .from("prompt_templates").select("*")
      .eq("id", templateId).is("workspace_id", null).maybeSingle();
    if (!tpl) return { ok: false, error: "not_found" };
    const { error } = await supabase.from("prompt_templates").insert({
      workspace_id: workspace.id,
      name: `${tpl.name} (my)`,
      shot_type: tpl.shot_type,
      template: tpl.template,
      format: tpl.format,
      style: tpl.style,
      priority: tpl.priority,
      active: true,
    });
    if (error) return { ok: false, error: "generic" };
    revalidatePath("/prompts");
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}

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
