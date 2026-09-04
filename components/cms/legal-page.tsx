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
 */
export async function LegalPage({ slug, titleKey }: { slug: string; titleKey: string }) {
  const supabase = await createClient();
  const [{ dict, locale }, page] = await Promise.all([
    getDictionary(),
    getPublishedPage(supabase, slug),
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
          <p className="mt-3 text-sm text-muted">
            {t("legal.contactPre")}{" "}
            <Link href="/login?next=/support" className="font-medium text-accent">{t("nav.help")}</Link>.
          </p>
        </>
      )}
      <Link href="/register" className="mt-8 text-sm font-medium text-accent">← {t("legal.back")}</Link>
    </main>
  );
}
