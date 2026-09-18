import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Ban, History, ShieldCheck, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import {
  contactTimeline, getContact, groupsOfContacts, listGroups, listSources, suppressionFor,
} from "@/lib/services/newsletter";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { RelativeTime } from "@/components/ui/relative-time";
import { formatDate } from "@/lib/utils";
import { ContactDetail } from "@/components/admin/newsletter/contact-detail";

/**
 * ONE CONTACT — the profile, the consent record, and everything that has
 * happened to them.
 *
 * WHY THE CONSENT RECORD IS A PANEL OF ITS OWN AND NOT A BADGE. "Zgoda" is a
 * yes/no on a list; here it has to be evidence, which means the date, the
 * source and the wording version, because those three are what make it possible
 * to answer "when did this person agree, and to what?" a year later. When there
 * is no record, the panel says so in a full sentence rather than leaving three
 * empty rows that could be read as "not loaded".
 *
 * THE TIMELINE IS EVENTS PLUS ONE DERIVED ENTRY. `newsletter_events` records
 * ten kinds of thing and 'subscribed' is not one of them — a signup writes the
 * CONTACT ROW, not an event — so the moment they joined would simply be missing
 * from their own history. It is appended here, from `created_at`, as the oldest
 * item, and it is derived rather than backfilled into the events table because
 * a table of things that happened should not gain rows for things nobody
 * recorded.
 */
