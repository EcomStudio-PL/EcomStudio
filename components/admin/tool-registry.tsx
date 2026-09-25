"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronDown, Cpu, ExternalLink, EyeOff, History, Search, Settings2, X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { MODEL_PRICED, toolTabs, type EngineMode, type ToolRow } from "@/lib/services/ai-tools";
import { FEATURE_STATUSES, type AvailabilityMap, type FeatureKey, type FeatureStatus } from "@/lib/features";
import type { FeatureAdminRow } from "@/app/actions/features";
import {
  PANEL_GROUPS, coveredCards, panelGroupOf, panelKind, staticallySoon, type PanelKind,
} from "@/lib/tool-panel";
import { STATUS_TONE } from "@/lib/status-tone";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input, Select } from "@/components/ui/input";
import { RelativeTime } from "@/components/ui/relative-time";
import { ToolConfigForm, type ToolConfigValues } from "@/components/admin/tool-basics";
import { ToolModelPicker, type PickableModel } from "@/components/admin/tool-models";
import {
  AvailabilityEditor, BulkBar, ConfigSection, PreviewToggle,
} from "@/components/admin/availability-controls";
import { cn } from "@/lib/utils";

/**
 * NARZĘDZIA I SILNIKI — every tool, category and module GrovBase has, on one
 * screen: what it runs on, what it costs, whether it is live, and where a
 * customer meets it.
 *
 * Two screens used to split this: this one (engine, model, credits) and
 * "Dostępność funkcji" (status, visibility). Each fact still lives where it
 * always did and is written by the action that always wrote it —
 *
 *   model, engine ........ ai_tools / ai_tool_models   app/actions/ai-tools.ts
 *   credits .............. service_catalog, pointed at  app/actions/ai-tools.ts
 *   status, visibility ... feature_availability         app/actions/features.ts
 *
 * — so this is a screen merge, not a data merge: no row is copied, no table
 * was added, and the customer side reads exactly what it read before.
 *
 * A compact row per entry. Opening a row mounts its configuration and keeps
 * it mounted — collapsing only hides it — so an unsaved draft survives
 * opening another row or collapsing this one; every form's ids are unique
 * (useId), so any number can be open together.
 */

export type PanelEntry = {
  /** The stored availability record (status as SET, not as in force). */
  admin: FeatureAdminRow;
  /** The engine registry row — tools only. */
  tool: ToolRow | null;
};

const ENGINE_TONE: Record<EngineMode, "neutral" | "info" | "accent"> = {
  off: "neutral", user: "info", grovbase: "accent", hybrid: "accent",
};

type Quick = "all" | "active" | "soon" | "hidden";
const QUICK: Quick[] = ["all", "active", "soon", "hidden"];

/**
 * THE STATUS IN FORCE — what customers get right now, after the time window.
 * The badge and every filter read this, exactly as the tool workspace does; a
 * stored status that differs (a window not started yet, or one that reopened
 * the module on its own) is shown beside it as the scheduled one.
 */
const liveStatus = (e: PanelEntry, availability: AvailabilityMap): FeatureStatus =>
  availability[e.admin.key]?.status ?? e.admin.status;

/** "Ukryte" is what a customer cannot find: taken off the lists, or off. */
function quickMatch(q: Quick, status: FeatureStatus, hidden: boolean): boolean {
  switch (q) {
    case "active": return status === "ACTIVE";
    case "soon": return status === "COMING_SOON";
    case "hidden": return hidden || status === "DISABLED";
    default: return true;
  }
}

