import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { CheckCircle2, ExternalLink, Plug } from "lucide-react";
import { providerStatuses } from "@/lib/server/image-tools";
import { secretStatuses } from "@/lib/server/secret-store";
import { providerSecretName, VAULT_SENTINEL } from "@/lib/server/provider-credentials";
import { encryptionAvailable } from "@/lib/server/crypto";
import { maskKey, providerState } from "@/lib/provider-status";
import { monthStart, readBudgetStatus } from "@/lib/services/ai-economics";
import { grovnewsEconomics, readToolEconomics, readUsageHistory } from "@/lib/services/api-economics";
import { readTokenPriceRows } from "@/lib/services/token-prices";
import { formatPln, ToolEconomicsTable, UsageHistoryList } from "@/components/admin/api-economics";
import { TokenPriceEditor } from "@/components/admin/token-prices";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AiTabs } from "@/components/admin/ai-tabs";
import { ProviderCard, type ProviderView } from "@/components/admin/provider-card";
import { ModelRow, type ModelView } from "@/components/admin/model-editor";
import { GenerationPriority, type PriorityModelOption } from "@/components/admin/generation-priority";
import { ProviderBudgets, type BudgetView } from "@/components/admin/provider-budget";
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

const TABS = ["dostawcy", "modele", "koszty", "historia", "alerty"] as const;
type Tab = (typeof TABS)[number];

