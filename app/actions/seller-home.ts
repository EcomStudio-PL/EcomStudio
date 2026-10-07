"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { registerFeatureInterest, saveSellerChannel } from "@/lib/services/seller-home";
import { isInterestKey, isSellerChannel } from "@/lib/seller-home-config";

/**
 * /home's two writes. Thin, like every action here: who is calling (from the
 * session — the browser never says who it is), the service call, the activity
 * log, and a revalidation. Nothing here spends, grants or charges anything.
 */

/** "Gdzie sprzedajesz?" — an answer, or `null` when the seller closed it. */
export async function saveSellerChannelAction(channel: string | null): Promise<{ ok: boolean }> {
  if (channel !== null && !isSellerChannel(channel)) return { ok: false };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const result = await saveSellerChannel(supabase, user.id, channel);
  if (result.ok) {
    const workspace = await getCurrentWorkspace(supabase, user.id);
    if (workspace) {
      await supabase.rpc("log_activity", {
        p_workspace_id: workspace.id,
        p_action: channel ? "home.seller_channel_set" : "home.seller_channel_dismissed",
        p_entity_type: "profile",
        p_entity_id: user.id,
        p_metadata: { channel },
      });
    }
    revalidatePath("/home");
  }
  return result;
}

/** "Powiadom mnie" on a coming-soon feature. Idempotent: a repeat is `ok`. */
export async function registerInterestAction(feature: string): Promise<{ ok: boolean }> {
  if (!isInterestKey(feature)) return { ok: false };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const workspace = await getCurrentWorkspace(supabase, user.id);
  const result = await registerFeatureInterest(supabase, user.id, workspace?.id ?? null, feature);
  if (result.ok && result.created && workspace) {
    await supabase.rpc("log_activity", {
      p_workspace_id: workspace.id,
      p_action: "home.feature_interest",
      p_entity_type: "feature",
      p_metadata: { feature },
    });
  }
  return { ok: result.ok };
}
