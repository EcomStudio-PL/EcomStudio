"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
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
  /** Official provider price of ONE output image per size (USD micros), from
   *  the unit price list (Koszty → Ceny jednostkowe); "flat" = no row for the
   *  size, the model's flat per-image cost stands in; null = nothing known. */
  officialCost: Record<string, { usdMicros: number | null; source: "unit" | "flat" }>;
  /** Token rates that price the input/thinking usage a response reports
   *  (USD per 1M); null = none set, reported tokens stay unpriced. */
  tokenRates: { inputUsdPerM: number; outputUsdPerM: number } | null;
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
const TONE_KEYS = ["neutral", "success", "accent", "info", "danger"] as const;

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
    pricing: Object.fromEntries(RES_TIERS.map((r) => [r, m.pricing[r] != null ? String(m.pricing[r]) : ""])),
  });

  const fmtPln = (v: number) =>
    new Intl.NumberFormat(locale === "pl" ? "pl-PL" : "en-GB", { style: "currency", currency: "PLN" }).format(v);
  const fmtUsd = (micros: number) => `$${(micros / 1_000_000).toFixed(micros % 10_000 === 0 ? 2 : 3)}`;
  // The row quotes the model's DEFAULT size: its customer price against the
  // official provider price for that size. Revenue = credits × the credit's
  // list price; cost = USD × the analytics FX rate. Margin = revenue − cost.
  const rowRes = m.supported_resolutions[0] ?? "1K";
  const rowCredits = m.pricing[rowRes] ?? m.credit_cost;
  const rowCost = m.officialCost[rowRes]?.usdMicros ?? null;
  const userPln = rowCredits * plnPerCredit;
  const costPln = rowCost == null ? null : (rowCost / 1_000_000) * usdToPln;
  const marginPln = costPln == null ? null : userPln - costPln;
  const marginPct = marginPln == null || userPln <= 0 ? null : Math.round((marginPln / userPln) * 100);

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
          <p className="text-sm font-semibold tabular-nums text-accent">{rowRes} · {rowCredits} kr</p>
          <p className="text-xs tabular-nums text-faint">≈ {fmtPln(userPln)}</p>
        </div>
        <div className="hidden text-right md:block">
          <p className="text-xs tabular-nums text-muted">
            {t("admin.internalCost")}: {rowCost == null ? "—" : `${fmtUsd(rowCost)} ≈ ${fmtPln(costPln ?? 0)}`}
          </p>
          <p className="text-xs tabular-nums text-muted">
            {t("admin.margin")}: {marginPln == null ? "—" : (
              <span className={cn("font-medium", (marginPct ?? 0) >= 30 ? "text-ink" : "text-accent2")}>
                {fmtPln(marginPln)}{marginPct != null ? ` / ${marginPct}%` : ""}
              </span>
            )}
          </p>
        </div>
        {m.active
          ? <Badge tone="success">{t("admin.active")}</Badge>
          : (
            <Badge tone={m.unavailableReason ? "danger" : "accent"}>
              {m.unavailableReason
                ? t(`admin.unavailable.${m.unavailableReason}`, {}) || t("admin.inactive")
                : t("admin.inactive")}
            </Badge>
          )}
      </button>

      <Modal portal open={open} onClose={() => setOpen(false)} title={m.display_name ?? m.name} wide>
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
            <Label>{t("admin.flatApiCost")}</Label>
            <Input type="number" min={0} step="0.001" value={form.internal_usd} onChange={(e) => setForm({ ...form, internal_usd: e.target.value })} />
            <p className="mt-1 text-[11px] text-faint">{t("admin.flatApiCostHint")}</p>
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
        <QualityEconomics
          rows={RES_TIERS.filter((r) => (form.pricing[r] ?? "").trim() !== "").map((r) => {
            const official = m.officialCost[r];
            // A size with no official row is costed at the flat price being
            // edited here, exactly as the recorder will cost it.
            const flat = Math.round(parseFloat(form.internal_usd || "0") * 1_000_000);
            const usdMicros = official?.source === "unit" ? official.usdMicros : flat > 0 ? flat : null;
            return { res: r, credits: parseInt(form.pricing[r] || "0", 10), usdMicros, source: official?.source === "unit" ? "unit" : "flat" };
          })}
          tokenRates={m.tokenRates} usdToPln={usdToPln} plnPerCredit={plnPerCredit} fmtPln={fmtPln} />
        <p className="mt-2 text-[11px] text-faint">{t("admin.snapshotNote")}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
          <Button disabled={pending} onClick={save}>{t("common.save")}</Button>
        </div>
      </Modal>
    </>
  );
}

