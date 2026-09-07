import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getAvailabilityMap } from "@/lib/server/feature-availability";
import {
  isAiToolKey, readPromptHistory, readToolRegistry, toolTabs, type ToolTab,
} from "@/lib/services/ai-tools";
import { billingFrom } from "@/lib/images/pricing";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToolConfigForm } from "@/components/admin/tool-basics";
import { ToolPromptEditor } from "@/components/admin/tool-prompt";
import { ToolModelPicker } from "@/components/admin/tool-models";
import { ToolKnowledge } from "@/components/admin/tool-knowledge";
import { RelativeTime } from "@/components/ui/relative-time";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * ONE TOOL, ONE WORKSPACE.
 *
 * Tabs are URL state, not component state: an operator can link a colleague
 * straight to the engine of a tool, the back button behaves, and each tab
 * fetches only what it needs instead of every tab paying for the heaviest one.
 */

const WINDOWS = [7, 30, 90] as const;

export default async function ToolWorkspace({ params, searchParams }: {
  params: Promise<{ tool: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tool } = await params;
  const { tab: tabParam } = await searchParams;
  if (!isAiToolKey(tool)) notFound();

  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);

  const availability = await getAvailabilityMap(supabase);
  const registry = await readToolRegistry(supabase, availability);
  const row = registry.find((r) => r.key === tool);
  if (!row) notFound();

  const tabs = toolTabs(row);
  const tab: ToolTab = (tabs as string[]).includes(tabParam ?? "") ? (tabParam as ToolTab) : tabs[0];

  const config = {
    toolKey: row.key,
    engineMode: row.engineMode,
    serviceSlug: row.serviceSlug,
    allowModelChoice: row.allowModelChoice,
    fallbackEnabled: row.fallbackEnabled,
    // The stored values are what the form must round-trip; the registry row
    // does not carry them because the list has no use for them.
    timeoutMs: 120000,
    maxAttempts: 1,
    notes: null as string | null,
  };
  const { data: stored } = await supabase
    .from("ai_tools").select("timeout_ms, max_attempts, notes").eq("tool_key", row.key).maybeSingle();
  if (stored) {
    config.timeoutMs = stored.timeout_ms;
    config.maxAttempts = stored.max_attempts;
    config.notes = stored.notes;
  }

  return (
    <div>
      <div className="mb-4">
        <Link href="/admin/ai" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
          <ArrowLeft size={14} aria-hidden /> {t("aicc.tools.title")}
        </Link>
      </div>

      <PageHeader
        overline={t(`aicc.category.${row.category}`)}
        title={t(row.nameKey)}
        sub={row.path ? row.path : undefined}
        action={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={row.status === "ACTIVE" ? "success" : row.status === "DISABLED" ? "danger" : "accent"} dot>
              {t(`featAdm.status.${row.status}`)}
            </Badge>
            <Badge tone={row.engineMode === "off" ? "neutral" : "accent"}>
              {t(`aicc.engine.${row.engineMode}`)}
            </Badge>
          </span>
        }
      />

      <nav aria-label={t("aicc.tabsLabel")}
        className="-mx-1 mb-5 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((key) => (
          <Link key={key} href={`/admin/ai/${row.key}?tab=${key}`} scroll={false}
            aria-current={key === tab ? "page" : undefined}
            className={cn(
              "inline-flex h-9 shrink-0 items-center rounded-lg px-3 text-[13px] font-semibold transition-colors",
              key === tab ? "bg-raised text-ink" : "text-muted hover:text-ink",
            )}>
            {t(`aicc.tab.${key}`)}
          </Link>
        ))}
      </nav>

      {tab === "basics" && <BasicsTab supabase={supabase} t={t} row={row} config={config} />}
      {tab === "engine" && <EngineTab supabase={supabase} t={t} row={row} config={config} locale={locale} />}
      {tab === "models" && <ModelsTab supabase={supabase} t={t} row={row} config={config} />}
      {tab === "knowledge" && <KnowledgeTab supabase={supabase} t={t} row={row} locale={locale} />}
      {tab === "economics" && <EconomicsTab supabase={supabase} t={t} row={row} />}
      {tab === "history" && <HistoryTab supabase={supabase} t={t} row={row} locale={locale} />}
    </div>
  );
}

type Ctx = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  t: (key: string, values?: Record<string, string | number>) => string;
  row: Awaited<ReturnType<typeof readToolRegistry>>[number];
};
type WithConfig = Ctx & { config: Parameters<typeof ToolConfigForm>[0]["initial"] };

/* ── PODSTAWOWE ───────────────────────────────────────────────────────────*/