export default async function AiModelsPage({ searchParams }: {
  searchParams: Promise<{ tab?: string; tool?: string; provider?: string; days?: string }>;
}) {
  const { tab: tabParam, tool, provider, days } = await searchParams;
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
      {tab === "koszty" && <CostsTab supabase={supabase} t={t} locale={locale} />}
      {tab === "historia" && <UsageTab supabase={supabase} t={t} locale={locale} toolFilter={tool} providerFilter={provider} days={days} />}
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
  const [{ data: providers }, { data: creds }, { data: toolModels }, spend] = await Promise.all([
    supabase.from("ai_providers").select("id, slug, name, active, ai_models(id, active, name, display_name)").order("name"),
    // Masked metadata only. Ciphertext never leaves the server, and the panel
    // shows the last four characters so an operator can tell two keys apart.
    supabase.from("ai_provider_credentials")
      .select("provider_id, encrypted_value, last_four, updated_at, last_tested_at, last_test_status, last_test_error_safe, last_test_latency_ms, base_url, last_image_test_at, last_image_test_status, last_image_test_error_safe, last_success_at, last_error_at, last_error_code"),
    supabase.from("ai_tool_models").select("tool_key, model_id"),
    readBudgetStatus(supabase),
  ]);

  // CAN THIS SERVER OPEN THE KEY? A vault copy always can; a pre-vault
  // ciphertext only when its decryption key is present. Asked of the vault's
  // status (configured / last four) — the value is never read for this.
  const vault = await secretStatuses(supabase, (creds ?? []).map((c) => providerSecretName(c.provider_id)));
  const legacyReadable = encryptionAvailable();
  const toolsByModel = new Map<string, Set<string>>();
  for (const r of toolModels ?? []) {
    const set = toolsByModel.get(r.model_id) ?? new Set<string>();
    set.add(r.tool_key); toolsByModel.set(r.model_id, set);
  }

  const credByProvider = new Map((creds ?? []).map((c) => [c.provider_id, c]));
  const spendById = new Map(spend.map((s) => [s.providerId, s]));
  const views: ProviderView[] = (providers ?? []).map((p) => {
    const c = credByProvider.get(p.id);
    const inVault = c ? vault.get(providerSecretName(p.id))?.configured === true : false;
    const readable = Boolean(c) && (inVault || (c!.encrypted_value !== VAULT_SENTINEL && legacyReadable));
    const tools = new Set<string>();
    for (const m of p.ai_models) for (const k of toolsByModel.get(m.id) ?? []) tools.add(k);
    const facts = c ? {
      readable, updatedAt: c.updated_at, lastTestedAt: c.last_tested_at, lastTestStatus: c.last_test_status,
      lastSuccessAt: c.last_success_at, lastErrorAt: c.last_error_at, lastErrorCode: c.last_error_code,
    } : null;
    const status = providerState(facts);
    return {
      id: p.id, slug: p.slug, name: p.name, active: p.active,
      modelsActive: p.ai_models.filter((m) => m.active).length,
      modelsTotal: p.ai_models.length,
      modelNames: p.ai_models.filter((m) => m.active).map((m) => m.display_name || m.name),
      toolKeys: [...tools].sort(),
      state: status.state, stateReason: status.reason,
      credential: c ? {
        masked: maskKey(c.last_four) ?? "••••", source: inVault ? "vault" : "legacy", readable,
        updatedAt: c.updated_at, lastTestedAt: c.last_tested_at,
        lastTestStatus: c.last_test_status, lastTestDetail: c.last_test_error_safe,
        latencyMs: c.last_test_latency_ms, baseUrl: c.base_url,
        lastImageTestAt: c.last_image_test_at, lastImageTestStatus: c.last_image_test_status,
        lastImageTestError: c.last_image_test_error_safe,
        lastSuccessAt: c.last_success_at, lastErrorAt: c.last_error_at, lastErrorCode: c.last_error_code,
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

/**
 * Per tool, today and 30 days: runs, credits, provider cost (with its basis),
 * the revenue customers actually PAID for those runs, and the margin where it
 * can really be computed. Credits are not money — a bonus or free run earns 0.
 */
async function CostsTab({ supabase, t, locale }: Ctx & { locale: string }) {
  const [econ, gn, prices] = await Promise.all([
    readToolEconomics(supabase),
    grovnewsEconomics(supabase),
    readTokenPriceRows(supabase),
  ]);
  const toolLabel = (k: string) => {
    const label = t(`aicc.toolName.${k}`);
    return label === `aicc.toolName.${k}` ? k : label;
  };
  const sum = (w: "today" | "days30") => econ.tools.reduce((acc, x) => {
    const a = x[w];
    acc.costKnown += a.cost.usdMicros; acc.unknown += a.cost.unknown; acc.revenue += a.revenueCents; acc.runs += a.runs;
    if (a.marginCents != null) { acc.margin += a.marginCents; acc.hasMargin = true; }
    return acc;
  }, { costKnown: 0, unknown: 0, revenue: 0, runs: 0, margin: 0, hasMargin: false });

  return (
    <div className="space-y-5">
      <div className="grid gap-4 [&>*]:min-w-0 md:grid-cols-2">
        {(["today", "days30"] as const).map((w) => {
          const s = sum(w);
          return (
            <div key={w} className="panel rounded-2xl p-4 sm:p-5" data-costs-summary={w}>
              <p className="overline">{t(`aicc.econ.${w}`)}</p>
              <div className="mt-3 grid grid-cols-2 gap-2.5 [&>*]:min-w-0">
                <Metric label={t("aicc.econ.runs")} value={String(s.runs)} />
                <Metric label={t("aicc.econ.apiCost")}
                  value={`${formatPln(Math.round((s.costKnown / 1_000_000) * econ.usdToPln * 100), locale)}${s.unknown ? ` + ${t("aicc.econ.plusUnknown", { n: s.unknown })}` : ""}`} />
                <Metric label={t("aicc.econ.revenue")} value={formatPln(s.revenue, locale)} accent />
                <Metric label={t("aicc.econ.margin")} value={s.hasMargin ? formatPln(s.margin, locale) : "—"} danger={s.hasMargin && s.margin < 0} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-faint">{t("aicc.econ.note", { fx: econ.usdToPln.toFixed(2) })}</p>
      {econ.truncated && <p className="text-xs text-warning">{t("aicc.econ.truncated")}</p>}

      <Card>
        <CardHeader title={t("aicc.econ.byTool")} sub={t("aicc.econ.byToolSub")} />
        <ToolEconomicsTable tools={econ.tools} usdToPln={econ.usdToPln} locale={locale} t={t} toolLabel={toolLabel} />
      </Card>

      <GrovNewsEconomicsCard gn={gn} usdToPln={econ.usdToPln} locale={locale} t={t} />

      <Card>
        <CardHeader title={t("aicc.prices.title")} sub={t("aicc.prices.sub")} />
        <div className="p-4 sm:p-5">
          <TokenPriceEditor rows={prices} />
        </div>
      </Card>
    </div>
  );
}

function GrovNewsEconomicsCard({ gn, usdToPln, locale, t }: {
  gn: Awaited<ReturnType<typeof grovnewsEconomics>>; usdToPln: number; locale: string; t: Ctx["t"];
}) {
  const cost = (w: { aiCostUsdMicros: number; aiCalls: number; unknownCostCalls: number }) =>
    `${formatPln(Math.round((w.aiCostUsdMicros / 1_000_000) * usdToPln * 100), locale)}${w.unknownCostCalls ? ` + ${t("aicc.econ.plusUnknown", { n: w.unknownCostCalls })}` : ""}`;
  return (
    <Card data-grovnews-economics>
      <CardHeader title={t("aicc.econ.grovnews.title")} sub={t("aicc.econ.grovnews.sub")} />
      <div className="grid grid-cols-2 gap-2.5 p-4 [&>*]:min-w-0 sm:p-5 lg:grid-cols-4">
        <Metric label={t("aicc.econ.grovnews.aiToday")} value={cost(gn.today)} />
        <Metric label={t("aicc.econ.grovnews.ai30")} value={cost(gn.days30)} />
        <Metric label={t("aicc.econ.grovnews.editions")} value={String(gn.editions30)} />
        <Metric label={t("aicc.econ.grovnews.paid")} value={String(gn.activePaid)} />
        <Metric label={t("aicc.econ.grovnews.mrr")} value={formatPln(gn.mrrCents, locale)} accent />
        <Metric label={t("aicc.econ.grovnews.revenue30")} value={formatPln(gn.revenue30Cents, locale)} />
        <Metric label={t("aicc.econ.grovnews.grants")} value={t("aicc.econ.grovnews.grantsValue", { promo: gn.promoActive, launch: gn.launchActive, admin: gn.adminGrants })} />
        <Metric label={t("aicc.econ.grovnews.margin")} value={gn.margin30Cents == null ? "—" : formatPln(gn.margin30Cents, locale)} danger={(gn.margin30Cents ?? 0) < 0} />
      </div>
      <p className="border-t border-line px-5 py-2.5 text-xs text-faint">{t("aicc.econ.grovnews.note")}</p>
    </Card>
  );
}

/* ── HISTORIA UŻYCIA ──────────────────────────────────────────────────────*/

async function UsageTab({ supabase, t, locale, toolFilter, providerFilter, days }: Ctx & {
  locale: string; toolFilter?: string; providerFilter?: string; days?: string;
}) {
  const nDays = [1, 7, 30, 90].includes(Number(days)) ? Number(days) : 7;
  const tool = toolFilter && /^[a-z0-9_]{2,64}$/.test(toolFilter) ? toolFilter : null;
  const provider = providerFilter && /^[a-z0-9_-]{2,40}$/.test(providerFilter) ? providerFilter : null;
  const history = await readUsageHistory(supabase, { toolKey: tool, provider, days: nDays, limit: 200 });
  const toolLabel = (k: string) => {
    const label = t(`aicc.toolName.${k}`);
    return label === `aicc.toolName.${k}` ? k : label;
  };
  const href = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams({ tab: "historia" });
    const cur: Record<string, string | null> = { days: String(nDays), tool, provider, ...patch };
    for (const [k, v] of Object.entries(cur)) if (v) q.set(k, v);
    return `/admin/ai/modele?${q.toString()}`;
  };
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-1 rounded-xl bg-raised p-1" aria-label={t("aicc.econ.window")}>
        {[1, 7, 30, 90].map((d) => (
          <Link key={d} href={href({ days: String(d) })} scroll={false}
            aria-current={d === nDays ? "true" : undefined}
            className={cn("min-h-[32px] rounded-lg px-3 text-[13px] font-semibold leading-8 transition-colors",
              d === nDays ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}>
            {t("aicc.econ.lastDays", { n: d })}
          </Link>
        ))}
      </nav>
      {(tool || provider) && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {tool && <Badge tone="accent">{toolLabel(tool)}</Badge>}
          {provider && <Badge tone="accent">{provider}</Badge>}
          <Link href={href({ tool: null, provider: null })} className="text-accent hover:underline">{t("aicc.econ.clearFilter")}</Link>
        </p>
      )}
      <Card>
        <CardHeader title={t("aicc.econ.historyTitle")} sub={t("aicc.econ.historySub")} />
        <UsageHistoryList rows={history.rows} usdToPln={history.usdToPln} locale={locale} t={t} toolLabel={toolLabel} />
      </Card>
      {history.truncated && <p className="text-xs text-warning">{t("aicc.econ.truncated")}</p>}
    </div>
  );
}

function Metric({ label, value, accent, danger }: {
  label: string; value: string; accent?: boolean; danger?: boolean;
}) {
  return (
    <div className="rounded-xl bg-raised px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">{label}</p>
      <p className={cn("mt-1 font-display text-[15px] font-semibold tabular-nums", accent && "text-accent", danger && "text-danger")}>{value}</p>
    </div>
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
