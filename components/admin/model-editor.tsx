"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/provider";
import { updateModelFullAction } from "@/app/actions/admin";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export type ModelView = {
  id: string; name: string; model_identifier: string; type: string; active: boolean;
  credit_cost: number; internal_cost_usd_micros: number; quality_tier: string;
  speed_tier: string; max_reference_images: number; supports_reference_images: boolean;
  description: string | null; providerName: string;
  display_name: string | null; badge: string | null; sort_order: number;
  pricing: Record<string, number>; supported_resolutions: string[];
};

const RES_TIERS = ["1K", "2K", "4K"] as const;

export function ModelRow({ m, usdToPln, plnPerCredit, locale }: {
  m: ModelView; usdToPln: number; plnPerCredit: number; locale: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: m.name,
    display_name: m.display_name ?? m.name,
    model_identifier: m.model_identifier,
    badge: m.badge ?? "",
    sort_order: String(m.sort_order),
    credit_cost: String(m.credit_cost),
    internal_usd: String(m.internal_cost_usd_micros / 1_000_000),
    quality_tier: m.quality_tier,
    speed_tier: m.speed_tier,
    max_refs: String(m.max_reference_images),
    description: m.description ?? "",
    active: m.active,
    pricing: Object.fromEntries(RES_TIERS.map((r) => [r, m.pricing[r] != null ? String(m.pricing[r]) : ""])),
  });

  const fmtPln = (v: number) =>
    new Intl.NumberFormat(locale === "pl" ? "pl-PL" : "en-GB", { style: "currency", currency: "PLN" }).format(v);
  const userPln = m.credit_cost * plnPerCredit;
  const costPln = (m.internal_cost_usd_micros / 1_000_000) * usdToPln;
  const marginPln = userPln - costPln;
  const marginPct = userPln > 0 ? Math.round((marginPln / userPln) * 100) : 0;

  function save() {
    start(async () => {
      const pricing: Record<string, number> = {};
      const resolutions: string[] = [];
      for (const r of RES_TIERS) {
        const v = form.pricing[r]?.trim();
        if (v !== "" && v != null && Number.isFinite(parseInt(v, 10))) {
          pricing[r] = parseInt(v, 10);
          resolutions.push(r);
        }
      }
      const res = await updateModelFullAction(m.id, {
        name: form.name.trim(),
        display_name: form.display_name.trim() || form.name.trim(),
        model_identifier: form.model_identifier.trim(),
        badge: form.badge.trim() || null,
        sort_order: parseInt(form.sort_order || "100", 10),
        credit_cost: parseInt(form.credit_cost || "0", 10),
        internal_cost_usd_micros: Math.round(parseFloat(form.internal_usd || "0") * 1_000_000),
        quality_tier: form.quality_tier,
        speed_tier: form.speed_tier,
        max_reference_images: parseInt(form.max_refs || "0", 10),
        description: form.description.trim() || null,
        active: form.active,
        ...(resolutions.length > 0 ? { pricing, supported_resolutions: resolutions } : {}),
      });
      if (res.ok) { toast.success(t("common.save")); setOpen(false); router.refresh(); }
      else toast.error(t("common.error"));
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="glass flex w-full flex-wrap items-center gap-3 rounded-2xl px-5 py-4 text-left transition-transform duration-150 hover:-translate-y-0.5">
        <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-lg bg-raised font-display text-sm font-bold text-accent">
          {m.providerName.charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{m.display_name ?? m.name}</p>
          <p className="truncate text-xs text-faint">
            {m.providerName} · <code>{m.model_identifier}</code> · {m.type}
            {m.supported_resolutions.length > 0 && <> · {m.supported_resolutions.map((r) => `${r}:${m.pricing[r] ?? m.credit_cost}kr`).join(" ")}</>}
          </p>
        </div>
        <div className="hidden text-right sm:block">
          <p className="text-sm font-semibold text-accent">{m.credit_cost} kr</p>
          <p className="text-xs text-faint">≈ {fmtPln(userPln)}</p>
        </div>
        <div className="hidden text-right md:block">
          <p className="text-xs text-muted">{t("admin.internalCost")}: {fmtPln(costPln)}</p>
          <p className="text-xs text-muted">{t("admin.margin")}: <span className="font-medium text-ink">{fmtPln(marginPln)} / {marginPct}%</span></p>
        </div>
        <Badge tone={m.active ? "green" : "amber"}>{m.active ? t("admin.active") : t("admin.inactive")}</Badge>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={m.name} wide>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>{t("common.name")}</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label>{t("admin.displayName")}</Label>
            <Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          </div>
          <div>
            <Label>{t("admin.modelKey")}</Label>
            <Input value={form.model_identifier} className="font-mono"
              onChange={(e) => setForm({ ...form, model_identifier: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("admin.badge")}</Label>
              <Select value={form.badge} onChange={(e) => setForm({ ...form, badge: e.target.value })}>
                <option value="">—</option>
                <option value="recommended">recommended</option>
                <option value="high_quality">high_quality</option>
              </Select>
            </div>
            <div>
              <Label>{t("admin.sortOrder")}</Label>
              <Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} />
            </div>
          </div>
          <div className="sm:col-span-2">
            <Label>{t("admin.pricingPerRes")}</Label>
            <div className="grid grid-cols-3 gap-3">
              {RES_TIERS.map((r) => (
                <div key={r} className="flex items-center gap-2">
                  <span className="w-7 text-xs font-semibold text-muted">{r}</span>
                  <Input type="number" min={0} placeholder="—" value={form.pricing[r]}
                    onChange={(e) => setForm({ ...form, pricing: { ...form.pricing, [r]: e.target.value } })} />
                </div>
              ))}
            </div>
            <p className="mt-1 text-xs text-faint">{t("admin.pricingPerResHint")}</p>
          </div>
          <div>
            <Label>{t("admin.userCost")}</Label>
            <Input type="number" min={0} value={form.credit_cost} onChange={(e) => setForm({ ...form, credit_cost: e.target.value })} />
          </div>
          <div>
            <Label>{t("admin.internalCost")} (USD)</Label>
            <Input type="number" min={0} step="0.001" value={form.internal_usd} onChange={(e) => setForm({ ...form, internal_usd: e.target.value })} />
          </div>
          <div>
            <Label>{t("admin.qualityTier")}</Label>
            <Select value={form.quality_tier} onChange={(e) => setForm({ ...form, quality_tier: e.target.value })}>
              {["standard", "high", "premium"].map((v) => <option key={v}>{v}</option>)}
            </Select>
          </div>
          <div>
            <Label>{t("admin.speedTier")}</Label>
            <Select value={form.speed_tier} onChange={(e) => setForm({ ...form, speed_tier: e.target.value })}>
              {["fast", "standard", "slow"].map((v) => <option key={v}>{v}</option>)}
            </Select>
          </div>
          <div>
            <Label>{t("admin.maxRefs")}</Label>
            <Input type="number" min={0} max={16} value={form.max_refs} onChange={(e) => setForm({ ...form, max_refs: e.target.value })} />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input id={`mact-${m.id}`} type="checkbox" checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
              className="h-4 w-4 accent-[rgb(var(--accent))]" />
            <label htmlFor={`mact-${m.id}`} className="text-sm">{t("admin.active")}</label>
          </div>
          <div className="sm:col-span-2">
            <Label>{t("common.description")}</Label>
            <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
        </div>
        <div className="mt-4 rounded-xl bg-raised px-4 py-3 text-xs text-muted">
          {t("admin.marginPreview", {
            user: fmtPln(parseInt(form.credit_cost || "0", 10) * plnPerCredit),
            cost: fmtPln(parseFloat(form.internal_usd || "0") * usdToPln),
          })}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
          <Button disabled={pending} onClick={save}>{t("common.save")}</Button>
        </div>
      </Modal>
    </>
  );
}
