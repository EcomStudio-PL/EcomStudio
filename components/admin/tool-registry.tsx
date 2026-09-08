"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, History, Search, Settings2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import type { ToolRow, ToolCategory, EngineMode } from "@/lib/services/ai-tools";
import type { FeatureStatus } from "@/lib/features";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { RelativeTime } from "@/components/ui/relative-time";
import { cn } from "@/lib/utils";

/**
 * THE TOOL REGISTRY.
 *
 * A dense table on desktop — the operator has 1400px, so a row per tool beats
 * a card the height of a phone — and one compact card per tool below `lg`.
 * Filtering is client-side because there are ten tools: a URL round trip to
 * narrow ten rows would be slower than reading them.
 */

/**
 * Four statuses, four meanings, four colours — and the colour IS the meaning:
 * green runs, orange needs attention, purple is planned-but-not-yet, grey is
 * switched off on purpose. A module an operator turned off is not an error, so
 * it does not get the red that a real failure needs to keep for itself.
 */
const STATUS_TONE: Record<FeatureStatus, "success" | "warning" | "accent" | "neutral"> = {
  ACTIVE: "success",
  COMING_SOON: "accent",
  MAINTENANCE: "warning",
  DISABLED: "neutral",
};

const ENGINE_TONE: Record<EngineMode, "neutral" | "info" | "accent"> = {
  off: "neutral", user: "info", grovbase: "accent", hybrid: "accent",
};

const CATEGORIES: ToolCategory[] = ["generation", "editing", "local", "video"];
const STATUSES: FeatureStatus[] = ["ACTIVE", "COMING_SOON", "MAINTENANCE", "DISABLED"];

export function ToolRegistry({ rows, locale }: { rows: ToolRow[]; locale: string }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (category && r.category !== category) return false;
      if (status && r.status !== status) return false;
      if (!needle) return true;
      return `${t(r.nameKey)} ${r.key} ${r.path}`.toLowerCase().includes(needle);
    });
  }, [rows, q, category, status, t]);

  return (
    <div>
      <div className="mb-4 grid gap-2 sm:flex sm:flex-wrap sm:items-center">
        <div className="relative min-w-0 sm:w-64">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} className="pl-8"
            placeholder={t("common.search")} aria-label={t("common.search")} />
        </div>
        <div className="min-w-0 sm:w-44">
          <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t("common.category")}>
            <option value="">{t("common.category")}</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{t(`aicc.category.${c}`)}</option>)}
          </Select>
        </div>
        <div className="min-w-0 sm:w-44">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("common.status")}>
            <option value="">{t("common.status")}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`featAdm.status.${s}`)}</option>)}
          </Select>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="panel rounded-2xl px-5 py-12 text-center text-sm text-muted">{t("aicc.tools.noMatches")}</div>
      ) : (
        <>
          {/* PHONE — the compact card from the brief: name, what it runs on,
              engine, status, one action. Everything else is one tap away. */}
          <ul className="space-y-2.5 lg:hidden">
            {visible.map((r) => (
              <li key={r.key} className="panel rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{t(r.nameKey)}</p>
                    <p className="truncate text-xs text-muted">{modelLine(r, t)}</p>
                  </div>
                  <Badge tone={STATUS_TONE[r.status]} dot>{t(`featAdm.status.${r.status}`)}</Badge>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <Badge tone={ENGINE_TONE[r.engineMode]}>{t(`aicc.engine.${r.engineMode}`)}</Badge>
                  {r.promptVersion !== null && <Badge tone="neutral">v{r.promptVersion}</Badge>}
                  {r.serviceMaintenance && <Badge tone="warning">{t("aicc.tools.serviceMaintenance")}</Badge>}
                  <span className="text-xs text-faint">{creditsLabel(r, t)}</span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  {/* The clock replaces "Ostatnie uruchomienie:" — the label
                      was longer than the value it introduced and truncated it
                      away on a 390px card. */}
                  <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-faint"
                    title={t("aicc.col.lastRun")}>
                    <History size={12} aria-hidden className="shrink-0" />
                    {r.lastRunAt
                      ? <RelativeTime at={r.lastRunAt} locale={locale} t={t} />
                      : t("aicc.tools.neverRun")}
                  </span>
                  <Link href={`/admin/ai/${r.key}`}
                    className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg bg-accent2-soft px-3 text-[13px] font-semibold text-accent2 transition-[filter] hover:brightness-110">
                    <Settings2 size={14} aria-hidden />
                    {t("aicc.tools.configure")}
                  </Link>
                </div>
              </li>
            ))}
          </ul>

          {/* DESKTOP — one row per tool. */}
          <div className="panel hidden overflow-hidden rounded-2xl lg:block">
            <div className="table-scroll thin-scroll overflow-y-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead>
                  <tr className="bg-surface/95 text-left text-[11px] uppercase tracking-[0.08em] text-faint">
                    {[t("aicc.col.tool"), t("aicc.col.category"), t("aicc.col.engine"), t("aicc.col.model"),
                      t("aicc.col.credits"), t("common.status"), t("aicc.col.lastRun"), ""].map((h, i) => (
                      <th key={i} className="whitespace-nowrap px-4 py-3 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.key} className="border-t border-line transition-colors hover:bg-raised/50">
                      <td className="px-4 py-2.5">
                        <Link href={`/admin/ai/${r.key}`} className="font-medium hover:text-accent">
                          {t(r.nameKey)}
                        </Link>
                        <p className="truncate font-mono text-[11px] text-faint">{r.path || r.key}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-muted">{t(`aicc.category.${r.category}`)}</td>
                      <td className="px-4 py-2.5">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={ENGINE_TONE[r.engineMode]}>{t(`aicc.engine.${r.engineMode}`)}</Badge>
                          {r.promptVersion !== null && (
                            <span className="text-[11px] font-semibold text-faint">v{r.promptVersion}</span>
                          )}
                        </span>
                      </td>
                      <td className="max-w-[220px] px-4 py-2.5 text-muted">
                        <span className="block truncate">{modelLine(r, t)}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{creditsLabel(r, t)}</td>
                      <td className="px-4 py-2.5">
                        <span className="flex flex-wrap gap-1">
                          <Badge tone={STATUS_TONE[r.status]} dot>{t(`featAdm.status.${r.status}`)}</Badge>
                          {r.serviceMaintenance && <Badge tone="warning">{t("aicc.tools.serviceMaintenance")}</Badge>}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-muted">
                        {r.lastRunAt
                          ? <RelativeTime at={r.lastRunAt} locale={locale} t={t} />
                          : <span className="text-faint">{t("aicc.tools.neverRun")}</span>}
                        {r.failures30d > 0 && (
                          <span className="ml-2 text-[11px] text-danger">
                            {t("aicc.tools.failures", { n: r.failures30d })}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link href={`/admin/ai/${r.key}`} aria-label={t("aicc.tools.configure")}
                          className="inline-grid size-9 place-items-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-accent">
                          <ChevronRight size={16} aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

type T = (key: string, values?: Record<string, string | number>) => string;

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

function creditsLabel(r: ToolRow, t: T): string {
  if (r.credits === null) return "—";
  return r.credits === 0 ? t("tools.free") : `${r.credits} kr.`;
}
