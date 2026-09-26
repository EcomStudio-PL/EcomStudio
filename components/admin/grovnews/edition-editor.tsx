"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Archive, CheckCircle2, ExternalLink, Eye, FlaskConical, Mail, Pencil,
  Plus, Send, Sparkles, Star, Undo2, X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { toast } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { ConfirmModal, Modal } from "@/components/ui/modal";
import { MailPreview } from "@/components/admin/newsletter/mail-preview";
import {
  arrangeEditionAction, prepareEmailAction, saveEditionAction, saveEmailAction, sendEditionAction, setEditionStatusAction,
  testSendEditionAction, type EditionTarget,
} from "@/app/actions/grovnews-research";
import { DIGEST_WORDS, digestMinutes, editionDateLabel, wordCount, type EditionStatus } from "@/lib/grovnews-research";
import type { AdminEditionDetail } from "@/lib/services/grovnews-research";
import { EDITION_TONE, isFailureReason, useFormatDateTime } from "./editions";

type Candidate = { id: string; title: string; status: string; publishedAt: string | null };

/** The moves the server allows from each state (TRANSITIONS in
 *  app/actions/grovnews-research.ts) — mirrored so the screen only offers
 *  what the first click would not refuse. The server checks again. */
const MOVES: Record<EditionStatus, readonly EditionTarget[]> = {
  DRAFT: ["READY", "ARCHIVED"],
  READY: ["PUBLISHED", "DRAFT", "ARCHIVED"],
  PUBLISHED: ["DRAFT", "ARCHIVED"],
  QUEUED: [],
  SENT: [],
  FAILED: ["ARCHIVED"],
  ARCHIVED: [],
};

const MAIL_STATES: readonly EditionStatus[] = ["PUBLISHED", "QUEUED", "SENT", "FAILED"];
const MAX_POSTS = 20;

/** Every refusal the edition actions can return, as the sentence to show. */
const ERR: Record<string, string> = {
  forbidden: "grovnewsAdm.errForbidden",
  invalid: "grovnewsAdm.editions.err.invalid",
  empty: "grovnewsAdm.editions.err.empty",
  unpublished: "grovnewsAdm.editions.err.unpublished",
  locked: "grovnewsAdm.editions.err.locked",
  noServerKey: "grovnewsAdm.editions.err.noServerKey",
  notPublished: "grovnewsAdm.editions.err.notPublished",
  campaignLocked: "grovnewsAdm.editions.err.campaignLocked",
  notPrepared: "grovnewsAdm.editions.err.notPrepared",
  audienceChanged: "grovnewsAdm.editions.err.audienceChanged",
  noRecipients: "grovnewsAdm.editions.err.noRecipients",
  newsletter: "grovnewsAdm.editions.err.newsletter",
};

/** The newsletter's own refusal codes, passed through by the test and the send. */
const NEWSLETTER_ERR: Record<string, string> = {
  suppressedAddress: "grovnewsAdm.editions.nl.suppressedAddress",
  email: "grovnewsAdm.editions.nl.email",
  tooMany: "grovnewsAdm.editions.nl.tooMany",
  subject: "grovnewsAdm.editions.nl.subject",
  body: "grovnewsAdm.editions.nl.body",
  notConfigured: "grovnewsAdm.editions.nl.notConfigured",
  missing: "grovnewsAdm.editions.nl.missing",
  sending: "grovnewsAdm.editions.nl.sending",
  audience: "grovnewsAdm.editions.nl.audience",
  generic: "grovnewsAdm.editions.nl.generic",
};

type Failure = { ok: false; error: string; code?: string };

/** A refusal as words: the newsletter's own code when it gave one, then the
 *  action's, then the generic sentence. Never the raw code. */
function errorKey(res: Failure, override?: Partial<Record<string, string>>): string {
  if (res.error === "newsletter" && res.code) return NEWSLETTER_ERR[res.code] ?? NEWSLETTER_ERR.generic;
  return override?.[res.error] ?? ERR[res.error] ?? "common.error";
}

