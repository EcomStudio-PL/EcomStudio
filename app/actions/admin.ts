"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/lib/database.types";

type Result = { ok: boolean; error?: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("id, role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}

export async function setUserRoleAction(userId: string, role: Enums<"user_role">): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    // Owner safety: an admin can never demote themselves.
    if (userId === adminId && role !== "admin") return { ok: false, error: "self_demotion" };
    const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
    if (error) return { ok: false, error: "generic" };
    await supabase.rpc("log_activity", {
      p_workspace_id: null as unknown as string, p_action: "admin.role_changed",
      p_entity_type: "profile", p_entity_id: userId, p_metadata: { role },
    });
    revalidatePath("/admin/users");
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}

export async function adjustCreditsV2Action(input: {
  userId: string;
  amount: number;
  type: "bonus" | "refund" | "topup" | "admin_adjustment";
  reason: string;
  note?: string;
}): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    if (!Number.isInteger(input.amount) || input.amount === 0) return { ok: false, error: "invalid_amount" };
    if (!input.reason.trim()) return { ok: false, error: "reason_required" };
    const { data: membership } = await supabase
      .from("workspace_members").select("workspace_id")
      .eq("user_id", input.userId).order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (!membership) return { ok: false, error: "no_workspace" };
    const { data: wallet } = await supabase
      .from("credit_wallets").select("id")
      .eq("workspace_id", membership.workspace_id).maybeSingle();
    if (!wallet) return { ok: false, error: "no_wallet" };
    const { error } = await supabase.rpc("admin_adjust_credits_v2", {
      p_wallet_id: wallet.id,
      p_amount: input.amount,
      p_type: input.type,
      p_description: input.reason.trim(),
      p_metadata: input.note?.trim() ? { note: input.note.trim() } : {},
    });
    if (error) return { ok: false, error: error.message.includes("insufficient") ? "insufficient" : "generic" };
    await supabase.rpc("log_activity", {
      p_workspace_id: membership.workspace_id, p_action: "admin.credits_adjusted",
      p_entity_type: "credit_wallet", p_entity_id: wallet.id,
      p_metadata: { amount: input.amount, type: input.type }, p_on_behalf_of: input.userId,
    });
    revalidatePath("/admin/users");
    revalidatePath("/admin/credits");
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}

export async function updateModelFullAction(modelId: string, patch: {
  name?: string; credit_cost?: number; internal_cost_usd_micros?: number;
  quality_tier?: string; speed_tier?: string; max_reference_images?: number;
  supports_reference_images?: boolean; description?: string | null; active?: boolean;
}): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("ai_models").update(patch).eq("id", modelId);
    if (error) return { ok: false, error: "generic" };
    revalidatePath("/admin/models");
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}

export async function savePackageAction(input: {
  id?: string; name: string; credits: number; bonus_credits: number;
  price_cents: number; active: boolean; featured: boolean; sort_order: number;
  badge: string | null;
}): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    if (!input.name.trim() || input.credits <= 0 || input.price_cents < 0) return { ok: false, error: "invalid" };
    const row = { ...input, name: input.name.trim(), id: undefined };
    const { error } = input.id
      ? await supabase.from("credit_packages").update(row).eq("id", input.id)
      : await supabase.from("credit_packages").insert(row);
    if (error) return { ok: false, error: "generic" };
    revalidatePath("/admin/credits");
    revalidatePath("/credits");
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}

export async function adjustUserCreditsAction(userId: string, amount: number, description: string): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    if (!Number.isInteger(amount) || amount === 0) return { ok: false, error: "invalid_amount" };
    const { data: membership } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!membership) return { ok: false, error: "no_workspace" };
    const { data: wallet } = await supabase
      .from("credit_wallets")
      .select("id")
      .eq("workspace_id", membership.workspace_id)
      .maybeSingle();
    if (!wallet) return { ok: false, error: "no_wallet" };
    const { error } = await supabase.rpc("admin_adjust_credits", {
      p_wallet_id: wallet.id, p_amount: amount, p_description: description || undefined,
    });
    if (error) return { ok: false, error: "generic" };
    await supabase.rpc("log_activity", {
      p_workspace_id: membership.workspace_id, p_action: "admin.credits_adjusted",
      p_entity_type: "credit_wallet", p_entity_id: wallet.id,
      p_metadata: { amount }, p_on_behalf_of: userId,
    });
    revalidatePath("/admin/users");
    revalidatePath("/admin/credits");
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}

export async function toggleProviderAction(providerId: string, active: boolean): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("ai_providers").update({ active }).eq("id", providerId);
    if (error) return { ok: false, error: "generic" };
    revalidatePath("/admin/providers");
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}

