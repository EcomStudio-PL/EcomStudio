import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { CommTabs } from "@/components/admin/comm-tabs";

/**
 * The module shell: one header, one tab strip, and whichever tab was asked
 * for underneath. The heading belongs here rather than in each page so the
 * four tabs cannot drift into four differently-titled screens again.
 *
 * Role is already enforced by app/admin/layout.tsx above this one, and every
 * server action underneath re-checks it; nothing here is a security boundary.
 */
export default async function CommunicationLayout({ children }: { children: React.ReactNode }) {
  const { dict } = await getDictionary();
  const t = makeT(dict);

  return (
    <div>
      <PageHeader
        overline={t("admin.navGroups.clients")}
        title={t("comm.moduleTitle")}
        sub={t("comm.moduleSub")}
      />
      <CommTabs />
      {children}
    </div>
  );
}
