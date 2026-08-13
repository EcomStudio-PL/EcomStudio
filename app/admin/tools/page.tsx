import Link from "next/link";
import { AlertTriangle, CheckCircle2, ExternalLink, Plug } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { providerStatuses, toolCatalogue } from "@/lib/server/image-tools";
import { billingFrom } from "@/lib/images/pricing";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { AdminTable } from "@/components/ui/admin-table";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * ADMIN — IMAGE TOOLS.
 *
 * Two questions this page answers: which backends are actually connected,
 * and what each operation earns. The margin column is computed the same way
 * the runtime charges for it, so what the operator reads here is what the
 * seller will pay — not a separately maintained spreadsheet.
 */
export default async function AdminToolsPage() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);

  const [{ data: billingRow }, { data: services }, providers, catalogue] = await Promise.all([
    supabase.from("app_settings").select("value").eq("key", "billing").maybeSingle(),
    supabase.from("service_catalog").select("slug, credits_cost, api_cost_usd_micros, enabled, maintenance_mode")
      .eq("category", "tools"),
    providerStatuses(supabase),
    toolCatalogue(supabase),
  ]);
  const billing = billingFrom(billingRow?.value);
  const catalog = new Map((services ?? []).map((s) => [s.slug, s]));

  const rows = catalogue.map((item) => {
    const service = catalog.get(`tool_${item.slug}`);
    const revenue = item.credits * billing.plnPerCredit;
    // The cost the engine used to arrive at this price, back-solved from the
    // catalogue estimate so the two can never silently disagree.
    const costUsd = item.kind === "paid" ? (service?.api_cost_usd_micros ?? 0) / 1_000_000 : 0;
    const costPln = costUsd * billing.usdToPln;
    const margin = revenue > 0 ? ((revenue - costPln) / revenue) * 100 : null;
    return { ...item, revenue, costPln, margin };
  });

  const connected = providers.filter((p) => p.status === "connected").length;

  return (
    <div>
      <PageHeader
        overline={t("admin.navGroups.ai")}
        title={t("admin.tools.title")}
        sub={t("admin.tools.sub")}
      />

      <Panel className="mb-5 rounded-2xl p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="overline">{t("admin.tools.providers")}</p>
          <Badge tone={connected > 0 ? "green" : "amber"} dot>
            {t("admin.tools.connectedCount", { n: connected, total: providers.length })}
          </Badge>
        </div>
        <div className="grid gap-2.5 [&>*]:min-w-0 sm:grid-cols-2">
          {providers.map((p) => (
            <div key={p.slug} className="plate flex items-start gap-3 rounded-xl p-3">
              <span aria-hidden className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                p.status === "connected" ? "bg-[rgb(var(--success)/0.14)] text-success" : "bg-sunken text-faint"
              )}>
                {p.status === "connected" ? <CheckCircle2 size={16} /> : <Plug size={16} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-[13px] font-semibold">{p.label}</p>
                  <Badge tone={p.status === "connected" ? "green" : "neutral"}>
                    {t(`admin.tools.status.${p.status}`)}
                  </Badge>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-faint">
                  {p.capabilities.map((c) => t(`admin.tools.cap.${c}`)).join(" · ")}
                </p>
                <p className="mt-1 font-mono text-[11px] text-muted">{p.envVar}</p>
                {p.status === "connected" ? (
                  <p className="mt-0.5 text-[11px] text-faint">{t(`admin.tools.source.${p.source}`)}</p>
                ) : (
                  <a href={p.keyUrl} target="_blank" rel="noreferrer noopener"
                    className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline">
                    {t("admin.tools.getKey")} <ExternalLink size={11} aria-hidden />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-sunken/70 px-3 py-2.5 text-[12px] leading-relaxed text-muted">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-accent2" aria-hidden />
          <span>
            {t("admin.tools.keyNote")}{" "}
            <Link href="/admin/providers" className="font-medium text-accent hover:underline">
              {t("admin.nav.providers")}
            </Link>
          </span>
        </p>
      </Panel>

      <Panel className="rounded-2xl p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="overline">{t("admin.tools.economics")}</p>
          <span className="text-[11px] tabular-nums text-faint">
            {t("admin.tools.assumptions", {
              credit: billing.plnPerCredit.toFixed(2),
              fx: billing.usdToPln.toFixed(2),
              margin: billing.minMarginPercent,
              buffer: billing.bufferPercent,
            })}
          </span>
        </div>
        <AdminTable
          empty={t("common.noData")}
          headers={[
            t("admin.tools.col.tool"), t("admin.tools.col.type"), t("admin.tools.col.provider"),
            t("admin.tools.col.cost"), t("admin.tools.col.price"), t("admin.tools.col.margin"),
          ]}
          rows={rows.map((r) => [
            t(`tools.${r.slug}.name`),
            r.kind === "local" ? t("tools.free") : t("admin.tools.paid"),
            r.providerLabel ?? (r.kind === "local" ? "sharp" : "—"),
            r.kind === "local" ? "0,000 zł" : `${r.costPln.toFixed(3)} zł`,
            r.credits === 0 ? t("tools.free") : `${r.credits} kr · ${r.revenue.toFixed(2)} zł`,
            r.margin === null ? "—" : (
              <Badge key="m" tone={r.margin >= billing.minMarginPercent ? "green" : "red"}>
                {Math.round(r.margin)}%
              </Badge>
            ),
          ])}
        />
      </Panel>
    </div>
  );
}
