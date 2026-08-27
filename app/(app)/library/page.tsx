import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { listAssets, listJobs } from "@/lib/services/generator";
import { listProducts } from "@/lib/services/products";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { AdminTable } from "@/components/ui/admin-table";
import { Badge } from "@/components/ui/badge";
import { LibraryGrid, type LibraryCard } from "@/components/library/library-grid";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const JOB_TONE = { queued: "neutral", processing: "blue", completed: "green", failed: "red", cancelled: "neutral" } as const;

/**
 * BIBLIOTEKA — the one destination for everything the account produced
 * (UX spec §6): a grid of generations with hover preview and multi-select
 * ZIP download, the tool outputs on their own shelf, filters by product,
 * and HISTORIA as a tab instead of a separate application area.
 */
export default async function LibraryPage({ searchParams }: {
  searchParams: Promise<{ tab?: string; product?: string }>;
}) {
  const { tab: tabParam, product: productFilter } = await searchParams;
  const tab = tabParam === "history" ? "history"
    : tabParam === "tools" ? "tools"
      : tabParam === "favorites" ? "favorites" : "all";
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) redirect("/home");

  const [generations, products, jobs, { data: toolResults }] = await Promise.all([
    listAssets(supabase, workspace.id),
    listProducts(supabase, workspace.id, 100),
    tab === "history" ? listJobs(supabase, workspace.id) : Promise.resolve([]),
    supabase.from("tool_results")
      .select("id, tool_slug, storage_path, created_at")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(60),
  ]);

  const byProduct = productFilter
    ? generations.filter((g) => g.product_id === productFilter)
    : generations;
  const filtered = tab === "favorites" ? byProduct.filter((g) => g.favorite) : byProduct;

  const paths = [
    ...filtered.flatMap((g) => g.generation_assets.map((a) => a.storage_path)),
    ...(toolResults ?? []).map((r) => r.storage_path),
  ];
  const urlMap = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from("generation-assets").createSignedUrls(paths, 3600);
    signed?.forEach((s) => { if (s.signedUrl && s.path) urlMap.set(s.path, s.signedUrl); });
  }

  const cards: LibraryCard[] = filtered.map((g) => ({
    id: g.id,
    product: g.products?.name ?? null,
    created: g.created_at,
    favorite: g.favorite,
    assets: g.generation_assets.map((a) => ({ id: a.id, path: a.storage_path, url: urlMap.get(a.storage_path) ?? null })),
  }));

  // Counts on the tabs: the user can see where their work actually is
  // before clicking through four empty shelves.
  const tabs = [
    { key: "all", href: "/library", label: t("library.tabAll"), count: generations.length },
    { key: "favorites", href: "/library?tab=favorites", label: t("library.tabFavorites"), count: generations.filter((g) => g.favorite).length },
    { key: "tools", href: "/library?tab=tools", label: t("library.tabTools"), count: (toolResults ?? []).length },
    { key: "history", href: "/library?tab=history", label: t("library.tabHistory"), count: tab === "history" ? jobs.length : null },
  ];

  // Product filter — products become a Library dimension, per the spec.
  const usedProductIds = new Set(generations.map((g) => g.product_id).filter(Boolean));
  const filterableProducts = products.filter((p) => usedProductIds.has(p.id));

  return (
    <div>
      <PageHeader overline={t("nav.groups.assets")} title={t("library.title")} sub={t("library.sub")} />

      {/* TABS + FILTERS */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-stretch gap-1 rounded-xl border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*0.8))] bg-sunken/80 p-1">
          {tabs.map((tb) => (
            <Link key={tb.key} href={tb.href}
              aria-current={tab === tb.key ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-all duration-200",
                tab === tb.key ? "bg-surface text-ink shadow-e2 ring-1 ring-[rgb(var(--accent)/0.45)]" : "text-muted hover:text-ink",
              )}>
              {tb.label}
              {typeof tb.count === "number" && tb.count > 0 && (
                <span className={cn("rounded-full px-1.5 text-[10px] font-bold tabular-nums",
                  tab === tb.key ? "bg-[rgb(var(--accent)/0.18)] text-accent" : "bg-raised text-faint")}>
                  {tb.count}
                </span>
              )}
            </Link>
          ))}
        </div>
        {(tab === "all" || tab === "favorites") && filterableProducts.length > 0 && (
          <div className="flex max-w-full items-center gap-1.5 overflow-x-auto">
            <Link href="/library"
              className={cn("shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors",
                !productFilter ? "bg-[rgb(var(--accent)/0.16)] text-ink ring-1 ring-[rgb(var(--accent)/0.4)]" : "plate text-muted hover:text-ink")}>
              {t("library.allProducts")}
            </Link>
            {filterableProducts.slice(0, 8).map((p) => (
              <Link key={p.id} href={`/library?product=${p.id}`}
                className={cn("max-w-[12rem] shrink-0 truncate rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors",
                  productFilter === p.id ? "bg-[rgb(var(--accent)/0.16)] text-ink ring-1 ring-[rgb(var(--accent)/0.4)]" : "plate text-muted hover:text-ink")}>
                {p.name}
              </Link>
            ))}
          </div>
        )}
      </div>

      {tab === "history" ? (
        jobs.length === 0 ? (
          <EmptyState title={t("history.emptyTitle")} body={t("history.emptyBody")} />
        ) : (
          <AdminTable
            headers={[t("history.product"), t("common.type"), t("common.status"), t("history.creditsCol"), t("common.date")]}
            empty={t("history.emptyBody")}
            rows={jobs.map((j) => [
              j.products?.name ?? "—",
              j.material_type ? t(`generator.mt.${j.material_type}`) : "—",
              <Badge key="s" tone={JOB_TONE[j.status as keyof typeof JOB_TONE] ?? "neutral"} dot>{t(`history.st.${j.status}`)}</Badge>,
              <span key="c" className="tabular-nums">{j.credits_charged}</span>,
              <span key="d" className="text-muted">{formatDate(j.created_at, locale)}</span>,
            ])}
          />
        )
      ) : tab === "tools" ? (
        (toolResults ?? []).length === 0 ? (
          <EmptyState title={t("library.emptyTitle")} body={t("library.emptyBody")} />
        ) : (
          <div className="grid grid-cols-2 gap-2 [&>*]:min-w-0 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
            {(toolResults ?? []).map((r) => {
              const url = urlMap.get(r.storage_path);
              return url ? (
                <a key={r.id} href={url} target="_blank" rel="noreferrer noopener"
                  className="panel panel-interactive block overflow-hidden rounded-xl">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" loading="lazy" className="aspect-square w-full bg-checker object-contain" />
                  <p className="truncate px-2 py-1.5 text-[11px] font-medium">{t(`tools.${r.tool_slug}.name`)}</p>
                </a>
              ) : null;
            })}
          </div>
        )
      ) : cards.length === 0 ? (
        <EmptyState title={t("library.emptyTitle")} body={t("library.emptyBody")} />
      ) : (
        <LibraryGrid cards={cards} locale={locale} />
      )}
    </div>
  );
}