export function ToolRegistry({ entries, availability, models, services, previewing, locale, openKey }: {
  entries: PanelEntry[];
  availability: AvailabilityMap;
  models: PickableModel[];
  services: { slug: string; name: string; credits: number }[];
  previewing: boolean;
  locale: string;
  /** Opened on arrival — `/admin/ai?tool=<key>`. */
  openKey: FeatureKey | null;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [status, setStatus] = useState<FeatureStatus | "">("");
  const [quick, setQuick] = useState<Quick>("all");
  const [open, setOpen] = useState<Set<FeatureKey>>(() => new Set(openKey ? [openKey] : []));
  // Rows whose configuration has been opened at least once stay mounted.
  const [mounted, setMounted] = useState<Set<FeatureKey>>(() => new Set(openKey ? [openKey] : []));
  const toggleOpen = (key: FeatureKey) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    setMounted((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  };
  const [selected, setSelected] = useState<Set<FeatureKey>>(new Set());

  // A deep link lands on its row, not on the top of a long page.
  useEffect(() => {
    if (openKey) document.getElementById(`tool-${openKey}`)?.scrollIntoView({ block: "start" });
  }, [openKey]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter(({ admin, tool }) => {
      if (group && panelGroupOf(admin.key) !== group) return false;
      const live = availability[admin.key]?.status ?? admin.status;
      if (status && live !== status) return false;
      if (!quickMatch(quick, live, admin.hiddenFromMenu)) return false;
      if (!needle) return true;
      const models = tool ? tool.models.map((m) => m.name).join(" ") : "";
      return `${t(admin.nameKey)} ${admin.key} ${admin.path} ${models}`.toLowerCase().includes(needle);
    });
  }, [entries, availability, q, group, status, quick, t]);

  const byKey = useMemo(() => new Map(visible.map((e) => [e.admin.key, e])), [visible]);
  const groups = useMemo(() => PANEL_GROUPS
    .map((g) => ({ ...g, items: g.keys.map((k) => byKey.get(k)).filter((e): e is PanelEntry => Boolean(e)) }))
    .filter((g) => g.items.length > 0), [byKey]);

  const counts = useMemo(() => Object.fromEntries(
    QUICK.map((k) => [k, entries.filter((e) => quickMatch(k, liveStatus(e, availability), e.admin.hiddenFromMenu)).length]),
  ) as Record<Quick, number>, [entries, availability]);

  const setMany = (keys: FeatureKey[], on: boolean) => setSelected((prev) => {
    const next = new Set(prev);
    for (const k of keys) { if (on) next.add(k); else next.delete(k); }
    return next;
  });
  const visibleKeys = visible.map((e) => e.admin.key);
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((k) => selected.has(k));
  const filtered = q.trim() !== "" || group !== "" || status !== "" || quick !== "all";

  return (
    <div className="min-w-0 space-y-4">
      <PreviewToggle previewing={previewing} />

      {/* FILTERS — stacked on a phone, one row from `lg`; nothing here ever
          scrolls the page sideways. */}
      <Card className="p-3.5 sm:p-4">
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_11rem] [&>*]:min-w-0">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} className="pl-8 pr-9"
              placeholder={t("featAdm.searchPlaceholder")} aria-label={t("common.search")} />
            {q && (
              <button type="button" onClick={() => setQ("")} aria-label={t("common.clear")}
                className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-faint hover:text-ink">
                <X size={14} aria-hidden />
              </button>
            )}
          </div>
          <Select value={group} onChange={(e) => setGroup(e.target.value)} aria-label={t("common.category")}>
            <option value="">{t("aicc.panel.allGroups")}</option>
            {PANEL_GROUPS.map((g) => <option key={g.key} value={g.key}>{t(g.titleKey)}</option>)}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value as FeatureStatus | "")} aria-label={t("common.status")}>
            <option value="">{t("featAdm.anyStatus")}</option>
            {FEATURE_STATUSES.map((s) => <option key={s} value={s}>{t(`featAdm.status.${s}`)}</option>)}
          </Select>
        </div>

        {/* QUICK FILTER — the four questions an operator actually asks. On a
            phone the row scrolls inside itself, never the page. */}
        <div role="group" aria-label={t("aicc.panel.quick.label")}
          className="-mx-3.5 mt-3 overflow-x-auto px-3.5 [scrollbar-width:none] sm:-mx-4 sm:px-4 [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max gap-2">
            {QUICK.map((k) => (
              <Chip key={k} active={quick === k} count={counts[k]} onClick={() => setQuick(k)}
                className="min-h-[36px] px-3.5 py-1.5">
                {t(`aicc.panel.quick.${k}`)}
              </Chip>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line pt-3 text-[12.5px] text-muted">
          <label className="flex items-center gap-2 font-medium text-ink">
            <input type="checkbox" checked={allVisibleSelected}
              onChange={(e) => setMany(visibleKeys, e.target.checked)}
              className="size-4 rounded border-line accent-[rgb(var(--accent))]" />
            {t("featAdm.selectAllVisible")}
          </label>
          <span>{t("featAdm.showing", { n: visible.length, total: entries.length })}</span>
          {filtered && (
            <button type="button"
              onClick={() => { setQ(""); setGroup(""); setStatus(""); setQuick("all"); }}
              className="font-semibold text-accent hover:underline">
              {t("featAdm.clearFilters")}
            </button>
          )}
        </div>
      </Card>

      {groups.length === 0 && (
        <div className="panel rounded-2xl px-5 py-12 text-center text-sm text-muted">{t("aicc.tools.noMatches")}</div>
      )}

      {groups.map((g) => {
        const keys = g.items.map((e) => e.admin.key);
        const allSelected = keys.every((k) => selected.has(k));
        return (
          <section key={g.key} aria-labelledby={`grp-${g.key}`} data-group={g.key}>
            <div className="mb-1.5 flex items-center gap-2 px-1">
              <input type="checkbox" checked={allSelected}
                onChange={(e) => setMany(keys, e.target.checked)}
                aria-label={t("featAdm.selectGroup", { group: t(g.titleKey) })}
                className="size-4 rounded border-line accent-[rgb(var(--accent))]" />
              <h2 id={`grp-${g.key}`} className="text-[12px] font-bold uppercase tracking-[0.08em] text-faint">
                {t(g.titleKey)}
              </h2>
              <span className="text-[11px] text-faint">({g.items.length})</span>
            </div>
            <Card className="divide-y divide-line overflow-hidden p-0">
              {g.items.map((entry) => (
                <EntryRow key={entry.admin.key} entry={entry} locale={locale}
                  availability={availability} models={models} services={services}
                  open={open.has(entry.admin.key)} mounted={mounted.has(entry.admin.key)}
                  onOpen={() => toggleOpen(entry.admin.key)}
                  selected={selected.has(entry.admin.key)}
                  onSelect={(on) => setMany([entry.admin.key], on)} />
              ))}
            </Card>
          </section>
        );
      })}

      {/* The bulk bar only exists while something is selected — it is an
          action on a selection, not permanent chrome. */}
      <BulkBar keys={[...selected]} onDone={() => setSelected(new Set())}
        onClear={() => setSelected(new Set())} />
    </div>
  );
}

/* ── one entry ──────────────────────────────────────────────────────────────*/

type T = (key: string, values?: Record<string, string | number>) => string;

function EntryRow({ entry, open, mounted, onOpen, selected, onSelect, availability, models, services, locale }: {
  entry: PanelEntry;
  open: boolean;
  /** Opened at least once: the configuration stays in the DOM, hidden, so
   *  its drafts survive a collapse. */
  mounted: boolean;
  onOpen: () => void;
  selected: boolean;
  onSelect: (on: boolean) => void;
  availability: AvailabilityMap;
  models: PickableModel[];
  services: { slug: string; name: string; credits: number }[];
  locale: string;
}) {
  const { t } = useI18n();
  const { admin, tool } = entry;
  const kind: PanelKind = panelKind(admin.key);
  const covered = coveredCards(admin.key);
  const scheduled = admin.status !== "ACTIVE" && Boolean(admin.startsAt || admin.endsAt);
  const live = liveStatus(entry, availability);
  const panelId = `cfg-${admin.key}`;
  const nameId = `name-${admin.key}`;

  return (
    <div id={`tool-${admin.key}`} data-entry={admin.key} data-kind={kind}
      className={cn("scroll-mt-24", selected && "bg-[rgb(var(--accent)/0.05)]")}>
      {/* COLLAPSED — name, what it runs on, type, price, status, last run,
          and one button. Wraps on a phone instead of scrolling sideways. */}
      <div className="flex gap-2.5 px-3 py-3 sm:px-4">
        <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)}
          aria-label={t(admin.nameKey)}
          className="mt-0.5 size-4 shrink-0 rounded border-line accent-[rgb(var(--accent))]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p id={nameId} className="truncate text-[14px] font-semibold text-ink">{t(admin.nameKey)}</p>
              <p className="truncate text-[12px] text-muted">{subLine(entry, kind, covered.length, t)}</p>
            </div>
            <Badge tone={STATUS_TONE[live]} dot className="shrink-0">
              {t(`featAdm.status.${live}`)}
            </Badge>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <Badge tone="neutral">
                {kind === "tool" && tool ? t(`aicc.category.${tool.category}`) : t(`aicc.panel.kind.${kind}`)}
              </Badge>
              {tool && <Badge tone={ENGINE_TONE[tool.engineMode]}>{t(`aicc.engine.${tool.engineMode}`)}</Badge>}
              {tool && tool.promptVersion !== null && <Badge tone="neutral">v{tool.promptVersion}</Badge>}
              {tool && <span className="text-[12px] font-semibold tabular-nums text-muted">{creditsLabel(tool, t)}</span>}
              {admin.hiddenFromMenu && admin.status !== "DISABLED" && (
                <span className="inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide text-faint">
                  <EyeOff size={11} aria-hidden /> {t("featAdm.hiddenChip")}
                </span>
              )}
              {scheduled && (
                <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">
                  {live !== admin.status
                    ? t("aicc.panel.storedStatus", { status: t(`featAdm.status.${admin.status}`) })
                    : t("featAdm.scheduledChip")}
                </span>
              )}
              {tool?.serviceMaintenance && <Badge tone="warning">{t("aicc.tools.serviceMaintenance")}</Badge>}
              {tool && (
                <span className="inline-flex min-w-0 items-center gap-1 text-[11.5px] text-faint" title={t("aicc.col.lastRun")}>
                  <History size={12} aria-hidden className="shrink-0" />
                  {tool.lastRunAt
                    ? <RelativeTime at={tool.lastRunAt} locale={locale} t={t} />
                    : t("aicc.tools.neverRun")}
                  {tool.failures30d > 0 && (
                    <span className="text-danger">· {t("aicc.tools.failures", { n: tool.failures30d })}</span>
                  )}
                </span>
              )}
            </div>
            <button type="button" onClick={onOpen} aria-expanded={open} aria-controls={panelId}
              aria-describedby={nameId}
              className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg bg-accent2-soft px-3 text-[13px] font-semibold text-accent2 transition-[filter] hover:brightness-110">
              <Settings2 size={14} aria-hidden />
              {t("aicc.tools.configure")}
              <ChevronDown size={14} aria-hidden
                className={cn("transition-transform duration-200", open && "rotate-180")} />
            </button>
          </div>
        </div>
      </div>

      {/* EXPANDED — the four sections. Two columns from `lg` (what it runs on
          and costs | whether and where it is live), one on anything smaller. */}
      {mounted && (
        <div id={panelId} hidden={!open} className="animate-fade border-t border-line bg-raised/40 px-3 py-3.5 sm:px-4 sm:py-4">
          {kind === "tool" && tool ? (
            <div className="grid gap-3.5 lg:grid-cols-2 [&>*]:min-w-0">
              <div className="space-y-3.5">
                <ConfigSection n={1} title={t("aicc.panel.sec.model")}>
                  <ModelSection tool={tool} models={models} />
                </ConfigSection>
                <ConfigSection n={2} title={t("aicc.panel.sec.credits")}>
                  <CreditsSection tool={tool} services={services} models={models} />
                </ConfigSection>
              </div>
              <AvailabilityEditor key={savedKey(admin)} row={admin} availability={availability}
                first={3} layout="stack" staticSoon={staticallySoon(admin.key)}
                extra={<Covered keys={covered.map((c) => c.titleKey)} kind={kind} />} />
            </div>
          ) : (
            <AvailabilityEditor key={savedKey(admin)} row={admin} availability={availability}
              first={1} layout="split" staticSoon={staticallySoon(admin.key)}
              extra={<Covered keys={covered.map((c) => c.titleKey)} kind={kind} />} />
          )}
          {kind === "tool" && (
            <Link href={`/admin/ai/${admin.key}`}
              className="mt-3.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent hover:opacity-80">
              {t("aicc.panel.fullConfig")} <ExternalLink size={13} aria-hidden />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/** Remounts the editor whenever the SAVED record changes underneath it. */
const savedKey = (r: FeatureAdminRow) =>
  [r.status, r.hiddenFromMenu, r.startsAt, r.endsAt, r.autoReenable, r.customTitle, r.customMessage, r.updatedAt].join("|");

function subLine(entry: PanelEntry, kind: PanelKind, covered: number, t: T): string {
  if (entry.tool) return modelLine(entry.tool, t);
  if (kind === "category") return t("aicc.panel.categoryLine", { n: covered });
  return entry.admin.path;
}

/** The tools a switch covers without having one of their own. */
function Covered({ keys, kind }: { keys: string[]; kind: PanelKind }) {
  const { t } = useI18n();
  // A single card is the entry itself under another name — nothing to explain.
  if (kind !== "category" && keys.length < 2) return null;
  if (keys.length === 0) return null;
  return (
    <div className="mt-3.5 border-t border-line pt-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-faint">
        {t(kind === "category" ? "aicc.panel.inCategory" : "aicc.panel.covers", { n: keys.length })}
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {keys.map((k) => (
          <li key={k} className="max-w-full truncate rounded-full bg-raised px-2.5 py-1 text-[11.5px] font-medium text-muted">
            {t(k)}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
        {t(kind === "category" ? "aicc.panel.categoryNote" : "aicc.panel.coversNote")}
      </p>
    </div>
  );
}

/* ── 1 · model i silnik ─────────────────────────────────────────────────────*/

function configOf(tool: ToolRow): ToolConfigValues {
  return {
    toolKey: tool.key,
    engineMode: tool.engineMode,
    serviceSlug: tool.serviceSlug,
    allowModelChoice: tool.allowModelChoice,
    fallbackEnabled: tool.fallbackEnabled,
    timeoutMs: tool.timeoutMs,
    maxAttempts: tool.maxAttempts,
    notes: tool.notes,
  };
}

function ModelSection({ tool, models }: { tool: ToolRow; models: PickableModel[] }) {
  const { t } = useI18n();
  // The tabs the tool workspace offers are the controls this tool HAS: a
  // sharp tool has no engine and no model, and pretending otherwise would be
  // a control that decides nothing.
  const tabs = toolTabs(tool);
  const config = configOf(tool);
  const providers = [...new Set(tool.models
    .filter((m) => m.role !== "allowed").map((m) => m.providerName).filter(Boolean))];

  return (
    <div className="space-y-4">
      <dl className="grid gap-x-4 gap-y-2 text-[13px] sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-muted">{t("aicc.col.model")}</dt>
        <dd className="min-w-0 font-medium text-ink">{modelLine(tool, t)}</dd>
        {providers.length > 0 && (
          <>
            <dt className="text-muted">{t("aicc.panel.provider")}</dt>
            <dd className="min-w-0 font-medium text-ink">{providers.join(", ")}</dd>
          </>
        )}
        <dt className="text-muted">{t("aicc.col.engine")}</dt>
        <dd className="min-w-0"><Badge tone={ENGINE_TONE[tool.engineMode]}>{t(`aicc.engine.${tool.engineMode}`)}</Badge></dd>
      </dl>

      {tabs.includes("engine") && (
        <div className="border-t border-line pt-3.5">
          <ToolConfigForm section="engine" initial={config} services={[]} />
        </div>
      )}
      {tabs.includes("models") && (
        <div className="border-t border-line pt-3.5">
          <ToolModelPicker toolKey={tool.key} models={models} config={config}
            initial={{
              primaryId: tool.models.find((m) => m.role === "primary")?.id ?? null,
              fallbackId: tool.models.find((m) => m.role === "fallback")?.id ?? null,
              allowedIds: tool.models.filter((m) => m.role === "allowed").map((m) => m.id),
            }} />
        </div>
      )}
      {!tabs.includes("engine") && !tabs.includes("models") && (
        <p className="flex items-start gap-2 rounded-xl bg-raised px-3 py-2.5 text-[12.5px] leading-relaxed text-muted">
          <Cpu size={14} aria-hidden className="mt-0.5 shrink-0 text-faint" />
          <span className="min-w-0">
            {t(tool.category === "local" ? "aicc.panel.localNote" : "aicc.panel.capabilityNote")}
            {tool.category !== "local" && (
              <>
                {" "}
                <Link href="/admin/ai/modele?tab=dostawcy" className="font-semibold text-accent hover:opacity-80">
                  {t("aicc.panel.providersLink")}
                </Link>
              </>
            )}
          </span>
        </p>
      )}
    </div>
  );
}

/* ── 2 · kredyty ────────────────────────────────────────────────────────────*/

function CreditsSection({ tool, services, models }: {
  tool: ToolRow;
  services: { slug: string; name: string; credits: number }[];
  models: PickableModel[];
}) {
  const { t } = useI18n();
  // Model-priced tools bill their images by the model's own price list
  // (MODEL_PRICED in lib/services/ai-tools.ts); their catalogue row is not
  // their price, so it is not shown as one.
  const modelPriced = MODEL_PRICED.includes(tool.key);
  const primary = tool.models.find((m) => m.role === "primary");
  const primaryPrice = primary ? models.find((m) => m.id === primary.id)?.credits ?? null : null;

  return (
    <div className="space-y-3.5">
      {modelPriced ? (
        <div className="space-y-1.5">
          {primary && primaryPrice !== null && (
            <p className="text-[13px] text-muted">
              <span className="text-[20px] font-bold tabular-nums text-ink">{creditsText(primaryPrice, t)}</span>
              <span className="ml-1.5">{t("aicc.panel.modelBase", { model: primary.name })}</span>
            </p>
          )}
          <p className="text-[12.5px] leading-relaxed text-muted">{t("aicc.panel.modelPriced")}</p>
          <Link href="/admin/ai/modele?tab=modele"
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent hover:opacity-80">
            {t("aicc.panel.modelsLink")} <ExternalLink size={13} aria-hidden />
          </Link>
        </div>
      ) : (
        <>
          <p className="text-[13px] text-muted">
            <span className="text-[20px] font-bold tabular-nums text-ink">{creditsLabel(tool, t)}</span>
            {tool.credits !== null && tool.credits > 0 && <span className="ml-1.5">{t("aicc.panel.perRun")}</span>}
          </p>
          {tool.credits === null && <p className="text-[12px] text-faint">{t("aicc.panel.noBilling")}</p>}
        </>
      )}
      <p className="text-[11.5px] text-faint">
        {t("aicc.panel.usage30d", { runs: tool.runs30d, failures: tool.failures30d })}
      </p>
      <div className="border-t border-line pt-3.5">
        <ToolConfigForm section="billing" initial={configOf(tool)} services={services} />
      </div>
      <Link href="/admin/services"
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent hover:opacity-80">
        {t("aicc.panel.priceLink")} <ExternalLink size={13} aria-hidden />
      </Link>
    </div>
  );
}

/* ── labels ─────────────────────────────────────────────────────────────────*/

/**
 * What this tool runs on, in one line.
 *
 * "Local pipeline" is claimed only for tools that genuinely are one — a video
 * module with no engine yet is not sharp, and saying so would be the kind of
 * confident wrong answer this screen exists to remove.
 */
function modelLine(r: ToolRow, t: T): string {
  const primary = r.models.find((m) => m.role === "primary");
  const fallback = r.models.find((m) => m.role === "fallback");
  if (primary) return fallback ? `${primary.name} → ${fallback.name}` : primary.name;
  if (r.category === "local") return t("aicc.tools.localPipeline");
  if (r.allowModelChoice) return t("aicc.tools.customerChoice");
  if (r.engineMode === "off") return t("aicc.tools.noEngine");
  return t("aicc.tools.noModel");
}

function creditsText(n: number, t: T): string {
  return n === 0 ? t("tools.free") : t("aicc.panel.creditsN", { n });
}

/** What the collapsed row says a run costs. A model-priced tool's catalogue
 *  row is not its price, so the row says "według modelu" instead. */
function creditsLabel(r: ToolRow, t: T): string {
  if (MODEL_PRICED.includes(r.key)) return t("aicc.panel.byModel");
  if (r.credits === null) return "—";
  return creditsText(r.credits, t);
}
