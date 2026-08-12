import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace, getProfile } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { listProducts } from "@/lib/services/products";
import { listJobs } from "@/lib/services/generator";
import { Stat } from "@/components/ui/stat";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const [profile, workspace] = await Promise.all([
    getProfile(supabase, user.id),
    getCurrentWorkspace(supabase, user.id),
  ]);
  if (!workspace || !profile) return null;
  const [wallet, products, jobs, gens] = await Promise.all([
    getWallet(supabase, workspace.id),
    listProducts(supabase, workspace.id, 5),
    listJobs(supabase, workspace.id, 5),
    supabase.from("generations").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id),
  ]);
  const firstName = (profile.full_name ?? profile.email).split(" ")[0];

  if (products.length === 0) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <Card className="p-8 text-center">
          <p className="frame-mark mx-auto mb-5 inline-block px-2 font-display text-xs uppercase tracking-[0.2em] text-accent">EcomStudio</p>
          <h1 className="font-display text-2xl font-semibold">{t("dashboard.onbTitle")}</h1>
          <p className="mt-2 text-sm text-muted">{t("dashboard.onbSub")}</p>
          <ol className="mx-auto mt-6 max-w-xs space-y-2 text-left text-sm">
            {[1, 2, 3, 4].map((n) => (
              <li key={n} className="flex items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-raised text-xs font-semibold">{n}</span>
                {t(`dashboard.onb${n}`)}
              </li>
            ))}
          </ol>
          <Link href="/products/new" className="mt-7 brand-gradient inline-flex rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90">
            {t("dashboard.onbCta")}
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">{t("dashboard.welcome", { name: firstName })}</h1>
          <p className="mt-1 text-sm text-muted">{t("dashboard.sub")}</p>
        </div>
        <Link href="/products/new" className="brand-gradient rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90">
          + {t("dashboard.newProduct")}
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label={t("dashboard.statProducts")} value={products.length} />
        <Stat label={t("dashboard.statGenerations")} value={gens.count ?? 0} />
        <Stat label={t("dashboard.statCredits")} value={wallet?.balance ?? 0} accent />
        <Stat label={t("dashboard.statPlan")} value="Free" />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("dashboard.recentProducts")} action={
            <Link href="/products" className="text-sm text-accent">{t("common.viewAll")}</Link>
          } />
          <ul className="divide-y divide-line">
            {products.map((p) => (
              <li key={p.id}>
                <Link href={`/products/${p.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-raised">
                  <span className="truncate text-sm font-medium">{p.name}</span>
                  <Badge>{t(`products.status.${p.status}`)}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title={t("dashboard.recentJobs")} action={
            <Link href="/history" className="text-sm text-accent">{t("common.viewAll")}</Link>
          } />
          {jobs.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">{t("history.emptyBody")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {jobs.map((j) => (
                <li key={j.id} className="flex items-center justify-between px-5 py-3">
                  <span className="truncate text-sm">{j.products?.name ?? "—"}</span>
                  <span className="text-xs text-muted">{formatDate(j.created_at, locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
