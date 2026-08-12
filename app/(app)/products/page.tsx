import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { listProducts } from "@/lib/services/products";
import { signImageUrls } from "@/lib/services/images";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { FilterBar } from "@/components/ui/filter-bar";

const STATUSES = ["draft", "ready", "processing", "completed", "archived"];

export default async function ProductsPage({ searchParams }: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { q, status } = await searchParams;
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return null;
  const products = await listProducts(supabase, workspace.id, 100, { q, status });
  const thumbPaths = products
    .map((p) => (p.product_images.find((i) => i.is_primary) ?? p.product_images[0])?.storage_path)
    .filter((v): v is string => !!v);
  const urls = await signImageUrls(supabase, thumbPaths);

  return (
    <div>
      <PageHeader title={t("products.title")} sub={t("products.sub")} action={
        <Link href="/products/new" className="brand-gradient rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90">
          + {t("products.new")}
        </Link>
      } />
      <FilterBar filters={[{
        param: "status",
        labelKey: "common.status",
        options: STATUSES.map((s) => ({ value: s, label: t(`products.status.${s}`) })),
      }]} />
      {products.length === 0 ? (
        <EmptyState title={t("products.emptyTitle")} body={t("products.emptyBody")} action={
          <Link href="/products/new" className="brand-gradient rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90">
            + {t("products.new")}
          </Link>
        } />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => {
            const thumb = (p.product_images.find((i) => i.is_primary) ?? p.product_images[0])?.storage_path;
            const url = thumb ? urls.get(thumb) : undefined;
            return (
              <Link key={p.id} href={`/products/${p.id}`}
                className="group overflow-hidden rounded-2xl border border-line bg-surface transition hover:border-accent/50 hover:shadow-md">
                <div className="relative aspect-[4/3] bg-raised">
                  {url ? (
                    <Image src={url} alt={p.name} fill sizes="(max-width:640px) 100vw, 33vw" className="object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-3xl text-muted">◨</div>
                  )}
                </div>
                <div className="flex items-start justify-between gap-2 p-4">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold">{p.name}</h3>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {p.category ?? "—"}{p.marketplace ? ` · ${t(`products.mp.${p.marketplace}`)}` : ""}
                    </p>
                  </div>
                  <Badge>{t(`products.status.${p.status}`)}</Badge>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
