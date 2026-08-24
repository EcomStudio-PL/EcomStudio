"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/provider";
import { saveServiceAction } from "@/app/actions/admin-b2b";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Select, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export type ServiceRow = {
  id?: string; slug: string; name: string; category: string; service_type: string; unit: string;
  credits_cost: number; api_cost_usd_micros: number; sale_value_cents: number;
  min_margin_percent: number; markup_percent: number | null; plan_slugs: string[] | null;
  enabled: boolean; featured: boolean; maintenance_mode: boolean; sort_order: number;
};

const TYPES = ["image", "video", "prompt", "text", "audio", "other"];

export function ServiceManager({ services, plnPerCredit, usdToPln }: {
  services: ServiceRow[]; plnPerCredit: number; usdToPln: number;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<ServiceRow | null>(null);
  const [plansText, setPlansText] = useState("");

  const blank: ServiceRow = {
    slug: "", name: "", category: "general", service_type: "image", unit: "generation",
    credits_cost: 1, api_cost_usd_micros: 0, sale_value_cents: 0, min_margin_percent: 0,
    markup_percent: null, plan_slugs: null, enabled: true, featured: false,
    maintenance_mode: false, sort_order: services.length,
  };
  const open = (s: ServiceRow) => { setEditing(s); setPlansText((s.plan_slugs ?? []).join(", ")); };

  function save() {
    if (!editing) return;
    start(async () => {
      const plans = plansText.split(",").map((s) => s.trim()).filter(Boolean);
      const res = await saveServiceAction({ ...editing, plan_slugs: plans.length ? plans : null });
      if (res.ok) { toast.success(t("common.save")); setEditing(null); router.refresh(); }
      else toast.error(t("common.error"));
    });
  }

  const economics = (s: ServiceRow) => {
    const userPln = s.credits_cost * plnPerCredit;
    const costPln = (s.api_cost_usd_micros / 1e6) * usdToPln;
    const margin = userPln - costPln;
    const pct = userPln > 0 ? (margin / userPln) * 100 : 0;
    return { userPln, costPln, margin, pct };
  };

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={() => open(blank)}>+ {t("svc.new")}</Button>
      </div>
      <ul className="space-y-2">
        {services.map((s) => {
          const e = economics(s);
          return (
            <li key={s.slug}>
              <button type="button" onClick={() => open(s)}
                className="panel panel-interactive w-full rounded-2xl p-4 text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{s.name}</p>
                  <code className="rounded bg-raised px-1.5 py-0.5 text-[10px] text-faint">{s.slug}</code>
                  <Badge tone="neutral">{s.service_type}</Badge>
                  {!s.enabled && <Badge tone="amber">{t("admin.inactive")}</Badge>}
                  {s.maintenance_mode && <Badge tone="red">{t("svc.maintenance")}</Badge>}
                  {s.featured && <Badge tone="amber">★</Badge>}
                  <span className="ml-auto text-right text-xs text-muted">
                    <span className="font-display text-sm font-semibold text-accent">{s.credits_cost}</span> {t("nav.credits").toLowerCase()}
                    {" · "}≈{e.userPln.toFixed(2)} PLN
                    {" · "}{t("admin.internalCost")}: {e.costPln.toFixed(2)} PLN
                    {" · "}
                    <span className={e.pct >= s.min_margin_percent ? "text-accent" : "text-red-500"}>
                      {t("admin.margin")}: {e.pct.toFixed(0)}%
                    </span>
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? t("common.edit") : t("svc.new")} wide>
        {editing && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>Slug</Label>
                <Input value={editing.slug} disabled={!!editing.id}
                  onChange={(e) => setEditing({ ...editing, slug: e.target.value })} />
              </div>
              <div>
                <Label>{t("common.name")}</Label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div>
                <Label>{t("common.type")}</Label>
                <Select value={editing.service_type} onChange={(e) => setEditing({ ...editing, service_type: e.target.value })}>
                  {TYPES.map((x) => <option key={x}>{x}</option>)}
                </Select>
              </div>
              <div>
                <Label>{t("common.category")}</Label>
                <Input value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} />
              </div>
              <div>
                <Label>{t("svc.unit")}</Label>
                <Input value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })} />
              </div>
              <div>
                <Label>{t("admin.order")}</Label>
                <Input type="number" value={editing.sort_order}
                  onChange={(e) => setEditing({ ...editing, sort_order: parseInt(e.target.value || "0", 10) })} />
              </div>
              <div>
                <Label>{t("admin.userCost")}</Label>
                <Input type="number" min={0} value={editing.credits_cost}
                  onChange={(e) => setEditing({ ...editing, credits_cost: parseInt(e.target.value || "0", 10) })} />
              </div>
              <div>
                <Label>{t("svc.apiCost")} (USD)</Label>
                <Input type="number" min={0} step="0.0001" value={editing.api_cost_usd_micros / 1e6}
                  onChange={(e) => setEditing({ ...editing, api_cost_usd_micros: Math.round(parseFloat(e.target.value || "0") * 1e6) })} />
              </div>
              <div>
                <Label>{t("svc.saleValue")} (PLN)</Label>
                <Input type="number" min={0} step="0.01" value={editing.sale_value_cents / 100}
                  onChange={(e) => setEditing({ ...editing, sale_value_cents: Math.round(parseFloat(e.target.value || "0") * 100) })} />
              </div>
              <div>
                <Label>{t("svc.minMargin")} (%)</Label>
                <Input type="number" value={editing.min_margin_percent}
                  onChange={(e) => setEditing({ ...editing, min_margin_percent: parseFloat(e.target.value || "0") })} />
              </div>
              <div>
                <Label>{t("svc.markup")} (%)</Label>
                <Input type="number" value={editing.markup_percent ?? ""}
                  onChange={(e) => setEditing({ ...editing, markup_percent: e.target.value === "" ? null : parseFloat(e.target.value) })} />
              </div>
              <div>
                <Label>{t("svc.plans")}</Label>
                <Input value={plansText} placeholder="free, pro" onChange={(e) => setPlansText(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-5">
              {([["enabled", t("admin.active")], ["featured", t("admin.featured")], ["maintenance_mode", t("svc.maintenance")]] as const).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editing[k]} className="h-4 w-4 accent-[rgb(var(--accent))]"
                    onChange={(e) => setEditing({ ...editing, [k]: e.target.checked })} />
                  {label}
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
              <Button disabled={pending || !editing.name.trim() || !editing.slug.trim()} onClick={save}>{t("common.save")}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
