import Link from "next/link";
import { notFound } from "next/navigation";
import { Paperclip } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { notifyKey } from "@/lib/server/contact-tickets";
import { ResendConfirmation, TicketStatus } from "@/components/admin/contact/ticket-actions";

/**
 * KONTAKT V2 — ONE TICKET: the whole message, who wrote it (and, for a
 * signed-in customer, the plan and credits the server read at that moment),
 * the pictures — previewed and downloaded through the admin-only route, never
 * a storage URL — and whether both mails went out: the customer's
 * confirmation (its status, attempts, last error) and the admin notification
 * (its outbox rows, by the ticket's dedupe key).
 */
export const dynamic = "force-dynamic";

const TONE: Record<string, "accent" | "warning" | "neutral"> = { new: "accent", in_progress: "warning", closed: "neutral" };
const MAIL_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  sent: "success", pending: "warning", sending: "warning", failed: "danger", skipped: "neutral",
};

type Account = { workspace_id?: string; plan?: string | null; plan_name?: string | null; plan_status?: string | null; credits?: number | null };
type Client = { ua?: string; lang?: string; tz?: string; viewport?: string; page?: string; form?: string };

export default async function AdminTicket({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  if (!/^[0-9]{1,12}$/.test(no)) notFound();
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const { data: ticket } = await supabase.from("contact_messages")
    .select("id, ticket_no, created_at, updated_at, topic, name, email, message, locale, status, nip, generation_ref, user_id, account, client, confirmation_status, confirmation_attempts, confirmation_at, confirmation_error, handled_at")
    .eq("ticket_no", Number(no)).maybeSingle();
  if (!ticket) notFound();

  const [{ data: files }, { data: outbox }] = await Promise.all([
    supabase.from("contact_attachments").select("id, file_name, mime, size_bytes").eq("message_id", ticket.id).order("bound_at"),
    supabase.from("notification_outbox").select("channel, status, attempts, sent_at, last_error_safe, created_at")
      .eq("dedupe_key", notifyKey(ticket.ticket_no)).order("created_at"),
  ]);
  const account = (ticket.account ?? {}) as Account;
  const client = (ticket.client ?? {}) as Client;
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid gap-1 border-t border-line py-2.5 first:border-t-0 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-[12.5px] text-faint">{label}</dt>
      <dd className="min-w-0 break-words text-[13.5px] text-ink">{value}</dd>
    </div>
  );

  return (
    <div className="space-y-4" data-ticket={ticket.ticket_no}>
      <Link href="/admin/support/zgloszenia" className="text-sm text-muted hover:text-ink">← {t("chat.tickets.title")}</Link>

      <div className="panel rounded-2xl p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-xl font-semibold tracking-tight">#{ticket.ticket_no}</h1>
          <Badge tone={TONE[ticket.status] ?? "neutral"}>{t(`chat.tickets.st.${ticket.status}`)}</Badge>
          <span className="text-sm text-muted">{t(`cms.contact.text.topic.${ticket.topic}`)}</span>
          <span className="ml-auto text-xs text-muted">{formatDate(ticket.created_at, locale)}</span>
        </div>
        <div className="mt-4"><TicketStatus id={ticket.id} status={ticket.status} /></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <section className="panel rounded-2xl p-4 sm:p-6" aria-labelledby="ticket-message">
            <h2 id="ticket-message" className="text-sm font-semibold">{t("chat.tickets.message")}</h2>
            <p className="mt-3 whitespace-pre-wrap break-words text-[14.5px] leading-relaxed text-ink" data-ticket-message>{ticket.message}</p>
          </section>

          {(files ?? []).length > 0 && (
            <section className="panel rounded-2xl p-4 sm:p-6" aria-labelledby="ticket-files">
              <h2 id="ticket-files" className="flex items-center gap-2 text-sm font-semibold">
                <Paperclip size={15} aria-hidden />{t("chat.tickets.files", { n: (files ?? []).length })}
              </h2>
              <ul className="mt-3 grid gap-3 sm:grid-cols-3">
                {(files ?? []).map((f) => (
                  <li key={f.id} className="overflow-hidden rounded-xl border border-line bg-surface" data-ticket-file>
                    <a href={`/api/admin/contact/attachment?id=${f.id}`} target="_blank" rel="noopener noreferrer" className="block bg-sunken">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/admin/contact/attachment?id=${f.id}`} alt={f.file_name ?? ""} loading="lazy"
                        className="aspect-[4/3] w-full object-contain" />
                    </a>
                    <div className="flex items-center justify-between gap-2 p-2.5">
                      <span className="min-w-0">
                        <span className="block truncate text-[12.5px] font-medium">{f.file_name}</span>
                        <span className="block text-[11.5px] text-faint">{f.mime} · {Math.max(1, Math.round((f.size_bytes ?? 0) / 1024))} KB</span>
                      </span>
                      <a href={`/api/admin/contact/attachment?id=${f.id}&download=1`} className="shrink-0 text-[12.5px] font-semibold text-accent hover:opacity-80">
                        {t("chat.tickets.download")}
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <section className="panel rounded-2xl p-4 sm:p-6" aria-labelledby="ticket-who">
            <h2 id="ticket-who" className="text-sm font-semibold">{t("chat.tickets.contact")}</h2>
            <dl className="mt-2">
              {row(t("chat.tickets.name"), ticket.name || "—")}
              {row(t("chat.tickets.email"), <a href={`mailto:${ticket.email}?subject=${encodeURIComponent(`Re: #${ticket.ticket_no}`)}`} className="text-accent hover:opacity-80">{ticket.email}</a>)}
              {row(t("chat.tickets.lang"), ticket.locale.toUpperCase())}
              {ticket.nip && row(t("chat.tickets.nip"), ticket.nip)}
              {ticket.generation_ref && row(t("chat.tickets.generation"), ticket.generation_ref)}
              {row(t("chat.tickets.account"), ticket.user_id ? (
                <span>
                  <Link href={`/admin/users/${ticket.user_id}`} className="text-accent hover:opacity-80">{t("chat.tickets.openUser")}</Link>
                  {" · "}{account.plan_name ?? account.plan ?? t("chat.tickets.noPlan")}
                  {account.plan_status ? ` (${account.plan_status})` : ""}
                  {typeof account.credits === "number" ? ` · ${t("chat.tickets.credits", { n: account.credits })}` : ""}
                </span>
              ) : t("chat.tickets.guest"))}
            </dl>
          </section>

          <section className="panel rounded-2xl p-4 sm:p-6" aria-labelledby="ticket-mail">
            <h2 id="ticket-mail" className="text-sm font-semibold">{t("chat.tickets.delivery")}</h2>
            <dl className="mt-2">
              {row(t("chat.tickets.confirmation"), (
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={MAIL_TONE[ticket.confirmation_status] ?? "neutral"}>{t(`chat.tickets.mail.${ticket.confirmation_status}`)}</Badge>
                  <span className="text-xs text-muted">
                    {t("chat.tickets.attempts", { n: ticket.confirmation_attempts })}
                    {ticket.confirmation_at ? ` · ${formatDate(ticket.confirmation_at, locale)}` : ""}
                    {ticket.confirmation_error ? ` · ${ticket.confirmation_error}` : ""}
                  </span>
                </span>
              ))}
              {row(t("chat.tickets.adminMail"), (outbox ?? []).length === 0 ? t("chat.tickets.notQueued") : (
                <span className="flex flex-col gap-1">
                  {(outbox ?? []).map((o) => (
                    <span key={o.channel} className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted">{o.channel === "admin_email" ? t("chat.tickets.chEmail") : t("chat.tickets.chTelegram")}</span>
                      <Badge tone={MAIL_TONE[o.status] ?? "neutral"}>{t(`chat.tickets.mail.${o.status}`)}</Badge>
                      {o.last_error_safe && <span className="text-xs text-faint">{o.last_error_safe}</span>}
                    </span>
                  ))}
                </span>
              ))}
            </dl>
            {ticket.confirmation_status !== "sent" && <div className="mt-3"><ResendConfirmation id={ticket.id} /></div>}
          </section>

          <section className="panel rounded-2xl p-4 sm:p-6" aria-labelledby="ticket-tech">
            <h2 id="ticket-tech" className="text-sm font-semibold">{t("chat.tickets.tech")}</h2>
            <dl className="mt-2">
              {row(t("chat.tickets.browser"), client.ua || "—")}
              {client.viewport && row(t("chat.tickets.viewport"), client.viewport)}
              {client.lang && row(t("chat.tickets.browserLang"), client.lang)}
              {client.tz && row(t("chat.tickets.tz"), client.tz)}
              {client.page && row(t("chat.tickets.page"), client.page)}
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
