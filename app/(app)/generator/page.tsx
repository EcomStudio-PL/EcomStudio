import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { listProducts } from "@/lib/services/products";
import { listActiveModels } from "@/lib/services/generator";
import { signImageUrls } from "@/lib/services/images";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { GeneratorWizard } from "@/components/generator/wizard";

export default async function GeneratorPage() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return null;
  const [products, models] = await Promise.all([
    listProducts(supabase, workspace.id),
    listActiveModels(supabase),
  ]);
  const allPaths = products.flatMap((p) => p.product_images.map((i) => i.storage_path));
  const urls = await signImageUrls(supabase, allPaths);
  const data = products.map((p) => ({
    id: p.id,
    name: p.name,
    images: p.product_images
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({ id: i.id, url: urls.get(i.storage_path) ?? "", isPrimary: i.is_primary })),
  }));

  return (
    <div>
      <PageHeader title={t("generator.title")} sub={t("generator.sub")} />
      {products.length === 0 ? (
        <EmptyState title={t("generator.noProducts")} action={
          <Link href="/products/new" className="brand-gradient rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 dark:text-emerald-950">
            + {t("products.new")}
          </Link>
        } />
      ) : (
        <GeneratorWizard products={data} modelCount={models.length} />
      )}
    </div>
  );
}
