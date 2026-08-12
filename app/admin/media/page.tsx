import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { MediaManager } from "@/components/admin/media-manager";

export default async function AdminMedia() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data } = await supabase.from("media_assets").select("*").order("created_at", { ascending: false }).limit(200);
  const assets = (data ?? []).map((a) => ({
    ...a,
    publicUrl: a.storage_path ? supabase.storage.from("media").getPublicUrl(a.storage_path).data.publicUrl : null,
  }));
  return (
    <div>
      <PageHeader title={t("media.title")} sub={t("media.sub")} />
      <MediaManager assets={assets} />
    </div>
  );
}
