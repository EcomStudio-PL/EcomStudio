"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, Loader2, Rocket } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ConfirmModal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/record";
import { cn, formatInstant } from "@/lib/utils";
import { formatCount, formatLaunchDate } from "@/lib/launch/tokens";
import { savePrelaunchCampaignAction, type PrelaunchCampaignSaveResult } from "@/app/actions/prelaunch-admin";
import {
  PRELAUNCH_RANGES, campaignInputFrom, launchWarnings, validatePrelaunchCampaignInput, visibleValues,
  type CampaignField, type CampaignInvalidReason, type PrelaunchCampaignConfig, type PrelaunchCampaignInput,
  type PrelaunchCampaignPanel, type RangedField,
} from "@/lib/server/prelaunch/campaign-config";

/**
 * KAMPANIA PRZEDPREMIEROWA — the launch page's numbers, above its builder.
 *
 * The copy of the page lives in the builder below and in "Edytuj stronę"; the
 * FIGURES that copy may promise live here, each beside its own "Zatwierdzone"
 * switch: a sentence that names {date} or {credits} stays hidden on the page
 * until its value is approved (lib/launch/tokens.ts). Validated with the very
 * rules the save action applies (lib/server/prelaunch/campaign-config.ts), so
 * the wrong field says so before anything is sent.
 *
 * Collapsed by default — the builder is what this screen is for — but the two
 * things an operator must never miss stay visible when it is closed: what the
 * page shows right now (or will show after saving), and whether the
 * registration switch agrees with the approved launch date. That switch is
 * only READ here; it is changed in Dostęp do platformy.
 *
 * Two promises cannot be approved from here at all: the locked premiere price
 * while the pricing offer runs no premiere, and early access while no mechanism
 * for it exists. Both are shown, disabled, with the reason.
 */

type Draft = {
  launchDate: string; launchTime: string; launchApproved: boolean;
  signupCredits: string; signupApproved: boolean;
  referralCredits: string; referralApproved: boolean;
  standardCredits: string; standardApproved: boolean;
  referralCap: string;
  priceLockApproved: boolean;
  rewardsActive: boolean;
  claimDate: string; claimTime: string;
  optinTtlHours: string;
  optinHourlyCap: string;
};

const str = (n: number | null) => (n === null ? "" : String(n));

function toDraft(config: PrelaunchCampaignConfig): Draft {
  const i = campaignInputFrom(config);
  return {
    launchDate: i.launch.date, launchTime: i.launch.time, launchApproved: i.launch.approved,
    signupCredits: str(i.signupCredits.value), signupApproved: i.signupCredits.approved,
    referralCredits: str(i.referralCredits.value), referralApproved: i.referralCredits.approved,
    standardCredits: str(i.standardCredits.value), standardApproved: i.standardCredits.approved,
    referralCap: str(i.referralCap),
    priceLockApproved: i.priceLockApproved,
    rewardsActive: i.rewardsActive,
    claimDate: i.rewardClaimUntil.date, claimTime: i.rewardClaimUntil.time,
    optinTtlHours: str(i.optinTtlHours),
    optinHourlyCap: str(i.optinHourlyCap),
  };
}

/** An optional number: empty is "no value"; anything unparsable stays NaN so
 *  validation names the field instead of quietly dropping it. */
const optional = (s: string) => (s.trim() === "" ? null : Number(s.trim().replace(",", ".")));
/** A required number: empty is NaN, never a default. */
const required = (s: string) => (s.trim() === "" ? Number.NaN : Number(s.trim().replace(",", ".")));

function toInput(d: Draft): PrelaunchCampaignInput {
  return {
    launch: { date: d.launchDate, time: d.launchTime, approved: d.launchApproved },
    signupCredits: { value: optional(d.signupCredits), approved: d.signupApproved },
    referralCredits: { value: optional(d.referralCredits), approved: d.referralApproved },
    standardCredits: { value: optional(d.standardCredits), approved: d.standardApproved },
    referralCap: required(d.referralCap),
    priceLockApproved: d.priceLockApproved,
    rewardsActive: d.rewardsActive,
    rewardClaimUntil: { date: d.claimDate, time: d.claimTime },
    optinTtlHours: required(d.optinTtlHours),
    optinHourlyCap: required(d.optinHourlyCap),
  };
}

