import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet, getTransactions } from "@/lib/services/credits";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreditPacks, type CreditPack } from "@/components/plan/credit-packs";
import { creditLevel, CREDIT_METER_CLASS, CREDIT_REFERENCE } from "@/lib/credit-level";
import { formatCredits, formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CreditsPage() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) redirect("/home");
  const wallet = await getWallet(supabase, workspace.id);
  const [txs, { data: packages }] = await Promise.all([
    wallet ? getTransactions(supabase, wallet.id) : Promise.resolve([]),
    supabase.from("credit_packages").select("*").eq("active", true).order("sort_order"),
  ]);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const usedThisMonth = txs
    .filter((tx) => tx.amount < 0 && new Date(tx.created_at) >= monthStart)
    .reduce((s, tx) => s + Math.abs(tx.amount), 0);
  const byType = txs.reduce<Record<string, number>>((acc, tx) => {
    if (tx.amount < 0) acc[tx.type] = (acc[tx.type] ?? 0) + Math.abs(tx.amount);
    return acc;
  }, {});

  const balance = wallet?.balance ?? 0;
  const level = creditLevel(balance);
  const packs: CreditPack[] = (packages ?? []).map((p) => ({
    id: p.id, name: p.name, credits: p.credits, bonusCredits: p.bonus_credits,
    priceCents: p.price_cents, currency: p.currency, featured: p.featured, badge: p.badge,
  }));

  return (
    <div>
      <PageHeader overline={t("nav.groups.account")} title={t("credits.title")} sub={t("credits.sub")} />

      {/* BALANCE — one wide panel with the meter, then the two usage facts. */}
      <div className="grid gap-3.5 [&>*]:min-w-0 lg:grid-cols-[1.6fr_1fr_1fr]">
        <Card className="relative overflow-hidden p-5 sm:p-6">
          <span aria-hidden className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(24rem 12rem at 8% -20%, rgb(var(--accent) / 0.20), transparent 70%)" }} />
          <p className="overline relative">{t("credits.balance")}</p>
          <p className="metric relative mt-2 text-[clamp(2.1rem,1.4rem+1.6vw,3rem)] leading-none text-accent">
            {formatCredits(balance)}
          </p>
          <span className="relative mt-4 block h-[5px] w-full max-w-md overflow-hidden rounded-full bg-[rgb(var(--ink)/0.12)]">
            <span className={cn("block h-full rounded-full transition-[width] duration-300", CREDIT_METER_CLASS[level])}
              style={{ width: `${Math.max(4, Math.min(1, balance / CREDIT_REFERENCE) * 100)}%` }} />
          </span>
        </Card>
        <Card className="px-5 py-4">
          <p className="overline">{t("credits.usedThisMonth")}</p>
          <p className="metric mt-2 text-[1.6rem] leading-none">{formatCredits(usedThisMonth)}</p>
        </Card>
        <Card className="px-5 py-4">
          <p className="overline">{t("credits.usageBreakdown")}</p>
          {Object.keys(byType).length === 0 ? (
            <p className="mt-2 text-sm text-muted">—</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {Object.entries(byType).map(([type, amount]) => (
                <li key={type} className="flex justify-between gap-2">
                  <span className="truncate text-muted">{t(`credits.tt.${type}`)}</span>
                  <span className="shrink-0 font-medium tabular-nums">{formatCredits(amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <section className="mt-7">
        <SectionHeader overline={t("nav.groups.account")} title={t("packs.title")} sub={t("packs.sub")} className="mb-4" />
        <CreditPacks packs={packs} />
      </section>

      <Card className="mt-7">
        <CardHeader title={t("credits.historyTitle")} />
        {txs.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">{t("credits.emptyTitle")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {txs.map((tx) => (
              <li key={tx.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{t(`credits.tt.${tx.type}`)}</p>
                  <p className="truncate text-xs text-muted">
                    {tx.description ?? ""} · {formatDate(tx.created_at, locale)}
                  </p>
                </div>
                <Badge tone={tx.amount >= 0 ? "green" : "red"}>
                  {tx.amount >= 0 ? "+" : ""}{tx.amount}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
