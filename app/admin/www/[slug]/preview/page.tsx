import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { BlockRenderer } from "@/components/cms/blocks";
import type { CmsBlockContent } from "@/lib/cms";

/** Admin-only draft preview: renders the CURRENT block list (not the
 *  published snapshot). Auth is enforced by the admin layout above. */
export default async function CmsPreview({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const { data: page } = await supabase.from("cms_pages").select("id, title, kind").eq("slug", slug).maybeSingle();
  if (!page) notFound();
  // The launch page is not a stack of blocks — previewing it means seeing the
  // real page, so send the admin to the draft view of "/" itself.
  if (page.kind === "launch") redirect("/?preview=waitlist&draft=1");
  const { data: blocks } = await supabase.from("cms_blocks")
    .select("type, sort_order, visible, content").eq("page_id", page.id).order("sort_order");
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <Link href={`/admin/www/${slug}`} className="text-sm text-muted hover:text-ink">← {page.title}</Link>
        <span className="rounded-full bg-accent2-soft px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent2">
          {t("cms.preview")}
        </span>
      </div>
      <div className="mx-auto max-w-5xl">
        <BlockRenderer
          blocks={(blocks ?? []).map((b) => ({ ...b, content: (b.content ?? {}) as CmsBlockContent }))}
          locale={locale}
          labels={{ before: t("landing.before"), after: t("landing.after"), video: "Video" }}
        />
      </div>
    </div>
  );
}
