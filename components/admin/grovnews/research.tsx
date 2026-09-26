"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Ban, CopyX, Download, ExternalLink, Eye, FilePlus2, Inbox, ListPlus, Pencil, RefreshCw, ShieldAlert, Sparkles,
  Star, Undo2,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { toast } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { AdminTable } from "@/components/ui/admin-table";
import { EmptyState } from "@/components/ui/empty-state";
import {
  addManualItemAction, analyzeNowAction, createDraftFromItemAction, ingestNowAction, markDuplicateAction,
  setItemStatusAction, type ItemOp,
} from "@/app/actions/grovnews-research";
import type { ItemStatus } from "@/lib/grovnews-research";
import type { AdminResearchItem, ResearchFilter } from "@/lib/services/grovnews-research";

const BASE = "/admin/newsletter/grovnews/research";
const POST_EDITOR = "/admin/newsletter/grovnews/wpisy";
const PROVIDERS = "/admin/ai/modele?tab=dostawcy";

const STATUS_TONE: Record<ItemStatus, "neutral" | "success" | "warning" | "accent" | "danger" | "info"> = {
  NEW: "info", ANALYZED: "accent", SELECTED: "success", REJECTED: "neutral", USED: "neutral", DUPLICATE: "neutral",
};

/** Every refusal the research actions can return, as the words for it. */
type ErrCode = "forbidden" | "invalid" | "generic" | "noServerKey" | "aiUnavailable" | "aiFailed" | "used" | "duplicateUrl";
const ERR: Record<ErrCode, string> = {
  forbidden: "grovnewsAdm.errForbidden",
  invalid: "grovnewsAdm.research.err.invalid",
  generic: "common.error",
  noServerKey: "grovnewsAdm.research.err.noServerKey",
  aiUnavailable: "grovnewsAdm.research.err.aiUnavailable",
  aiFailed: "grovnewsAdm.research.err.aiFailed",
  used: "grovnewsAdm.research.err.used",
  duplicateUrl: "grovnewsAdm.research.err.duplicateUrl",
};

/** The codes the pipeline stores in analysis_error; anything else reads as
 *  the generic line rather than as a code. */
const ANALYSIS_ERRORS = [
  "ai_invalid", "analysis_unavailable", "analysis_timeout", "analysis_quota", "analysis_rate_limited", "analysis_error", "error",
] as const;

const OP_DONE: Record<ItemOp, string> = {
  select: "grovnewsAdm.research.done.select",
  reject: "grovnewsAdm.research.done.reject",
  restore: "grovnewsAdm.research.done.restore",
  reanalyze: "grovnewsAdm.research.done.reanalyze",
};

/** Numeric, in Warsaw time: "26.09.2026 07:05". Assembled from parts so the
 *  server's and the browser's ICU cannot disagree on a separator or a month
 *  name (hydration error #418). */
