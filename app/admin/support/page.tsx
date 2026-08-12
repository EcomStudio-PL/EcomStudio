import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export default async function AdminSupport() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const { data: threads } = await supabase.from("support_threads")
    .select("id, subject, status, last_message_at, profiles(email, full_name)")
    .order("status").order("last_message_at", { ascending: false }).limit(100);
  return (
    <div>
      <PageHeader title={t("chat.adminTitle")} sub={t("chat.adminSub")} />
      {(threads ?? []).length === 0 ? (
        <div className="panel rounded-2xl p-10 text-center">
          <p className="text-sm font-semibold">{t("chat.noThreads")}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {(threads ?? []).map((th) => (
            <li key={th.id}>
              <Link href={`/admin/support/${th.id}`}
                className="panel panel-interactive flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{th.subject}</p>
                  <p className="truncate text-xs text-muted">{th.profiles?.full_name ?? th.profiles?.email}</p>
                </div>
                <Badge tone={th.status === "open" ? "green" : "neutral"}>{t(`chat.st.${th.status}`)}</Badge>
                <span className="text-xs text-muted">{formatDate(th.last_message_at, locale)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
