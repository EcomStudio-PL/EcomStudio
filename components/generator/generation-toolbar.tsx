"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Check, ChevronUp, Layers, Loader2, Maximize, PenLine, Ratio as RatioIcon, Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Diamond } from "@/components/layout/credits-control";
import { BottomSheet } from "@/components/mobile/sheet";
import { modelBadgeLabel } from "@/lib/model-badge";
import { cn } from "@/lib/utils";

/**
 * GENERATION TOOLBAR — one control surface for every generator in the app.
 *
 * Every parameter that changes what gets rendered, and what it costs, lives
 * here and nowhere else: prompt mode, engine, framing, output size, shot
 * count, the running total and the CTA. Because it is docked, the page above
 * it never has to be scrolled to change a setting.
 *
 * On a phone the dock is TWO rows — a scrolling row of settings, then a full
 * width CTA carrying the price. Squeezing the Generate button into the same
 * row as five selectors is what produced "MOD / GPT" and "Przygotuj 5 …":
 * the primary action is the one thing that must never be abbreviated.
 *
 * Settings open in a bottom SHEET rather than expanding inline, so the page
 * behind them does not grow or shift.
 */

export type ToolbarModel = {
  id: string;
  name: string;
  badge: string | null;
  /** Base credits per output size, from the admin price table. */
  pricing: Record<string, number>;
  resolutions: string[];
  ratios: string[];
  /** Added to the base price when GrovBase writes the prompt. */
  ecomSurcharge: number;
};

export type ToolbarState = {
  mode: "engine" | "custom";
  modelId: string;
  ratio: string;
  resolution: string;
  shots: number;
};

const ALL_RATIOS = ["1:1", "4:5", "16:9", "9:16"] as const;
type Sheet = null | "mode" | "model" | "ratio" | "res" | "shots";

/** Ratio glyph: a rectangle in the real proportion, so 4:5 and 16:9 are
 *  distinguishable without reading the label. */
function RatioGlyph({ ratio }: { ratio: string }) {
  const [w, h] = ratio.split(":").map(Number);
  const scale = 13 / Math.max(w || 1, h || 1);
  return (
    <span aria-hidden className="inline-flex items-center justify-center" style={{ width: 15, height: 15 }}>
      <span
        className="block rounded-[2px] border-[1.5px] border-current"
        style={{ width: Math.max(5, Math.round((w || 1) * scale)), height: Math.max(5, Math.round((h || 1) * scale)) }}
      />
    </span>
  );
}

