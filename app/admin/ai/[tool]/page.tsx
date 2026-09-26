import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getAvailabilityMap } from "@/lib/server/feature-availability";
import {
  isAiToolKey, readBillingServices, readPickableModels, readPromptHistory, readToolRegistry,
  readWorkflowHistory, toolHasPromptEngine, toolSupportsWorkflow, toolTabs, type ToolTab,
} from "@/lib/services/ai-tools";
import { readEngineAnalytics, readEngineRuns } from "@/lib/services/ai-engine-analytics";
import { TOOL_VARIABLES } from "@/lib/ai/prompt-variables";
import { MIN_SAMPLE } from "@/lib/ai/knowledge-ranking";
import { getUsableModels } from "@/lib/ai/router";
import { billingFrom } from "@/lib/images/pricing";
import { STATUS_TONE } from "@/lib/status-tone";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToolConfigForm } from "@/components/admin/tool-basics";
import { PromptDraftProvider, ToolPromptEditor, ToolPromptHistory } from "@/components/admin/tool-prompt";
import { ToolModelPicker } from "@/components/admin/tool-models";
import { KnowledgeImport, KnowledgeReview, ToolKnowledge, type ReviewItem } from "@/components/admin/tool-knowledge";
import { WorkflowBuilder } from "@/components/admin/workflow-builder";
import { EngineDryRun, KnowledgeStrategyForm } from "@/components/admin/engine-panels";
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

  // The stored values are what the form must round-trip — the registry row
  // carries them, so no second read of `ai_tools` is needed.
  const config = {
    toolKey: row.key,
    engineMode: row.engineMode,
    serviceSlug: row.serviceSlug,
    allowModelChoice: row.allowModelChoice,
    fallbackEnabled: row.fallbackEnabled,
    timeoutMs: row.timeoutMs,
    maxAttempts: row.maxAttempts,
    notes: row.notes,
  };

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
            <Badge tone={STATUS_TONE[row.status]} dot>
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
  const services = await readBillingServices(supabase);

  return (
    <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-[1fr_320px]">
      <Card className="p-5">
        {!toolHasPromptEngine(row.key) && (
          <p className="mb-4 rounded-xl bg-raised px-4 py-3 text-[13px] text-muted" data-no-ai>
            {t(noEngineKey(row.key, row.category))}
          </p>
        )}
        <ToolConfigForm section="basics" initial={config} services={services} />
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
          Status and visibility are NOT edited here. They belong to the
          availability switchboard that the customer menu and the route guards
          read, and it is edited in one place — this tool's row on the
          Narzędzia i silniki screen, opened by this link. A second switch
          would be a way for two screens to disagree about whether a tool is live.
        */}
        <Link href={`/admin/ai?tool=${row.key}`}
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

/** What a tool without a prompt engine says instead of an empty editor. */
function noEngineKey(key: string, category: string): string {
  if (key === "video") return "aicc.engine.noEngineVideo";
  return category === "local" ? "aicc.engine.noAi" : "aicc.engine.noPrompt";
}

function Section({ n, title, sub, children }: { n: number; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <Card className="p-4 sm:p-5" data-engine-section={n}>
      <CardHeader title={`${n}. ${title}`} sub={sub} />
      <div className="pt-4">{children}</div>
    </Card>
  );
}

/**
 * THE ENGINE, IN SIX NUMBERED SECTIONS: 1 mode · 2 prompt / workflow ·
 * 3 variables · 4 execution · 5 test · 6 versions. Models, prices and
 * providers stay on their own tab ("Modele, API i koszty").
 */
