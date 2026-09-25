import Link from "next/link";
import { FilePlus2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { POST_STATUSES } from "@/lib/grovnews";
import { adminListPosts } from "@/lib/services/grovnews";
import { Badge } from "@/components/ui/badge";
import { AdminTable } from "@/components/ui/admin-table";
import { PostRowActions } from "@/components/admin/grovnews/post-actions";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Every post, newest edit first, filterable by status. */
export default async function GrovNewsPosts({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: raw } = await searchParams;
  const status = (POST_STATUSES as readonly string[]).includes(raw ?? "") ? raw : undefined;
  const supabase = await createClient();
  const [{ dict, locale }, posts] = await Promise.all([getDictionary(), adminListPosts(supabase, status)]);
  const t = makeT(dict);
  const date = (iso: string | null) => iso
    ? new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Warsaw" }) : "—";
  const filters = [{ key: undefined, label: t("grovnewsAdm.allStatuses") },
    ...POST_STATUSES.map((s) => ({ key: s, label: t(`grovnewsAdm.status.${s}`) }))];
  return (
    <div className="space-y-4" data-grovnews-posts>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="thin-scroll -mx-1 flex gap-1 overflow-x-auto px-1">
          {filters.map((f) => (
            <Link key={f.label} href={f.key ? `/admin/newsletter/grovnews/wpisy?status=${f.key}` : "/admin/newsletter/grovnews/wpisy"}
              aria-current={status === f.key ? "page" : undefined}
              className={cn("inline-flex shrink-0 items-center rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold",
                status === f.key ? "is-selected" : "border-line text-muted hover:bg-raised hover:text-ink")}>
              {f.label}
            </Link>
          ))}
        </div>
        <Link href="/admin/newsletter/grovnews/wpisy/nowy" className="cta inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold">
          <FilePlus2 size={15} aria-hidden />{t("grovnewsAdm.newPost")}
        </Link>
      </div>
      <AdminTable
        empty={t("grovnewsAdm.noPosts")}
        headers={[t("grovnewsAdm.colTitle"), t("grovnewsAdm.colCategory"), t("grovnewsAdm.colStatus"),
          t("grovnewsAdm.colPublished"), t("grovnewsAdm.colAuthor"), t("grovnewsAdm.colRead"), ""]}
        rows={posts.map((p) => [
          <Link key="t" href={`/admin/newsletter/grovnews/wpisy/${p.id}`} className="hover:text-accent">{p.title}</Link>,
          p.category ?? "—",
          <Badge key="s" tone={p.status === "PUBLISHED" ? "success" : p.status === "ARCHIVED" ? "neutral" : "warning"}>{t(`grovnewsAdm.status.${p.status}`)}</Badge>,
          date(p.publishedAt),
          p.author ?? "—",
          t("grovnews.readTime", { n: p.readMinutes }),
          <PostRowActions key="a" id={p.id} status={p.status} />,
        ])}
      />
    </div>
  );
}
