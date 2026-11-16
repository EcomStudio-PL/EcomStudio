"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { logAudit } from "@/lib/services/audit";
import type { Json } from "@/lib/database.types";
import {
  cancelPlanChange, confirmPlanChange, planChangeStatus, quotePlanChange, setPlanChangesEnabled,
  type ConfirmOutcome, type PlanChangeRefusal, type QuoteOutcome,
} from "@/lib/server/plan-change";

/**
 * SMART SUBSCRIPTION MANAGEMENT — what the plan page may ask (0181).
 *
 * Thin wrappers like the checkout's: auth context → service → activity log.
 * There is no amount, price, coupon, subscription or workspace id in any
 * signature: a plan id and a period name a target, a change id names a row the
 * server wrote, and everything else is read from the session, the database and
 * Stripe. NOTHING HERE GRANTS CREDITS — the signed webhook does.
 */

async function context() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return null;
  return { supabase, workspace, userId: user.id };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DENIED = { ok: false as const, reason: "not_authorized" as PlanChangeRefusal };

async function activity(supabase: Awaited<ReturnType<typeof createClient>>, workspaceId: string, action: string, entityId: string, metadata: Record<string, unknown>) {
  try {
    await supabase.rpc("log_activity", {
      p_workspace_id: workspaceId, p_action: action, p_entity_type: "plan_change", p_entity_id: entityId,
      p_metadata: metadata as Json,
    });
  } catch {
    // The log never decides whether a change happens.
  }
}

export async function quotePlanChangeAction(planId: unknown, period: unknown): Promise<QuoteOutcome> {
  if (typeof planId !== "string" || !UUID.test(planId)) return { ok: false, reason: "unknown_plan" };
  const target = { planId, period: period === "annual" ? "annual" as const : "monthly" as const };
  const ctx = await context();
  if (!ctx) return DENIED;
  const res = await quotePlanChange(ctx.supabase, ctx.workspace, target);
  if (res.ok) {
    await activity(ctx.supabase, ctx.workspace.id, "plan_change.quoted", res.offer.changeId, {
      kind: res.offer.quote.kind, to: res.offer.quote.to.slug, period: res.offer.quote.to.period,
      due_cents: res.offer.quote.amountDueCents, deduction_cents: res.offer.quote.deductionCents,
    });
  }
  return res;
}

export async function confirmPlanChangeAction(changeId: unknown): Promise<ConfirmOutcome> {
  if (typeof changeId !== "string" || !UUID.test(changeId)) return { ok: false, reason: "not_found" };
  const ctx = await context();
  if (!ctx) return DENIED;
  const res = await confirmPlanChange(ctx.supabase, ctx.workspace, changeId);
  await activity(ctx.supabase, ctx.workspace.id, "plan_change.confirmed", changeId, res.ok ? { state: res.state } : { refused: res.reason });
  revalidatePath("/plan");
  revalidatePath("/plany");
  return res;
}

export async function cancelPlanChangeAction(changeId: unknown): Promise<{ ok: boolean; reason?: PlanChangeRefusal }> {
  if (typeof changeId !== "string" || !UUID.test(changeId)) return { ok: false, reason: "not_found" };
  const ctx = await context();
  if (!ctx) return DENIED;
  const res = await cancelPlanChange(ctx.supabase, ctx.workspace, changeId);
  await activity(ctx.supabase, ctx.workspace.id, "plan_change.canceled", changeId, res.ok ? {} : { refused: res.reason });
  revalidatePath("/plan");
  revalidatePath("/plany");
  return res;
}

/** The change's status — 'completed' only after the signed webhook. */
export async function planChangeStatusAction(changeId: unknown): Promise<{ status: string | null }> {
  if (typeof changeId !== "string" || !UUID.test(changeId)) return { status: null };
  const ctx = await context();
  if (!ctx) return { status: null };
  return { status: await planChangeStatus(ctx.supabase, ctx.workspace.id, changeId) };
}

/**
 * ADMIN: switch the module on or off. On also closes the Customer Portal's
 * own plan change (card, invoices and cancelling stay); off restores what the
 * portal had. Checked here AND in the database (plan_changes_set: is_admin).
 */
export async function setPlanChangesEnabledAction(enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return { ok: false, error: "not_admin" };
  const res = await setPlanChangesEnabled(supabase, enabled === true);
  await logAudit(supabase, { actorId: user.id, action: enabled ? "billing.plan_changes.enable" : "billing.plan_changes.disable",
    entityType: "app_settings", entityId: "plan_changes", after: { enabled: enabled === true, ok: res.ok } });
  revalidatePath("/admin/finance/zmiany-planow");
  revalidatePath("/plan");
  revalidatePath("/plany");
  return res.ok ? { ok: true } : { ok: false, error: res.reason };
}