/** Field → label (literal keys, so i18n:check sees them). */
const LABEL: Record<CampaignField, string> = {
  launch: "admin.prelaunch.f.launch",
  signupCredits: "admin.prelaunch.f.signupCredits",
  referralCredits: "admin.prelaunch.f.referralCredits",
  standardCredits: "admin.prelaunch.f.standardCredits",
  referralCap: "admin.prelaunch.f.referralCap",
  priceLock: "admin.prelaunch.f.priceLock",
  earlyAccess: "admin.prelaunch.f.earlyAccess",
  rewardsActive: "admin.prelaunch.f.rewardsActive",
  rewardClaimUntil: "admin.prelaunch.f.claimUntil",
  optinTtlHours: "admin.prelaunch.f.optinTtlHours",
  optinHourlyCap: "admin.prelaunch.f.optinHourlyCap",
};

const REASON: Record<CampaignInvalidReason, string> = {
  shape: "admin.prelaunch.inv.range",
  range: "admin.prelaunch.inv.range",
  required: "admin.prelaunch.inv.required",
  format: "admin.prelaunch.inv.format",
  nonexistent: "admin.prelaunch.inv.nonexistent",
  ambiguous: "admin.prelaunch.inv.ambiguous",
  past: "admin.prelaunch.inv.past",
  unsupported: "admin.prelaunch.inv.unsupported",
  not_above_standard: "admin.prelaunch.inv.notAboveStandard",
};

const SAVE_ERROR: Record<Exclude<PrelaunchCampaignSaveResult, { ok: true }>["error"], string> = {
  forbidden: "admin.prelaunch.err.forbidden",
  invalid: "admin.prelaunch.err.invalid",
  migration_pending: "admin.prelaunch.err.migrationPending",
  confirm_required: "admin.prelaunch.err.confirmRequired",
  generic: "common.error",
};

const RANGE_OF: Partial<Record<CampaignField, RangedField>> = {
  signupCredits: "signupCredits", referralCredits: "referralCredits", standardCredits: "standardCredits",
  referralCap: "referralCap", optinTtlHours: "optinTtlHours", optinHourlyCap: "optinHourlyCap",
};

