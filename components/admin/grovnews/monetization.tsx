"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CirclePlus, Pencil, Power, PowerOff, Rocket, Square, Tag } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { toast } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/input";
import { ConfirmModal, Modal } from "@/components/ui/modal";
import { AdminTable } from "@/components/ui/admin-table";
import {
  activateLaunchCampaignAction, saveLaunchCampaignAction, setGrovNewsPriceAction, setGrovNewsSalesAction,
  setLaunchCampaignStatusAction,
} from "@/app/actions/grovnews-billing";
import {
  ACCESS_PRESETS, WINDOW_PRESETS, formatMoney, formatWarsawNumeric, isoToWarsawLocal, warsawLocalToIso,
  type AccessPreset, type WindowPreset,
} from "@/lib/grovnews-billing";
import type { AdminBilling, AdminCampaign, AdminPlanOption } from "@/lib/services/grovnews-billing";

const STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "danger" | "info"> = {
  DRAFT: "warning", ACTIVE: "success", ENDED: "neutral", DISABLED: "danger",
};

/**
 * GROVNEWS → MONETYZACJA. The price (a new Stripe Price per change, existing
 * subscribers untouched), sales on/off (off blocks NEW checkouts only), and the
 * launch campaign. Every button calls a server action that re-checks the admin
 * role; the database re-checks every rule.
 */
