import type { Client } from "./workspace";
import type { Tables } from "@/lib/database.types";
import { buildFidelityInstructions } from "@/lib/ai/product-lock";

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

/** Role a numbered reference plays for a given shot type — used in the rationale. */
const REF_ROLES: Record<string, string[]> = {
  product_hero: ["front view — shape, colors and branding", "second angle — proportions"],
  premium_lifestyle: ["front view — product identity", "context angle — placement in scene"],
  product_in_use: ["front view — product identity", "usage angle — how it is held/operated"],
  closeup_detail: ["sharpest view of the signature detail"],
  scale: ["front view — product identity", "full-body view — true size and proportions"],
  benefit: ["front view — product identity", "detail view — the feature behind the benefit"],
  premium_ad: ["front view — shape, colors and branding", "second angle — materials and finish"],
};

/**
 * Deterministic prompt creation from curated system templates.
 * Explicitly NOT AI: this fills templates with product data and recommends
 * references heuristically. Reference images are addressed by their VISIBLE
 * NUMBER (1-based position in the product gallery, sort_order ascending) so
 * a prompt like "USE REFERENCE IMAGES: 1, 3" maps exactly to what the user
 * sees. Every prompt ends with the PRODUCT LOCK fidelity contract.
 */
export async function createPromptsFromTemplates(
  supabase: Client,
  product: Pick<Tables<"products">, "id" | "workspace_id" | "name" | "category" | "instructions">,
  images: Pick<Tables<"product_images">, "id" | "is_primary" | "sort_order">[]
) {
  const templates = await listSystemTemplates(supabase);
  if (templates.length === 0) return 0;

  // Canonical gallery order = sort_order ascending; number = index + 1.
  const gallery = [...images].sort((a, b) => a.sort_order - b.sort_order);
  const primaryIdx = Math.max(gallery.findIndex((i) => i.is_primary), 0);

  const rows = templates.map((tpl) => {
    const roles = REF_ROLES[tpl.shot_type] ?? REF_ROLES.product_hero;
    // Pick: primary image first, then the next distinct images in gallery order.
    const pickedIdx: number[] = gallery.length > 0 ? [primaryIdx] : [];
    for (let i = 0; i < gallery.length && pickedIdx.length < roles.length; i++) {
      if (!pickedIdx.includes(i)) pickedIdx.push(i);
    }
    const numbers = pickedIdx.map((i) => i + 1);
    const refIds = pickedIdx.map((i) => gallery[i].id);
    const rationale = numbers.map((n, k) => `${n} — ${roles[k]}`).join("; ");
    const header =
      numbers.length > 0
        ? `USE REFERENCE IMAGES: ${numbers.join(", ")}\nWHY THESE IMAGES: ${rationale}\n\n`
        : "";
    const body = fill(tpl.template, {
      product_name: product.name,
      category: product.category ?? "",
      instructions: product.instructions ?? "",
    });
    return {
      product_id: product.id,
      workspace_id: product.workspace_id,
      concept_name: tpl.name,
      shot_type: tpl.shot_type,
      prompt_text: `${header}${body}\n\n${buildFidelityInstructions(product.instructions)}`,
      reference_image_ids: refIds,
      reference_rationale: rationale || null,
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
