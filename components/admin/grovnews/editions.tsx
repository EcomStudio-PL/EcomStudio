"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FolderOpen, Hammer, Newspaper } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { toast } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdminTable } from "@/components/ui/admin-table";
import { EmptyState } from "@/components/ui/empty-state";
import { buildEditionAction } from "@/app/actions/grovnews-research";
import { editionDateLabel, type EditionStatus } from "@/lib/grovnews-research";
import type { AdminEdition } from "@/lib/services/grovnews-research";

type Tone = "neutral" | "success" | "warning" | "accent" | "danger" | "info";

/** One colour per edition state, shared by the list and the editor. */
export const EDITION_TONE: Record<EditionStatus, Tone> = {
  DRAFT: "accent", READY: "info", PUBLISHED: "success", QUEUED: "warning", SENT: "success", FAILED: "danger", ARCHIVED: "neutral",
};

/** Why a send ended badly — the codes the edition sync writes (0121). */
export const FAILURE_REASONS = ["no_recipients", "all_failed", "campaign_cancelled", "campaign_failed", "campaign_deleted"] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];
export const isFailureReason = (v: string | null): v is FailureReason =>
  v !== null && (FAILURE_REASONS as readonly string[]).includes(v);

/** Numeric date AND time in Warsaw: "26.09.2026 07:05". Month names differ
 *  between the server's and the browser's ICU (hydration error #418);
 *  numbers do not. */
export function useFormatDateTime() {
  const { locale } = useI18n();
  const fmt = new Intl.DateTimeFormat(locale === "pl" ? "pl-PL" : locale === "de" ? "de-DE" : "en-GB", {
    timeZone: "Europe/Warsaw", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  return (iso: string | null) => (iso ? fmt.format(new Date(iso)) : null);
}

/** What happened to the edition's mail, in one line — derived from the
 *  edition's own state; the campaign's detail lives on the edition page. */
function MailState({ e }: { e: AdminEdition }) {
  const { t } = useI18n();
  const reason = isFailureReason(e.failureReason) ? t(`grovnewsAdm.editions.failure.${e.failureReason}`) : null;
  let label: string;
  let tone: Tone;
  if (e.status === "ARCHIVED") { label = t("grovnewsAdm.editions.mail.archived"); tone = "neutral"; }
  else if (e.status === "SENT") { label = t("grovnewsAdm.editions.mail.sent", { n: e.recipients ?? 0 }); tone = "success"; }
  else if (e.status === "FAILED") { label = t("grovnewsAdm.editions.mail.failed"); tone = "danger"; }
  else if (e.status === "QUEUED") { label = t("grovnewsAdm.editions.mail.queued", { n: e.recipients ?? 0 }); tone = "warning"; }
  else if (e.campaignId && e.emailPreparedAt) { label = t("grovnewsAdm.editions.mail.prepared"); tone = "info"; }
  else { label = t("grovnewsAdm.editions.mail.none"); tone = "neutral"; }
  return (
    <span className="flex min-w-0 flex-col items-start gap-1">
      {/* A long mail state wraps inside the phone card instead of pushing past it. */}
      <Badge tone={tone} className="max-w-full max-lg:whitespace-normal">{label}</Badge>
      {reason && e.status !== "SENT" && e.status !== "ARCHIVED" && (
        <span className="break-words text-[11.5px] leading-snug text-danger">{reason}</span>
      )}
    </span>
  );
}

/** Every edition, newest day first, and the button that builds today's. */
export function EditionsList({ editions }: { editions: AdminEdition[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();

  const build = () => start(async () => {
    const res = await buildEditionAction();
    if (res.ok) {
      toast.success(t("grovnewsAdm.editions.built"));
      router.push(`/admin/newsletter/grovnews/wydania/${res.id}`);
      router.refresh();
      return;
    }
    toast.error(t(res.error === "noServerKey" ? "grovnewsAdm.editions.err.noServerKey"
      : res.error === "forbidden" ? "grovnewsAdm.errForbidden" : "common.error"));
  });

  const buildButton = (
    <Button onClick={build} disabled={pending} className="shrink-0" data-grovnews-edition-build>
      <Hammer size={15} aria-hidden />{t("grovnewsAdm.editions.build")}
    </Button>
  );

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 max-w-2xl text-[13px] leading-relaxed text-muted">{t("grovnewsAdm.editions.listIntro")}</p>
        {buildButton}
      </div>

      {editions.length === 0 ? (
        <EmptyState icon={Newspaper} title={t("grovnewsAdm.editions.emptyTitle")} body={t("grovnewsAdm.editions.emptyBody")} />
      ) : (
        <AdminTable
          primary={1}
          empty={t("grovnewsAdm.editions.emptyTitle")}
          headers={[t("grovnewsAdm.editions.colDate"), t("grovnewsAdm.colTitle"), t("grovnewsAdm.editions.colPosts"),
            t("grovnewsAdm.colStatus"), t("grovnewsAdm.editions.colEmail"), t("common.actions")]}
          rows={editions.map((e) => [
            <span key="d" className="whitespace-nowrap tabular-nums">{editionDateLabel(e.date)}</span>,
            <span key="t" className="block min-w-0 max-w-[22rem]" data-grovnews-edition-row={e.id}>
              <Link href={`/admin/newsletter/grovnews/wydania/${e.id}`} className="block truncate hover:text-accent" title={e.title}>
                {e.title}
              </Link>
              {e.autoGenerated && (
                <span className="block truncate text-[11.5px] font-normal text-muted">{t("grovnewsAdm.editions.auto")}</span>
              )}
            </span>,
            <span key="n" className="tabular-nums">{e.posts}</span>,
            <Badge key="s" tone={EDITION_TONE[e.status]} dot>{t(`grovnewsAdm.editionStatus.${e.status}`)}</Badge>,
            <MailState key="m" e={e} />,
            <Link key="a" href={`/admin/newsletter/grovnews/wydania/${e.id}`}
              className="inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 text-[12px] font-semibold text-muted transition-colors hover:bg-raised hover:text-ink">
              <FolderOpen size={13} aria-hidden />{t("grovnewsAdm.editions.open")}
            </Link>,
          ])}
        />
      )}
    </div>
  );
}
