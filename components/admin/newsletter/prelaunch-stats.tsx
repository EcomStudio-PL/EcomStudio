import Link from "next/link";
import {
  Gift, Hourglass, MailCheck, Percent, RotateCcw, Send, Share2, TimerOff, TriangleAlert, UserPlus,
} from "lucide-react";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { AdminTable } from "@/components/ui/admin-table";
import { Stat } from "@/components/ui/stat";
import { formatRate, rate } from "@/lib/newsletter";
import {
  PRELAUNCH_FORMS, REFERRAL_REJECTIONS, SELLER_CHANNELS,
  type PrelaunchCounts, type PrelaunchSummary,
} from "@/lib/services/newsletter";
import { numberFormat } from "@/components/admin/newsletter/kpi";

/**
 * NEWSLETTER → ANALITYKA → LISTA PRZEDPREMIEROWA.
 *
 * The launch page's double opt-in list, inside the module that owns the
 * contacts it creates — not a second dashboard. Same range picker (the page's),
 * same tiles, same table, same "—" rule as everything above it.
 *
 * EVERY NUMBER IS ONE prelaunch_admin_summary ANSWER. Nothing here counts rows;
 * the SQL function is the single definition of a signup, a confirmation and an
 * expiry, and this component only lays its answer out.
 *
 * "—", NEVER A ZERO THAT NOBODY MEASURED. Three different situations print it:
 *   - the read failed (summary null) — the whole section says so in a sentence
 *     instead of showing a grid of dashes nobody can interpret;
 *   - one field is missing from the answer — that tile alone is "—";
 *   - a rate whose denominator is zero — rate() is null, formatRate says "—".
 * A real zero from the database is still printed as 0: it is a measurement.
 *
 * THE PERIOD IS THE SIGNUP DATE. A confirmation, a referral or a reward is
 * counted for the people who signed up inside the window — the only reading
 * under which "Potwierdzone ÷ Zapisy" is a conversion and not two unrelated
 * numbers divided by each other.
 *
 * THE MAIL TILE SAYS "WYSŁANE", NOT MORE. Like the campaign tiles, the only
 * thing this transport learns is that the SMTP server accepted the message;
 * the hint says so.
 */

