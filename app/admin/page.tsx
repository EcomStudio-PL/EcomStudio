import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { adminCounts } from "@/lib/services/admin";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

function DayBars({ days, label, tone = "accent" }: {
  days: { day: string; count: number }[]; label: string; tone?: "accent" | "accent2";
}) {
  const max = Math.max(...days.map((d) => d.count), 1);
  const bar = tone === "accent2" ? "bg-accent2/70 group-hover:bg-accent2" : "bg-accent/80 group-hover:bg-accent";
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">{label}</p>
      <div className="flex h-16 items-end gap-1.5">
        {days.map((d) => (
          <div key={d.day} className="group flex flex-1 flex-col items-center gap-1" title={`${d.day}: ${d.count}`}>
            <div
              className={`w-full rounded-sm transition-colors ${bar}`}
              style={{ height: `${Math.max((d.count / max) * 100, 4)}%` }}
            />
            <span className="text-[10px] text-faint">{d.day.slice(8)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function groupByDay(rows: { created_at: string }[], days = 7) {
  const out: { day: string; count: number }[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, count: rows.filter((r) => r.created_at.slice(0, 10) === key).length });
  }
  return out;
}

export default async function AdminDashboard() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const [counts, wallets, failed, activeModels, providers, recentJobs, recentUsers, recent] = await Promise.all([
    adminCounts(supabase),
    supabase.from("credit_wallets").select("balance"),
    supabase.from("generation_jobs").select("id", { count: "exact", head: true }).eq("status", "failed"),
    supabase.from("ai_models").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("ai_providers").select("name, slug, active"),
    supabase.from("generation_jobs").select("created_at").gte("created_at", since),
    supabase.from("profiles").select("created_at").gte("created_at", since),
    supabase.from("activity_logs").select("id, action, created_at").order("created_at", { ascending: false }).limit(10),
  ]);
  const creditsAvailable = (wallets.data ?? []).reduce((s, w) => s + w.balance, 0);

  return (
    <div>
      <PageHeader title={t("admin.title")} />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label={t("admin.statUsers")} value={counts.users} />
        <Stat label={t("admin.statProducts")} value={counts.products} />
        <Stat label={t("admin.statJobs")} value={counts.jobs} />
        <Stat label={t("admin.statFailed")} value={failed.count ?? 0} />
        <Stat label={t("admin.statCreditsUsed")} value={counts.creditsUsed} />
        <Stat label={t("admin.statCreditsAvailable")} value={creditsAvailable} accent />
        <Stat label={t("admin.statActiveModels")} value={activeModels.count ?? 0} />
        <Card className="px-4 py-3">
          <p className="truncate text-xs font-medium text-muted">{t("admin.nav.providers")}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {(providers.data ?? []).map((p) => (
              <Badge key={p.slug} tone={p.active ? "green" : "neutral"}>{p.name}</Badge>
            ))}
          </div>
        </Card>
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <DayBars days={groupByDay(recentJobs.data ?? [])} label={t("admin.chartGenerations")} />
        </Card>
        <Card className="p-5">
          <DayBars days={groupByDay(recentUsers.data ?? [])} label={t("admin.chartNewUsers")} tone="accent2" />
        </Card>
      </div>
      <Card className="mt-5">
        <CardHeader title={t("admin.recent")} />
        {(recent.data ?? []).length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">{t("admin.noData")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {(recent.data ?? []).map((r) => (
              <li key={r.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <code className="text-xs">{r.action}</code>
                <span className="text-xs text-muted">{formatDate(r.created_at, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
