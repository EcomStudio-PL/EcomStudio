import { Fragment, type ReactNode } from "react";
import { createClient, getRequestUser } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { loadSellerHome, type SellerHomeData } from "@/lib/server/seller-home";
import { defaultUploadTool } from "@/lib/seller-home-model";
import { PROMO_BANNERS } from "@/lib/seller-home-config";
import { sectionItem, type HomeSectionId } from "@/lib/home-layout";
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
 * A wide, picture-first studio page, by default in exactly this order (an
 * admin may hide or reorder sections in „Edytuj stronę” — lib/home-layout.ts,
 * stored in public.home_layout):
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
  // The section slots an admin filled in the visual editor, with the
  // language their alt text is read in. Nothing filled → undefined, and every
  // section renders exactly what it rendered before the editor existed.
  const home = data.homeSlots ? { slots: data.homeSlots, locale } : undefined;
  const items = data.items;

  // Each section's content — or null when it has nothing to show this viewer
  // (its tool not offered, no campaign, nothing still to come). The server
  // sections are called as plain functions, so a section that draws nothing
  // leaves no wrapper and no gap behind (lib/home-layout.ts: the one rule).
  const draw: Record<HomeSectionId, () => ReactNode> = {
    carousel: () => ToolCarousel({ data, t, locale }),
    upload: () => <UploadTile tools={data.uploadTools} defaultTool={defaultTool} balance={data.balance} pro={data.pro} />,
    beforeAfter: () => BeforeAfterRow({ data, t, home, locale }),
    // An admin-scheduled campaign for this placement, when there is one —
    // in the banner zone, never above the carousel.
    campaign: () => (data.banners.length > 0
      ? <div className="relative"><DashboardBanner banners={data.banners} slots={data.slots} locale={locale} /></div>
      : null),
    promo1: () => PromoBanner({ def: PROMO_BANNERS.first, items, t, home, item: sectionItem(data.layout, "promo1") }),
    showcase: () => Showcase({ data, t, home }),
    promo2: () => PromoBanner({ def: PROMO_BANNERS.second, items, t, home, item: sectionItem(data.layout, "promo2") }),
    thumbnails: () => ThumbnailsSection({ data, t, home }),
    sessions: () => SessionsSection({ data, t, home }),
    featured: () => FeaturedTools({ data, t, locale }),
    promo3: () => PromoBanner({ def: PROMO_BANNERS.third, items, t, home, item: sectionItem(data.layout, "promo3") }),
    soon: () => (data.soon.length > 0 ? <ComingSoon keys={data.soon} saved={data.interests} /> : null),
  };

  // The layout's order; a hidden section is simply not drawn — except in
  // „Edytuj stronę”, where it stays in place, greyed and marked „Ukryta”, so
  // it can be brought back. Every section in edit mode carries its handle
  // (data-home-section) for the editor's toolbars; a customer's page has no
  // wrapper at all — the same DOM as before the layout existed.
  const sections = data.layout.sections.flatMap((sec) => {
    if (sec.hidden && !data.editing) return [];
    const node = draw[sec.id]();
    if (node === null || node === undefined || node === false) return [];
    if (!data.editing) return [<Fragment key={sec.id}>{node}</Fragment>];
    return [
      <div key={sec.id} className="relative" data-home-section={sec.id} data-home-hidden={sec.hidden || undefined}>
        {sec.hidden ? (
          <>
            <div className="opacity-45 grayscale">{node}</div>
            <span data-home-flag="section"
              className="pointer-events-none absolute left-2 top-2 z-[4] rounded-full bg-[rgb(20_14_28/0.85)] px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-white ring-1 ring-white/25">
              {t("sellerHome.edit.sectionHidden")}
            </span>
          </>
        ) : node}
      </div>,
    ];
  });

  return (
    <div data-seller-home
      className="flex w-full min-w-0 flex-col gap-[var(--home-section-gap)] [--home-section-gap:14px] [overflow-x:clip] sm:[--home-section-gap:18px] lg:[--home-section-gap:22px] xl:-mx-2 xl:w-[calc(100%+1rem)]">
      <h1 className="sr-only">{t("sellerHome.pageTitle")}</h1>

      {sections}

      <SellerChannelModal ask={data.askChannel} />
    </div>
  );
}
