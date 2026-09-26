"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; error: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}

const PROVIDER_RE = /^[a-z0-9_-]{2,40}$/;
/** USD per 1M tokens → micros, 0 … 1000 USD. */
const toMicros = (usd: number): number | null =>
  Number.isFinite(usd) && usd >= 0 && usd <= 1000 ? Math.round(usd * 1_000_000) : null;

/**
 * Set the list price of one token-billed model (USD per 1M input / output
 * tokens), used ONLY to estimate what a call cost. Admin session, admin RLS;
 * logged. Nothing about a customer's charge depends on it.
 */
export async function saveTokenPriceAction(input: {
  providerSlug: string; model: string; inputUsdPerM: number; outputUsdPerM: number;
}): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const model = input.model.trim();
    if (!PROVIDER_RE.test(input.providerSlug) || model.length < 1 || model.length > 120) return { ok: false, error: "invalid" };
    const inMicros = toMicros(input.inputUsdPerM);
    const outMicros = toMicros(input.outputUsdPerM);
    if (inMicros === null || outMicros === null) return { ok: false, error: "invalid" };
    const { error } = await supabase.from("ai_token_prices").upsert({
      provider_slug: input.providerSlug, model,
      input_usd_micros_per_mtok: inMicros, output_usd_micros_per_mtok: outMicros,
      updated_at: new Date().toISOString(), updated_by: adminId,
    }, { onConflict: "provider_slug,model" });
    if (error) return { ok: false, error: "generic" };
    await supabase.rpc("log_activity", {
      p_workspace_id: null as unknown as string, p_action: "admin.token_price_saved",
      p_entity_type: "ai_token_price",
      p_metadata: { provider: input.providerSlug, model },
    });
    revalidatePath("/admin/ai/modele");
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}

export async function deleteTokenPriceAction(input: { providerSlug: string; model: string }): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("ai_token_prices").delete()
      .eq("provider_slug", input.providerSlug).eq("model", input.model);
    if (error) return { ok: false, error: "generic" };
    await supabase.rpc("log_activity", {
      p_workspace_id: null as unknown as string, p_action: "admin.token_price_deleted",
      p_entity_type: "ai_token_price",
      p_metadata: { provider: input.providerSlug, model: input.model },
    });
    revalidatePath("/admin/ai/modele");
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}
