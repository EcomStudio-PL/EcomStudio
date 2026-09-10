import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { PricingBoard, type PackCard, type PlanCard } from "@/components/plan/pricing-board";

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
export default async function PlanPage() {
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
    currency: p.currency,
    monthlyCredits: p.monthly_credits,
    bonusCredits: p.bonus_credits,
    // `features` is a capability BAG — {workspace_members: 5, priority_queue:
    // true} — not a list of sentences. It used to be read as an array, which
    // is why the plan cards showed no capabilities at all.
    capabilities: p.features && typeof p.features === "object" && !Array.isArray(p.features)
      ? p.features as Record<string, unknown>
      : {},
    featured: p.featured,
  }));

  const packCards: PackCard[] = (packages ?? []).map((p) => ({
    id: p.id, name: p.name, credits: p.credits, bonusCredits: p.bonus_credits,
    priceCents: p.price_cents, currency: p.currency, featured: p.featured, badge: p.badge,
  }));

  // Without an active subscription the workspace is on the free tier.
  const currentSlug = sub?.subscription_plans?.slug ?? "free";

  return (
    <div>
      <PageHeader overline={t("plans.overline")} title={t("plans.title")} sub={t("plans.sub")} />
      <PricingBoard plans={planCards} packs={packCards} currentSlug={currentSlug} />
      <p className="mt-4 text-[13px] text-muted">{t("plans.soon")}</p>
    </div>
  );
}
