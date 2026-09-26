import { Badge } from "@/components/ui/badge";
import { cn, formatDate } from "@/lib/utils";
import { usdMicrosToPlnCents, type Aggregate, type CostBasis } from "@/lib/api-economics";
import type { HistoryRow, ToolEconomics } from "@/lib/services/api-economics";

/**
 * API ECONOMICS — presentation only (server components). Every money figure
 * says where it came from: a cost is "Szacowany" (usage × price list) or
 * "Rzeczywisty" (the provider stated it), an unknown cost is shown as unknown,
 * and revenue is what a customer actually paid for (bonus/free runs earn 0).
 */

type T = (key: string, values?: Record<string, string | number>) => string;

const intlLocale = (locale: string) => (locale === "de" ? "de-DE" : locale === "en" ? "en-GB" : "pl-PL");

export function formatPln(cents: number | null, locale: string): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat(intlLocale(locale), { style: "currency", currency: "PLN" }).format(cents / 100);
}

export function formatUsd(micros: number | null, locale: string): string {
  if (micros == null) return "—";
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: micros < 100_000 ? 4 : 2,
  }).format(micros / 1_000_000);
}

export function CostBasisBadge({ basis, t }: { basis: CostBasis; t: T }) {
  return (
    <Badge tone={basis === "actual" ? "success" : basis === "estimated" ? "info" : "neutral"}>
      {t(`aicc.econ.basis.${basis}`)}
    </Badge>
  );
}

function CostCell({ usdMicros, basis, unknown, usdToPln, locale, t }: {
  usdMicros: number | null; basis: CostBasis; unknown?: number; usdToPln: number; locale: string; t: T;
}) {
  if (basis === "unknown" || usdMicros == null) {
    return <span className="text-muted" title={t("aicc.econ.unknownHint")}>{t("aicc.econ.basis.unknown")}</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" title={formatUsd(usdMicros, locale)}>
      <span className="tabular-nums">{formatPln(usdMicrosToPlnCents(usdMicros, usdToPln), locale)}</span>
      <CostBasisBadge basis={basis} t={t} />
      {unknown ? <span className="text-[11px] text-faint">{t("aicc.econ.plusUnknown", { n: unknown })}</span> : null}
    </span>
  );
}

function MarginCell({ cents, percent, locale }: { cents: number | null; percent: number | null; locale: string }) {
  if (cents == null) return <span className="text-muted">—</span>;
  return (
    <span className={cn("tabular-nums", cents < 0 && "text-danger")}>
      {formatPln(cents, locale)}{percent != null ? ` · ${Math.round(percent)}%` : ""}
    </span>
  );
}

