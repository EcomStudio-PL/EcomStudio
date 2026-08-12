import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export default async function AdminWww() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const { data: pages } = await supabase.from("cms_pages").select("*").order("created_at");
  return (
    <div>
      <PageHeader title={t("cms.title")} sub={t("cms.sub")} />
      <ul className="space-y-2">
        {(pages ?? []).map((p) => (
          <li key={p.id}>
            <Link href={`/admin/www/${p.slug}`}
              className="panel panel-interactive flex flex-wrap items-center gap-3 rounded-2xl px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{p.title}</p>
                <code className="text-xs text-faint">/{p.slug === "home" ? "" : p.slug}</code>
              </div>
              <Badge tone={p.status === "published" ? "green" : "amber"}>
                {p.status === "published" ? t("cms.published") : t("cms.draft")}
              </Badge>
              {p.published_at && <span className="text-xs text-muted">{formatDate(p.published_at, locale)}</span>}
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted">{t("cms.note")}</p>
    </div>
  );
}
