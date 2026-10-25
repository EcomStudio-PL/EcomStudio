"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { loadPricingPage } from "@/lib/server/pricing-page";
import { PUBLIC_TOOLS_KEY, getPublicToolsFlag, type PublicToolsFlag } from "@/lib/server/public-tools";
import type { PricingPageData } from "@/components/plan/pricing-types";

/**
 * PUBLIC TOOLS V1 — the actions behind the switch and the panels' billing
 * dialogs. Thin, as the house rule asks: who is asking, the read or write,
 * the audit log, what it made stale.
 */

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("forbidden");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("forbidden");
  return { supabase, adminId: user.id };
}

/** The switch as it is now (admin panel). */
export async function publicToolsStateAction(): Promise<Result<PublicToolsFlag>> {
  try {
    const { supabase } = await requireAdmin();
    return { ok: true, data: await getPublicToolsFlag(supabase) };
  } catch {
    return { ok: false, error: "forbidden" };
  }
}

/**
 * Open or close the tools to visitors. Nothing else moves: registration,
 * login and the waiting list are the access panel's own switches and are not
 * touched here — opening the tools does not open signup.
 */
export async function setPublicToolsAction(enabled: boolean): Promise<Result<PublicToolsFlag>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (typeof enabled !== "boolean") return { ok: false, error: "invalid" };
    const before = await getPublicToolsFlag(supabase);
    const { error } = await supabase.from("app_settings").upsert(
      { key: PUBLIC_TOOLS_KEY, value: { enabled }, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: "save_failed" };
    await logAudit(supabase, {
      actorId: adminId, action: "public_tools.set", entityType: "app_settings", entityId: PUBLIC_TOOLS_KEY,
      before: { enabled: before.enabled }, after: { enabled },
    });
    // Every surface that answers to it: the tool pages, the catalogue, the
    // sitemap, the access panel.
    revalidatePath("/", "layout");
    const { data } = await supabase.from("app_settings").select("value, updated_at").eq("key", PUBLIC_TOOLS_KEY).maybeSingle();
    return { ok: true, data: { enabled: (data?.value as { enabled?: unknown } | null)?.enabled === true, updatedAt: data?.updated_at ?? null } };
  } catch {
    return { ok: false, error: "forbidden" };
  }
}

/**
 * The plans and packs a panel's "Wybierz plan" / "Doładuj kredyty" dialog
 * shows — THE SAME read as /plany and /plan (lib/server/pricing-page.ts), so
 * every figure is a database row or a price the checkout itself computed.
 * Fetched when a dialog opens, never with the page.
 */
export async function toolPricingAction(): Promise<Result<PricingPageData>> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "unauthenticated" };
    return { ok: true, data: await loadPricingPage(supabase) };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
