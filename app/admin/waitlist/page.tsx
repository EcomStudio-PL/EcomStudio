import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { WaitlistManager, type WaitlistRow } from "@/components/admin/waitlist-manager";
import { CalendarDays, CalendarRange, Clock, Users } from "lucide-react";

const PAGE_SIZE = 50;

export default async function AdminWaitlist({ searchParams }: {
  searchParams: Promise<{ q?: string; status?: string; sort?: string; page?: string }>;
}) {
  const { q, status, sort, page: pageParam } = await searchParams;
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);

  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;

  let query = supabase
    .from("waitlist_subscribers")
    .select("id, email, status, source, locale, created_at", { count: "exact" });
  if (q) query = query.ilike("email", `%${q.replace(/[%_]/g, "")}%`);
  if (status === "pending" || status === "confirmed" || status === "unsubscribed") {
    query = query.eq("status", status);
  }
  query = sort === "email"
    ? query.order("email", { ascending: true })
    : query.order("created_at", { ascending: sort === "old" });

  const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const counted = (n: number | null) => n ?? 0;
  const [list, all, today, d7, d30] = await Promise.all([
    query.range(from, from + PAGE_SIZE - 1),
    supabase.from("waitlist_subscribers").select("id", { count: "exact", head: true }),
    supabase.from("waitlist_subscribers").select("id", { count: "exact", head: true })
      .gte("created_at", startOfToday.toISOString()),
    supabase.from("waitlist_subscribers").select("id", { count: "exact", head: true })
      .gte("created_at", since(7)),
    supabase.from("waitlist_subscribers").select("id", { count: "exact", head: true })
      .gte("created_at", since(30)),
  ]);

  const total = counted(list.count);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        overline={t("admin.navGroups.marketing")}
        title={t("launchAdmin.waitlistTitle")}
        sub={t("launchAdmin.waitlistSub")}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("launchAdmin.kpiTotal")} value={counted(all.count)} icon={Users} tone="accent" />
        <Stat label={t("launchAdmin.kpiToday")} value={counted(today.count)} icon={Clock} tone="violet" />
        <Stat label={t("launchAdmin.kpi7")} value={counted(d7.count)} icon={CalendarDays} tone="indigo" />
        <Stat label={t("launchAdmin.kpi30")} value={counted(d30.count)} icon={CalendarRange} tone="purple" />
      </div>

      <WaitlistManager
        rows={(list.data ?? []) as WaitlistRow[]}
        page={page}
        pages={pages}
        total={total}
      />
    </div>
  );
}