export default async function NewsletterContactPage({ params }: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);

  const contact = await getContact(supabase, id);
  if (!contact) notFound();

  const [events, groups, memberships, sources, suppression] = await Promise.all([
    contactTimeline(supabase, contact.id),
    listGroups(supabase),
    groupsOfContacts(supabase, [contact.id]),
    listSources(supabase),
    suppressionFor(supabase, contact.email),
  ]);

  // The application account, when the address belongs to one. Read here the
  // same way app/admin/users/[id] reads it — one row, by id, for a name.
  const { data: account } = contact.userId
    ? await supabase.from("profiles").select("id, full_name, email")
      .eq("id", contact.userId).maybeSingle()
    : { data: null };

  const staticGroups = groups.filter((g) => !g.isDynamic);
  const memberOf = memberships.get(contact.id) ?? [];
  const sourceName = sources.find((s) => s.key === contact.sourceKey)?.name ?? contact.sourceKey;
  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ");

  return (
    <div className="space-y-4">
      <Link href="/admin/newsletter/kontakty"
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-ink">
        <ArrowLeft size={14} aria-hidden />{t("newsletter.nav.contacts")}
      </Link>

      {/* ── WHO THIS IS ─────────────────────────────────────────────────── */}
      <div className="panel rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-all font-display text-lg font-semibold tracking-tight">
              {contact.email}
            </h1>
            {fullName && <p className="mt-0.5 text-sm text-muted">{fullName}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {contact.unsubscribedAt
              ? <Badge tone="neutral" dot>{t("newsletter.consent.unsubscribed")}</Badge>
              : contact.marketingConsent
                ? <Badge tone="success" dot>{t("newsletter.consent.yes")}</Badge>
                : <Badge tone="warning" dot>{t("newsletter.consent.no")}</Badge>}
            {suppression && (
              <Badge tone="danger" dot>{t(`newsletter.reason.${suppression.reason}`)}</Badge>
            )}
          </div>
        </div>

        {/* A blocked address outranks everything else on this screen: consent
            can say "yes" and nothing will still be sent. */}
        {suppression && (
          <p className="mt-3 rounded-xl bg-[rgb(var(--danger)/0.10)] px-3 py-2.5 text-[12.5px] leading-relaxed text-danger">
            {t("newsletter.contact.blockedNotice", {
              reason: t(`newsletter.reason.${suppression.reason}`),
            })}
          </p>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[13px] sm:grid-cols-4">
          <Fact label={t("newsletter.col.source")} value={sourceName} />
          <Fact label={t("newsletter.col.locale")} value={contact.locale.toUpperCase()} />
          <Fact label={t("newsletter.col.created")} value={formatDate(contact.createdAt, locale)} />
          <Fact
            label={t("newsletter.col.lastActivity")}
            value={contact.lastActivityAt ? formatDate(contact.lastActivityAt, locale) : "—"}
          />
        </dl>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── EDITING, GROUPS, AND THE TWO DESTRUCTIVE BUTTONS ─────────── */}
        <ContactDetail
          contact={contact}
          sources={sources.map((s) => ({ key: s.key, name: s.name }))}
          groups={staticGroups.map((g) => ({ id: g.id, name: g.name }))}
          memberOf={memberOf}
          blockedReason={suppression?.reason ?? null}
        />

        <div className="space-y-4">
          {/* ── THE CONSENT RECORD ───────────────────────────────────── */}
          <Card>
            <CardHeader title={t("newsletter.col.consent")} icon={ShieldCheck} />
            <div className="px-4 pb-4 sm:px-5 sm:pb-5">
              {contact.consentAt ? (
                <dl className="grid gap-3 text-[13px] sm:grid-cols-2">
                  <Fact label={t("newsletter.consent.grantedAt")}
                    value={formatDate(contact.consentAt, locale)} />
                  <Fact label={t("newsletter.consent.source")}
                    value={contact.consentSource ?? "—"} />
                  <Fact label={t("newsletter.consent.version")}
                    value={contact.consentVersion ?? "—"} />
                  {contact.unsubscribedAt && (
                    <Fact label={t("newsletter.event.unsubscribed")}
                      value={formatDate(contact.unsubscribedAt, locale)} />
                  )}
                </dl>
              ) : (
                <p className="text-[13px] leading-relaxed text-muted">
                  {t("newsletter.consent.never")}
                </p>
              )}
            </div>
          </Card>

          {/* ── THE ACCOUNT, IF THERE IS ONE ─────────────────────────── */}
          <Card>
            <CardHeader title={t("newsletter.contact.account")} icon={UserRound} />
            <div className="px-4 pb-4 text-[13px] sm:px-5 sm:pb-5">
              {account ? (
                <Link href={`/admin/users/${account.id}`}
                  className="break-all font-medium text-accent hover:underline">
                  {account.full_name || account.email}
                </Link>
              ) : (
                <p className="text-muted">{t("newsletter.contact.noAccount")}</p>
              )}
            </div>
          </Card>

          {/* ── THE TIMELINE ─────────────────────────────────────────── */}
          <Card>
            <CardHeader title={t("newsletter.contact.timeline")} icon={History} />
            <div className="px-4 pb-4 sm:px-5 sm:pb-5">
              <ul className="thin-scroll max-h-[28rem] space-y-1 overflow-y-auto">
                {events.map((event) => (
                  <li key={event.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg px-2 py-2 hover:bg-raised/50">
                    <span className="min-w-0 break-words text-[13px]">
                      <span className="font-medium">{t(`newsletter.event.${event.type}`)}</span>
                      {event.campaignId && event.campaignName && (
                        <Link href={`/admin/newsletter/kampanie/${event.campaignId}`}
                          className="ml-1.5 text-muted transition-colors hover:text-accent">
                          {event.campaignName}
                        </Link>
                      )}
                    </span>
                    <RelativeTime at={event.createdAt} locale={locale} t={t}
                      className="shrink-0 text-[12px] text-faint" />
                  </li>
                ))}
                {/* The oldest entry, derived from the contact row — see the
                    note at the top of this file. It is why this list is never
                    empty and why there is no "nothing happened yet" state
                    here: joining the list is itself the first thing that
                    happened, and a history that omitted it would be lying by
                    silence about the one date that matters most. */}
                <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg px-2 py-2">
                  <span className="text-[13px] font-medium">
                    {t("newsletter.event.subscribed")}
                  </span>
                  <RelativeTime at={contact.createdAt} locale={locale} t={t}
                    className="shrink-0 text-[12px] text-faint" />
                </li>
              </ul>
            </div>
          </Card>
        </div>
      </div>

      {/* A blocked address is lifted where blocks live, and the link says so —
          the screen that owns the list is the screen that owns the decision. */}
      {suppression && (
        <Link href="/admin/newsletter/wypisani"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-ink">
          <Ban size={14} aria-hidden />{t("newsletter.suppressions.title")}
        </Link>
      )}
    </div>
  );
}

/** One labelled fact. A definition list rather than two spans, because that is
 *  what a label and its value are. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</dt>
      <dd className="mt-0.5 break-words text-ink">{value}</dd>
    </div>
  );
}
