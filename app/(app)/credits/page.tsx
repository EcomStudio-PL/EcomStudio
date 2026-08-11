import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet, getTransactions } from "@/lib/services/credits";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCredits, formatDate } from "@/lib/utils";

export default async function CreditsPage() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return null;
  const wallet = await getWallet(supabase, workspace.id);
  const txs = wallet ? await getTransactions(supabase, wallet.id) : [];
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

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("credits.title")} sub={t("credits.sub")} />
      <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <p className="text-sm text-muted">{t("credits.balance")}</p>
          <p className="font-display text-4xl font-semibold tracking-tight text-accent">
            {formatCredits(wallet?.balance ?? 0)}
          </p>
        </div>
        <div className="text-right">
          <button disabled className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-muted opacity-60">
            {t("credits.topup")}
          </button>
          <p className="mt-1.5 text-xs text-muted">{t("credits.topupSoon")}</p>
        </div>
      </Card>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Card className="px-5 py-4">
          <p className="text-sm text-muted">{t("credits.usedThisMonth")}</p>
          <p className="mt-1 font-display text-2xl font-semibold tracking-tight">{formatCredits(usedThisMonth)}</p>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-sm text-muted">{t("credits.usageBreakdown")}</p>
          {Object.keys(byType).length === 0 ? (
            <p className="mt-1 text-sm text-muted">—</p>
          ) : (
            <ul className="mt-1.5 space-y-1 text-sm">
              {Object.entries(byType).map(([type, amount]) => (
                <li key={type} className="flex justify-between">
                  <span>{t(`credits.tt.${type}`)}</span>
                  <span className="font-medium">{formatCredits(amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card className="mt-5">
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
