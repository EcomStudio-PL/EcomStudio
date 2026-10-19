import Link from "next/link";
import { Rocket } from "lucide-react";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { formatInstant } from "@/lib/utils";
import {
  ATTRIBUTION_KEYS, CONSENT_DOCS, PRELAUNCH_CONSENT_KEYS, PRELAUNCH_FORMS, REFERRAL_REJECTIONS,
  SELLER_CHANNELS, type PrelaunchContactView,
} from "@/lib/services/newsletter";

/**
 * ONE CONTACT'S PLACE ON THE PRE-LAUNCH LIST.
 *
 * Status, the two dates, which form, the "Gdzie sprzedajesz?" answer, the
 * referral graph around them (their code, who referred them, how many of their
 * referrals counted, and why theirs did not), the first-touch attribution —
 * and, last and longest, EVERY CONSENT RECORD as evidence.
 *
 * WHY THE CONSENT RECORDS ARE PRINTED IN FULL. A consent is the exact sentence
 * that was on screen, its version, when it was ticked and when the address was
 * proven by the e-mail link. "When did this person agree, and to what?" is a
 * question asked a year later, by someone who was not there; a badge cannot
 * answer it and a truncated text answers it wrongly. So the sentence is shown
 * as stored — wrapped, never cut, never re-rendered from today's wording — and
 * the terms record carries the publication of the Regulamin and the privacy
 * policy that were in force.
 *
 * "NO DATA" IS WORDED TO BE TRUE IN BOTH CASES IT COVERS: a contact who never
 * used the landing form, and a read that failed (the rpc layer returns null
 * for both, see prelaunch_admin_contact in lib/server/prelaunch/rpc.ts).
 *
 * Instants are Europe/Warsaw (formatInstant), like every timestamp an operator
 * compares against what a customer says on the phone.
 */

