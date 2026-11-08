"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Workflow } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { formatDate } from "@/lib/utils";
import type { ShotOrderRow } from "@/lib/server/grovshot-shot/orders";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

/**
 * GROVBASE SHOT → Zlecenia: every lifestyle order with its date, account,
 * ordered/delivered, status, engine and knowledge versions, retries and the
 * real API cost (UNKNOWN when a call's price is not known), and the link to
 * its process view. Read-only.
 */

const usd = (m: number | null, unknown: number) => (m === null ? "UNKNOWN" : `$${(m / 1_000_000).toFixed(3)}${unknown ? " +?" : ""}`);
const tone = (s: string) => (s === "ok" ? "success" : s === "partial" ? "warning" : s === "failed" || s === "blocked" ? "danger" : "neutral");

export function ShotOrdersList({ rows }: { rows: ShotOrderRow[] }) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => r.id.includes(s) || (r.customer ?? "").toLowerCase().includes(s) || (r.customerId ?? "").includes(s)) : rows;
  }, [rows, q]);
  const kindLabel = (r: ShotOrderRow) =>
    r.experimentOf ? t("gsp.orders.kindExperiment") : r.regenOf ? t("gsp.orders.kindRegen") : r.kind === "grovshot_test" ? t("gsp.orders.kindTest") : t("gsp.orders.kindOrder");
  return (
    <div className="space-y-3" data-gsp-orders>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("gsp.orders.search")} aria-label={t("gsp.orders.search")} className="max-w-sm" />
      {list.length === 0 && <p className="text-sm text-muted">{t("gsp.orders.empty")}</p>}
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr className="text-muted">
              <th className="py-1.5 pr-2">{t("gsp.orders.date")}</th><th className="pr-2">{t("gsp.orders.account")}</th>
              <th className="pr-2">{t("gsp.orders.kind")}</th><th className="pr-2">{t("gsp.orders.shots")}</th>
              <th className="pr-2">{t("gsp.orders.status")}</th><th className="pr-2">{t("gsp.orders.versions")}</th>
              <th className="pr-2">{t("gsp.orders.retries")}</th><th className="pr-2">{t("gsp.orders.cost")}</th><th />
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className="border-t border-line align-middle">
                <td className="py-1.5 pr-2 tabular-nums">{formatDate(r.createdAt, locale)}</td>
                <td className="max-w-[220px] truncate pr-2" title={r.customerId ?? ""}>{r.customer ?? r.customerId?.slice(0, 8) ?? "—"}</td>
                <td className="pr-2">{kindLabel(r)}</td>
                <td className="pr-2 tabular-nums">{r.delivered}/{r.ordered}</td>
                <td className="pr-2"><Badge tone={tone(r.status)}>{t(`gsp.runStatus.${r.status}`)}</Badge></td>
                <td className="pr-2 text-muted">{r.engineVersion ?? "—"} · v{r.kbVersion ?? "?"}</td>
                <td className="pr-2 tabular-nums">{r.retries}</td>
                <td className="pr-2 tabular-nums">{usd(r.costMicros, r.costUnknown)}</td>
                <td className="text-right">
                  <Link href={`/admin/grovshot/${r.id}`} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                    <Workflow size={13} aria-hidden /> {t("gsp.open")}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2 lg:hidden">
        {list.map((r) => (
          <li key={r.id} className="rounded-xl border border-line p-3 text-[12px]">
            <div className="flex items-center justify-between gap-2">
              <span className="tabular-nums">{formatDate(r.createdAt, locale)}</span>
              <Badge tone={tone(r.status)}>{t(`gsp.runStatus.${r.status}`)}</Badge>
            </div>
            <p className="mt-1 truncate">{r.customer ?? r.customerId?.slice(0, 8) ?? "—"} · {kindLabel(r)}</p>
            <p className="mt-0.5 text-muted">
              {r.delivered}/{r.ordered} · {r.engineVersion ?? "—"} · v{r.kbVersion ?? "?"} · {t("gsp.orders.retries")}: {r.retries} · {usd(r.costMicros, r.costUnknown)}
            </p>
            <Link href={`/admin/grovshot/${r.id}`} className="mt-1.5 inline-flex items-center gap-1 font-medium text-accent">
              <Workflow size={13} aria-hidden /> {t("gsp.open")}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
