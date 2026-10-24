import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { TICKET_STATUSES, TICKET_TOPICS, isTicketStatus, isTicketTopic } from "@/lib/contact-page";
import { SupportTabs } from "../tabs";

/**
 * KONTAKT V2 — THE TICKETS FROM THE CONTACT FORM, newest first, filtered by
 * status and topic. Admin only: the admin layout guards the page, RLS the rows
 * (contact_messages is readable by an admin and nobody else).
 */
export const dynamic = "force-dynamic";

const TONE: Record<string, "accent" | "warning" | "neutral"> = { new: "accent", in_progress: "warning", closed: "neutral" };

export default async function AdminTickets({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const status = typeof sp.status === "string" && isTicketStatus(sp.status) ? sp.status : null;
  const topic = typeof sp.topic === "string" && isTicketTopic(sp.topic) ? sp.topic : null;
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);

  let query = supabase.from("contact_messages")
    .select("id, ticket_no, created_at, topic, email, name, status, message, user_id")
    .order("created_at", { ascending: false }).limit(200);
  if (status) query = query.eq("status", status);
  if (topic) query = query.eq("topic", topic);
  const [{ data: rows }, { count: fresh }] = await Promise.all([
    query,
    supabase.from("contact_messages").select("id", { count: "exact", head: true }).eq("status", "new"),
  ]);

  const href = (next: { status?: string | null; topic?: string | null }) => {
    const q = new URLSearchParams();
    const s = next.status === undefined ? status : next.status;
    const tp = next.topic === undefined ? topic : next.topic;
    if (s) q.set("status", s);
    if (tp) q.set("topic", tp);
    const qs = q.toString();
    return `/admin/support/zgloszenia${qs ? `?${qs}` : ""}`;
  };
  const pill = (on: boolean) =>
    `inline-flex min-h-[34px] items-center rounded-full border px-3 text-[12.5px] font-medium transition-colors ${on ? "border-accent bg-accent-soft/70 text-accent" : "border-line text-muted hover:text-ink"}`;

  return (
    <div>
      <PageHeader title={t("chat.tickets.title")} sub={t("chat.tickets.sub")} />
      <SupportTabs active="tickets" fresh={fresh ?? 0} t={t} />

      <div className="mb-4 space-y-2" data-ticket-filters>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-faint">{t("chat.tickets.status")}</span>
          <Link href={href({ status: null })} className={pill(!status)} aria-current={!status ? "page" : undefined}>{t("chat.tickets.all")}</Link>
          {TICKET_STATUSES.map((s) => (
            <Link key={s} href={href({ status: s })} className={pill(status === s)} aria-current={status === s ? "page" : undefined}>
              {t(`chat.tickets.st.${s}`)}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-faint">{t("chat.tickets.topic")}</span>
          <Link href={href({ topic: null })} className={pill(!topic)} aria-current={!topic ? "page" : undefined}>{t("chat.tickets.all")}</Link>
          {TICKET_TOPICS.map((tp) => (
            <Link key={tp} href={href({ topic: tp })} className={pill(topic === tp)} aria-current={topic === tp ? "page" : undefined}>
              {t(`cms.contact.text.topic.${tp}`)}
            </Link>
          ))}
        </div>
      </div>

      {(rows ?? []).length === 0 ? (
        <div className="panel rounded-2xl p-10 text-center">
          <p className="text-sm font-semibold">{t(status || topic ? "chat.tickets.noneFiltered" : "chat.tickets.none")}</p>
        </div>
      ) : (
        <ul className="space-y-2" data-ticket-list>
          {(rows ?? []).map((r) => (
            <li key={r.id}>
              <Link href={`/admin/support/zgloszenia/${r.ticket_no}`} data-ticket-row={r.ticket_no}
                className="panel panel-interactive flex flex-col gap-1.5 rounded-2xl px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                <span className="flex shrink-0 items-center gap-2 sm:w-28">
                  <span className="font-mono text-[13px] font-semibold">#{r.ticket_no}</span>
                  <Badge tone={TONE[r.status] ?? "neutral"}>{t(`chat.tickets.st.${r.status}`)}</Badge>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="truncate text-sm font-semibold">{r.email}</span>
                    <span className="text-xs text-muted">{t(`cms.contact.text.topic.${r.topic}`)}</span>
                    {r.user_id && <span className="text-xs text-faint">· {t("chat.tickets.hasAccount")}</span>}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted">{r.message.replace(/\s+/g, " ").slice(0, 160)}</span>
                </span>
                <span className="shrink-0 text-xs text-muted">{formatDate(r.created_at, locale)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
