import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { InspirationManager } from "@/components/admin/inspiration-editor";
import type { InspirationRow } from "@/components/admin/inspiration-editor";

export default async function AdminInspirations() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data } = await supabase.from("inspirations").select("*")
    .order("featured", { ascending: false }).order("sort_order").limit(300);
  return (
    <div>
      <PageHeader title={t("insp.adminTitle")} sub={t("insp.adminSub")} />
      <InspirationManager items={(data ?? []) as InspirationRow[]} />
    </div>
  );
}