/**
 * ONE IMAGE, PER QUALITY: the official provider price, the customer's credits,
 * the revenue those credits are worth at the credit's list price, and the
 * margin between them. Nothing is added on top of the model price — there is
 * no "GrovBase surcharge" any more. The USD→PLN rate converts the cost for
 * this analysis only; it never sets a customer price.
 */
function QualityEconomics({ rows, tokenRates, usdToPln, plnPerCredit, fmtPln }: {
  rows: { res: string; credits: number; usdMicros: number | null; source: "unit" | "flat" }[];
  tokenRates: { inputUsdPerM: number; outputUsdPerM: number } | null;
  usdToPln: number; plnPerCredit: number; fmtPln: (v: number) => string;
}) {
  const { t } = useI18n();
  if (rows.length === 0) return null;
  return (
    <div className="mt-4 rounded-xl bg-raised px-4 py-3" data-quality-economics>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">{t("admin.costTable.title")}</p>
      <div className="table-scroll thin-scroll -mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[560px] text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
              <th className="py-1 pr-3 font-semibold">{t("admin.costTable.quality")}</th>
              <th className="py-1 pr-3 text-right font-semibold">{t("admin.costTable.apiUsd")}</th>
              <th className="py-1 pr-3 text-right font-semibold">{t("admin.costTable.apiPln")}</th>
              <th className="py-1 pr-3 text-right font-semibold">{t("admin.costTable.credits")}</th>
              <th className="py-1 pr-3 text-right font-semibold">{t("admin.costTable.revenue")}</th>
              <th className="py-1 pr-3 text-right font-semibold">{t("admin.costTable.margin")}</th>
              <th className="py-1 text-right font-semibold">{t("admin.costTable.marginPct")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const revenue = r.credits * plnPerCredit;
              const cost = r.usdMicros == null ? null : (r.usdMicros / 1_000_000) * usdToPln;
              const margin = cost == null ? null : revenue - cost;
              const pct = margin == null || revenue <= 0 ? null : Math.round((margin / revenue) * 1000) / 10;
              return (
                <tr key={r.res} className="border-t border-line/60 tabular-nums" data-quality={r.res}>
                  <td className="py-1.5 pr-3 font-semibold">{r.res}</td>
                  <td className="py-1.5 pr-3 text-right">
                    {r.usdMicros == null ? "—" : `$${(r.usdMicros / 1_000_000).toFixed(4)}`}
                    <span className="block text-[10px] text-faint">{t(`admin.costTable.source.${r.source}`)}</span>
                  </td>
                  <td className="py-1.5 pr-3 text-right text-accent2">{cost == null ? "—" : fmtPln(cost)}</td>
                  <td className="py-1.5 pr-3 text-right">{r.credits} kr</td>
                  <td className="py-1.5 pr-3 text-right">{fmtPln(revenue)}</td>
                  <td className={cn("py-1.5 pr-3 text-right font-semibold", margin != null && margin < 0 ? "text-danger" : "text-accent")}>
                    {margin == null ? "—" : fmtPln(margin)}
                  </td>
                  <td className="py-1.5 text-right">{pct == null ? "—" : `${pct}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        {tokenRates
          ? t("admin.costTable.tokens", { in: tokenRates.inputUsdPerM.toFixed(2), out: tokenRates.outputUsdPerM.toFixed(2) })
          : t("admin.costTable.noTokens")}
        {" "}{t("admin.costTable.fx", { fx: usdToPln.toFixed(2), credit: fmtPln(plnPerCredit) })}
      </p>
    </div>
  );
}