function useFormatDateTime() {
  const fmt = useMemo(() => new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Warsaw", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }), []);
  return (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const parts = fmt.formatToParts(d);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("day")}.${get("month")}.${get("year")} ${get("hour")}:${get("minute")}`;
  };
}

/** A 0–100 score with a short bar. `null` means not analysed yet. */
function Meter({ value, label }: { value: number | null; label: string }) {
  const { t } = useI18n();
  if (value === null) {
    return <span className="text-faint" title={t("grovnewsAdm.research.notScored")}>—</span>;
  }
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <span className="inline-flex items-center gap-2" role="meter" aria-label={label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={v}>
      <span className="w-7 shrink-0 text-right tabular-nums">{v}</span>
      <span aria-hidden className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-raised ring-1 ring-[rgb(var(--hairline)/var(--hairline-alpha))]">
        <span className={cn("block h-full rounded-full", v >= 70 ? "bg-success" : v >= 40 ? "bg-accent" : "bg-faint")}
          style={{ width: `${v}%` }} />
      </span>
    </span>
  );
}

export function ResearchInbox({ filter, filters, counts, items, sources, aiAvailable }: {
  filter: ResearchFilter;
  filters: readonly ResearchFilter[];
  counts: Record<ResearchFilter, number>;
  items: AdminResearchItem[];
  sources: { id: string; name: string }[];
  aiAvailable: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const fmt = useFormatDateTime();
  const [pending, start] = useTransition();
  /** Which button is working — "ingest", "analyze", "add", or "<op>:<item id>". */
  const [busy, setBusy] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<AdminResearchItem | null>(null);
  const [duplicating, setDuplicating] = useState<AdminResearchItem | null>(null);
  const [adding, setAdding] = useState(false);

  const fail = (code: ErrCode, invalidKey?: string) =>
    toast.error(t(code === "invalid" && invalidKey ? invalidKey : ERR[code]));

  const run = (key: string, work: () => Promise<void>) => {
    setBusy(key);
    start(async () => {
      try { await work(); } finally { setBusy(null); }
    });
  };

  const ingest = () => run("ingest", async () => {
    const res = await ingestNowAction(null);
    if (!res.ok) { fail(res.error); return; }
    toast.success(t("grovnewsAdm.research.ingested", {
      sources: res.sources, inserted: res.inserted, duplicates: res.duplicates, failed: res.failed,
    }));
    router.refresh();
  });

  const analyze = () => run("analyze", async () => {
    const res = await analyzeNowAction();
    if (!res.ok) { fail(res.error); return; }
    toast.success(t("grovnewsAdm.research.analyzed", { analyzed: res.analyzed, failed: res.failed, remaining: res.remaining }));
    router.refresh();
  });

  const setStatus = (item: AdminResearchItem, op: ItemOp) => run(`${op}:${item.id}`, async () => {
    const res = await setItemStatusAction(item.id, op);
    if (!res.ok) { fail(res.error); return; }
    toast.success(t(OP_DONE[op]));
    setPreviewing(null);
    router.refresh();
  });

  const draft = (item: AdminResearchItem) => run(`draft:${item.id}`, async () => {
    const res = await createDraftFromItemAction(item.id);
    if (!res.ok) { fail(res.error); return; }
    toast.success(t("grovnewsAdm.research.done.draft"));
    router.push(`${POST_EDITOR}/${res.postId}`);
    router.refresh();
  });

  const markDuplicate = (item: AdminResearchItem, originalId: string | null) => run(`duplicate:${item.id}`, async () => {
    const res = await markDuplicateAction(item.id, originalId);
    if (!res.ok) { fail(res.error, "grovnewsAdm.research.err.duplicateInvalid"); return; }
    toast.success(t("grovnewsAdm.research.done.duplicate"));
    setDuplicating(null);
    router.refresh();
  });

  const addManual = (input: { title: string; url: string; excerpt: string; sourceId: string | null }) => run("add", async () => {
    const res = await addManualItemAction(input);
    if (!res.ok) { fail(res.error, "grovnewsAdm.research.err.manualInvalid"); return; }
    toast.success(t("grovnewsAdm.research.done.added"));
    setAdding(false);
    router.refresh();
  });

  const titleOf = (id: string) => {
    const hit = items.find((i) => i.id === id);
    return hit ? hit.aiTitle ?? hit.title : null;
  };

  const btn = "inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 text-[12px] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50";
  const quiet = `${btn} text-muted hover:bg-raised hover:text-ink`;

  const rowActions = (item: AdminResearchItem) => {
    const s = item.status;
    const open = s === "NEW" || s === "ANALYZED" || s === "SELECTED";
    const working = (op: string) => busy === `${op}:${item.id}`;
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-1 lg:min-w-[232px]" data-research-actions={item.id}>
        <button type="button" className={quiet} onClick={() => setPreviewing(item)} data-research-action="preview">
          <Eye size={13} aria-hidden />{t("grovnewsAdm.research.actions.preview")}
        </button>
        {s === "USED" && item.postId && (
          <Link href={`${POST_EDITOR}/${item.postId}`} className={`${btn} text-accent hover:bg-accent-soft`} data-research-action="open-post">
            <Pencil size={13} aria-hidden />{t("grovnewsAdm.research.actions.openPost")}
          </Link>
        )}
        {(s === "NEW" || s === "ANALYZED") && (
          <button type="button" disabled={pending} className={`${btn} text-success hover:bg-[rgb(var(--success)/0.12)]`}
            onClick={() => setStatus(item, "select")} data-research-action="select">
            <Star size={13} aria-hidden />{t("grovnewsAdm.research.actions.select")}
          </button>
        )}
        {open && (
          <button type="button" disabled={pending || !aiAvailable} className={`${btn} text-accent hover:bg-accent-soft`}
            title={aiAvailable ? undefined : t("grovnewsAdm.research.aiOff")}
            onClick={() => draft(item)} data-research-action="draft">
            <FilePlus2 size={13} aria-hidden />
            {working("draft") ? t("grovnewsAdm.research.drafting") : t("grovnewsAdm.research.actions.draft")}
          </button>
        )}
        {(s === "ANALYZED" || s === "SELECTED" || (s === "NEW" && item.analysisError)) && (
          <button type="button" disabled={pending} className={quiet}
            onClick={() => setStatus(item, "reanalyze")} data-research-action="reanalyze">
            <RefreshCw size={13} aria-hidden />{t("grovnewsAdm.research.actions.reanalyze")}
          </button>
        )}
        {open && (
          <button type="button" disabled={pending} className={quiet}
            onClick={() => setStatus(item, "reject")} data-research-action="reject">
            <Ban size={13} aria-hidden />{t("grovnewsAdm.research.actions.reject")}
          </button>
        )}
        {(open || s === "REJECTED") && (
          <button type="button" disabled={pending} className={quiet}
            onClick={() => setDuplicating(item)} data-research-action="duplicate">
            <CopyX size={13} aria-hidden />{t("grovnewsAdm.research.actions.duplicate")}
          </button>
        )}
        {(s === "REJECTED" || s === "DUPLICATE") && (
          <button type="button" disabled={pending} className={quiet}
            onClick={() => setStatus(item, "restore")} data-research-action="restore">
            <Undo2 size={13} aria-hidden />{t("grovnewsAdm.research.actions.restore")}
          </button>
        )}
      </span>
    );
  };

  return (
    <div className="min-w-0 space-y-4" data-grovnews-research-inbox>
      {/* Filters — the same pills as the posts list, with counts. */}
      <nav aria-label={t("grovnewsAdm.research.filterLabel")} className="thin-scroll -mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {filters.map((f) => (
          <Link key={f} href={f === "inbox" ? BASE : `${BASE}?f=${f}`} aria-current={filter === f ? "page" : undefined}
            data-research-filter={f}
            className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold",
              filter === f ? "is-selected" : "border-line text-muted hover:bg-raised hover:text-ink")}>
            {t(`grovnewsAdm.research.filters.${f}`)}
            <span className="tabular-nums text-faint">{counts[f]}</span>
          </Link>
        ))}
      </nav>

      {/* Toolbar. */}
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" disabled={pending} onClick={ingest} data-research-ingest>
            <Download size={14} aria-hidden />
            {busy === "ingest" ? t("grovnewsAdm.research.ingesting") : t("grovnewsAdm.research.ingest")}
          </Button>
          <Button size="sm" variant="secondary" disabled={pending || !aiAvailable} onClick={analyze} data-research-analyze
            aria-describedby={aiAvailable ? undefined : "gn-research-ai-off"}>
            <Sparkles size={14} aria-hidden />
            {busy === "analyze" ? t("grovnewsAdm.research.analyzing") : t("grovnewsAdm.research.analyze")}
          </Button>
          <Button size="sm" disabled={pending} onClick={() => setAdding(true)} data-research-add>
            <ListPlus size={14} aria-hidden />{t("grovnewsAdm.research.addManual")}
          </Button>
        </div>
        {!aiAvailable && (
          <p id="gn-research-ai-off" className="min-w-0 break-words text-[12.5px] text-muted" data-research-ai-off>
            {t("grovnewsAdm.research.aiOff")}{" "}
            <Link href={PROVIDERS} className="font-semibold text-accent hover:opacity-80">{t("grovnewsAdm.research.aiOffLink")}</Link>
          </p>
        )}
      </div>

      {/* Safety note: what the machine may and may not do here. */}
      <div className="panel flex min-w-0 items-start gap-2.5 rounded-2xl px-4 py-3" data-research-safety>
        <ShieldAlert size={16} aria-hidden className="mt-0.5 shrink-0 text-accent" />
        <p className="min-w-0 break-words text-[12.5px] leading-relaxed text-muted">
          <span className="font-semibold text-ink">{t("grovnewsAdm.research.safetyTitle")}</span>{" "}
          {t("grovnewsAdm.research.safety")}
        </p>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={Inbox} title={t(`grovnewsAdm.research.empty.${filter}`)}
          body={t(`grovnewsAdm.research.emptyBody.${filter}`)} />
      ) : (
        <AdminTable
          empty={t(`grovnewsAdm.research.empty.${filter}`)}
          headers={[t("grovnewsAdm.colTitle"), `${t("grovnewsAdm.research.colSource")} · ${t("grovnewsAdm.colCategory")}`,
            `${t("grovnewsAdm.research.colImportance")} · ${t("grovnewsAdm.research.colRelevance")}`,
            t("grovnewsAdm.colStatus"), t("common.actions")]}
          rows={items.map((item) => [
            <span key="t" className="block min-w-0 max-w-[28rem]" data-research-item={item.id} data-status={item.status}>
              <button type="button" onClick={() => setPreviewing(item)}
                className="block w-full min-w-0 break-words text-left hover:text-accent">
                {item.aiTitle ?? item.title}
              </button>
              {item.host && (
                <span className="block truncate text-[11.5px] font-normal text-muted" title={item.url}>{item.host}</span>
              )}
              <span className="block whitespace-nowrap text-[11.5px] font-normal tabular-nums text-muted">
                {t("grovnewsAdm.research.colDate")}: {fmt(item.publishedAt ?? item.discoveredAt)}
              </span>
              {(item.official || item.reviewRequired || item.sensitive) && (
                <span className="mt-1 flex flex-wrap gap-1">
                  {item.official && <Badge tone="success">{t("grovnewsAdm.research.badgeOfficial")}</Badge>}
                  {item.reviewRequired && <Badge tone="warning">{t("grovnewsAdm.research.badgeReview")}</Badge>}
                  {item.sensitive && <Badge tone="info">{t("grovnewsAdm.research.badgeSensitive")}</Badge>}
                </span>
              )}
            </span>,
            // Source and category share a cell so the row's actions fit a
            // desktop table without scrolling out of sight.
            <span key="s" className="block min-w-0 max-w-[12rem]">
              <span className="block truncate" title={item.sourceName ?? undefined}>
                {item.sourceName ?? t("grovnewsAdm.research.manualSource")}
              </span>
              <span className="block truncate text-[11.5px] font-normal text-muted">{item.categoryName ?? "—"}</span>
            </span>,
            <span key="sc" className="grid grid-cols-[auto_auto] items-center gap-x-2 gap-y-1 text-[11.5px]">
              <span className="whitespace-nowrap text-muted">{t("grovnewsAdm.research.colImportance")}</span>
              <Meter value={item.importance} label={t("grovnewsAdm.research.colImportance")} />
              <span className="whitespace-nowrap text-muted">{t("grovnewsAdm.research.colRelevance")}</span>
              <Meter value={item.relevance} label={t("grovnewsAdm.research.colRelevance")} />
            </span>,
            <Badge key="st" tone={STATUS_TONE[item.status]} dot>{t(`grovnewsAdm.itemStatus.${item.status}`)}</Badge>,
            rowActions(item),
          ])}
        />
      )}

      {previewing && (
        <PreviewModal item={previewing} onClose={() => setPreviewing(null)} fmt={fmt} titleOf={titleOf} />
      )}

      {duplicating && (
        <DuplicateModal item={duplicating} pending={pending} onClose={() => setDuplicating(null)}
          candidates={items.filter((i) => i.id !== duplicating.id && i.status !== "DUPLICATE" && i.duplicateOf === null)}
          onSubmit={(originalId) => markDuplicate(duplicating, originalId)} />
      )}

      {/* Mounted only while open, so a finished or cancelled form starts empty next time. */}
      {adding && <ManualModal pending={pending} sources={sources} onClose={() => setAdding(false)} onSubmit={addManual} />}
    </div>
  );
}

/* ── preview ───────────────────────────────────────────────────────────────── */

/** Everything the inbox knows about one item. Fetched text is untrusted and
 *  rendered only as text — never as HTML. */
function PreviewModal({ item, onClose, fmt, titleOf }: {
  item: AdminResearchItem; onClose: () => void; fmt: (iso: string | null) => string; titleOf: (id: string) => string | null;
}) {
  const { t } = useI18n();
  const known = (ANALYSIS_ERRORS as readonly string[]).includes(item.analysisError ?? "");
  const original = item.duplicateOf ? titleOf(item.duplicateOf) : null;
  const section = "text-[11px] font-semibold uppercase tracking-[0.08em] text-faint";
  return (
    <Modal open wide onClose={onClose} title={t("grovnewsAdm.research.pv.title")}>
      <div className="min-w-0 space-y-4 text-sm" data-research-preview={item.id}>
        <div className="min-w-0">
          <p className="break-words font-display text-[15px] font-semibold leading-snug">{item.aiTitle ?? item.title}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone={STATUS_TONE[item.status]} dot>{t(`grovnewsAdm.itemStatus.${item.status}`)}</Badge>
            {item.official && <Badge tone="success">{t("grovnewsAdm.research.badgeOfficial")}</Badge>}
            {item.reviewRequired && <Badge tone="warning">{t("grovnewsAdm.research.badgeReview")}</Badge>}
            {item.sensitive && <Badge tone="info">{t("grovnewsAdm.research.badgeSensitive")}</Badge>}
          </div>
        </div>

        <section className="min-w-0 space-y-1">
          <p className={section}>{t("grovnewsAdm.research.pv.source")}</p>
          <p className="min-w-0 break-words text-muted">
            {item.sourceName ?? t("grovnewsAdm.research.manualSource")}
            {item.categoryName ? ` · ${item.categoryName}` : ""}
            {" · "}<span className="tabular-nums">{fmt(item.publishedAt ?? item.discoveredAt)}</span>
          </p>
          <a href={item.url} target="_blank" rel="noopener noreferrer nofollow" data-research-source-link
            className="inline-flex min-w-0 max-w-full items-center gap-1 font-semibold text-accent hover:opacity-80">
            <ExternalLink size={13} aria-hidden className="shrink-0" />
            <span className="truncate">{t("grovnewsAdm.research.pv.openSource", { host: item.host || item.url })}</span>
          </a>
        </section>

        <section className="min-w-0 space-y-1">
          <p className={section}>{t("grovnewsAdm.research.pv.sourceTitle")}</p>
          <p className="min-w-0 break-words">{item.title}</p>
        </section>

        <section className="min-w-0 space-y-1">
          <p className={section}>{t("grovnewsAdm.research.pv.excerpt")}</p>
          <p className="text-[11.5px] text-faint">{t("grovnewsAdm.research.pv.excerptNote")}</p>
          {item.excerpt ? (
            <p className="thin-scroll max-h-56 min-w-0 overflow-y-auto whitespace-pre-line break-words rounded-xl bg-sunken/70 px-3 py-2.5 text-[13px] leading-relaxed text-muted">
              {item.excerpt}
            </p>
          ) : (
            <p className="text-muted">{t("grovnewsAdm.research.pv.noExcerpt")}</p>
          )}
        </section>

        <section className="min-w-0 space-y-2">
          <p className={section}>{t("grovnewsAdm.research.pv.ai")}</p>
          {item.aiSummary || item.aiTitle || item.aiReason ? (
            <dl className="min-w-0 space-y-2">
              {item.aiTitle && (
                <div className="min-w-0">
                  <dt className="text-[12px] font-semibold text-ink">{t("grovnewsAdm.research.pv.aiTitle")}</dt>
                  <dd className="break-words text-muted">{item.aiTitle}</dd>
                </div>
              )}
              {item.aiSummary && (
                <div className="min-w-0">
                  <dt className="text-[12px] font-semibold text-ink">{t("grovnewsAdm.research.pv.aiSummary")}</dt>
                  <dd className="whitespace-pre-line break-words text-muted">{item.aiSummary}</dd>
                </div>
              )}
              {item.aiReason && (
                <div className="min-w-0">
                  <dt className="text-[12px] font-semibold text-ink">{t("grovnewsAdm.research.pv.aiReason")}</dt>
                  <dd className="whitespace-pre-line break-words text-muted">{item.aiReason}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="text-muted">{t("grovnewsAdm.research.pv.notAnalyzed")}</p>
          )}
          <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
            <span className="inline-flex items-center gap-2">
              <span className="text-[12px] font-semibold">{t("grovnewsAdm.research.colImportance")}</span>
              <Meter value={item.importance} label={t("grovnewsAdm.research.colImportance")} />
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="text-[12px] font-semibold">{t("grovnewsAdm.research.colRelevance")}</span>
              <Meter value={item.relevance} label={t("grovnewsAdm.research.colRelevance")} />
            </span>
          </div>
        </section>

        {item.reviewRequired && (
          <section className="min-w-0 space-y-1 rounded-xl border border-line px-3 py-2.5">
            <p className={section}>{t("grovnewsAdm.research.pv.reviewReason")}</p>
            <p className="whitespace-pre-line break-words text-muted">{item.reviewReason || t("grovnewsAdm.research.pv.reviewDefault")}</p>
          </section>
        )}

        {item.analysisError && (
          <section className="min-w-0 space-y-1" data-research-analysis-error>
            <p className={section}>{t("grovnewsAdm.research.pv.analysisError")}</p>
            <p className="break-words text-danger">
              {known ? t(`grovnewsAdm.research.analysisErrors.${item.analysisError}`) : t("grovnewsAdm.research.analysisErrors.generic")}
            </p>
            <p className="text-[12px] text-faint">{t("grovnewsAdm.research.pv.attempts", { n: item.analysisAttempts })}</p>
          </section>
        )}

        {item.status === "DUPLICATE" && (
          <section className="min-w-0 space-y-1">
            <p className={section}>{t("grovnewsAdm.research.pv.duplicate")}</p>
            <p className="break-words text-muted">
              {item.duplicateOf === null
                ? t("grovnewsAdm.research.pv.duplicateNoOriginal")
                : original ? t("grovnewsAdm.research.pv.duplicateOf", { title: original })
                  : t("grovnewsAdm.research.pv.duplicateOfHidden")}
            </p>
          </section>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
          {item.postId && (
            <Link href={`${POST_EDITOR}/${item.postId}`} data-research-open-post
              className="cta inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold">
              <Pencil size={14} aria-hidden />{t("grovnewsAdm.research.actions.openPost")}
            </Link>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>{t("common.close")}</Button>
        </div>
      </div>
    </Modal>
  );
}

/* ── mark as duplicate ─────────────────────────────────────────────────────── */

function DuplicateModal({ item, candidates, pending, onClose, onSubmit }: {
  item: AdminResearchItem; candidates: AdminResearchItem[]; pending: boolean;
  onClose: () => void; onSubmit: (originalId: string | null) => void;
}) {
  const { t } = useI18n();
  const [original, setOriginal] = useState("");
  return (
    <Modal open onClose={onClose} title={t("grovnewsAdm.research.dup.title")}>
      <div className="min-w-0 space-y-4" data-research-duplicate={item.id}>
        <p className="min-w-0 break-words text-sm font-semibold">{item.aiTitle ?? item.title}</p>
        <div className="min-w-0">
          <Label htmlFor="gn-dup-original">{t("grovnewsAdm.research.dup.original")}</Label>
          <Select id="gn-dup-original" value={original} onChange={(e) => setOriginal(e.target.value)} className="truncate">
            <option value="">{t("grovnewsAdm.research.dup.noOriginal")}</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>{(c.aiTitle ?? c.title).slice(0, 120)}</option>
            ))}
          </Select>
          <p className="mt-1.5 text-[12px] text-faint">{t("grovnewsAdm.research.dup.hint")}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button disabled={pending} onClick={() => onSubmit(original || null)} data-research-duplicate-submit>
            {t("grovnewsAdm.research.dup.submit")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ── manual item ───────────────────────────────────────────────────────────── */

function ManualModal({ pending, sources, onClose, onSubmit }: {
  pending: boolean; sources: { id: string; name: string }[];
  onClose: () => void; onSubmit: (input: { title: string; url: string; excerpt: string; sourceId: string | null }) => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [sourceId, setSourceId] = useState("");
  const urlOk = /^https:\/\/[^\s/]+\.[^\s]+$/i.test(url.trim());
  const ready = title.trim().length > 0 && title.trim().length <= 500 && urlOk;

  return (
    <Modal open onClose={onClose} title={t("grovnewsAdm.research.manual.title")}>
      <form className="min-w-0 space-y-4" data-research-manual
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onSubmit({ title: title.trim(), url: url.trim(), excerpt: excerpt.trim(), sourceId: sourceId || null });
        }}>
        <p className="text-[12.5px] leading-relaxed text-muted">{t("grovnewsAdm.research.manual.lead")}</p>
        <div>
          <Label htmlFor="gn-manual-title" hint={`${title.length}/500`}>{t("grovnewsAdm.research.manual.fTitle")}</Label>
          <Input id="gn-manual-title" value={title} maxLength={500} required onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="gn-manual-url">{t("grovnewsAdm.research.manual.fUrl")}</Label>
          <Input id="gn-manual-url" type="url" inputMode="url" value={url} maxLength={2000} required
            placeholder="https://" onChange={(e) => setUrl(e.target.value)} aria-invalid={url.trim() !== "" && !urlOk} />
          {url.trim() !== "" && !urlOk && (
            <p className="mt-1.5 text-[12px] text-danger">{t("grovnewsAdm.research.manual.urlHint")}</p>
          )}
        </div>
        <div>
          <Label htmlFor="gn-manual-notes" hint={`${excerpt.length}/2000`}>{t("grovnewsAdm.research.manual.fNotes")}</Label>
          <Textarea id="gn-manual-notes" rows={4} maxLength={2000} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} />
          <p className="mt-1.5 text-[12px] text-faint">{t("grovnewsAdm.research.manual.notesHint")}</p>
        </div>
        <div>
          <Label htmlFor="gn-manual-source" hint={t("grovnewsAdm.research.manual.optional")}>{t("grovnewsAdm.research.manual.fSource")}</Label>
          <Select id="gn-manual-source" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            <option value="">{t("grovnewsAdm.research.manual.noSource")}</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={pending || !ready} data-research-manual-submit>
            {t("grovnewsAdm.research.manual.submit")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