export function PrelaunchCampaign({ panel }: { panel: PrelaunchCampaignPanel }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const stored = panel.config;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(stored));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [serverInvalid, setServerInvalid] = useState<{ field: CampaignField; reason: CampaignInvalidReason } | null>(null);

  // After a save the page re-renders with the stored row; an untouched form
  // follows it, an edited one is never overwritten under the operator.
  const storedKey = JSON.stringify(stored);
  useEffect(() => {
    if (!dirty) setDraft(toDraft(JSON.parse(storedKey) as PrelaunchCampaignConfig));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey]);

  const input = useMemo(() => toInput(draft), [draft]);
  const ctx = useMemo(() => ({
    now: panel.now, premiereActive: panel.premiereActive, welcomeCredits: panel.welcomeCredits, before: stored,
  }), [panel.now, panel.premiereActive, panel.welcomeCredits, stored]);
  const check = useMemo(() => validatePrelaunchCampaignInput(input, ctx), [input, ctx]);
  const invalid = check.ok ? serverInvalid : { field: check.field, reason: check.reason };

  // What the page shows: the stored row, or — while editing — what it WILL
  // show once this valid form is saved.
  const shownConfig = dirty && check.ok ? check.config : stored;
  const visible = visibleValues(shownConfig, { now: panel.now, premiereActive: panel.premiereActive });
  const warnings = launchWarnings(shownConfig, panel.platform, panel.now);
  const approvedCount = [stored.launchAtApproved, stored.signupCreditsApproved, stored.referralCreditsApproved,
    stored.standardCreditsApproved, stored.priceLockApproved].filter(Boolean).length;

  const patch = (update: Partial<Draft>) => {
    setDraft((prev) => ({ ...prev, ...update }));
    setDirty(true);
    setServerInvalid(null);
  };

  async function persist(values: PrelaunchCampaignInput, confirm: boolean) {
    setBusy(true);
    const res = await savePrelaunchCampaignAction({ ...values, confirm });
    setBusy(false);
    setConfirmOpen(false);
    if (res.ok) {
      setDirty(false);
      setDraft((prev) => ({ ...prev, rewardsActive: values.rewardsActive }));
      toast.success(t(confirm ? "admin.prelaunch.rewardsOnToast" : "admin.prelaunch.saved"));
      router.refresh();
      return;
    }
    if (res.error === "confirm_required") { setConfirmOpen(true); return; }
    if (res.field && res.reason) setServerInvalid({ field: res.field, reason: res.reason });
    toast.error(t(SAVE_ERROR[res.error] ?? "common.error"));
  }

  const save = () => {
    if (!check.ok) { toast.error(t("admin.prelaunch.fixFirst")); return; }
    if (input.rewardsActive && !stored.rewardsActive) { setConfirmOpen(true); return; }
    void persist(input, false);
  };

  const onRewards = (next: boolean) => {
    if (!next || stored.rewardsActive) { patch({ rewardsActive: next }); return; }
    if (!check.ok) { toast.error(t("admin.prelaunch.fixFirst")); return; }
    setConfirmOpen(true);
  };

  const describe = (v: (typeof visible)[number]) => {
    switch (v.key) {
      case "date": return t("admin.prelaunch.visible.date", { date: formatLaunchDate(v.iso, locale, panel.now) ?? "" });
      case "credits": return t("admin.prelaunch.visible.credits", { n: formatCount(v.value, locale) });
      case "referral": return t("admin.prelaunch.visible.referral", { n: formatCount(v.value, locale) });
      case "standard": return t("admin.prelaunch.visible.standard", { n: formatCount(v.value, locale) });
      case "earlyAccess": return t("admin.prelaunch.visible.earlyAccess", { n: formatCount(v.value, locale) });
      case "priceLock": return t("admin.prelaunch.visible.priceLock");
    }
  };

  const fieldError = (field: CampaignField) => {
    if (invalid?.field !== field) return null;
    const range = RANGE_OF[field] ? PRELAUNCH_RANGES[RANGE_OF[field]!] : null;
    return (
      <p className="mt-1 text-[11.5px] text-danger" role="alert">
        {t(REASON[invalid.reason], { min: range?.min ?? 0, max: range?.max ?? 0, n: panel.welcomeCredits ?? 0 })}
      </p>
    );
  };

  return (
    <section className="mb-4" aria-labelledby="prelaunch-campaign-title" data-prelaunch-campaign>
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="prelaunch-campaign-title" className="flex items-center gap-2 font-display text-base font-semibold text-ink">
              <Rocket size={17} aria-hidden className="text-accent" />
              {t("admin.prelaunch.title")}
            </h2>
            <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted">{t("admin.prelaunch.sub")}</p>
          </div>
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={stored.rewardsActive ? "success" : "neutral"} dot>
              {t(stored.rewardsActive ? "admin.prelaunch.rewardsOn" : "admin.prelaunch.rewardsOff")}
            </Badge>
            <Badge tone={approvedCount > 0 ? "accent" : "neutral"}>
              {t("admin.prelaunch.approvedCount", { n: approvedCount })}
            </Badge>
            <Button type="button" size="sm" variant="secondary" onClick={() => setOpen((o) => !o)}
              aria-expanded={open} aria-controls="prelaunch-campaign-form" data-prelaunch-toggle>
              {t(open ? "admin.prelaunch.collapse" : "admin.prelaunch.expand")}
              <ChevronDown size={14} aria-hidden className={cn("ml-1.5 transition-transform", open && "rotate-180")} />
            </Button>
          </span>
        </div>

        {!panel.installed && (
          <p className="mt-3 rounded-xl border border-[rgb(var(--warning)/0.35)] bg-[rgb(var(--warning)/0.08)] px-3.5 py-2.5 text-[13px] text-ink" data-prelaunch-pending>
            {t("admin.prelaunch.err.migrationPending")}
          </p>
        )}

        {/* ── what visitors see ─────────────────────────────────────────── */}
        <div className="mt-3 rounded-xl bg-raised px-3.5 py-2.5" data-prelaunch-visible aria-live="polite">
          <p className="text-[12px] font-semibold text-ink">
            {t(dirty && check.ok ? "admin.prelaunch.visibleAfterSave" : "admin.prelaunch.visibleNow")}
          </p>
          {visible.length > 0 ? (
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {visible.map((v) => (
                <li key={v.key} className="rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] text-ink">{describe(v)}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[12px] leading-relaxed text-muted">{t("admin.prelaunch.visibleNone")}</p>
          )}
        </div>

        {warnings.length > 0 && (
          <ul className="mt-3 space-y-2" data-prelaunch-warnings>
            {warnings.map((w) => (
              <li key={w.kind} className="flex items-start gap-2 rounded-xl border border-[rgb(var(--warning)/0.35)] bg-[rgb(var(--warning)/0.08)] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink">
                <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0 text-warning" />
                <span>
                  {w.kind === "signup_closed"
                    ? t("admin.prelaunch.warn.signupClosed")
                    : w.opensAt
                      ? t("admin.prelaunch.warn.signupDiffers", { when: formatInstant(w.opensAt, locale) })
                      : t("admin.prelaunch.warn.signupOpenNow")}
                  {" "}
                  <Link href="/admin/settings/access" className="font-semibold text-accent underline-offset-2 hover:underline">
                    {t("admin.prelaunch.warn.accessLink")}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}

        {open && (
          <div id="prelaunch-campaign-form" className="mt-4 grid gap-4 xl:grid-cols-2">
            {/* ── launch date ─────────────────────────────────────────────── */}
            <fieldset className="min-w-0 rounded-xl border border-line p-3.5">
              <legend className="px-1 text-[13px] font-semibold text-ink">{t("admin.prelaunch.f.launch")}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="prelaunch-launch-date">{t("admin.prelaunch.f.date")}</Label>
                  <Input id="prelaunch-launch-date" type="date" value={draft.launchDate}
                    onChange={(e) => patch({ launchDate: e.target.value })} aria-invalid={invalid?.field === "launch"} />
                </div>
                <div>
                  <Label htmlFor="prelaunch-launch-time">{t("admin.prelaunch.f.time")}</Label>
                  <Input id="prelaunch-launch-time" type="time" step={60} value={draft.launchTime}
                    onChange={(e) => patch({ launchTime: e.target.value })} aria-invalid={invalid?.field === "launch"} />
                </div>
              </div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">{t("admin.prelaunch.h.launch")}</p>
              {fieldError("launch")}
              <Approve checked={draft.launchApproved} onChange={(v) => patch({ launchApproved: v })} disabled={busy} />
            </fieldset>

            {/* ── credits ─────────────────────────────────────────────────── */}
            <fieldset className="min-w-0 rounded-xl border border-line p-3.5">
              <legend className="px-1 text-[13px] font-semibold text-ink">{t("admin.prelaunch.creditsTitle")}</legend>
              <div className="space-y-4">
                <CreditField id="signup" label={t(LABEL.signupCredits)} value={draft.signupCredits}
                  hint={panel.welcomeCredits !== null
                    ? t("admin.prelaunch.h.signupCredits", { n: panel.welcomeCredits })
                    : t("admin.prelaunch.h.signupCreditsUnknown")}
                  approved={draft.signupApproved} invalid={invalid?.field === "signupCredits"} error={fieldError("signupCredits")}
                  onValue={(v) => patch({ signupCredits: v })} onApproved={(v) => patch({ signupApproved: v })} disabled={busy} />
                <CreditField id="referral" label={t(LABEL.referralCredits)} value={draft.referralCredits}
                  hint={t("admin.prelaunch.h.referralCredits")}
                  approved={draft.referralApproved} invalid={invalid?.field === "referralCredits"} error={fieldError("referralCredits")}
                  onValue={(v) => patch({ referralCredits: v })} onApproved={(v) => patch({ referralApproved: v })} disabled={busy} />
                <CreditField id="standard" label={t(LABEL.standardCredits)} value={draft.standardCredits}
                  hint={standardHint(t, panel)}
                  approved={draft.standardApproved} invalid={invalid?.field === "standardCredits"} error={fieldError("standardCredits")}
                  onValue={(v) => patch({ standardCredits: v })} onApproved={(v) => patch({ standardApproved: v })} disabled={busy} />
                <NumberField id="prelaunch-cap" label={t(LABEL.referralCap)} field="referralCap" value={draft.referralCap}
                  hint={t("admin.prelaunch.h.referralCap")} invalid={invalid?.field === "referralCap"} error={fieldError("referralCap")}
                  onChange={(v) => patch({ referralCap: v })} />
              </div>
            </fieldset>

            {/* ── promises that need more than a number ───────────────────── */}
            <fieldset className="min-w-0 rounded-xl border border-line p-3.5">
              <legend className="px-1 text-[13px] font-semibold text-ink">{t("admin.prelaunch.promisesTitle")}</legend>
              <label className="flex items-start justify-between gap-4">
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-ink">{t(LABEL.priceLock)}</span>
                  <span className="mt-0.5 block text-[11.5px] leading-relaxed text-faint">
                    {t(panel.premiereActive ? "admin.prelaunch.h.priceLock" : "admin.prelaunch.h.priceLockOff")}
                  </span>
                </span>
                <Switch checked={draft.priceLockApproved} onChange={(v) => patch({ priceLockApproved: v })}
                  label={t(LABEL.priceLock)} disabled={busy || (!panel.premiereActive && !draft.priceLockApproved)} />
              </label>
              {fieldError("priceLock")}
              <div className="mt-4 border-t border-line pt-3.5" data-prelaunch-early-access>
                <Label htmlFor="prelaunch-early">{t(LABEL.earlyAccess)}</Label>
                <div className="flex items-center gap-3">
                  <Input id="prelaunch-early" type="number" value={str(stored.earlyAccessHours)} disabled readOnly className="max-w-32 tabular-nums" />
                  <Switch checked={stored.earlyAccessApproved && panel.earlyAccessSupported} onChange={() => undefined}
                    label={t("admin.prelaunch.approved")} disabled />
                </div>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">
                  {t(panel.earlyAccessSupported ? "admin.prelaunch.h.earlyAccess" : "admin.prelaunch.h.earlyAccessOff")}
                </p>
              </div>
            </fieldset>

            {/* ── rewards and the opt-in mail ─────────────────────────────── */}
            <fieldset className="min-w-0 rounded-xl border border-line p-3.5">
              <legend className="px-1 text-[13px] font-semibold text-ink">{t("admin.prelaunch.rewardsTitle")}</legend>
              <label className="flex items-start justify-between gap-4">
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-ink">{t(LABEL.rewardsActive)}</span>
                  <span className="mt-0.5 block text-[11.5px] leading-relaxed text-faint">{t("admin.prelaunch.h.rewardsActive")}</span>
                </span>
                <Switch checked={draft.rewardsActive} onChange={onRewards} label={t(LABEL.rewardsActive)} disabled={busy || !panel.installed} />
              </label>
              {stored.rewardsActive && !draft.rewardsActive && (
                <p className="mt-2 text-[12px] leading-relaxed text-warning">{t("admin.prelaunch.rewardsOffPending")}</p>
              )}
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="prelaunch-claim-date">{t("admin.prelaunch.f.claimUntil")}</Label>
                  <Input id="prelaunch-claim-date" type="date" value={draft.claimDate}
                    onChange={(e) => patch({ claimDate: e.target.value })} aria-invalid={invalid?.field === "rewardClaimUntil"} />
                </div>
                <div>
                  <Label htmlFor="prelaunch-claim-time">{t("admin.prelaunch.f.time")}</Label>
                  <Input id="prelaunch-claim-time" type="time" step={60} value={draft.claimTime}
                    onChange={(e) => patch({ claimTime: e.target.value })} aria-invalid={invalid?.field === "rewardClaimUntil"} />
                </div>
              </div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">{t("admin.prelaunch.h.claimUntil")}</p>
              {fieldError("rewardClaimUntil")}
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <NumberField id="prelaunch-ttl" label={t(LABEL.optinTtlHours)} field="optinTtlHours" value={draft.optinTtlHours}
                  hint={t("admin.prelaunch.h.optinTtlHours")} invalid={invalid?.field === "optinTtlHours"} error={fieldError("optinTtlHours")}
                  onChange={(v) => patch({ optinTtlHours: v })} />
                <NumberField id="prelaunch-hourly" label={t(LABEL.optinHourlyCap)} field="optinHourlyCap" value={draft.optinHourlyCap}
                  hint={t("admin.prelaunch.h.optinHourlyCap")} invalid={invalid?.field === "optinHourlyCap"} error={fieldError("optinHourlyCap")}
                  onChange={(v) => patch({ optinHourlyCap: v })} />
              </div>
            </fieldset>

            {panel.updatedAt && (
              <p className="text-[11.5px] text-faint xl:col-span-2">
                {t("admin.prelaunch.updated", { when: formatInstant(panel.updatedAt, locale) })}
              </p>
            )}
          </div>
        )}
      </Card>

      {dirty && (
        <div className="sticky bottom-0 z-30 -mx-1 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
          <div className="overlay flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5 shadow-e3">
            <span className="text-[13px] font-semibold text-ink">{t("admin.prelaunch.unsaved")}</span>
            {invalid && (
              <span className="text-[12px] text-danger">{t("admin.prelaunch.invalidField", { field: t(LABEL[invalid.field]) })}</span>
            )}
            <span className="min-w-0 flex-1" />
            <Button size="sm" variant="ghost" onClick={() => { setDraft(toDraft(stored)); setDirty(false); setServerInvalid(null); }} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" onClick={save} disabled={busy || !panel.installed} data-prelaunch-save>
              {busy ? <Loader2 size={14} className="mr-2 animate-spin" aria-hidden /> : null}
              {t("common.save")}
            </Button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmOpen}
        onClose={() => { if (!busy) setConfirmOpen(false); }}
        onConfirm={() => void persist({ ...input, rewardsActive: true }, true)}
        title={t("admin.prelaunch.confirmTitle")}
        body={t("admin.prelaunch.confirmBody")}
        confirmLabel={t("admin.prelaunch.confirmCta")}
        pending={busy}
        portal
      />
    </section>
  );
}

function standardHint(t: (key: string, vars?: Record<string, string | number>) => string, panel: PrelaunchCampaignPanel): string {
  const base = panel.welcomeCredits !== null
    ? t("admin.prelaunch.h.standardCredits", { n: panel.welcomeCredits })
    : t("admin.prelaunch.h.standardCreditsUnknown");
  return panel.surveyBonus?.active
    ? `${base} ${t("admin.prelaunch.h.surveyBonus", { n: panel.surveyBonus.amount })}`
    : base;
}

/* ── fields ────────────────────────────────────────────────────────────── */

function Approve({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <label className="mt-3 flex items-center justify-between gap-4 border-t border-line pt-3">
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium text-ink">{t("admin.prelaunch.approved")}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-faint">{t("admin.prelaunch.approvedHint")}</span>
      </span>
      <Switch checked={checked} onChange={onChange} label={t("admin.prelaunch.approved")} disabled={disabled} />
    </label>
  );
}

function CreditField({ id, label, value, hint, approved, invalid, error, onValue, onApproved, disabled }: {
  id: "signup" | "referral" | "standard"; label: string; value: string; hint: string; approved: boolean;
  invalid: boolean; error: React.ReactNode; onValue: (v: string) => void; onApproved: (v: boolean) => void; disabled?: boolean;
}) {
  const { t } = useI18n();
  const range = PRELAUNCH_RANGES[`${id}Credits` as RangedField];
  const inputId = `prelaunch-${id}`;
  return (
    <div data-prelaunch-credit={id}>
      <Label htmlFor={inputId} hint={t("admin.prelaunch.range", { min: range.min, max: range.max })}>{label}</Label>
      <div className="flex items-center gap-3">
        <Input id={inputId} type="number" inputMode="numeric" min={range.min} max={range.max} step={1} value={value}
          onChange={(e) => onValue(e.target.value)} aria-invalid={invalid}
          className={cn("max-w-40 tabular-nums", invalid && "border-[rgb(var(--danger)/0.6)]")} />
        <span className="flex items-center gap-2 text-[12px] text-muted">
          <Switch checked={approved} onChange={onApproved} label={`${label}: ${t("admin.prelaunch.approved")}`} disabled={disabled} />
          {t("admin.prelaunch.approvedShort")}
        </span>
      </div>
      {error ?? <p className="mt-1 text-[11.5px] leading-relaxed text-faint">{hint}</p>}
    </div>
  );
}

function NumberField({ id, label, field, value, hint, invalid, error, onChange }: {
  id: string; label: string; field: RangedField; value: string; hint: string;
  invalid: boolean; error: React.ReactNode; onChange: (v: string) => void;
}) {
  const { t } = useI18n();
  const range = PRELAUNCH_RANGES[field];
  return (
    <div>
      <Label htmlFor={id} hint={t("admin.prelaunch.range", { min: range.min, max: range.max })}>{label}</Label>
      <Input id={id} type="number" inputMode="numeric" min={range.min} max={range.max} step={1} value={value}
        onChange={(e) => onChange(e.target.value)} aria-invalid={invalid}
        className={cn("max-w-40 tabular-nums", invalid && "border-[rgb(var(--danger)/0.6)]")} />
      {error ?? <p className="mt-1 text-[11.5px] leading-relaxed text-faint">{hint}</p>}
    </div>
  );
}