export async function PrelaunchStats({ summary }: { summary: PrelaunchSummary | null }) {
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const nf = numberFormat(locale);

  /** The one formatter every count goes through — null is "—". */
  const n = (value: number | null) => (value === null ? "—" : nf.format(value));
  /** A conversion, or "—" when either count is unknown or nobody signed up. */
  const conv = (c: PrelaunchCounts) =>
    formatRate(c.signups === null || c.confirmed === null ? null : rate(c.confirmed, c.signups), locale);
  /** A database value with a label when it is one we know, raw when it is
   *  not — an unknown value is shown, never dropped or renamed. The namespace
   *  stays literal so the i18n scope analysis can trace the key. */
  const known = (group: string, members: readonly string[], value: string | null, none: string) =>
    value === null ? none
      : (members as readonly string[]).includes(value)
        ? t(`admin.newsletter.prelaunch.${group}.${value}`) : value;

  const heading = "mb-3 font-display text-sm font-semibold";
  const subHeading = "mb-2.5 text-[12.5px] font-semibold text-muted";
  const noRows = t("admin.newsletter.prelaunch.noRows");
  const num = (value: number | null) => <span className="tabular-nums">{n(value)}</span>;

  const rewardsTotal = summary
    && summary.rewards.signupCredits !== null && summary.rewards.referralCredits !== null
    ? summary.rewards.signupCredits + summary.rewards.referralCredits
    : null;

  return (
    <section data-prelaunch-stats className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className={heading}>{t("admin.newsletter.prelaunch.title")}</h2>
          <p className="-mt-2 max-w-3xl text-[12px] leading-relaxed text-faint">
            {t("admin.newsletter.prelaunch.sub")}
          </p>
        </div>
        {/* The list behind the numbers is one click away, in Kontakty — the
            same rows, filterable and exportable, not a copy of them here. */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] font-medium">
          <Link href="/admin/newsletter/kontakty?prelaunch=pending" data-prelaunch-link="pending"
            className="text-muted transition-colors hover:text-accent">
            {t("admin.newsletter.prelaunch.showPending")} →
          </Link>
          <Link href="/admin/newsletter/kontakty?prelaunch=confirmed" data-prelaunch-link="confirmed"
            className="text-muted transition-colors hover:text-accent">
            {t("admin.newsletter.prelaunch.showConfirmed")} →
          </Link>
        </div>
      </div>

      {summary === null ? (
        <div data-prelaunch-unavailable className="plate rounded-xl px-3.5 py-3">
          <p className="text-[13px] leading-relaxed text-muted">
            {t("admin.newsletter.prelaunch.unavailable")}
          </p>
        </div>
      ) : (
        <>
          {/* ── THE TILES ──────────────────────────────────────────────────
              The funnel first (signups → confirmed → still waiting → lapsed →
              the rate), then the mail that drives it, then what it produced. */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
            <Stat label={t("admin.newsletter.prelaunch.kpi.signups")} value={n(summary.signups)}
              hint={t("admin.newsletter.prelaunch.kpi.signupsHint")} icon={UserPlus} tone="accent" />
            <Stat label={t("admin.newsletter.prelaunch.kpi.confirmed")} value={n(summary.confirmed)}
              hint={t("admin.newsletter.prelaunch.kpi.confirmedHint")} icon={MailCheck} tone="success" />
            <Stat label={t("admin.newsletter.prelaunch.kpi.pending")} value={n(summary.pending)}
              hint={t("admin.newsletter.prelaunch.kpi.pendingHint")} icon={Hourglass} />
            <Stat label={t("admin.newsletter.prelaunch.kpi.expired")} value={n(summary.expired)}
              hint={t("admin.newsletter.prelaunch.kpi.expiredHint")} icon={TimerOff} />
            <Stat label={t("admin.newsletter.prelaunch.kpi.conversion")} value={conv(summary)}
              hint={t("admin.newsletter.prelaunch.kpi.conversionHint")} icon={Percent} tone="violet" />
            <Stat label={t("admin.newsletter.prelaunch.kpi.doisSent")} value={n(summary.doisSent)}
              hint={t("admin.newsletter.prelaunch.kpi.doisSentHint")} icon={Send} tone="indigo" />
            <Stat label={t("admin.newsletter.prelaunch.kpi.resends")} value={n(summary.resends)}
              hint={t("admin.newsletter.prelaunch.kpi.resendsHint")} icon={RotateCcw} />
            <Stat label={t("admin.newsletter.prelaunch.kpi.sendFailures")} value={n(summary.sendFailures)}
              hint={t("admin.newsletter.prelaunch.kpi.sendFailuresHint")} icon={TriangleAlert} />
            <Stat label={t("admin.newsletter.prelaunch.kpi.referrals")} value={n(summary.referrals.counted)}
              hint={t("admin.newsletter.prelaunch.kpi.referralsHint")} icon={Share2} tone="purple" />
            {/* A total only when BOTH halves are known: a sum with a missing
                term is a smaller number presented as the whole. */}
            <Stat label={t("admin.newsletter.prelaunch.kpi.rewards")} value={n(rewardsTotal)}
              hint={t("admin.newsletter.prelaunch.kpi.rewardsHint", {
                signup: n(summary.rewards.signupCredits),
                referral: n(summary.rewards.referralCredits),
              })}
              icon={Gift} tone="accent2" />
          </div>

          {/* ── WHERE THE SIGNUPS CAME FROM ────────────────────────────────
              Paired from xl, like the panels further down the page: two short
              tables side by side instead of two bands of whitespace. */}
          <div className="grid gap-4 xl:grid-cols-2">
            <div data-prelaunch-by-form>
              <h3 className={subHeading}>{t("admin.newsletter.prelaunch.byForm")}</h3>
              <AdminTable
                headers={[
                  t("admin.newsletter.prelaunch.col.form"),
                  t("admin.newsletter.prelaunch.col.signups"),
                  t("admin.newsletter.prelaunch.col.confirmed"),
                  t("admin.newsletter.prelaunch.col.conversion"),
                ]}
                rows={summary.byForm.map((row) => [
                  <span key="f" className="font-medium">{known("form", PRELAUNCH_FORMS, row.form, "—")}</span>,
                  <span key="s">{num(row.signups)}</span>,
                  <span key="c">{num(row.confirmed)}</span>,
                  <span key="r" className="tabular-nums">{conv(row)}</span>,
                ])}
                empty={noRows}
              />
            </div>

            <div data-prelaunch-by-channel>
              <h3 className={subHeading}>{t("admin.newsletter.prelaunch.byChannel")}</h3>
              <AdminTable
                headers={[
                  t("admin.newsletter.prelaunch.col.channel"),
                  t("admin.newsletter.prelaunch.col.count"),
                ]}
                rows={summary.byChannel.map((row) => [
                  <span key="c" className="font-medium">
                    {known("channel", SELLER_CHANNELS, row.channel, t("admin.newsletter.prelaunch.channel.none"))}
                  </span>,
                  <span key="n">{num(row.count)}</span>,
                ])}
                empty={noRows}
              />
            </div>
          </div>

          <div data-prelaunch-by-source>
            <h3 className={subHeading}>{t("admin.newsletter.prelaunch.bySource")}</h3>
            <AdminTable
              headers={[
                t("admin.newsletter.prelaunch.col.utmSource"),
                t("admin.newsletter.prelaunch.col.utmMedium"),
                t("admin.newsletter.prelaunch.col.utmCampaign"),
                t("admin.newsletter.prelaunch.col.signups"),
                t("admin.newsletter.prelaunch.col.confirmed"),
                t("admin.newsletter.prelaunch.col.conversion"),
              ]}
              rows={summary.bySource.map((row) => [
                // Campaign values are free text from a URL: they wrap, they
                // never push the page sideways.
                <span key="s" className="break-all font-medium">
                  {row.utmSource ?? t("admin.newsletter.prelaunch.noUtm")}
                </span>,
                <span key="m" className="break-all">{row.utmMedium ?? "—"}</span>,
                <span key="c" className="break-all">{row.utmCampaign ?? "—"}</span>,
                <span key="n">{num(row.signups)}</span>,
                <span key="k">{num(row.confirmed)}</span>,
                <span key="r" className="tabular-nums">{conv(row)}</span>,
              ])}
              empty={noRows}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div data-prelaunch-by-referrer>
              <h3 className={subHeading}>{t("admin.newsletter.prelaunch.byReferrer")}</h3>
              <AdminTable
                headers={[
                  t("admin.newsletter.prelaunch.col.referrer"),
                  t("admin.newsletter.prelaunch.col.signups"),
                  t("admin.newsletter.prelaunch.col.confirmed"),
                  t("admin.newsletter.prelaunch.col.conversion"),
                ]}
                rows={summary.byReferrerHost.map((row) => [
                  <span key="h" className="break-all font-medium">
                    {row.host ?? t("admin.newsletter.prelaunch.direct")}
                  </span>,
                  <span key="s">{num(row.signups)}</span>,
                  <span key="c">{num(row.confirmed)}</span>,
                  <span key="r" className="tabular-nums">{conv(row)}</span>,
                ])}
                empty={noRows}
              />
            </div>

            {/* ── REFERRALS ──────────────────────────────────────────────────
                Counted, and every refusal with its reason: a referral
                programme whose rejections are invisible looks like one that
                nobody uses. */}
            <div data-prelaunch-rejected>
              <h3 className={subHeading}>{t("admin.newsletter.prelaunch.rejectedTitle")}</h3>
              <AdminTable
                headers={[
                  t("admin.newsletter.prelaunch.col.reason"),
                  t("admin.newsletter.prelaunch.col.count"),
                ]}
                rows={summary.referrals.rejected.map((row) => [
                  <span key="r" className="font-medium">
                    {known("reason", REFERRAL_REJECTIONS, row.reason, "—")}
                  </span>,
                  <span key="n">{num(row.count)}</span>,
                ])}
                empty={noRows}
              />
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div data-prelaunch-top>
              <h3 className={subHeading}>{t("admin.newsletter.prelaunch.topTitle")}</h3>
              <AdminTable
                headers={[
                  t("admin.newsletter.prelaunch.col.referrerContact"),
                  t("admin.newsletter.prelaunch.col.counted"),
                ]}
                rows={summary.referrals.top.map((row) => {
                  // The contact screen when the answer names the contact; a
                  // search for the address otherwise. Either lands on a person.
                  const href = row.contactId
                    ? `/admin/newsletter/kontakty/${row.contactId}`
                    : row.email ? `/admin/newsletter/kontakty?q=${encodeURIComponent(row.email)}` : null;
                  const label = row.email ?? "—";
                  return [
                    href
                      ? <Link key="e" href={href} className="break-all font-medium hover:text-accent hover:underline">{label}</Link>
                      : <span key="e" className="break-all font-medium">{label}</span>,
                    <span key="n">{num(row.counted)}</span>,
                  ];
                })}
                empty={noRows}
              />
            </div>

            <div data-prelaunch-rewards className="panel rounded-2xl p-4 sm:p-5">
              <h3 className={subHeading}>{t("admin.newsletter.prelaunch.rewardsTitle")}</h3>
              <dl className="grid grid-cols-2 gap-3">
                {[
                  { key: "signupClaims", value: summary.rewards.signupClaims },
                  { key: "signupCredits", value: summary.rewards.signupCredits },
                  { key: "referralClaims", value: summary.rewards.referralClaims },
                  { key: "referralCredits", value: summary.rewards.referralCredits },
                ].map((cell) => (
                  <div key={cell.key} className="min-w-0">
                    <dt className="truncate text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
                      {t(`admin.newsletter.prelaunch.rewards.${cell.key}`)}
                    </dt>
                    <dd className="mt-0.5 tabular-nums text-[13px] font-medium">{n(cell.value)}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
                {t("admin.newsletter.prelaunch.rewardsNote")}
              </p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
