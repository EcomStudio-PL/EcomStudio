import Link from "next/link";
import { FilePlus2, Newspaper } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { POST_STATUSES } from "@/lib/grovnews";
import { adminListPublicArticles } from "@/lib/services/grovnews-blog";
import { Badge } from "@/components/ui/badge";
import { AdminTable } from "@/components/ui/admin-table";
import { BlogRowActions } from "@/components/admin/grovnews/blog-actions";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Blog / SEO — every PUBLIC article, newest edit first, by status. These are
 *  separate documents from the premium posts; publishing one puts it on /blog. */
export default async function GrovNewsBlog({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: raw } = await searchParams;
  const status = (POST_STATUSES as readonly string[]).includes(raw ?? "") ? raw : undefined;
  const supabase = await createClient();
  const [{ dict, locale }, articles] = await Promise.all([getDictionary(), adminListPublicArticles(supabase, status)]);
  const t = makeT(dict);
  const date = (iso: string | null) => iso
    ? new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Warsaw" }) : "—";
  const filters = [{ key: undefined, label: t("grovnewsAdm.allStatuses") },
    ...POST_STATUSES.map((s) => ({ key: s, label: t(`grovnewsAdm.status.${s}`) }))];
  return (
    <div className="space-y-4" data-grovnews-blog>
      <p className="max-w-3xl text-[13px] leading-relaxed text-muted">{t("grovnewsAdm.blog.intro")}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="thin-scroll -mx-1 flex gap-1 overflow-x-auto px-1">
          {filters.map((f) => (
            <Link key={f.label} href={f.key ? `/admin/newsletter/grovnews/blog?status=${f.key}` : "/admin/newsletter/grovnews/blog"}
              aria-current={status === f.key ? "page" : undefined}
              className={cn("inline-flex shrink-0 items-center rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold",
                status === f.key ? "is-selected" : "border-line text-muted hover:bg-raised hover:text-ink")}>
              {f.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/newsletter/grovnews/blog/z-grovnews"
            className="plate inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold text-ink hover:bg-raised">
            <Newspaper size={15} aria-hidden />{t("grovnewsAdm.blog.fromPost")}
          </Link>
          <Link href="/admin/newsletter/grovnews/blog/nowy" className="cta inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold">
            <FilePlus2 size={15} aria-hidden />{t("grovnewsAdm.blog.newArticle")}
          </Link>
        </div>
      </div>
      <AdminTable
        empty={t("grovnewsAdm.blog.noArticles")}
        headers={[t("grovnewsAdm.colTitle"), t("grovnewsAdm.blog.colSource"), t("grovnewsAdm.colCategory"),
          t("grovnewsAdm.colStatus"), t("grovnewsAdm.colPublished"), t("grovnewsAdm.blog.colSeo"), ""]}
        rows={articles.map((a) => [
          <Link key="t" href={`/admin/newsletter/grovnews/blog/${a.id}`} className="hover:text-accent">{a.title}</Link>,
          a.source
            ? <Link key="s" href={`/admin/newsletter/grovnews/wpisy/${a.source.id}`} className="text-muted hover:text-accent">{a.source.title}</Link>
            : "—",
          a.category ?? "—",
          <Badge key="st" tone={a.status === "PUBLISHED" ? "success" : a.status === "ARCHIVED" ? "neutral" : "warning"}>{t(`grovnewsAdm.status.${a.status}`)}</Badge>,
          date(a.publishedAt),
          <span key="seo" className="inline-flex flex-wrap items-center gap-1">
            <Badge tone={a.seo.ok === a.seo.total ? "success" : "warning"}>{t("grovnewsAdm.blog.seoScore", { ok: a.seo.ok, total: a.seo.total })}</Badge>
            {a.noindex && <Badge tone="neutral">{t("grovnewsAdm.blog.noindexBadge")}</Badge>}
          </span>,
          <BlogRowActions key="a" id={a.id} status={a.status} />,
        ])}
      />
    </div>
  );
}
