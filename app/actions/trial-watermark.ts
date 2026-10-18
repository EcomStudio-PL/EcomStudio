"use server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { loadPricingPage } from "@/lib/server/pricing-page";
import {
  isTrialUuid, openTrialPaywall, paywallPlansFrom, selectTrialPlan, type TrialPlanSelected,
} from "@/lib/server/trial-watermark/unlock";
import { TRIAL_UNLOCK_SURFACES, type TrialPaywallResult, type TrialUnlockSurface } from "@/lib/trial-watermark/types";

/**
 * THE TWO THINGS THE UNLOCK DIALOG ASKS BEFORE ANY MONEY MOVES.
 *
 * Thin wrappers, like every other action here: session → workspace → the
 * service in lib/server/trial-watermark/unlock.ts → its result. Neither
 * grants anything: the paywall reads state, entitlement and the catalogue;
 * choosing a plan returns the same checkout link /plany sends. The two
 * analytics events each writes go through the token-gated, deduplicated
 * writer — a client cannot write those names any other way (R8).
 */

async function context() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return null;
  return { supabase, workspace };
}

const isSurface = (v: unknown): v is TrialUnlockSurface =>
  typeof v === "string" && (TRIAL_UNLOCK_SURFACES as readonly string[]).includes(v);

/**
 * "Usuń znak wodny" was pressed (R16). The asset's state first — no paywall
 * and no events for one that is not locked; an entitled workspace is told to
 * unlock; anyone else gets a new paywall id and the real plans.
 */
export async function trialPaywallAction(input: { assetId: string; surface: TrialUnlockSurface }): Promise<TrialPaywallResult> {
  try {
    if (!isTrialUuid(input?.assetId) || !isSurface(input?.surface)) return { kind: "error" };
    const ctx = await context();
    if (!ctx) return { kind: "error" };
    const { supabase, workspace } = ctx;
    return await openTrialPaywall(supabase, {
      workspaceId: workspace.id,
      assetId: input.assetId.toLowerCase(),
      surface: input.surface,
      paywallId: randomUUID(),
      // The /plany loader, read only once the paywall is really shown.
      plans: async () => paywallPlansFrom(await loadPricingPage(supabase)),
    });
  } catch {
    return { kind: "error" };
  }
}

/** "Wybierz plan" on the paywall → the checkout link for that plan. */
export async function trialPlanSelectedAction(input: {
  paywallId: string; assetId: string; planId: string;
}): Promise<TrialPlanSelected> {
  try {
    if (!isTrialUuid(input?.paywallId) || !isTrialUuid(input?.assetId) || !isTrialUuid(input?.planId)) {
      return { ok: false, error: "invalid" };
    }
    const ctx = await context();
    if (!ctx) return { ok: false, error: "failed" };
    return await selectTrialPlan(ctx.supabase, {
      workspaceId: ctx.workspace.id,
      paywallId: input.paywallId.toLowerCase(),
      assetId: input.assetId.toLowerCase(),
      planId: input.planId,
    });
  } catch {
    return { ok: false, error: "failed" };
  }
}