export function MonetizationManager({ billing, campaigns, plans }: {
  billing: AdminBilling | null; campaigns: AdminCampaign[]; plans: AdminPlanOption[];
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [priceOpen, setPriceOpen] = useState(false);
  const [price, setPrice] = useState(billing?.priceCents ? (billing.priceCents / 100).toFixed(2) : "");
  const [salesConfirm, setSalesConfirm] = useState<null | boolean>(null);
  const [editing, setEditing] = useState<AdminCampaign | "new" | null>(null);
  const [confirm, setConfirm] = useState<null | { id: string; action: "activate" | "ENDED" | "DISABLED" }>(null);

  const fail = (error?: string) => toast.error(t(
    error === "forbidden" ? "grovnewsAdm.errForbidden"
      : error === "invalid" ? "grovnewsAdm.errInvalid"
      : error && KNOWN_ERRORS.has(error) ? `grovnewsAdm.mon.err.${error}` : "common.error"));

  const savePrice = () => start(async () => {
    const res = await setGrovNewsPriceAction(price);
    if (!res.ok) { fail(res.error); return; }
    toast.success(t(res.changed ? "grovnewsAdm.mon.priceSaved" : "grovnewsAdm.mon.priceUnchanged"));
    setPriceOpen(false);
    router.refresh();
  });

  const setSales = (enabled: boolean) => start(async () => {
    const res = await setGrovNewsSalesAction(enabled);
    setSalesConfirm(null);
    if (!res.ok) { fail(res.error); return; }
    toast.success(t(enabled ? "grovnewsAdm.mon.salesOnDone" : "grovnewsAdm.mon.salesOffDone"));
    router.refresh();
  });

  const runConfirm = () => start(async () => {
    if (!confirm) return;
    const res = confirm.action === "activate"
      ? await activateLaunchCampaignAction(confirm.id)
      : await setLaunchCampaignStatusAction(confirm.id, confirm.action);
    setConfirm(null);
    if (!res.ok) { fail(res.error); return; }
    toast.success(t(confirm.action === "activate" ? "grovnewsAdm.mon.activated"
      : confirm.action === "ENDED" ? "grovnewsAdm.mon.ended" : "grovnewsAdm.mon.disabled"));
    router.refresh();
  });

  const synced = billing?.syncStatus === "synced" && billing.priceId !== null;
  const planName = new Map(plans.map((p) => [p.id, p.name]));

  return (
    <div className="space-y-6" data-grovnews-monetization>
      {/* ── PRICE & SALES ───────────────────────────────────────────────── */}
      <section className="panel rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-[15px] font-bold uppercase tracking-[0.06em] text-ink">{t("grovnewsAdm.mon.title")}</h2>
            <p className="mt-1 text-[12.5px] text-muted">{t("grovnewsAdm.mon.sub")}</p>
          </div>
          <Badge tone={billing?.salesEnabled ? "success" : "neutral"} dot>
            {billing?.salesEnabled ? t("grovnewsAdm.mon.salesOn") : t("grovnewsAdm.mon.salesOff")}
          </Badge>
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2.5 text-[13px] sm:grid-cols-2">
          <Row label={t("grovnewsAdm.mon.price")} value={billing?.priceCents != null
            ? `${formatMoney(billing.priceCents, billing.currency, locale)} ${t("grovnewsAdm.mon.perMonth")}` : "—"} />
          <Row label={t("grovnewsAdm.mon.currency")} value={billing?.currency ?? "PLN"} />
          <Row label={t("grovnewsAdm.mon.product")} value={
            <Badge tone={billing?.productId ? "success" : "neutral"}>
              {billing?.productId ? t("grovnewsAdm.mon.productSynced") : t("grovnewsAdm.mon.productNone")}
            </Badge>} />
          <Row label={t("grovnewsAdm.mon.activePrice")} value={
            <span className="flex flex-wrap items-center justify-end gap-1.5">
              <Badge tone={synced ? "success" : billing?.syncStatus === "failed" ? "danger" : "warning"}>
                {t(`grovnewsAdm.mon.sync.${billing?.syncStatus ?? "unsynced"}`)}
              </Badge>
              {billing?.priceId && <code className="break-all text-[11.5px] text-faint">{billing.priceId}</code>}
            </span>} />
          <Row label={t("grovnewsAdm.mon.lastChange")} value={formatWarsawNumeric(billing?.priceChangedAt ?? null, locale)} />
          {billing?.syncError && <Row label={t("grovnewsAdm.mon.syncError")} value={<span className="text-danger">{billing.syncError}</span>} />}
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => setPriceOpen(true)} disabled={pending}>
            <Tag size={15} aria-hidden />{t("grovnewsAdm.mon.changePrice")}
          </Button>
          {billing?.salesEnabled ? (
            <Button variant="ghost" onClick={() => setSalesConfirm(false)} disabled={pending}>
              <PowerOff size={15} aria-hidden />{t("grovnewsAdm.mon.salesDisable")}
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setSalesConfirm(true)} disabled={pending || !synced}>
              <Power size={15} aria-hidden />{t("grovnewsAdm.mon.salesEnable")}
            </Button>
          )}
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-faint">{t("grovnewsAdm.mon.priceNote")}</p>
        {billing && billing.history.length > 1 && (
          <details className="mt-3 text-[12.5px]">
            <summary className="cursor-pointer font-semibold text-muted">{t("grovnewsAdm.mon.history")}</summary>
            <ul className="mt-2 space-y-1 text-muted">
              {billing.history.map((h) => (
                <li key={h.priceId} className="flex flex-wrap justify-between gap-2">
                  <span className="tabular-nums">{formatMoney(h.amount, billing.currency, locale)}</span>
                  <span className="text-faint">{formatWarsawNumeric(h.createdAt, locale)} · {h.archivedAt ? t("grovnewsAdm.mon.archived") : t("grovnewsAdm.mon.current")}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* ── LAUNCH CAMPAIGN ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold">{t("grovnewsAdm.mon.launchTitle")}</h2>
            <p className="mt-0.5 text-[12.5px] text-muted">{t("grovnewsAdm.mon.launchSub")}</p>
          </div>
          <Button onClick={() => setEditing("new")} disabled={pending}>
            <CirclePlus size={15} aria-hidden />{t("grovnewsAdm.mon.newCampaign")}
          </Button>
        </div>
        <AdminTable
          empty={t("grovnewsAdm.mon.noCampaigns")}
          headers={[t("grovnewsAdm.mon.colCampaign"), t("grovnewsAdm.colStatus"), t("grovnewsAdm.mon.colWindow"),
            t("grovnewsAdm.mon.colAccess"), t("grovnewsAdm.mon.colDiscount"), t("grovnewsAdm.mon.colClaims"), ""]}
          rows={campaigns.map((c) => [
            <span key="n" className="font-semibold">{c.name}</span>,
            <Badge key="s" tone={STATUS_TONE[c.status] ?? "neutral"}>{t(`grovnewsAdm.mon.status.${c.status}`)}</Badge>,
            <span key="w" className="text-[12px]">{formatWarsawNumeric(c.windowStart, locale)} → {formatWarsawNumeric(c.windowEnd, locale)}</span>,
            c.accessMode === "FOREVER" ? t("grovnewsAdm.forever")
              : c.accessMode === "DAYS" ? t("grovnewsAdm.mon.days", { n: c.accessDays ?? 0 })
              : t("grovnewsAdm.mon.until", { date: formatWarsawNumeric(c.accessUntil, locale) }),
            c.discountEnabled
              ? `${c.discountType === "PERCENT" ? `−${c.discountValue}%` : `−${formatMoney(c.discountValue ?? 0, "PLN", locale)}`} · ${
                c.discountDuration === "REPEATING" ? t("grovnewsAdm.mon.months", { n: c.discountMonths ?? 0 }) : t("grovnewsAdm.mon.once")} · ${
                c.eligiblePlanIds.map((id) => planName.get(id) ?? "?").join(", ")}`
              : "—",
            <span key="c" className="tabular-nums">{c.claims} · {t("grovnewsAdm.mon.codesShort", { used: c.codesUsed, issued: c.codesIssued })}</span>,
            <div key="a" className="flex flex-wrap justify-end gap-1.5">
              {c.status === "DRAFT" && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(c)} disabled={pending}><Pencil size={14} aria-hidden />{t("grovnewsAdm.edit")}</Button>
                  <Button size="sm" onClick={() => setConfirm({ id: c.id, action: "activate" })} disabled={pending}><Rocket size={14} aria-hidden />{t("grovnewsAdm.mon.activate")}</Button>
                </>
              )}
              {c.status === "ACTIVE" && (
                <Button size="sm" variant="ghost" onClick={() => setConfirm({ id: c.id, action: "ENDED" })} disabled={pending}><Square size={14} aria-hidden />{t("grovnewsAdm.mon.end")}</Button>
              )}
              {c.status !== "DISABLED" && (
                <Button size="sm" variant="ghost" onClick={() => setConfirm({ id: c.id, action: "DISABLED" })} disabled={pending}><PowerOff size={14} aria-hidden />{t("grovnewsAdm.mon.disable")}</Button>
              )}
            </div>,
          ])}
        />
        <p className="text-[12px] leading-relaxed text-faint">{t("grovnewsAdm.mon.launchNote")}</p>
      </section>

      <Modal open={priceOpen} onClose={() => setPriceOpen(false)} title={t("grovnewsAdm.mon.changePrice")}>
        <Label htmlFor="gn-price" hint="PLN">{t("grovnewsAdm.mon.priceMonthly")}</Label>
        <Input id="gn-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="29.00" />
        <p className="mt-2 text-[12px] leading-relaxed text-faint">{t("grovnewsAdm.mon.priceModalNote")}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setPriceOpen(false)}>{t("common.cancel")}</Button>
          <Button onClick={savePrice} disabled={pending || price.trim() === ""}>{t("grovnewsAdm.save")}</Button>
        </div>
      </Modal>

      <ConfirmModal
        open={salesConfirm !== null} onClose={() => setSalesConfirm(null)} pending={pending}
        onConfirm={() => setSales(salesConfirm === true)}
        title={salesConfirm ? t("grovnewsAdm.mon.salesEnable") : t("grovnewsAdm.mon.salesDisable")}
        body={salesConfirm ? t("grovnewsAdm.mon.salesOnBody") : t("grovnewsAdm.mon.salesOffBody")}
        confirmLabel={salesConfirm ? t("grovnewsAdm.mon.salesEnable") : t("grovnewsAdm.mon.salesDisable")}
        danger={salesConfirm === false}
      />

      <ConfirmModal
        open={confirm !== null} onClose={() => setConfirm(null)} pending={pending} onConfirm={runConfirm}
        title={confirm?.action === "activate" ? t("grovnewsAdm.mon.activate")
          : confirm?.action === "ENDED" ? t("grovnewsAdm.mon.end") : t("grovnewsAdm.mon.disable")}
        body={confirm?.action === "activate" ? t("grovnewsAdm.mon.activateBody")
          : confirm?.action === "ENDED" ? t("grovnewsAdm.mon.endBody") : t("grovnewsAdm.mon.disableBody")}
        confirmLabel={confirm?.action === "activate" ? t("grovnewsAdm.mon.activate")
          : confirm?.action === "ENDED" ? t("grovnewsAdm.mon.end") : t("grovnewsAdm.mon.disable")}
        danger={confirm?.action === "DISABLED"}
      />

      {editing && (
        <CampaignEditor campaign={editing === "new" ? null : editing} plans={plans}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh(); }} />
      )}
    </div>
  );
}

