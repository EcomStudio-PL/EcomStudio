import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { listGalleryItems } from "@/lib/server/gallery";
import { customModels, getUsableModels, toClientModel } from "@/lib/ai/router";
import { conceptModelOptions } from "@/lib/server/concept-generation";
import { GeneratorModeSwitch } from "@/components/generator/mode-switch";
import { GeneratorWorkspace } from "@/components/genv3/workspace";
import type { GenModel } from "@/components/genv3/types";

/** Must match the editor's own cap (components/genv3/workspace.tsx): a
 *  handed-over prompt that the popup would accept must not arrive clipped. */
const PROMPT_MAX = 4000;

export const dynamic = "force-dynamic";

/** WŁASNY PROMPT — the customer's own words drive the generation. Product
 *  reference photos define the product; optional inspiration photos steer
 *  scene and mood without ever overriding product identity. */
export default async function GeneratorPage({ searchParams }: {
  searchParams: Promise<{ prompt?: string }>;
}) {
  const { prompt: promptParam } = await searchParams;
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) redirect("/home");
  const [usable, wallet, gallery, priceOptions] = await Promise.all([
    getUsableModels(supabase),
    getWallet(supabase, workspace.id),
    listGalleryItems(supabase, workspace.id, { limit: 24 }),
    conceptModelOptions(supabase),
  ]);

  const models: GenModel[] = customModels(usable).map(toClientModel).map((m) => ({
    id: m.id, name: m.displayName, badge: m.badge, badgeTone: m.badgeTone,
    description: m.description, pricing: m.pricing,
    resolutions: m.resolutions, ratios: m.ratios,
    maxOutputs: m.maxQuantity, supportsRefs: m.supportsReferenceImages,
    surcharge: m.engineSurcharge,
    qualities: m.qualities, qualityPricing: m.qualityPricing,
  }));

  // Prompt handoff: ?prompt=<generated_prompt uuid> prefills the customer's
  // own saved prompt text; any other value is treated as raw prompt text
  // (inspiration gallery "use this"). Engine concepts carry no readable
  // prompt (GrovBase IP, stored encrypted) and never open here.
  let initialPrompt = "";
  if (promptParam && /^[0-9a-f-]{36}$/.test(promptParam)) {
    const { data: gp } = await supabase
      .from("generated_prompts").select("prompt_text, prompt_origin")
      .eq("id", promptParam).eq("workspace_id", workspace.id).maybeSingle();
    if (gp?.prompt_text && gp.prompt_origin === "custom") initialPrompt = gp.prompt_text.slice(0, PROMPT_MAX);
  } else if (promptParam) {
    initialPrompt = promptParam.slice(0, PROMPT_MAX);
  }


  return (
    // §3: no page header — mode toggle first, workspace tokens scoped here.
    // `gen-shell` binds the page to the viewport on desktop so the action
    // island at the bottom of the left column stays put (globals.css).
    <div className="workspace workspace-page gen-shell pt-1">
      <GeneratorModeSwitch
        active="custom"
        engineLabel={t("genv3.modeManaged")}
        customLabel={t("genv3.modeCustom")}
        engineCost={priceOptions[0]?.costEcom ?? null}
        customCost={priceOptions[0]?.costCustom ?? null}
        perShotLabel={(n) => t("genv3.perPhoto", { n })}
      />
      <GeneratorWorkspace
        mode="custom"
        models={models}
        credits={wallet?.balance ?? 0}
        workspaceId={workspace.id}
        initialItems={gallery.items}
        initialCursor={gallery.nextCursor}
        initialPrompt={initialPrompt}
      />
    </div>
  );
}
