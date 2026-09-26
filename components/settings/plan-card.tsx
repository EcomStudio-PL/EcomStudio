import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BillingPortalButton } from "@/components/plan/billing-portal-button";
import { formatWarsawDate } from "@/lib/grovnews-billing";
import { PLAN_BADGE } from "@/lib/plan-tone";
import { cn } from "@/lib/utils";
import type { PlanSummary } from "./tabs";

type T = (key: string, vars?: Record<string, string | number>) => string;

const STATUS: Record<PlanSummary["status"], { key: string; tone: "neutral" | "success" | "info" | "danger" }> = {
  free: { key: "settings.plan.status.free", tone: "neutral" },
  active: { key: "settings.plan.status.active", tone: "success" },
  trialing: { key: "settings.plan.status.trialing", tone: "info" },
  past_due: { key: "settings.plan.status.past_due", tone: "danger" },
};

/**
 * PLAN GROVBASE — which tier the workspace is on, read from its
 * `subscriptions` row (active, trialing or past due) and the plan it points
 * at. Server-rendered: the only interactive part is the existing Billing
 * Portal button, shown when there is a Stripe subscription to manage.
 * Without one the way forward is the pricing page.
 */
export function PlanCard({ plan, t, locale }: { plan: PlanSummary; t: T; locale: string }) {
  const status = STATUS[plan.status];
  return (
    <div className="space-y-4 text-[13px]" data-settings-plan={plan.status}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className={cn("rounded-full px-2.5 py-1 text-[12px] font-bold", PLAN_BADGE[plan.tone])}>{plan.name}</span>
        <Badge tone={status.tone} dot>{t(status.key)}</Badge>
      </div>
      {plan.status === "past_due" && <p className="text-[12.5px] text-muted">{t("settings.plan.pastDue")}</p>}
      {plan.renewsAt && (
        <p className="text-[12.5px] text-muted">{t("settings.plan.renews", { date: formatWarsawDate(plan.renewsAt, locale) })}</p>
      )}
      {plan.endsAt && (
        <p className="text-[12.5px] text-muted">{t("settings.plan.ends", { date: formatWarsawDate(plan.endsAt, locale) })}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {plan.manageable ? (
          <BillingPortalButton />
        ) : (
          <Link href="/plan" data-settings-see-plans
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-line px-4 text-[13.5px] font-semibold text-ink transition-colors hover:bg-raised">
            {t("settings.plan.seePlans")}
            <ArrowUpRight size={14} aria-hidden />
          </Link>
        )}
      </div>
    </div>
  );
}
