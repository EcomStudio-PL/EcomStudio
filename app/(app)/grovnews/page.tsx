import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { formatMoney } from "@/lib/grovnews-billing";
import { ensureLaunchBonus } from "@/lib/server/grovnews-billing";
import { viewerIsAdmin } from "@/lib/server/feature-availability";
import {
  getCurrentEdition, getGrovNewsOffer, getMyGrovNewsState, grovnewsAccessView, hasActiveGrovNewsAccess,
  listActiveCategories, listFeed, pickCategory,
} from "@/lib/services/grovnews";
import { PageHeader } from "@/components/ui/page-header";
import { GrovNewsCategoryFilter, GrovNewsEditionBox, GrovNewsFeed, GrovNewsLocked } from "@/components/grovnews/reader";
import { GrovNewsAccessCard } from "@/components/grovnews/access-card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "GrovNews", robots: { index: false } };

/**
 * GROVNEWS — the feed. ACCESS FIRST: without access (the database's resolver:
 * an active entitlement or a paid-through subscription) the page renders the
 * locked screen and never queries a post, so nothing premium is in the HTML,
 * the RSC payload or a request the browser can replay. RLS on grovnews_posts
 * refuses the rows as well (migration 0119).
 */
export default async function GrovNewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const supabase = await createClient();
  // A launch-campaign claim that is due (survey done before the campaign went
  // live) lands before access is asked; after the first claim this is a no-op.
  await ensureLaunchBonus(supabase);
  const [{ dict, locale }, access, admin, state] = await Promise.all([
    getDictionary(), hasActiveGrovNewsAccess(supabase), viewerIsAdmin(supabase), getMyGrovNewsState(supabase),
  ]);
  const t = makeT(dict);
  if (!access && !admin) return <GrovNewsLocked t={t} offer={await lockedOffer(supabase, locale)} manage={state?.paid?.live === true} />;

  const [categories, params] = await Promise.all([listActiveCategories(supabase), searchParams]);
  const category = pickCategory(categories, params.category);
  const [posts, edition] = await Promise.all([
    listFeed(supabase, { categoryId: category?.id ?? null }),
    category ? Promise.resolve(null) : getCurrentEdition(supabase),
  ]);
  const view = grovnewsAccessView(state, admin);
  return (
    <div className="min-w-0" data-grovnews>
      <PageHeader overline={t("grovnews.overline")} title={t("grovnews.title")} sub={t("grovnews.sub")} />
      {view && <GrovNewsAccessCard view={view} locale={locale} t={t} />}
      {edition && <GrovNewsEditionBox edition={edition} locale={locale} t={t} />}
      <GrovNewsCategoryFilter categories={categories} active={category?.slug ?? null} t={t} />
      <GrovNewsFeed posts={posts} locale={locale} t={t} filtered={category !== null} />
    </div>
  );
}

/** The price on the locked screen — only when GrovNews Premium is on sale. */
async function lockedOffer(supabase: Awaited<ReturnType<typeof createClient>>, locale: string) {
  const offer = await getGrovNewsOffer(supabase);
  return offer ? { price: formatMoney(offer.priceCents, offer.currency, locale) } : null;
}
