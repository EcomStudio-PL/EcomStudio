import Link from "next/link";
import { ExternalLink, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LEGAL_LOCALES } from "@/lib/legal/docs";
import type { LegalOverviewRow } from "@/lib/server/legal/admin";
import { formatDate } from "@/lib/utils";

/**
 * STRONY WWW → DOKUMENTY PRAWNE — the four documents at a glance.
 *
 * One card per LEGAL_DOCS entry, whether or not its page exists yet: what
 * visitors read NOW (the published document's version, date, languages, and
 * the length and digest of each text, so it can be checked against the
 * source file without opening anything), when it went live and as which CMS
 * version, and whether the draft has moved on since ("zmiany
 * nieopublikowane" — compared by digest, status, version and date).
 *
 * A server component: plain data in (lib/server/legal/admin.ts
 * legalOverview), links out. Editing happens in the builder.
 */

type T = (key: string, vars?: Record<string, string | number>) => string;

const intlLocale = (ui: string) => (ui === "pl" ? "pl-PL" : ui === "de" ? "de-DE" : "en-GB");

export function LegalDocsPanel({ rows, t, locale }: { rows: LegalOverviewRow[]; t: T; locale: string }) {
  // No rows: the overview could not be read (app/admin/www/page.tsx) — the
  // page list stands on its own.
  if (rows.length === 0) return null;
  const nf = new Intl.NumberFormat(intlLocale(locale));
  const plurals = new Intl.PluralRules(intlLocale(locale));
  const chars = (n: number) => t(`cms.legalDoc.chars.${plurals.select(n)}`, { n: nf.format(n) });
  // An effective date is a calendar day, not a moment: read in UTC so it is
  // the same day in every time zone.
  const day = (iso: string) => new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "long", timeZone: "UTC" })
    .format(new Date(`${iso}T00:00:00Z`));

  return (
    <section className="mt-8" data-legal-docs-panel aria-labelledby="legal-docs-title">
      <div className="mb-3">
        <h2 id="legal-docs-title" className="flex items-center gap-2 font-display text-base font-semibold">
          <FileText size={16} aria-hidden className="text-faint" />{t("cms.legalPanel.title")}
        </h2>
        <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-muted">{t("cms.legalPanel.sub")}</p>
      </div>

      <ul className="grid gap-2.5 lg:grid-cols-2">
        {rows.map(({ def, page, cmsVersion, published, unpublished, draftHasDoc }) => {
          const live = page?.status === "published";
          const pl = published?.pl;
          return (
            <li key={def.slug} className="panel rounded-2xl px-4 py-3.5" data-legal-doc-row={def.slug}
              data-legal-unpublished={unpublished ? "1" : undefined}>
              <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{t(def.titleKey)}</p>
                  <p className="text-[11.5px] text-faint">
                    <code>/{def.slug}</code>
                    {def.annexOf && <> · {t(def.annexOf.labelKey)}</>}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {page
                    ? <Badge tone={live ? "success" : "accent"}>{t(`cms.status.${page.status}`)}</Badge>
                    : <Badge tone="neutral">{t("cms.legalPanel.noPage")}</Badge>}
                  {unpublished && <Badge tone="warning" dot>{t("cms.legalPanel.unpublished")}</Badge>}
                </div>
              </div>

              {!page ? (
                <p className="mt-2 text-[12px] text-muted">{t("cms.legalPanel.noPageBody")}</p>
              ) : (
                <>
                  {published ? (
                    <div className="mt-2.5 space-y-1.5 text-[12px]">
                      <p className="text-ink">
                        {pl?.version ? t("cms.legalPanel.docVersion", { version: pl.version }) : t("cms.legalPanel.noVersion")}
                        {pl?.effective && <span className="text-muted"> · {t("cms.legalPanel.effective", { date: day(pl.effective) })}</span>}
                      </p>
                      <ul className="space-y-0.5" data-legal-languages>
                        {LEGAL_LOCALES.map((l) => {
                          const f = published[l];
                          return (
                            <li key={l} className="flex flex-wrap items-baseline gap-x-2 tabular-nums" data-legal-lang={l}
                              data-legal-lang-status={f.status}>
                              <span className="w-6 font-semibold uppercase">{l}</span>
                              <span className={f.status === "active" ? "text-success" : "text-muted"}>
                                {t(f.status === "active" ? "cms.legalDoc.statusActive" : "cms.legalDoc.statusSoon")}
                              </span>
                              {f.sha256 && (
                                <span className="text-faint" data-legal-sha={f.sha256}>
                                  {t("cms.legalPanel.digest", { chars: chars(f.chars), sha: f.sha256.slice(0, 12) })}
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : (
                    <p className="mt-2 text-[12px] text-muted">
                      {t(draftHasDoc ? "cms.legalPanel.notPublishedYet" : "cms.legalPanel.noDoc")}
                    </p>
                  )}
                  <p className="mt-2 text-[11.5px] text-faint">
                    {page.publishedAt && live ? t("cms.legalPanel.publishedAt", { date: formatDate(page.publishedAt, locale) }) : t("cms.legalPanel.notPublished")}
                    {cmsVersion !== null && <> · {t("cms.legalPanel.cmsVersion", { n: cmsVersion })}</>}
                  </p>

                  <div className="mt-2.5 flex flex-wrap items-center gap-x-1 gap-y-1 border-t border-line pt-2">
                    <Link href={`/admin/www/${def.slug}`} data-legal-edit
                      className="inline-flex h-9 items-center rounded-lg px-2.5 text-[13px] font-semibold text-accent transition-colors hover:bg-raised">
                      {t("common.edit")}
                    </Link>
                    <Link href={`/admin/www/${def.slug}/historia`} data-legal-history
                      className="inline-flex h-9 items-center rounded-lg px-2.5 text-[13px] font-medium text-muted transition-colors hover:bg-raised hover:text-ink">
                      {t("cms.history")}
                    </Link>
                    <a href={live ? `/${def.slug}` : `/podglad/${def.slug}`} target="_blank" rel="noreferrer" data-legal-open
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-muted transition-colors hover:bg-raised hover:text-ink">
                      {t(live ? "cms.legalPanel.open" : "cms.preview")}<ExternalLink size={12} aria-hidden />
                    </a>
                    {live && published && (
                      <a href={`/${def.slug}/pdf`} target="_blank" rel="noreferrer" data-legal-pdf
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-muted transition-colors hover:bg-raised hover:text-ink">
                        {t("cms.legalPanel.pdf")}<ExternalLink size={12} aria-hidden />
                      </a>
                    )}
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
