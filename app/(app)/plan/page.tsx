import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { PricingBoard, type PackCard, type PlanCard } from "@/components/plan/pricing-board";
import { parsePlanCapabilities } from "@/lib/plans/capabilities";
import { paymentsEnabled } from "@/lib/stripe/config";
import { CheckoutNotice } from "@/components/plan/checkout-notice";

export const dynamic = "force-dynamic";

/**
 * CENNIK — the one page that answers "what does this cost".
 *
 * Plans, the comparison, the credit packs and a custom amount, in that order,
 * because that is the order the questions arrive in. The credit packs used to
 * live only on /credits, which is the WALLET — a balance and a ledger. Someone
 * comparing prices was not going to find them there.
 *
 * Every figure is a database row: subscription_plans and credit_packages.
 * Nothing on this page is typed into the markup.
 */
export default async function PlanPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // A PLAN CHECKOUT COMES BACK HERE, and until now this page said nothing.
  // `planSuccessUrl()` returns the customer to /plan?checkout=success, but only
  // /credits rendered the notice — so someone who had just paid 299 zł landed
  // on a page byte-identical to the one they left, with the same buy button
  // still live. The obvious next move is to click it again, and Stripe would
  // have created a SECOND subscription.
  const params = await searchParams;
  // success / cancelled from Stripe's own return, plus every refusal
  // /checkout can bounce back with. CheckoutNotice renders null for anything
  // it does not recognise, so an invented value shows nothing rather than a
  // humanised key.
  const raw = typeof params.checkout === "string" ? params.checkout : null;
  const checkout = raw && /^[a-z_]{1,32}$/.test(raw) ? raw : null;
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  const workspace = user ? await getCurrentWorkspace(supabase, user.id) : null;

  const [{ data: plans }, { data: packages }, { data: sub }] = await Promise.all([
    supabase.from("subscription_plans").select("*").eq("active", true).order("sort_order"),
    supabase.from("credit_packages").select("*").eq("active", true).order("sort_order"),
    workspace
      ? supabase.from("subscriptions").select("subscription_plans(slug)")
        .eq("workspace_id", workspace.id).eq("status", "active").maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const planCards: PlanCard[] = (plans ?? []).map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    priceCents: p.price_cents,
    // The stored yearly total. 0 on every production plan today, which is
    // exactly why the annual toggle does not render — see lib/plans/pricing.ts.
    annualPriceCents: p.annual_price_cents ?? 0,
    currency: p.currency,
    monthlyCredits: p.monthly_credits,
    bonusCredits: p.bonus_credits,
    // `features` is a capability BAG — {workspace_members: 5, priority_queue:
    // true} — not a list of sentences. It used to be read as an array, which
    // is why the plan cards showed no capabilities at all. One parser, shared
    // with the admin editor and the save path, so the two halves of the app
    // cannot disagree about the shape again.
    capabilities: parsePlanCapabilities(p.features),
    featured: p.featured,
    // A plan is only sellable once it has a Stripe Price. The flag is decided
    // here, on the server, so the button never offers what the checkout would
    // refuse. Annual is false on every plan today — see lib/plans/pricing.ts.
    monthlyMapped: Boolean(p.stripe_price_id_monthly),
    annualMapped: Boolean(p.stripe_price_id_annual),
  }));

  const packCards: PackCard[] = (packages ?? []).map((p) => ({
    id: p.id, name: p.name, credits: p.credits, bonusCredits: p.bonus_credits,
    priceCents: p.price_cents, currency: p.currency, featured: p.featured, badge: p.badge,
    mapped: Boolean(p.stripe_price_id),
  }));

  // Without an active subscription the workspace is on the free tier.
  const currentSlug = sub?.subscription_plans?.slug ?? "free";

  return (
    <div>
      <PageHeader overline={t("plans.overline")} title={t("plans.title")} sub={t("plans.sub")} />
      {checkout && <CheckoutNotice status={checkout} />}
      {/* Whether this deployment holds BOTH Stripe secrets. Read on the
          server; a client cannot be asked whether payments work. */}
      <PricingBoard plans={planCards} packs={packCards} currentSlug={currentSlug}
        paymentsEnabled={paymentsEnabled()} />
      {/* This line said "changing plan will be available once payments are
          connected". Once they ARE connected it is false, and a page that
          keeps apologising for a feature it now has is its own kind of bug. */}
      {!paymentsEnabled() && (
        <p className="mt-4 text-[13px] text-muted">{t("plans.soon")}</p>
      )}
    </div>
  );
}
