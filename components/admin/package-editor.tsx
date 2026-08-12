"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/provider";
import { savePackageAction } from "@/app/actions/admin";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export type Pkg = {
  id?: string; name: string; credits: number; bonus_credits: number;
  price_cents: number; active: boolean; featured: boolean; sort_order: number; badge: string | null;
};

export function PackageManager({ packages }: { packages: Pkg[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<Pkg | null>(null);

  const blank: Pkg = { name: "", credits: 100, bonus_credits: 0, price_cents: 0, active: true, featured: false, sort_order: packages.length, badge: null };

  function save() {
    if (!editing) return;
    start(async () => {
      const res = await savePackageAction(editing);
      if (res.ok) { toast.success(t("common.save")); setEditing(null); router.refresh(); }
      else toast.error(t("common.error"));
    });
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={() => setEditing(blank)}>+ {t("admin.newPackage")}</Button>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {packages.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => setEditing(p)}
              className="glass w-full rounded-2xl p-4 text-left transition-transform duration-150 hover:-translate-y-0.5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{p.name}</p>
                {!p.active && <Badge tone="amber">{t("admin.inactive")}</Badge>}
                {p.active && p.featured && <Badge tone="green">★</Badge>}
              </div>
              <p className="mt-2 font-display text-xl font-semibold text-accent">
                {p.credits}{p.bonus_credits > 0 && <span className="text-sm"> +{p.bonus_credits}</span>}
              </p>
              <p className="text-xs text-faint">{(p.price_cents / 100).toFixed(2)} PLN</p>
            </button>
          </li>
        ))}
      </ul>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? t("common.edit") : t("admin.newPackage")}>
        {editing && (
          <div className="space-y-4">
            <div>
              <Label>{t("common.name")}</Label>
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("nav.credits")}</Label>
                <Input type="number" min={1} value={editing.credits}
                  onChange={(e) => setEditing({ ...editing, credits: parseInt(e.target.value || "0", 10) })} />
              </div>
              <div>
                <Label>{t("admin.bonusCredits")}</Label>
                <Input type="number" min={0} value={editing.bonus_credits}
                  onChange={(e) => setEditing({ ...editing, bonus_credits: parseInt(e.target.value || "0", 10) })} />
              </div>
              <div>
                <Label>{t("admin.priceCol")} (PLN)</Label>
                <Input type="number" min={0} step="0.01" value={editing.price_cents / 100}
                  onChange={(e) => setEditing({ ...editing, price_cents: Math.round(parseFloat(e.target.value || "0") * 100) })} />
              </div>
              <div>
                <Label>{t("admin.order")}</Label>
                <Input type="number" value={editing.sort_order}
                  onChange={(e) => setEditing({ ...editing, sort_order: parseInt(e.target.value || "0", 10) })} />
              </div>
            </div>
            <div>
              <Label>{t("admin.badgeLabel")}</Label>
              <Input value={editing.badge ?? ""} onChange={(e) => setEditing({ ...editing, badge: e.target.value || null })} />
            </div>
            <div className="flex items-center gap-5">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editing.active} className="h-4 w-4 accent-[rgb(var(--accent))]"
                  onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
                {t("admin.active")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editing.featured} className="h-4 w-4 accent-[rgb(var(--accent))]"
                  onChange={(e) => setEditing({ ...editing, featured: e.target.checked })} />
                {t("admin.featured")}
              </label>
            </div>
            <p className="rounded-xl bg-raised px-4 py-2.5 text-xs text-muted">
              {t("admin.packageTotal", { n: editing.credits + editing.bonus_credits })}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
              <Button disabled={pending || !editing.name.trim() || editing.credits <= 0} onClick={save}>
                {t("common.save")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
