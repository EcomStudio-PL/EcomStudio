import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { CheckCircle2, ExternalLink, Plug } from "lucide-react";
import { providerStatuses } from "@/lib/server/image-tools";
import {
  groupBy, monthStart, periodStart, readBudgetStatus, readUsage, summarise,
  type PeriodKey,
} from "@/lib/services/ai-economics";
import type { BillingConfig } from "@/lib/images/pricing";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AiTabs } from "@/components/admin/ai-tabs";
import { ProviderCard, type ProviderView } from "@/components/admin/provider-card";
import { ModelRow, type ModelView } from "@/components/admin/model-editor";
import { GenerationPriority, type PriorityModelOption } from "@/components/admin/generation-priority";
import { ProviderBudgets, type BudgetView } from "@/components/admin/provider-budget";
import { CostTable, type CostRow } from "@/components/admin/cost-table";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * AI I GENEROWANIE → MODELE, API I KOSZTY.
 *
 * Four tabs where there used to be three screens and a spreadsheet: who we buy
 * from, what we run, what it cost against what we charged, and when to be told
 * about it.
 *
 * The provider and model cards are the ones that already worked — this page
 * gives them a home and adds the two things they never had: month-to-date
 * spend per provider, and a budget to measure it against.
 */

const TABS = ["dostawcy", "modele", "koszty", "alerty"] as const;
type Tab = (typeof TABS)[number];

export default async function AiModelsPage({ searchParams }: {
  searchParams: Promise<{ tab?: string; period?: string }>;
}) {
  const { tab: tabParam, period: periodParam } = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "dostawcy";

  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);

  return (
    <div>
      <PageHeader
        overline={t("admin.navGroups.ai")}
        title={t("aicc.models.pageTitle")}
        sub={t("aicc.models.pageSub")}
      />
      <AiTabs />

      <nav aria-label={t("aicc.models.pageTitle")}
        className="-mx-1 mb-5 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((key) => (
          <Link key={key} href={`/admin/ai/modele?tab=${key}`} scroll={false}
            aria-current={key === tab ? "page" : undefined}
            className={cn(
              "inline-flex h-9 shrink-0 items-center rounded-lg px-3 text-[13px] font-semibold transition-colors",
              key === tab ? "bg-raised text-ink" : "text-muted hover:text-ink",
            )}>
            {t(`aicc.models.tab.${key}`)}
          </Link>
        ))}
      </nav>

      {tab === "dostawcy" && <ProvidersTab supabase={supabase} t={t} locale={locale} />}
      {tab === "modele" && <ModelsTab supabase={supabase} t={t} locale={locale} />}
      {tab === "koszty" && <CostsTab supabase={supabase} t={t} locale={locale} period={periodParam} />}
      {tab === "alerty" && <AlertsTab supabase={supabase} />}
    </div>
  );
}

type Ctx = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  t: (key: string, values?: Record<string, string | number>) => string;
};

/* ── DOSTAWCY ─────────────────────────────────────────────────────────────*/

