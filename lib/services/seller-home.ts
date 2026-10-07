import type { Client } from "./workspace";
import { isInterestKey, isSellerChannel, type InterestKey, type SellerChannel } from "@/lib/seller-home-config";

/**
 * THE SIGNED-IN START (/home) — its two writes.
 *
 * Both take the CALLER'S identity from the server session (the action passes
 * the authenticated user id), never from the browser, and both are guarded a
 * second time by the database: a CHECK on the value and an RLS policy that
 * only lets a user write their own row.
 */

/** Save the answer to "Gdzie sprzedajesz?" — or, with `null`, record that
 *  the seller closed the question, so it is not asked again. */
export async function saveSellerChannel(
  supabase: Client, userId: string, channel: SellerChannel | null,
): Promise<{ ok: boolean }> {
  if (channel !== null && !isSellerChannel(channel)) return { ok: false };
  const patch: { seller_channel_asked_at: string; seller_channel?: SellerChannel } = {
    seller_channel_asked_at: new Date().toISOString(),
  };
  if (channel) patch.seller_channel = channel;
  const { error } = await supabase.from("profiles").update(patch).eq("id", userId);
  if (error) console.error("seller_home.channel", error.code, error.message);
  return { ok: !error };
}

/**
 * "Powiadom mnie" — idempotent. A second click (or a double click, or two
 * tabs) finds the row already there and reports success without writing a
 * duplicate: the (user_id, feature_key) primary key makes that impossible,
 * and `ignoreDuplicates` turns the conflict into a no-op.
 *
 * `created` says whether THIS call added the row — the action logs only then.
 */
export async function registerFeatureInterest(
  supabase: Client, userId: string, workspaceId: string | null, feature: InterestKey,
): Promise<{ ok: boolean; created: boolean }> {
  if (!isInterestKey(feature)) return { ok: false, created: false };
  const { data, error } = await supabase
    .from("feature_interest")
    .upsert({ user_id: userId, feature_key: feature, workspace_id: workspaceId },
      { onConflict: "user_id,feature_key", ignoreDuplicates: true })
    .select("feature_key");
  if (error) {
    console.error("seller_home.interest", error.code, error.message);
    return { ok: false, created: false };
  }
  return { ok: true, created: (data ?? []).length > 0 };
}
