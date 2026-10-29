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
import { getSessionPreviews } from "@/lib/server/generator-ui";
import { readSmartPromptOffer } from "@/lib/server/smart-prompt";
import { GeneratorWorkspace } from "@/components/genv3/workspace";
import type { GenModel } from "@/components/genv3/types";
import { CATEGORY_VARIANT, DEFAULT_VARIANT, findCategory } from "@/lib/categories";
import { ToolScope } from "@/components/public-tools/tool-scope";
import { guestReadClient, publicToolAudience } from "@/lib/server/public-tools";
import type { PublicTool } from "@/lib/public-tools";
import type { StudioTab } from "@/lib/generator/studio";
import type { Client } from "@/lib/services/workspace";
import { grovshotV2Enabled } from "@/lib/server/grovshot-v2/flag";
import { GROVSHOT_V2_MODEL_IDENTIFIER } from "@/lib/grovshot-v2/stages";

/** Must match the editor's own cap (components/genv3/workspace.tsx): a
 *  handed-over prompt that the field would accept must not arrive clipped. */
const PROMPT_MAX = 4000;

/** The member's working draft of the generator (both modes, one key). */
const DRAFT_KEY = "studio:generator";

/** GrovBase Shot: whether the engine can plan right now, its engines (priced by
 *  the same code), the session previews — the same reads for a member and a
 *  visitor. Availability goes through the definer RPC: credentials are
 *  admin-only under RLS. */
async function managedData(supabase: Client) {
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
  return { engineAvailable, models, sessionPreviews };
}

/** GrovShot Lifestyle Engine V2 for THIS member: the flag (Admin → System),
 *  not a trial workspace — and the model it runs on, when the panel offers it.
 *  The start route decides again for every order; this only shapes the panel. */
async function engineV2For(supabase: Client, userId: string, workspaceId: string, models: GenModel[]): Promise<{ modelId: string } | null> {
  if (!(await grovshotV2Enabled(supabase, userId, workspaceId))) return null;
  const { data } = await supabase.from("ai_models").select("id").eq("model_identifier", GROVSHOT_V2_MODEL_IDENTIFIER).eq("active", true).limit(1).maybeSingle();
  return data?.id && models.some((m) => m.id === data.id) ? { modelId: data.id } : null;
}

/** Stwórz zdjęcie: the engines a customer may pick, in the panel's shape. */
async function customModelsFor(supabase: Client): Promise<GenModel[]> {
  const usable = await getUsableModels(supabase);
  return customModels(usable).map(toClientModel).map((m) => ({
    id: m.id, name: m.displayName, badge: m.badge, badgeTone: m.badgeTone,
    description: m.description, pricing: m.pricing,
    resolutions: m.resolutions, ratios: m.ratios, exactRatios: m.exactRatios,
    maxOutputs: m.maxQuantity, supportsRefs: m.supportsReferenceImages,
    maxRefs: m.maxReferenceImages,
    qualities: m.qualities, qualityPricing: m.qualityPricing,
  }));
}

/**
 * GENERATOR UX V3 — ONE SCREEN, TWO MODES.
 *
 * /prompts (GrovBase Shot 1.0) and /generator (Stwórz zdjęcie) both render
 * this: the same panel with both modes loaded, opening on the address's own
 * mode (or `?tryb=`). Switching is a client-side tab, so the photos and every
 * setting survive it. Each address keeps its own metadata, canonical and
 * Public Tools identity (the `tool` the page passes in).
 */
export async function GeneratorStudioPage({ tool, initialTab, searchParams }: {
  tool: PublicTool;
  initialTab: StudioTab;
  searchParams: { cat?: string; prompt?: string };
}) {
  const { dict } = await getDictionary();
  const t = makeT(dict);

  // Legacy `?cat=` links still land on the right GrovShot flavour.
  const category = findCategory(searchParams.cat);
  const variant = category ? CATEGORY_VARIANT[category.key] ?? DEFAULT_VARIANT : DEFAULT_VARIANT;
  const styleKey = category ? `cats.${category.key}Style` : "";
  const styleValue = styleKey ? t(styleKey) : "";
  const initialStyle = styleValue && styleValue !== styleKey ? styleValue : undefined;
  const back = { href: "/tools", label: t("nav.allTools") };

  // Public Tools V1: a visitor (or an admin's guest preview) gets the same
  // panel — the engines, the prices, the session previews — and nothing of an
  // account: no wallet, no gallery, no saved prompt, no paid rewrite.
  const audience = await publicToolAudience(tool.path);
  if (audience.kind === "guest") {
    const reader = guestReadClient();
    const [managed, custom] = reader
      ? await Promise.all([managedData(reader), customModelsFor(reader)])
      : [null, [] as GenModel[]];
    return (
      <ToolScope tool={tool} audience={audience}>
        <div className="workspace workspace-page gen-shell pt-1">
          <GeneratorWorkspace
            managed={{ models: managed?.models ?? [], engineAvailable: managed?.engineAvailable ?? false,
              sessionPreviews: managed?.sessionPreviews, variant, initialStyle }}
            custom={{ models: custom, initialPrompt: "" }}
            initialTab={initialTab} credits={0} workspaceId=""
            initialItems={[]} initialCursor={null} back={back} />
        </div>
      </ToolScope>
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) redirect("/home");
  const [managed, custom, wallet, gallery, smartPrompt] = await Promise.all([
    managedData(supabase),
    customModelsFor(supabase),
    getWallet(supabase, workspace.id),
    listGalleryItems(supabase, workspace.id, { limit: GALLERY_PAGE_SIZE }),
    // Inteligentny prompt: the catalogue price and whether it may be offered.
    readSmartPromptOffer(supabase),
  ]);

  const engineV2 = await engineV2For(supabase, user.id, workspace.id, managed.models);

  // Prompt handoff: ?prompt=<generated_prompt uuid> prefills the customer's
  // own saved prompt; any other value is raw prompt text (inspiration gallery
  // "use this"). Engine concepts carry no readable prompt and never open here.
  let initialPrompt = "";
  const promptParam = searchParams.prompt;
  if (promptParam && /^[0-9a-f-]{36}$/.test(promptParam)) {
    const { data: gp } = await supabase
      .from("generated_prompts").select("prompt_text, prompt_origin")
      .eq("id", promptParam).eq("workspace_id", workspace.id).maybeSingle();
    if (gp?.prompt_text && gp.prompt_origin === "custom") initialPrompt = gp.prompt_text.slice(0, PROMPT_MAX);
  } else if (promptParam) {
    initialPrompt = promptParam.slice(0, PROMPT_MAX);
  }

  return (
    // No page header: the frame's own row (way back, the two modes, "?") is
    // the first thing; `gen-shell` binds the page to the viewport on desktop.
    <ToolScope tool={tool} audience={audience}>
      <div className="workspace workspace-page gen-shell pt-1">
        <GeneratorWorkspace
          managed={{ ...managed, variant, initialStyle, engineV2 }}
          custom={{ models: custom, smartPrompt, initialPrompt }}
          // A handed-over prompt opens the mode it belongs to.
          initialTab={initialPrompt ? "stworz" : initialTab}
          credits={wallet?.balance ?? 0}
          workspaceId={workspace.id}
          initialItems={gallery.items}
          initialCursor={gallery.nextCursor}
          back={back}
          draftKey={DRAFT_KEY}
        />
      </div>
    </ToolScope>
  );
}
