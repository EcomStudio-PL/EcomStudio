import type { Client } from "./workspace";
import type { Tables } from "@/lib/database.types";

export async function listSystemTemplates(supabase: Client) {
  const { data } = await supabase
    .from("prompt_templates")
    .select("*")
    .is("workspace_id", null)
    .eq("active", true)
    .order("priority", { ascending: true });
  return data ?? [];
}

export async function listProductPrompts(supabase: Client, productId: string) {
  const { data } = await supabase
    .from("generated_prompts")
    .select("*")
    .eq("product_id", productId)
    .order("priority", { ascending: true });
  return data ?? [];
}

function fill(template: string, vars: Record<string, string>) {
  let s = template;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{{${k}}}`, v);
  return s.replace(/\s{2,}/g, " ").trim();
}

/**
 * Deterministic prompt creation from curated system templates.
 * Explicitly NOT AI: this fills templates with product data and recommends
 * references heuristically (primary photo first). The future AI module will
 * replace the heuristic with real product/photo analysis — same data shape.
 */
export async function createPromptsFromTemplates(
  supabase: Client,
  product: Pick<Tables<"products">, "id" | "workspace_id" | "name" | "category" | "instructions">,
  images: Pick<Tables<"product_images">, "id" | "is_primary" | "sort_order">[]
) {
  const templates = await listSystemTemplates(supabase);
  if (templates.length === 0) return 0;

  const ordered = [...images].sort((a, b) =>
    a.is_primary === b.is_primary ? a.sort_order - b.sort_order : a.is_primary ? -1 : 1
  );
  const primaryId = ordered[0]?.id;
  const secondaryId = ordered[1]?.id;

  const rows = templates.map((tpl) => {
    const refIds = [primaryId, tpl.shot_type === "closeup_detail" ? undefined : secondaryId]
      .filter((v): v is string => !!v);
    return {
      product_id: product.id,
      workspace_id: product.workspace_id,
      concept_name: tpl.name,
      shot_type: tpl.shot_type,
      prompt_text: fill(tpl.template, {
        product_name: product.name,
        category: product.category ?? "",
        instructions: product.instructions ?? "",
      }),
      reference_image_ids: refIds,
      reference_rationale:
        "Template default: primary reference first. AI-based photo analysis will refine this selection.",
      format: tpl.format,
      style: tpl.style,
      priority: tpl.priority,
      status: "ready" as const,
    };
  });

  const { error } = await supabase.from("generated_prompts").insert(rows);
  if (error) throw error;
  return rows.length;
}
