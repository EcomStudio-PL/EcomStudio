"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/provider";
import { savePlanFullAction } from "@/app/actions/admin";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export type PlanRow = {
  id?: string; slug?: string; name: string; price_cents: number; annual_price_cents: number;
  monthly_credits: number; bonus_credits: number; description: string | null;
  features: unknown; featured: boolean; active: boolean; sort_order: number; limits: unknown;
  currency?: string;
};

type Limits = { max_products?: number; max_generations_monthly?: number };

function featuresToText(f: unknown): string {
  return Array.isArray(f) ? f.filter((x) => typeof x === "string").join("\n") : "";
}

export function PlanManager({ plans }: { plans: PlanRow[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [featuresText, setFeaturesText] = useState("");

  const blank: PlanRow = {
    name: "", price_cents: 0, annual_price_cents: 0, monthly_credits: 0, bonus_credits: 0,
    description: null, features: [], featured: false, active: true, sort_order: plans.length, limits: {},
  };
  const open = (p: PlanRow) => { setEditing(p); setFeaturesText(featuresToText(p.features)); };
  const limits: Limits = (editing?.limits ?? {}) as Limits;

  function save() {
    if (!editing) return;
    start(async () => {
      const res = await savePlanFullAction({
        id: editing.id,
        name: editing.name,
        price_cents: editing.price_cents,
        annual_price_cents: editing.annual_price_cents,
        monthly_credits: editing.monthly_credits,
        bonus_credits: editing.bonus_credits,
        description: editing.description,
        features: featuresText.split("\n").map((s) => s.trim()).filter(Boolean),
        featured: editing.featured,
        active: editing.active,
        sort_order: editing.sort_order,
        limits,
      });
      if (res.ok) { toast.success(t("common.save")); setEditing(null); router.refresh(); }
      else toast.error(t("common.error"));
    });
  }

  const num = (v: string) => parseInt(v || "0", 10) || 0;

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={() => open(blank)}>+ {t("admin.newPlan")}</Button>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => open(p)}
              className="glass w-full rounded-2xl p-4 text-left transition-transform duration-150 hover:-translate-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold">{p.name}</p>
                {!p.active ? <Badge tone="amber">{t("admin.inactive")}</Badge>
                  : p.featured ? <Badge tone="indigo">★ {t("admin.featured")}</Badge> : null}
              </div>
              <p className="mt-2 font-display text-xl font-semibold text-accent">
                {(p.price_cents / 100).toFixed(2)} <span className="text-sm">{p.currency ?? "PLN"}</span>
              </p>
              <p className="text-xs text-muted">
                {p.monthly_credits} {t("nav.credits").toLowerCase()}/mies.
                {p.bonus_credits > 0 && <span className="text-accent2"> +{p.bonus_credits}</span>}
              </p>
              {p.slug && <code className="mt-2 inline-block rounded bg-raised px-1.5 py-0.5 text-[10px] text-faint">{p.slug}</code>}
            </button>
          </li>
        ))}
      </ul>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? t("common.edit") : t("admin.newPlan")} wide>
        {editing && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>{t("common.name")}</Label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div>
                <Label>{t("admin.order")}</Label>
                <Input type="number" value={editing.sort_order}
                  onChange={(e) => setEditing({ ...editing, sort_order: num(e.target.value) })} />
              </div>
              <div>
                <Label>{t("admin.priceCol")} (PLN / mies.)</Label>
                <Input type="number" min={0} step="0.01" value={editing.price_cents / 100}
                  onChange={(e) => setEditing({ ...editing, price_cents: Math.round(parseFloat(e.target.value || "0") * 100) })} />
              </div>
              <div>
                <Label>{t("admin.annualPrice")} (PLN / rok)</Label>
                <Input type="number" min={0} step="0.01" value={editing.annual_price_cents / 100}
                  onChange={(e) => setEditing({ ...editing, annual_price_cents: Math.round(parseFloat(e.target.value || "0") * 100) })} />
              </div>
              <div>
                <Label>{t("nav.credits")} / mies.</Label>
                <Input type="number" min={0} value={editing.monthly_credits}
                  onChange={(e) => setEditing({ ...editing, monthly_credits: num(e.target.value) })} />
              </div>
              <div>
                <Label>{t("admin.bonusCredits")}</Label>
                <Input type="number" min={0} value={editing.bonus_credits}
                  onChange={(e) => setEditing({ ...editing, bonus_credits: num(e.target.value) })} />
              </div>
              <div>
                <Label>{t("admin.limitProducts")}</Label>
                <Input type="number" min={0} value={limits.max_products ?? 0}
                  onChange={(e) => setEditing({ ...editing, limits: { ...limits, max_products: num(e.target.value) } })} />
              </div>
              <div>
                <Label>{t("admin.limitGenerations")}</Label>
                <Input type="number" min={0} value={limits.max_generations_monthly ?? 0}
                  onChange={(e) => setEditing({ ...editing, limits: { ...limits, max_generations_monthly: num(e.target.value) } })} />
              </div>
            </div>
            <div>
              <Label>{t("common.description")}</Label>
              <Textarea rows={2} value={editing.description ?? ""}
                onChange={(e) => setEditing({ ...editing, description: e.target.value || null })} />
            </div>
            <div>
              <Label>{t("admin.featuresLabel")}</Label>
              <Textarea rows={4} value={featuresText} onChange={(e) => setFeaturesText(e.target.value)} />
              <p className="mt-1 text-xs text-muted">{t("admin.featuresHint")}</p>
            </div>
            <div className="flex items-center gap-5">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editing.active} className="h-4 w-4 accent-[rgb(var(--accent))]"
                  onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
                {t("admin.active")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editing.featured} className="h-4 w-4 accent-[rgb(var(--accent2))]"
                  onChange={(e) => setEditing({ ...editing, featured: e.target.checked })} />
                {t("admin.recommended")}
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
              <Button disabled={pending || !editing.name.trim()} onClick={save}>{t("common.save")}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
