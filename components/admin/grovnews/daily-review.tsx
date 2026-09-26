"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle, CheckCircle2, ExternalLink, Eye, Pencil, Plus, RefreshCw, Send, ShieldCheck, Trash2,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { toast } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label, Select, Textarea } from "@/components/ui/input";
import { ConfirmModal } from "@/components/ui/modal";
import { ContentBlocks } from "@/components/grovnews/reader";
import { parseContent } from "@/lib/grovnews";
import {
  DIGEST_WORDS, digestMinutes, editionDateLabel, wordCount, type DailyTopicRecord, type EditionStatus,
} from "@/lib/grovnews-research";
import type { AdminEditionDetail } from "@/lib/services/grovnews-research";
import {
  addDailyTopicAction, approveDailyArticleAction, regenerateDailyTopicAction, removeDailyTopicAction, saveDailyMailAction,
} from "@/app/actions/grovnews-daily";
import type { DailyReviewData } from "./edition-editor";
import { useFormatDateTime } from "./editions";

/** Every refusal the daily actions can return, as the sentence to show. */
const DAILY_ERR: Record<string, string> = {
  forbidden: "grovnewsAdm.errForbidden",
  invalid: "grovnewsAdm.daily.err.invalid",
  notArticle: "grovnewsAdm.daily.err.notArticle",
  locked: "grovnewsAdm.daily.err.locked",
  lastTopic: "grovnewsAdm.daily.err.lastTopic",
  structure: "grovnewsAdm.daily.err.structure",
  full: "grovnewsAdm.daily.err.full",
  used: "grovnewsAdm.daily.err.used",
  noServerKey: "grovnewsAdm.daily.err.noServerKey",
  aiUnavailable: "grovnewsAdm.daily.err.aiUnavailable",
  aiFailed: "grovnewsAdm.daily.err.aiFailed",
  campaignLocked: "grovnewsAdm.daily.err.campaignLocked",
  newsletter: "grovnewsAdm.daily.err.newsletter",
};
const errorKey = (code: string) => DAILY_ERR[code] ?? "common.error";

/** Why the whole article waits for a person (record.review.reasons). */
const REASON: Record<string, string> = {
  topic_review: "grovnewsAdm.daily.reason.topic_review",
  few_topics: "grovnewsAdm.daily.reason.few_topics",
  sources_failed: "grovnewsAdm.daily.reason.sources_failed",
  topic_dropped: "grovnewsAdm.daily.reason.topic_dropped",
  lead_unsupported: "grovnewsAdm.daily.reason.lead_unsupported",
};

/** Why one topic waits: known codes; anything else is the model's own
 *  sentence and is shown as written. */
const TOPIC_REVIEW: Record<string, string> = {
  flagged: "grovnewsAdm.daily.topicReview.flagged",
  sensitive_unofficial: "grovnewsAdm.daily.topicReview.sensitive_unofficial",
  related_flagged: "grovnewsAdm.daily.topicReview.related_flagged",
  single_source: "grovnewsAdm.daily.topicReview.single_source",
  model: "grovnewsAdm.daily.topicReview.model",
  unsupported_numbers: "grovnewsAdm.daily.topicReview.unsupported_numbers",
  verbatim: "grovnewsAdm.daily.topicReview.verbatim",
};

const CONFIDENCE_TONE = { HIGH: "success", MEDIUM: "info", LOW: "warning" } as const;

const ARTICLE_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
type ArticleStatus = (typeof ARTICLE_STATUSES)[number];
const ARTICLE_TONE = { DRAFT: "warning", PUBLISHED: "success", ARCHIVED: "neutral" } as const;

/** The mail copy can change until the mail is queued (saveDailyMailAction). */
const MAIL_EDITABLE: readonly EditionStatus[] = ["DRAFT", "READY", "PUBLISHED"];

const MAX_SOURCES_SHOWN = 6;
const MAIL_MAX = 600;

type Result = { ok: true } | { ok: false; error: string };

function Panel({ title, children, className, ...rest }: {
  title: string; children: React.ReactNode; className?: string;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn("panel min-w-0 rounded-2xl p-4 sm:p-5", className)} {...rest}>
      <h2 className="mb-4 break-words font-display text-[15px] font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Note({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("min-w-0 break-words text-[12.5px] leading-relaxed text-muted", className)}>{children}</p>;
}

