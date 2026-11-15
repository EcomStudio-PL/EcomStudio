"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, RefreshCw, Send } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import {
  recordProviderFundsAction, saveProviderFundsAction, saveReserveSettingsAction, sendTestReserveReportAction, syncProviderFundsAction,
} from "@/app/actions/api-reserves";
import type { FundMode, ProviderReserve, ProviderStatus, ReserveSettings } from "@/lib/finance/api-reserves";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Switch } from "@/components/ui/record";
import { cn } from "@/lib/utils";

/**
 * FINANSE → REZERWY API — the interactive half: a provider's card (its money,
 * spend, forecast and the admin's entries), the reserve settings and the
 * report test/history panel. Every write is a server action that re-checks the
 * admin and is audited; nothing here can buy provider credit.
 */

const TONE: Record<ProviderStatus, "success" | "warning" | "danger" | "neutral"> = {
  ok: "success", warning: "warning", critical: "danger", no_data: "neutral", off: "neutral",
};

function useMoney() {
  const { t } = useI18n();
  return (micros: number | null | undefined) =>
    micros === null || micros === undefined ? t("admin.reserves.noData") : `$${(micros / 1_000_000).toFixed(2)}`;
}

function errorKey(code?: string) {
  return code === "not_admin" || code === "unauthenticated" ? "admin.reserves.err.notAdmin"
    : code === "bad_timezone" ? "admin.reserves.err.timezone"
    : code === "bad_url" ? "admin.reserves.err.url"
    : code === "invalid" ? "admin.reserves.err.invalid" : "admin.reserves.err.generic";
}

