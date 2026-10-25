import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { listGalleryItems } from "@/lib/server/gallery";
import { GALLERY_PAGE_SIZE } from "@/lib/gallery-page";
import { conceptModelOptions } from "@/lib/server/concept-generation";
import { getSessionPreviews } from "@/lib/server/generator-ui";
import { GeneratorModeSwitch } from "@/components/generator/mode-switch";
import { GeneratorWorkspace } from "@/components/genv3/workspace";
import type { GenModel } from "@/components/genv3/types";
import { CATEGORY_VARIANT, DEFAULT_VARIANT, findCategory } from "@/lib/categories";
import { ToolScope } from "@/components/public-tools/tool-scope";
import { guestReadClient, publicToolAudience } from "@/lib/server/public-tools";
import { publicToolMetadata } from "@/lib/server/public-tool-meta";
import { publicToolByKey } from "@/lib/public-tools";
import type { Client } from "@/lib/services/workspace";

const TOOL = publicToolByKey("generator")!;

/** Title, description, canonical, robots — Public Tools V1. */
export function generateMetadata() {
  return publicToolMetadata(TOOL);
}

export const dynamic = "force-dynamic";

/** What the managed workspace needs that is not the customer's own: whether
 *  the engine can plan right now, the engines on offer (priced by the same
 *  code), the session previews — read the same way for a member and a visitor. */
async function managedData(supabase: Client) {
  // Availability check goes through the definer RPC: ai_provider_credentials
  // is admin-only under RLS.
  const [{ data: plannerProviders }, { data: withKey }, modelOptions, sessionPreviews] = await Promise.all([
    supabase.from("ai_providers").select("id").eq("active", true).in("slug", ["openai", "google"]),
    supabase.rpc("providers_with_credentials"),
    conceptModelOptions(supabase),
    getSessionPreviews(supabase),
  ]);
  const keyed = new Set((withKey ?? []) as string[]);
  const engineAvailable = (plannerProviders ?? []).some((p) => keyed.has(p.id));
  const models: GenModel[] = modelOptions.map((m) => ({
    id: m.id, name: m.name, badge: m.badge, badgeTone: m.badgeTone,
    description: m.description, pricing: m.pricing,
    resolutions: m.resolutions, ratios: m.ratios, exactRatios: m.exactRatios,
    maxOutputs: 1, supportsRefs: true,
    qualities: m.qualities, qualityPricing: m.qualityPricing,
  }));
  return { engineAvailable, models, cost: modelOptions[0]?.cost ?? null, sessionPreviews };
}

/** GOTOWY GENERATOR — the managed workspace: product photos + session type
 *  in, finished photos out. The hidden prompt engine stays server-side; the
 *  customer picks the AI model, the format, the size and the shot count. */
export default async function PromptsPage({ searchParams }: {
  searchParams: Promise<{ cat?: string }>;
}) {
  const { cat } = await searchParams;
  const { dict } = await getDictionary();
  const t = makeT(dict);

  // Legacy `?cat=` links still land on the right workspace flavour.
  const category = findCategory(cat);
  const variant = category ? CATEGORY_VARIANT[category.key] ?? DEFAULT_VARIANT : DEFAULT_VARIANT;
  const styleKey = category ? `cats.${category.key}Style` : "";
  const styleValue = styleKey ? t(styleKey) : "";
  const initialStyle = styleValue && styleValue !== styleKey ? styleValue : undefined;

  // Public Tools V1: a visitor (or an admin's guest preview) gets the same
  // managed workspace — the engines, the prices, the session previews — and
  // nothing of an account: no wallet, no gallery. The prompt engine itself
  // stays where it always is, on the server, behind a signed-in POST.
  const audience = await publicToolAudience(TOOL.path);
  if (audience.kind === "guest") {
    const reader = guestReadClient();
    const data = reader ? await managedData(reader) : null;
    return (
      <ToolScope tool={TOOL} audience={audience}>
        <div className="workspace workspace-page gen-shell pt-1">
          <GeneratorModeSwitch
            active="engine"
            engineLabel={t("genv3.modeManaged")}
            customLabel={t("genv3.modeCustom")}
            engineCost={data?.cost ?? null}
            customCost={data?.cost ?? null}
            perShotLabel={(n) => t("genv3.perPhoto", { n })}
          />
          <GeneratorWorkspace mode="managed" models={data?.models ?? []} credits={0} workspaceId=""
            engineAvailable={data?.engineAvailable ?? false} initialItems={[]} initialCursor={null}
            initialStyle={initialStyle} variant={variant} sessionPreviews={data?.sessionPreviews} />
        </div>
      </ToolScope>
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) redirect("/home");

  const [{ engineAvailable, models, cost, sessionPreviews }, wallet, gallery] = await Promise.all([
    managedData(supabase),
    getWallet(supabase, workspace.id),
    listGalleryItems(supabase, workspace.id, { limit: GALLERY_PAGE_SIZE }),
  ]);

  return (
    // §3: no page header — the workspace starts right under the navbar; the
    // mode toggle is the first element. `workspace` re-maps the surface
    // tokens onto the calm ramp, `workspace-page` paints the flat ground.
    <ToolScope tool={TOOL} audience={audience}>
    <div className="workspace workspace-page gen-shell pt-1">
      <GeneratorModeSwitch
        active="engine"
        engineLabel={t("genv3.modeManaged")}
        customLabel={t("genv3.modeCustom")}
        engineCost={cost}
        customCost={cost}
        perShotLabel={(n) => t("genv3.perPhoto", { n })}
      />
      <GeneratorWorkspace
        mode="managed"
        models={models}
        credits={wallet?.balance ?? 0}
        workspaceId={workspace.id}
        engineAvailable={engineAvailable}
        initialItems={gallery.items}
        initialCursor={gallery.nextCursor}
        initialStyle={initialStyle}
        variant={variant}
        sessionPreviews={sessionPreviews}
      />
    </div>
    </ToolScope>
  );
}
