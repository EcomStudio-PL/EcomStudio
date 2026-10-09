import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { PhotoToolUnit } from "@/lib/server/photo-tool-admin";

type T = (key: string, values?: Record<string, string | number>) => string;

/**
 * ONE PHOTO, IN MONEY — the four photo tools' unit economics on their admin
 * page: what is called, what it costs us (USD and PLN at the system rate),
 * what the seller is charged, and what that earns at the reference credit
 * price and at the cheapest credit anyone can buy (gross, and net of VAT).
 *
 * Read-only. The proposed minimum is a number for the operator; prices are
 * changed in Admin → Usługi, by a person, never from here.
 */
export function PhotoToolEconomicsCard({ unit, t, locale }: { unit: PhotoToolUnit; t: T; locale: string }) {
  const pln = (v: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "PLN", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(v);
  const usd = (v: number) => `$${v.toFixed(v < 0.1 ? 3 : 2)}`;
  const pct = (v: number) => `${v.toFixed(1)}%`;
  const envTone = unit.environment === "live" ? "success" : unit.environment === "sandbox" ? "warning" : "neutral";

  return (
    <div className="space-y-4 text-[13px]" data-photo-economics={unit.slug}>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <Row label={t("aicc.photo.operation")} value={<code className="font-mono text-xs">{unit.operation}</code>} />
        <Row label={t("aicc.photo.provider")} value={
          <span className="flex flex-wrap items-center justify-end gap-1.5">
            {unit.providerLabel}
            <Badge tone={envTone} dot>{t(`aicc.photo.env.${unit.environment ?? "none"}`)}</Badge>
          </span>
        } />
        <Row label={t("aicc.photo.endpoint")} value={<code className="break-all font-mono text-[11.5px]">{unit.endpoint}</code>} />
        <Row label={t("aicc.photo.cost")} value={`${usd(unit.costUsd)} · ${pln(unit.costPln)}`}
          hint={t("aicc.photo.fx", { fx: unit.usdToPln.toFixed(2) })} />
        <Row label={t("aicc.photo.price")} value={t("aicc.photo.credits", { n: unit.credits })}
          hint={t("aicc.photo.floor", { n: unit.floorCredits })} />
        {unit.freeWhenTransparent && <Row label={t("aicc.photo.freePath")} value={t("aicc.photo.freePathValue")} />}
      </dl>

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[460px] text-left text-[12.5px]">
          <thead className="bg-raised text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">{t("aicc.photo.col.credit")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("aicc.photo.col.revenue")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("aicc.photo.col.margin")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("aicc.photo.col.marginPct")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {unit.points.map((p) => (
              <tr key={p.key} data-price-point={p.key}>
                <td className="px-3 py-2">
                  <span className="block font-medium">{t(`aicc.photo.point.${p.key}`, { source: unit.cheapest?.source ?? "—" })}</span>
                  <span className="block text-xs tabular-nums text-faint">{pln(p.plnPerCredit)} / {t("aicc.photo.perCredit")}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{pln(p.revenuePln)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${p.marginPln < 0 ? "text-danger" : ""}`}>{pln(p.marginPln)}</td>
                <td className={`px-3 py-2 text-right font-semibold tabular-nums ${p.marginPercent < unit.rule.minMarginPercent ? "text-warning" : "text-success"}`}>
                  {pct(p.marginPercent)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl bg-raised px-3.5 py-3" data-price-proposal>
        <p className="font-semibold">{t("aicc.photo.proposalTitle")}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          {t("aicc.photo.proposalRule", { margin: unit.rule.minMarginPercent, buffer: unit.rule.bufferPercent })}
        </p>
        <p className="mt-2 tabular-nums">
          {unit.minimum.gross !== null
            ? t("aicc.photo.proposalValues", { gross: unit.minimum.gross, net: unit.minimum.net ?? "—", now: unit.credits })
            : t("aicc.photo.proposalUnknown")}
        </p>
        <p className="mt-2 text-xs text-faint">
          {t("aicc.photo.proposalNote")}{" "}
          <Link href="/admin/services" className="font-semibold text-accent hover:underline">{t("aicc.photo.servicesLink")}</Link>
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-photo-runs>
        <Stat label={t("aicc.photo.runs.live")} value={unit.runs30d.live} />
        <Stat label={t("aicc.photo.runs.sandbox")} value={unit.runs30d.sandbox} />
        <Stat label={t("aicc.photo.runs.local")} value={unit.runs30d.local} />
        <Stat label={t("aicc.photo.runs.failed")} value={unit.runs30d.failed} />
      </dl>
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-medium">
        {value}
        {hint && <span className="block text-xs font-normal text-faint">{hint}</span>}
      </dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-xl bg-raised px-3 py-2.5">
      <dt className="truncate text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
