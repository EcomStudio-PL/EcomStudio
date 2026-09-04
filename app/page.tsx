import Link from "next/link";
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { createClient as createAnonClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/config";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { Brand } from "@/components/layout/brand";
import { BlockRenderer } from "@/components/cms/blocks";
import { LaunchPage } from "@/components/launch/launch-page";
import { getHomepageMode, getLaunchStore, resolveLaunchContent } from "@/lib/server/launch-page";
import { DEFAULT_HOME_BLOCKS } from "@/lib/cms-defaults";
import type { CmsBlock } from "@/lib/cms";
import { formatCredits, formatPrice } from "@/lib/utils";

/**
 * The title and description follow whichever front door is live: before the
 * launch a share of "/" should promise the launch, not the product tour.
 */
export async function generateMetadata(): Promise<Metadata> {
  // The homepage is the one page that must always name itself canonically:
  // it is reachable through the apex, through www, and through the old Vercel
  // hostname, and all three should credit https://grovbase.com/.
  const canonical: Metadata = { alternates: { canonical: "/" } };
  const supabase = await createClient();
  if ((await getHomepageMode(supabase)) !== "waitlist") return canonical;
  const { dict, locale } = await getDictionary();
  const content = resolveLaunchContent(await getLaunchStore(supabase), locale, dict.launch);
  return {
    ...canonical,
    title: content["seo.title"],
    description: content["seo.description"],
    openGraph: {
      title: content["seo.ogTitle"],
      description: content["seo.ogDescription"],
      type: "website",
      url: "/",
      ...(content["hero.image"] ? { images: [content["hero.image"]] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: content["seo.ogTitle"],
      description: content["seo.ogDescription"],
    },
  };
}

export default async function LandingPage({ searchParams }: {
  searchParams: Promise<{ preview?: string; draft?: string }>;
}) {
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const supabase = await createClient();
  const { preview, draft } = await searchParams;
  const [{ data: { user: visitor } }, liveMode] = await Promise.all([
    supabase.auth.getUser(),
    getHomepageMode(supabase),
  ]);

  // "Podgląd" from the admin panel: an admin — and only an admin — can look at
  // the other version, or at the unpublished draft, without switching what the
  // public sees. For everyone else the query string does nothing at all.
  let mode = liveMode;
  let which: "published" | "draft" = "published";
  if (preview === "full" || preview === "waitlist") {
    const { data: profile } = visitor
      ? await supabase.from("profiles").select("role").eq("id", visitor.id).maybeSingle()
      : { data: null };
    if (profile?.role === "admin") {
      mode = preview;
      if (draft === "1") which = "draft";
    }
  }

  // One switch, one route. `waitlist` renders the pre-launch page in place —
  // no redirect, no second copy of the app, and the full landing below is
  // untouched and one setting away from coming back.
  if (mode === "waitlist") {
    const store = await getLaunchStore(supabase);
    return (
      <LaunchPage
        content={resolveLaunchContent(store, locale, dict.launch, which)}
        signedIn={Boolean(visitor)}
        loginLabel={t("launch.login")}
        privacyNote={t("launch.privacy")}
        privacyLinkLabel={t("launch.privacyLink")}
        privacyLabel={t("launch.privacyPage")}
        termsLabel={t("launch.terms")}
      />
    );
  }
  // The CMS snapshot and the plan table are identical for every visitor, so
  // anonymous landing hits are served from a 5-minute cache instead of two
  // DB round-trips. Only the auth check stays per-request. The cached client
  // is anonymous on purpose — nothing user-scoped may live in this closure.
  const loadLandingContent = unstable_cache(
    async () => {
      const anon = createAnonClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      const [{ data: page }, { data: plans }] = await Promise.all([
        anon.from("cms_pages").select("published_snapshot, status").eq("slug", "home").maybeSingle(),
        anon.from("subscription_plans").select("name, price_cents, currency, monthly_credits, featured, slug")
          .eq("active", true).order("sort_order").limit(4),
      ]);
      return { page, plans };
    },
    ["landing-content"],
    { revalidate: 300 },
  );
  const [{ page, plans }, { data: { user } }] = await Promise.all([
    loadLandingContent(),
    supabase.auth.getUser(),
  ]);

  // Published CMS content wins; the curated defaults are the fallback so
  // the homepage is never empty.
  const snapshot = (page?.status === "published" && Array.isArray(page.published_snapshot))
    ? (page.published_snapshot as unknown as CmsBlock[])
    : null;
  const blocks = snapshot && snapshot.length > 0 ? snapshot : DEFAULT_HOME_BLOCKS;
  const mainBlocks = blocks.filter((b) => b.type !== "cta");
  const ctaBlocks = blocks.filter((b) => b.type === "cta");
  const labels = { before: t("landing.before"), after: t("landing.after"), video: "Video" };

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col px-5 sm:px-8">
      <header className="sticky top-0 z-30 -mx-5 flex items-center justify-between gap-2 bg-bg/80 px-5 pb-4 pt-[calc(1rem+env(safe-area-inset-top))] backdrop-blur-md sm:-mx-8 sm:px-8">
        <div className="sm:hidden"><Brand href="/" markOnly /></div>
        <div className="hidden sm:block"><Brand href="/" /></div>
        <nav className="hidden items-center gap-6 text-sm text-muted md:flex">
          <a href="#showcase" className="transition-colors hover:text-ink">{t("landing.navFeatures")}</a>
          <a href="#how" className="transition-colors hover:text-ink">{t("landing.navHow")}</a>
          <a href="#pricing" className="transition-colors hover:text-ink">{t("landing.navPricing")}</a>
        </nav>
        <div className="flex min-w-0 items-center gap-1.5">
          {user ? (
            <Link href="/dashboard" className="brand-gradient whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90">
              {t("landing.openApp")}
            </Link>
          ) : (
            <>
              <Link href="/login" className="whitespace-nowrap rounded-xl px-2.5 py-2 text-sm font-medium text-muted transition-colors hover:text-ink">
                {t("landing.ctaLogin")}
              </Link>
              <Link href="/register" className="brand-gradient whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90">
                {t("landing.cta")}
              </Link>
            </>
          )}
        </div>
      </header>

      <BlockRenderer blocks={mainBlocks} locale={locale} labels={labels} />

      <section id="pricing" className="scroll-mt-20 py-12">
        <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{t("landing.navPricing")}</h2>
        <p className="mt-2 text-sm text-muted">{t("landing.pricingSub")}</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(plans ?? []).map((p) => (
            <div key={p.slug} className={`panel relative flex flex-col rounded-2xl p-5 ${p.featured ? "ring-1 ring-accent2" : ""}`}>
              {p.featured && (
                <span className="absolute -top-2.5 left-4 rounded-full bg-accent2 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                  ★ {t("plan.recommended")}
                </span>
              )}
              <p className="text-sm font-semibold">{p.name}</p>
              <p className="mt-2 font-display text-2xl font-semibold tracking-tight">
                {p.price_cents === 0 ? "0 zł" : formatPrice(p.price_cents, p.currency)}
              </p>
              <p className="mt-1 text-xs text-muted">{t("plan.creditsMo", { n: formatCredits(p.monthly_credits) })}</p>
              <Link href="/register" className="mt-4 rounded-xl border border-line px-4 py-2 text-center text-sm font-semibold transition-colors hover:bg-raised">
                {t("landing.cta")}
              </Link>
            </div>
          ))}
        </div>
      </section>

      <BlockRenderer blocks={ctaBlocks} locale={locale} labels={labels} />

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-8 text-xs text-muted">
        <span className="flex items-center gap-2.5">
          <Brand href="/" height={22} />
          © {new Date().getFullYear()}
        </span>
        <div className="flex gap-4">
          <a href="#showcase" className="hover:text-ink">{t("landing.navFeatures")}</a>
          <a href="#pricing" className="hover:text-ink">{t("landing.navPricing")}</a>
          <Link href="/login" className="hover:text-ink">{t("landing.ctaLogin")}</Link>
        </div>
      </footer>
    </main>
  );
}
