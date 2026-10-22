import Link from "next/link";
import { ArrowRight, CalendarDays, Download, Languages } from "lucide-react";
import type { LegalDocContent, LegalLocaleDoc } from "@/lib/legal/content";
import type { LegalLocale } from "@/lib/legal/docs";
import type { LegalOutline } from "@/lib/legal/document";
import { cn, formatDate } from "@/lib/utils";
import { LegalText } from "./legal-text";
import { LegalTocAside, LegalTocMobile } from "./legal-toc";
import {
  legalDateLabel, legalHref, legalLanguages, legalPdfHref, legalRelated, legalSwitcher, legalTocTree,
} from "./legal-view";

/**
 * A PUBLISHED LEGAL DOCUMENT, AS A READER GETS IT.
 *
 * Everything here is presentation around ONE untouchable thing: the text,
 * rendered by LegalText line for line from the stored string. Nothing in
 * this file adds to it, shortens it or re-numbers it — the H1 is the
 * document's own first line, so this page never prints a second one.
 *
 * Around it: the four documents as a switcher, the version and effective date
 * the admin set, which languages exist, the PDF of exactly this text, the
 * table of contents built from the text's own headings, and the documents it
 * is bound to (the DPA is Załącznik nr 2 to the Regulamin).
 *
 * A language that is not ready is never faked: the visitor reads a notice in
 * their own language and a way to the binding Polish text — no machine
 * translation, no Polish dressed up as English or German.
 *
 * No hooks and no server-only imports, so the page renders it on the server
 * and scripts/legal-render-tests.ts renders it to static markup. The two ToC
 * pieces are the only client code.
 */

type T = (key: string, vars?: Record<string, string | number>) => string;

const PILL = "inline-flex items-center rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors";
const PRIMARY = "cta inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-5 text-[14px] font-semibold";
const SECONDARY = "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface/70 px-5 text-[14px] font-semibold text-ink transition-colors hover:border-accent/50 hover:text-accent";

