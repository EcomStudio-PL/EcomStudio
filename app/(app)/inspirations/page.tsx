import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { InspirationGallery, type InspirationCard } from "@/components/inspirations/gallery";

export default async function InspirationsPage() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const { data } = await supabase.from("inspirations")
    .select("id, title, description, category, prompt, negative_prompt, model_slug, format, tags, premium, featured, before_url, after_urls, video_url, locale")
    .eq("status", "published")
    .order("featured", { ascending: false }).order("sort_order").limit(200);
  const items = (data ?? []).filter((i) => !i.locale || i.locale === locale) as InspirationCard[];
  const categories = [...new Set(items.map((i) => i.category))];
  return (
    <div>
      <PageHeader title={t("insp.title")} sub={t("insp.sub")} />
      <InspirationGallery items={items} categories={categories} />
    </div>
  );
}
