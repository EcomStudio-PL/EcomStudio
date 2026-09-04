import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { SiteSettings } from "@/components/admin/site-settings";
import { getHomepageMode } from "@/lib/server/launch-page";
import { getPublicSite } from "@/lib/server/public-site";
import { formatDate } from "@/lib/utils";

/**
 * STRONY WWW — every public page in one list.
 *
 * This screen replaced three menu entries that all edited the public site:
 * the homepage mode switch, the block CMS and the separate launch-page
 * editor. They were the same job seen from three angles.
 */
export default async function AdminWww() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);

  const [{ data: pages }, mode, site] = await Promise.all([
    supabase.from("cms_pages").select("id, slug, title, status, kind, sort_order, published_at")
      .order("sort_order").order("created_at"),
    getHomepageMode(supabase),
    getPublicSite(supabase),
  ]);

  return (
    <div>
      <PageHeader
        overline={t("admin.navGroups.marketing")}
        title={t("cms.pagesTitle")}
        sub={t("cms.pagesSub")}
      />

      <SiteSettings mode={mode} instagramUrl={site.instagramUrl} facebookUrl={site.facebookUrl} />

      <ul className="space-y-2" data-page-list>
        {(pages ?? []).map((p) => {
          const isHomeSlot = p.slug === "home" ? mode === "full" : p.kind === "launch" && mode === "waitlist";
          // A launch page has no URL of its own — it answers "/" when it is
          // the active homepage, and is unreachable otherwise.
          const isLaunch = p.kind === "launch";
          const publicPath = p.slug === "home" || isLaunch ? "/" : `/${p.slug}`;
          const hasPublicUrl = isLaunch ? mode === "waitlist" : p.status === "published";
          return (
            <li key={p.id} className="panel rounded-2xl" data-page-row={p.slug}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {p.title}
                    {isHomeSlot && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft/50 px-2 py-0.5 text-[11px] font-semibold text-accent">
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
                        {t("cms.activeBadge")}
                      </span>
                    )}
                  </p>
                  <code className="text-[11.5px] text-faint">{publicPath}</code>
                </div>
                <Badge tone={p.status === "published" ? "green" : "amber"}>
                  {p.status === "published" ? t("cms.published") : t("cms.draft")}
                </Badge>
                {p.published_at && (
                  <span className="hidden text-[12px] text-muted sm:inline">
                    {formatDate(p.published_at, locale)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 border-t border-line px-2 py-2 sm:px-3">
                <Link href={`/admin/www/${p.slug}`}
                  className="inline-flex h-9 items-center rounded-lg px-3 text-[13px] font-semibold text-accent transition-colors hover:bg-raised">
                  {t("common.edit")}
                </Link>
                <a href={`/admin/www/${p.slug}/preview`} target="_blank" rel="noreferrer"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-muted transition-colors hover:bg-raised hover:text-ink">
                  {t("cms.preview")}<ExternalLink size={12} aria-hidden />
                </a>
                {hasPublicUrl && (
                  <a href={publicPath} target="_blank" rel="noreferrer"
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-muted transition-colors hover:bg-raised hover:text-ink">
                    {t("cms.openPublic")}<ExternalLink size={12} aria-hidden />
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-[12px] leading-relaxed text-muted">{t("cms.note")}</p>
    </div>
  );
}
