import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCredits, formatPrice } from "@/lib/utils";

export default async function PlanPage() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data: plans } = await supabase
    .from("subscription_plans")
    .select("*")
    .eq("active", true)
    .order("sort_order");

  return (
    <div>
      <PageHeader overline={t("nav.groups.account")} title={t("plan.title")} sub={t("plan.sub")} />
      <div className="grid gap-3.5 [&>*]:min-w-0 sm:grid-cols-2 lg:grid-cols-4">
        {(plans ?? []).map((p) => {
          const isCurrent = p.slug === "free";
          const features = Array.isArray(p.features)
            ? p.features.filter((f): f is string => typeof f === "string")
            : [];
          return (
            <Card key={p.id} className={`relative flex flex-col p-5 ${p.featured ? "ring-1 ring-accent2" : isCurrent ? "border-accent" : ""}`}>
              {p.featured && (
                <span className="absolute -top-2.5 left-4 rounded-full bg-accent2 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                  ★ {t("plan.recommended")}
                </span>
              )}
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-base font-semibold">{p.name}</h3>
                {isCurrent && <Badge tone="green">{t("plan.current")}</Badge>}
              </div>
              <p className="mt-3 font-display text-3xl font-semibold tracking-tight">
                {p.price_cents === 0 ? "0 zł" : formatPrice(p.price_cents, p.currency)}
              </p>
              <p className="mt-1 text-sm text-muted">
                {t("plan.creditsMo", { n: formatCredits(p.monthly_credits) })}
                {p.bonus_credits > 0 && <span className="text-accent2"> +{formatCredits(p.bonus_credits)}</span>}
              </p>
              {p.description && <p className="mt-2 text-xs text-muted">{p.description}</p>}
              {features.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs">
                      <span aria-hidden className="mt-0.5 text-accent">✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-auto pt-5">
                <button disabled className="w-full rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-muted opacity-60">
                  {isCurrent ? t("plan.current") : t("plan.choose")}
                </button>
              </div>
            </Card>
          );
        })}
      </div>
      <p className="mt-4 text-sm text-muted">{t("plan.chooseSoon")}</p>
    </div>
  );
}