const MOVE_LABEL: Record<EditionTarget, string> = {
  READY: "grovnewsAdm.editions.move.READY",
  PUBLISHED: "grovnewsAdm.editions.move.PUBLISHED",
  DRAFT: "grovnewsAdm.editions.move.DRAFT",
  ARCHIVED: "grovnewsAdm.editions.move.ARCHIVED",
};
const MOVE_DONE: Record<EditionTarget, string> = {
  READY: "grovnewsAdm.editions.moved.READY",
  PUBLISHED: "grovnewsAdm.editions.moved.PUBLISHED",
  DRAFT: "grovnewsAdm.editions.moved.DRAFT",
  ARCHIVED: "grovnewsAdm.editions.moved.ARCHIVED",
};
const MOVE_ICON = { READY: CheckCircle2, PUBLISHED: Send, DRAFT: Undo2, ARCHIVED: Archive } as const;

function Section({ title, children, className, ...rest }: {
  title: string; children: React.ReactNode; className?: string;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn("panel min-w-0 rounded-2xl p-4 sm:p-5", className)} {...rest}>
      <h2 className="mb-4 font-display text-[15px] font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Warning({ children, ...rest }: { children: React.ReactNode } & React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className="flex min-w-0 items-start gap-2 rounded-xl bg-[rgb(var(--warning)/0.12)] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-warning ring-1 ring-[rgb(var(--warning)/0.30)]" {...rest}>
      <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="min-w-0 break-words text-[12.5px] leading-relaxed text-muted">{children}</p>;
}

/**
 * ONE EDITION — its status, its words, its posts and its mail.
 *
 * The server decides everything that matters (0121: READY/PUBLISHED only with
 * every post published, the list fixed outside DRAFT, the mail copy fixed once
 * queued); this screen offers only the moves that can succeed and turns every
 * refusal into a sentence.
 */
