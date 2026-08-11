import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { ProductForm } from "@/components/products/product-form";

export default async function NewProductPage() {
  const { dict } = await getDictionary();
  const t = makeT(dict);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("products.new")} />
      <Card className="p-6"><ProductForm /></Card>
    </div>
  );
}
