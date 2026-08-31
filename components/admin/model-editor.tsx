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
import { cn } from "@/lib/utils";

export type ModelView = {
  id: string; name: string; model_identifier: string; type: string; active: boolean;
  credit_cost: number; internal_cost_usd_micros: number; quality_tier: string;
  speed_tier: string; max_reference_images: number; supports_reference_images: boolean;
  description: string | null; providerName: string;
  display_name: string | null; badge: string | null; sort_order: number;
  pricing: Record<string, number>; supported_resolutions: string[];
  ecom_surcharge_credits: number;
  supported_aspect_ratios: string[];
  badge_tone: string | null;
  max_outputs: number | null;
  visible_managed: boolean;
  visible_custom: boolean;
  /** Why this model is switched off, for staff eyes only. */
  unavailableReason: string | null; unavailableNote: string | null;
};

const RES_TIERS = ["1K", "2K", "4K"] as const;
const RATIO_CHOICES = ["1:1", "3:4", "4:5", "16:9", "9:16"] as const;
/** Curated badges shown to customers; the DB column stays free text so a
 *  custom label typed by the admin is stored verbatim. */
const BADGE_KEYS = ["recommended", "high_quality", "best_value", "fast", "new", "premium", "experimental"] as const;
const TONE_KEYS = ["neutral", "green", "amber", "blue", "info", "indigo", "success"] as const;

