import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RelativeTime } from "@/components/ui/relative-time";
import { formatUsd } from "@/components/admin/api-economics";
import { SmartPromptSettingsForm } from "@/components/admin/smart-prompt-settings";
import type { SmartPromptAdmin } from "@/lib/server/smart-prompt-admin";

type T = (key: string, values?: Record<string, string | number>) => string;

/**
 * INTELIGENTNY PROMPT on the generator's admin page: can it run (and what
 * blocks it), the settings form, and 30 days of use — runs and credits from
 * the ledger, requests, tokens and provider cost from the trace.
 */
export function SmartPromptAdminCard({ data, t, locale }: { data: SmartPromptAdmin; t: T; locale: string }) {
  const u = data.usage;
  const ready = data.blockers.length === 0;
  return (
    <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-[1fr_320px]" data-smart-prompt-admin>
      <Card className="p-5">
        <CardHeader title={t("aicc.smart.title")} sub={t("aicc.smart.sub")}
          action={
            <span data-smart-ready={ready ? "ready" : "blocked"}>
              <Badge tone={ready ? "success" : "warning"} dot>{ready ? t("aicc.smart.ready") : t("aicc.smart.blocked")}</Badge>
            </span>
          } />
        {!ready && (
          <ul className="mt-3 space-y-1 rounded-xl bg-raised px-4 py-3 text-[12.5px] text-muted" data-smart-blockers>
            {data.blockers.map((b) => <li key={b}>• {t(`aicc.smart.blocker.${b}`)}</li>)}
          </ul>
        )}
        <div className="pt-4">
          {data.config && data.credits !== null ? (
            <SmartPromptSettingsForm
              initial={{
                enabled: data.enabled, credits: Math.max(1, data.credits),
                provider: data.config.provider, model: data.config.model ?? "", instruction: data.config.instruction ?? "",
              }}
              defaultInstruction={data.defaultInstruction}
            />
          ) : (
            <p className="text-[13px] text-muted">{t("aicc.smart.err.migration_pending")}</p>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <p className="overline mb-3 text-[9.5px]">{t("aicc.smart.usage", { n: u.days })}</p>
        <dl className="space-y-2.5 text-[13px]" data-smart-usage>
          <Fact label={t("aicc.smart.u.runs")} value={`${u.succeeded} / ${u.runs}`} />
          <Fact label={t("aicc.smart.u.refunded")} value={String(u.refunded + u.pending)} />
          <Fact label={t("aicc.smart.u.credits")} value={String(u.credits)} />
          <Fact label={t("aicc.smart.u.calls")} value={u.failedCalls > 0 ? `${u.calls} (${t("aicc.smart.u.failed", { n: u.failedCalls })})` : String(u.calls)} />
          <Fact label={t("aicc.smart.u.tokens")} value={`${u.inputTokens.toLocaleString(locale)} / ${u.outputTokens.toLocaleString(locale)}`} />
          <Fact label={t("aicc.smart.u.cost")} value={u.calls === 0 ? "—" : formatUsd(u.apiCostUsdMicros, locale)} />
          {u.unpricedCalls > 0 && (
            <p className="rounded-lg bg-[rgb(var(--warning)/0.1)] px-3 py-2 text-[11.5px] text-muted" data-smart-unpriced>
              {t("aicc.smart.u.unpriced", { n: u.unpricedCalls })}{" "}
              <Link href="/admin/ai/modele" className="font-semibold text-accent hover:opacity-75">{t("aicc.smart.u.prices")}</Link>
            </p>
          )}
          {u.models.length > 0 && (
            <Fact label={t("aicc.smart.u.models")} value={
              <span className="flex flex-col items-end gap-0.5 font-mono text-[11.5px]">
                {u.models.slice(0, 4).map((m) => <span key={`${m.provider}/${m.model}`}>{m.provider}/{m.model} · {m.calls}</span>)}
              </span>
            } />
          )}
          <Fact label={t("aicc.smart.u.last")} value={u.lastAt ? <RelativeTime at={u.lastAt} locale={locale} t={t} /> : "—"} />
        </dl>
        <Link href="/admin/services" className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent hover:opacity-75">
          {t("aicc.smart.services")} <ExternalLink size={13} aria-hidden />
        </Link>
      </Card>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-medium tabular-nums">{value}</dd>
    </div>
  );
}
