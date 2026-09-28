import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { listGalleryItems } from "@/lib/server/gallery";
import { GALLERY_PAGE_SIZE } from "@/lib/gallery-page";
import { retouchModel, retouchPrice, retouchRunResolution, RETOUCH_OPERATION } from "@/lib/server/retouch";
import { engineOutputsPerRun, engineToolConfigured } from "@/lib/server/engine/tool-run";
import { RetouchWorkspace } from "@/components/retouch/workspace";

export const dynamic = "force-dynamic";

/**
 * RETUSZ ZDJĘĆ — the tool page.
 *
 * Everything the panel needs is resolved here: the price per image (the
 * default size — Retusz sends no size for now) straight from the model config
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

  const [model, wallet, gallery, outputsPerRun, configured] = await Promise.all([
    retouchModel(supabase),
    getWallet(supabase, workspace.id),
    listGalleryItems(supabase, workspace.id, { limit: GALLERY_PAGE_SIZE, operation: RETOUCH_OPERATION }),
    // Workflow ON: one photo yields the published workflow's result count,
    // and is priced for it (the server charges exactly this).
    engineOutputsPerRun(supabase, "retouch"),
    // No published prompt → the tool is honestly unavailable (it has no
    // built-in instruction to fall back on).
    engineToolConfigured(supabase, "retouch", false),
  ]);

  return (
    // Same shell contract as the generator: workspace tokens, and the
    // viewport-locked frame so the cost island stays at the column's foot.
    <div className="workspace workspace-page gen-shell pt-1">
      <RetouchWorkspace
        workspaceId={workspace.id}
        credits={wallet?.balance ?? 0}
        available={!!model && configured}
        // One price: the run is billed at the default size it renders at
        // (no size is sent while the size picker is withheld).
        price={model ? retouchPrice(model, retouchRunResolution(model)) : 0}
        outputsPerRun={outputsPerRun}
        initialItems={gallery.items}
        initialCursor={gallery.nextCursor}
      />
    </div>
  );
}
