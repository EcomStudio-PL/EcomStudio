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
};

export function ModelRow({ m, usdToPln, plnPerCredit, locale }: {
  m: ModelView; usdToPln: number; plnPerCredit: number; locale: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: m.name,
    credit_cost: String(m.credit_cost),
    internal_usd: String(m.internal_cost_usd_micros / 1_000_000),
    quality_tier: m.quality_tier,
    speed_tier: m.speed_tier,
    max_refs: String(m.max_reference_images),
    description: m.description ?? "",
    active: m.active,
  });

  const fmtPln = (v: number) =>
    new Intl.NumberFormat(locale === "pl" ? "pl-PL" : "en-GB", { style: "currency", currency: "PLN" }).format(v);
  const userPln = m.credit_cost * plnPerCredit;
  const costPln = (m.internal_cost_usd_micros / 1_000_000) * usdToPln;
  const marginPln = userPln - costPln;
  const marginPct = userPln > 0 ? Math.round((marginPln / userPln) * 100) : 0;

  function save() {
    start(async () => {
      const res = await updateModelFullAction(m.id, {
        name: form.name.trim(),
        credit_cost: parseInt(form.credit_cost || "0", 10),
        internal_cost_usd_micros: Math.round(parseFloat(form.internal_usd || "0") * 1_000_000),
        quality_tier: form.quality_tier,
        speed_tier: form.speed_tier,
        max_reference_images: parseInt(form.max_refs || "0", 10),
        description: form.description.trim() || null,
        active: form.active,
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
          <p className="truncate text-sm font-semibold">{m.name}</p>
          <p className="truncate text-xs text-faint">{m.providerName} · <code>{m.model_identifier}</code> · {m.type}</p>
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
          <div className="sm:col-span-2">
            <Label>{t("common.name")}</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
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