export function ModelRow({ m, usdToPln, plnPerCredit, locale }: {
  m: ModelView; usdToPln: number; plnPerCredit: number; locale: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const knownBadge = !m.badge || (BADGE_KEYS as readonly string[]).includes(m.badge);
  const [form, setForm] = useState({
    name: m.name,
    display_name: m.display_name ?? m.name,
    model_identifier: m.model_identifier,
    badge: knownBadge ? (m.badge ?? "") : "__custom",
    badge_custom: knownBadge ? "" : (m.badge ?? ""),
    badge_tone: m.badge_tone ?? "",
    ratios: m.supported_aspect_ratios.length > 0 ? m.supported_aspect_ratios : ["1:1"],
    max_outputs: m.max_outputs != null ? String(m.max_outputs) : "",
    visible_managed: m.visible_managed,
    visible_custom: m.visible_custom,
    supports_refs: m.supports_reference_images,
    sort_order: String(m.sort_order),
    credit_cost: String(m.credit_cost),
    internal_usd: String(m.internal_cost_usd_micros / 1_000_000),
    quality_tier: m.quality_tier,
    speed_tier: m.speed_tier,
    max_refs: String(m.max_reference_images),
    description: m.description ?? "",
    active: m.active,
    ecom_surcharge: String(m.ecom_surcharge_credits),
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
      const badge = form.badge === "__custom" ? form.badge_custom.trim() : form.badge.trim();
      const res = await updateModelFullAction(m.id, {
        name: form.name.trim(),
        display_name: form.display_name.trim() || form.name.trim(),
        model_identifier: form.model_identifier.trim(),
        badge: badge || null,
        badge_tone: form.badge_tone || null,
        supported_aspect_ratios: form.ratios,
        max_outputs: form.max_outputs.trim() === "" ? null : parseInt(form.max_outputs, 10),
        visible_managed: form.visible_managed,
        visible_custom: form.visible_custom,
        supports_reference_images: form.supports_refs,
        sort_order: parseInt(form.sort_order || "100", 10),
        credit_cost: parseInt(form.credit_cost || "0", 10),
        internal_cost_usd_micros: Math.round(parseFloat(form.internal_usd || "0") * 1_000_000),
        quality_tier: form.quality_tier,
        speed_tier: form.speed_tier,
        max_reference_images: parseInt(form.max_refs || "0", 10),
        ecom_surcharge_credits: parseInt(form.ecom_surcharge || "0", 10),
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
        className="panel panel-interactive flex w-full flex-wrap items-center gap-3 rounded-2xl px-5 py-4 text-left">
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
          <p className="text-sm font-semibold tabular-nums text-accent">{m.credit_cost} kr</p>
          <p className="text-xs tabular-nums text-faint">
            {t("admin.ecomPriceShort", { n: m.credit_cost + m.ecom_surcharge_credits })} · ≈ {fmtPln((m.credit_cost + m.ecom_surcharge_credits) * plnPerCredit)}
          </p>
        </div>
        <div className="hidden text-right md:block">
          <p className="text-xs tabular-nums text-muted">{t("admin.internalCost")}: {fmtPln(costPln)}</p>
          <p className="text-xs tabular-nums text-muted">
            {t("admin.margin")}: <span className={cn("font-medium", marginPct >= 30 ? "text-ink" : "text-accent2")}>
              {fmtPln(marginPln)} / {marginPct}%
            </span>
          </p>
        </div>
        {m.active
          ? <Badge tone="green">{t("admin.active")}</Badge>
          : (
            <Badge tone={m.unavailableReason ? "red" : "amber"}>
              {m.unavailableReason
                ? t(`admin.unavailable.${m.unavailableReason}`, {}) || t("admin.inactive")
                : t("admin.inactive")}
            </Badge>
          )}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={m.display_name ?? m.name} wide>
        {m.unavailableNote && (
          <p className="mb-4 rounded-xl bg-accent2-soft px-4 py-3 text-xs text-accent2">{m.unavailableNote}</p>
        )}
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
                {BADGE_KEYS.map((k) => <option key={k} value={k}>{t(`models.badge.${k}`)}</option>)}
                <option value="__custom">{t("admin.badgeCustom")}</option>
              </Select>
              {form.badge === "__custom" && (
                <Input className="mt-2" value={form.badge_custom} placeholder={t("admin.badgeLabel")}
                  onChange={(e) => setForm({ ...form, badge_custom: e.target.value })} />
              )}
            </div>
            <div>
              <Label>{t("admin.badgeTone")}</Label>
              <Select value={form.badge_tone} onChange={(e) => setForm({ ...form, badge_tone: e.target.value })}>
                <option value="">{t("admin.toneAuto")}</option>
                {TONE_KEYS.map((k) => <option key={k} value={k}>{t(`admin.tone.${k}`)}</option>)}
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("admin.sortOrder")}</Label>
              <Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} />
            </div>
            <div>
              <Label>{t("admin.maxOutputs")}</Label>
              <Input type="number" min={1} max={4} placeholder="—" value={form.max_outputs}
                onChange={(e) => setForm({ ...form, max_outputs: e.target.value })} />
            </div>
          </div>
          <div className="sm:col-span-2">
            <Label>{t("admin.ratios")}</Label>
            <div className="flex flex-wrap gap-2">
              {RATIO_CHOICES.map((r) => {
                const on = form.ratios.includes(r);
                const last = on && form.ratios.length === 1;
                return (
                  <button key={r} type="button" aria-pressed={on} disabled={last}
                    onClick={() => setForm({
                      ...form,
                      ratios: on ? form.ratios.filter((x) => x !== r) : [...RATIO_CHOICES.filter((x) => form.ratios.includes(x) || x === r)],
                    })}
                    className={cn("rounded-lg border px-3 py-1.5 text-xs font-bold tabular-nums transition-colors",
                      on ? "border-[rgb(var(--accent)/0.5)] bg-accent-soft/40 text-accent" : "border-line text-muted hover:bg-raised",
                      last && "cursor-default opacity-70")}>
                    {r}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-faint">{t("admin.ratiosHint")}</p>
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.visible_managed}
                onChange={(e) => setForm({ ...form, visible_managed: e.target.checked })}
                className="h-4 w-4 accent-[rgb(var(--accent))]" />
              {t("admin.visibleManaged")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.visible_custom}
                onChange={(e) => setForm({ ...form, visible_custom: e.target.checked })}
                className="h-4 w-4 accent-[rgb(var(--accent))]" />
              {t("admin.visibleCustom")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.supports_refs}
                onChange={(e) => setForm({ ...form, supports_refs: e.target.checked })}
                className="h-4 w-4 accent-[rgb(var(--accent))]" />
              {t("admin.supportsRefs")}
            </label>
            <p className="text-xs text-faint">{t("admin.supportsRefsHint")}</p>
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
            <Label>{t("admin.ecomSurcharge")}</Label>
            <Input type="number" min={0} value={form.ecom_surcharge}
              onChange={(e) => setForm({ ...form, ecom_surcharge: e.target.value })} />
            <p className="mt-1 text-[11px] text-faint">
              {t("admin.ecomSurchargeHint", {
                total: parseInt(form.credit_cost || "0", 10) + parseInt(form.ecom_surcharge || "0", 10),
                pln: fmtPln((parseInt(form.credit_cost || "0", 10) + parseInt(form.ecom_surcharge || "0", 10)) * plnPerCredit),
              })}
            </p>
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
        <div className="mt-4 rounded-xl bg-raised px-4 py-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">{t("admin.perGeneration")}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-5">
            <Econ label={t("admin.apiCostCfg")} value={`$${(parseFloat(form.internal_usd || "0")).toFixed(4)}`} />
            <Econ label={t("admin.userCost")} value={`${parseInt(form.credit_cost || "0", 10)} kr`} />
            <Econ label={t("econ.revenue")} value={fmtPln(parseInt(form.credit_cost || "0", 10) * plnPerCredit)} />
            <Econ label={t("econ.apiCost")} value={fmtPln(parseFloat(form.internal_usd || "0") * usdToPln)} tone="warm" />
            <Econ
              label={t("econ.margin")}
              value={(() => {
                const rev = parseInt(form.credit_cost || "0", 10) * plnPerCredit;
                const cost = parseFloat(form.internal_usd || "0") * usdToPln;
                return rev > 0 ? `${fmtPln(rev - cost)} / ${Math.round(((rev - cost) / rev) * 1000) / 10}%` : "—";
              })()}
              tone="good"
            />
          </div>
          <p className="mt-2 text-[11px] text-faint">{t("admin.snapshotNote")}</p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
          <Button disabled={pending} onClick={save}>{t("common.save")}</Button>
        </div>
      </Modal>
    </>
  );
}

function Econ({ label, value, tone }: { label: string; value: string; tone?: "warm" | "good" }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
      <p className={cn("font-display text-sm font-semibold tabular-nums",
        tone === "warm" && "text-accent2", tone === "good" && "text-accent")}>{value}</p>
    </div>
  );
}
