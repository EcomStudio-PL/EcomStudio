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
