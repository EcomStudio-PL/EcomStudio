import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { listGalleryItems } from "@/lib/server/gallery";
import { retouchModel, RETOUCH_OPERATION } from "@/lib/server/retouch";
import { RetouchWorkspace } from "@/components/retouch/workspace";

export const dynamic = "force-dynamic";

/**
 * RETUSZ ZDJĘĆ — the tool page.
 *
 * Everything the panel needs is resolved here: the sizes and framings the
 * engine really offers, the price per image straight from the model config
 * (with the admin's `app_settings.retouch` override applied), the wallet and
 * this workspace's previous retouches. The model itself is never named to
 * the customer — they bought a retouch, not a provider.
 */
export default async function RetouchPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) redirect("/home");

  const [model, wallet, gallery] = await Promise.all([
    retouchModel(supabase),
    getWallet(supabase, workspace.id),
    listGalleryItems(supabase, workspace.id, { limit: 24, operation: RETOUCH_OPERATION }),
  ]);

  return (
    // Same shell contract as the generator: workspace tokens, and the
    // viewport-locked frame so the cost island stays at the column's foot.
    <div className="workspace workspace-page gen-shell pt-1">
      <RetouchWorkspace
        workspaceId={workspace.id}
        credits={wallet?.balance ?? 0}
        available={!!model}
        resolutions={model?.resolutions ?? []}
        ratios={model?.ratios ?? []}
        pricing={model?.pricing ?? {}}
        initialItems={gallery.items}
        initialCursor={gallery.nextCursor}
      />
    </div>
  );
}