async function EngineTab({ supabase, t, row, config, locale }: WithConfig & { locale: string }) {
  if (!toolHasPromptEngine(row.key)) {
    return (
      <Card className="p-5">
        <p className="text-[13px] text-muted" data-no-ai>{t(noEngineKey(row.key, row.category))}</p>
      </Card>
    );
  }
  const supportsWorkflow = toolSupportsWorkflow(row.key);
  const [versions, workflowVersions, usable] = await Promise.all([
    readPromptHistory(supabase, row.key),
    supportsWorkflow ? readWorkflowHistory(supabase, row.key) : Promise.resolve([]),
    supportsWorkflow ? getUsableModels(supabase) : Promise.resolve([]),
  ]);
  const imageModels = usable
    .filter((m) => m.capabilities_ui.supportsReferenceImages)
    .map((m) => ({ id: m.id, name: m.display_name || m.name }));
  const defs = TOOL_VARIABLES[row.key] ?? [];

  return (
    <PromptDraftProvider>
      <div className="space-y-4">
        <Section n={1} title={t("aicc.sec.mode")} sub={t("aicc.sec.modeSub")}>
          <ToolConfigForm section="engine" part="mode" initial={config} services={[]} />
        </Section>

        <Section n={2} title={supportsWorkflow ? t("aicc.sec.promptWorkflow") : t("aicc.sec.prompt")} sub={t("aicc.sec.promptSub")}>
          <ToolPromptEditor toolKey={row.key} versions={versions} locale={locale}
            hasEngine={row.engineMode === "grovbase" || row.engineMode === "hybrid"} />
          {supportsWorkflow && (
            <div className="mt-6 border-t border-line pt-5">
              <p className="mb-3 text-sm font-semibold">{t("aicc.wf.title")}</p>
              <WorkflowBuilder toolKey={row.key} versions={workflowVersions} models={imageModels}
                locale={locale} active={row.engineMode === "workflow"} />
            </div>
          )}
        </Section>

        <Section n={3} title={t("aicc.sec.variables")} sub={t("aicc.vars.syntax")}>
          <ul className="divide-y divide-line rounded-xl bg-raised" data-variable-list>
            {defs.map((d) => (
              <li key={d.key} className="flex flex-col gap-1 px-3.5 py-2.5 sm:flex-row sm:items-baseline sm:gap-3">
                <code className="shrink-0 font-mono text-[12px] font-semibold">{`{{${d.key}}}`}</code>
                <span className="min-w-0 flex-1 text-xs text-muted">{t(`aicc.var.${d.key}`)}</span>
                <span className="flex shrink-0 flex-wrap gap-1">
                  <Badge tone={d.source === "customer" || d.source === "product" ? "info" : d.source === "system" ? "neutral" : "accent"}>
                    {t(`aicc.vars.source.${d.source}`)}
                  </Badge>
                  {d.costly && <Badge tone="warning">{t("aicc.vars.costly")}</Badge>}
                </span>
              </li>
            ))}
          </ul>
          {supportsWorkflow && <p className="mt-3 text-xs text-faint">{t("aicc.vars.workflowNote")}</p>}
        </Section>

        <Section n={4} title={t("aicc.sec.execution")} sub={t("aicc.engine.sub")}>
          <div className="space-y-6">
            <ToolConfigForm section="engine" part="execution" initial={config} services={[]} />
            <KnowledgeStrategyForm toolKey={row.key} initial={row.knowledgeStrategy ?? "proven"} />
          </div>
        </Section>

        <Section n={5} title={t("aicc.sec.test")} sub={t("aicc.sec.testSub")}>
          <EngineDryRun toolKey={row.key} toolPath={row.path} />
        </Section>

        <Section n={6} title={t("aicc.sec.versions")} sub={t("aicc.sec.versionsSub")}>
          <ToolPromptHistory versions={versions} locale={locale} />
          {supportsWorkflow && <p className="mt-3 text-xs text-faint">{t("aicc.wf.historyAbove")}</p>}
        </Section>
      </div>
    </PromptDraftProvider>
  );
}

/* ── MODELE ───────────────────────────────────────────────────────────────*/

