import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { BlockRenderer, renderContext, legalHtml, headingsOf } from "@/components/cms/blocks";
import { AnnouncementBar, SiteHeader, SiteFooter } from "@/components/cms/site-shell";
import { LegalDocument, LegalSoon } from "@/components/legal/legal-document";
import { getGlobalSections, getNavPages, getPublicSite } from "@/lib/server/public-site";
import { getPublishedLegal, legalPdfTag } from "@/lib/server/legal/published";
import { getPlatformAccess } from "@/lib/server/platform-access";
import { legalViewFor } from "@/lib/legal/content";
import { parseLegalText } from "@/lib/legal/document";
import { formatInstant } from "@/lib/utils";
import { TableOfContents } from "./table-of-contents";

/**
 * THE LEGAL DOCUMENTS — the published text when there is one, today's page
 * when there is not.
 *
 * Regulamin, Polityka prywatności, Polityka cookies and the Umowa powierzenia
 * keep their own routes (the footer, the consent lines, the checkout and the
 * sitemap link to them), but their text lives in the CMS: ONE `legal` section
 * whose `doc` field holds each language's text, version and effective date
 * (lib/legal/content.ts). getPublishedLegal is the one reader this page and
 * the PDF route share, so the two can never show different text.
 *
 * THREE STATES.
 *   A document in the visitor's language (or ?lang=pl): the text, verbatim,
 *   with its table of contents, version, date and PDF (LegalDocument).
 *   A language that is not ready: a notice in the visitor's language and the
 *   way to the binding Polish text (LegalSoon) — never a machine translation.
 *   No document yet (the page was published before the import, or not at
 *   all): exactly what this page showed before — the legacy sections, or the
 *   honest placeholder. NO INVENTED LEGAL LANGUAGE; nothing in this codebase
 *   writes terms of service.
 *
 * THIS PAGE IS PUBLIC, AND NOTHING ON IT MAY ASK FOR A SESSION. Someone
 * reading the privacy policy has not asked to sign in, and a public document
 * offers a way onward, never a login wall.
 */

/** What the four routes read from their URL. Next 15 hands it over as a
 *  promise; only `lang` matters here. */
export type LegalSearchParams = Promise<{ lang?: string | string[] }>;

/** ?lang=pl — the "read the Polish version" link. Any other value is ignored:
 *  the interface language decides every other translation. */
function wantsPolish(lang: string | string[] | undefined): boolean {
  return (Array.isArray(lang) ? lang[0] : lang) === "pl";
}

export async function LegalPage({ slug, titleKey, searchParams }: {
  slug: string;
  titleKey: string;
  searchParams?: LegalSearchParams;
}) {
  const supabase = await createClient();
  const [{ dict, locale }, { page, doc }, access, { data: { user } }, query] = await Promise.all([
    getDictionary(),
    getPublishedLegal(slug),
    getPlatformAccess(supabase),
    supabase.auth.getUser(),
    searchParams ?? Promise.resolve({ lang: undefined }),
  ]);
  const t = makeT(dict);

  const [global, nav, site] = await Promise.all([
    getGlobalSections(), getNavPages(), getPublicSite(supabase),
  ]);
  const shell = {
    global, nav, site, locale, t,
    showAuth: access.showAuthEntry,
    signedIn: Boolean(user),
  };

  let body: React.ReactNode;
  if (doc) {
    const view = legalViewFor(doc, locale, wantsPolish(query.lang));
    body = view.mode === "doc" ? (
      <LegalDocument
        slug={slug} t={t} visitor={locale} doc={doc}
        view={view}
        outline={parseLegalText(view.entry.text)}
        pdfTag={legalPdfTag(view.entry, view.locale)}
        publishedAt={page?.publishedAt ?? null}
      />
    ) : (
      <LegalSoon
        slug={slug} titleKey={titleKey} t={t} visitor={locale} doc={doc}
        shown={view.locale}
        polishTag={view.polish ? legalPdfTag(view.polish, "pl") : null}
      />
    );
  } else {
    body = <LegacyLegal page={page} titleKey={titleKey} locale={locale} t={t} signedIn={Boolean(user)} />;
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <AnnouncementBar global={global} locale={locale} />
      <SiteHeader {...shell} />
      <main className="flex-1">{body}</main>
      <SiteFooter {...shell} />
    </div>
  );
}

/**
 * BEFORE THE IMPORT: the page as it has always been. Legacy `legal` /
 * `rich_text` sections with a table of contents built from their sanitised
 * markup — a sticky column on a desktop, a dropdown above the text on a
 * phone — or, with nothing published, the placeholder.
 */
function LegacyLegal({ page, titleKey, locale, t, signedIn }: {
  page: Awaited<ReturnType<typeof getPublishedLegal>>["page"];
  titleKey: string;
  locale: string;
  t: ReturnType<typeof makeT>;
  signedIn: boolean;
}) {
  const blocks = page?.blocks.filter((b) => b.visible) ?? [];
  const hasContent = blocks.length > 0;

  // The headings of every legal section on the page, in document order.
  const toc = blocks
    .filter((b) => b.type === "legal" || b.type === "rich_text")
    .flatMap((b) => headingsOf(legalHtml(b, locale)));

  return (
    <div className="mx-auto w-full max-w-[72rem] px-[var(--page-x,1rem)] py-10 sm:py-14">
      <h1 className="font-display text-[clamp(1.6rem,4vw,2.5rem)] font-semibold tracking-tight">
        {t(titleKey)}
      </h1>
      {/* Readable small text (--muted, not --faint) and the moment in Warsaw
          time, as on the imported documents (LegalDocument). */}
      {page?.publishedAt && (
        <p className="mt-2 text-[12.5px] text-muted">
          {t("legal.lastUpdated")}: {formatInstant(page.publishedAt, locale)}
        </p>
      )}

      {hasContent ? (
        // A flex column below `lg`, so the phone dropdown's `order-first`
        // really puts it above the text (in a plain block it did nothing).
        <div className="mt-8 flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-10">
          <div>
            <BlockRenderer blocks={blocks} ctx={renderContext({ locale, t })} />
          </div>
          {toc.length > 1 && (
            <TableOfContents items={toc} label={t("legal.contents")} />
          )}
        </div>
      ) : (
        <>
          <p className="mt-6 max-w-prose text-sm leading-relaxed text-muted">{t("legal.pendingBody")}</p>
          {/* The support desk lives inside the app, so it is only offered
              to someone who can actually open it. Pointing an anonymous
              reader at /login?next=/support would turn "napisz do nas"
              into a sign-in demand, which is the one thing this page must
              not do. */}
          {signedIn && (
            <p className="mt-3 text-sm text-muted">
              {t("legal.contactPre")}{" "}
              <Link href="/support" className="font-medium text-accent-strong dark:text-accent">{t("nav.help")}</Link>.
            </p>
          )}
        </>
      )}

      {/* A PLAIN LINK HOME — never an auth dialog. These documents are
          usually opened with target="_blank" from the consent line, where
          there is nothing to go back to, so history.back() would send a
          reader off the site entirely. */}
      <Link href="/" data-legal-back
        className="tap mt-10 inline-flex text-sm font-medium text-accent-strong transition-opacity hover:opacity-75 dark:text-accent">
        ← {t("legal.back")}
      </Link>
    </div>
  );
}
