import { createClient, getRequestUser } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { loadSellerHome } from "@/lib/server/seller-home";
import { defaultTaskFor, visibleGallery } from "@/lib/seller-home-model";
import type { HeroTaskKey } from "@/lib/seller-home-config";
import { DashboardBanner } from "@/components/dashboard/banner";
import { SellerHero } from "./hero";
import { SellerGallery } from "./gallery";
import { ComingSoon } from "./coming-soon";
import { SellerChannelModal } from "./seller-modal";
import { AllTools, PriceAnchor, RecentProjects } from "./sections";

/**
 * THE SIGNED-IN START — /home only.
 *
 * Built for one outcome: a new seller's FIRST successful generation. So the
 * page is short and in this order —
 *
 *   new seller        hero → before/after → price anchor → all tools → coming soon
 *   returning seller  recent projects → hero → price anchor → all tools →
 *                     before/after → coming soon
 *
 * (an admin-scheduled campaign for this placement still shows at the top).
 * The header, the bottom navigation, the drawer and "Zgłoś błąd / zaproponuj
 * zmianę" are the (app) layout's, unchanged; the public "/" and /start keep
 * rendering components/home/product-home.tsx.
 *
 * Every figure is read, not typed: prices from each tool's own price source,
 * availability from the switchboard + the tool's runtime, the balance from the
 * wallet, the PRO credit price from the plan row (lib/server/seller-home.ts).
 * The words, pictures and their sizes are lib/seller-home-config.ts.
 */
export async function SellerHome() {
  const supabase = await createClient();
  const [{ dict, locale }, user] = await Promise.all([getDictionary(), getRequestUser()]);
  const t = makeT(dict);
  if (!user) return null;
  const data = await loadSellerHome(supabase, user);

  const defaultTask = defaultTaskFor(data.channel, data.tasks);
  const gallery = visibleGallery(data.tasks);
  const taskNames: Partial<Record<HeroTaskKey, string>> = Object.fromEntries(
    data.tasks.filter((x) => x.available).map((x) => [x.key, x.nameKey]),
  );
  const returning = data.recent.length > 0;

  const hero = <SellerHero tasks={data.tasks} defaultTask={defaultTask} balance={data.balance} pro={data.pro} />;
  const galleryEl = <SellerGallery items={gallery} taskNames={taskNames} />;
  const anchor = <PriceAnchor tasks={data.tasks} centsPerCredit={data.centsPerCredit} currency={data.currency} t={t} />;
  const tools = <AllTools groups={data.tools} slots={data.slots} t={t} />;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-9 sm:space-y-12" data-seller-home data-returning={returning || undefined}>
      {data.banners.length > 0 && <DashboardBanner banners={data.banners} slots={data.slots} locale={locale} />}
      {returning && <RecentProjects items={data.recent} locale={locale} t={t} />}
      {hero}
      {!returning && galleryEl}
      {anchor}
      {tools}
      {returning && galleryEl}
      <ComingSoon keys={data.soon} saved={data.interests} />
      <SellerChannelModal ask={data.askChannel} />
    </div>
  );
}
