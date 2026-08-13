import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { listProducts } from "@/lib/services/products";
import { signImageUrls } from "@/lib/services/images";
import { toolCatalogue } from "@/lib/server/image-tools";
import { toolBySlug } from "@/lib/images/tools";
import { PageHeader } from "@/components/ui/page-header";
import { ToolWorkbench } from "@/components/tools/workbench";

export const dynamic = "force-dynamic";

export default async function ToolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tool = toolBySlug(slug);
  if (!tool) notFound();

  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return null;

  const [catalogue, wallet, products] = await Promise.all([
    toolCatalogue(supabase),
    getWallet(supabase, workspace.id),
    listProducts(supabase, workspace.id, 200),
  ]);
  const entry = catalogue.find((c) => c.slug === tool.slug)!;

  // Thumbnails for the "attach to product" picker, signed in one round trip.
  const thumbPaths = products
    .map((p) => (p.product_images.find((i) => i.is_primary) ?? p.product_images[0])?.storage_path)
    .filter((v): v is string => !!v);
  const urls = await signImageUrls(supabase, thumbPaths);

  return (
    <div>
      <Link href="/tools"
        className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-ink">
        <ArrowLeft size={14} aria-hidden /> {t("tools.title")}
      </Link>
      <PageHeader
        overline={entry.credits === 0 ? t("tools.free") : t("tools.creditsTotal", { n: entry.credits })}
        title={t(`tools.${tool.slug}.name`)}
        sub={t(`tools.${tool.slug}.body`)}
      />
      <ToolWorkbench
        tool={tool.slug}
        available={entry.available}
        credits={entry.credits}
        providerLabel={entry.providerLabel}
        reason={entry.reason}
        balance={wallet?.balance ?? 0}
        products={products.map((p) => {
          const thumb = (p.product_images.find((i) => i.is_primary) ?? p.product_images[0])?.storage_path;
          return {
            id: p.id, name: p.name, category: p.category, sku: p.sku,
            thumbnail: thumb ? urls.get(thumb) ?? null : null,
            imageCount: p.product_images.length,
          };
        })}
      />
    </div>
  );
}
