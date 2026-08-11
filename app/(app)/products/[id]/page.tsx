import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getProduct } from "@/lib/services/products";
import { signImageUrls } from "@/lib/services/images";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { ProductForm } from "@/components/products/product-form";
import { ImageManager } from "@/components/products/image-manager";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const product = await getProduct(supabase, id);
  if (!product) notFound();
  const urls = await signImageUrls(supabase, product.product_images.map((i) => i.storage_path));
  const images = product.product_images.map((i) => ({ ...i, url: urls.get(i.storage_path) }));

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={product.name} sub={product.category ?? undefined} />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card className="p-6 lg:order-2 lg:h-fit">
          <ProductForm product={product} />
        </Card>
        <Card className="lg:order-1">
          <CardHeader title={t("products.images")} />
          <div className="p-5">
            <ImageManager productId={product.id} workspaceId={product.workspace_id} images={images} />
          </div>
        </Card>
      </div>
    </div>
  );
}
