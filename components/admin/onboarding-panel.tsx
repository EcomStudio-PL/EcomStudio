"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronDown, ChevronUp, Gift, Loader2, Monitor, Plus, Smartphone, Trash2,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Switch } from "@/components/ui/record";
import { MediaPicker } from "@/components/admin/media-picker";
import { saveOnboardingConfigAction } from "@/app/actions/onboarding-admin";
import type { OnboardingStats } from "@/app/actions/onboarding-admin";
import {
  BONUS_PLACEHOLDERS, formatCountdown, renderPlaceholders,
  type BonusConfig, type BonusCopy, type SurveyQuestion,
} from "@/lib/welcome-bonus";
import { cn } from "@/lib/utils";

/**
 * REJESTRACJA I ONBOARDING — the admin console for the welcome bonus.
 *
 * The admin edits CONTENT: what the offer is worth, how long it lasts, what
 * it says and what it asks. Not styling, not markup, not code — the preview
 * beside the editor renders exactly the components the customer sees, so the
 * design cannot be broken from here, only the words changed.
 *
 * Copy can differ between desktop and mobile, but nobody is made to type
 * everything twice: the override is off by default and falls back field by
 * field to the desktop text.
 */

const PREVIEW_SECONDS = 71 * 3600 + 42 * 60 + 18; // §56 — a sample, never a real offer

