import { createClient, getRequestUser } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { loadSellerHome, type SellerHomeData } from "@/lib/server/seller-home";
import { defaultUploadTool } from "@/lib/seller-home-model";
import { PROMO_BANNERS } from "@/lib/seller-home-config";
import { DashboardBanner } from "@/components/dashboard/banner";
import { ToolCarousel } from "./tool-carousel";
import { UploadTile } from "./upload-tile";
import {
  BeforeAfterRow, FeaturedTools, PromoBanner, SessionsSection, Showcase, ThumbnailsSection,
} from "./sections";
import { ComingSoon } from "./coming-soon";
import { SellerChannelModal } from "./seller-modal";

/**
 * THE SIGNED-IN START — /home only.
 *
 * A wide, picture-first studio page, in exactly this order:
 *
 *    1  the tool carousel (no heading — pictures first)
 *    2  the upload tile, its three tool pills and five samples
 *    3  before / after
 *    4  banner #1
 *    5  the showcase
 *    6  banner #2
 *    7  Miniaturki
 *    8  Sesje produktowe
 *    9  three featured tools
 *   10  banner #3
 *   11  Nadchodzi
 *
 * FULL WIDTH: no container of its own — the page uses the (app) shell's
 * content box (up to 2100px), whose side padding is the page margin
 * (16px phone, 24px tablet, 32px desktop; trimmed by 8px on the widest
 * screens, where the shell pads 40px). ONE RHYTHM: every section is separated
 * by `--home-section-gap` (14 / 18 / 22px) and nothing else.
 *
 * Every section is `relative`, so it paints above the upload tile's halo and
 * the halo shows only in the gaps; the page clips sideways (`overflow-x:
 * clip`) and never vertically, so the halo fades out instead of being cut.
 *
 * The header, the bottom navigation, the drawer and "Zgłoś błąd / zaproponuj
 * zmianę" are the (app) layout's, unchanged; the public "/" and /start keep
 * rendering components/home/product-home.tsx. Pictures, clips and their sizes
 * are lib/seller-home-config.ts; availability and prices are read through
 * lib/server/seller-home.ts.
 */
export async function SellerHome() {
  const supabase = await createClient();
  const [{ dict, locale }, user] = await Promise.all([getDictionary(), getRequestUser()]);
  const t = makeT(dict);
  if (!user) return null;
  const data = await loadSellerHome(supabase, user);
  return <SellerHomeView data={data} t={t} locale={locale} />;
}

/** The page itself, from the facts alone — no I/O. */
export function SellerHomeView({ data, t, locale }: {
  data: SellerHomeData;
  t: (key: string, vars?: Record<string, string | number>) => string;
  locale: string;
}) {
  const defaultTool = defaultUploadTool(data.channel, data.uploadTools);

  return (
    <div data-seller-home
      className="flex w-full min-w-0 flex-col gap-[var(--home-section-gap)] [--home-section-gap:14px] [overflow-x:clip] sm:[--home-section-gap:18px] lg:[--home-section-gap:22px] xl:-mx-2 xl:w-[calc(100%+1rem)]">
      <h1 className="sr-only">{t("sellerHome.pageTitle")}</h1>

      <ToolCarousel data={data} t={t} />
      <UploadTile tools={data.uploadTools} defaultTool={defaultTool} balance={data.balance} pro={data.pro} />
      <BeforeAfterRow items={data.items} t={t} />

      {/* An admin-scheduled campaign for this placement, when there is one —
          in the banner zone, never above the carousel. */}
      {data.banners.length > 0 && (
        <div className="relative"><DashboardBanner banners={data.banners} slots={data.slots} locale={locale} /></div>
      )}
      <PromoBanner def={PROMO_BANNERS.first} items={data.items} t={t} />
      <Showcase items={data.items} t={t} />
      <PromoBanner def={PROMO_BANNERS.second} items={data.items} t={t} />
      <ThumbnailsSection items={data.items} t={t} />
      <SessionsSection items={data.items} t={t} />
      <FeaturedTools data={data} t={t} />
      <PromoBanner def={PROMO_BANNERS.third} items={data.items} t={t} />
      <ComingSoon keys={data.soon} saved={data.interests} />

      <SellerChannelModal ask={data.askChannel} />
    </div>
  );
}
