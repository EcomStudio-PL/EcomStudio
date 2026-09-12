import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { listGalleryItems } from "@/lib/server/gallery";
import { conceptModelOptions } from "@/lib/server/concept-generation";
import { getSessionPreviews } from "@/lib/server/generator-ui";
import { WorkflowRuntime } from "@/components/category/workflow-runtime";
import type { GenModel } from "@/components/genv3/types";
import { findCategory } from "@/lib/categories";
import { FASHION_TOOLS } from "@/lib/fashion-tools";
import { fashionModel, fashionToolAvailable } from "@/lib/server/fashion";
import type { FashionRuntimeData } from "@/components/category/workflow-runtime";

export const dynamic = "force-dynamic";

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
    listGalleryItems(supabase, workspace.id, { limit: 24 }),
    getSessionPreviews(supabase),
  ]);
  const keyed = new Set((withKey ?? []) as string[]);
  const engineAvailable = (plannerProviders ?? []).some((p) => keyed.has(p.id));

  /**
   * EVERY TOOL'S DATA, FETCHED ONCE.
   *
   * Switching workflow must not reach the server (see WorkflowRuntime), and a
   * tool needs three things the preset does not: the model's sizes and prices,
   * whether its prompt is published, and its own past results. So all four are
   * resolved HERE, in one parallel batch, and handed to the runtime — a switch
   * then costs nothing, exactly like a preset switch.
   *
   * Only for Moda: no other category has tools, and fetching four galleries on
   * a category that cannot show them would be work nobody asked for.
   */
  let fashion: FashionRuntimeData | null = null;
  if (category.key === "moda") {
    const model = await fashionModel(supabase);
    const perTool = await Promise.all(FASHION_TOOLS.map(async (tool) => {
      const [available, items] = await Promise.all([
        fashionToolAvailable(supabase, tool.toolKey),
        listGalleryItems(supabase, workspace.id, { limit: 24, operation: tool.operation }),
      ]);
      return [tool.key, {
        available: Boolean(model) && available,
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

  const models: GenModel[] = modelOptions.map((m) => ({
    id: m.id, name: m.name, badge: m.badge, badgeTone: m.badgeTone,
    description: m.description, pricing: m.pricing,
    resolutions: m.resolutions, ratios: m.ratios, exactRatios: m.exactRatios,
    maxOutputs: 1, supportsRefs: true, surcharge: m.ecomSurcharge,
    qualities: m.qualities, qualityPricing: m.qualityPricing,
  }));

  return (
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
      />
    </div>
  );
}
