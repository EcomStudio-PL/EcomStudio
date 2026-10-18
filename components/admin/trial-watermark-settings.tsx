"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Images, Loader2, Plus, Stamp, X } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ConfirmModal, Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/record";
import { previewTrialWatermarkAction, saveTrialWatermarkAction } from "@/app/actions/trial-watermark-admin";
import type {
  TrialWatermarkPanel, TrialWatermarkPreviewError, TrialWatermarkPreviewResult, TrialWatermarkSaveResult, TrialWatermarkStats,
} from "@/app/actions/trial-watermark-admin";
import {
  TRIAL_WATERMARK_DEFAULTS, TRIAL_WATERMARK_FORCE_MAX, TRIAL_WATERMARK_PREVIEW, TRIAL_WATERMARK_RANGES,
  validateTrialWatermarkInput, type TrialWatermarkConfig, type TrialWatermarkInvalid,
} from "@/lib/trial-watermark/config";
import { cn, formatDate } from "@/lib/utils";

/**
 * ZNAK WODNY NA GENERACJACH PRÓBNYCH — the admin section.
 *
 * One form for the one row (app_settings.trial_watermark), validated with the
 * same rules the server applies (lib/trial-watermark/config.ts), so the field
 * that is wrong says so before anything is sent. Switching the mark ON is
 * confirmed and saved in one step; switching it off is an ordinary edit,
 * because turning it off never exposes or removes anything.
 *
 * Beside the form: what the policy is (who is marked, what is kept and for how
 * long), whether the mark's file and the server key are really in place, and
 * the numbers — originals by state, the paywall funnel, and whether the
 * retention jobs actually ran. Below it, a preview on a real photo with the
 * values as typed: the production engine, nothing stored, no AI.
 */

type NumKey = "widthRatio" | "opacity" | "luminanceThreshold" | "glowRadiusRatio" | "glowOpacity"
  | "originalRetentionDays" | "signedUrlTtlSeconds";