async function BasicsTab({ supabase, t, row, config }: WithConfig) {
  const { data: services } = await supabase
    .from("service_catalog").select("slug, name, credits_cost").order("category").order("name");

  return (
    <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-[1fr_320px]">
      <Card className="p-5">
        <ToolConfigForm section="basics" initial={config}
          services={(services ?? []).map((s) => ({ slug: s.slug, name: s.name, credits: s.credits_cost }))} />
      </Card>

      <Card className="p-5">
        <p className="overline mb-3 text-[9.5px]">{t("aicc.basics.identity")}</p>
        <dl className="space-y-2.5 text-[13px]">
          <Fact label={t("aicc.basics.key")} value={<code className="font-mono text-xs">{row.key}</code>} />
          <Fact label={t("aicc.basics.route")} value={row.path || "—"} />
          <Fact label={t("common.category")} value={t(`aicc.category.${row.category}`)} />
          <Fact label={t("common.status")} value={t(`featAdm.status.${row.status}`)} />
          <Fact label={t("aicc.basics.menu")}
            value={row.hiddenFromMenu ? t("aicc.basics.hidden") : t("aicc.basics.visible")} />
        </dl>
        {/*
          Status and menu visibility are NOT edited here. They belong to the
          availability switchboard that the customer menu and the route guards
          read; a second switch would be a way for two screens to disagree
          about whether a tool is live.
        */}
        <Link href="/admin/settings/features"
          className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent hover:opacity-75">
          {t("aicc.basics.editStatus")} <ExternalLink size={13} aria-hidden />
        </Link>
      </Card>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{value}</dd>
    </div>
  );
}

/* ── SILNIK ───────────────────────────────────────────────────────────────*/

async function EngineTab({ supabase, t, row, config, locale }: WithConfig & { locale: string }) {
  const versions = await readPromptHistory(supabase, row.key);
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <CardHeader title={t("aicc.engine.title")} sub={t("aicc.engine.sub")} />
        <div className="pt-4">
          <ToolConfigForm section="engine" initial={config} services={[]} />
        </div>
      </Card>
      <ToolPromptEditor toolKey={row.key} versions={versions} locale={locale}
        hasEngine={row.engineMode === "grovbase" || row.engineMode === "hybrid"} />
    </div>
  );
}

/* ── MODELE ───────────────────────────────────────────────────────────────*/

async function ModelsTab({ supabase, t, row, config }: WithConfig) {
  const { data: models } = await supabase
    .from("ai_models")
    .select("id, name, display_name, active, credit_cost, ai_providers(name)")
    .order("sort_order", { ascending: true });

  const pickable = ((models ?? []) as unknown as {
    id: string; name: string; display_name: string | null; active: boolean;
    credit_cost: number; ai_providers: { name: string } | null;
  }[]).map((m) => ({
    id: m.id,
    name: m.display_name || m.name,
    providerName: m.ai_providers?.name ?? "—",
    active: m.active,
    credits: m.credit_cost,
  }));

  return (
    <Card className="p-5">
      <CardHeader title={t("aicc.models.title")} sub={t("aicc.models.sub")} />
      <div className="pt-4">
        <ToolModelPicker
          toolKey={row.key}
          models={pickable}
          config={config}
          initial={{
            primaryId: row.models.find((m) => m.role === "primary")?.id ?? null,
            fallbackId: row.models.find((m) => m.role === "fallback")?.id ?? null,
            allowedIds: row.models.filter((m) => m.role === "allowed").map((m) => m.id),
          }}
        />
      </div>
    </Card>
  );
}

/* ── WIEDZA ───────────────────────────────────────────────────────────────*/

async function KnowledgeTab({ supabase, t, row, locale }: Ctx & { locale: string }) {
  const [{ data: sets }, { data: assigned }] = await Promise.all([
    supabase.from("knowledge_sets")
      .select("id, name, status, file_count, updated_at")
      .order("updated_at", { ascending: false }).limit(100),
    supabase.from("ai_tool_knowledge").select("set_id").eq("tool_key", row.key),
  ]);
  const setIds = (sets ?? []).map((s) => s.id);
  const { data: examples } = setIds.length
    ? await supabase.from("knowledge_examples").select("set_id").in("set_id", setIds).limit(20000)
    : { data: [] as { set_id: string }[] };
  const exampleCount = new Map<string, number>();
  for (const e of examples ?? []) exampleCount.set(e.set_id, (exampleCount.get(e.set_id) ?? 0) + 1);
  const assignedIds = new Set((assigned ?? []).map((a) => a.set_id));

  return (
    <div>
      <Card className="mb-4 p-5">
        <CardHeader title={t("aicc.knowledge.title")} sub={t("aicc.knowledge.sub")} />
      </Card>
      <ToolKnowledge toolKey={row.key} locale={locale}
        sets={(sets ?? []).map((s) => ({
          id: s.id, name: s.name, status: s.status,
          examples: exampleCount.get(s.id) ?? 0,
          files: s.file_count ?? 0,
          updatedAt: s.updated_at,
          assigned: assignedIds.has(s.id),
        }))} />
    </div>
  );
}

/* ── EKONOMIA ─────────────────────────────────────────────────────────────*/

