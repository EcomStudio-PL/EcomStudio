import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { listGalleryItems } from "@/lib/server/gallery";
import { GALLERY_PAGE_SIZE } from "@/lib/gallery-page";
import { conceptModelOptions } from "@/lib/server/concept-generation";
import { getSessionPreviews } from "@/lib/server/generator-ui";
import { WorkflowRuntime } from "@/components/category/workflow-runtime";
import type { GenModel } from "@/components/genv3/types";
import { findCategory } from "@/lib/categories";
import { FASHION_TOOLS } from "@/lib/fashion-tools";
import { fashionModel, fashionToolAvailable } from "@/lib/server/fashion";
import { engineOutputsPerRun } from "@/lib/server/engine/tool-run";
import type { FashionRuntimeData, ThumbnailRuntimeData } from "@/components/category/workflow-runtime";
import { FeatureGate } from "@/components/feature-gate";
import { viewerIsAdmin } from "@/lib/server/feature-availability";
import { readThumbnailState } from "@/lib/server/thumbnail/settings";
import { latestOpenThumbnailRun } from "@/lib/server/thumbnail/status";
import { OPENAI_EDIT_MAX_IMAGES, THUMBNAIL_CATEGORY, THUMBNAIL_OPERATION, THUMBNAIL_WORKFLOW } from "@/lib/thumbnail/config";
import { ToolScope } from "@/components/public-tools/tool-scope";
import { guestReadClient, publicToolAudience } from "@/lib/server/public-tools";
import { publicToolMetadata } from "@/lib/server/public-tool-meta";
import { publicToolForPath } from "@/lib/public-tools";
import type { ThumbnailState } from "@/lib/server/thumbnail/settings";

export const dynamic = "force-dynamic";

/** A public workflow's (Miniaturka's) title, description, canonical and
 *  robots — Public Tools V1; every other workflow keeps the defaults. */
export async function generateMetadata({ params }: { params: Promise<{ cat: string; wf: string }> }) {
  const { cat, wf } = await params;
  const tool = publicToolForPath(`/k/${cat}/${wf}`);
  return tool ? publicToolMetadata(tool) : {};
}

/** What the panel may know about Miniaturka — the same for a member and a
 *  visitor; the blockers' names only for an admin. */
function thumbnailView(state: ThumbnailState, admin: boolean) {
  return {
    ready: state.ready,
    blockers: admin ? state.blockers : [],
    maxPhotos: Math.min(state.config?.maxPhotos ?? 10, OPENAI_EDIT_MAX_IMAGES),
    thumbnailCredits: state.thumbnailCredits,
    retouch: state.retouch.available
      ? { available: true as const, unit: state.retouch.unit }
      : { available: false as const, unit: null, reason: state.retouch.reason },
    target: state.config?.finish.target ?? 2560,
  };
}

/**
 * WORKFLOW WORKSPACE — the managed generator opened with this workflow's own
 * defaults: its framing, its shot count, its style directive and the extra
 * decisions its category actually needs. Sibling workflows sit in a chip row
 * at the top, so switching preset never means going back a page.
 *
 * Everything this page loads belongs to the WORKSPACE, not to the preset:
 * wallet, model chain, provider health, gallery, session previews. The preset
 * itself contributes nothing but static configuration, so the chip row and the
 * generator live in WorkflowRuntime and switch client-side — see the note
 * there. This render is what a direct hit or a refresh costs; a switch costs
 * nothing.
 */
