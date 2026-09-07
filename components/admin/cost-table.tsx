"use client";
import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { RelativeTime } from "@/components/ui/relative-time";
import { cn } from "@/lib/utils";

export type CostRow = {
  id: string;
  createdAt: string;
  status: string;
  tool: string;
  provider: string | null;
  model: string | null;
  basis: "measured" | "estimated" | "unknown";
  costUsd: number;
  credits: number;
  revenuePln: number;
  profitPln: number;
};

const SORTS = ["newest", "cost", "credits", "margin"] as const;
type Sort = (typeof SORTS)[number];

/**
 * THE COST TABLE — one row per billable request.
 *
 * The `basis` column is the point of the whole screen: a figure the provider
 * returned is marked measured, one derived from the configured price is marked
 * estimated, and a paid call with neither is marked unknown rather than
 * rendered as a confident 0.00.
 */
export function CostTable({ rows, locale, truncated }: {
  rows: CostRow[]; locale: string; truncated: boolean;
}) {
  const { t } = useI18n();
  const [tool, setTool] = useState("");
  const [provider, setProvider] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<Sort>("newest");

  const tools = useMemo(() => [...new Set(rows.map((r) => r.tool))].sort(), [rows]);
  const providers = useMemo(
    () => [...new Set(rows.map((r) => r.provider).filter(Boolean))].sort() as string[], [rows]);
  const statuses = useMemo(() => [...new Set(rows.map((r) => r.status))].sort(), [rows]);

  const visible = useMemo(() => {
    const filtered = rows.filter((r) =>
      (!tool || r.tool === tool) && (!provider || r.provider === provider) && (!status || r.status === status));
    const sorted = [...filtered];
    if (sort === "cost") sorted.sort((a, b) => b.costUsd - a.costUsd);
    else if (sort === "credits") sorted.sort((a, b) => b.credits - a.credits);
    // Lowest margin first: the rows worth looking at are the ones losing money.
    else if (sort === "margin") sorted.sort((a, b) => a.profitPln - b.profitPln);
    else sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return sorted.slice(0, 200);
  }, [rows, tool, provider, status, sort]);

  const pln = (v: number) => `${v.toFixed(2)} zł`;

  return (
    <div>
      <div className="mb-3 grid gap-2 sm:flex sm:flex-wrap">
        <Picker value={tool} onChange={setTool} label={t("aicc.col.tool")} options={tools} />
        <Picker value={provider} onChange={setProvider} label={t("aicc.costs.provider")} options={providers} />
        <Picker value={status} onChange={setStatus} label={t("common.status")} options={statuses} />
        <div className="min-w-0 sm:w-48">
          <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t("aicc.costs.sort")}>
            {SORTS.map((s) => <option key={s} value={s}>{t(`aicc.costs.sort.${s}`)}</option>)}
          </Select>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="panel rounded-2xl px-5 py-12 text-center text-sm text-muted">{t("aicc.costs.empty")}</div>
      ) : (
        <>
        {/* PHONE — a nine-column ledger cannot be a table at 390px. Each
            request becomes a card with the two numbers that matter and the
            rest labelled underneath. */}
        <ul className="space-y-2 lg:hidden">
          {visible.map((r) => (
            <li key={r.id} className="panel rounded-2xl p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold">{r.tool}</p>
                  <p className="truncate text-xs text-muted">
                    {[r.provider, r.model].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <Badge tone={r.status === "succeeded" ? "success"
                  : r.status === "failed" ? "danger" : "neutral"}>{r.status}</Badge>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] tabular-nums">
                <span className="flex items-center gap-1.5">
                  {r.basis === "unknown" ? "—" : `$${r.costUsd.toFixed(4)}`}
                  <BasisTag basis={r.basis} />
                </span>
                <span>{r.credits} kr.</span>
                <span className={cn(r.profitPln < 0 && "text-danger")}>{pln(r.profitPln)}</span>
                <span className="ml-auto text-xs text-faint">
                  <RelativeTime at={r.createdAt} locale={locale} t={t} />
                </span>
              </div>
            </li>
          ))}
          <li className="px-1 text-xs text-faint">
            {t("aicc.costs.showing", { n: visible.length, total: rows.length })}
          </li>
        </ul>

        <div className="panel hidden overflow-hidden rounded-2xl lg:block">
          <div className="table-scroll thin-scroll max-h-[70dvh] overflow-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-surface/95 text-left text-[11px] uppercase tracking-[0.08em] text-faint backdrop-blur">
                  {[t("common.date"), t("aicc.col.tool"), t("aicc.costs.provider"), t("aicc.col.model"),
                    t("aicc.economics.apiCost"), t("nav.credits"), t("aicc.economics.profit"),
                    t("common.status")].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-3 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted">
                      <RelativeTime at={r.createdAt} locale={locale} t={t} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">{r.tool}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted">{r.provider ?? "—"}</td>
                    <td className="max-w-[200px] truncate px-4 py-2.5 text-muted">{r.model ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                      <span className="flex items-center gap-1.5">
                        {r.basis === "unknown" ? "—" : `$${r.costUsd.toFixed(4)}`}
                        <BasisTag basis={r.basis} />
                      </span>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{r.credits}</td>
                    <td className={cn("whitespace-nowrap px-4 py-2.5 tabular-nums",
                      r.profitPln < 0 && "text-danger")}>{pln(r.profitPln)}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={r.status === "succeeded" ? "success"
                        : r.status === "failed" ? "danger" : "neutral"}>{r.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-4 py-2.5 text-xs text-faint">
            {t("aicc.costs.showing", { n: visible.length, total: rows.length })}
            {truncated ? ` · ${t("aicc.costs.truncated")}` : ""}
          </p>
        </div>
        </>
      )}
    </div>
  );
}

function BasisTag({ basis }: { basis: CostRow["basis"] }) {
  const { t } = useI18n();
  if (basis === "measured") return null;
  return (
    <Badge tone={basis === "unknown" ? "danger" : "neutral"}>{t(`aicc.costs.basis.${basis}`)}</Badge>
  );
}

function Picker({ value, onChange, label, options }: {
  value: string; onChange: (v: string) => void; label: string; options: string[];
}) {
  return (
    <div className="min-w-0 sm:w-44">
      <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">{label}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </Select>
    </div>
  );
}