export async function updateModelCostAction(modelId: string, creditCost: number): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    if (!Number.isInteger(creditCost) || creditCost < 0) return { ok: false, error: "invalid_amount" };
    const { error } = await supabase.from("ai_models").update({ credit_cost: creditCost }).eq("id", modelId);
    if (error) return { ok: false, error: "generic" };
    revalidatePath("/admin/models");
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}

export async function updatePlanAction(planId: string, patch: {
  name?: string; price_cents?: number; monthly_credits?: number; sort_order?: number; active?: boolean;
}): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("subscription_plans").update(patch).eq("id", planId);
    if (error) return { ok: false, error: "generic" };
    revalidatePath("/admin/plans");
    revalidatePath("/plan");
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}

export async function saveSystemTemplateAction(input: {
  id?: string; name: string; shot_type: string; template: string;
  format: string; style: string | null; priority: number; active: boolean;
}): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    if (!input.name.trim() || !input.template.trim()) return { ok: false, error: "invalid" };
    const row = {
      workspace_id: null,
      name: input.name.trim(),
      shot_type: input.shot_type.trim() || "custom",
      template: input.template,
      format: input.format,
      style: input.style,
      priority: input.priority,
      active: input.active,
    };
    const { error } = input.id
      ? await supabase.from("prompt_templates").update(row).eq("id", input.id)
      : await supabase.from("prompt_templates").insert(row);
    if (error) return { ok: false, error: "generic" };
    revalidatePath("/admin/templates");
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}

export async function toggleTemplateAction(templateId: string, active: boolean): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("prompt_templates").update({ active }).eq("id", templateId);
    if (error) return { ok: false, error: "generic" };
    revalidatePath("/admin/templates");
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}

export async function saveSettingAction(key: string, value: Record<string, unknown>): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("app_settings")
      .update({ value: value as never, updated_at: new Date().toISOString() })
      .eq("key", key);
    if (error) return { ok: false, error: "generic" };
    revalidatePath("/admin/system");
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}

export async function toggleModelAction(modelId: string, active: boolean): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("ai_models").update({ active }).eq("id", modelId);
    if (error) return { ok: false, error: "generic" };
    await supabase.rpc("log_activity", {
      p_workspace_id: null as unknown as string, p_action: active ? "admin.model_activated" : "admin.model_deactivated",
      p_entity_type: "ai_model", p_entity_id: modelId,
    });
    revalidatePath("/admin/models");
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}

export async function savePlanFullAction(input: {
  id?: string; name: string; price_cents: number; annual_price_cents: number;
  monthly_credits: number; bonus_credits: number; description: string | null;
  features: string[]; featured: boolean; active: boolean; sort_order: number;
  limits: { max_products?: number; max_generations_monthly?: number };
}): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    if (!input.name.trim() || input.price_cents < 0 || input.monthly_credits < 0) {
      return { ok: false, error: "invalid" };
    }
    const row = {
      name: input.name.trim(),
      price_cents: input.price_cents,
      annual_price_cents: input.annual_price_cents,
      monthly_credits: input.monthly_credits,
      bonus_credits: input.bonus_credits,
      description: input.description,
      features: input.features as never,
      featured: input.featured,
      active: input.active,
      sort_order: input.sort_order,
      limits: input.limits as never,
    };
    const { error } = input.id
      ? await supabase.from("subscription_plans").update(row).eq("id", input.id)
      : await supabase.from("subscription_plans").insert({
          ...row,
          slug: input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `plan-${Date.now()}`,
        });
    if (error) return { ok: false, error: "generic" };
    revalidatePath("/admin/plans");
    revalidatePath("/plan");
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}

export async function savePromptBlockAction(input: {
  id?: string; category: string; name: string; content: string;
  active: boolean; sort_order: number;
}): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    if (!input.name.trim() || !input.content.trim()) return { ok: false, error: "invalid" };
    const row = {
      category: input.category, name: input.name.trim(),
      content: input.content.trim(), active: input.active, sort_order: input.sort_order,
    };
    const { error } = input.id
      ? await supabase.from("prompt_blocks").update(row).eq("id", input.id)
      : await supabase.from("prompt_blocks").insert(row);
    if (error) return { ok: false, error: "generic" };
    revalidatePath("/admin/templates");
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}

export async function deletePromptBlockAction(id: string): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("prompt_blocks").delete().eq("id", id);
    if (error) return { ok: false, error: "generic" };
    revalidatePath("/admin/templates");
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}
