import { SellerHome } from "@/components/seller-home/seller-home";

export const dynamic = "force-dynamic";

/**
 * START — the signed-in Home, and the first tab of the bottom navigation.
 *
 * Its own page now: components/seller-home/seller-home.tsx, a short path to a
 * seller's first generation (task cards, a real upload handed to the tool that
 * runs it, before/after examples, a price anchor, every tool once, and what is
 * coming). The (app) layout around this route already drew the bar, the
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
