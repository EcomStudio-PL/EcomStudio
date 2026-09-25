import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { viewerIsAdmin } from "@/lib/server/feature-availability";
import { hasActiveGrovNewsAccess, listFeed } from "@/lib/services/grovnews";
import { PageHeader } from "@/components/ui/page-header";
import { GrovNewsFeed, GrovNewsLocked } from "@/components/grovnews/reader";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "GrovNews", robots: { index: false } };

/**
 * GROVNEWS — the feed. ACCESS FIRST: without an active entitlement the page
 * renders the locked screen and never queries a post, so nothing premium is
 * in the HTML, the RSC payload or a request the browser can replay. RLS on
 * grovnews_posts refuses the rows as well (migration 0119).
 */
export default async function GrovNewsPage() {
  const supabase = await createClient();
  const [{ dict, locale }, access, admin] = await Promise.all([
    getDictionary(), hasActiveGrovNewsAccess(supabase), viewerIsAdmin(supabase),
  ]);
  const t = makeT(dict);
  if (!access && !admin) return <GrovNewsLocked t={t} />;

  const posts = await listFeed(supabase);
  return (
    <div data-grovnews>
      <PageHeader overline={t("grovnews.overline")} title={t("grovnews.title")} sub={t("grovnews.sub")} />
      <GrovNewsFeed posts={posts} locale={locale} t={t} />
    </div>
  );
}
