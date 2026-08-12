import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { CmsPageEditor } from "@/components/admin/cms-editor";
import type { CmsBlockContent } from "@/lib/cms";

export default async function AdminWwwPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data: page } = await supabase.from("cms_pages").select("*").eq("slug", slug).maybeSingle();
  if (!page) notFound();
  const { data: blocks } = await supabase.from("cms_blocks")
    .select("id, type, sort_order, visible, content").eq("page_id", page.id).order("sort_order");
  return (
    <div>
      <div className="mb-4"><Link href="/admin/www" className="text-sm text-muted hover:text-ink">← {t("cms.title")}</Link></div>
      <PageHeader title={page.title} sub={t("cms.editorSub")} />
      <CmsPageEditor
        pageId={page.id} slug={page.slug} status={page.status} publishedAt={page.published_at}
        blocks={(blocks ?? []).map((b) => ({ ...b, content: (b.content ?? {}) as CmsBlockContent }))}
        isEmpty={(blocks ?? []).length === 0}
      />
    </div>
  );
}
