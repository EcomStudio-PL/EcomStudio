import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { PageEditor } from "@/components/admin/page-editor";
import { ensureLaunchSectionAction } from "@/app/actions/public-pages";
import type { CmsBlockContent } from "@/lib/cms";

export default async function AdminWwwPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);

  const { data: page } = await supabase.from("cms_pages")
    .select("id, slug, title, status, kind, published_at").eq("slug", slug).maybeSingle();
  if (!page) notFound();

  // The launch page is one section; the first time it is opened that section
  // is created from the copy that already existed, so the editor is never
  // blank for a site that was already customised.
  if (page.kind === "launch") await ensureLaunchSectionAction(page.id);

  const { data: blocks } = await supabase.from("cms_blocks")
    .select("id, type, sort_order, visible, content").eq("page_id", page.id).order("sort_order");

  return (
    <div>
      <div className="mb-4">
        <Link href="/admin/www" className="text-sm text-muted transition-colors hover:text-ink">
          ← {t("cms.pagesTitle")}
        </Link>
      </div>
      <PageHeader title={page.title} sub={t("cms.editorSub")} />
      <PageEditor
        pageId={page.id}
        slug={page.slug}
        kind={(page.kind as string | null) ?? "standard"}
        status={page.status}
        publishedAt={page.published_at}
        blocks={(blocks ?? []).map((b) => ({ ...b, content: (b.content ?? {}) as CmsBlockContent }))}
      />
    </div>
  );
}
