import Link from "next/link";
import { Brand } from "@/components/layout/brand";
import { BlockRenderer } from "@/components/cms/blocks";
import { getPublishedPage } from "@/lib/server/public-site";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";

/**
 * THE LEGAL DOCUMENTS — CMS content when there is any, the honest placeholder
 * when there is not.
 *
 * Regulamin and Polityka prywatności keep their own routes (they are linked
 * from the footer, the signup form and the sitemap), but their text is now
 * editable in Strony WWW. Until an admin publishes one, the page says plainly
 * that the document is being finalised, exactly as it did before — no invented
 * legal language, and nothing about these routes changes for a visitor.
 *
 * THIS PAGE IS PUBLIC, AND NOTHING ON IT MAY ASK FOR A SESSION. Someone
 * reading the privacy policy has not asked to sign in, and two controls here
 * used to insist that they do anyway: "← Wróć" opened the registration dialog,
 * and the contact link pointed at /login?next=/support. Both are fixed below;
 * the rule is that a public document offers a way onward, never a login wall.
 */
export async function LegalPage({ slug, titleKey }: { slug: string; titleKey: string }) {
  const supabase = await createClient();
  const [{ dict, locale }, page, { data: { user } }] = await Promise.all([
    getDictionary(),
    getPublishedPage(supabase, slug),
    // Only to decide whether the support desk is reachable for this reader —
    // never to gate the document itself.
    supabase.auth.getUser(),
  ]);
  const t = makeT(dict);
  const hasContent = Boolean(page && page.blocks.some((b) => b.visible));

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 py-10">
      <Brand />
      {/* The document title is an h1 either way: a page whose only heading
          came from a section would leave the reader — and a crawler — without
          one the moment an admin published it. */}
      <h1 className="mt-10 font-display text-2xl font-semibold tracking-tight">{t(titleKey)}</h1>
      {hasContent && page ? (
        <div className="mt-4">
          <BlockRenderer
            blocks={page.blocks}
            locale={locale}
            labels={{ before: t("landing.before"), after: t("landing.after"), video: "Video" }}
          />
        </div>
      ) : (
        <>
          <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted">{t("legal.pendingBody")}</p>
          {/* The support desk lives inside the app, so it is only offered to
              someone who can actually open it. Pointing an anonymous reader at
              /login?next=/support turned "napisz do nas" into a sign-in
              demand, which is the one thing this page must not do. */}
          {user && (
            <p className="mt-3 text-sm text-muted">
              {t("legal.contactPre")}{" "}
              <Link href="/support" className="font-medium text-accent">{t("nav.help")}</Link>.
            </p>
          )}
        </>
      )}
      {/* A PLAIN LINK HOME. It used to be an <AuthLink mode="register">, so a
          control labelled "wróć" opened the sign-up dialog instead — and during
          pre-launch that dialog is the waiting-list card. A reader who tapped
          "Regulamin" in the footer and then "Wróć" was answered with a
          registration panel they never asked for.

          Deliberately not history.back(): these documents are usually opened
          with target="_blank" from the consent line, where there is nothing to
          go back to, and a reader who arrived from a search result would be
          sent off the site entirely. "/" is the one destination that is always
          ours and always right. */}
      <Link href="/" data-legal-back
        className="mt-8 text-sm font-medium text-accent transition-opacity hover:opacity-75">
        ← {t("legal.back")}
      </Link>
    </main>
  );
}