export function OnboardingPanel({ initial, stats }: {
  initial: BonusConfig;
  stats: OnboardingStats | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [cfg, setCfg] = useState<BonusConfig>(initial);
  const [bump, setBump] = useState(false);
  const [surface, setSurface] = useState<"desktop" | "mobile">("desktop");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const patch = (update: Partial<BonusConfig>) => {
    setCfg((prev) => ({ ...prev, ...update }));
    setDirty(true);
  };
  const patchCopy = (field: keyof BonusCopy, value: string) => {
    const key = surface === "mobile" && cfg.mobileOverride ? "mobileCopy" : "copy";
    setCfg((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
    setDirty(true);
  };

  /** Which copy the editor is currently writing into, and what the customer
   *  would actually see on that surface (mobile falls back per field). */
  const editing: BonusCopy = surface === "mobile" && cfg.mobileOverride ? cfg.mobileCopy : cfg.copy;
  const effective: BonusCopy = useMemo(() => {
    if (surface === "desktop" || !cfg.mobileOverride) return cfg.copy;
    const pick = (a: string, b: string) => (a.trim() !== "" ? a : b);
    return {
      notificationTitle: pick(cfg.mobileCopy.notificationTitle, cfg.copy.notificationTitle),
      notificationBody: pick(cfg.mobileCopy.notificationBody, cfg.copy.notificationBody),
      modalTitle: pick(cfg.mobileCopy.modalTitle, cfg.copy.modalTitle),
      modalSubtitle: pick(cfg.mobileCopy.modalSubtitle, cfg.copy.modalSubtitle),
      cta: pick(cfg.mobileCopy.cta, cfg.copy.cta),
      successTitle: pick(cfg.mobileCopy.successTitle, cfg.copy.successTitle),
      successBody: pick(cfg.mobileCopy.successBody, cfg.copy.successBody),
    };
  }, [cfg, surface]);

  const values = { credits: cfg.amount, hours: cfg.hours, first_name: "Jan" };
  const shown = (custom: string, fallbackKey: string) =>
    renderPlaceholders(custom.trim() !== "" ? custom : t(fallbackKey, values), values);

  const save = async () => {
    setBusy(true);
    const res = await saveOnboardingConfigAction({
      active: cfg.active, amount: cfg.amount, hours: cfg.hours,
      icon: cfg.icon, badge: cfg.badge,
      copy: cfg.copy, mobileOverride: cfg.mobileOverride, mobileCopy: cfg.mobileCopy,
      questions: cfg.questions, bumpCampaign: bump,
    });
    setBusy(false);
    if (res.ok) {
      setDirty(false); setBump(false);
      toast.success(t("onb.saved"));
      router.refresh();
      return;
    }
    const key = res.error === "no_required" ? "onb.errNoRequired"
      : res.error === "no_questions" ? "onb.errNoQuestions"
      : res.error === "amount" ? "onb.errAmount"
      : res.error === "hours" ? "onb.errHours" : "common.error";
    toast.error(t(key));
  };

  /* ── questions ────────────────────────────────────────────────────────── */
  const setQuestion = (index: number, update: Partial<SurveyQuestion>) => {
    setCfg((prev) => ({
      ...prev,
      questions: prev.questions.map((q, i) => (i === index ? { ...q, ...update } : q)),
    }));
    setDirty(true);
  };
  const move = (index: number, delta: number) => {
    setCfg((prev) => {
      const next = [...prev.questions];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return { ...prev, questions: next };
    });
    setDirty(true);
  };

  return (
    <div className="space-y-4">
      <StatsRow stats={stats} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* ── EDITOR ─────────────────────────────────────────────────────── */}
        <div className="space-y-4">
          <Card className="p-4 sm:p-5">
            <h2 className="text-sm font-semibold text-ink">{t("onb.offerTitle")}</h2>
            <label className="mt-3 flex items-center justify-between gap-4">
              <span className="text-[13px] font-medium text-ink">{t("onb.active")}</span>
              <Switch checked={cfg.active} onChange={(v) => patch({ active: v })} label={t("onb.active")} />
            </label>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="bonus-amount">{t("onb.amount")}</Label>
                <Input id="bonus-amount" type="number" min={1} max={100000} value={cfg.amount}
                  onChange={(e) => patch({ amount: Number(e.target.value) })} className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="bonus-hours">{t("onb.hours")}</Label>
                <Input id="bonus-hours" type="number" min={1} max={720} value={cfg.hours}
                  onChange={(e) => patch({ hours: Number(e.target.value) })} className="mt-1.5" />
              </div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="bonus-badge">{t("onb.badge")}</Label>
                <Input id="bonus-badge" value={cfg.badge} maxLength={24}
                  onChange={(e) => patch({ badge: e.target.value })} className="mt-1.5" />
              </div>
              <div>
                <MediaPicker value={cfg.icon} onChange={(url) => patch({ icon: url })} label={t("onb.icon")} />
                <p className="mt-1 text-[11.5px] text-faint">{t("onb.iconHint")}</p>
              </div>
            </div>
            {/* An offer already made keeps its terms. Changing the amount only
                reaches NEW customers once the campaign is bumped, which is the
                honest way to avoid two customers being told different things
                about the same offer. */}
            <label className="mt-4 flex items-start justify-between gap-4 border-t border-line pt-3.5">
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink">{t("onb.newCampaign")}</span>
                <span className="mt-0.5 block text-[11.5px] leading-relaxed text-faint">{t("onb.newCampaignHint")}</span>
              </span>
              <Switch checked={bump} onChange={(v) => { setBump(v); setDirty(true); }} label={t("onb.newCampaign")} />
            </label>
          </Card>

          <Card className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-ink">{t("onb.copyTitle")}</h2>
              <SurfaceToggle value={surface} onChange={setSurface} t={t} />
            </div>
            {surface === "mobile" && (
              <label className="mt-3 flex items-center justify-between gap-4 rounded-xl bg-raised px-3 py-2.5">
                <span className="text-[13px] font-medium text-ink">{t("onb.sameOnMobile")}</span>
                <Switch checked={!cfg.mobileOverride}
                  onChange={(v) => patch({ mobileOverride: !v })} label={t("onb.sameOnMobile")} />
              </label>
            )}
            <div className={cn("mt-4 space-y-3", surface === "mobile" && !cfg.mobileOverride && "pointer-events-none opacity-50")}>
              <Field label={t("onb.notifTitle")} value={editing.notificationTitle}
                onChange={(v) => patchCopy("notificationTitle", v)} placeholder={t("bonus.notifTitle", values)} />
              <Field label={t("onb.notifBody")} value={editing.notificationBody}
                onChange={(v) => patchCopy("notificationBody", v)} placeholder={t("bonus.notifBody", values)} />
              <Field label={t("onb.modalTitle")} value={editing.modalTitle}
                onChange={(v) => patchCopy("modalTitle", v)} placeholder={t("bonus.modalTitle", values)} />
              <Field label={t("onb.modalSub")} value={editing.modalSubtitle}
                onChange={(v) => patchCopy("modalSubtitle", v)} placeholder={t("bonus.modalSub", values)} />
              <Field label={t("onb.cta")} value={editing.cta}
                onChange={(v) => patchCopy("cta", v)} placeholder={t("bonus.cta", values)} />
              <Field label={t("onb.successTitle")} value={editing.successTitle}
                onChange={(v) => patchCopy("successTitle", v)} placeholder={t("bonus.successTitle", values)} />
              <Field label={t("onb.successBody")} value={editing.successBody}
                onChange={(v) => patchCopy("successBody", v)} placeholder={t("bonus.successBody", values)} />
            </div>
            <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
              {t("onb.placeholders")}{" "}
              {BONUS_PLACEHOLDERS.map((p) => `{{${p}}}`).join(" · ")}
            </p>
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="text-sm font-semibold text-ink">{t("onb.questionsTitle")}</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-faint">{t("onb.questionsHint")}</p>
            <div className="mt-3 space-y-2.5">
              {cfg.questions.map((q, i) => (
                <QuestionRow
                  key={`${q.key}-${i}`}
                  q={q}
                  index={i}
                  total={cfg.questions.length}
                  onChange={(u) => setQuestion(i, u)}
                  onMove={(d) => move(i, d)}
                  onRemove={() => {
                    setCfg((prev) => ({ ...prev, questions: prev.questions.filter((_, x) => x !== i) }));
                    setDirty(true);
                  }}
                />
              ))}
            </div>
          </Card>
        </div>

        {/* ── PREVIEW ────────────────────────────────────────────────────── */}
        <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <Card className="p-4">
            <p className="overline mb-3">{t("onb.previewNotification")}</p>
            <div className="rounded-xl border border-[rgb(var(--accent)/0.35)] bg-[linear-gradient(135deg,rgb(var(--accent)/0.14),rgb(var(--violet)/0.08))] px-3 py-2.5">
              <p className="flex items-center gap-2 text-sm font-medium">
                <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--accent)/0.2)] text-accent">
                  <Gift size={13} />
                </span>
                <span className="min-w-0 flex-1 truncate">{shown(effective.notificationTitle, "bonus.notifTitle")}</span>
                <span className="shrink-0 rounded-full bg-[rgb(var(--accent)/0.2)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent">
                  {cfg.badge}
                </span>
              </p>
              <p className="text-xs text-muted">{shown(effective.notificationBody, "bonus.notifBody")}</p>
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            <p className="overline px-4 pb-2 pt-4">{t("onb.previewModal")}</p>
            {/* The preview is deliberately a SAMPLE offer (§56): it never reads
                a real customer's countdown. */}
            <div className={cn("mx-auto w-full px-4 pb-4", surface === "mobile" && "max-w-[360px]")}>
              <div className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[rgb(var(--accent)/0.16)] text-accent">
                    <Gift size={17} aria-hidden />
                  </span>
                  <span className="rounded-full bg-[rgb(var(--accent)/0.16)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                    {cfg.badge}
                  </span>
                </div>
                <p className="mt-2.5 font-display text-[17px] font-semibold leading-tight">
                  {shown(effective.modalTitle, "bonus.modalTitle")}
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                  {shown(effective.modalSubtitle, "bonus.modalSub")}
                </p>
                <p className="mt-2 text-[11.5px] text-faint">
                  {t("bonus.expiresIn")} <span className="metric tabular-nums">{formatCountdown(PREVIEW_SECONDS)}</span>
                </p>
                <div className="mt-3 space-y-2.5">
                  {cfg.questions.filter((q) => q.enabled).slice(0, 2).map((q) => (
                    <div key={q.key}>
                      <p className="mb-1.5 text-[12px] font-semibold text-ink">
                        {q.label?.trim() ? q.label : t(`bonus.q.${q.key}`)}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {q.options.slice(0, 4).map((o) => (
                          <span key={o.value} className="rounded-full border border-line px-2.5 py-1 text-[11px] text-muted">
                            {o.label?.trim() ? o.label : t(`bonus.opt.${q.key}.${o.value}`)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="cta mt-3.5 flex h-10 items-center justify-center rounded-xl text-[13px] font-semibold">
                  {shown(effective.cta, "bonus.cta")}
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <p className="overline mb-2">{t("onb.previewSuccess")}</p>
            <p className="font-display text-[15px] font-semibold">{shown(effective.successTitle, "bonus.successTitle")}</p>
            <p className="mt-1 text-[12.5px] text-muted">{shown(effective.successBody, "bonus.successBody")}</p>
          </Card>
        </div>
      </div>

      {/* Sticky save, clear of the mobile chrome. */}
      {dirty && (
        <div className="sticky bottom-0 z-30 -mx-1 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
          <div className="overlay flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5 shadow-e3">
            <span className="text-[13px] font-semibold text-ink">{t("onb.unsaved")}</span>
            <span className="min-w-0 flex-1" />
            <Button size="sm" onClick={() => void save()} disabled={busy}>
              {busy ? <Loader2 size={14} className="mr-2 animate-spin" aria-hidden /> : null}
              {t("common.save")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SurfaceToggle({ value, onChange, t }: {
  value: "desktop" | "mobile";
  onChange: (v: "desktop" | "mobile") => void;
  t: (k: string) => string;
}) {
  return (
    <div className="flex rounded-xl border border-line p-0.5">
      {([["desktop", Monitor], ["mobile", Smartphone]] as const).map(([key, Icon]) => (
        <button key={key} type="button" onClick={() => onChange(key)}
          aria-pressed={value === key}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold transition-colors",
            value === key ? "bg-[rgb(var(--accent)/0.14)] text-ink" : "text-muted hover:text-ink",
          )}>
          <Icon size={14} aria-hidden />
          {t(`onb.${key}`)}
        </button>
      ))}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} maxLength={400} className="mt-1.5" />
    </div>
  );
}

function QuestionRow({ q, index, total, onChange, onMove, onRemove }: {
  q: SurveyQuestion; index: number; total: number;
  onChange: (u: Partial<SurveyQuestion>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-line">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="flex flex-col">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0}
            aria-label={t("onb.moveUp")} className="text-faint hover:text-ink disabled:opacity-30">
            <ChevronUp size={13} aria-hidden />
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={index === total - 1}
            aria-label={t("onb.moveDown")} className="text-faint hover:text-ink disabled:opacity-30">
            <ChevronDown size={13} aria-hidden />
          </button>
        </span>
        <button type="button" onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[13.5px] font-semibold text-ink">
            {q.label?.trim() ? q.label : t(`bonus.q.${q.key}`)}
          </span>
          <span className="mt-0.5 block font-mono text-[11px] text-faint">
            {q.key} · {t(`onb.type.${q.type}`)} · {q.options.length} {t("onb.optionsCount")}
            {q.required ? ` · ${t("onb.required")}` : ""}
          </span>
        </button>
        <Switch checked={q.enabled} onChange={(v) => onChange({ enabled: v })} label={t("onb.enabled")} />
      </div>

      {open && (
        <div className="animate-fade space-y-3 border-t border-line bg-raised/40 px-3 py-3">
          <Field label={t("onb.questionLabel")} value={q.label ?? ""}
            onChange={(v) => onChange({ label: v })} placeholder={t(`bonus.q.${q.key}`)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>{t("onb.questionType")}</Label>
              <select value={q.type} onChange={(e) => onChange({ type: e.target.value as SurveyQuestion["type"] })}
                className="mt-1.5 h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-[rgb(var(--accent)/0.6)]">
                <option value="SINGLE_SELECT">{t("onb.type.SINGLE_SELECT")}</option>
                <option value="MULTI_SELECT">{t("onb.type.MULTI_SELECT")}</option>
              </select>
            </div>
            <label className="flex items-end justify-between gap-4 pb-1">
              <span className="text-[13px] font-medium text-ink">{t("onb.required")}</span>
              <Switch checked={q.required} onChange={(v) => onChange({ required: v })} label={t("onb.required")} />
            </label>
          </div>

          <div>
            <Label>{t("onb.options")}</Label>
            <div className="mt-1.5 space-y-1.5">
              {q.options.map((o, oi) => (
                <div key={`${o.value}-${oi}`} className="flex items-center gap-2">
                  <span className="w-32 shrink-0 truncate font-mono text-[11px] text-faint">{o.value}</span>
                  <Input value={o.label ?? ""} maxLength={120}
                    placeholder={t(`bonus.opt.${q.key}.${o.value}`)}
                    onChange={(e) => onChange({
                      options: q.options.map((x, xi) => (xi === oi ? { ...x, label: e.target.value } : x)),
                    })} />
                  <button type="button" aria-label={t("common.delete")}
                    onClick={() => onChange({ options: q.options.filter((_, xi) => xi !== oi) })}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-faint hover:text-danger">
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
              ))}
            </div>
            <Button variant="ghost" size="sm" className="mt-2"
              onClick={() => onChange({ options: [...q.options, { value: `option_${q.options.length + 1}`, label: "" }] })}>
              <Plus size={14} aria-hidden className="mr-1.5" />
              {t("onb.addOption")}
            </Button>
          </div>

          <div className="flex justify-end border-t border-line pt-2.5">
            <Button variant="ghost" size="sm" onClick={onRemove}>
              <Trash2 size={14} aria-hidden className="mr-1.5" />
              {t("onb.removeQuestion")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatsRow({ stats }: { stats: OnboardingStats | null }) {
  const { t } = useI18n();
  if (!stats) return null;
  const tiles: [string, string][] = [
    [t("onb.statIssued"), String(stats.issued)],
    [t("onb.statClaimed"), String(stats.claimed)],
    [t("onb.statExpired"), String(stats.expired)],
    [t("onb.statConversion"), `${stats.conversion}%`],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map(([label, value]) => (
        <Card key={label} className="p-3.5">
          <p className="text-[11px] uppercase tracking-wide text-faint">{label}</p>
          <p className="metric mt-1 text-xl text-ink">{value}</p>
        </Card>
      ))}
      {stats.averageHoursToClaim !== null && (
        <p className="col-span-2 px-1 text-[12px] text-faint lg:col-span-4">
          {t("onb.statAverage", { h: stats.averageHoursToClaim })}
        </p>
      )}
    </div>
  );
}