export async function PrelaunchContactCard({ view }: { view: PrelaunchContactView | null }) {
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);

  const when = (iso: string | null) => (iso ? formatInstant(iso, locale) : "—");
  /** A label for a value the column can hold, the raw value otherwise. The
   *  namespace stays literal so the i18n scope analysis can trace the key. */
  const known = (group: string, members: readonly string[], value: string | null, none = "—") =>
    value === null ? none
      : (members as readonly string[]).includes(value)
        ? t(`admin.newsletter.prelaunch.${group}.${value}`) : value;

  const status = view?.status ?? null;
  const badge = status === "confirmed"
    ? <Badge tone="success" dot>{t("admin.newsletter.prelaunch.status.confirmed")}</Badge>
    : status === "pending"
      ? <Badge tone="warning" dot>{t("admin.newsletter.prelaunch.status.pending")}</Badge>
      : undefined;

  return (
    <Card data-prelaunch-contact>
      <CardHeader title={t("admin.newsletter.prelaunch.card.title")} icon={Rocket} action={badge} />
      <div className="space-y-4 px-4 pb-4 sm:px-5 sm:pb-5">
        {view === null ? (
          <p className="text-[13px] leading-relaxed text-muted">{t("admin.newsletter.prelaunch.card.none")}</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
              <Fact label={t("admin.newsletter.prelaunch.card.createdAt")} value={when(view.createdAt)} />
              <Fact label={t("admin.newsletter.prelaunch.card.confirmedAt")} value={when(view.confirmedAt)} />
              <Fact label={t("admin.newsletter.prelaunch.card.form")}
                value={known("form", PRELAUNCH_FORMS, view.form)} />
              <Fact label={t("admin.newsletter.prelaunch.card.channel")}
                value={known("channel", SELLER_CHANNELS, view.channel, t("admin.newsletter.prelaunch.channel.none"))} />
              <Fact label={t("admin.newsletter.prelaunch.card.locale")}
                value={view.locale ? view.locale.toUpperCase() : "—"} />
              <Fact label={t("admin.newsletter.prelaunch.card.code")}
                value={view.referralCode
                  ? <span className="font-mono tracking-wider">{view.referralCode}</span>
                  : "—"} />
              <Fact label={t("admin.newsletter.prelaunch.card.referredBy")}
                value={<ReferredBy view={view} />} />
              <Fact label={t("admin.newsletter.prelaunch.card.referralsCounted")}
                value={view.referralsCounted === null ? "—" : String(view.referralsCounted)} />
              {view.referralRejected && (
                <Fact label={t("admin.newsletter.prelaunch.card.rejected")}
                  value={known("reason", REFERRAL_REJECTIONS, view.referralRejected)} />
              )}
            </dl>

            {/* ── ATTRIBUTION ──────────────────────────────────────────────
                First touch, written once and never overwritten — so it is the
                campaign that brought them, not the last link they clicked. */}
            <div data-prelaunch-attribution>
              <h3 className="mb-2 text-[12px] font-semibold text-muted">
                {t("admin.newsletter.prelaunch.card.attributionTitle")}
              </h3>
              {ATTRIBUTION_KEYS.every((key) => view.attribution[key] === null) ? (
                <p className="text-[12.5px] text-faint">{t("admin.newsletter.prelaunch.card.attributionNone")}</p>
              ) : (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
                  {ATTRIBUTION_KEYS.map((key) => (
                    <Fact key={key} label={t(`admin.newsletter.prelaunch.attribution.${key}`)}
                      value={view.attribution[key] ?? "—"} />
                  ))}
                </dl>
              )}
            </div>

            {/* ── THE CONSENT RECORDS ────────────────────────────────────── */}
            <div data-prelaunch-consents>
              <h3 className="mb-2 text-[12px] font-semibold text-muted">
                {t("admin.newsletter.prelaunch.card.consentsTitle")}
              </h3>
              {view.consents.length === 0 ? (
                <p className="text-[12.5px] text-faint">{t("admin.newsletter.prelaunch.card.consentsNone")}</p>
              ) : (
                <ul className="space-y-2">
                  {view.consents.map((c, i) => (
                    <li key={`${c.key}-${c.acceptedAt ?? "?"}-${i}`} data-consent-record={c.key}
                      className="plate rounded-xl p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold">
                          {known("consent", PRELAUNCH_CONSENT_KEYS, c.key)}
                        </span>
                        {c.confirmedAt
                          ? <Badge tone="success" dot>{t("admin.newsletter.prelaunch.consent.confirmed")}</Badge>
                          : <Badge tone="warning" dot>{t("admin.newsletter.prelaunch.consent.unconfirmed")}</Badge>}
                      </div>
                      <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
                        {t("admin.newsletter.prelaunch.consent.text")}
                      </p>
                      <blockquote className="mt-1 whitespace-pre-wrap break-words border-l-2 border-line pl-2.5 text-[12.5px] leading-relaxed text-ink">
                        {c.text ?? "—"}
                      </blockquote>
                      <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px] sm:grid-cols-3">
                        <Fact label={t("admin.newsletter.prelaunch.consent.version")}
                          value={c.version ? <span className="break-all font-mono">{c.version}</span> : "—"} />
                        <Fact label={t("admin.newsletter.prelaunch.consent.acceptedAt")} value={when(c.acceptedAt)} />
                        <Fact label={t("admin.newsletter.prelaunch.consent.confirmedAt")} value={when(c.confirmedAt)} />
                        <Fact label={t("admin.newsletter.prelaunch.consent.locale")}
                          value={c.locale ? c.locale.toUpperCase() : "—"} />
                        <Fact label={t("admin.newsletter.prelaunch.consent.form")}
                          value={known("form", PRELAUNCH_FORMS, c.form)} />
                      </dl>
                      {c.docVersions.length > 0 && (
                        <div className="mt-2.5">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
                            {t("admin.newsletter.prelaunch.consent.docs")}
                          </p>
                          <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
                            {c.docVersions.map((doc) => (
                              <Fact key={doc.key}
                                label={known("consent.doc", CONSENT_DOCS, doc.key)}
                                // A publication instant reads as a date; any
                                // other recorded version is shown as written.
                                value={doc.value === null ? "—"
                                  : Number.isFinite(Date.parse(doc.value)) ? when(doc.value) : doc.value} />
                            ))}
                          </dl>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

/** Who referred them: the contact screen when the answer names the contact,
 *  a search for the address otherwise, "—" when nobody did. */
function ReferredBy({ view }: { view: PrelaunchContactView }) {
  if (!view.referredByEmail && !view.referredByContactId) return <>—</>;
  const label = view.referredByEmail ?? view.referredByContactId ?? "—";
  const href = view.referredByContactId
    ? `/admin/newsletter/kontakty/${view.referredByContactId}`
    : `/admin/newsletter/kontakty?q=${encodeURIComponent(view.referredByEmail ?? "")}`;
  return (
    <Link href={href} data-prelaunch-referrer className="break-all font-medium text-accent hover:underline">
      {label}
    </Link>
  );
}

/** One labelled fact — the contact screen's own markup, with room for a link. */
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</dt>
      <dd className="mt-0.5 break-words text-ink">{value}</dd>
    </div>
  );
}