export function ProviderFundsCard({ p, scenario, capability }: {
  p: ProviderReserve; scenario: "standard" | "cautious"; capability: "api" | "manual" | "postpaid";
}) {
  const { t } = useI18n();
  const money = useMoney();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<null | "funds" | "settings">(null);
  const [kind, setKind] = useState<"balance_set" | "topup" | "correction">("balance_set");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<FundMode>(p.mode);
  const usdField = (micros: number | null) => (micros === null ? "" : (micros / 1_000_000).toFixed(2));
  const [cfg, setCfg] = useState({
    warn: usdField(p.warnMicros), critical: usdField(p.criticalMicros), limit: usdField(p.creditLimitMicros), url: p.billingUrl ?? "",
  });

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okKey: string) => start(async () => {
    const res = await fn();
    if (res.ok) { toast.success(t(okKey)); setOpen(null); router.refresh(); }
    else toast.error(t(errorKey(res.error)));
  });

  const prepaid = p.mode === "auto" || p.mode === "manual";
  const runway = p.runwayHours === null ? "—" : p.runwayHours < 48 ? t("admin.reserves.hours", { n: Math.floor(p.runwayHours) })
    : t("admin.reserves.days", { n: Math.floor(p.runwayHours / 24) });

  return (
    <Card className={cn("flex flex-col", p.status === "critical" && "ring-1 ring-[rgb(var(--danger)/0.45)]")} data-provider={p.slug}>
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-4 sm:px-5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{p.name}</h3>
          <p className="mt-0.5 text-xs text-muted">
            {t(`admin.reserves.mode.${p.mode}`)}{!p.active && ` · ${t("admin.reserves.inactive")}`}
          </p>
        </div>
        <Badge tone={TONE[p.status]} dot>{t(`admin.reserves.status.${p.status}`)}</Badge>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 px-4 py-4 text-sm sm:grid-cols-3 sm:px-5">
        <Fig label={prepaid ? t("admin.reserves.p.available") : p.mode === "postpaid" ? t("admin.reserves.p.limitLeft") : t("admin.reserves.p.available")}
          value={prepaid ? money(p.available.micros) : p.mode === "postpaid" ? (p.limitLeft ? money(p.limitLeft.micros) : t("admin.reserves.p.postpaidNoBalance")) : "—"}
          hint={prepaid ? t(`admin.reserves.basis.${p.available.basis}`) : p.limitLeft ? t("admin.reserves.basis.estimated") : undefined} />
        <Fig label={t("admin.reserves.p.hour")} value={money(p.spend.h1)} hint={t("admin.reserves.p.calls", { n: p.spend.callsH1 })} />
        <Fig label={t("admin.reserves.p.today")} value={money(p.spend.today)} hint={t("admin.reserves.p.calls", { n: p.spend.callsToday })} />
        <Fig label={t("admin.reserves.p.month")} value={money(p.spend.month)}
          hint={p.spend.share === null ? undefined : t("admin.reserves.p.share", { n: Math.round(p.spend.share * 100) })} />
        <Fig label={t("admin.reserves.p.need")} value={`${money(p.need.h24[scenario])} / ${money(p.need.d7[scenario])}`} hint={t("admin.reserves.p.needHint")} />
        <Fig label={t("admin.reserves.p.reserve")} value={money(p.reserve)} />
        {prepaid
          ? <Fig label={t("admin.reserves.p.topup")} value={p.topup === null ? t("admin.reserves.noData") : `+${money(p.topup)}`} strong={(p.topup ?? 0) > 0} />
          : p.mode === "postpaid" ? <Fig label={t("admin.reserves.p.secure")} value={money(p.secure)} strong={(p.secure ?? 0) > 0} /> : null}
        <Fig label={t("admin.reserves.p.runway")} value={runway} />
        <Fig label={t("admin.reserves.p.sync")} value={p.lastSyncAt ? new Date(p.lastSyncAt).toLocaleString("pl-PL") : "—"}
          hint={p.syncStatus ? t(`admin.reserves.sync.${p.syncStatus}`) : undefined} />
      </dl>
      {(p.spend.unknownMonth > 0 || p.unknownSinceBalance > 0) && (
        <p className="px-4 pb-2 text-xs text-warning sm:px-5">{t("admin.reserves.p.unknown", { n: Math.max(p.spend.unknownMonth, p.unknownSinceBalance) })}</p>
      )}
      <p className="px-4 pb-3 text-xs text-muted sm:px-5">{t(`admin.reserves.cap.${capability}`)}</p>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 sm:px-5">
        {p.mode === "auto" && (
          <Button size="sm" variant="secondary" disabled={pending}
            onClick={() => run(async () => syncProviderFundsAction(p.slug), "admin.reserves.synced")}>
            <RefreshCw size={14} aria-hidden /> {t("admin.reserves.syncNow")}
          </Button>
        )}
        {p.mode !== "off" && p.mode !== "postpaid" && (
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => setOpen(open === "funds" ? null : "funds")}>{t("admin.reserves.enterFunds")}</Button>
        )}
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(open === "settings" ? null : "settings")}>{t("admin.reserves.providerSettings")}</Button>
        {p.billingUrl && (
          <a href={p.billingUrl} target="_blank" rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-accent2 hover:underline">
            {t("admin.reserves.billingPanel")} <ExternalLink size={12} aria-hidden />
          </a>
        )}
      </div>

      {open === "funds" && (
        <form className="grid gap-3 border-t border-line px-4 py-4 sm:grid-cols-2 sm:px-5" onSubmit={(e) => {
          e.preventDefault();
          run(() => recordProviderFundsAction({ providerId: p.id, kind, amountUsd: Number(amount.replace(",", ".")), note }), "admin.reserves.saved");
        }}>
          <div>
            <Label htmlFor={`k-${p.id}`}>{t("admin.reserves.f.kind")}</Label>
            <select id={`k-${p.id}`} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}
              className="mt-1 h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm">
              <option value="balance_set">{t("admin.reserves.f.balanceSet")}</option>
              <option value="topup">{t("admin.reserves.f.topup")}</option>
              <option value="correction">{t("admin.reserves.f.correction")}</option>
            </select>
          </div>
          <div>
            <Label htmlFor={`a-${p.id}`}>{t("admin.reserves.f.amount")}</Label>
            <Input id={`a-${p.id}`} inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor={`n-${p.id}`}>{t("admin.reserves.f.note")}</Label>
            <Input id={`n-${p.id}`} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <p className="text-xs text-muted sm:col-span-2">{t(`admin.reserves.f.help.${kind}`)}</p>
          <div className="sm:col-span-2"><Button type="submit" size="sm" disabled={pending}>{t("admin.reserves.save")}</Button></div>
          {p.events.length > 0 && (
            <ul className="space-y-1 text-xs text-muted sm:col-span-2">
              {p.events.map((e, i) => (
                <li key={i}>{new Date(e.at).toLocaleString("pl-PL")} · {t(`admin.reserves.ev.${e.kind}`)} · {money(e.amount)}{e.note ? ` · ${e.note}` : ""}</li>
              ))}
            </ul>
          )}
        </form>
      )}

      {open === "settings" && (
        <form className="grid gap-3 border-t border-line px-4 py-4 sm:grid-cols-2 sm:px-5" onSubmit={(e) => {
          e.preventDefault();
          run(() => saveProviderFundsAction({
            providerId: p.id, mode,
            warnUsd: Number((cfg.warn || "20").replace(",", ".")), criticalUsd: Number((cfg.critical || "5").replace(",", ".")),
            creditLimitUsd: cfg.limit.trim() === "" ? null : Number(cfg.limit.replace(",", ".")), billingUrl: cfg.url.trim() || null,
          }), "admin.reserves.saved");
        }}>
          <div>
            <Label htmlFor={`m-${p.id}`}>{t("admin.reserves.f.mode")}</Label>
            <select id={`m-${p.id}`} value={mode} onChange={(e) => setMode(e.target.value as FundMode)}
              className="mt-1 h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm">
              {(["auto", "manual", "postpaid", "off"] as const).map((m) => (
                <option key={m} value={m} disabled={m === "auto" && capability !== "api"}>{t(`admin.reserves.mode.${m}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor={`u-${p.id}`}>{t("admin.reserves.f.billingUrl")}</Label>
            <Input id={`u-${p.id}`} value={cfg.url} onChange={(e) => setCfg({ ...cfg, url: e.target.value })} placeholder="https://" />
          </div>
          <div>
            <Label htmlFor={`w-${p.id}`}>{t("admin.reserves.f.warn")}</Label>
            <Input id={`w-${p.id}`} inputMode="decimal" value={cfg.warn} onChange={(e) => setCfg({ ...cfg, warn: e.target.value })} placeholder="20.00" />
          </div>
          <div>
            <Label htmlFor={`c-${p.id}`}>{t("admin.reserves.f.critical")}</Label>
            <Input id={`c-${p.id}`} inputMode="decimal" value={cfg.critical} onChange={(e) => setCfg({ ...cfg, critical: e.target.value })} placeholder="5.00" />
          </div>
          {mode === "postpaid" && (
            <div className="sm:col-span-2">
              <Label htmlFor={`l-${p.id}`}>{t("admin.reserves.f.limit")}</Label>
              <Input id={`l-${p.id}`} inputMode="decimal" value={cfg.limit} onChange={(e) => setCfg({ ...cfg, limit: e.target.value })} />
            </div>
          )}
          <div className="sm:col-span-2"><Button type="submit" size="sm" disabled={pending}>{t("admin.reserves.save")}</Button></div>
        </form>
      )}
    </Card>
  );
}

function Fig({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className={cn("mt-0.5 whitespace-nowrap tabular-nums", strong ? "font-semibold text-accent2" : "font-medium")}>{value}</dd>
      {hint && <dd className="text-[11px] text-muted">{hint}</dd>}
    </div>
  );
}

export function ReserveSettingsForm({ settings }: { settings: ReserveSettings }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [s, set] = useState({
    enabled: settings.enabled, bufferPercent: String(settings.buffer_percent), horizonDays: String(settings.horizon_days),
    scenario: settings.scenario, cautiousFactor: String(settings.cautious_factor), historyDays: String(settings.history_days),
    minHistoryCredits: String(settings.min_history_credits), dailyReportHour: String(settings.daily_report_hour),
    reportTimezone: settings.report_timezone, hourlySkipEmpty: settings.hourly_skip_empty, alertRepeatHours: String(settings.alert_repeat_hours),
  });
  const n = (v: string) => Number(v.replace(",", "."));
  const field = (key: keyof typeof s, labelKey: string, extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div>
      <Label htmlFor={`rs-${key}`}>{t(labelKey)}</Label>
      <Input id={`rs-${key}`} value={String(s[key])} onChange={(e) => set({ ...s, [key]: e.target.value })} {...extra} />
    </div>
  );
  return (
    <Card>
      <CardHeader title={t("admin.reserves.settings.title")} sub={t("admin.reserves.settings.sub")} />
      <form className="grid gap-3 px-4 pb-5 sm:grid-cols-2 sm:px-5" onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveReserveSettingsAction({
            enabled: s.enabled, bufferPercent: n(s.bufferPercent), horizonDays: n(s.horizonDays), scenario: s.scenario,
            cautiousFactor: n(s.cautiousFactor), historyDays: n(s.historyDays), minHistoryCredits: n(s.minHistoryCredits),
            dailyReportHour: n(s.dailyReportHour), reportTimezone: s.reportTimezone, hourlySkipEmpty: s.hourlySkipEmpty,
            alertRepeatHours: n(s.alertRepeatHours),
          });
          if (res.ok) { toast.success(t("admin.reserves.saved")); router.refresh(); } else toast.error(t(errorKey(res.error)));
        });
      }}>
        <div className="flex items-center justify-between gap-3 sm:col-span-2">
          <span className="text-sm">{t("admin.reserves.settings.enabled")}</span>
          <Switch checked={s.enabled} label={t("admin.reserves.settings.enabled")} onChange={(v) => set({ ...s, enabled: v })} />
        </div>
        {field("bufferPercent", "admin.reserves.settings.buffer", { inputMode: "decimal" })}
        {field("horizonDays", "admin.reserves.settings.horizon", { inputMode: "numeric" })}
        <div>
          <Label htmlFor="rs-scenario">{t("admin.reserves.settings.scenario")}</Label>
          <select id="rs-scenario" value={s.scenario} onChange={(e) => set({ ...s, scenario: e.target.value === "cautious" ? "cautious" : "standard" })}
            className="mt-1 h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm">
            <option value="standard">{t("admin.reserves.scenario.standard")}</option>
            <option value="cautious">{t("admin.reserves.scenario.cautious")}</option>
          </select>
        </div>
        {field("cautiousFactor", "admin.reserves.settings.cautiousFactor", { inputMode: "decimal" })}
        {field("historyDays", "admin.reserves.settings.history", { inputMode: "numeric" })}
        {field("minHistoryCredits", "admin.reserves.settings.minHistory", { inputMode: "decimal" })}
        {field("dailyReportHour", "admin.reserves.settings.dailyHour", { inputMode: "numeric" })}
        {field("reportTimezone", "admin.reserves.settings.timezone")}
        {field("alertRepeatHours", "admin.reserves.settings.alertRepeat", { inputMode: "numeric" })}
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">{t("admin.reserves.settings.skipEmpty")}</span>
          <Switch checked={s.hourlySkipEmpty} label={t("admin.reserves.settings.skipEmpty")} onChange={(v) => set({ ...s, hourlySkipEmpty: v })} />
        </div>
        <div className="sm:col-span-2"><Button type="submit" size="sm" disabled={pending}>{t("admin.reserves.save")}</Button></div>
      </form>
    </Card>
  );
}

export type ReportLogRow = { id: string; type: string; channel: string; status: string; error: string | null; title: string; at: string };

export function ReserveReportsPanel({ log }: { log: ReportLogRow[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const kinds = ["sale", "hourly", "daily", "funds_low"] as const;
  return (
    <Card>
      <CardHeader title={t("admin.reserves.reports.title")} sub={t("admin.reserves.reports.sub")}
        action={<Link href="/admin/communication/powiadomienia" className="text-xs font-medium text-accent2 hover:underline">{t("admin.reserves.reports.channels")}</Link>} />
      <div className="flex flex-wrap gap-2 px-4 pb-4 sm:px-5">
        {kinds.map((k) => (
          <Button key={k} size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => {
            const res = await sendTestReserveReportAction(k);
            if (res.ok) { toast.success(t("admin.reserves.reports.sent")); router.refresh(); } else toast.error(t(errorKey(res.error)));
          })}>
            <Send size={13} aria-hidden /> {t(`admin.reserves.reports.test.${k}`)}
          </Button>
        ))}
      </div>
      <div className="max-h-[420px] overflow-auto border-t border-line">
        {log.length === 0 ? (
          <p className="px-4 py-5 text-sm text-muted sm:px-5">{t("admin.reserves.reports.empty")}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {log.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:px-5">
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                <Badge tone="neutral">{t(r.channel === "admin_email" ? "comm.chAdminEmail" : r.channel === "admin_panel" ? "comm.chAdminPanel" : "comm.chTelegram")}</Badge>
                <Badge tone={r.status === "sent" ? "success" : r.status === "failed" ? "danger" : r.status === "skipped" ? "accent" : "neutral"}>
                  {t(`comm.st.${r.status}`)}
                </Badge>
                <span className="text-xs text-muted tabular-nums">{r.at}</span>
                {r.error && <span className="w-full text-xs text-danger">{r.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