const WARNING_BOX = "min-w-0 rounded-xl bg-[rgb(var(--warning)/0.12)] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-warning ring-1 ring-[rgb(var(--warning)/0.30)]";
const LINK_CLS = "inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-muted transition-colors hover:bg-raised hover:text-ink";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * THE DAY'S ONE ARTICLE — REVIEW MODE.
 *
 * What a person needs to review a day at once: why it waits (the same flags
 * that keep AUTOMATIC mode from publishing), the article and its mail side by
 * side, every topic with its sources and confidence, and the few edits the
 * server allows while it is a draft. Approving publishes; it never sends —
 * the mail goes out from the mail section of this page, after publication.
 */
export function DailyReview({ edition, daily }: { edition: AdminEditionDetail; daily: DailyReviewData }) {
  const { t } = useI18n();
  const router = useRouter();
  const fmt = useFormatDateTime();
  const [pending, start] = useTransition();
  /** Which action the running transition belongs to ("approve", "add",
   *  "regen:<id>", "remove:<id>"). */
  const [busy, setBusy] = useState<string | null>(null);
  const running = pending ? busy : null;
  const [approving, setApproving] = useState(false);
  const [removing, setRemoving] = useState<DailyTopicRecord | null>(null);
  const [addId, setAddId] = useState("");

  const { record, article } = daily;
  const topics = record.topics;
  const articleStatus: ArticleStatus = ARTICLE_STATUSES.find((s) => s === article.status) ?? "DRAFT";
  const topicsEditable = edition.status === "DRAFT" && article.status === "DRAFT";
  const canApprove = (edition.status === "DRAFT" || edition.status === "READY") && article.status === "DRAFT";
  const reasons = record.review.reasons;
  const full = topics.length >= daily.maxTopics;
  const candidates = useMemo(() => {
    const used = new Set(record.topics.map((tp) => tp.itemId));
    return daily.candidates.filter((c) => !used.has(c.id));
  }, [daily.candidates, record.topics]);
  const canAdd = topicsEditable && !full && candidates.length > 0;
  const blocks = useMemo(() => parseContent(article.content), [article.content]);
  const articleWords = wordCount(article.content);
  const articleMinutes = digestMinutes([article.content]);
  const articleInRange = articleWords >= DIGEST_WORDS.min && articleWords <= DIGEST_WORDS.max;

  const run = (key: string, action: () => Promise<Result>, okKey: string, onDone?: (ok: boolean) => void) => {
    setBusy(key);
    start(async () => {
      const res = await action();
      onDone?.(res.ok);
      if (res.ok) {
        toast.success(t(okKey));
        router.refresh();
      } else toast.error(t(errorKey(res.error)));
    });
  };

  const approve = () => run("approve", () => approveDailyArticleAction(edition.id), "grovnewsAdm.daily.approved",
    () => setApproving(false));
  const regenerate = (tp: DailyTopicRecord) => run(`regen:${tp.itemId}`, () => regenerateDailyTopicAction(edition.id, tp.itemId),
    "grovnewsAdm.daily.regenerated");
  const remove = (tp: DailyTopicRecord) => run(`remove:${tp.itemId}`, () => removeDailyTopicAction(edition.id, tp.itemId),
    "grovnewsAdm.daily.removed", () => setRemoving(null));
  const add = () => run("add", () => addDailyTopicAction(edition.id, addId), "grovnewsAdm.daily.added",
    (ok) => { if (ok) setAddId(""); });

  const candidateLabel = (c: DailyReviewData["candidates"][number]) => {
    const title = c.title.length > 120 ? `${c.title.slice(0, 119)}…` : c.title;
    const official = c.official ? ` · ${t("grovnewsAdm.daily.officialShort")}` : "";
    const scores = t("grovnewsAdm.daily.scores", { r: c.relevance ?? "—", i: c.importance ?? "—" });
    return `${title} — ${c.source || t("grovnewsAdm.daily.noSource")}${official} · ${scores}`;
  };

  // The mail editor starts over whenever the saved copy changes (a save, a
  // topic added, removed or rewritten), so it always edits what is stored.
  const mailKey = JSON.stringify([record.mailIntro, record.opening, topics.map((tp) => [tp.itemId, tp.mail])]);

  return (
    <div className="min-w-0 space-y-4" data-grovnews-daily-review>
      {/* 1 · status, warnings, approval */}
      <Panel title={t("grovnewsAdm.daily.title")} data-grovnews-daily-banner>
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12.5px] text-muted">
              <Badge tone={ARTICLE_TONE[articleStatus]} dot>{t(`grovnewsAdm.status.${articleStatus}`)}</Badge>
              <span className="tabular-nums" data-grovnews-daily-topic-count={topics.length}>
                {t("grovnewsAdm.daily.topicCount", { n: topics.length, max: daily.maxTopics })}
              </span>
              {article.publishedAt && (
                <span className="tabular-nums">{t("grovnewsAdm.daily.publishedOn", { date: fmt(article.publishedAt) ?? "" })}</span>
              )}
            </div>
            <Note className="max-w-2xl">{t("grovnewsAdm.daily.intro")}</Note>
          </div>
          {canApprove && (
            <div className="flex min-w-0 flex-col gap-1.5 lg:max-w-xs lg:shrink-0 lg:items-end">
              <Button size="sm" className="w-full sm:w-auto" disabled={pending} onClick={() => setApproving(true)}
                data-grovnews-daily-approve>
                <Send size={14} aria-hidden />{t("grovnewsAdm.daily.approve")}
              </Button>
              <p className="break-words text-[12px] leading-snug text-muted lg:text-right">{t("grovnewsAdm.daily.approveHint")}</p>
            </div>
          )}
        </div>

        {reasons.length > 0 ? (
          <div className={cn(WARNING_BOX, "mt-4")} data-grovnews-daily-warnings={reasons.join(",")}>
            <p className="flex items-center gap-2 font-semibold">
              <AlertTriangle size={15} aria-hidden className="shrink-0" />{t("grovnewsAdm.daily.reviewTitle")}
            </p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5">
              {reasons.map((r) => (
                <li key={r} className="break-words">{REASON[r] ? t(REASON[r]) : r}</li>
              ))}
            </ul>
            <p className="mt-2 break-words">{t("grovnewsAdm.daily.automaticNote")}</p>
          </div>
        ) : (
          <p className="mt-4 flex min-w-0 items-start gap-2 rounded-xl bg-[rgb(var(--success)/0.10)] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-success ring-1 ring-[rgb(var(--success)/0.28)]"
            data-grovnews-daily-warnings="">
            <CheckCircle2 size={15} aria-hidden className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">{t("grovnewsAdm.daily.noWarnings")}</span>
          </p>
        )}

        {article.status === "PUBLISHED" && <Note className="mt-3">{t("grovnewsAdm.daily.publishedNote")}</Note>}
        {canApprove && <Note className="mt-3">{t("grovnewsAdm.daily.approveEditionNote")}</Note>}
      </Panel>

      {/* 2 · the article and its mail, side by side on large screens */}
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <Panel title={t("grovnewsAdm.daily.articleTitle")} data-grovnews-daily-article={article.id}>
          <div className="min-w-0 space-y-3">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <h3 className="min-w-0 break-words font-display text-[16px] font-semibold leading-snug">{article.title}</h3>
              <Badge tone={ARTICLE_TONE[articleStatus]}>{t(`grovnewsAdm.status.${articleStatus}`)}</Badge>
            </div>
            {record.headline && (
              <div className="min-w-0">
                <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-faint">{t("grovnewsAdm.daily.headline")}</p>
                <p className="break-words text-[13.5px] font-medium leading-snug">{record.headline}</p>
              </div>
            )}
            <p className="break-words text-[12px] text-muted">
              <span className="tabular-nums">{t("grovnewsAdm.daily.articleTime", { n: articleMinutes, words: articleWords })}</span>
              {" · "}
              <span className={articleInRange ? "text-success" : "text-warning"}>
                {t("grovnewsAdm.daily.articleTarget", { min: DIGEST_WORDS.min, max: DIGEST_WORDS.max })}
              </span>
            </p>
            <div role="region" aria-label={t("grovnewsAdm.daily.articleBody")} tabIndex={0}
              className="thin-scroll max-h-[520px] min-w-0 overflow-y-auto overflow-x-hidden rounded-xl border border-line bg-[rgb(var(--sunken)/0.35)] px-3.5 py-3 [overflow-wrap:anywhere] sm:px-4"
              data-grovnews-daily-article-body>
              {blocks.length > 0 ? <ContentBlocks blocks={blocks} /> : <Note>{t("grovnewsAdm.daily.emptyContent")}</Note>}
            </div>
            <div className="flex min-w-0 flex-wrap gap-1">
              <Link href={`/admin/newsletter/grovnews/wpisy/${article.id}`} className={LINK_CLS} data-grovnews-daily-edit>
                <Pencil size={13} aria-hidden />{t("grovnewsAdm.daily.editInEditor")}
              </Link>
              <Link href={`/admin/newsletter/grovnews/wpisy/${article.id}/podglad`} className={LINK_CLS}>
                <Eye size={13} aria-hidden />{t("grovnewsAdm.preview")}
              </Link>
            </div>
            {topicsEditable && <Note>{t("grovnewsAdm.daily.structureNote")}</Note>}
          </div>
        </Panel>

        <MailEditor key={mailKey} edition={edition} daily={daily} />
      </div>

      {/* 3 · the topics */}
      <Panel title={t("grovnewsAdm.daily.topicsTitle", { n: topics.length })} data-grovnews-daily-topics>
        <div className="min-w-0 space-y-3">
          {!topicsEditable && <Note>{t("grovnewsAdm.daily.topicsLocked")}</Note>}
          {topicsEditable && topics.length <= 1 && <Note>{t("grovnewsAdm.daily.lastTopicHint")}</Note>}

          <ol className="min-w-0 space-y-3">
            {topics.map((tp, index) => {
              const sources = [...tp.sources].sort((a, b) => Number(b.official) - Number(a.official));
              const shown = sources.slice(0, MAX_SOURCES_SHOWN);
              const topicReasons = (tp.reviewReason ?? "").split(";").map((s) => s.trim()).filter(Boolean);
              const regenerating = running === `regen:${tp.itemId}`;
              return (
                <li key={tp.itemId} data-grovnews-daily-topic={tp.itemId} className="plate min-w-0 rounded-xl px-3 py-3 sm:px-3.5">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 w-5 shrink-0 text-right text-[12px] font-semibold tabular-nums text-faint">{index + 1}.</span>
                    <div className="min-w-0 flex-1 space-y-2.5">
                      <p className="break-words text-[14px] font-semibold leading-snug">{tp.title}</p>
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        {tp.category && (
                          <Badge tone="neutral" className="min-w-0 max-w-full"><span className="truncate">{tp.category}</span></Badge>
                        )}
                        <Badge tone={CONFIDENCE_TONE[tp.confidence]}>{t(`grovnewsAdm.daily.confidence.${tp.confidence}`)}</Badge>
                        {tp.official && (
                          <Badge tone="accent"><ShieldCheck size={12} aria-hidden />{t("grovnewsAdm.daily.official")}</Badge>
                        )}
                      </div>
                      {tp.short && <p className="break-words text-[12.5px] leading-relaxed text-muted">{tp.short}</p>}

                      {tp.review && (
                        <div className={WARNING_BOX} data-grovnews-daily-topic-review>
                          <p className="flex items-center gap-2 font-semibold">
                            <AlertTriangle size={14} aria-hidden className="shrink-0" />{t("grovnewsAdm.daily.topicReviewTitle")}
                          </p>
                          {topicReasons.length > 0 && (
                            <ul className="mt-1 list-disc space-y-0.5 pl-5">
                              {topicReasons.map((r, i) => (
                                <li key={`${i}-${r}`} className="break-words">{TOPIC_REVIEW[r] ? t(TOPIC_REVIEW[r]) : r}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}

                      <div className="min-w-0">
                        <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-faint">
                          {t("grovnewsAdm.daily.sourcesCount", { n: sources.length })}
                        </p>
                        {shown.length === 0 ? (
                          <Note>{t("grovnewsAdm.daily.noSources")}</Note>
                        ) : (
                          <ul className="mt-1 min-w-0 space-y-1.5">
                            {shown.map((s, i) => (
                              <li key={`${i}-${s.url}`} className="min-w-0 text-[12.5px] leading-snug" data-grovnews-daily-source={s.official ? "official" : "other"}>
                                <a href={s.url} target="_blank" rel="noopener noreferrer nofollow"
                                  className="inline-flex min-w-0 max-w-full items-start gap-1.5 font-medium text-accent hover:underline">
                                  <ExternalLink size={12} aria-hidden className="mt-0.5 shrink-0" />
                                  <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                                    {s.source && <span className="font-semibold">{s.source}: </span>}{s.title || s.url}
                                  </span>
                                </a>
                                <span className="flex min-w-0 flex-wrap items-center gap-1.5 pl-[18px] text-[11px] text-faint">
                                  <span className="min-w-0 break-all">{hostOf(s.url)}</span>
                                  {s.official && <Badge tone="accent">{t("grovnewsAdm.daily.officialShort")}</Badge>}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {sources.length > MAX_SOURCES_SHOWN && (
                          <p className="mt-1 text-[11.5px] text-faint">{t("grovnewsAdm.daily.moreSources", { n: sources.length - MAX_SOURCES_SHOWN })}</p>
                        )}
                      </div>

                      <div className="flex min-w-0 flex-wrap gap-2 pt-0.5">
                        <Button size="sm" variant="secondary" disabled={!topicsEditable || pending}
                          onClick={() => regenerate(tp)} data-grovnews-daily-regenerate={tp.itemId}>
                          <RefreshCw size={14} aria-hidden className={regenerating ? "animate-spin" : undefined} />
                          {t(regenerating ? "grovnewsAdm.daily.regenerating" : "grovnewsAdm.daily.regenerate")}
                        </Button>
                        <button type="button" disabled={!topicsEditable || pending || topics.length <= 1}
                          onClick={() => setRemoving(tp)} data-grovnews-daily-remove={tp.itemId}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold text-danger transition-colors hover:bg-[rgb(var(--danger)/0.08)] disabled:pointer-events-none disabled:opacity-40">
                          <Trash2 size={14} aria-hidden />{t("grovnewsAdm.daily.remove")}
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="min-w-0 space-y-2 border-t border-line pt-4" data-grovnews-daily-add>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <Label htmlFor="daily-add">{t("grovnewsAdm.daily.addLabel")}</Label>
                <Select id="daily-add" value={addId} disabled={!canAdd || pending} onChange={(e) => setAddId(e.target.value)}>
                  <option value="">{t("grovnewsAdm.daily.addPick")}</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>{candidateLabel(c)}</option>
                  ))}
                </Select>
              </div>
              <Button size="md" variant="secondary" className="w-full shrink-0 sm:w-auto"
                disabled={!canAdd || !addId || pending} onClick={add} data-grovnews-daily-add-submit>
                {running === "add"
                  ? <RefreshCw size={15} aria-hidden className="animate-spin" />
                  : <Plus size={15} aria-hidden />}
                {t(running === "add" ? "grovnewsAdm.daily.adding" : "grovnewsAdm.daily.add")}
              </Button>
            </div>
            {topicsEditable && full && <Note>{t("grovnewsAdm.daily.addFull", { max: daily.maxTopics })}</Note>}
            {topicsEditable && !full && candidates.length === 0 && <Note>{t("grovnewsAdm.daily.noCandidates")}</Note>}
            <Note>{t("grovnewsAdm.daily.aiNote")}</Note>
          </div>
        </div>
      </Panel>

      <ConfirmModal open={approving} onClose={() => setApproving(false)} onConfirm={approve} pending={pending}
        title={t("grovnewsAdm.daily.approveTitle")}
        body={reasons.length > 0
          ? `${t("grovnewsAdm.daily.approveBodyWarn")} ${t("grovnewsAdm.daily.approveBody")}`
          : t("grovnewsAdm.daily.approveBody")}
        confirmLabel={t("grovnewsAdm.daily.approveConfirm")} />

      <ConfirmModal open={removing !== null} onClose={() => setRemoving(null)} onConfirm={() => { if (removing) remove(removing); }}
        danger pending={pending}
        title={t("grovnewsAdm.daily.removeTitle")} body={t("grovnewsAdm.daily.removeBody", { title: removing?.title ?? "" })}
        confirmLabel={t("grovnewsAdm.daily.remove")} />
    </div>
  );
}

/* ── the mail: preview and its short copy ──────────────────────────────────── */

function MailEditor({ edition, daily }: { edition: AdminEditionDetail; daily: DailyReviewData }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const { record } = daily;
  // What the mail says now (composeDailyMail: the intro falls back to the
  // opening when the model wrote none).
  const initialIntro = record.mailIntro || record.opening;
  const [intro, setIntro] = useState(initialIntro);
  const [mails, setMails] = useState<Record<string, string>>(
    () => Object.fromEntries(record.topics.map((tp) => [tp.itemId, tp.mail])),
  );

  const campaignLocked = Boolean(edition.campaign && edition.campaign.status !== "draft");
  const editable = MAIL_EDITABLE.includes(edition.status) && !campaignLocked;
  const dirty = intro !== initialIntro || record.topics.some((tp) => (mails[tp.itemId] ?? "") !== tp.mail);
  const blank = !intro.trim() || record.topics.some((tp) => !(mails[tp.itemId] ?? "").trim());

  const subject = `GrovNews — ${editionDateLabel(edition.date)}`;
  const preview = (record.headline || record.topics[0]?.title || "").slice(0, 140);

  // The mail's reading time, from exactly what it will say.
  const texts = [intro, ...record.topics.flatMap((tp) => [tp.title, mails[tp.itemId] ?? ""])];
  const words = texts.reduce((n, s) => n + wordCount(s), 0);
  const minutes = digestMinutes(texts);

  const save = () => start(async () => {
    const res = await saveDailyMailAction(edition.id, { intro, mails });
    if (res.ok) {
      toast.success(t("grovnewsAdm.daily.mailSaved"));
      router.refresh();
    } else toast.error(t(errorKey(res.error)));
  });

  const dt = "text-[10.5px] font-medium uppercase tracking-[0.08em] text-faint";

  return (
    <Panel title={t("grovnewsAdm.daily.mailTitle")} data-grovnews-daily-mail>
      <div className="min-w-0 space-y-4">
        <dl className="grid min-w-0 grid-cols-1 gap-2 text-[12.5px]">
          <div className="min-w-0">
            <dt className={dt}>{t("grovnewsAdm.editions.subject")}</dt>
            <dd className="break-words font-semibold tabular-nums" data-grovnews-daily-mail-subject>{subject}</dd>
          </div>
          <div className="min-w-0">
            <dt className={dt}>{t("grovnewsAdm.editions.previewLine")}</dt>
            <dd className="break-words text-muted">{preview || "—"}</dd>
          </div>
        </dl>

        <iframe title={t("grovnewsAdm.daily.mailFrame")} srcDoc={daily.mailHtml} sandbox=""
          className="block h-[520px] w-full min-w-0 max-w-full rounded-xl border border-line bg-white"
          data-grovnews-daily-mail-frame />
        {dirty && <Note>{t("grovnewsAdm.daily.mailPreviewSaved")}</Note>}

        <div className="plate min-w-0 rounded-xl px-3.5 py-3" data-grovnews-daily-mail-minutes={minutes}>
          <p className="text-[13px] font-semibold tabular-nums">{t("grovnewsAdm.daily.mailTime", { n: minutes, words })}</p>
          <p className="mt-0.5 break-words text-[12px] text-muted">{t("grovnewsAdm.daily.mailTarget")}</p>
        </div>

        <div className="min-w-0 space-y-3 border-t border-line pt-4" data-grovnews-daily-mail-form>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold tracking-tight">{t("grovnewsAdm.daily.mailCopyTitle")}</p>
            <Note>{t("grovnewsAdm.daily.mailCopyHint")}</Note>
          </div>
          <div className="min-w-0">
            <Label htmlFor="daily-mail-intro" hint={`${intro.length}/${MAIL_MAX}`}>{t("grovnewsAdm.daily.mailIntro")}</Label>
            <Textarea id="daily-mail-intro" rows={3} maxLength={MAIL_MAX} readOnly={!editable} value={intro}
              data-grovnews-daily-mail-intro onChange={(e) => setIntro(e.target.value)} />
          </div>
          {record.topics.map((tp, index) => (
            <div key={tp.itemId} className="min-w-0">
              <Label htmlFor={`daily-mail-${tp.itemId}`} hint={`${(mails[tp.itemId] ?? "").length}/${MAIL_MAX}`}>
                <span className="break-words">{index + 1}. {tp.title}</span>
              </Label>
              <Textarea id={`daily-mail-${tp.itemId}`} rows={3} maxLength={MAIL_MAX} readOnly={!editable}
                value={mails[tp.itemId] ?? ""} data-grovnews-daily-mail-topic={tp.itemId}
                onChange={(e) => setMails((m) => ({ ...m, [tp.itemId]: e.target.value }))} />
            </div>
          ))}

          {editable ? (
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              {dirty && (
                <span className={cn("min-w-0 break-words text-[12px] sm:mr-auto", blank ? "text-warning" : "text-muted")}>
                  {t(blank ? "grovnewsAdm.daily.mailBlank" : "grovnewsAdm.daily.unsaved")}
                </span>
              )}
              <Button size="sm" className="w-full sm:w-auto" disabled={pending || !dirty || blank} onClick={save}
                data-grovnews-daily-mail-save>
                {t(pending ? "common.saving" : "grovnewsAdm.daily.saveMail")}
              </Button>
            </div>
          ) : (
            <Note>{t(campaignLocked ? "grovnewsAdm.daily.mailCampaignLocked" : "grovnewsAdm.daily.mailLocked")}</Note>
          )}
          {editable && edition.campaignId && <Note>{t("grovnewsAdm.daily.mailCampaignNote")}</Note>}
        </div>
      </div>
    </Panel>
  );
}
