import Link from "next/link";
import Image from "next/image";
import { Box, ImageIcon, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { listProducts } from "@/lib/services/products";
import { signImageUrls } from "@/lib/services/images";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { BrowserFilters } from "@/components/products/browser-filters";
import { ImportButton } from "@/components/products/import-button";

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
  const filtering = Boolean(q || status);

  return (
    <div>
      <PageHeader
        overline={t("nav.groups.work")}
        title={t("products.title")}
        sub={t("products.sub")}
        action={
          <div className="flex w-full gap-2 sm:w-auto">
            <ImportButton />
            <Link href="/products/new"
              className="cta inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold sm:flex-none">
              <Plus size={16} aria-hidden />
              {t("products.new")}
            </Link>
          </div>
        }
      />

      <BrowserFilters statuses={STATUSES.map((s) => ({ value: s, label: t(`products.status.${s}`) }))} />

      {products.length === 0 ? (
        <EmptyState
          icon={Box}
          title={filtering ? t("common.search") : t("products.emptyTitle")}
          body={filtering ? undefined : t("products.emptyBody")}
          action={
            <Link href="/products/new"
              className="cta inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-semibold">
              <Plus size={16} aria-hidden />
              {t("products.new")}
            </Link>
          }
        />
      ) : (
        <div className="stagger grid gap-3.5 [&>*]:min-w-0 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => {
            const thumb = (p.product_images.find((i) => i.is_primary) ?? p.product_images[0])?.storage_path;
            const url = thumb ? urls.get(thumb) : undefined;
            const photos = p.product_images.length;
            return (
              <Link key={p.id} href={`/products/${p.id}`}
                className="panel panel-interactive group flex flex-col overflow-hidden rounded-2xl">
                {/* Media plate: the product is the hero, metadata floats over it. */}
                <div className="relative aspect-[4/3] overflow-hidden bg-sunken">
                  {url ? (
                    <Image src={url} alt={p.name} fill sizes="(max-width:640px) 100vw, 33vw"
                      className="object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-1.5 text-faint">
                      <ImageIcon size={22} aria-hidden />
                      <span className="text-[11px] font-medium">{t("common.noPhotos")}</span>
                    </div>
                  )}
                  <div aria-hidden className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/55 to-transparent opacity-90" />
                  <div className="absolute inset-x-3 bottom-2.5 flex items-end justify-between gap-2">
                    <Badge tone={p.status === "ready" ? "green" : "neutral"} dot
                      className="backdrop-blur-md">
                      {t(`products.status.${p.status}`)}
                    </Badge>
                    {photos > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-md">
                        <ImageIcon size={10} aria-hidden />
                        {photos}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-center px-4 py-3">
                  <h3 className="truncate text-sm font-semibold tracking-tight">{p.name}</h3>
                  <p className="mt-0.5 truncate text-[11px] text-faint">
                    {p.category ?? "—"}{p.marketplace ? ` · ${t(`products.mp.${p.marketplace}`)}` : ""}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
