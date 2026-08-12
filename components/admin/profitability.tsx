"use client";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PERIODS, type Period, type MoneySlice, type ModelEconomics, type CostAnomaly } from "@/lib/services/economics";

export type ProfitabilityData = {
  slices: Record<Period, MoneySlice>;
  models: ModelEconomics[];
  anomalies: CostAnomaly[];
  usdToPln: number;
};

/** Contribution economics for one customer: what they paid us, what their
 *  generations really cost us, and what is left. Every number comes from
 *  settled payments and recorded usage events. */
export function Profitability({ data, locale }: { data: ProfitabilityData; locale: string }) {
  const { t } = useI18n();
  const [period, setPeriod] = useState<Period>("30d");
  const s = data.slices[period];

  const money = (cents: number) =>
    new Intl.NumberFormat(locale === "pl" ? "pl-PL" : "en-GB", {
      style: "currency", currency: "PLN", maximumFractionDigits: 2,
    }).format(cents / 100);
  const usd = (micros: number) =>
    new Intl.NumberFormat(locale === "pl" ? "pl-PL" : "en-GB", {
      style: "currency", currency: "USD", maximumFractionDigits: 2,
    }).format(micros / 1_000_000);

  const marginTone = s.marginPercent >= 60 ? "green" : s.marginPercent >= 30 ? "amber" : "red";

  return (
    <Card>
      <CardHeader
        title={t("econ.title")}
        sub={t("econ.sub")}
        action={
          <div role="tablist" aria-label={t("econ.period")} className="flex gap-1 rounded-lg bg-raised p-0.5">
            {PERIODS.map((p) => (
              <button key={p} type="button" role="tab" aria-selected={p === period}
                onClick={() => setPeriod(p)}
                className={cn("rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors duration-150",
                  p === period ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}>
                {t(`econ.p.${p}`)}
              </button>
            ))}
          </div>
        }
      />
      <div className="space-y-4 p-5 pt-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label={t("econ.revenue")} value={money(s.revenueCents)} />
          <Tile label={t("econ.apiCost")} value={usd(s.apiCostUsdMicros)}
            sub={money(Math.round((s.apiCostUsdMicros / 1_000_000) * data.usdToPln * 100))} tone="warm" />
          <Tile label={t("econ.contribution")} value={money(s.contributionCents)}
            tone={s.contributionCents >= 0 ? "good" : "bad"} />
          <Tile label={t("econ.margin")} value={`${s.marginPercent}%`} tone={s.marginPercent >= 30 ? "good" : "bad"} />
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <Mini label={t("econ.generations")} value={s.generations} />
          <Mini label={t("econ.succeeded")} value={s.succeeded} />
          <Mini label={t("econ.failed")} value={s.failed} />
          <Mini label={t("econ.outputs")} value={s.outputs} />
        </div>

        {/* Per-model cost audit */}
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-faint">{t("econ.byModel")}</h4>
          {data.models.length === 0 ? (
            <p className="rounded-xl bg-raised px-4 py-3 text-sm text-muted">{t("econ.noModels")}</p>
          ) : (
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-faint">
                    <th className="pb-2 font-semibold">{t("econ.model")}</th>
                    <th className="pb-2 text-right font-semibold">{t("econ.jobs")}</th>
                    <th className="pb-2 text-right font-semibold">{t("econ.outputs")}</th>
                    <th className="pb-2 text-right font-semibold">{t("econ.credits")}</th>
                    <th className="pb-2 text-right font-semibold">{t("econ.apiCost")}</th>
                    <th className="pb-2 text-right font-semibold">{t("econ.perOutput")}</th>
                    <th className="pb-2 text-right font-semibold">{t("econ.contribution")}</th>
                    <th className="pb-2 text-right font-semibold">{t("econ.margin")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.models.map((m) => (
                    <tr key={m.model}>
                      <td className="py-2 pr-3"><code className="text-xs">{m.model}</code></td>
                      <td className="py-2 text-right tabular-nums">{m.jobs}</td>
                      <td className="py-2 text-right tabular-nums">{m.outputs}</td>
                      <td className="py-2 text-right tabular-nums">{m.creditsCharged}</td>
                      <td className="py-2 text-right tabular-nums">{usd(m.apiCostUsdMicros)}</td>
                      <td className="py-2 text-right tabular-nums text-muted">{usd(m.costPerOutputUsdMicros)}</td>
                      <td className="py-2 text-right tabular-nums">{money(m.contributionCents)}</td>
                      <td className="py-2 text-right tabular-nums">
                        {m.revenueCents > 0 ? `${m.marginPercent}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[11px] text-faint">{t("econ.attribution")}</p>
        </div>

        {data.anomalies.length > 0 && (
          <div>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-faint">
              <AlertTriangle size={12} className="text-accent2" aria-hidden />
              {t("econ.anomalies")}
            </h4>
            <ul className="space-y-1.5">
              {data.anomalies.slice(0, 6).map((a, i) => (
                <li key={i} className="flex items-start gap-2 rounded-xl bg-raised px-3 py-2 text-xs">
                  <Badge tone={a.kind === "cost_without_result" ? "red" : "amber"}>{t(`econ.a.${a.kind}`)}</Badge>
                  <span className="min-w-0 flex-1 text-muted">{a.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

function Tile({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone?: "good" | "bad" | "warm";
}) {
  return (
    <div className="rounded-xl bg-raised px-3.5 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={cn("font-display text-lg font-semibold",
        tone === "good" && "text-accent", tone === "bad" && "text-red-500", tone === "warm" && "text-accent2")}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-faint">≈ {sub}</p>}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line px-3 py-2">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="font-display text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}
