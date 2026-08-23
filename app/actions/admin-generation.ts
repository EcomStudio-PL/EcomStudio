"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Persist the generation router's provider priority. Entries are
 * "provider:model_identifier" strings validated against real, existing
 * models — the router never receives a chain it cannot resolve. The primary
 * entry also pins concept_model_id, so the price preview and the router
 * agree on which model is first.
 */
export async function saveGenerationPriorityAction(priority: string[]): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return { ok: false, error: "not_admin" };

  const { data: models } = await supabase
    .from("ai_models").select("id, model_identifier, ai_providers(slug)").eq("active", true);
  const valid = new Map(
    (models ?? []).map((m) => [`${(m.ai_providers as { slug?: string } | null)?.slug}:${m.model_identifier}`, m.id])
  );
  const clean = priority.map(String).filter((p) => valid.has(p)).slice(0, 5);
  if (clean.length === 0) return { ok: false, error: "invalid" };

  const { data: row } = await supabase.from("app_settings").select("value").eq("key", "generation").maybeSingle();
  const value = {
    ...((row?.value ?? {}) as Record<string, unknown>),
    provider_priority: clean,
    concept_model_id: valid.get(clean[0]),
  };
  const { error } = await supabase.from("app_settings")
    .update({ value: value as never }).eq("key", "generation");
  if (error) return { ok: false, error: "generic" };

  await supabase.rpc("log_activity", {
    p_workspace_id: null as unknown as string,
    p_action: "admin.generation_priority_saved",
    p_entity_type: "app_settings",
    p_metadata: { priority: clean } as never,
  });
  revalidatePath("/admin/models");
  return { ok: true };
}

/** Planner provider configuration: primary + OPTIONAL fallback ("" = off).
 *  Fully separate from image-model routing. */
export async function savePlannerConfigAction(primary: string, fallback: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return { ok: false, error: "not_admin" };
  try {
    const allowed = new Set(["openai", "google"]);
    if (!allowed.has(primary)) return { ok: false, error: "invalid" };
    if (fallback !== "" && (!allowed.has(fallback) || fallback === primary)) return { ok: false, error: "invalid" };
    const { data: row } = await supabase.from("app_settings").select("value").eq("key", "generation").maybeSingle();
    const value = { ...((row?.value as Record<string, unknown>) ?? {}), planner_provider: primary, planner_fallback: fallback };
    const { error } = await supabase.from("app_settings").update({ value }).eq("key", "generation");
    if (error) return { ok: false, error: "generic" };
    revalidatePath("/admin/models");
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}
