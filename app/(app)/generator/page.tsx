import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { listProducts } from "@/lib/services/products";
import { getUsableModels } from "@/lib/ai/router";
import { signImageUrls } from "@/lib/services/images";
import { PageHeader } from "@/components/ui/page-header";
import { Studio, type StudioModel, type StudioProduct } from "@/components/generator/studio";

export default async function GeneratorPage({ searchParams }: {
  searchParams: Promise<{ prompt?: string }>;
}) {
  const { prompt: promptParam } = await searchParams;
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return null;
  const [products, models, wallet] = await Promise.all([
    listProducts(supabase, workspace.id, 30),
    getUsableModels(supabase),
    getWallet(supabase, workspace.id),
  ]);
  const allPaths = products.flatMap((p) => p.product_images.map((i) => i.storage_path));
  const urls = await signImageUrls(supabase, allPaths);
  const studioProducts: StudioProduct[] = products.map((p) => ({
    id: p.id, name: p.name,
    description: (p as { description?: string | null }).description ?? null,
    category: (p as { category?: string | null }).category ?? null,
    extra_info: (p as { extra_info?: string | null }).extra_info ?? null,
    images: p.product_images
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({ id: i.id, url: urls.get(i.storage_path) ?? "", path: i.storage_path, isPrimary: i.is_primary })),
  }));
  const studioModels: StudioModel[] = models.map((m) => ({
    id: m.id, name: m.name, provider_name: m.provider_name, provider_slug: m.provider_slug,
    credit_cost: m.credit_cost, quality_tier: m.quality_tier, speed_tier: m.speed_tier,
    capabilities_ui: {
      resolutions: m.capabilities_ui.resolutions,
      maxQuantity: m.capabilities_ui.maxQuantity,
      supportsReferenceImages: m.capabilities_ui.supportsReferenceImages,
    },
  }));

  return (
    <div>
      <PageHeader title={t("generator.title")} sub={t("studio.sub")} />
      <Studio
        products={studioProducts}
        models={studioModels}
        credits={wallet?.balance ?? 0}
        workspaceId={workspace.id}
        initialPrompt={promptParam?.slice(0, 4000) ?? ""}
      />
    </div>
  );
}
