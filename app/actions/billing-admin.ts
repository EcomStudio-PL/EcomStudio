"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { syncPrice, type PriceEntity, type PricePeriod } from "@/lib/server/stripe-pricing";
import { migrateSubscriptionsToCurrentPrice, countSubscriptionsOnOldPrice } from "@/lib/server/stripe-migrate";

type Result = { ok: boolean; error?: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase
    .from("profiles").select("id, role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}

/**
 * RETRY A SYNC THAT DID NOT LAND.
 *
 * A price change can fail in the middle — Stripe refused, or the local write
 * did not take. The row then says so (`failed`, or `syncing` left behind) and
 * `sellable()` refuses to sell it. This is the button that tries again.
 *
 * It re-reads the CURRENT displayed price and syncs THAT, rather than
 * remembering what was attempted. If an admin has since typed a different
 * number, the retry should obviously send the number now on screen.
 */
export async function resyncPriceAction(
  entity: PriceEntity, entityId: string, period: PricePeriod = "monthly",
): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (entity !== "plan" && entity !== "package") return { ok: false, error: "invalid" };

    let amountCents: number;
    let productName: string;

    if (entity === "package") {
      const { data } = await supabase
        .from("credit_packages").select("name, price_cents").eq("id", entityId).maybeSingle();
      if (!data) return { ok: false, error: "unknown" };
      amountCents = data.price_cents;
      productName = data.name;
    } else {
      const { data } = await supabase
        .from("subscription_plans").select("name, price_cents, annual_price_cents")
        .eq("id", entityId).maybeSingle();
      if (!data) return { ok: false, error: "unknown" };
      amountCents = period === "annual" ? data.annual_price_cents : data.price_cents;
      productName = data.name;
    }

    const sync = await syncPrice(supabase, {
      entity, entityId, period, amountCents, currency: "PLN", productName,
    });

    await logAudit(supabase, {
      actorId: adminId,
      action: "admin.price_resynced",
      entityType: entity, entityId,
      after: { period, ok: sync.ok, amount_cents: amountCents },
    });

    revalidatePath("/admin/plans");
    revalidatePath("/admin/credits");
    revalidatePath("/plan");
    return sync.ok ? { ok: true } : { ok: false, error: `stripe_${sync.reason}` };
  } catch {
    return { ok: false, error: "generic" };
  }
}

/**
 * HOW MANY CUSTOMERS WOULD A PRICE MIGRATION TOUCH.
 *
 * Read-only, and it exists so the confirmation dialog can state a real number
 * instead of "some subscriptions". An admin about to change what existing
 * customers are billed should be told exactly how many people that is before
 * they are asked to confirm it.
 */
export async function countAffectedSubscriptionsAction(
  planId: string, period: PricePeriod = "monthly",
): Promise<{ count: number; oldCents: number | null; newCents: number | null }> {
  try {
    const { supabase } = await requireAdmin();
    return await countSubscriptionsOnOldPrice(supabase, planId, period);
  } catch {
    return { count: 0, oldCents: null, newCents: null };
  }
}

/**
 * MOVE EXISTING SUBSCRIBERS ONTO THE CURRENT PRICE — ONLY WHEN ASKED.
 *
 * THIS IS NOT PART OF SAVING A PRICE, and that is the whole point. Changing a
 * catalogue price changes what NEW customers pay. Someone who subscribed at
 * 299 zł agreed to 299 zł; silently moving them to 399 zł at the next renewal
 * is a different act, with different consequences, and it needs somebody to
 * decide it deliberately.
 *
 * So this is a separate action, behind a separate button, unchecked by
 * default, with the affected count and both amounts shown, and a second
 * confirmation. `proration` is the caller's explicit choice because there is no
 * safe default: `create_prorations` bills the difference immediately, `none`
 * waits for the next period. Guessing either one spends the customer's money
 * on an assumption.
 */
export async function migrateSubscriptionPriceAction(input: {
  planId: string;
  period?: PricePeriod;
  proration: "create_prorations" | "none";
  /** Must equal the count the admin was shown, or nothing runs. */
  confirmedCount: number;
}): Promise<{ ok: boolean; migrated?: number; failed?: number; error?: string }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (input.proration !== "create_prorations" && input.proration !== "none") {
      return { ok: false, error: "invalid" };
    }
    const period: PricePeriod = input.period === "annual" ? "annual" : "monthly";

    // THE COUNT IS RE-READ AND MUST MATCH. If someone subscribed between the
    // dialog opening and the confirm, the admin has not seen the real number
    // and has therefore not agreed to it. Refuse and make them look again.
    const now = await countSubscriptionsOnOldPrice(supabase, input.planId, period);
    if (now.count !== input.confirmedCount) {
      return { ok: false, error: "count_changed" };
    }
    if (now.count === 0) return { ok: true, migrated: 0, failed: 0 };

    const res = await migrateSubscriptionsToCurrentPrice(
      supabase, input.planId, period, input.proration,
    );

    await logAudit(supabase, {
      actorId: adminId,
      action: "admin.subscription_price_migrated",
      entityType: "subscription_plan", entityId: input.planId,
      before: { cents: now.oldCents },
      after: {
        period, proration: input.proration,
        migrated: res.migrated, failed: res.failed, cents: now.newCents,
      },
    });

    revalidatePath("/admin/plans");
    return { ok: res.failed === 0, migrated: res.migrated, failed: res.failed };
  } catch {
    return { ok: false, error: "generic" };
  }
}
