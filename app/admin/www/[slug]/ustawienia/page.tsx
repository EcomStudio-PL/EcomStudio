import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { PageSettings } from "@/components/admin/cms/page-settings";
import { getPage, listBlocks } from "@/lib/services/cms";
import { lt } from "@/lib/cms";

export default async function PageSettingsRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const page = await getPage(supabase, slug);
  if (!page) notFound();

  // Only the three facts the SEO checklist asks about. Sending whole blocks
  // to a client component would ship the page's content into a settings form
  // that has no use for it.
  const blocks = (await listBlocks(supabase, page.id)).map((b) => {
    const urls = [b.content?.mediaUrl, b.content?.media2Url].filter(Boolean).length
      + (b.content?.items ?? []).filter((it) => it.mediaUrl).length;
    const alts = (lt(b.content?.alt, "pl") ? 1 : 0)
      + (b.content?.items ?? []).filter((it) => it.mediaUrl && lt(it.alt, "pl")).length;
    return {
      type: b.type,
      hasHeading: Boolean(lt(b.content?.title, "pl")),
      images: urls,
      alts,
    };
  });
  const { dict } = await getDictionary();
  const t = makeT(dict);

  return (
    <div>
      <PageHeader overline={t("cms.pagesTitle")} title={t("cms.pageSettings")} sub={t("cms.pageSettingsSub")} />
      <PageSettings page={page} blocks={blocks} />
    </div>
  );
}
