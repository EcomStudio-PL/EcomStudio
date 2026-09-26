"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import type { Json } from "@/lib/database.types";
import {
  activateLaunchCampaign, setGrovNewsCancelAtPeriodEnd, setGrovNewsPrice,
} from "@/lib/server/grovnews-billing";
import { parseLaunchCampaignInput, parsePriceZl } from "@/lib/grovnews-billing";
import { isUuid } from "@/lib/grovnews";

/**
 * GROVNEWS MONETISATION — admin writes and the customer's own cancel/resume.
 *
 * Admin actions re-check the ADMIN ROLE before anything else; the database
 * checks it again (is_admin() inside the functions) or requires the server's
 * dispatch token. Every admin change is written to the audit log — without a
 * secret, a Stripe key or a raw Stripe object in it.
 *
 * A customer action acts on the SESSION's own subscription only: there is no
 * id to pass, so there is no one else's subscription to reach.
 */

type Fail<E extends string = never> = { ok: false; error: "forbidden" | "invalid" | "generic" | E };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("forbidden");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("forbidden");
  return { supabase, adminId: user.id };
}

const forbidden = (e: unknown) => e instanceof Error && e.message === "forbidden";

function revalidateGrovNews() {
  revalidatePath("/admin/newsletter/grovnews", "layout");
  revalidatePath("/grovnews", "layout");
  revalidatePath("/settings");
}

async function audit(
  supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"], adminId: string,
  action: string, entityId: string | undefined, after: Record<string, Json | undefined>,
  before?: Record<string, Json | undefined>,
) {
  await supabase.rpc("log_activity", {
    p_workspace_id: null as unknown as string, p_action: `admin.${action}`,
    p_entity_type: "grovnews_billing", p_entity_id: entityId, p_metadata: after,
  });
  await logAudit(supabase, { actorId: adminId, action, entityType: "grovnews_billing", entityId, before, after });
}

/* ── price & sales ─────────────────────────────────────────────────────────── */

/** Set the monthly price (in złote, as typed). A new Stripe Price; existing
 *  subscribers stay on theirs. */
export async function setGrovNewsPriceAction(priceZl: string):
  Promise<{ ok: true; changed: boolean } | Fail<"payments_disabled" | "no_server_key" | "stripe_error" | "conflict" | "reconcile_required">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const cents = parsePriceZl(priceZl);
    if (cents === null) return { ok: false, error: "invalid" };
    const { data: before } = await supabase.from("grovnews_billing").select("price_cents, stripe_price_id").maybeSingle();
    const res = await setGrovNewsPrice(supabase, cents, adminId);
    if (!res.ok) return { ok: false, error: res.reason === "invalid_amount" ? "invalid" : res.reason };
    if (res.changed) {
      await audit(supabase, adminId, "grovnews.price_changed", undefined,
        { price_cents: cents, stripe_price_id: res.priceId, archived_price_id: res.archived },
        { price_cents: before?.price_cents ?? null, stripe_price_id: before?.stripe_price_id ?? null });
    }
    revalidateGrovNews();
    return { ok: true, changed: res.changed };
  } catch (e) {
    return { ok: false, error: forbidden(e) ? "forbidden" : "generic" };
  }
}

/** Sales on/off. OFF blocks new checkouts only — no subscription is touched. */
export async function setGrovNewsSalesAction(enabled: boolean): Promise<{ ok: true } | Fail<"no_price">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { data, error } = await supabase.rpc("grovnews_billing_set_sales", { p_enabled: enabled === true });
    if (error) return { ok: false, error: "generic" };
    const r = data as { status?: string; before?: boolean } | null;
    if (r?.status === "no_price") return { ok: false, error: "no_price" };
    if (r?.status !== "applied") return { ok: false, error: "generic" };
    await audit(supabase, adminId, enabled ? "grovnews.sales_enabled" : "grovnews.sales_disabled", undefined,
      { sales_enabled: enabled === true }, { sales_enabled: r.before ?? null });
    revalidateGrovNews();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: forbidden(e) ? "forbidden" : "generic" };
  }
}

