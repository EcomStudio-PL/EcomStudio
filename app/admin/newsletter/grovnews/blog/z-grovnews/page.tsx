import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { adminPublicSourceCandidates } from "@/lib/services/grovnews-blog";
import { AdminTable } from "@/components/ui/admin-table";
import { PublicVersionButton } from "@/components/admin/grovnews/blog-actions";

export const dynamic = "force-dynamic";

/** "Utwórz z GrovNews": the published premium posts, each with its public
 *  version or the button that starts one (a DRAFT — never published here). */
export default async function GrovNewsBlogFromPost() {
  const supabase = await createClient();
  const [{ dict, locale }, posts] = await Promise.all([getDictionary(), adminPublicSourceCandidates(supabase)]);
  const t = makeT(dict);
  const date = (iso: string | null) => iso
    ? new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Warsaw" }) : "—";
  return (
    <div className="space-y-4" data-grovnews-blog-from-post>
      <div className="max-w-3xl">
        <h1 className="font-display text-[19px] font-semibold tracking-tight">{t("grovnewsAdm.blog.fromPostTitle")}</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">{t("grovnewsAdm.blog.fromPostHint")}</p>
      </div>
      <AdminTable
        empty={t("grovnewsAdm.blog.noCandidates")}
        headers={[t("grovnewsAdm.colTitle"), t("grovnewsAdm.colCategory"), t("grovnewsAdm.colPublished"), ""]}
        rows={posts.map((p) => [
          p.title,
          p.category ?? "—",
          date(p.publishedAt),
          <PublicVersionButton key="b" postId={p.id} publicId={p.publicId} compact />,
        ])}
      />
    </div>
  );
}