export function EditionEditor({ edition, candidates, adminEmail }: {
  edition: AdminEditionDetail; candidates: Candidate[]; adminEmail: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [archiving, setArchiving] = useState(false);
  /** Whether the last "Przygotuj e-mail" in this visit had the AI write the
   *  copy — survives the refresh because this component is not remounted. */
  const [aiUsed, setAiUsed] = useState<boolean | null>(null);

  const status = edition.status;
  const hasUnpublished = edition.items.some((i) => i.status !== "PUBLISHED");
  const moves = MOVES[status];

  const move = (target: EditionTarget) => start(async () => {
    const res = await setEditionStatusAction(edition.id, target);
    if (res.ok) {
      toast.success(t(MOVE_DONE[target]));
      setArchiving(false);
      router.refresh();
    } else toast.error(t(errorKey(res)));
  });

  const prepare = () => start(async () => {
    const res = await prepareEmailAction(edition.id);
    if (res.ok) {
      setAiUsed(res.aiUsed);
      toast.success(t(res.aiUsed ? "grovnewsAdm.editions.preparedAi" : "grovnewsAdm.editions.preparedPlain"));
      router.refresh();
    } else toast.error(t(errorKey(res)));
  });

  return (
    <div className="min-w-0 space-y-4">
      {/* 1 · header and status */}
      <header className="min-w-0 space-y-3" data-grovnews-edition-status={status}>
        <Link href="/admin/newsletter/grovnews/wydania"
          className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-muted transition-colors hover:text-ink">
          <ArrowLeft size={14} aria-hidden />{t("grovnewsAdm.editions.back")}
        </Link>
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="break-words font-display text-xl font-semibold tracking-tight">{edition.title}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
              <span className="tabular-nums">{editionDateLabel(edition.date)}</span>
              <Badge tone={EDITION_TONE[status]} dot>{t(`grovnewsAdm.editionStatus.${status}`)}</Badge>
              {edition.autoGenerated && <Badge tone="neutral">{t("grovnewsAdm.editions.auto")}</Badge>}
            </div>
            <p className="mt-2 max-w-2xl break-words text-[12.5px] leading-relaxed text-muted">
              {t(`grovnewsAdm.editions.statusHint.${status}`)}
            </p>
          </div>
          {moves.length > 0 && (
            <div className="flex flex-wrap gap-2 lg:shrink-0 lg:justify-end">
              {moves.map((target) => {
                const Icon = MOVE_ICON[target];
                const needsPublished = target === "READY" || target === "PUBLISHED";
                return (
                  <Button key={target} size="sm" data-grovnews-edition-move={target}
                    variant={needsPublished ? "primary" : target === "ARCHIVED" ? "ghost" : "secondary"}
                    disabled={pending || (needsPublished && (edition.items.length === 0 || hasUnpublished))}
                    onClick={() => (target === "ARCHIVED" ? setArchiving(true) : move(target))}>
                    <Icon size={14} aria-hidden />{t(MOVE_LABEL[target])}
                  </Button>
                );
              })}
            </div>
          )}
        </div>
      </header>

      {/* 2 · title and intro */}
      <DetailsForm key={`${edition.title}\u0000${edition.intro}`} edition={edition} />

      {/* 3 · posts */}
      <PostsSection edition={edition} candidates={candidates} hasUnpublished={hasUnpublished} />

      {/* 4 · mail */}
      <Section title={t("grovnewsAdm.editions.mailTitle")} data-grovnews-edition-mail>
        {!MAIL_STATES.includes(status) ? (
          <Note>{t(status === "ARCHIVED" ? "grovnewsAdm.editions.mailArchived" : "grovnewsAdm.editions.mailNeedsPublished")}</Note>
        ) : (
          <MailPanel edition={edition} adminEmail={adminEmail} aiUsed={aiUsed} pending={pending} onPrepare={prepare}
            hasUnpublished={hasUnpublished} />
        )}
      </Section>

      <ConfirmModal open={archiving} onClose={() => setArchiving(false)} onConfirm={() => move("ARCHIVED")} danger pending={pending}
        title={t("grovnewsAdm.editions.archiveTitle")} body={t("grovnewsAdm.editions.archiveBody")}
        confirmLabel={t("grovnewsAdm.editions.move.ARCHIVED")} />
    </div>
  );
}

/* ── title and intro ───────────────────────────────────────────────────────── */

function DetailsForm({ edition }: { edition: AdminEditionDetail }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(edition.title);
  const [intro, setIntro] = useState(edition.intro);
  const editable = edition.status === "DRAFT" || edition.status === "READY" || edition.status === "PUBLISHED";
  const dirty = title !== edition.title || intro !== edition.intro;

  const save = () => start(async () => {
    const res = await saveEditionAction(edition.id, { title, intro });
    if (res.ok) { toast.success(t("grovnewsAdm.saved")); router.refresh(); }
    else toast.error(t(errorKey(res, { invalid: "grovnewsAdm.editions.err.title" })));
  });

  return (
    <Section title={t("grovnewsAdm.editions.detailsTitle")} data-grovnews-edition-details>
      <div className="space-y-4">
        <div>
          <Label htmlFor="ed-title" hint={`${title.length}/200`}>{t("grovnewsAdm.colTitle")}</Label>
          <Input id="ed-title" value={title} maxLength={200} readOnly={!editable} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ed-intro" hint={`${intro.length}/1500`}>{t("grovnewsAdm.editions.introLabel")}</Label>
          <Textarea id="ed-intro" rows={3} value={intro} maxLength={1500} readOnly={!editable}
            placeholder={t("grovnewsAdm.editions.introHint")} onChange={(e) => setIntro(e.target.value)} />
        </div>
        {editable ? (
          <div className="flex justify-end">
            <Button size="sm" disabled={pending || !dirty || !title.trim()} onClick={save} data-grovnews-edition-save>
              {t("grovnewsAdm.save")}
            </Button>
          </div>
        ) : (
          <Note>{t("grovnewsAdm.editions.detailsLocked")}</Note>
        )}
      </div>
    </Section>
  );
}

/* ── posts ─────────────────────────────────────────────────────────────────── */

function PostsSection({ edition, candidates, hasUnpublished }: {
  edition: AdminEditionDetail; candidates: Candidate[]; hasUnpublished: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [addId, setAddId] = useState("");
  const editable = edition.status === "DRAFT";
  const items = edition.items;
  const ids = items.map((i) => i.postId);
  const featured = items.find((i) => i.featured)?.postId ?? null;
  const available = useMemo(() => {
    const taken = new Set(edition.items.map((i) => i.postId));
    return candidates.filter((c) => !taken.has(c.id));
  }, [candidates, edition.items]);

  /** Every change sends the WHOLE new list: one call, one transaction. */
  const arrange = (next: string[], nextFeatured: string | null, okKey: string) => start(async () => {
    const res = await arrangeEditionAction(edition.id, next, nextFeatured && next.includes(nextFeatured) ? nextFeatured : null);
    if (res.ok) { toast.success(t(okKey)); setAddId(""); router.refresh(); }
    else toast.error(t(errorKey(res, { locked: "grovnewsAdm.editions.err.listLocked" })));
  });

  const shift = (index: number, by: -1 | 1) => {
    const next = [...ids];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    arrange(next, featured, "grovnewsAdm.editions.listSaved");
  };

  const iconBtn = "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-40";
  const linkCls = "inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-muted transition-colors hover:bg-raised hover:text-ink";

  return (
    <Section title={t("grovnewsAdm.editions.postsTitle", { n: items.length })} data-grovnews-edition-posts>
      <div className="space-y-3">
        {hasUnpublished && <Warning data-grovnews-edition-unpublished>{t("grovnewsAdm.editions.unpublishedWarning")}</Warning>}

        {items.length === 0 ? (
          <p className="plate rounded-xl px-3.5 py-6 text-center text-[12.5px] text-muted">{t("grovnewsAdm.editions.noPosts")}</p>
        ) : (
          <ol className="space-y-2">
            {items.map((item, index) => (
              <li key={item.postId} data-grovnews-edition-post={item.postId}
                className="plate flex min-w-0 flex-col gap-2 rounded-xl px-3 py-2.5 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className="mt-0.5 w-5 shrink-0 text-right text-[12px] font-semibold tabular-nums text-faint">{index + 1}.</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-start gap-1.5 text-[13.5px] font-semibold">
                      {item.featured && (
                        <Star size={14} aria-label={t("grovnewsAdm.editions.featured")} className="mt-0.5 shrink-0 fill-current text-accent" />
                      )}
                      <span className="min-w-0 break-words">{item.title || "—"}</span>
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <Badge tone={item.status === "PUBLISHED" ? "success" : item.status === "ARCHIVED" ? "neutral" : "warning"}>
                        {t(`grovnewsAdm.status.${item.status}`)}
                      </Badge>
                      <Link href={`/admin/newsletter/grovnews/wpisy/${item.postId}`} className={linkCls}>
                        <Pencil size={13} aria-hidden />{t("grovnewsAdm.edit")}
                      </Link>
                      <Link href={`/admin/newsletter/grovnews/wpisy/${item.postId}/podglad`} className={linkCls}>
                        <Eye size={13} aria-hidden />{t("grovnewsAdm.preview")}
                      </Link>
                    </div>
                  </div>
                </div>
                {editable && (
                  <div className="flex shrink-0 items-center gap-0.5 self-end sm:self-center">
                    <button type="button" className={cn(iconBtn, item.featured && "text-accent")} disabled={pending}
                      aria-pressed={item.featured} data-grovnews-edition-feature={item.postId}
                      aria-label={t(item.featured ? "grovnewsAdm.editions.unfeature" : "grovnewsAdm.editions.feature")}
                      title={t(item.featured ? "grovnewsAdm.editions.unfeature" : "grovnewsAdm.editions.feature")}
                      onClick={() => arrange(ids, item.featured ? null : item.postId, "grovnewsAdm.editions.listSaved")}>
                      <Star size={15} aria-hidden className={item.featured ? "fill-current" : undefined} />
                    </button>
                    <button type="button" className={iconBtn} disabled={pending || index === 0}
                      aria-label={t("grovnewsAdm.moveUp")} title={t("grovnewsAdm.moveUp")} onClick={() => shift(index, -1)}>
                      <ArrowUp size={15} aria-hidden />
                    </button>
                    <button type="button" className={iconBtn} disabled={pending || index === items.length - 1}
                      aria-label={t("grovnewsAdm.moveDown")} title={t("grovnewsAdm.moveDown")} onClick={() => shift(index, 1)}>
                      <ArrowDown size={15} aria-hidden />
                    </button>
                    <button type="button" className={cn(iconBtn, "hover:text-danger")} disabled={pending}
                      aria-label={t("grovnewsAdm.editions.remove")} title={t("grovnewsAdm.editions.remove")}
                      data-grovnews-edition-remove={item.postId}
                      onClick={() => arrange(ids.filter((id) => id !== item.postId), featured, "grovnewsAdm.editions.removed")}>
                      <X size={15} aria-hidden />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}

        {editable ? (
          available.length > 0 ? (
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end" data-grovnews-edition-add>
              <div className="min-w-0 flex-1">
                <Label htmlFor="ed-add">{t("grovnewsAdm.editions.addLabel")}</Label>
                <Select id="ed-add" value={addId} onChange={(e) => setAddId(e.target.value)}>
                  <option value="">{t("grovnewsAdm.editions.addPick")}</option>
                  {available.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} · {t(c.status === "PUBLISHED" ? "grovnewsAdm.status.PUBLISHED" : "grovnewsAdm.status.DRAFT")}
                    </option>
                  ))}
                </Select>
              </div>
              <Button size="md" variant="secondary" className="shrink-0"
                disabled={pending || !addId || items.length >= MAX_POSTS}
                onClick={() => arrange([...ids, addId], featured, "grovnewsAdm.editions.added")}>
                <Plus size={15} aria-hidden />{t("grovnewsAdm.add")}
              </Button>
            </div>
          ) : (
            <Note>{t("grovnewsAdm.editions.noCandidates")}</Note>
          )
        ) : (
          <Note>{t("grovnewsAdm.editions.listLocked")}</Note>
        )}
        {editable && items.length >= MAX_POSTS && <Note>{t("grovnewsAdm.editions.maxPosts", { n: MAX_POSTS })}</Note>}
      </div>
    </Section>
  );
}

/* ── mail ──────────────────────────────────────────────────────────────────── */

function MailPanel({ edition, adminEmail, aiUsed, pending, onPrepare, hasUnpublished }: {
  edition: AdminEditionDetail; adminEmail: string; aiUsed: boolean | null; pending: boolean; onPrepare: () => void;
  hasUnpublished: boolean;
}) {
  const { t } = useI18n();
  const fmt = useFormatDateTime();
  const campaign = edition.campaign;
  const campaignDraft = campaign?.status === "draft";
  const prepared = Boolean(edition.emailPreparedAt);
  const canPrepare = edition.status === "PUBLISHED" && (!campaign || campaignDraft);
  const reason = isFailureReason(edition.failureReason) ? edition.failureReason : null;

  return (
    <div className="min-w-0 space-y-4">
      <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 text-[12.5px] sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-faint">{t("grovnewsAdm.editions.preparedAt")}</dt>
          <dd className="tabular-nums">{fmt(edition.emailPreparedAt) ?? "—"}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-faint">{t("grovnewsAdm.editions.queuedAt")}</dt>
          <dd className="tabular-nums">{fmt(edition.queuedAt) ?? "—"}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-faint">{t("grovnewsAdm.editions.sentAt")}</dt>
          <dd className="tabular-nums">{fmt(edition.sentAt) ?? "—"}</dd>
        </div>
      </dl>

      {reason && edition.status !== "SENT" && (
        <p className="flex min-w-0 items-start gap-2 rounded-xl bg-[rgb(var(--danger)/0.10)] px-3.5 py-2.5 text-[12.5px] text-danger ring-1 ring-[rgb(var(--danger)/0.28)]"
          data-grovnews-edition-failure={reason}>
          <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{t(`grovnewsAdm.editions.failure.${reason}`)}</span>
        </p>
      )}

      {canPrepare && (
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <Button size="sm" variant={prepared ? "secondary" : "primary"} disabled={pending || hasUnpublished} onClick={onPrepare}
            className="shrink-0" data-grovnews-edition-prepare>
            <Sparkles size={14} aria-hidden />{t(prepared ? "grovnewsAdm.editions.prepareAgain" : "grovnewsAdm.editions.prepare")}
          </Button>
          <Note>{t(prepared ? "grovnewsAdm.editions.prepareAgainHint" : "grovnewsAdm.editions.prepareHint")}</Note>
        </div>
      )}

      {aiUsed !== null && (
        <p className="flex min-w-0 items-start gap-2 rounded-xl bg-accent-soft px-3.5 py-2.5 text-[12.5px] leading-relaxed text-accent"
          data-grovnews-edition-ai={aiUsed ? "yes" : "no"}>
          <Sparkles size={14} aria-hidden className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{t(aiUsed ? "grovnewsAdm.editions.aiUsed" : "grovnewsAdm.editions.aiNotUsed")}</span>
        </p>
      )}

      {prepared ? (
        <MailForm key={edition.emailPreparedAt ?? "none"} edition={edition} adminEmail={adminEmail} hasUnpublished={hasUnpublished} />
      ) : (
        <Note>{t("grovnewsAdm.editions.notPreparedYet")}</Note>
      )}

      {edition.campaignId && (
        <div className="min-w-0 space-y-3 border-t border-line pt-4" data-grovnews-edition-campaign>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Link href={`/admin/newsletter/kampanie/${edition.campaignId}`}
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent hover:underline">
              <ExternalLink size={14} aria-hidden />{t("grovnewsAdm.editions.openCampaign")}
            </Link>
            {campaign && <Badge tone={campaignDraft ? "neutral" : "info"}>{t(`grovnewsAdm.editions.campaignStatus.${campaignStatus(campaign.status)}`)}</Badge>}
          </div>
          {campaign && !campaignDraft && campaign.stats && (
            <dl className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3" data-grovnews-edition-stats>
              {([
                ["grovnewsAdm.editions.stat.recipients", campaign.stats.recipients],
                ["grovnewsAdm.editions.stat.sent", campaign.stats.sent],
                ["grovnewsAdm.editions.stat.accepted", campaign.stats.accepted],
                ["grovnewsAdm.editions.stat.failed", campaign.stats.failed],
                ["grovnewsAdm.editions.stat.opens", campaign.stats.openedUnique],
                ["grovnewsAdm.editions.stat.clicks", campaign.stats.clickedUnique],
              ] as const).map(([key, value]) => (
                <div key={key} className="plate min-w-0 rounded-xl px-3 py-2.5">
                  <dt className="break-words text-[11px] font-medium leading-snug text-muted">{t(key)}</dt>
                  <dd className="mt-1 metric text-lg leading-none tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}

const CAMPAIGN_STATUSES = ["draft", "scheduled", "sending", "paused", "sent", "cancelled", "failed"] as const;
function campaignStatus(s: string): (typeof CAMPAIGN_STATUSES)[number] {
  return (CAMPAIGN_STATUSES as readonly string[]).includes(s) ? (s as (typeof CAMPAIGN_STATUSES)[number]) : "draft";
}

function MailForm({ edition, adminEmail, hasUnpublished }: {
  edition: AdminEditionDetail; adminEmail: string; hasUnpublished: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const initialBlurbs = useMemo(
    () => Object.fromEntries(edition.items.map((i) => [i.postId, i.blurb ?? ""])) as Record<string, string>,
    [edition.items],
  );
  const [subject, setSubject] = useState(edition.emailSubject ?? "");
  const [preview, setPreview] = useState(edition.emailPreview ?? "");
  const [intro, setIntro] = useState(edition.intro);
  const [blurbs, setBlurbs] = useState<Record<string, string>>(initialBlurbs);
  const [address, setAddress] = useState(adminEmail);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [confirmSend, setConfirmSend] = useState(false);

  const campaignDraft = edition.campaign?.status === "draft";
  const editable = edition.status === "PUBLISHED" && campaignDraft;
  const canSend = editable && !hasUnpublished;
  const dirty = subject !== (edition.emailSubject ?? "") || preview !== (edition.emailPreview ?? "") || intro !== edition.intro
    || edition.items.some((i) => (blurbs[i.postId] ?? "") !== initialBlurbs[i.postId]);

  // The digest's reading time, from exactly what the mail will say.
  const texts = [intro, ...edition.items.flatMap((i) => [i.title, blurbs[i.postId] ?? ""])];
  const words = texts.reduce((n, s) => n + wordCount(s), 0);
  const minutes = digestMinutes(texts);
  const lengthHint = words < DIGEST_WORDS.min ? "grovnewsAdm.editions.digestShort"
    : words > DIGEST_WORDS.max ? "grovnewsAdm.editions.digestLong" : "grovnewsAdm.editions.digestOk";

  const save = () => start(async () => {
    const res = await saveEmailAction(edition.id, { subject, preview, intro, blurbs });
    if (res.ok) { toast.success(t("grovnewsAdm.editions.mailSaved")); setPreviewVersion((v) => v + 1); router.refresh(); }
    else toast.error(t(errorKey(res, { invalid: "grovnewsAdm.editions.err.subject" })));
  });

  const test = () => start(async () => {
    const res = await testSendEditionAction(edition.id, [address.trim()]);
    if (res.ok) { toast.success(t("grovnewsAdm.editions.testSent", { email: address.trim() })); router.refresh(); }
    else toast.error(t(errorKey(res)));
  });

  const send = () => start(async () => {
    const res = await sendEditionAction(edition.id);
    if (res.ok) {
      toast.success(res.already ? t("grovnewsAdm.editions.alreadyQueued")
        : t("grovnewsAdm.editions.queued", { n: res.recipients }));
      setConfirmSend(false);
      router.refresh();
    } else {
      toast.error(t(errorKey(res)));
      if (res.error === "noRecipients") { setConfirmSend(false); router.refresh(); }
    }
  });

  return (
    <div className="min-w-0 space-y-4" data-grovnews-edition-mail-form>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <Label htmlFor="ed-subject" hint={`${subject.length}/200`}>{t("grovnewsAdm.editions.subject")}</Label>
          <Input id="ed-subject" value={subject} maxLength={200} readOnly={!editable} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="min-w-0">
          <Label htmlFor="ed-preview" hint={`${preview.length}/300`}>{t("grovnewsAdm.editions.previewLine")}</Label>
          <Input id="ed-preview" value={preview} maxLength={300} readOnly={!editable} onChange={(e) => setPreview(e.target.value)} />
        </div>
      </div>
      <div>
        <Label htmlFor="ed-mail-intro" hint={`${intro.length}/1500`}>{t("grovnewsAdm.editions.mailIntro")}</Label>
        <Textarea id="ed-mail-intro" rows={3} value={intro} maxLength={1500} readOnly={!editable} onChange={(e) => setIntro(e.target.value)} />
      </div>
      {edition.items.map((item, index) => (
        <div key={item.postId} className="min-w-0">
          <Label htmlFor={`ed-blurb-${item.postId}`} hint={`${(blurbs[item.postId] ?? "").length}/1500`}>
            <span className="break-words">{index + 1}. {item.title || "—"}</span>
          </Label>
          <Textarea id={`ed-blurb-${item.postId}`} rows={3} maxLength={1500} readOnly={!editable}
            value={blurbs[item.postId] ?? ""} data-grovnews-edition-blurb={item.postId}
            onChange={(e) => setBlurbs((b) => ({ ...b, [item.postId]: e.target.value }))} />
        </div>
      ))}

      <div className="plate min-w-0 rounded-xl px-3.5 py-3" data-grovnews-digest-minutes={minutes}>
        <p className="text-[13px] font-semibold">
          {t("grovnewsAdm.editions.digestTime", { n: minutes, words })}
        </p>
        <p className="mt-0.5 break-words text-[12px] text-muted">
          {t("grovnewsAdm.editions.digestTarget", { min: DIGEST_WORDS.min, max: DIGEST_WORDS.max })}
          {" · "}
          <span className={lengthHint === "grovnewsAdm.editions.digestOk" ? "text-success" : "text-warning"}>{t(lengthHint)}</span>
        </p>
      </div>

      {editable ? (
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          {dirty && <span className="min-w-0 text-[12px] text-muted sm:mr-auto">{t("grovnewsAdm.editions.unsaved")}</span>}
          <Button size="sm" disabled={pending || !dirty || !subject.trim()} onClick={save} data-grovnews-edition-save-mail>
            {t("grovnewsAdm.editions.saveMail")}
          </Button>
        </div>
      ) : (
        <Note>{t("grovnewsAdm.editions.mailLocked")}</Note>
      )}

      <div className="flex min-w-0 flex-wrap gap-2 border-t border-line pt-4">
        <Button size="sm" variant="secondary" disabled={dirty} onClick={() => setPreviewOpen(true)} data-grovnews-edition-preview>
          <Eye size={14} aria-hidden />{t("grovnewsAdm.editions.previewMail")}
        </Button>
      </div>

      {edition.campaignId && (
        <div className="min-w-0 space-y-2" data-grovnews-edition-test>
          <Label htmlFor="ed-test">{t("grovnewsAdm.editions.testAddress")}</Label>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <Input id="ed-test" type="email" autoComplete="email" value={address} className="min-w-0 sm:flex-1"
              onChange={(e) => setAddress(e.target.value)} />
            <Button size="md" variant="secondary" className="shrink-0" disabled={pending || dirty || !address.trim()} onClick={test}>
              <FlaskConical size={15} aria-hidden />{t("grovnewsAdm.editions.testSend")}
            </Button>
          </div>
          <Note>{t("grovnewsAdm.editions.testNote")}</Note>
        </div>
      )}

      {editable && (
        <div className="min-w-0 space-y-2 border-t border-line pt-4">
          <Button variant="danger" disabled={pending || dirty || !canSend} onClick={() => setConfirmSend(true)}
            className="w-full sm:w-auto" data-grovnews-edition-send>
            <Mail size={15} aria-hidden />{t("grovnewsAdm.editions.send")}
          </Button>
          <Note>{t("grovnewsAdm.editions.sendNote")}</Note>
        </div>
      )}

      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title={t("grovnewsAdm.editions.previewMail")} wide>
        {edition.campaign && edition.campaignId ? (
          <MailPreview campaignId={edition.campaignId} contacts={[]} version={previewVersion} />
        ) : edition.emailBody ? (
          <iframe title={t("grovnewsAdm.editions.previewMail")} srcDoc={edition.emailBody} sandbox="" loading="lazy"
            data-grovnews-edition-preview-frame
            className="h-[60dvh] min-h-[380px] w-full rounded-2xl border border-line bg-white" />
        ) : (
          <Note>{t("grovnewsAdm.editions.notPreparedYet")}</Note>
        )}
      </Modal>

      <ConfirmModal open={confirmSend} onClose={() => setConfirmSend(false)} onConfirm={send} danger pending={pending}
        title={t("grovnewsAdm.editions.sendTitle")} body={t("grovnewsAdm.editions.sendBody")}
        confirmLabel={t("grovnewsAdm.editions.sendConfirm")} />
    </div>
  );
}