async function ModelsTab({ supabase, t, row, config }: WithConfig) {
  const pickable = await readPickableModels(supabase);

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
    ? await supabase.from("knowledge_examples").select("set_id, review_status").in("set_id", setIds).limit(20000)
    : { data: [] as { set_id: string; review_status: string }[] };
  const exampleCount = new Map<string, number>();
  const pendingCount = new Map<string, number>();
  for (const e of examples ?? []) {
    if (e.review_status === "pending") pendingCount.set(e.set_id, (pendingCount.get(e.set_id) ?? 0) + 1);
    else if (e.review_status === "approved") exampleCount.set(e.set_id, (exampleCount.get(e.set_id) ?? 0) + 1);
  }
  const assignedIds = new Set((assigned ?? []).map((a) => a.set_id));
  const setName = new Map((sets ?? []).map((s) => [s.id, s.name]));

  // The review queue: candidates from the sets THIS tool uses.
  const assignedList = [...assignedIds];
  const { data: pendingRows } = assignedList.length
    ? await supabase.from("knowledge_examples")
        .select("id, set_id, reference_path, generated_path, prompt_used, scene, product_category, tags, confidence, source_ref")
        .in("set_id", assignedList).eq("review_status", "pending")
        .order("created_at", { ascending: true }).limit(20)
    : { data: [] as never[] };
  const paths = (pendingRows ?? []).flatMap((r) => [r.reference_path, r.generated_path]).filter(Boolean) as string[];
  const { data: signed } = paths.length
    ? await supabase.storage.from("knowledge").createSignedUrls(paths, 900)
    : { data: [] as { path: string | null; signedUrl: string }[] };
  const urlOf = new Map((signed ?? []).map((u) => [u.path, u.signedUrl]));
  const review: ReviewItem[] = (pendingRows ?? []).map((r) => ({
    id: r.id, setName: setName.get(r.set_id) ?? "—",
    beforeUrl: r.reference_path ? urlOf.get(r.reference_path) ?? null : null,
    afterUrl: r.generated_path ? urlOf.get(r.generated_path) ?? null : null,
    prompt: r.prompt_used, scene: r.scene, category: r.product_category, tags: r.tags ?? [],
    confidence: r.confidence === null ? null : Number(r.confidence), sourceRef: r.source_ref,
  }));

  const stats = await readEngineAnalytics(supabase, row.key, assignedList);
  const votes = stats.likes + stats.dislikes;
  const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <CardHeader title={t("aicc.knowledge.title")} sub={t("aicc.knowledge.sub")} />
      </Card>

      <Section n={1} title={t("aicc.knowledge.setsTitle")} sub={t("aicc.knowledge.setsSub")}>
        <div className="space-y-4">
          <KnowledgeImport toolKey={row.key} />
          <ToolKnowledge toolKey={row.key} locale={locale}
            sets={(sets ?? []).map((s) => ({
              id: s.id, name: s.name, status: s.status,
              examples: exampleCount.get(s.id) ?? 0,
              pending: pendingCount.get(s.id) ?? 0,
              files: s.file_count ?? 0,
              updatedAt: s.updated_at,
              assigned: assignedIds.has(s.id),
            }))} />
        </div>
      </Section>

      <Section n={2} title={t("aicc.knowledge.reviewTitle")} sub={t("aicc.knowledge.reviewSub")}>
        <KnowledgeReview toolKey={row.key} items={review} />
      </Section>

      <Section n={3} title={t("aicc.knowledge.topTitle")} sub={t("aicc.knowledge.topSub", { n: MIN_SAMPLE })}>
        {stats.topExamples.length === 0 ? (
          <p className="text-sm text-muted">{t("aicc.knowledge.topEmpty")}</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl bg-raised" data-top-examples>
            {stats.topExamples.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1 truncate">{e.scene || e.category || setName.get(e.setId) || e.id.slice(0, 8)}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted">
                  {t("aicc.knowledge.exampleStats", { usage: e.usage, likes: e.likes, dislikes: e.dislikes })}
                </span>
                <Badge tone={e.sampleOk ? "success" : "neutral"}>
                  {e.sampleOk ? t("aicc.knowledge.score", { n: Math.round(e.score * 100) }) : t("aicc.knowledge.fewVotes")}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section n={4} title={t("aicc.analytics.title")} sub={t("aicc.analytics.sub")}>
        <dl className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-3 lg:grid-cols-4" data-analytics>
          <Stat label={t("aicc.analytics.runs")} value={String(stats.runs)} />
          <Stat label={t("aicc.analytics.okRate")} value={pct(stats.ok, stats.runs)} />
          <Stat label={t("aicc.analytics.likeRate")} value={votes ? `👍 ${pct(stats.likes, votes)} · 👎 ${pct(stats.dislikes, votes)}` : "—"} />
          <Stat label={t("aicc.analytics.votes")} value={String(votes)} />
          <Stat label={t("aicc.analytics.workflowOk")} value={stats.workflowRuns ? pct(stats.workflowOk, stats.workflowRuns) : "—"} />
          <Stat label={t("aicc.analytics.blocked")} value={String(stats.blocked)} />
          <Stat label={t("aicc.analytics.avgCredits")} value={stats.avgCredits === null ? "—" : stats.avgCredits.toFixed(1)} />
          <Stat label={t("aicc.analytics.avgDuration")} value={stats.avgDurationMs === null ? "—" : `${(stats.avgDurationMs / 1000).toFixed(1)} s`} />
        </dl>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <SceneList title={t("aicc.analytics.bestScenes")} rows={stats.bestScenes} empty={t("aicc.analytics.noScenes", { n: MIN_SAMPLE })} />
          <SceneList title={t("aicc.analytics.worstScenes")} rows={stats.worstScenes} empty={t("aicc.analytics.noScenes", { n: MIN_SAMPLE })} />
        </div>
        {Object.keys(stats.reasons).length > 0 && (
          <p className="mt-4 flex flex-wrap gap-1.5">
            {Object.entries(stats.reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
              <Badge key={k} tone="neutral">{t(`aicc.reason.${k}`)} · {n}</Badge>
            ))}
          </p>
        )}
        <p className="mt-4 text-xs text-faint">{t("aicc.analytics.feedbackNote")}</p>
      </Section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-raised px-3.5 py-3">
      <dt className="truncate text-xs text-muted">{label}</dt>
      <dd className="mt-1 truncate font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function SceneList({ title, rows, empty }: { title: string; rows: { scene: string; likes: number; dislikes: number }[]; empty: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-xs font-semibold text-muted">{title}</p>
      {rows.length === 0 ? <p className="text-xs text-faint">{empty}</p> : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.scene} className="flex items-center gap-2 text-[13px]">
              <span className="min-w-0 flex-1 truncate">{r.scene}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted">👍 {r.likes} · 👎 {r.dislikes}</span>
            </li>
          ))}
        </ul>
      )}
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

  const runs = toolHasPromptEngine(row.key) ? await readEngineRuns(supabase, row.key, 30) : [];

  return (
    <div className="space-y-5">
    {toolHasPromptEngine(row.key) && <EngineRuns t={t} runs={runs} locale={locale} />}
    {row.key === "prompts" && <ShotSessions supabase={supabase} t={t} locale={locale} />}
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
    </div>
  );
}

