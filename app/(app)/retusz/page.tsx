import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { listGalleryItems } from "@/lib/server/gallery";
import { GALLERY_PAGE_SIZE } from "@/lib/gallery-page";
import { retouchModel, retouchPrice, retouchRatios, retouchSizes, retouchWorkflowSize, RETOUCH_OPERATION } from "@/lib/server/retouch";
import { engineOutputsPerRun, engineToolConfigured } from "@/lib/server/engine/tool-run";
import { RetouchWorkspace } from "@/components/retouch/workspace";
import { ToolScope } from "@/components/public-tools/tool-scope";
import { guestReadClient, publicToolAudience } from "@/lib/server/public-tools";
import { publicToolByKey } from "@/lib/public-tools";
import { publicToolMetadata } from "@/lib/server/public-tool-meta";
import type { Client } from "@/lib/services/workspace";

const TOOL = publicToolByKey("retouch")!;

export function generateMetadata() {
  return publicToolMetadata(TOOL);
}

export const dynamic = "force-dynamic";

/**
 * RETUSZ ZDJĘĆ — the tool page.
 *
 * Everything the panel needs is resolved here: the price per image at each
 * offered size (2K / 4K) straight from the model config
 * (with the admin's `app_settings.retouch` override applied), the wallet and
 * this workspace's previous retouches. The model itself is never named to
 * the customer — they bought a retouch, not a provider.
 */
export default async function RetouchPage() {
  // Public Tools V1: a visitor (or an admin's guest preview) gets the same
  // panel, priced by the same code, with nothing of an account behind it.
  const audience = await publicToolAudience(TOOL.path);
  if (audience.kind === "guest") {
    return <ToolScope tool={TOOL} audience={audience}><GuestRetouch /></ToolScope>;
  }

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
    <ToolScope tool={TOOL} audience={audience}>
    {/* Same shell contract as the generator: workspace tokens, and the
        viewport-locked frame so the cost island stays at the column's foot. */}
    <div className="workspace workspace-page gen-shell pt-1">
      <RetouchWorkspace
        workspaceId={workspace.id}
        credits={wallet?.balance ?? 0}
        available={!!model && configured}
        // 2K / 4K only (no 1K), and the ratios Google renders for this model.
        // Workflow ON keeps its 1K price (the workflow path is unchanged).
        resolutions={model ? (model.workflowEnabled ? [retouchWorkflowSize(model)] : retouchSizes(model)) : []}
        ratios={model && !model.workflowEnabled ? retouchRatios(model) : []}
        pricing={model ? Object.fromEntries((model.workflowEnabled ? [retouchWorkflowSize(model)] : retouchSizes(model)).map((r) => [r, retouchPrice(model, r)])) : {}}
        outputsPerRun={outputsPerRun}
        initialItems={gallery.items}
        initialCursor={gallery.nextCursor}
      />
    </div>
    </ToolScope>
  );
}

/**
 * The visitor's retouch: the model's price per size and whether the tool can
 * run, read by the server (guestReadClient — migration 0157) through the same
 * functions as above. No wallet, no gallery, no workspace: the photos stay in
 * the visitor's browser until they sign in.
 */
async function GuestRetouch() {
  const reader: Client | null = guestReadClient();
  const [model, outputsPerRun, configured] = reader
    ? await Promise.all([
        retouchModel(reader),
        engineOutputsPerRun(reader, "retouch"),
        engineToolConfigured(reader, "retouch", false),
      ])
    : [null, 1, false] as const;
  const sizes = model ? (model.workflowEnabled ? [retouchWorkflowSize(model)] : retouchSizes(model)) : [];
  return (
    <div className="workspace workspace-page gen-shell pt-1">
      <RetouchWorkspace
        workspaceId=""
        credits={0}
        available={!!model && configured}
        resolutions={sizes}
        ratios={model && !model.workflowEnabled ? retouchRatios(model) : []}
        pricing={model ? Object.fromEntries(sizes.map((r) => [r, retouchPrice(model, r)])) : {}}
        outputsPerRun={outputsPerRun}
        initialItems={[]}
        initialCursor={null}
      />
    </div>
  );
}