type Draft = Record<NumKey, string> & {
  enabled: boolean;
  darkColor: string;
  exemptStaff: boolean;
  forceTrialUserIds: string[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^#[0-9a-f]{6}$/i;
const VISUAL: (NumKey | "darkColor")[] = ["widthRatio", "opacity", "luminanceThreshold", "darkColor", "glowRadiusRatio", "glowOpacity"];

const toDraft = (c: TrialWatermarkConfig): Draft => ({
  enabled: c.enabled,
  widthRatio: String(c.widthRatio),
  opacity: String(c.opacity),
  luminanceThreshold: String(c.luminanceThreshold),
  darkColor: c.darkColor,
  glowRadiusRatio: String(c.glowRadiusRatio),
  glowOpacity: String(c.glowOpacity),
  originalRetentionDays: String(c.originalRetentionDays),
  signedUrlTtlSeconds: String(c.signedUrlTtlSeconds),
  exemptStaff: c.exemptStaff,
  forceTrialUserIds: [...c.forceTrialUserIds],
});

/** An empty or unparsable field stays NaN, so validation names it. */
const num = (s: string) => (s.trim() === "" ? Number.NaN : Number(s.trim().replace(",", ".")));

const toInput = (d: Draft) => ({
  enabled: d.enabled,
  widthRatio: num(d.widthRatio),
  opacity: num(d.opacity),
  luminanceThreshold: num(d.luminanceThreshold),
  darkColor: d.darkColor.trim(),
  glowRadiusRatio: num(d.glowRadiusRatio),
  glowOpacity: num(d.glowOpacity),
  originalRetentionDays: num(d.originalRetentionDays),
  signedUrlTtlSeconds: num(d.signedUrlTtlSeconds),
  exemptStaff: d.exemptStaff,
  forceTrialUserIds: d.forceTrialUserIds,
});

/** Field → its label and its "this is wrong" line (literal keys, so i18n:check sees them). */
const FIELD: Record<TrialWatermarkInvalid, { label: string; invalid: string }> = {
  enabled: { label: "admin.trialWm.f.enabled", invalid: "admin.trialWm.inv.boolean" },
  widthRatio: { label: "admin.trialWm.f.widthRatio", invalid: "admin.trialWm.inv.range" },
  opacity: { label: "admin.trialWm.f.opacity", invalid: "admin.trialWm.inv.range" },
  luminanceThreshold: { label: "admin.trialWm.f.luminanceThreshold", invalid: "admin.trialWm.inv.range" },
  darkColor: { label: "admin.trialWm.f.darkColor", invalid: "admin.trialWm.inv.darkColor" },
  glowRadiusRatio: { label: "admin.trialWm.f.glowRadiusRatio", invalid: "admin.trialWm.inv.range" },
  glowOpacity: { label: "admin.trialWm.f.glowOpacity", invalid: "admin.trialWm.inv.range" },
  originalRetentionDays: { label: "admin.trialWm.f.originalRetentionDays", invalid: "admin.trialWm.inv.rangeInt" },
  signedUrlTtlSeconds: { label: "admin.trialWm.f.signedUrlTtlSeconds", invalid: "admin.trialWm.inv.rangeInt" },
  exemptStaff: { label: "admin.trialWm.f.exemptStaff", invalid: "admin.trialWm.inv.boolean" },
  forceTrialUserIds: { label: "admin.trialWm.f.forceTrialUserIds", invalid: "admin.trialWm.inv.forceTrialUserIds" },
};

const HINT: Record<NumKey, string> = {
  widthRatio: "admin.trialWm.h.widthRatio",
  opacity: "admin.trialWm.h.opacity",
  luminanceThreshold: "admin.trialWm.h.luminanceThreshold",
  glowRadiusRatio: "admin.trialWm.h.glowRadiusRatio",
  glowOpacity: "admin.trialWm.h.glowOpacity",
  originalRetentionDays: "admin.trialWm.h.originalRetentionDays",
  signedUrlTtlSeconds: "admin.trialWm.h.signedUrlTtlSeconds",
};

const SAVE_ERROR: Record<Exclude<TrialWatermarkSaveResult, { ok: true }>["error"], string> = {
  forbidden: "admin.trialWm.err.forbidden",
  invalid: "admin.trialWm.err.invalid",
  migration_pending: "admin.trialWm.err.migration_pending",
  confirm_required: "admin.trialWm.err.confirm_required",
  asset_unavailable: "admin.trialWm.err.asset_unavailable",
  server_key_missing: "admin.trialWm.err.server_key_missing",
  generic: "common.error",
};

const PREVIEW_ERROR: Record<TrialWatermarkPreviewError, string> = {
  forbidden: "admin.trialWm.err.forbidden",
  invalid: "admin.trialWm.pv.err.invalid",
  no_image: "admin.trialWm.pv.err.no_image",
  bad_source: "admin.trialWm.pv.err.bad_source",
  too_large: "admin.trialWm.pv.err.too_large",
  not_found: "admin.trialWm.pv.err.not_found",
  unsupported_format: "admin.trialWm.pv.err.unsupported_format",
  unreadable: "admin.trialWm.pv.err.unreadable",
  too_small: "admin.trialWm.pv.err.too_small",
  asset_missing: "admin.trialWm.asset.asset_missing",
  asset_mismatch: "admin.trialWm.asset.asset_mismatch",
  asset_unreadable: "admin.trialWm.asset.asset_unreadable",
  generic: "common.error",
};

const ASSET_ERROR: Record<string, string> = {
  asset_missing: "admin.trialWm.asset.asset_missing",
  asset_mismatch: "admin.trialWm.asset.asset_mismatch",
  asset_unreadable: "admin.trialWm.asset.asset_unreadable",
};

/** Megabytes to one decimal, in the reader's number format. */
const mb = (bytes: number, locale: string) => (Math.round((bytes / (1024 * 1024)) * 10) / 10).toLocaleString(locale);

export function TrialWatermarkSettings({ panel }: { panel: TrialWatermarkPanel }) {
  const { t } = useI18n();
  const router = useRouter();
  const stored = panel.config;
  const [draft, setDraft] = useState<Draft>(() => toDraft(stored));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [serverField, setServerField] = useState<TrialWatermarkInvalid | null>(null);

  // After a save the page re-renders with the stored row; an untouched form
  // follows it (an edited one is never overwritten under the operator). Keyed
  // on the row's content: a refresh hands over a new object every time, and
  // only a new stored row (not the end of an edit) resets the form.
  const storedKey = JSON.stringify(stored);
  useEffect(() => {
    if (!dirty) setDraft(toDraft(JSON.parse(storedKey) as TrialWatermarkConfig));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey]);

  const input = useMemo(() => toInput(draft), [draft]);
  const check = useMemo(() => validateTrialWatermarkInput(input), [input]);
  const invalid: TrialWatermarkInvalid | null = check.ok ? serverField : check.field;

  const patch = (update: Partial<Draft>) => {
    setDraft((prev) => ({ ...prev, ...update }));
    setDirty(true);
    setServerField(null);
  };

  /** Why switching ON cannot work right now — checked again by the server. */
  const enableBlocker: keyof typeof SAVE_ERROR | null = !panel.installed ? "migration_pending"
    : !panel.serverKey ? "server_key_missing"
    : !panel.asset.ok ? "asset_unavailable" : null;

  async function persist(values: ReturnType<typeof toInput>, confirmEnable: boolean) {
    setBusy(true);
    const res = await saveTrialWatermarkAction(values, confirmEnable);
    setBusy(false);
    setConfirmOpen(false);
    if (res.ok) {
      setDirty(false);
      setDraft((prev) => ({ ...prev, enabled: values.enabled }));
      toast.success(t(confirmEnable ? "admin.trialWm.enabledToast" : "admin.trialWm.saved"));
      router.refresh();
      return;
    }
    if (res.error === "confirm_required") { setConfirmOpen(true); return; }
    if (res.field) setServerField(res.field);
    toast.error(t(SAVE_ERROR[res.error] ?? "common.error"));
  }

  const save = () => {
    if (!check.ok) { toast.error(t("admin.trialWm.fixFirst")); return; }
    // Only reachable when the stored row went off under an edited form.
    if (input.enabled && !stored.enabled) { setConfirmOpen(true); return; }
    void persist(input, false);
  };

  const onEnabled = (next: boolean) => {
    if (!next || stored.enabled) { patch({ enabled: next }); return; }
    if (enableBlocker) { toast.error(t(SAVE_ERROR[enableBlocker])); return; }
    if (!validateTrialWatermarkInput({ ...input, enabled: true }).ok) { toast.error(t("admin.trialWm.fixFirst")); return; }
    setConfirmOpen(true);
  };

  const days = Number.isInteger(input.originalRetentionDays) ? input.originalRetentionDays : stored.originalRetentionDays;

  return (
    <section className="space-y-4" aria-labelledby="trial-wm-title" data-trial-watermark>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="trial-wm-title" className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
            <Stamp size={18} aria-hidden className="text-accent" />
            {t("admin.trialWm.title")}
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">{t("admin.trialWm.sub")}</p>
        </div>
        <span className="flex flex-wrap gap-1.5">
          <Badge tone={stored.enabled ? "success" : "neutral"} dot>
            {t(stored.enabled ? "admin.trialWm.stateOn" : "admin.trialWm.stateOff")}
          </Badge>
          <Badge tone={panel.asset.ok ? "success" : "danger"} dot>
            {t(panel.asset.ok ? "admin.trialWm.assetOk" : "admin.trialWm.assetBad")}
          </Badge>
        </span>
      </div>

      {!panel.installed && (
        <p className="rounded-xl border border-[rgb(var(--warning)/0.35)] bg-[rgb(var(--warning)/0.08)] px-3.5 py-2.5 text-[13px] text-ink" data-trial-wm-pending>
          {t("admin.trialWm.err.migration_pending")}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
          {/* ── status ──────────────────────────────────────────────────── */}
          <Card className="p-4 sm:p-5">
            <label className="flex items-start justify-between gap-4">
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-ink">{t("admin.trialWm.f.enabled")}</span>
                <span className="mt-0.5 block text-[11.5px] leading-relaxed text-faint">{t("admin.trialWm.h.enabled")}</span>
              </span>
              <Switch checked={draft.enabled} onChange={onEnabled} label={t("admin.trialWm.f.enabled")} disabled={busy} />
            </label>
            {stored.enabled && !draft.enabled && (
              <p className="mt-3 text-[12px] leading-relaxed text-warning">{t("admin.trialWm.offPending")}</p>
            )}
          </Card>

          {/* ── the mark ────────────────────────────────────────────────── */}
          <Card className="p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-ink">{t("admin.trialWm.lookTitle")}</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <NumField k="widthRatio" draft={draft} invalid={invalid} onChange={patch} step={0.01} />
              <NumField k="opacity" draft={draft} invalid={invalid} onChange={patch} step={0.01} />
              <NumField k="luminanceThreshold" draft={draft} invalid={invalid} onChange={patch} step={0.01} />
              <div>
                <Label htmlFor="trial-wm-darkColor">{t("admin.trialWm.f.darkColor")}</Label>
                <div className="flex items-center gap-2">
                  <input type="color" aria-label={t("admin.trialWm.f.darkColor")}
                    value={HEX.test(draft.darkColor.trim()) ? draft.darkColor.trim().toLowerCase() : TRIAL_WATERMARK_DEFAULTS.darkColor}
                    onChange={(e) => patch({ darkColor: e.target.value })}
                    className="h-11 w-12 shrink-0 cursor-pointer rounded-xl border border-line bg-surface p-1" />
                  <Input id="trial-wm-darkColor" value={draft.darkColor} maxLength={7} spellCheck={false}
                    onChange={(e) => patch({ darkColor: e.target.value })}
                    aria-invalid={invalid === "darkColor"} className="font-mono" />
                </div>
                <FieldNote k="darkColor" invalid={invalid} hint="admin.trialWm.h.darkColor" />
              </div>
              <NumField k="glowRadiusRatio" draft={draft} invalid={invalid} onChange={patch} step={0.001} />
              <NumField k="glowOpacity" draft={draft} invalid={invalid} onChange={patch} step={0.01} />
            </div>
          </Card>

          {/* ── originals and links ─────────────────────────────────────── */}
          <Card className="p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-ink">{t("admin.trialWm.keepTitle")}</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <NumField k="originalRetentionDays" draft={draft} invalid={invalid} onChange={patch} step={1} />
              <NumField k="signedUrlTtlSeconds" draft={draft} invalid={invalid} onChange={patch} step={1} />
            </div>
          </Card>

          {/* ── staff and the PROD test account ─────────────────────────── */}
          <Card className="p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-ink">{t("admin.trialWm.staffTitle")}</h3>
            <label className="mt-3 flex items-start justify-between gap-4">
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink">{t("admin.trialWm.f.exemptStaff")}</span>
                <span className="mt-0.5 block text-[11.5px] leading-relaxed text-faint">{t("admin.trialWm.h.exemptStaff")}</span>
              </span>
              <Switch checked={draft.exemptStaff} onChange={(v) => patch({ exemptStaff: v })} label={t("admin.trialWm.f.exemptStaff")} />
            </label>
            <ForcedAccounts ids={draft.forceTrialUserIds} invalid={invalid === "forceTrialUserIds"}
              onChange={(ids) => patch({ forceTrialUserIds: ids })} />
          </Card>

          <PreviewTool draft={draft} />
        </div>

        <div className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:self-start">
          <PolicyCard days={stored.originalRetentionDays} />
          <AssetCard panel={panel} />
          <StatsCard stats={panel.stats} />
        </div>
      </div>

      {dirty && (
        <div className="sticky bottom-0 z-30 -mx-1 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
          <div className="overlay flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5 shadow-e3">
            <span className="text-[13px] font-semibold text-ink">{t("admin.trialWm.unsaved")}</span>
            {invalid && (
              <span className="text-[12px] text-danger">{t("admin.trialWm.invalidField", { field: t(FIELD[invalid].label) })}</span>
            )}
            <span className="min-w-0 flex-1" />
            <Button size="sm" onClick={save} disabled={busy || !panel.installed} data-trial-wm-save>
              {busy ? <Loader2 size={14} className="mr-2 animate-spin" aria-hidden /> : null}
              {t("common.save")}
            </Button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmOpen}
        onClose={() => { if (!busy) setConfirmOpen(false); }}
        onConfirm={() => void persist({ ...input, enabled: true }, true)}
        title={t("admin.trialWm.confirmTitle")}
        body={t("admin.trialWm.confirmBody", { days })}
        confirmLabel={t("admin.trialWm.confirmCta")}
        pending={busy}
        portal
      />
    </section>
  );
}

/* ── fields ────────────────────────────────────────────────────────────── */

function NumField({ k, draft, invalid, onChange, step }: {
  k: NumKey; draft: Draft; invalid: TrialWatermarkInvalid | null; onChange: (u: Partial<Draft>) => void; step: number;
}) {
  const { t } = useI18n();
  const range = TRIAL_WATERMARK_RANGES[k];
  const id = `trial-wm-${k}`;
  return (
    <div>
      <Label htmlFor={id} hint={t("admin.trialWm.range", { min: range.min, max: range.max })}>{t(FIELD[k].label)}</Label>
      <Input id={id} type="number" inputMode="decimal" min={range.min} max={range.max} step={step}
        value={draft[k]} onChange={(e) => onChange({ [k]: e.target.value } as Partial<Draft>)}
        aria-invalid={invalid === k} className={cn("tabular-nums", invalid === k && "border-[rgb(var(--danger)/0.6)]")} />
      <FieldNote k={k} invalid={invalid} hint={HINT[k]} />
    </div>
  );
}

function FieldNote({ k, invalid, hint }: { k: TrialWatermarkInvalid; invalid: TrialWatermarkInvalid | null; hint: string }) {
  const { t } = useI18n();
  if (invalid === k) {
    const range = k in TRIAL_WATERMARK_RANGES ? TRIAL_WATERMARK_RANGES[k as NumKey] : null;
    return (
      <p className="mt-1 text-[11.5px] text-danger" role="alert">
        {t(FIELD[k].invalid, { min: range?.min ?? 0, max: range?.max ?? 0, n: TRIAL_WATERMARK_FORCE_MAX })}
      </p>
    );
  }
  return <p className="mt-1 text-[11.5px] leading-relaxed text-faint">{t(hint)}</p>;
}

function ForcedAccounts({ ids, invalid, onChange }: { ids: string[]; invalid: boolean; onChange: (ids: string[]) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const full = ids.length >= TRIAL_WATERMARK_FORCE_MAX;
  const add = () => {
    const id = value.trim().toLowerCase();
    if (!UUID.test(id)) { setError("admin.trialWm.force.notUuid"); return; }
    if (ids.includes(id)) { setError("admin.trialWm.force.duplicate"); return; }
    if (full) { setError("admin.trialWm.force.full"); return; }
    onChange([...ids, id]);
    setValue("");
    setError(null);
  };
  return (
    <div className="mt-4 border-t border-line pt-3.5">
      <Label htmlFor="trial-wm-force" hint={t("admin.trialWm.force.count", { n: ids.length, max: TRIAL_WATERMARK_FORCE_MAX })}>
        {t("admin.trialWm.f.forceTrialUserIds")}
      </Label>
      <p className="mb-2 text-[11.5px] leading-relaxed text-faint">{t("admin.trialWm.h.forceTrialUserIds")}</p>
      <div className="flex gap-2">
        <Input id="trial-wm-force" value={value} spellCheck={false} autoComplete="off"
          placeholder="00000000-0000-0000-0000-000000000000"
          onChange={(e) => { setValue(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          aria-invalid={error !== null || invalid} className="font-mono text-base sm:text-xs" />
        <Button type="button" variant="secondary" onClick={add} disabled={full || value.trim() === ""} className="shrink-0">
          <Plus size={14} aria-hidden />
          {t("admin.trialWm.force.add")}
        </Button>
      </div>
      {(error || invalid) && (
        <p className="mt-1 text-[11.5px] text-danger" role="alert">
          {t(error ?? "admin.trialWm.inv.forceTrialUserIds", { n: TRIAL_WATERMARK_FORCE_MAX })}
        </p>
      )}
      {ids.length > 0 ? (
        <ul className="mt-2.5 flex flex-wrap gap-1.5" data-trial-wm-forced>
          {ids.map((id) => (
            <li key={id} className="flex max-w-full items-center gap-1 rounded-full border border-line bg-raised py-1 pl-2.5 pr-1">
              <code className="min-w-0 truncate font-mono text-[11px] text-ink">{id}</code>
              <button type="button" onClick={() => onChange(ids.filter((x) => x !== id))}
                aria-label={t("admin.trialWm.force.remove", { id })}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-faint hover:bg-surface hover:text-danger">
                <X size={12} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[12px] text-faint">{t("admin.trialWm.force.none")}</p>
      )}
    </div>
  );
}

/* ── the side column ───────────────────────────────────────────────────── */

function PolicyCard({ days }: { days: number }) {
  const { t } = useI18n();
  const points = [
    "admin.trialWm.policy.who",
    "admin.trialWm.policy.paid",
    "admin.trialWm.policy.staff",
    "admin.trialWm.policy.keep",
    "admin.trialWm.policy.unlock",
    "admin.trialWm.policy.enabled",
  ];
  return (
    <Card className="p-4" data-trial-wm-policy>
      <p className="overline mb-2">{t("admin.trialWm.policy.title")}</p>
      <ul className="space-y-2">
        {points.map((key) => (
          <li key={key} className="text-[12.5px] leading-relaxed text-muted">{t(key, { days })}</li>
        ))}
      </ul>
    </Card>
  );
}

function AssetCard({ panel }: { panel: TrialWatermarkPanel }) {
  const { t } = useI18n();
  const a = panel.asset;
  return (
    <Card className="p-4" data-trial-wm-asset>
      <p className="overline mb-2">{t("admin.trialWm.asset.title")}</p>
      <dl className="space-y-2 text-[12.5px]">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted">{t("admin.trialWm.asset.file")}</dt>
          <dd>
            <Badge tone={a.ok ? "success" : "danger"} dot>
              {a.ok ? t("admin.trialWm.asset.ok") : t(ASSET_ERROR[a.code] ?? "admin.trialWm.asset.asset_unreadable")}
            </Badge>
          </dd>
        </div>
        {a.ok && (
          <>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">{t("admin.trialWm.asset.size")}</dt>
              <dd className="tabular-nums text-ink">{t("admin.trialWm.dims", { w: a.width, h: a.height })}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-muted">{t("admin.trialWm.asset.sha")}</dt>
              <dd><code className="break-all font-mono text-[11px] text-ink">{a.sha256}</code></dd>
            </div>
          </>
        )}
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted">{t("admin.trialWm.asset.serverKey")}</dt>
          <dd>
            <Badge tone={panel.serverKey ? "success" : "danger"} dot>
              {t(panel.serverKey ? "admin.trialWm.asset.serverKeyOk" : "admin.trialWm.asset.serverKeyMissing")}
            </Badge>
          </dd>
        </div>
      </dl>
    </Card>
  );
}

function StatsCard({ stats }: { stats: TrialWatermarkStats | null }) {
  const { t, locale } = useI18n();
  if (!stats) {
    return (
      <Card className="p-4" data-trial-wm-stats>
        <p className="overline mb-2">{t("admin.trialWm.stats.title", { days: 30 })}</p>
        <p className="text-[12.5px] text-muted">{t("admin.trialWm.stats.unavailable")}</p>
      </Card>
    );
  }
  const statusRows: [string, number][] = [
    ["admin.trialWm.status.locked", stats.status.locked + stats.status.unlocking],
    ["admin.trialWm.status.unlocked", stats.status.unlocked],
    ["admin.trialWm.status.expired", stats.status.expired],
    ["admin.trialWm.status.deleted", stats.status.deleted],
    ["admin.trialWm.status.orphaned", stats.status.orphaned],
    ["admin.trialWm.status.pending", stats.status.pending],
  ];
  const funnel: [string, number][] = [
    ["admin.trialWm.funnel.clicked", stats.funnel.clicked],
    ["admin.trialWm.funnel.paywall", stats.funnel.paywallWorkspaces],
    ["admin.trialWm.funnel.planSelected", stats.funnel.planSelected],
    ["admin.trialWm.funnel.confirmed", stats.funnel.subscriptionConfirmed],
  ];
  const outcomes: [string, number][] = [
    ["admin.trialWm.items.created", stats.items.created],
    ["admin.trialWm.items.unlocked", stats.items.unlocked],
    ["admin.trialWm.items.bulk", stats.bulk],
    ["admin.trialWm.items.expired", stats.items.expired],
    ["admin.trialWm.items.converted", stats.funnel.converted],
  ];
  const sweep = stats.sweep;
  return (
    <Card className="p-4" data-trial-wm-stats>
      <p className="overline mb-2">{t("admin.trialWm.stats.now")}</p>
      <div className="grid grid-cols-3 gap-2">
        {statusRows.map(([key, n]) => <Tile key={key} label={t(key)} value={n} />)}
      </div>
      <p className="mt-2 text-[11.5px] text-faint">
        {t("admin.trialWm.stats.liveLine", { live: stats.items.lockedLive, soon: stats.items.expiring24h })}
      </p>

      <p className="overline mb-2 mt-4">{t("admin.trialWm.stats.title", { days: stats.days })}</p>
      <ol className="space-y-1" data-trial-wm-funnel>
        {funnel.map(([key, n], i) => (
          <li key={key} className="flex items-center justify-between gap-3 rounded-lg bg-raised px-3 py-1.5 text-[12.5px]">
            <span className="min-w-0 truncate text-muted">
              <span aria-hidden className="mr-1.5 tabular-nums text-faint">{i + 1}.</span>
              {t(key)}
            </span>
            <span className="metric tabular-nums text-ink">{n}</span>
          </li>
        ))}
      </ol>
      <p className="mt-1.5 text-[11.5px] text-faint">{t("admin.trialWm.funnel.note", { paywalls: stats.funnel.paywalls })}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2">
        {outcomes.map(([key, n]) => <Tile key={key} label={t(key)} value={n} />)}
      </div>

      <p className="overline mb-2 mt-4">{t("admin.trialWm.jobs.title")}</p>
      <dl className="space-y-2 text-[12.5px]">
        <div>
          <dt className="text-muted">{t("admin.trialWm.jobs.sweep")}</dt>
          <dd className="mt-0.5 text-ink" data-trial-wm-sweep suppressHydrationWarning>
            {sweep.state === "absent" ? t("admin.trialWm.jobs.sweepAbsent")
              : sweep.state === "unreadable" ? t("admin.trialWm.jobs.sweepUnreadable")
              : !sweep.lastStart ? t("admin.trialWm.jobs.never")
              : t("admin.trialWm.jobs.sweepLast", {
                  at: formatDate(sweep.lastStart, locale),
                  status: sweep.lastStatus ?? "—",
                  ok: sweep.lastSuccess ? formatDate(sweep.lastSuccess, locale) : t("admin.trialWm.jobs.never"),
                })}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{t("admin.trialWm.jobs.purge")}</dt>
          <dd className="mt-0.5 text-ink" data-trial-wm-purge suppressHydrationWarning>
            {!stats.purge ? t("admin.trialWm.jobs.never") : (
              <>
                {t("admin.trialWm.jobs.purgeLast", {
                  at: formatDate(stats.purge.ranAt, locale),
                  listed: stats.purge.listed, removed: stats.purge.removed, marked: stats.purge.marked,
                })}
                {stats.purge.error && (
                  <span className="mt-0.5 block text-danger">{t("admin.trialWm.jobs.purgeError", { code: stats.purge.error })}</span>
                )}
              </>
            )}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted">{t("admin.trialWm.jobs.backlog")}</dt>
          <dd className="metric tabular-nums text-ink">{stats.items.purgeBacklog}</dd>
        </div>
      </dl>
    </Card>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-xl bg-raised px-2.5 py-2">
      <p className="truncate text-[10.5px] uppercase tracking-wide text-faint" title={label}>{label}</p>
      <p className="metric mt-0.5 text-base tabular-nums text-ink">{value}</p>
    </div>
  );
}

/* ── preview ───────────────────────────────────────────────────────────── */

type Source = { kind: "file"; file: File } | { kind: "media"; name: string; title: string; url: string };
type MediaRow = { id: string; name: string; title: string; url: string; tooLarge: boolean };

function PreviewTool({ draft }: { draft: Draft }) {
  const { t, locale } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Extract<TrialWatermarkPreviewResult, { ok: true }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usedParams, setUsedParams] = useState<string | null>(null);

  const visual = useMemo(() => {
    const all = toInput(draft);
    return Object.fromEntries(VISUAL.map((k) => [k, all[k]]));
  }, [draft]);
  const params = JSON.stringify(visual);
  const visualOk = validateTrialWatermarkInput({ ...TRIAL_WATERMARK_DEFAULTS, ...visual }).ok;

  const pick = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (file.size > TRIAL_WATERMARK_PREVIEW.maxBytes) {
      setError(t("admin.trialWm.pv.err.too_large"));
      return;
    }
    // The upload rides the server-action body, which stops at 4.5 MB; the
    // media library is read by the server itself, up to the 10 MB cap.
    if (file.size > TRIAL_WATERMARK_PREVIEW.uploadMaxBytes) {
      setError(t("admin.trialWm.pv.err.uploadTooLarge", { size: mb(file.size, locale), max: mb(TRIAL_WATERMARK_PREVIEW.uploadMaxBytes, locale) }));
      return;
    }
    setSource({ kind: "file", file });
  };

  async function run() {
    if (!source) { setError(t("admin.trialWm.pv.err.no_image")); return; }
    if (!visualOk) { setError(t("admin.trialWm.pv.err.invalid")); return; }
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("params", params);
    if (source.kind === "file") form.set("file", source.file);
    else form.set("media", source.name);
    try {
      const res = await previewTrialWatermarkAction(form);
      if (res.ok) { setResult(res); setUsedParams(params); }
      else setError(t(PREVIEW_ERROR[res.error] ?? "common.error"));
    } catch {
      // The platform refused the request body before the action ran.
      setError(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  const sourceLabel = source?.kind === "file"
    ? t("admin.trialWm.pv.fileLabel", { name: source.file.name, size: mb(source.file.size, locale) })
    : source?.kind === "media" ? source.title : null;

  return (
    <Card className="p-4 sm:p-5" data-trial-wm-preview>
      <h3 className="text-sm font-semibold text-ink">{t("admin.trialWm.pv.title")}</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-faint">{t("admin.trialWm.pv.sub")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
          onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
          <ImagePlus size={14} aria-hidden />
          {t("admin.trialWm.pv.upload")}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setBrowsing(true)}>
          <Images size={14} aria-hidden />
          {t("admin.trialWm.pv.library")}
        </Button>
        <Button type="button" size="sm" onClick={() => void run()} disabled={busy || !source} data-trial-wm-run>
          {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Stamp size={14} aria-hidden />}
          {t("admin.trialWm.pv.run")}
        </Button>
      </div>
      <p className="mt-2 min-w-0 truncate text-[12px] text-muted">
        {sourceLabel ?? t("admin.trialWm.pv.noSource")}
      </p>
      {error && <p className="mt-2 text-[12px] text-danger" role="alert">{error}</p>}

      {result && (
        <div className="mt-4 space-y-3">
          {usedParams !== params && (
            <p className="text-[12px] text-warning">{t("admin.trialWm.pv.stale")}</p>
          )}
          <div className="overflow-hidden rounded-xl border border-line bg-[repeating-conic-gradient(rgb(var(--faint)/0.12)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]">
            <img src={result.dataUrl} alt={t("admin.trialWm.pv.alt")} className="mx-auto block h-auto max-h-[70vh] w-auto max-w-full" />
          </div>
          <PreviewInfo result={result} />
        </div>
      )}

      <MediaLibrary open={browsing} onClose={() => setBrowsing(false)}
        onPick={(row) => { setSource({ kind: "media", name: row.name, title: row.title, url: row.url }); setError(null); setBrowsing(false); }} />
    </Card>
  );
}

function PreviewInfo({ result }: { result: Extract<TrialWatermarkPreviewResult, { ok: true }> }) {
  const { t, locale } = useI18n();
  const i = result.info;
  const rows: [string, string][] = [
    [t("admin.trialWm.pv.variant"), t(i.variant === "dark" ? "admin.trialWm.pv.variantDark" : "admin.trialWm.pv.variantLight")],
    [t("admin.trialWm.pv.luminance"), t("admin.trialWm.pv.luminanceValue", { value: i.luminance, threshold: i.threshold })],
    [t("admin.trialWm.pv.mark"), t("admin.trialWm.pv.markValue", { w: i.markWidth, h: i.markHeight, scale: i.scale })],
    [t("admin.trialWm.pv.position"), t("admin.trialWm.pv.positionValue", { left: i.left, top: i.top })],
    [t("admin.trialWm.f.opacity"), String(i.opacity)],
    [t("admin.trialWm.pv.glow"), t("admin.trialWm.pv.glowValue", { px: i.glowRadiusPx, opacity: i.glowOpacity })],
    [t("admin.trialWm.pv.image"), t("admin.trialWm.pv.imageValue", { w: i.width, h: i.height, format: i.format.toUpperCase() })],
    [t("admin.trialWm.pv.bytes"), t("admin.trialWm.pv.bytesValue", { from: mb(result.sourceBytes, locale), to: mb(result.markedBytes, locale) })],
    [t("admin.trialWm.pv.shown"), t("admin.trialWm.pv.shownValue", { w: result.shown.width, h: result.shown.height, ms: result.ms })],
  ];
  return (
    <dl className="grid gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-2" data-trial-wm-info>
      {rows.map(([label, value]) => (
        <div key={label} className="flex min-w-0 items-baseline justify-between gap-3 border-b border-line/60 pb-1">
          <dt className="shrink-0 text-muted">{label}</dt>
          <dd className="min-w-0 truncate text-right tabular-nums text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Images of the media library the engine can read (PNG, JPEG, WebP). */
function MediaLibrary({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (row: MediaRow) => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<MediaRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRows(null);
    setFailed(false);
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("media_assets").select("id, storage_path, title, mime, size_bytes")
        .eq("kind", "image").not("storage_path", "is", null)
        .order("created_at", { ascending: false }).limit(60);
      if (cancelled) return;
      if (error) { setFailed(true); setRows([]); return; }
      setRows((data ?? [])
        .filter((r) => r.storage_path && (/^image\/(png|jpeg|webp)$/.test(r.mime ?? "") || /\.(png|jpe?g|webp)$/i.test(r.storage_path)))
        .map((r) => ({
          id: r.id,
          name: r.storage_path as string,
          title: r.title?.trim() || (r.storage_path as string),
          url: supabase.storage.from("media").getPublicUrl(r.storage_path as string).data.publicUrl,
          tooLarge: (r.size_bytes ?? 0) > TRIAL_WATERMARK_PREVIEW.maxBytes,
        })));
    })();
    return () => { cancelled = true; };
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={t("admin.trialWm.pv.library")} wide portal>
      {rows === null ? (
        <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" aria-hidden />{t("common.loading")}</p>
      ) : failed ? (
        <p className="text-sm text-danger">{t("common.error")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">{t("admin.trialWm.pv.libraryEmpty")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {rows.map((row) => (
            <li key={row.id}>
              <button type="button" disabled={row.tooLarge} onClick={() => onPick(row)}
                className="group block w-full overflow-hidden rounded-xl border border-line text-left transition-colors hover:border-[rgb(var(--accent)/0.5)] disabled:cursor-not-allowed disabled:opacity-50">
                <span className="block aspect-[4/3] bg-raised">
                  <img src={row.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                </span>
                <span className="block truncate px-2 py-1.5 text-[11.5px] text-muted">
                  {row.tooLarge ? t("admin.trialWm.pv.libraryTooLarge") : row.title}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
