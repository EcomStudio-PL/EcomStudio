import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { Brand } from "@/components/layout/brand";
import { BlockRenderer } from "@/components/cms/blocks";
import { getPublishedPage } from "@/lib/server/public-site";

export const dynamic = "force-dynamic";

/**
 * EVERY OTHER PUBLIC PAGE.
 *
 * Static routes win over this one in Next's matcher, so /login, /admin, /api
 * and the legal pages keep their own handlers; what reaches here is a slug an
 * admin created in Strony WWW. Only a PUBLISHED page renders — a draft is not
 * "coming soon" to a visitor, it simply is not there yet.
 */

type Params = { params: Promise<{ slug: string }> };

/** Slugs that belong to the app shell and must never be answered from the CMS,
 *  even if someone creates a page with that name. */
const RESERVED = new Set([
  "api", "auth", "admin", "login", "register", "home", "dashboard", "settings",
  "generator", "library", "products", "prompts", "history", "credits", "plan",
  "tools", "inspirations", "support", "retusz", "wideo", "k",
  "forgot-password", "reset-password", "sitemap.xml", "robots.txt",
]);

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  if (RESERVED.has(slug)) return {};
  const supabase = await createClient();
  const page = await getPublishedPage(supabase, slug);
  // A launch page answers "/" through the homepage switch and 404s here, so
  // it must not advertise a title or a canonical for a URL that does not exist.
  if (!page || page.kind === "launch") return {};
  return { title: page.title, alternates: { canonical: `/${slug}` }, openGraph: { url: `/${slug}` } };
}

export default async function CmsPage({ params }: Params) {
  const { slug } = await params;
  if (RESERVED.has(slug)) notFound();

  const supabase = await createClient();
  const page = await getPublishedPage(supabase, slug);
  // A `launch` page answers "/" through the homepage switch, not its own slug.
  const visible = page?.blocks.filter((b) => b.visible) ?? [];
  // Nothing to show is a 404, not an empty shell with a header and a footer.
  if (!page || page.kind === "launch" || visible.length === 0) notFound();

  const { dict, locale } = await getDictionary();
  const t = makeT(dict);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 sm:px-8">
      <header className="flex items-center justify-between gap-3 py-5 pt-[calc(1.25rem+env(safe-area-inset-top))]">
        <Brand href="/" />
        <Link href="/login" className="rounded-xl border border-line px-3.5 py-2 text-[13.5px] font-semibold transition-colors hover:bg-raised">
          {t("landing.ctaLogin")}
        </Link>
      </header>

      <BlockRenderer
        blocks={visible}
        locale={locale}
        labels={{ before: t("landing.before"), after: t("landing.after"), video: "Video" }}
      />

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line py-8 text-[12.5px] text-muted">
        <span className="flex items-center gap-2.5">
          <Brand href="/" height={22} />© {new Date().getFullYear()}
        </span>
        <div className="flex flex-wrap gap-4">
          <Link href="/polityka-prywatnosci" className="transition-colors hover:text-ink">{t("launch.privacyPage")}</Link>
          <Link href="/regulamin" className="transition-colors hover:text-ink">{t("launch.terms")}</Link>
        </div>
      </footer>
    </main>
  );
}