export default async function WorkflowPage({ params }: {
  params: Promise<{ cat: string; wf: string }>;
}) {
  const { cat, wf } = await params;
  const category = findCategory(cat);
  if (!category) notFound();
  const workflow = category.workflows.find((w) => w.key === wf);
  if (!workflow || workflow.soon || category.soon) notFound();

  // Public Tools V1: Miniaturka, asked for by a visitor (or an admin's guest
  // preview) — the same panel priced by the same code, nothing of an account.
  // Every other workflow needs a session, as before.
  const pub = publicToolForPath(`/k/${category.slug}/${workflow.key}`);
  const audience = pub ? await publicToolAudience(pub.path) : null;
  if (pub && audience?.kind === "guest") {
    const reader = guestReadClient();
    const state = reader ? await readThumbnailState(reader) : null;
    const thumbnail: ThumbnailRuntimeData = {
      ...(state ? thumbnailView(state, false) : {
        ready: false, blockers: [], maxPhotos: 10, thumbnailCredits: null,
        retouch: { available: false as const, unit: null, reason: "model_unavailable" as const }, target: 2560,
      }),
      openRunId: null,
      initialItems: [],
      initialCursor: null,
    };
    return (
      <FeatureGate feature="ecommerce_thumbnail">
        <ToolScope tool={pub} audience={audience}>
          <div className="workspace workspace-page gen-shell">
            <WorkflowRuntime catSlug={category.slug} initialWorkflow={workflow.key} models={[]} credits={0}
              workspaceId="" engineAvailable={false} initialItems={[]} initialCursor={null} sessionPreviews={{}}
              fashion={null} thumbnail={thumbnail} />
          </div>
        </ToolScope>
      </FeatureGate>
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) redirect("/home");
  const [{ data: plannerProviders }, { data: withKey }, wallet, modelOptions, gallery, sessionPreviews] = await Promise.all([
    supabase.from("ai_providers").select("id").eq("active", true).in("slug", ["openai", "google"]),
    supabase.rpc("providers_with_credentials"),
    getWallet(supabase, workspace.id),
    conceptModelOptions(supabase),
    listGalleryItems(supabase, workspace.id, { limit: GALLERY_PAGE_SIZE }),
    getSessionPreviews(supabase),
  ]);
  const keyed = new Set((withKey ?? []) as string[]);
  const engineAvailable = (plannerProviders ?? []).some((p) => keyed.has(p.id));

  /**
   * EVERY TOOL'S DATA, FETCHED ONCE.
   *
   * Switching workflow must not reach the server (see WorkflowRuntime), and a
   * tool needs three things the preset does not: the model's sizes and prices,
   * whether its prompt is published, and its own past results. So every one is
   * resolved HERE, in one parallel batch, and handed to the runtime — a switch
   * then costs nothing, exactly like a preset switch.
   *
   * Only for Moda: no other category has tools, and fetching a gallery per tool on
   * a category that cannot show them would be work nobody asked for.
   */
  let fashion: FashionRuntimeData | null = null;
  if (category.key === "moda") {
    const model = await fashionModel(supabase);
    const perTool = await Promise.all(FASHION_TOOLS.map(async (tool) => {
      const [available, items, outputsPerRun] = await Promise.all([
        fashionToolAvailable(supabase, tool.toolKey),
        listGalleryItems(supabase, workspace.id, { limit: GALLERY_PAGE_SIZE, operation: tool.operation }),
        engineOutputsPerRun(supabase, tool.toolKey),
      ]);
      return [tool.key, {
        available: Boolean(model) && available,
        outputsPerRun,
        initialItems: items.items,
        initialCursor: items.nextCursor,
      }] as const;
    }));
    fashion = {
      resolutions: model?.resolutions ?? [],
      ratios: model?.ratios ?? [],
      pricing: model?.pricing ?? {},
      tools: Object.fromEntries(perTool),
    };
  }

  /**
   * MINIATURKA — its own pipeline, its own data: can it run (and, for an
   * admin, why not), its price and Retusz's, its photo limit, its own past
   * results, and the member's run still in progress (resumed after a refresh).
   */
  let thumbnail: ThumbnailRuntimeData | null = null;
  const isThumbnail = category.key === THUMBNAIL_CATEGORY && workflow.key === THUMBNAIL_WORKFLOW;
  if (isThumbnail) {
    const [state, items, openRunId, admin] = await Promise.all([
      readThumbnailState(supabase),
      listGalleryItems(supabase, workspace.id, { limit: GALLERY_PAGE_SIZE, operation: THUMBNAIL_OPERATION }),
      latestOpenThumbnailRun(supabase, workspace.id),
      viewerIsAdmin(supabase),
    ]);
    thumbnail = {
      ...thumbnailView(state, admin),
      openRunId,
      initialItems: items.items,
      initialCursor: items.nextCursor,
    };
  }

  const models: GenModel[] = modelOptions.map((m) => ({
    id: m.id, name: m.name, badge: m.badge, badgeTone: m.badgeTone,
    description: m.description, pricing: m.pricing,
    resolutions: m.resolutions, ratios: m.ratios, exactRatios: m.exactRatios,
    maxOutputs: 1, supportsRefs: true,
    qualities: m.qualities, qualityPricing: m.qualityPricing,
  }));

  const screen = (
    // Same calm workspace scope as /prompts — the compact category header
    // stays (it is navigation between presets, not a marketing header).
    <div className="workspace workspace-page gen-shell">
      <WorkflowRuntime
        catSlug={category.slug}
        initialWorkflow={workflow.key}
        models={models}
        credits={wallet?.balance ?? 0}
        workspaceId={workspace.id}
        engineAvailable={engineAvailable}
        initialItems={gallery.items}
        initialCursor={gallery.nextCursor}
        sessionPreviews={sessionPreviews}
        fashion={fashion}
        thumbnail={thumbnail}
      />
    </div>
  );
  // Miniaturka has its own switch (status, "Wkrótce", maintenance) inside the
  // category's: the category layout gates the route, this gates the tool.
  const scoped = pub && audience ? <ToolScope tool={pub} audience={audience}>{screen}</ToolScope> : screen;
  return isThumbnail ? <FeatureGate feature="ecommerce_thumbnail">{scoped}</FeatureGate> : scoped;
}
