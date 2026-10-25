import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { CmsNav } from "@/components/admin/cms/cms-nav";
import { FaqEditorScope } from "@/components/admin/faq/faq-editor-scope";
import { faqDeleted, listFaqAdmin } from "@/lib/services/faq";
import { premiereState } from "@/lib/server/pricing-offer";

export const dynamic = "force-dynamic";

/**
 * STRONY WWW → FAQ (FAQ V1) — the one base of questions /faq, /plany and
 * /o-nas read. The same editor as the "FAQ" panel of "Edytuj stronę"
 * (components/admin/faq/faq-manager.tsx), whose words live in the editor's
 * own namespace — FaqEditorScope asks for it, the way the visual editor's
 * gate does.
 * The admin layout has already refused anyone who is not an admin; RLS
 * refuses them again on every read and write.
 */
export default async function AdminFaq() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const initial = await listFaqAdmin(supabase)
    .then(async (data) => ({
      ...data,
      deleted: await faqDeleted(supabase, { items: data.items.map((i) => i.id), categories: data.categories.map((c) => c.id) }),
      premiere: premiereState(Date.now()).status === "active",
    }))
    .catch(() => null);

  return (
    <div>
      <PageHeader overline={t("admin.navGroups.marketing")} title={t("cms.faqAdminTitle")} sub={t("cms.faqAdminSub")} />
      <CmsNav />
      {initial
        ? <FaqEditorScope initial={initial} />
        : <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">{t("cms.faqAdminUnavailable")}</p>}
    </div>
  );
}