/* ── launch campaign ───────────────────────────────────────────────────────── */

/** Create or edit a DRAFT. Live, ended and disabled campaigns are not edited. */
export async function saveLaunchCampaignAction(id: string | null, raw: unknown):
  Promise<{ ok: true; id: string } | Fail<"not_draft" | "invalid_plan">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const parsed = parseLaunchCampaignInput(raw);
    if (!parsed.ok || (id !== null && !isUuid(id))) return { ok: false, error: "invalid" };
    const { data, error } = await supabase.rpc("grovnews_launch_save", {
      p_id: id, p_config: parsed.value as unknown as Json,
    });
    if (error) return { ok: false, error: "generic" };
    const r = data as { status?: string; id?: string } | null;
    if (r?.status === "not_draft") return { ok: false, error: "not_draft" };
    if (r?.status === "invalid_plan") return { ok: false, error: "invalid_plan" };
    if (r?.status !== "saved" || !r.id) return { ok: false, error: "invalid" };
    await audit(supabase, adminId, id ? "grovnews.launch_updated" : "grovnews.launch_created", r.id,
      parsed.value as unknown as Record<string, Json>);
    revalidateGrovNews();
    return { ok: true, id: r.id };
  } catch (e) {
    return { ok: false, error: forbidden(e) ? "forbidden" : "generic" };
  }
}

/** Switch a DRAFT on. With a discount the Stripe Coupon is created first. */
export async function activateLaunchCampaignAction(id: string): Promise<{ ok: true } | Fail<string>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id)) return { ok: false, error: "invalid" };
    const res = await activateLaunchCampaign(supabase, id, adminId);
    if (!res.ok) return { ok: false, error: res.reason };
    await audit(supabase, adminId, "grovnews.launch_activated", id, { status: "ACTIVE" }, { status: "DRAFT" });
    revalidateGrovNews();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: forbidden(e) ? "forbidden" : "generic" };
  }
}

/** End (no new claims) or disable (no new claims, unused codes stop). */
export async function setLaunchCampaignStatusAction(id: string, status: "ENDED" | "DISABLED"):
  Promise<{ ok: true } | Fail<"invalid_transition">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id) || (status !== "ENDED" && status !== "DISABLED")) return { ok: false, error: "invalid" };
    const { data, error } = await supabase.rpc("grovnews_launch_set_status", { p_id: id, p_status: status });
    if (error) return { ok: false, error: "generic" };
    const r = data as { status?: string; before?: string } | null;
    if (r?.status === "invalid_transition") return { ok: false, error: "invalid_transition" };
    if (r?.status !== "applied") return { ok: false, error: "invalid" };
    await audit(supabase, adminId, status === "ENDED" ? "grovnews.launch_ended" : "grovnews.launch_disabled", id,
      { status }, { status: r.before ?? null });
    revalidateGrovNews();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: forbidden(e) ? "forbidden" : "generic" };
  }
}

/* ── the customer's own subscription ───────────────────────────────────────── */

/** Cancel at the end of the paid period (true) or undo that (false). */
export async function setGrovNewsRenewalAction(cancel: boolean):
  Promise<{ ok: true; cancelAtPeriodEnd: boolean } | { ok: false; error: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "forbidden" };
    const res = await setGrovNewsCancelAtPeriodEnd(supabase, user.id, cancel === true);
    if (!res.ok) return { ok: false, error: res.reason };
    const workspace = await getCurrentWorkspace(supabase, user.id);
    if (workspace) {
      await supabase.rpc("log_activity", {
        p_workspace_id: workspace.id,
        p_action: res.cancelAtPeriodEnd ? "grovnews.cancel_at_period_end" : "grovnews.renewal_resumed",
        p_entity_type: "grovnews_subscription", p_metadata: {},
      });
    }
    revalidatePath("/settings");
    return { ok: true, cancelAtPeriodEnd: res.cancelAtPeriodEnd };
  } catch {
    return { ok: false, error: "generic" };
  }
}