async function ProvidersTab({ supabase, t, locale }: Ctx & { locale: string }) {
  const [{ data: providers }, { data: creds }, spend] = await Promise.all([
    supabase.from("ai_providers").select("id, slug, name, active, ai_models(id, active)").order("name"),
    // Masked metadata only. Ciphertext never leaves the server, and the panel
    // shows the last four characters so an operator can tell two keys apart.
    supabase.from("ai_provider_credentials")
      .select("provider_id, last_four, updated_at, last_tested_at, last_test_status, last_test_error_safe, base_url, last_image_test_at, last_image_test_status, last_image_test_error_safe"),
    readBudgetStatus(supabase),
  ]);

  const credByProvider = new Map((creds ?? []).map((c) => [c.provider_id, c]));
  const spendById = new Map(spend.map((s) => [s.providerId, s]));
  const views: ProviderView[] = (providers ?? []).map((p) => {
    const c = credByProvider.get(p.id);
    return {
      id: p.id, slug: p.slug, name: p.name, active: p.active,
      modelsActive: p.ai_models.filter((m) => m.active).length,
      modelsTotal: p.ai_models.length,
      credential: c ? {
        lastFour: c.last_four, updatedAt: c.updated_at, lastTestedAt: c.last_tested_at,
        lastTestStatus: c.last_test_status, lastTestError: c.last_test_error_safe,
        baseUrl: c.base_url, lastImageTestAt: c.last_image_test_at,
        lastImageTestStatus: c.last_image_test_status, lastImageTestError: c.last_image_test_error_safe,
      } : null,
    };
  });

  return (
    <div className="space-y-4">
      <p className="text-xs text-faint">{t("aicc.providers.monthNote", {
        from: monthStart().toISOString().slice(0, 10),
      })}</p>
      <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-2">
        {views.map((p) => {
          const s = spendById.get(p.id);
          return (
            <div key={p.id} className="space-y-2">
              <ProviderCard p={p} locale={locale} />
              {s && (
                <div className="panel flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-2.5 text-[13px]">
                  <span className="text-muted">
                    {t("aicc.providers.spend", { usd: (s.spentUsdMicros / 1_000_000).toFixed(2) })}
                    {" · "}
                    {t("aicc.alerts.requests", { n: s.requests })}
                  </span>
                  {s.percent === null ? (
                    <Badge tone="neutral">{t("aicc.alerts.noBudget")}</Badge>
                  ) : (
                    <Badge tone={s.level === "critical" ? "danger" : s.level === "warn" ? "warning" : "success"} dot>
                      {Math.round(s.percent)}%
                    </Badge>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <ToolBackends supabase={supabase} t={t} />
    </div>
  );
}

/**
 * The image tools do not buy from `ai_providers` — remove.bg, the upscalers
 * and the outpainting backends are resolved from their own credentials, and
 * the old Image Tools screen was the only place that said whether they were
 * connected. It moves here rather than disappearing with that screen.
 *
 * Never a key, only where the key would come from and whether one resolved.
 */
async function ToolBackends({ supabase, t }: Ctx) {
  const providers = await providerStatuses(supabase);
  const connected = providers.filter((p) => p.status === "connected").length;

  return (
    <div className="panel rounded-2xl p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="overline">{t("admin.tools.providers")}</p>
        <Badge tone={connected > 0 ? "success" : "neutral"} dot>
          {t("admin.tools.connectedCount", { n: connected, total: providers.length })}
        </Badge>
      </div>
      <div className="grid gap-2.5 [&>*]:min-w-0 sm:grid-cols-2 xl:grid-cols-3">
        {providers.map((p) => (
          <div key={p.slug} className="plate flex items-start gap-3 rounded-xl p-3">
            <span aria-hidden className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              p.status === "connected" ? "bg-[rgb(var(--success)/0.14)] text-success" : "bg-sunken text-faint",
            )}>
              {p.status === "connected" ? <CheckCircle2 size={16} /> : <Plug size={16} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-[13px] font-semibold">{p.label}</p>
                <Badge tone={p.status === "connected" ? "success" : "neutral"}>
                  {t(`admin.tools.status.${p.status}`)}
                </Badge>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-faint">
                {p.capabilities.map((c) => t(`admin.tools.cap.${c}`)).join(" · ")}
              </p>
              <p className="mt-1 font-mono text-[11px] text-muted">{p.envVar}</p>
              {p.status === "connected" ? (
                <p className="mt-0.5 text-[11px] text-faint">{t(`admin.tools.source.${p.source}`)}</p>
              ) : (
                <a href={p.keyUrl} target="_blank" rel="noreferrer noopener"
                  className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline">
                  {t("admin.tools.getKey")} <ExternalLink size={11} aria-hidden />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 rounded-xl bg-sunken/70 px-3 py-2.5 text-[12px] leading-relaxed text-muted">
        {t("admin.tools.keyNote")}
      </p>
    </div>
  );
}

/* ── MODELE ───────────────────────────────────────────────────────────────*/

async function ModelsTab({ supabase, t, locale }: Ctx & { locale: string }) {
  const [{ data: models }, { data: billing }, { data: generation }, { data: assignments }] =
    await Promise.all([
      supabase.from("ai_models").select("*, ai_providers(name, slug)").order("sort_order"),
      supabase.from("app_settings").select("value").eq("key", "billing").maybeSingle(),
      supabase.from("app_settings").select("value").eq("key", "generation").maybeSingle(),
      supabase.from("ai_tool_models").select("tool_key, model_id, role"),
    ]);

  const genCfg = (generation?.value ?? {}) as {
    provider_priority?: string[]; planner_provider?: string; planner_fallback?: string;
  };
  const priorityOptions: PriorityModelOption[] = (models ?? [])
    .filter((m) => m.active && m.supports_reference_images)
    .map((m) => ({
      key: `${(m.ai_providers as { slug?: string } | null)?.slug}:${m.model_identifier}`,
      label: `${m.display_name || m.name} (${m.ai_providers?.name ?? "?"})`,
    }))
    .filter((o, i, arr) => arr.findIndex((x) => x.key === o.key) === i);

  const b = (billing?.value ?? {}) as { price_per_100_credits?: number; usd_to_pln?: number };
  const plnPerCredit = (b.price_per_100_credits ?? 19) / 100;
  const usdToPln = b.usd_to_pln ?? 4.0;

  // Which tools name this model. The answer to "can I turn this off".
  const usedBy = new Map<string, string[]>();
  for (const a of assignments ?? []) {
    const list = usedBy.get(a.model_id) ?? [];
    list.push(a.tool_key);
    usedBy.set(a.model_id, list);
  }

  const views: ModelView[] = (models ?? []).map((m) => ({
    id: m.id, name: m.name, model_identifier: m.model_identifier, type: m.type, active: m.active,
    credit_cost: m.credit_cost, internal_cost_usd_micros: m.internal_cost_usd_micros,
    quality_tier: m.quality_tier, speed_tier: m.speed_tier,
    max_reference_images: m.max_reference_images,
    supports_reference_images: m.supports_reference_images,
    description: m.description, display_name: m.display_name, badge: m.badge, sort_order: m.sort_order,
    pricing: (m.pricing ?? {}) as Record<string, number>,
    supported_resolutions: m.supported_resolutions ?? ["1K"],
    providerName: m.ai_providers?.name ?? "—",
    ecom_surcharge_credits: (m as { ecom_surcharge_credits?: number }).ecom_surcharge_credits ?? 0,
    supported_aspect_ratios: m.supported_aspect_ratios ?? [],
    badge_tone: (m as { badge_tone?: string | null }).badge_tone ?? null,
    max_outputs: (m as { max_outputs?: number | null }).max_outputs ?? null,
    visible_managed: (m as { visible_managed?: boolean }).visible_managed !== false,
    visible_custom: (m as { visible_custom?: boolean }).visible_custom !== false,
    unavailableReason: (m.metadata as { unavailable_reason?: string } | null)?.unavailable_reason ?? null,
    unavailableNote: (m.metadata as { unavailable_note?: string } | null)?.unavailable_note ?? null,
  }));

  return (
    <div>
      <GenerationPriority options={priorityOptions} current={genCfg.provider_priority ?? []}
        planner={{ primary: genCfg.planner_provider ?? "openai", fallback: genCfg.planner_fallback ?? "" }} />
      <div className="space-y-3">
        {views.map((m) => (
          <div key={m.id}>
            <ModelRow m={m} usdToPln={usdToPln} plnPerCredit={plnPerCredit} locale={locale} />
            {(usedBy.get(m.id) ?? []).length > 0 && (
              <p className="mt-1 px-1 text-[11px] text-faint">
                {t("aicc.models.usedBy")}:{" "}
                {(usedBy.get(m.id) ?? []).map((k) => t(`aicc.toolName.${k}`)).join(" · ")}
              </p>
            )}
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-faint">{t("admin.costSourceOfTruth")}</p>
    </div>
  );
}

/* ── UŻYCIE I KOSZTY ──────────────────────────────────────────────────────*/

const PERIOD_TABS: PeriodKey[] = ["today", "week", "month", "quarter"];

async function CostsTab({ supabase, t, locale, period }: Ctx & { locale: string; period?: string }) {
  const active: PeriodKey = (PERIOD_TABS as string[]).includes(period ?? "")
    ? (period as PeriodKey) : "month";
  const { events, billing, truncated } = await readUsage(supabase, {
    since: periodStart(active).toISOString(),
  });
  const totals = summarise(events, billing);

  const byModel = groupBy(events, (e) => e.model_slug, billing);
  const byTool = groupBy(events, (e) => e.service_slug, billing);

  const rows: CostRow[] = events.map((e) => {
    const one = summarise([e], billing);
    return {
      id: e.id, createdAt: e.created_at, status: e.status,
      tool: e.service_slug, provider: e.provider_slug, model: e.model_slug,
      basis: one.measured ? "measured" : one.estimated ? "estimated" : "unknown",
      costUsd: one.costUsdMicros / 1_000_000,
      credits: one.credits, revenuePln: one.revenuePln, profitPln: one.profitPln,
    };
  });

  const pln = (v: number) => `${v.toFixed(2)} zł`;

  return (
    <div className="space-y-4">
      <nav className="flex gap-1 rounded-xl bg-raised p-1" aria-label={t("aicc.economics.window")}>
        {PERIOD_TABS.map((p) => (
          <Link key={p} href={`/admin/ai/modele?tab=koszty&period=${p}`} scroll={false}
            aria-current={p === active ? "true" : undefined}
            className={cn(
              "min-h-[32px] rounded-lg px-3 text-[13px] font-semibold leading-8 transition-colors",
              p === active ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
            )}>
            {t(`aicc.costs.period.${p}`)}
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-2 gap-2.5 [&>*]:min-w-0 lg:grid-cols-4">
        <Metric label={t("aicc.economics.apiCost")} value={pln(totals.costPln)} />
        <Metric label={t("aicc.economics.revenue")} value={pln(totals.revenuePln)} accent />
        <Metric label={t("aicc.economics.profit")} value={pln(totals.profitPln)}
          danger={totals.profitPln < 0} />
        <Metric label={t("aicc.economics.margin")}
          value={totals.marginPercent === null ? "—" : `${Math.round(totals.marginPercent)}%`} />
        <Metric label={t("aicc.economics.runs")} value={String(totals.requests)} />
        <Metric label={t("aicc.costs.succeeded")} value={String(totals.succeeded)} />
        <Metric label={t("aicc.economics.failed")} value={String(totals.failed)}
          danger={totals.failed > 0} />
        <Metric label={t("nav.credits")} value={String(totals.credits)} />
      </div>

      {/*
        How many of those cost figures we actually measured. A screen that
        cannot say this is a screen that quietly presents estimates as facts.
      */}
      <p className="text-xs text-faint">
        {t("aicc.costs.basisSummary", {
          measured: totals.measured, estimated: totals.estimated, unknown: totals.unknown,
        })}
      </p>

      <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-2">
        <Breakdown title={t("aicc.costs.byModel")} rows={byModel} billing={billing} t={t} />
        <Breakdown title={t("aicc.costs.byTool")} rows={byTool} billing={billing} t={t} />
      </div>

      <CostTable rows={rows} locale={locale} truncated={truncated} />
    </div>
  );
}

function Metric({ label, value, accent, danger }: {
  label: string; value: string; accent?: boolean; danger?: boolean;
}) {
  return (
    <div className="panel min-w-0 rounded-2xl px-4 py-3">
      <p className="overline text-[9.5px]">{label}</p>
      <p className={cn("metric mt-1 truncate text-[1.3rem]",
        danger ? "text-danger" : accent ? "text-accent2" : "text-ink")}>{value}</p>
    </div>
  );
}

function Breakdown({ title, rows, billing, t }: {
  title: string;
  rows: { key: string; totals: ReturnType<typeof summarise> }[];
  billing: BillingConfig;
  t: Ctx["t"];
}) {
  return (
    <Card>
      <CardHeader title={title} />
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted">{t("aicc.costs.empty")}</p>
      ) : (
        <div className="table-scroll thin-scroll overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-faint">
                {["", t("aicc.economics.runs"), t("aicc.economics.apiCost"),
                  t("aicc.economics.revenue"), t("aicc.economics.margin")].map((h, i) => (
                  <th key={i} className="whitespace-nowrap px-5 py-2 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 12).map((r) => (
                <tr key={r.key} className="border-t border-line">
                  <td className="max-w-[180px] truncate px-5 py-2 font-medium">{r.key}</td>
                  <td className="px-5 py-2 tabular-nums">{r.totals.requests}</td>
                  <td className="whitespace-nowrap px-5 py-2 tabular-nums">{r.totals.costPln.toFixed(2)} zł</td>
                  <td className="whitespace-nowrap px-5 py-2 tabular-nums">{r.totals.revenuePln.toFixed(2)} zł</td>
                  <td className="px-5 py-2">
                    {r.totals.marginPercent === null ? "—" : (
                      <Badge tone={r.totals.marginPercent >= billing.minMarginPercent ? "success" : "danger"}>
                        {Math.round(r.totals.marginPercent)}%
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ── ALERTY ───────────────────────────────────────────────────────────────*/

async function AlertsTab({ supabase }: Pick<Ctx, "supabase">) {
  const statuses = await readBudgetStatus(supabase);
  const rows: BudgetView[] = statuses.map((s) => ({
    providerId: s.providerId,
    providerName: s.providerName,
    spentUsd: s.spentUsdMicros / 1_000_000,
    requests: s.requests,
    failureRate: s.failureRate,
    percent: s.percent,
    level: s.level,
    monthlyBudgetUsd: s.budget?.monthlyBudgetUsdMicros
      ? s.budget.monthlyBudgetUsdMicros / 1_000_000 : null,
    warnPercent: s.budget?.warnPercent ?? 75,
    criticalPercent: s.budget?.criticalPercent ?? 90,
    maxRequestUsd: s.budget?.maxRequestUsdMicros ? s.budget.maxRequestUsdMicros / 1_000_000 : null,
    failureRatePercent: s.budget?.failureRatePercent ?? null,
    alertsEnabled: s.budget?.alertsEnabled ?? true,
  }));
  return <ProviderBudgets rows={rows} />;
}