async function EconomicsTab({ supabase, t, row }: Ctx) {
  if (!row.serviceSlug) return null;
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const [{ data: events }, { data: billingRow }] = await Promise.all([
    supabase.from("usage_events")
      .select("status, credits_charged, api_cost_usd_micros_snapshot, actual_api_cost_usd_micros, created_at")
      .eq("service_slug", row.serviceSlug)
      .gte("created_at", since)
      .limit(20000),
    supabase.from("app_settings").select("value").eq("key", "billing").maybeSingle(),
  ]);
  const billing = billingFrom(billingRow?.value);
  const rows = events ?? [];

  const slice = (days: number) => {
    const from = Date.now() - days * 86_400_000;
    const inWindow = rows.filter((e) => new Date(e.created_at).getTime() >= from);
    const billed = inWindow.filter((e) => e.status !== "refunded");
    const credits = billed.reduce((s, e) => s + e.credits_charged, 0);
    // The REAL recorded cost wins; the catalogue snapshot is only a fallback
    // for events written before per-call costs were captured.
    const costUsd = billed.reduce(
      (s, e) => s + (e.actual_api_cost_usd_micros || e.api_cost_usd_micros_snapshot), 0) / 1_000_000;
    const revenue = credits * billing.plnPerCredit;
    const cost = costUsd * billing.usdToPln;
    return {
      days,
      runs: inWindow.length,
      failed: inWindow.filter((e) => e.status === "failed" || e.status === "refunded").length,
      credits,
      cost,
      revenue,
      profit: revenue - cost,
      margin: revenue > 0 ? ((revenue - cost) / revenue) * 100 : null,
    };
  };

  const pln = (v: number) => `${v.toFixed(2)} zł`;

  return (
    <Card>
      <CardHeader title={t("aicc.economics.title")} sub={t("aicc.economics.sub")} />
      <div className="table-scroll thin-scroll overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-faint">
              {[t("aicc.economics.window"), t("aicc.economics.runs"), t("aicc.economics.failed"),
                t("nav.credits"), t("aicc.economics.apiCost"), t("aicc.economics.revenue"),
                t("aicc.economics.profit"), t("aicc.economics.margin")].map((h) => (
                <th key={h} className="whitespace-nowrap px-5 py-2.5 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WINDOWS.map((days) => {
              const s = slice(days);
              return (
                <tr key={days} className="border-t border-line">
                  <td className="whitespace-nowrap px-5 py-2.5 font-medium">{t("aicc.economics.lastDays", { n: days })}</td>
                  <td className="px-5 py-2.5 tabular-nums">{s.runs}</td>
                  <td className={cn("px-5 py-2.5 tabular-nums", s.failed > 0 && "text-danger")}>{s.failed}</td>
                  <td className="px-5 py-2.5 tabular-nums">{s.credits}</td>
                  <td className="px-5 py-2.5 tabular-nums">{pln(s.cost)}</td>
                  <td className="px-5 py-2.5 tabular-nums">{pln(s.revenue)}</td>
                  <td className={cn("px-5 py-2.5 tabular-nums", s.profit < 0 && "text-danger")}>{pln(s.profit)}</td>
                  <td className="px-5 py-2.5 tabular-nums">
                    {s.margin === null ? "—" : (
                      <Badge tone={s.margin >= billing.minMarginPercent ? "success" : "danger"}>
                        {Math.round(s.margin)}%
                      </Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-5 py-2.5 text-xs text-faint">
        {t("aicc.economics.assumptions", {
          credit: billing.plnPerCredit.toFixed(2),
          fx: billing.usdToPln.toFixed(2),
        })}
      </p>
    </Card>
  );
}

/* ── HISTORIA ─────────────────────────────────────────────────────────────*/

async function HistoryTab({ supabase, t, row, locale }: Ctx & { locale: string }) {
  if (!row.serviceSlug) return null;
  const { data: events } = await supabase
    .from("usage_events")
    .select("id, status, credits_charged, actual_api_cost_usd_micros, model_slug, provider_slug, error, created_at")
    .eq("service_slug", row.serviceSlug)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <Card>
      <CardHeader title={t("aicc.history.title")} sub={t("aicc.history.sub")} />
      {(events ?? []).length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted">{t("aicc.history.empty")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {(events ?? []).map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-2.5">
              <Badge tone={e.status === "succeeded" ? "success" : e.status === "failed" ? "danger" : "neutral"}>
                {e.status}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
                {[e.model_slug, e.provider_slug].filter(Boolean).join(" · ") || "—"}
                {/* The safe error string only — provider payloads never land here. */}
                {e.error ? ` — ${e.error}` : ""}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-faint">
                {e.credits_charged} kr.
                {e.actual_api_cost_usd_micros
                  ? ` · $${(e.actual_api_cost_usd_micros / 1_000_000).toFixed(4)}`
                  : ""}
              </span>
              <span className="shrink-0 text-xs text-faint" title={formatDate(e.created_at, locale)}>
                <RelativeTime at={e.created_at} locale={locale} t={t} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
