import { SellerHome } from "@/components/seller-home/seller-home";

export const dynamic = "force-dynamic";

/**
 * START — the signed-in Home, and the first tab of the bottom navigation.
 *
 * Its own page: components/seller-home/seller-home.tsx — a wide, picture-first
 * studio page (tool carousel, the upload tile that hands a photo to the tool
 * that runs it, before/after, three banners, the showcase, Miniaturki, Sesje
 * produktowe, three featured tools, and what is coming). Its pictures and
 * clips are lib/seller-home-config.ts. The (app) layout around this route already drew the bar, the
 * bottom navigation, the drawer, the feedback button and ran the
 * login-security gate.
 *
 * NOT THE PUBLIC PAGE. /start and "/" (when the CMS flags the `app` page as
 * the homepage) still render components/home/product-surface.tsx →
 * product-home.tsx, untouched. /dashboard forwards here.
 */
export default function HomePage() {
  return <SellerHome />;
}
