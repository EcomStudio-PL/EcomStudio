import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { BlockRenderer, renderContext, legalHtml, headingsOf } from "@/components/cms/blocks";
import { AnnouncementBar, SiteHeader, SiteFooter } from "@/components/cms/site-shell";
import {
  getGlobalSections, getNavPages, getPublicSite, getPublishedPage,
} from "@/lib/server/public-site";
import { getPlatformAccess } from "@/lib/server/platform-access";
import { formatDate } from "@/lib/utils";
import { TableOfContents } from "./table-of-contents";

/**
 * THE LEGAL DOCUMENTS — CMS content when there is any, the honest placeholder
 * when there is not.
 *
 * Regulamin and Polityka prywatności keep their own routes (they are linked
 * from the footer, the signup form and the sitemap), but their text is edited
 * in the CMS like any other page. Until an admin publishes one, the page says
 * plainly that the document is being finalised — NO INVENTED LEGAL LANGUAGE.
 * Nothing in this codebase writes terms of service.
 *
 * A published document gets a table of contents built from its own headings:
 * a sticky column on a desktop, a dropdown above the text on a phone. Both are
 * generated from the sanitised markup, so a section added in the editor
 * appears in the navigation without anybody maintaining a second list.
 *
 * THIS PAGE IS PUBLIC, AND NOTHING ON IT MAY ASK FOR A SESSION. Someone
 * reading the privacy policy has not asked to sign in, and a public document
 * offers a way onward, never a login wall.
 */
export async function LegalPage({ slug, titleKey }: { slug: string; titleKey: string }) {
  const supabase = await createClient();
  const [{ dict, locale }, page, access, { data: { user } }] = await Promise.all([
    getDictionary(),
    getPublishedPage(supabase, slug),
    getPlatformAccess(supabase),
    supabase.auth.getUser(),
  ]);
  const t = makeT(dict);
  const blocks = page?.blocks.filter((b) => b.visible) ?? [];
  const hasContent = blocks.length > 0;

  const [global, nav, site] = await Promise.all([
    getGlobalSections(), getNavPages(), getPublicSite(supabase),
  ]);
  const shell = {
    global, nav, site, locale, t,
    showAuth: access.showAuthEntry,
    signedIn: Boolean(user),
  };

  // The headings of every legal section on the page, in document order.
  const toc = blocks
    .filter((b) => b.type === "legal" || b.type === "rich_text")
    .flatMap((b) => headingsOf(legalHtml(b, locale)));

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <AnnouncementBar global={global} locale={locale} />
      <SiteHeader {...shell} />

      <main className="flex-1">
        <div className="mx-auto w-full max-w-[72rem] px-[var(--page-x,1rem)] py-10 sm:py-14">
          <h1 className="font-display text-[clamp(1.6rem,4vw,2.5rem)] font-semibold tracking-tight">
            {t(titleKey)}
          </h1>
          {page?.publishedAt && (
            <p className="mt-2 text-[12.5px] text-faint">
              {t("legal.lastUpdated")}: {formatDate(page.publishedAt, locale)}
            </p>
          )}

          {hasContent ? (
            <div className="mt-8 gap-10 lg:grid lg:grid-cols-[minmax(0,1fr)_16rem]">
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
              {user && (
                <p className="mt-3 text-sm text-muted">
                  {t("legal.contactPre")}{" "}
                  <Link href="/support" className="font-medium text-accent">{t("nav.help")}</Link>.
                </p>
              )}
            </>
          )}

          {/* A PLAIN LINK HOME — never an auth dialog. These documents are
              usually opened with target="_blank" from the consent line, where
              there is nothing to go back to, so history.back() would send a
              reader off the site entirely. */}
          <Link href="/" data-legal-back
            className="tap mt-10 inline-flex text-sm font-medium text-accent transition-opacity hover:opacity-75">
            ← {t("legal.back")}
          </Link>
        </div>
      </main>

      <SiteFooter {...shell} />
    </div>
  );
}
