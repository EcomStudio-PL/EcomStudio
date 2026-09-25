import { ProductSurface } from "@/components/home/product-surface";

export const dynamic = "force-dynamic";

/**
 * START — the signed-in Home, and the first tab of the bottom navigation.
 *
 * It renders THE SAME page as /start (and as "/" once the CMS flags the `app`
 * page as the homepage): components/home/product-home.tsx, through the one
 * loader in components/home/product-surface.tsx. `scope="shell"` asks for the
 * body alone, because app/(app)/layout.tsx around this route already drew the
 * application's bar, bottom navigation, drawer and feedback button — and ran
 * the login-security gate, which is why a signed-in customer reaches this page
 * and a visitor never does.
 *
 * WHAT USED TO BE HERE. A dashboard: a greeting, "Zacznij generować", a strip
 * of credits / this week / this month, a tip, and the last few results. It is
 * not the Start any more — the Start is the product itself, the same for a
 * visitor and a customer. Nothing it read is gone: the balance is in the bar,
 * the results are in the Library, and every read it made is still the
 * service call the Library, the credits page and the bar make themselves.
 * Admin-scheduled campaigns for this placement ("dashboard") still show, at
 * the top of the Home.
 */
export default function HomePage() {
  return <ProductSurface scope="shell" />;
}