export function GenerationToolbar({
  models, state, onChange, shotRange, credits, disabled, busy, busyLabel, ctaLabel,
  onGenerate, note, promptSlot, modeLabels, extras, billableCount,
}: {
  models: ToolbarModel[];
  state: ToolbarState;
  onChange: (next: Partial<ToolbarState>) => void;
  /** Allowed shot counts, e.g. [5,6,7,8,9,10]. */
  shotRange: readonly number[];
  /** Wallet balance, shown next to the total. */
  credits: number;
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
  ctaLabel: string;
  onGenerate: () => void;
  note?: React.ReactNode;
  /** Rendered inside the prompt-mode sheet when mode is "custom". */
  promptSlot?: React.ReactNode;
  modeLabels?: { engine: string; custom: string };
  /** Category-specific controls appended after the standard ones. */
  extras?: React.ReactNode;
  /** How many images this run will actually bill for. Defaults to the shot
   *  count, but a custom-prompt run bills per prompt written. */
  billableCount?: number;
}) {
  const { t, locale } = useI18n();
  const [sheet, setSheet] = useState<Sheet>(null);

  const model = useMemo(
    () => models.find((m) => m.id === state.modelId) ?? models[0] ?? null,
    [models, state.modelId],
  );

  // Only what this engine can actually do. An engine with no declared
  // capability is treated as "no restriction", not as "offers nothing".
  const ratios = useMemo(() => {
    const supported = model?.ratios?.length ? model.ratios : [...ALL_RATIOS];
    return supported.filter((r) => (ALL_RATIOS as readonly string[]).includes(r));
  }, [model]);
  const resolutions = model?.resolutions ?? [];

  // A model swap can strip the current framing or size out from under the
  // seller — snap to something the engine renders instead of quoting a price
  // for a combination that will never run.
  useEffect(() => {
    if (!model) return;
    const patch: Partial<ToolbarState> = {};
    if (ratios.length > 0 && !ratios.includes(state.ratio)) patch.ratio = ratios[0];
    if (resolutions.length > 0 && !resolutions.includes(state.resolution)) patch.resolution = resolutions[0];
    if (Object.keys(patch).length > 0) onChange(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.id, ratios.join(), resolutions.join()]);

  const priceAt = (m: ToolbarModel | null, res: string, mode: ToolbarState["mode"]) => {
    if (!m) return 0;
    const base = m.pricing[res] ?? Object.values(m.pricing)[0] ?? 0;
    return base + (mode === "engine" ? m.ecomSurcharge : 0);
  };
  const perShot = priceAt(model, state.resolution, state.mode);
  const count = billableCount ?? state.shots;
  const total = perShot * count;
  const n = (v: number) => new Intl.NumberFormat(locale).format(v);
  const labels = modeLabels ?? { engine: t("mega.engine"), custom: t("mega.custom") };
  const blocked = disabled || busy || models.length === 0;

  const controls = (
    <>
      <Control icon={state.mode === "engine" ? Sparkles : PenLine} label={t("gtb.mode")}
        value={labels[state.mode]} onClick={() => setSheet("mode")} wide />
      <Control icon={Layers} label={t("gtb.model")} value={model?.name ?? "—"}
        onClick={() => setSheet("model")} wide disabled={models.length <= 1} />
      <Control icon={RatioIcon} label={t("gtb.ratio")} value={state.ratio}
        onClick={() => setSheet("ratio")} disabled={ratios.length <= 1} />
      {resolutions.length > 1 && (
        <Control icon={Maximize} label={t("gtb.res")} value={state.resolution} onClick={() => setSheet("res")} />
      )}
      {state.mode === "engine" && (
        <Control icon={Layers} label={t("gtb.shots")} value={String(state.shots)} onClick={() => setSheet("shots")} />
      )}
      {extras}
    </>
  );

  const cta = (
    <button
      type="button"
      onClick={onGenerate}
      disabled={blocked}
      className={cn(
        "cta flex min-h-[3rem] items-center justify-center gap-2 rounded-xl px-5 text-[14.5px] font-semibold",
        blocked && "cursor-not-allowed opacity-50",
      )}
    >
      {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Sparkles size={16} aria-hidden />}
      {/* The primary action is never abbreviated. */}
      <span>{busy ? busyLabel ?? ctaLabel : ctaLabel}</span>
    </button>
  );

  return (
    <>
      <div
        className={cn(
          "fixed inset-x-0 z-30 px-[var(--page-x)] sm:px-4 lg:px-6 xl:px-8",
          // Phones: sit directly on top of the bottom navigation, sharing its
          // gutter so the two bars read as one stack.
          "bottom-[calc(var(--dock-h)+env(safe-area-inset-bottom))] lg:bottom-3",
        )}
      >
        <div className="dock mx-auto w-full max-w-[var(--content-max)] rounded-2xl p-2 shadow-e4">
          {note && <div className="px-1 pb-1.5 text-center text-[11.5px]">{note}</div>}

          {/* PHONE — two rows: settings scroll, the CTA gets the full width. */}
          <div className="lg:hidden">
            <div className="thin-scroll -mx-1 flex items-stretch gap-1.5 overflow-x-auto px-1 pb-1.5">
              {controls}
            </div>
            <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">
                {t("concepts.perShot", { n: perShot })}
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="metric flex items-center gap-1 text-[15px] leading-none text-accent">
                  <Diamond size={7} />
                  {n(total)}
                </span>
                <span className="text-[10.5px] tabular-nums text-faint">{t("gtb.balance", { n: n(credits) })}</span>
              </span>
            </div>
            <div className="grid">{cta}</div>
          </div>

          {/* DESKTOP — one row: settings, the running cost, the CTA. */}
          <div className="hidden items-stretch gap-2 lg:flex">
            <div className="thin-scroll flex min-w-0 flex-1 items-stretch gap-1.5 overflow-x-auto">
              {controls}
            </div>
            <div className="flex shrink-0 flex-col justify-center border-l border-line px-3 text-right">
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
                {t("concepts.perShot", { n: perShot })}
              </span>
              <span className="metric flex items-center justify-end gap-1 text-[16px] leading-tight text-accent">
                <Diamond size={8} />
                {n(total)}
              </span>
              <span className="text-[10px] tabular-nums text-faint">{t("gtb.balance", { n: n(credits) })}</span>
            </div>
            <div className="shrink-0">{cta}</div>
          </div>
        </div>
      </div>

      {/* SHEETS — one per setting, opening over the page instead of inside it. */}
      <BottomSheet open={sheet === "mode"} onClose={() => setSheet(null)} title={t("gtb.mode")}>
        <div className="space-y-3 pb-1">
          <div className="grid gap-2 sm:grid-cols-2">
            {(["engine", "custom"] as const).map((m) => (
              <button key={m} type="button" onClick={() => onChange({ mode: m })} aria-pressed={state.mode === m}
                className={cn("rounded-xl border p-3 text-left transition-colors duration-200",
                  state.mode === m ? "is-selected" : "border-line hover:bg-raised")}>
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {m === "engine" ? <Sparkles size={14} className="text-accent" /> : <PenLine size={14} className="text-muted" />}
                  {labels[m]}
                  {state.mode === m && <Check size={13} strokeWidth={3} className="ml-auto text-accent" />}
                </span>
                <span className="mt-1 block text-[11.5px] leading-relaxed text-muted">{t(`gtb.mode_${m}Sub`)}</span>
                <span className="mt-1.5 block text-[11px] font-bold tabular-nums text-accent">
                  {t("concepts.perShot", { n: priceAt(model, state.resolution, m) })}
                </span>
              </button>
            ))}
          </div>
          {state.mode === "custom" && promptSlot}
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === "model"} onClose={() => setSheet(null)} title={t("gtb.model")}>
        <div className="grid gap-1.5 pb-1 sm:grid-cols-2">
          {models.map((m) => {
            const selected = m.id === model?.id;
            return (
              <button key={m.id} type="button" onClick={() => { onChange({ modelId: m.id }); setSheet(null); }}
                aria-pressed={selected}
                className={cn("flex min-h-[56px] items-center gap-3 rounded-xl border p-2.5 text-left transition-colors duration-200",
                  selected ? "is-selected" : "border-line hover:bg-raised")}>
                <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[linear-gradient(135deg,rgb(var(--accent)),rgb(var(--violet)))] text-[13px] font-bold text-white">
                  {m.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase() || "AI"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 truncate text-[13.5px] font-semibold">{m.name}</span>
                    {selected && <Check size={13} strokeWidth={3} className="shrink-0 text-accent" />}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11.5px] font-bold tabular-nums text-accent">
                      {t("concepts.perShot", { n: priceAt(m, state.resolution, state.mode) })}
                    </span>
                    {m.badge && (
                      <span className="rounded-full bg-raised px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted">
                        {modelBadgeLabel(m.badge, t)}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === "ratio"} onClose={() => setSheet(null)} title={t("gtb.ratio")}>
        <div className="grid grid-cols-4 gap-1.5 pb-1">
          {ratios.map((r) => (
            <button key={r} type="button" onClick={() => { onChange({ ratio: r }); setSheet(null); }}
              aria-pressed={r === state.ratio}
              className={cn("flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-xl border text-[12px] font-semibold transition-colors duration-200",
                r === state.ratio ? "is-selected text-accent" : "border-line text-muted hover:bg-raised")}>
              <RatioGlyph ratio={r} />
              {r}
            </button>
          ))}
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === "res"} onClose={() => setSheet(null)} title={t("gtb.res")}>
        <div className="grid grid-cols-3 gap-1.5 pb-1">
          {resolutions.map((r) => (
            <button key={r} type="button" onClick={() => { onChange({ resolution: r }); setSheet(null); }}
              aria-pressed={r === state.resolution}
              className={cn("min-h-[60px] rounded-xl border text-center transition-colors duration-200",
                r === state.resolution ? "is-selected" : "border-line hover:bg-raised")}>
              <span className={cn("block text-[14px] font-bold", r === state.resolution ? "text-accent" : "text-ink")}>{r}</span>
              <span className="mt-0.5 block text-[10.5px] tabular-nums text-faint">
                {t("concepts.perShot", { n: priceAt(model, r, state.mode) })}
              </span>
            </button>
          ))}
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === "shots"} onClose={() => setSheet(null)} title={t("gtb.shots")}>
        <div className="grid grid-cols-6 gap-1.5 pb-1">
          {shotRange.map((v) => (
            <button key={v} type="button" onClick={() => { onChange({ shots: v }); setSheet(null); }}
              aria-pressed={v === state.shots}
              className={cn("min-h-[52px] rounded-xl border text-sm font-bold tabular-nums transition-colors duration-200",
                v === state.shots ? "is-selected text-accent" : "border-line text-muted hover:bg-raised")}>
              {v}
            </button>
          ))}
        </div>
      </BottomSheet>
    </>
  );
}

/** One setting in the bar: icon, tiny label, current value, caret. Values
 *  are given real room — a control that cannot show its value is not a
 *  control, it is decoration. */
function Control({ icon: Icon, label, value, onClick, wide, disabled }: {
  icon: LucideIcon; label: string; value: string;
  onClick: () => void; wide?: boolean; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition-colors duration-200",
        "border-line hover:bg-raised",
        wide ? "min-w-[9.5rem]" : "min-w-[4.75rem]",
        disabled && "cursor-default opacity-60",
      )}
    >
      <Icon size={14} aria-hidden className="shrink-0 text-faint" />
      <span className="min-w-0 flex-1">
        <span className="block text-[9.5px] font-semibold uppercase leading-tight tracking-[0.1em] text-faint">{label}</span>
        <span className="block truncate text-[12.5px] font-semibold leading-tight text-ink">{value}</span>
      </span>
      {!disabled && <ChevronUp size={12} aria-hidden className="shrink-0 text-faint" />}
    </button>
  );
}