/**
 * PRZEBIEGI SILNIKA — admin-only trace: engine / prompt / workflow version,
 * model, knowledge examples, scene, cost, duration, step outcomes, feedback.
 * Names, codes and timings only: no prompt text is stored in a run.
 */
function EngineRuns({ t, runs, locale }: Pick<Ctx, "t"> & { runs: Awaited<ReturnType<typeof readEngineRuns>>; locale: string }) {
  return (
    <Card>
      <CardHeader title={t("aicc.runs.title")} sub={t("aicc.runs.sub")} />
      {runs.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted">{t("aicc.runs.empty")}</p>
      ) : (
        <ul className="divide-y divide-line" data-engine-runs>
          {runs.map((r) => (
            <li key={r.id} className="space-y-1.5 px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={r.status === "ok" ? "success" : r.status === "blocked" ? "warning" : "danger"}>
                  {t(`aicc.runs.status.${r.status}`)}
                </Badge>
                <Badge tone="neutral">{t(`aicc.engine.${r.mode}`)}</Badge>
                {r.promptVersion !== null && <Badge tone="neutral">{t("aicc.runs.promptV", { n: r.promptVersion })}</Badge>}
                {r.workflowVersion !== null && <Badge tone="neutral">{t("aicc.runs.workflowV", { n: r.workflowVersion })}</Badge>}
                {r.feedback && <Badge tone={r.feedback === "like" ? "success" : "danger"}>{r.feedback === "like" ? "👍" : "👎"}</Badge>}
                <span className="ml-auto shrink-0 text-xs text-faint" title={formatDate(r.createdAt, locale)}>
                  <RelativeTime at={r.createdAt} locale={locale} t={t} />
                </span>
              </div>
              <p className="break-words text-xs text-muted">
                {[
                  r.engineVersion ? `${t("aicc.runs.engine")} ${r.engineVersion}` : null,
                  r.modelLabel ?? (r.modelId ? `${t("aicc.runs.model")} ${r.modelId.slice(0, 8)}` : null),
                  r.knowledgeIds.length ? t("aicc.runs.knowledge", { n: r.knowledgeIds.length, ids: r.knowledgeIds.map((k) => k.slice(0, 8)).join(", ") }) : null,
                  r.sceneExampleId ? t("aicc.runs.scene", { id: r.sceneExampleId.slice(0, 8) }) : null,
                  r.credits !== null ? `${r.credits} kr.` : null,
                  r.durationMs !== null ? `${(r.durationMs / 1000).toFixed(1)} s` : null,
                  r.error ? `${t("aicc.runs.error")} ${r.error}` : null,
                ].filter(Boolean).join(" · ") || "—"}
              </p>
              {r.steps.length > 0 && (
                <p className="flex flex-wrap gap-1">
                  {r.steps.map((st) => (
                    <Badge key={st.n} tone={st.status === "ok" ? "success" : st.status === "skipped" ? "neutral" : "danger"}>
                      {st.n}. {st.name} · {t(`aicc.runs.step.${st.status}`)}{st.ms ? ` · ${(st.ms / 1000).toFixed(1)} s` : ""}{st.attempts > 1 ? ` · ×${st.attempts}` : ""}
                    </Badge>
                  ))}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * SESJE UJĘĆ — what "Silnik ujęć" used to be a menu entry for.
 *
 * A usage event says a call was billed; a session says what the customer was
 * actually trying to photograph and how many of its concepts were generated.
 * Only GrovShot plans concepts, so only GrovShot shows this.
 */
async function ShotSessions({ supabase, t, locale }: Omit<Ctx, "row"> & { locale: string }) {
  const { data: sessions } = await supabase
    .from("prompt_sessions")
    .select("id, product_name, status, aspect_ratio, created_at, workspaces(name)")
    .order("created_at", { ascending: false })
    .limit(20);

  const ids = (sessions ?? []).map((s) => s.id);
  const counts = new Map<string, { total: number; generated: number }>();
  if (ids.length > 0) {
    const { data: prompts } = await supabase
      .from("generated_prompts").select("session_id, generation_count").in("session_id", ids);
    for (const p of prompts ?? []) {
      if (!p.session_id) continue;
      const c = counts.get(p.session_id) ?? { total: 0, generated: 0 };
      c.total += 1;
      if ((p.generation_count ?? 0) > 0) c.generated += 1;
      counts.set(p.session_id, c);
    }
  }

  return (
    <Card>
      <CardHeader title={t("admin.concepts.title")} sub={t("admin.concepts.sub")} />
      {(sessions ?? []).length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted">{t("admin.concepts.empty")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {(sessions ?? []).map((s) => {
            const c = counts.get(s.id);
            return (
              <li key={s.id}>
                <Link href={`/admin/ai/sesje/${s.id}`}
                  className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-raised/50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{s.product_name}</span>
                    <span className="block truncate text-xs text-faint">
                      {(s.workspaces as { name?: string } | null)?.name ?? "—"} ·{" "}
                      {formatDate(s.created_at, locale)} · {s.aspect_ratio}
                    </span>
                  </span>
                  {c && (
                    <span className="shrink-0 text-xs tabular-nums text-muted">
                      {t("admin.concepts.generated")}: {c.generated}/{c.total}
                    </span>
                  )}
                  <Badge tone={s.status === "ready" ? "success"
                    : s.status === "failed" ? "danger" : "accent"}>{s.status}</Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