const KNOWN_ERRORS = new Set([
  "payments_disabled", "no_server_key", "stripe_error", "conflict", "reconcile_required", "no_price",
  "not_draft", "invalid_plan", "invalid_transition", "no_coupon", "plan_ineligible", "another_active",
  "window_over", "access_over", "changed",
]);

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-semibold text-ink">{value}</dd>
    </div>
  );
}

/* ── the campaign form (DRAFT only) ────────────────────────────────────────── */

const HOUR = 60 * 60 * 1000;

function CampaignEditor({ campaign, plans, onClose, onSaved }: {
  campaign: AdminCampaign | null; plans: AdminPlanOption[]; onClose: () => void; onSaved: () => void;
}) {
  const { t, locale } = useI18n();
  const [pending, start] = useTransition();
  const [name, setName] = useState(campaign?.name ?? "");
  const [startAt, setStartAt] = useState(isoToWarsawLocal(campaign?.windowStart ?? new Date().toISOString()));
  const [windowPreset, setWindowPreset] = useState<WindowPreset>(campaign ? "custom" : "48");
  const [endAt, setEndAt] = useState(campaign ? isoToWarsawLocal(campaign.windowEnd) : "");
  const [accessPreset, setAccessPreset] = useState<AccessPreset>(
    !campaign ? "30" : campaign.accessMode === "FOREVER" ? "forever" : campaign.accessMode === "UNTIL" ? "until"
      : ["30", "90", "365"].includes(String(campaign.accessDays)) ? String(campaign.accessDays) as AccessPreset : "days");
  const [accessDays, setAccessDays] = useState(String(campaign?.accessDays ?? 30));
  const [accessUntil, setAccessUntil] = useState(campaign?.accessUntil ? isoToWarsawLocal(campaign.accessUntil) : "");
  const [discount, setDiscount] = useState(campaign?.discountEnabled ?? true);
  const [discountType, setDiscountType] = useState(campaign?.discountType ?? "PERCENT");
  const [discountValue, setDiscountValue] = useState(campaign?.discountValue != null
    ? campaign.discountType === "AMOUNT" ? (campaign.discountValue / 100).toFixed(2) : String(campaign.discountValue) : "20");
  const [duration, setDuration] = useState(campaign?.discountDuration ?? "ONCE");
  const [months, setMonths] = useState(String(campaign?.discountMonths ?? 3));
  const [planIds, setPlanIds] = useState<string[]>(campaign?.eligiblePlanIds ?? plans.filter((p) => p.mapped).map((p) => p.id));
  const [validity, setValidity] = useState(String(campaign?.codeValidDays ?? 30));

  const startIso = warsawLocalToIso(startAt);
  const endIso = windowPreset === "custom"
    ? warsawLocalToIso(endAt)
    : startIso ? new Date(new Date(startIso).getTime() + Number(windowPreset) * HOUR).toISOString() : null;

  const save = () => start(async () => {
    const amount = discountType === "AMOUNT" ? Math.round(Number(discountValue.replace(",", ".")) * 100) : Number(discountValue);
    const res = await saveLaunchCampaignAction(campaign?.id ?? null, {
      name,
      window_start: startIso,
      window_end: endIso,
      access_mode: accessPreset === "forever" ? "FOREVER" : accessPreset === "until" ? "UNTIL" : "DAYS",
      access_days: accessPreset === "days" ? Number(accessDays) : ["30", "90", "365"].includes(accessPreset) ? Number(accessPreset) : null,
      access_until: accessPreset === "until" ? warsawLocalToIso(accessUntil) : null,
      discount_enabled: discount,
      discount_type: discountType,
      discount_value: amount,
      discount_duration: duration,
      discount_months: duration === "REPEATING" ? Number(months) : null,
      eligible_plan_ids: planIds,
      code_valid_days: Number(validity),
    });
    if (!res.ok) {
      toast.error(t(res.error === "invalid" ? "grovnewsAdm.mon.err.form"
        : res.error === "forbidden" ? "grovnewsAdm.errForbidden"
        : res.error === "not_draft" || res.error === "invalid_plan" ? `grovnewsAdm.mon.err.${res.error}` : "common.error"));
      return;
    }
    toast.success(t("grovnewsAdm.saved"));
    onSaved();
  });

  const chip = (on: boolean) => `min-h-9 rounded-lg border px-3 text-[12.5px] font-semibold transition-colors ${
    on ? "is-selected" : "border-line text-muted hover:bg-raised hover:text-ink"}`;

  return (
    <Modal open onClose={onClose} title={campaign ? t("grovnewsAdm.mon.editCampaign") : t("grovnewsAdm.mon.newCampaign")} wide>
      <div className="space-y-4">
        <div>
          <Label htmlFor="lc-name">{t("grovnewsAdm.mon.fName")}</Label>
          <Input id="lc-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </div>

        <fieldset>
          <legend className="mb-1.5 text-[13px] font-semibold text-ink">{t("grovnewsAdm.mon.fWindow")}</legend>
          <p className="mb-2 text-[12px] text-faint">{t("grovnewsAdm.mon.fWindowHint")}</p>
          <Label htmlFor="lc-start">{t("grovnewsAdm.mon.fStart")}</Label>
          <Input id="lc-start" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={t("grovnewsAdm.mon.fWindow")}>
            {WINDOW_PRESETS.map((p) => (
              <button key={p} type="button" aria-pressed={windowPreset === p} onClick={() => setWindowPreset(p)} className={chip(windowPreset === p)}>
                {p === "custom" ? t("grovnewsAdm.mon.fEndCustom") : t("grovnewsAdm.mon.hours", { n: p })}
              </button>
            ))}
          </div>
          {windowPreset === "custom" && (
            <Input type="datetime-local" className="mt-2" value={endAt} aria-label={t("grovnewsAdm.mon.fEnd")} onChange={(e) => setEndAt(e.target.value)} />
          )}
          <p className="mt-2 text-[12px] text-muted">{t("grovnewsAdm.mon.windowPreview", {
            from: formatWarsawNumeric(startIso, locale), to: formatWarsawNumeric(endIso, locale) })}</p>
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-[13px] font-semibold text-ink">{t("grovnewsAdm.mon.fAccess")}</legend>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("grovnewsAdm.mon.fAccess")}>
            {ACCESS_PRESETS.map((p) => (
              <button key={p} type="button" aria-pressed={accessPreset === p} onClick={() => setAccessPreset(p)} className={chip(accessPreset === p)}>
                {t(`grovnewsAdm.mon.accessPreset.${p}`)}
              </button>
            ))}
          </div>
          {accessPreset === "days" && (
            <Input type="number" min={1} max={3650} className="mt-2" value={accessDays} aria-label={t("grovnewsAdm.mon.accessPreset.days")}
              onChange={(e) => setAccessDays(e.target.value)} />
          )}
          {accessPreset === "until" && (
            <Input type="datetime-local" className="mt-2" value={accessUntil} aria-label={t("grovnewsAdm.mon.accessPreset.until")}
              onChange={(e) => setAccessUntil(e.target.value)} />
          )}
        </fieldset>

        <fieldset className="rounded-xl border border-line p-3.5">
          <label className="flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" checked={discount} onChange={(e) => setDiscount(e.target.checked)}
              className="h-4 w-4 rounded border-line accent-[rgb(var(--accent))]" />
            <span className="text-[13px] font-semibold text-ink">{t("grovnewsAdm.mon.fDiscount")}</span>
          </label>
          {discount && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="lc-dtype">{t("grovnewsAdm.mon.fDiscountType")}</Label>
                <Select id="lc-dtype" value={discountType} onChange={(e) => setDiscountType(e.target.value)}>
                  <option value="PERCENT">{t("grovnewsAdm.mon.percent")}</option>
                  <option value="AMOUNT">{t("grovnewsAdm.mon.amount")}</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="lc-dvalue" hint={discountType === "PERCENT" ? "1–90 %" : "PLN"}>{t("grovnewsAdm.mon.fDiscountValue")}</Label>
                <Input id="lc-dvalue" inputMode="decimal" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="lc-dur">{t("grovnewsAdm.mon.fDuration")}</Label>
                <Select id="lc-dur" value={duration} onChange={(e) => setDuration(e.target.value)}>
                  <option value="ONCE">{t("grovnewsAdm.mon.once")}</option>
                  <option value="REPEATING">{t("grovnewsAdm.mon.repeating")}</option>
                </Select>
              </div>
              {duration === "REPEATING" && (
                <div>
                  <Label htmlFor="lc-months" hint="1–12">{t("grovnewsAdm.mon.fMonths")}</Label>
                  <Input id="lc-months" type="number" min={1} max={12} value={months} onChange={(e) => setMonths(e.target.value)} />
                </div>
              )}
              <div>
                <Label htmlFor="lc-valid" hint="1–365">{t("grovnewsAdm.mon.fValidity")}</Label>
                <Input id="lc-valid" type="number" min={1} max={365} value={validity} onChange={(e) => setValidity(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <p className="mb-1.5 text-[13px] font-semibold text-ink">{t("grovnewsAdm.mon.fPlans")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {plans.map((p) => {
                    const on = planIds.includes(p.id);
                    return (
                      <button key={p.id} type="button" aria-pressed={on} disabled={!p.mapped}
                        onClick={() => setPlanIds(on ? planIds.filter((x) => x !== p.id) : [...planIds, p.id])}
                        className={`${chip(on)} disabled:opacity-50`}>
                        {p.name} · {formatMoney(p.priceCents, "PLN", locale)}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-[12px] text-faint">{t("grovnewsAdm.mon.plansNote")}</p>
              </div>
            </div>
          )}
        </fieldset>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={save} disabled={pending}>{t("grovnewsAdm.saveDraft")}</Button>
        </div>
      </div>
    </Modal>
  );
}
