import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { listGalleryItems } from "@/lib/server/gallery";
import { GALLERY_PAGE_SIZE } from "@/lib/gallery-page";
import { conceptModelOptions } from "@/lib/server/concept-generation";
import { getSessionPreviews } from "@/lib/server/generator-ui";
import { WorkflowRuntime } from "@/components/category/workflow-runtime";
import type { GalleryItem, GenModel } from "@/components/genv3/types";
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
import type { Client } from "@/lib/services/workspace";
import type { ConceptModelOption } from "@/lib/server/concept-generation";

export const dynamic = "force-dynamic";

/** A workflow's title, description, canonical and robots — Public Tools V1
 *  (a workflow the catalogue does not list keeps noindex). */
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

/** The engines a workflow offers, in the panel's shape — one mapping for a
 *  member and a visitor. */
function toGenModels(modelOptions: ConceptModelOption[]): GenModel[] {
  return modelOptions.map((m) => ({
    id: m.id, name: m.name, badge: m.badge, badgeTone: m.badgeTone,
    description: m.description, pricing: m.pricing,
    resolutions: m.resolutions, ratios: m.ratios, exactRatios: m.exactRatios,
    maxOutputs: 1, supportsRefs: true,
    qualities: m.qualities, qualityPricing: m.qualityPricing,
  }));
}

/**
 * WHAT A VISITOR'S WORKFLOW SCREEN IS GIVEN (Public Tools V1): the same facts
 * the member's branch below reads — the engines and their prices, whether the
 * planner can run, the session previews, each Moda tool's availability and
 * size/price table, Miniaturka's state — read by the server's own client
 * (guestReadClient, 0157). Nothing of an account: no wallet, no gallery, no
 * run in progress. The chip row switches workflows on the client, so every
 * tool of the category gets its data here too, exactly as for a member.
 */
async function guestRuntime(reader: Client | null, categoryKey: string, isThumbnail: boolean) {
  const emptyThumbnail: ThumbnailRuntimeData = {
    ready: false, blockers: [], maxPhotos: 10, thumbnailCredits: null,
    retouch: { available: false as const, unit: null, reason: "model_unavailable" as const }, target: 2560,
    openRunId: null, initialItems: [], initialCursor: null,
  };
  if (!reader) {
    return { models: [] as GenModel[], engineAvailable: false, sessionPreviews: {}, fashion: null, thumbnail: isThumbnail ? emptyThumbnail : null };
  }
  const [{ data: plannerProviders }, { data: withKey }, modelOptions, sessionPreviews] = await Promise.all([
    reader.from("ai_providers").select("id").eq("active", true).in("slug", ["openai", "google"]),
    reader.rpc("providers_with_credentials"),
    conceptModelOptions(reader),
    getSessionPreviews(reader),
  ]);
  const keyed = new Set((withKey ?? []) as string[]);
  const engineAvailable = (plannerProviders ?? []).some((p) => keyed.has(p.id));

  let fashion: FashionRuntimeData | null = null;
  if (categoryKey === "moda") {
    const model = await fashionModel(reader);
    const perTool = await Promise.all(FASHION_TOOLS.map(async (tool) => {
      const [available, outputsPerRun] = await Promise.all([
        fashionToolAvailable(reader, tool.toolKey),
        engineOutputsPerRun(reader, tool.toolKey),
      ]);
      return [tool.key, { available: Boolean(model) && available, outputsPerRun, initialItems: [] as GalleryItem[], initialCursor: null }] as const;
    }));
    fashion = {
      resolutions: model?.resolutions ?? [],
      ratios: model?.ratios ?? [],
      pricing: model?.pricing ?? {},
      tools: Object.fromEntries(perTool),
    };
  }

  let thumbnail: ThumbnailRuntimeData | null = null;
  if (isThumbnail) {
    const state = await readThumbnailState(reader);
    thumbnail = { ...thumbnailView(state, false), openRunId: null, initialItems: [], initialCursor: null };
  }
  return { models: toGenModels(modelOptions), engineAvailable, sessionPreviews, fashion, thumbnail };
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

  // Public Tools V1: any workflow of the catalogue, asked for by a visitor (or
  // an admin's guest preview) — the same runtime and panels, priced by the
  // same code, nothing of an account. Whether it is listed at all (404
  // otherwise) is publicToolAudience's to decide, from the catalogue.
  const isThumbnail = category.key === THUMBNAIL_CATEGORY && workflow.key === THUMBNAIL_WORKFLOW;
  const pub = publicToolForPath(`/k/${category.slug}/${workflow.key}`);
  const audience = pub ? await publicToolAudience(pub.path) : null;
  if (pub && audience?.kind === "guest") {
    const data = await guestRuntime(guestReadClient(), category.key, isThumbnail);
    const guestScreen = (
      <ToolScope tool={pub} audience={audience}>
        <div className="workspace workspace-page gen-shell">
          <WorkflowRuntime catSlug={category.slug} initialWorkflow={workflow.key} models={data.models} credits={0}
            workspaceId="" engineAvailable={data.engineAvailable} initialItems={[]} initialCursor={null}
            sessionPreviews={data.sessionPreviews} fashion={data.fashion} thumbnail={data.thumbnail} />
        </div>
      </ToolScope>
    );
    return isThumbnail ? <FeatureGate feature="ecommerce_thumbnail">{guestScreen}</FeatureGate> : guestScreen;
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

  const models = toGenModels(modelOptions);

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
