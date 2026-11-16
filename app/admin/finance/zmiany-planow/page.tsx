import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FinanceTabs } from "@/components/admin/finance-tabs";
import { PlanChangesSwitch } from "@/components/admin/plan-changes";
import { planChangesEnabled, portalPlanChangeState } from "@/lib/server/plan-change";
import { paymentsEnabled } from "@/lib/stripe/config";

/**
 * FINANSE → ZMIANY PLANÓW (0181). Admin only (the admin layout redirects
 * anyone else; plan_changes is readable to admins and to a workspace's own
 * members under RLS). The module's switch, what the Customer Portal offers
 * right now (read from Stripe), and every change with its figures — the ones
 * that need a person first.
 */
export const dynamic = "force-dynamic";

type Row = {
  id: string; created_at: string; workspace_id: string; kind: string; timing: string; status: string;
  from_plan_id: string | null; from_period: string | null; to_plan_id: string; to_period: string; currency: string;
  list_price_cents: number; deduction_cents: number; amount_due_cents: number; closed_credits: number;
  review_reason: string | null; error_code: string | null; stripe_invoice_id: string | null; late: boolean;
};

const TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  completed: "success", scheduled: "neutral", awaiting_payment: "warning", held: "warning", quoted: "neutral",
  manual_review: "danger", failed: "danger", released: "neutral", canceled: "neutral", expired: "neutral",
};

export default async function PlanChangesAdmin() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const [enabled, portal, rows, plans, workspaces] = await Promise.all([
    planChangesEnabled(supabase),
    paymentsEnabled() ? portalPlanChangeState() : Promise.resolve(null),
    supabase.from("plan_changes").select("id, created_at, workspace_id, kind, timing, status, from_plan_id, from_period, to_plan_id, to_period, currency, list_price_cents, deduction_cents, amount_due_cents, closed_credits, review_reason, error_code, stripe_invoice_id, late")
      .order("created_at", { ascending: false }).limit(60),
    supabase.from("subscription_plans").select("id, name"),
    supabase.from("workspaces").select("id, name").limit(1000),
  ]);
  const list = (rows.data ?? []) as unknown as Row[];
  const planName = new Map((plans.data ?? []).map((p) => [p.id, p.name]));
  const wsName = new Map((workspaces.data ?? []).map((w) => [w.id, w.name ?? w.id]));
  const money = (c: number, cur: string) => `${(c / 100).toFixed(2)} ${cur}`;
  const at = (iso: string) => new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
  const review = list.filter((r) => r.status === "manual_review");
  const portalOpen = portal?.some((p) => p.planChange) ?? null;

  return (
    <div>
      <PageHeader title={t("admin.nav.financeView")} sub={t("admin.planChanges.sub")} />
      <FinanceTabs />

      <Card className="mb-5 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={enabled ? "success" : "neutral"} dot>{t(enabled ? "admin.planChanges.on" : "admin.planChanges.off")}</Badge>
              <Badge tone={portalOpen === null ? "neutral" : portalOpen ? "warning" : "success"}>
                {portalOpen === null ? t("admin.planChanges.portalUnknown") : t(portalOpen ? "admin.planChanges.portalOpen" : "admin.planChanges.portalClosed")}
              </Badge>
            </div>
            <ul className="space-y-1 text-xs leading-relaxed text-muted">
              <li>• {t("admin.planChanges.rule1")}</li>
              <li>• {t("admin.planChanges.rule2")}</li>
              <li>• {t("admin.planChanges.rule3")}</li>
              <li>• {t("admin.planChanges.rule4")}</li>
            </ul>
          </div>
          <PlanChangesSwitch enabled={enabled} />
        </div>
      </Card>

      {review.length > 0 && (
        <Card className="mb-5 ring-1 ring-[rgb(var(--danger)/0.35)]">
          <CardHeader title={t("admin.planChanges.reviewTitle", { n: review.length })} sub={t("admin.planChanges.reviewSub")} />
          <ul className="space-y-2 px-4 pb-4 text-sm sm:px-5">
            {review.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 border-t border-line pt-2">
                <span>{wsName.get(r.workspace_id) ?? r.workspace_id} → {planName.get(r.to_plan_id) ?? "?"} ({t(`admin.planChanges.period.${r.to_period}`)})</span>
                <span className="text-muted">{r.review_reason ?? r.error_code ?? "—"} · {at(r.created_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title={t("admin.planChanges.historyTitle")} sub={t("admin.planChanges.historySub")} />
        {list.length === 0 ? (
          <p className="px-4 pb-5 text-sm text-muted sm:px-5">{t("admin.planChanges.empty")}</p>
        ) : (
          <div className="overflow-x-auto px-4 pb-4 sm:px-5">
            <table className="w-full min-w-[860px] text-sm">
              <thead><tr className="text-left text-xs text-muted">
                <th className="py-2 pr-3 font-medium">{t("admin.planChanges.col.when")}</th>
                <th className="py-2 pr-3 font-medium">{t("admin.planChanges.col.workspace")}</th>
                <th className="py-2 pr-3 font-medium">{t("admin.planChanges.col.change")}</th>
                <th className="py-2 pr-3 text-right font-medium">{t("admin.planChanges.col.list")}</th>
                <th className="py-2 pr-3 text-right font-medium">{t("admin.planChanges.col.deduction")}</th>
                <th className="py-2 pr-3 text-right font-medium">{t("admin.planChanges.col.due")}</th>
                <th className="py-2 pr-3 text-right font-medium">{t("admin.planChanges.col.closed")}</th>
                <th className="py-2 font-medium">{t("admin.planChanges.col.status")}</th>
              </tr></thead>
              <tbody className="tabular-nums">
                {list.map((r) => (
                  <tr key={r.id} className="border-t border-line align-top">
                    <td className="py-2 pr-3 whitespace-nowrap">{at(r.created_at)}</td>
                    <td className="py-2 pr-3">{wsName.get(r.workspace_id) ?? r.workspace_id.slice(0, 8)}</td>
                    <td className="py-2 pr-3">
                      {planName.get(r.from_plan_id ?? "") ?? "?"} ({t(`admin.planChanges.period.${r.from_period ?? "monthly"}`)}) → {planName.get(r.to_plan_id) ?? "?"} ({t(`admin.planChanges.period.${r.to_period}`)})
                      <span className="block text-xs text-muted">{t(`admin.planChanges.kind.${r.kind}`)} · {t(`admin.planChanges.timing.${r.timing}`)}</span>
                    </td>
                    <td className="py-2 pr-3 text-right">{money(r.list_price_cents, r.currency)}</td>
                    <td className="py-2 pr-3 text-right">{r.deduction_cents > 0 ? `− ${money(r.deduction_cents, r.currency)}` : "—"}</td>
                    <td className="py-2 pr-3 text-right font-medium">{money(r.amount_due_cents, r.currency)}</td>
                    <td className="py-2 pr-3 text-right">{Number(r.closed_credits) > 0 ? Number(r.closed_credits).toFixed(2) : "—"}</td>
                    <td className="py-2">
                      <Badge tone={TONE[r.status] ?? "neutral"}>{t(`admin.planChanges.status.${r.status}`)}</Badge>
                      {(r.review_reason || r.error_code || r.late) && (
                        <span className="mt-1 block text-xs text-muted">{[r.review_reason, r.error_code, r.late ? t("admin.planChanges.late") : null].filter(Boolean).join(" · ")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
