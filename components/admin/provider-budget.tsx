"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BellRing, ChevronDown, PlayCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { runBudgetCheckAction, saveProviderBudgetAction } from "@/app/actions/ai-budgets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type BudgetView = {
  providerId: string;
  providerName: string;
  spentUsd: number;
  requests: number;
  failureRate: number | null;
  percent: number | null;
  level: "ok" | "warn" | "critical";
  monthlyBudgetUsd: number | null;
  warnPercent: number;
  criticalPercent: number;
  maxRequestUsd: number | null;
  failureRatePercent: number | null;
  alertsEnabled: boolean;
};

/**
 * ALERTY — our monthly budget per provider, and what we have spent against it.
 *
 * Deliberately NOT called a balance. No adapter in this codebase can read a
 * provider's account, so the panel reports the number it can stand behind:
 * every billable call writes its cost to the usage ledger, and this is their
 * sum since the first of the month.
 */
export function ProviderBudgets({ rows }: { rows: BudgetView[] }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const router = useRouter();

  function checkNow() {
    start(async () => {
      const res = await runBudgetCheckAction();
      if (res.ok) {
        toast.success(t("aicc.alerts.checked", { checked: res.checked ?? 0, alerted: res.alerted ?? 0 }));
        router.refresh();
      } else toast.error(t("common.error"));
    });
  }

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
        <p className="min-w-0 text-[13px] leading-relaxed text-muted">{t("aicc.alerts.note")}</p>
        <Button size="sm" variant="secondary" disabled={pending} onClick={checkNow}>
          <PlayCircle size={14} aria-hidden />
          {pending ? t("common.loading") : t("aicc.alerts.checkNow")}
        </Button>
      </div>

      <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-2">
        {rows.map((row) => <BudgetCard key={row.providerId} row={row} />)}
      </div>
    </div>
  );
}

function BudgetCard({ row }: { row: BudgetView }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    monthlyBudgetUsd: row.monthlyBudgetUsd,
    warnPercent: row.warnPercent,
    criticalPercent: row.criticalPercent,
    maxRequestUsd: row.maxRequestUsd,
    failureRatePercent: row.failureRatePercent,
    alertsEnabled: row.alertsEnabled,
  });

  function save() {
    start(async () => {
      const res = await saveProviderBudgetAction({ providerId: row.providerId, ...form });
      if (res.ok) { toast.success(t("common.saved")); router.refresh(); }
      else toast.error(res.error === "thresholds_out_of_order"
        ? t("aicc.alerts.errThresholds") : t("common.error"));
    });
  }

  const tone = row.level === "critical" ? "danger" : row.level === "warn" ? "warning" : "success";

  return (
    <div className="panel rounded-2xl p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{row.providerName}</p>
          <p className="mt-0.5 text-xs text-muted">
            {t("aicc.alerts.spent", { usd: row.spentUsd.toFixed(2) })} ·{" "}
            {t("aicc.alerts.requests", { n: row.requests })}
          </p>
        </div>
        {row.percent === null ? (
          <Badge tone="neutral">{t("aicc.alerts.noBudget")}</Badge>
        ) : (
          <Badge tone={tone} dot>{Math.round(row.percent)}%</Badge>
        )}
      </div>

      {row.percent !== null && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden>
          <div className={cn("h-full rounded-full transition-[width]",
            row.level === "critical" ? "bg-danger" : row.level === "warn" ? "bg-warning" : "bg-success")}
            style={{ width: `${Math.min(row.percent, 100)}%` }} />
        </div>
      )}

      {/* A phone shows the state; the four thresholds open on request. Six
          providers × five controls is a screen nobody scrolls. */}
      <button type="button" onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-3 inline-flex min-h-[36px] items-center gap-1.5 text-[13px] font-semibold text-accent lg:hidden">
        {open ? t("common.hide") : t("aicc.alerts.settings")}
        <ChevronDown size={14} aria-hidden className={cn("transition-transform", open && "rotate-180")} />
      </button>

      <div className={cn("mt-4 grid gap-3 sm:grid-cols-2", !open && "hidden lg:grid")}>
        <div>
          <Label htmlFor={`b-${row.providerId}`}>{t("aicc.alerts.monthlyBudget")}</Label>
          <Input id={`b-${row.providerId}`} type="number" min={0} step={10}
            value={form.monthlyBudgetUsd ?? ""}
            placeholder={t("aicc.alerts.noLimit")}
            onChange={(e) => setForm({ ...form, monthlyBudgetUsd: e.target.value === "" ? null : Number(e.target.value) })} />
        </div>
        <div>
          <Label htmlFor={`m-${row.providerId}`}>{t("aicc.alerts.maxRequest")}</Label>
          <Input id={`m-${row.providerId}`} type="number" min={0} step={0.5}
            value={form.maxRequestUsd ?? ""}
            placeholder={t("aicc.alerts.noLimit")}
            onChange={(e) => setForm({ ...form, maxRequestUsd: e.target.value === "" ? null : Number(e.target.value) })} />
        </div>
        <div>
          <Label htmlFor={`w-${row.providerId}`}>{t("aicc.alerts.warnAt")}</Label>
          <Input id={`w-${row.providerId}`} type="number" min={1} max={100} value={form.warnPercent}
            onChange={(e) => setForm({ ...form, warnPercent: Number(e.target.value) })} />
        </div>
        <div>
          <Label htmlFor={`c-${row.providerId}`}>{t("aicc.alerts.criticalAt")}</Label>
          <Input id={`c-${row.providerId}`} type="number" min={1} max={100} value={form.criticalPercent}
            onChange={(e) => setForm({ ...form, criticalPercent: Number(e.target.value) })} />
        </div>
      </div>

      <label className={cn("mt-4 flex cursor-pointer items-center gap-2.5 text-[13px]", !open && "hidden lg:flex")}>
        <input type="checkbox" checked={form.alertsEnabled} className="size-4 accent-[rgb(var(--accent))]"
          onChange={(e) => setForm({ ...form, alertsEnabled: e.target.checked })} />
        <BellRing size={14} aria-hidden className="text-faint" />
        {t("aicc.alerts.enabled")}
      </label>

      <div className={cn("mt-4 flex justify-end", !open && "hidden lg:flex")}>
        <Button size="sm" disabled={pending} onClick={save}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </div>
  );
}
