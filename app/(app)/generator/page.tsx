import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { listGalleryItems } from "@/lib/server/gallery";
import { GALLERY_PAGE_SIZE } from "@/lib/gallery-page";
import { customModels, getUsableModels, toClientModel } from "@/lib/ai/router";
import { conceptModelOptions } from "@/lib/server/concept-generation";
import { readSmartPromptOffer } from "@/lib/server/smart-prompt";
import { GeneratorModeSwitch } from "@/components/generator/mode-switch";
import { GeneratorWorkspace } from "@/components/genv3/workspace";
import type { GenModel } from "@/components/genv3/types";
import { ToolScope } from "@/components/public-tools/tool-scope";
import { guestReadClient, publicToolAudience } from "@/lib/server/public-tools";
import { publicToolMetadata } from "@/lib/server/public-tool-meta";
import { publicToolByKey } from "@/lib/public-tools";
import type { Client } from "@/lib/services/workspace";

const TOOL = publicToolByKey("custom")!;

/** Title, description, canonical, robots — Public Tools V1. */
export function generateMetadata() {
  return publicToolMetadata(TOOL);
}

/** The engines a customer may pick, in the panel's shape — the same mapping
 *  for a member and a visitor. */
async function customModelsFor(supabase: Client): Promise<GenModel[]> {
  const usable = await getUsableModels(supabase);
  return customModels(usable).map(toClientModel).map((m) => ({
    id: m.id, name: m.displayName, badge: m.badge, badgeTone: m.badgeTone,
    description: m.description, pricing: m.pricing,
    resolutions: m.resolutions, ratios: m.ratios, exactRatios: m.exactRatios,
    maxOutputs: m.maxQuantity, supportsRefs: m.supportsReferenceImages,
    qualities: m.qualities, qualityPricing: m.qualityPricing,
  }));
}

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
  const { dict } = await getDictionary();
  const t = makeT(dict);

  // Public Tools V1: a visitor (or an admin's guest preview) gets the same
  // workspace and the same engines, priced by the same code — no gallery, no
  // saved prompts, no paid "Inteligentny prompt", nothing of an account.
  const audience = await publicToolAudience(TOOL.path);
  if (audience.kind === "guest") {
    const reader = guestReadClient();
    const [guestModels, guestOptions] = reader
      ? await Promise.all([customModelsFor(reader), conceptModelOptions(reader)])
      : [[], []];
    return (
      <ToolScope tool={TOOL} audience={audience}>
        <div className="workspace workspace-page gen-shell pt-1">
          <GeneratorModeSwitch
            active="custom"
            engineLabel={t("genv3.modeManaged")}
            customLabel={t("genv3.modeCustom")}
            engineCost={guestOptions[0]?.cost ?? null}
            customCost={guestOptions[0]?.cost ?? null}
            perShotLabel={(n) => t("genv3.perPhoto", { n })}
          />
          <GeneratorWorkspace mode="custom" models={guestModels} credits={0} workspaceId=""
            initialItems={[]} initialCursor={null} initialPrompt="" />
        </div>
      </ToolScope>
    );
  }

  const { prompt: promptParam } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) redirect("/home");
  const [models, wallet, gallery, priceOptions, smartPrompt] = await Promise.all([
    customModelsFor(supabase),
    getWallet(supabase, workspace.id),
    listGalleryItems(supabase, workspace.id, { limit: GALLERY_PAGE_SIZE }),
    conceptModelOptions(supabase),
    // Inteligentny prompt: the catalogue price and whether it may be offered.
    readSmartPromptOffer(supabase),
  ]);


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
    <ToolScope tool={TOOL} audience={audience}>
    <div className="workspace workspace-page gen-shell pt-1">
      <GeneratorModeSwitch
        active="custom"
        engineLabel={t("genv3.modeManaged")}
        customLabel={t("genv3.modeCustom")}
        engineCost={priceOptions[0]?.cost ?? null}
        customCost={priceOptions[0]?.cost ?? null}
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
        smartPrompt={smartPrompt}
      />
    </div>
    </ToolScope>
  );
}