/** The four documents, the current one marked. */
export function LegalSwitcher({ slug, t, polish = false }: { slug: string; t: T; polish?: boolean }) {
  return (
    <nav aria-label={t("legal.documents")} data-legal-switcher>
      <ul className="flex flex-wrap gap-2">
        {legalSwitcher(slug, polish).map((item) => (
          <li key={item.slug}>
            <Link href={item.href} aria-current={item.current ? "page" : undefined}
              className={cn(PILL, item.current
                ? "border-accent/45 bg-accent-soft/55 text-ink"
                : "border-line text-muted hover:border-line-strong hover:text-ink")}>
              {t(item.labelKey)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** PL • EN • DE: which languages exist, which one is on screen. */
function LanguageRow({ doc, slug, shown, visitor, t }: {
  doc: LegalDocContent; slug: string; shown: LegalLocale; visitor: string; t: T;
}) {
  return (
    <ul aria-label={t("legal.languages")} data-legal-languages className="flex flex-wrap items-center gap-y-1 text-[12.5px]">
      {legalLanguages(doc, slug, shown, visitor).map((lang, i) => {
        const code = lang.locale.toUpperCase();
        const tone = lang.current
          ? "font-semibold text-ink"
          : lang.active ? "font-medium text-muted" : "font-medium text-faint";
        return (
          <li key={lang.locale} data-legal-lang={lang.locale} data-state={lang.active ? "active" : "soon"}
            className="flex items-center">
            {i > 0 && <span aria-hidden className="mx-2 text-faint/70">•</span>}
            {lang.current && <span aria-hidden className="mr-1.5 h-1.5 w-1.5 rounded-full bg-accent" />}
            {lang.href ? (
              <Link href={lang.href} lang={lang.locale} className={cn(tone, "underline-offset-2 hover:text-ink hover:underline")}>{code}</Link>
            ) : (
              <span lang={lang.locale} className={tone} {...(lang.current ? { "aria-current": "true" as const } : {})}>{code}</span>
            )}
            {!lang.active && <span className="ml-1.5 text-[11px] text-faint">{t("legal.langSoon")}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function BackLink({ t }: { t: T }) {
  // A PLAIN LINK HOME — never an auth dialog. These documents are usually
  // opened with target="_blank" from a consent line, where there is nothing
  // to go back to, so history.back() would send a reader off the site.
  return (
    <Link href="/" data-legal-back
      className="tap inline-flex text-sm font-medium text-accent transition-opacity hover:opacity-75">
      ← {t("legal.back")}
    </Link>
  );
}

export type LegalDocView = {
  locale: LegalLocale;
  entry: LegalLocaleDoc;
  fallbackFrom: LegalLocale | null;
};

/** DOC MODE: the text in a language that has one. */
export function LegalDocument({ slug, t, visitor, doc, view, outline, pdfTag, publishedAt }: {
  slug: string;
  t: T;
  /** The interface language of the visitor. */
  visitor: string;
  doc: LegalDocContent;
  view: LegalDocView;
  /** parseLegalText(view.entry.text) — parsed once by the caller. */
  outline: LegalOutline;
  /** legalVersionTag of the text on screen. */
  pdfTag: string;
  publishedAt: string | null;
}) {
  const { entry } = view;
  const toc = legalTocTree(outline.headings);
  const polish = view.fallbackFrom !== null;
  const related = legalRelated(slug, polish);
  const pdfHref = legalPdfHref(slug, pdfTag, view.locale);
  const hasToc = toc.length > 0;

  return (
    <div data-legal-doc={slug} className="mx-auto w-full max-w-[78rem] px-[var(--page-x,1rem)] pb-16 pt-6 sm:pb-24 sm:pt-10">
      <div className={cn(hasToc && "lg:grid lg:grid-cols-[15.5rem_minmax(0,46rem)] lg:justify-center lg:gap-12 xl:grid-cols-[17rem_minmax(0,46rem)] xl:gap-20")}>
        {hasToc && (
          <aside className="hidden lg:block">
            <LegalTocAside entries={toc} label={t("legal.contents")} />
          </aside>
        )}

        <div className="mx-auto w-full min-w-0 max-w-[46rem]">
          <LegalSwitcher slug={slug} t={t} polish={polish} />

          {view.fallbackFrom && (
            <p role="note" data-legal-fallback={view.fallbackFrom}
              className="mt-6 flex items-start gap-2.5 rounded-xl border border-accent/25 bg-accent-soft/35 px-4 py-3 text-[13.5px] leading-relaxed text-ink/90">
              <Languages size={16} aria-hidden className="mt-0.5 shrink-0 text-accent" />
              <span>{t("legal.fallbackNotice")}</span>
            </p>
          )}

          <div data-legal-meta-bar
            className="mt-6 flex flex-col gap-4 rounded-2xl border border-line bg-sunken/45 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-5">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 text-[13px] text-muted">
              {entry.version && (
                <span data-legal-version
                  className="inline-flex items-center rounded-full border border-accent/30 bg-accent-soft/50 px-2.5 py-0.5 text-[12px] font-semibold text-accent">
                  {t("legal.version", { version: entry.version })}
                </span>
              )}
              {entry.effective && (
                <span data-legal-effective className="inline-flex items-center gap-1.5">
                  <CalendarDays size={14} aria-hidden className="text-faint" />
                  <time dateTime={entry.effective}>
                    {t("legal.effectiveFrom", { date: legalDateLabel(entry.effective, visitor) })}
                  </time>
                </span>
              )}
              <LanguageRow doc={doc} slug={slug} shown={view.locale} visitor={visitor} t={t} />
            </div>
            <a href={pdfHref} data-legal-pdf="top" className={PRIMARY}>
              <Download size={16} aria-hidden />
              {t("legal.downloadPdf")}
            </a>
          </div>

          {hasToc && (
            <div className="mt-6 lg:hidden">
              <LegalTocMobile entries={toc} label={t("legal.contents")} />
            </div>
          )}

          <article className="mt-9 sm:mt-11">
            <LegalText outline={outline} lang={view.locale} />
          </article>
          {/* The end of the text, for the table of contents' highlight. */}
          <span aria-hidden data-legal-end className="block h-px" />

          {related.length > 0 && (
            <aside aria-labelledby="legal-related" data-legal-related
              className="mt-14 rounded-2xl border border-line bg-surface/60 p-5 sm:p-6">
              <h2 id="legal-related" className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-faint">
                {t("legal.related")}
              </h2>
              <ul className="mt-3.5 space-y-2.5">
                {related.map((r) => (
                  <li key={r.slug}>
                    <Link href={r.href} data-legal-related-link={r.relation}
                      className="group flex items-center justify-between gap-4 rounded-xl border border-line bg-bg/50 px-4 py-3.5 transition-colors hover:border-accent/40">
                      <span className="min-w-0">
                        <span className="block text-[12px] font-medium text-accent">{t(r.labelKey)}</span>
                        <span className="mt-0.5 block text-[14.5px] font-semibold leading-snug text-ink">{t(r.titleKey)}</span>
                      </span>
                      <ArrowRight size={16} aria-hidden
                        className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                    </Link>
                  </li>
                ))}
              </ul>
            </aside>
          )}

          <div data-legal-bottom
            className="mt-12 flex flex-col-reverse gap-5 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col items-start gap-2">
              <BackLink t={t} />
              {publishedAt && (
                <p className="text-[12px] text-faint">{t("legal.lastUpdated")}: {formatDate(publishedAt, visitor)}</p>
              )}
            </div>
            <a href={pdfHref} data-legal-pdf="bottom" className={SECONDARY}>
              <Download size={16} aria-hidden />
              {t("legal.downloadPdf")}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * SOON MODE: the visitor's language has no text yet. Their own words say so,
 * and the binding Polish text is one tap away — read here or as a PDF.
 * `polishTag` is null when there is no Polish text either; then the page says
 * the document is being finalised, as it did before any text existed.
 */
export function LegalSoon({ slug, titleKey, t, visitor, doc, shown, polishTag }: {
  slug: string;
  titleKey: string;
  t: T;
  visitor: string;
  doc: LegalDocContent;
  shown: LegalLocale;
  polishTag: string | null;
}) {
  return (
    <div data-legal-soon={slug} className="mx-auto w-full max-w-[78rem] px-[var(--page-x,1rem)] pb-16 pt-6 sm:pb-24 sm:pt-10">
      <div className="mx-auto max-w-[46rem]">
        <LegalSwitcher slug={slug} t={t} />
        <h1 className="mt-10 font-display text-[clamp(1.55rem,3.8vw,2.35rem)] font-semibold leading-[1.15] tracking-tight text-ink sm:mt-12">
          {t(titleKey)}
        </h1>
        <div className="mt-4">
          <LanguageRow doc={doc} slug={slug} shown={shown} visitor={visitor} t={t} />
        </div>

        <section data-legal-soon-card
          className="relative mt-8 overflow-hidden rounded-3xl border border-line bg-surface/70 p-6 sm:p-9">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-accent/10 blur-3xl" />
          <span aria-hidden className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-accent-soft/60 text-accent">
            <Languages size={20} />
          </span>
          <p className="relative mt-5 font-display text-[1.15rem] font-semibold leading-snug text-ink sm:text-[1.25rem]">
            {polishTag ? t("legal.soonBody") : t("legal.pendingBody")}
          </p>
          {polishTag && (
            <>
              <p className="relative mt-2.5 text-[14px] leading-relaxed text-muted">{t("legal.soonBinding")}</p>
              <div className="relative mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Link href={legalHref(slug, true)} data-legal-read-polish className={PRIMARY}>
                  {t("legal.readPolish")}
                  <ArrowRight size={16} aria-hidden />
                </Link>
                <a href={legalPdfHref(slug, polishTag, "pl")} data-legal-pdf="polish" className={SECONDARY}>
                  <Download size={16} aria-hidden />
                  {t("legal.downloadPolishPdf")}
                </a>
              </div>
            </>
          )}
        </section>

        <div className="mt-10">
          <BackLink t={t} />
        </div>
      </div>
    </div>
  );
}