/** Today + 30 days for one tool (the tool's own Ekonomia tab). */
export function ToolEconomicsPanel({ today, days30, usdToPln, locale, t }: {
  today: Aggregate; days30: Aggregate; usdToPln: number; locale: string; t: T;
}) {
  const windows: [string, Aggregate][] = [[t("aicc.econ.today"), today], [t("aicc.econ.days30"), days30]];
  return (
    <div className="grid gap-4 [&>*]:min-w-0 md:grid-cols-2" data-tool-economics>
      {windows.map(([label, a]) => (
        <div key={label} className="panel rounded-2xl p-4 sm:p-5">
          <p className="overline">{label}</p>
          <dl className="mt-3 space-y-2 text-sm">
            <Line label={t("aicc.econ.runs")}>{a.runs}{a.failed ? <span className="text-danger"> · {t("aicc.econ.failedN", { n: a.failed })}</span> : null}</Line>
            <Line label={t("aicc.econ.credits")}>{a.credits}</Line>
            <Line label={t("aicc.econ.apiCost")}>
              <CostCell usdMicros={a.cost.basis === "unknown" ? null : a.cost.usdMicros} basis={a.cost.basis} unknown={a.cost.unknown} usdToPln={usdToPln} locale={locale} t={t} />
            </Line>
            <Line label={t("aicc.econ.revenue")}>{formatPln(a.revenueCents, locale)}</Line>
            <Line label={t("aicc.econ.margin")}><MarginCell cents={a.marginCents} percent={a.marginPercent} locale={locale} /></Line>
            <Line label={t("aicc.econ.avgCost")}>
              {a.avgCostUsdMicros == null ? "—" : formatPln(usdMicrosToPlnCents(a.avgCostUsdMicros, usdToPln), locale)}
            </Line>
            <Line label={t("aicc.econ.avgRevenue")}>{formatPln(a.avgRevenueCents, locale)}</Line>
            <Line label={t("aicc.econ.mix")}>
              <span className="text-xs text-muted">{t("aicc.econ.mixValue", { paid: a.paidRuns, bonus: a.bonusRuns, free: a.freeRuns })}</span>
            </Line>
          </dl>
        </div>
      ))}
    </div>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

/** Every tool, today and 30 days (Modele, API i koszty → Koszty). */
export function ToolEconomicsTable({ tools, usdToPln, locale, t, toolLabel }: {
  tools: ToolEconomics[]; usdToPln: number; locale: string; t: T; toolLabel: (key: string) => string;
}) {
  if (tools.length === 0) return <p className="px-5 py-8 text-center text-sm text-muted">{t("aicc.econ.empty")}</p>;
  const head = [t("aicc.econ.tool"), t("aicc.econ.window"), t("aicc.econ.runs"), t("aicc.econ.credits"),
    t("aicc.econ.apiCost"), t("aicc.econ.revenue"), t("aicc.econ.margin"), t("aicc.econ.avgCost"), t("aicc.econ.avgRevenue")];
  return (
    <div className="table-scroll thin-scroll overflow-x-auto">
      <table className="w-full min-w-[860px] text-sm" data-economics-table>
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-faint">
            {head.map((h) => <th key={h} className="whitespace-nowrap px-4 py-2.5 font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {tools.flatMap((tool) => ([["today", tool.today], ["days30", tool.days30]] as const).map(([w, a], i) => (
            <tr key={`${tool.toolKey}-${w}`} className={cn(i === 0 && "border-t border-line")}>
              <td className="whitespace-nowrap px-4 py-2 font-medium">{i === 0 ? toolLabel(tool.toolKey) : ""}</td>
              <td className="whitespace-nowrap px-4 py-2 text-muted">{t(`aicc.econ.${w}`)}</td>
              <td className="px-4 py-2 tabular-nums">{a.runs}</td>
              <td className="px-4 py-2 tabular-nums">{a.credits}</td>
              <td className="px-4 py-2"><CostCell usdMicros={a.cost.basis === "unknown" ? null : a.cost.usdMicros} basis={a.cost.basis} unknown={a.cost.unknown} usdToPln={usdToPln} locale={locale} t={t} /></td>
              <td className="px-4 py-2 tabular-nums">{formatPln(a.revenueCents, locale)}</td>
              <td className="px-4 py-2"><MarginCell cents={a.marginCents} percent={a.marginPercent} locale={locale} /></td>
              <td className="px-4 py-2 tabular-nums">{a.avgCostUsdMicros == null ? "—" : formatPln(usdMicrosToPlnCents(a.avgCostUsdMicros, usdToPln), locale)}</td>
              <td className="px-4 py-2 tabular-nums">{formatPln(a.avgRevenueCents, locale)}</td>
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}

/** One line per run: "26.09 18:42 · Retusz · Nano Banana Pro · 1 request ·
 *  Koszt API · Klient zapłacił · Marża". */
export function UsageHistoryList({ rows, usdToPln, locale, t, toolLabel }: {
  rows: HistoryRow[]; usdToPln: number; locale: string; t: T; toolLabel: (key: string) => string;
}) {
  if (rows.length === 0) return <p className="px-5 py-10 text-center text-sm text-muted">{t("aicc.econ.historyEmpty")}</p>;
  return (
    <ul className="divide-y divide-line" data-usage-history>
      {rows.map((r) => (
        <li key={`${r.kind}-${r.id}`} className="grid gap-2 px-4 py-3 text-[13px] sm:px-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.4fr)] lg:items-center">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="tabular-nums text-faint">{formatDate(r.at, locale)}</span>
              <span className="font-semibold text-ink">
                {r.toolKey ? toolLabel(r.toolKey) : t(`aicc.econ.consumer.${r.consumer ?? "system"}`)}
              </span>
              {r.kind === "system" && <Badge tone="neutral">{t(`aicc.econ.consumer.${r.consumer ?? "system"}`)}</Badge>}
              <Badge tone={r.status === "succeeded" ? "success" : r.status === "pending" ? "neutral" : "danger"}>
                {t(`aicc.econ.status.${r.status}`)}
              </Badge>
            </p>
            <p className="mt-0.5 truncate text-muted">
              {[r.model, r.provider].filter(Boolean).join(" · ") || "—"}
              {" · "}{t("aicc.econ.requests", { n: r.requests })}
              {r.inputTokens != null || r.outputTokens != null
                ? ` · ${t("aicc.econ.tokens", { in: r.inputTokens ?? 0, out: r.outputTokens ?? 0 })}` : ""}
              {r.units != null && r.unitKind ? ` · ${t(`aicc.econ.units.${r.unitKind}`, { n: r.units })}` : ""}
            </p>
          </div>
          <div className="min-w-0">
            <span className="text-faint">{t("aicc.econ.apiCost")}: </span>
            <CostCell usdMicros={r.costUsdMicros} basis={r.costBasis} usdToPln={usdToPln} locale={locale} t={t} />
          </div>
          <div className="min-w-0 space-y-0.5">
            <p>
              <span className="text-faint">{t("aicc.econ.customerPaid")}: </span>
              <span className="tabular-nums">{r.revenue.kind === "system" ? "—" : formatPln(r.revenue.cents, locale)}</span>
              {" "}<span className="text-[11px] text-muted">{t(`aicc.econ.revenueKind.${r.revenue.kind}`)}</span>
              {r.credits > 0 && <span className="text-[11px] text-faint"> · {t("aicc.econ.creditsN", { n: r.credits })}</span>}
            </p>
            <p>
              <span className="text-faint">{t("aicc.econ.margin")}: </span>
              <MarginCell cents={r.marginCents} percent={r.marginPercent} locale={locale} />
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
