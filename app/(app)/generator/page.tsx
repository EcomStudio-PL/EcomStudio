import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { listProducts } from "@/lib/services/products";
import { signImageUrls } from "@/lib/services/images";
import { listGalleryItems } from "@/lib/server/gallery";
import { customModels, getUsableModels, toClientModel } from "@/lib/ai/router";
import { conceptModelOptions } from "@/lib/server/concept-generation";
import { PageHeader } from "@/components/ui/page-header";
import { GeneratorModeSwitch } from "@/components/generator/mode-switch";
import { GeneratorWorkspace, type WorkspaceProduct } from "@/components/genv3/workspace";
import type { GenModel } from "@/components/genv3/types";

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

  const [products, usable, wallet, gallery, priceOptions] = await Promise.all([
    listProducts(supabase, workspace.id, 30),
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
    if (gp?.prompt_text && gp.prompt_origin === "custom") initialPrompt = gp.prompt_text.slice(0, 2000);
  } else if (promptParam) {
    initialPrompt = promptParam.slice(0, 2000);
  }

  const productPaths = products.flatMap((p) => p.product_images.map((i) => i.storage_path));
  const urls = await signImageUrls(supabase, productPaths);
  const workspaceProducts: WorkspaceProduct[] = products.map((p) => ({
    id: p.id, name: p.name,
    category: (p as { category?: string | null }).category ?? null,
    description: (p as { description?: string | null }).description ?? null,
    images: p.product_images
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({ path: i.storage_path, url: urls.get(i.storage_path) ?? "" })),
  }));

  return (
    <div>
      <PageHeader overline={t("mega.create")} title={t("genv3.customTitle")} sub={t("genv3.customSub")} />
      <GeneratorModeSwitch
        active="custom"
        engineLabel={t("genv3.modeManaged")}
        customLabel={t("genv3.modeCustom")}
        engineCost={priceOptions[0]?.costEcom ?? null}
        customCost={priceOptions[0]?.costCustom ?? null}
        perShotLabel={(n) => t("concepts.perShot", { n })}
      />
      <GeneratorWorkspace
        mode="custom"
        models={models}
        products={workspaceProducts}
        credits={wallet?.balance ?? 0}
        workspaceId={workspace.id}
        initialItems={gallery.items}
        initialCursor={gallery.nextCursor}
        initialPrompt={initialPrompt}
      />
    </div>
  );
}
