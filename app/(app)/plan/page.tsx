import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { PlansBoard, type PlanCard } from "@/components/plan/plans-board";

export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  const workspace = user ? await getCurrentWorkspace(supabase, user.id) : null;

  const [{ data: plans }, { data: sub }] = await Promise.all([
    supabase.from("subscription_plans").select("*").eq("active", true).order("sort_order"),
    workspace
      ? supabase.from("subscriptions").select("subscription_plans(slug)")
        .eq("workspace_id", workspace.id).eq("status", "active").maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const cards: PlanCard[] = (plans ?? []).map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    priceCents: p.price_cents,
    currency: p.currency,
    monthlyCredits: p.monthly_credits,
    bonusCredits: p.bonus_credits,
    features: Array.isArray(p.features) ? p.features.filter((f): f is string => typeof f === "string") : [],
    featured: p.featured,
  }));

  // Without an active subscription the workspace is on the free tier.
  const currentSlug = sub?.subscription_plans?.slug ?? "free";

  return (
    <div>
      <PageHeader overline={t("plans.overline")} title={t("plans.title")} sub={t("plans.sub")} />
      <PlansBoard plans={cards} currentSlug={currentSlug} />
    </div>
  );
}
