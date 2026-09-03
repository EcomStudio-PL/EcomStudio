import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { listGalleryItems } from "@/lib/server/gallery";
import { conceptModelOptions } from "@/lib/server/concept-generation";
import { getSessionPreviews } from "@/lib/server/generator-ui";
import { GeneratorModeSwitch } from "@/components/generator/mode-switch";
import { GeneratorWorkspace } from "@/components/genv3/workspace";
import type { GenModel } from "@/components/genv3/types";
import { CATEGORY_VARIANT, DEFAULT_VARIANT, findCategory } from "@/lib/categories";

export const dynamic = "force-dynamic";

/** GOTOWY GENERATOR — the managed workspace: product photos + session type
 *  in, finished photos out. The hidden prompt engine stays server-side; the
 *  customer picks the AI model, the format, the size and the shot count. */
export default async function PromptsPage({ searchParams }: {
  searchParams: Promise<{ cat?: string }>;
}) {
  const { cat } = await searchParams;
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) redirect("/home");

  // Availability check goes through the definer RPC: ai_provider_credentials
  // is admin-only under RLS.
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

  const models: GenModel[] = modelOptions.map((m) => ({
    id: m.id, name: m.name, badge: m.badge, badgeTone: m.badgeTone,
    description: m.description, pricing: m.pricing,
    resolutions: m.resolutions, ratios: m.ratios, exactRatios: m.exactRatios,
    maxOutputs: 1, supportsRefs: true, surcharge: m.ecomSurcharge,
    qualities: m.qualities, qualityPricing: m.qualityPricing,
  }));


  // Legacy `?cat=` links still land on the right workspace flavour.
  const category = findCategory(cat);
  const variant = category ? CATEGORY_VARIANT[category.key] ?? DEFAULT_VARIANT : DEFAULT_VARIANT;
  const styleKey = category ? `cats.${category.key}Style` : "";
  const styleValue = styleKey ? t(styleKey) : "";
  const initialStyle = styleValue && styleValue !== styleKey ? styleValue : undefined;

  return (
    // §3: no page header — the workspace starts right under the navbar; the
    // mode toggle is the first element. `workspace` re-maps the surface
    // tokens onto the calm ramp, `workspace-page` paints the flat ground.
    <div className="workspace workspace-page gen-shell pt-1">
      <GeneratorModeSwitch
        active="engine"
        engineLabel={t("genv3.modeManaged")}
        customLabel={t("genv3.modeCustom")}
        engineCost={modelOptions[0]?.costEcom ?? null}
        customCost={modelOptions[0]?.costCustom ?? null}
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
  );
}
