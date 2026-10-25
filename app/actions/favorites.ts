"use server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { countFavoriteAssets } from "@/lib/server/gallery";

/** The Library's liked-picture count for one shelf, for the signed-in
 *  customer's own workspace. Null when it cannot be read. */
export async function favoriteCountAction(assetType: "image" | "video"): Promise<number | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return null;
  return countFavoriteAssets(supabase, workspace.id, assetType === "video" ? "video" : "image");
}
