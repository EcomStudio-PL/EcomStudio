"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check, ChevronUp, Layers, Loader2, Maximize, PenLine, Ratio as RatioIcon, Sparkles, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Diamond } from "@/components/layout/credits-control";
import { cn } from "@/lib/utils";

/**
 * GENERATION TOOLBAR — one control surface for every generator in the app.
 *
 * Every parameter that changes what gets rendered, and what it costs, lives
 * here and nowhere else: prompt mode, engine, framing, output size, shot
 * count, the running total and the CTA. Because it is docked, the page above
 * it never has to be scrolled to change a setting — which was the whole
 * problem with the four-tall-sections layout it replaces.
 *
 * The bar is capability-driven: it offers only the framings and sizes the
 * SELECTED model actually renders, and prices every combination from the
 * admin's own table. A control with a single legal value hides itself rather
 * than pretending to be a choice. Categories reuse this component and pass
 * their own workflow context — never a second copy of the same code.
 */

export type ToolbarModel = {
  id: string;
  name: string;
  badge: string | null;
  /** Base credits per output size, from the admin price table. */
  pricing: Record<string, number>;
  resolutions: string[];
  ratios: string[];
  /** Added to the base price when EcomStudio writes the prompt. */
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

/** Ratio glyph: a rectangle in the real proportion, so 4:5 and 16:9 are
 *  distinguishable without reading the label. */
function RatioGlyph({ ratio, className }: { ratio: string; className?: string }) {
  const [w, h] = ratio.split(":").map(Number);
  const scale = 13 / Math.max(w || 1, h || 1);
  return (
    <span aria-hidden className={cn("inline-flex items-center justify-center", className)} style={{ width: 15, height: 15 }}>
      <span
        className="block rounded-[2px] border-[1.5px] border-current"
        style={{ width: Math.max(5, Math.round((w || 1) * scale)), height: Math.max(5, Math.round((h || 1) * scale)) }}
      />
    </span>
  );
}

export function GenerationToolbar({
  models, state, onChange, shotRange, credits, disabled, busy, busyLabel, ctaLabel,
  onGenerate, note, promptSlot, modeLabels, extras,
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
  /** Called with the CTA label already interpolated by the caller. */
  ctaLabel: string;
  onGenerate: () => void;
  note?: React.ReactNode;
  /** Rendered inside the prompt-mode sheet when mode is "custom". */
  promptSlot?: React.ReactNode;
  modeLabels?: { engine: string; custom: string };
  /** Category-specific controls appended before the cost block. */
  extras?: React.ReactNode;
}) {
  const { t, locale } = useI18n();
  const [sheet, setSheet] = useState<null | "mode" | "model" | "ratio" | "res" | "shots">(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const model = useMemo(
    () => models.find((m) => m.id === state.modelId) ?? models[0] ?? null,
    [models, state.modelId],
  );

  // Only what this engine can actually do.
  const ratios = useMemo(() => {
    const supported = model?.ratios?.length ? model.ratios : [...ALL_RATIOS];
    return ALL_RATIOS.filter((r) => supported.includes(r));
  }, [model]);
  const resolutions = model?.resolutions ?? [];

  // A model swap can strip the current framing or size out from under the
  // seller — snap to something the engine renders instead of quoting a price
  // for a combination that will never run.
  useEffect(() => {
    if (!model) return;
    const patch: Partial<ToolbarState> = {};
    if (ratios.length > 0 && !ratios.includes(state.ratio as (typeof ALL_RATIOS)[number])) patch.ratio = ratios[0];
    if (resolutions.length > 0 && !resolutions.includes(state.resolution)) patch.resolution = resolutions[0];
    if (Object.keys(patch).length > 0) onChange(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.id, ratios.join(), resolutions.join()]);

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSheet(null); };
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setSheet(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, [sheet]);

  const perShot = model
    ? (model.pricing[state.resolution] ?? Object.values(model.pricing)[0] ?? 0)
      + (state.mode === "engine" ? model.ecomSurcharge : 0)
    : 0;
  const total = perShot * state.shots;
  const short = (n: number) => new Intl.NumberFormat(locale).format(n);
  const labels = modeLabels ?? { engine: t("mega.engine"), custom: t("mega.custom") };

  const toggle = (which: typeof sheet) => setSheet((s) => (s === which ? null : which));

  return (
    <div
      ref={rootRef}
      className={cn(
        // Docked to the bottom of the viewport on every size. On phones it
        // sits directly above the bottom navigation; on desktop there is no
        // dock below it, so it hugs the edge.
        "fixed inset-x-0 z-30 px-3 sm:px-4 lg:px-6 xl:px-8",
        "bottom-[calc(var(--dock-h)+0.4rem+env(safe-area-inset-bottom))] lg:bottom-3",
      )}
    >
      <div className="mx-auto w-full max-w-[var(--content-max)]">
        {/* SHEETS — every setting opens above the bar, so the page behind it
            never scrolls and the form is never covered. */}
        {sheet && (
          <div className="dock animate-pop mb-2 max-h-[52dvh] overflow-y-auto rounded-2xl p-3.5 shadow-e4">
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <p className="overline">{t(`gtb.${sheet}`)}</p>
              <button type="button" onClick={() => setSheet(null)} aria-label={t("common.close")}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-faint transition-colors duration-200 hover:bg-raised hover:text-ink">
                <X size={14} />
              </button>
            </div>

            {sheet === "mode" && (
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  {(["engine", "custom"] as const).map((m) => (
                    <button key={m} type="button" onClick={() => onChange({ mode: m })} aria-pressed={state.mode === m}
                      className={cn("rounded-xl border p-3 text-left transition-colors duration-200",
                        state.mode === m ? "is-selected" : "border-line hover:bg-raised")}>
                      <span className="flex items-center gap-2 text-sm font-semibold">
                        {m === "engine" ? <Sparkles size={14} className="text-accent" /> : <PenLine size={14} className="text-muted" />}
                        {labels[m]}
                      </span>
                      <span className="mt-1 block text-[11.5px] leading-relaxed text-muted">{t(`gtb.mode_${m}Sub`)}</span>
                      {model && (
                        <span className="mt-1.5 block text-[11px] font-bold tabular-nums text-accent">
                          {t("concepts.perShot", {
                            n: (model.pricing[state.resolution] ?? 0) + (m === "engine" ? model.ecomSurcharge : 0),
                          })}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                {state.mode === "custom" && promptSlot}
              </div>
            )}

            {sheet === "model" && (
              <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                {models.map((m) => {
                  const price = (m.pricing[state.resolution] ?? Object.values(m.pricing)[0] ?? 0)
                    + (state.mode === "engine" ? m.ecomSurcharge : 0);
                  const selected = m.id === model?.id;
                  return (
                    <button key={m.id} type="button" onClick={() => { onChange({ modelId: m.id }); setSheet(null); }}
                      aria-pressed={selected}
                      className={cn("flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-colors duration-200",
                        selected ? "is-selected" : "border-line hover:bg-raised")}>
                      <span aria-hidden className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold text-white",
                        "bg-[linear-gradient(135deg,rgb(var(--accent)),rgb(var(--violet)))]",
                      )}>
                        {m.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase() || "AI"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="min-w-0 truncate text-[13px] font-semibold">{m.name}</span>
                          {selected && <Check size={12} strokeWidth={3} className="shrink-0 text-accent" />}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5">
                          <span className="text-[11px] font-bold tabular-nums text-accent">{t("concepts.perShot", { n: price })}</span>
                          {m.badge && (
                            <span className="truncate rounded-full bg-raised px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted">
                              {t(`models.badge.${m.badge}`, {}) || m.badge}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {sheet === "ratio" && (
              <div className="grid grid-cols-4 gap-1.5">
                {ratios.map((r) => (
                  <button key={r} type="button" onClick={() => { onChange({ ratio: r }); setSheet(null); }}
                    aria-pressed={r === state.ratio}
                    className={cn("flex flex-col items-center gap-1.5 rounded-xl border py-2.5 text-[12px] font-semibold transition-colors duration-200",
                      r === state.ratio ? "is-selected text-accent" : "border-line text-muted hover:bg-raised")}>
                    <RatioGlyph ratio={r} />
                    {r}
                  </button>
                ))}
              </div>
            )}

            {sheet === "res" && (
              <div className="grid grid-cols-3 gap-1.5">
                {resolutions.map((r) => (
                  <button key={r} type="button" onClick={() => { onChange({ resolution: r }); setSheet(null); }}
                    aria-pressed={r === state.resolution}
                    className={cn("rounded-xl border py-2.5 text-center transition-colors duration-200",
                      r === state.resolution ? "is-selected" : "border-line hover:bg-raised")}>
                    <span className={cn("block text-[13px] font-bold", r === state.resolution ? "text-accent" : "text-ink")}>{r}</span>
                    <span className="mt-0.5 block text-[10.5px] tabular-nums text-faint">
                      {t("concepts.perShot", { n: (model?.pricing[r] ?? 0) + (state.mode === "engine" ? model?.ecomSurcharge ?? 0 : 0) })}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {sheet === "shots" && (
              <div className="grid grid-cols-6 gap-1.5">
                {shotRange.map((n) => (
                  <button key={n} type="button" onClick={() => { onChange({ shots: n }); setSheet(null); }}
                    aria-pressed={n === state.shots}
                    className={cn("rounded-xl border py-2.5 text-sm font-bold tabular-nums transition-colors duration-200",
                      n === state.shots ? "is-selected text-accent" : "border-line text-muted hover:bg-raised")}>
                    {n}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* THE BAR */}
        <div className="dock rounded-2xl p-2 shadow-e4">
          {note && <div className="px-1 pb-2 text-center text-[11.5px]">{note}</div>}

          <div className="flex items-stretch gap-2">
            {/* CONTROLS — a horizontal scroller on phones so nothing wraps
                into a second row and steals vertical space from the form. */}
            <div className="thin-scroll flex min-w-0 flex-1 items-stretch gap-1.5 overflow-x-auto">
              <Control icon={state.mode === "engine" ? Sparkles : PenLine} label={t("gtb.mode")}
                value={labels[state.mode]} open={sheet === "mode"} onClick={() => toggle("mode")} wide />
              <Control icon={Layers} label={t("gtb.model")} value={model?.name ?? "—"}
                open={sheet === "model"} onClick={() => toggle("model")} wide
                disabled={models.length <= 1} />
              <Control icon={RatioIcon} label={t("gtb.ratio")} value={state.ratio}
                open={sheet === "ratio"} onClick={() => toggle("ratio")} disabled={ratios.length <= 1} />
              {resolutions.length > 1 && (
                <Control icon={Maximize} label={t("gtb.res")} value={state.resolution}
                  open={sheet === "res"} onClick={() => toggle("res")} />
              )}
              {state.mode === "engine" && (
                <Control icon={Layers} label={t("gtb.shots")} value={String(state.shots)}
                  open={sheet === "shots"} onClick={() => toggle("shots")} />
              )}
              {extras}
            </div>

            {/* COST — always visible, always current. */}
            <div className="hidden shrink-0 flex-col justify-center border-l border-line px-3 text-right lg:flex">
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
                {t("concepts.perShot", { n: perShot })}
              </span>
              <span className="metric flex items-center justify-end gap-1 text-[16px] leading-tight text-accent">
                <Diamond size={8} />
                {short(total)}
              </span>
              <span className="text-[10px] tabular-nums text-faint">{t("gtb.balance", { n: short(credits) })}</span>
            </div>

            <button
              type="button"
              onClick={onGenerate}
              disabled={disabled || busy}
              className={cn(
                "cta flex h-auto min-h-[3rem] shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-[14px] font-semibold sm:px-6",
                (disabled || busy) && "cursor-not-allowed opacity-50",
              )}
            >
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Sparkles size={16} aria-hidden />}
              <span className="truncate">{busy ? busyLabel ?? ctaLabel : ctaLabel}</span>
            </button>
          </div>

          {/* Phone cost line — the desktop column has no room here. */}
          <div className="mt-1.5 flex items-center justify-between gap-2 px-1 lg:hidden">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">
              {t("concepts.perShot", { n: perShot })}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="metric flex items-center gap-1 text-[14px] leading-none text-accent">
                <Diamond size={7} />
                {short(total)}
              </span>
              <span className="text-[10.5px] tabular-nums text-faint">/ {short(credits)}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One setting in the bar: icon, tiny label, current value, caret. */
function Control({ icon: Icon, label, value, open, onClick, wide, disabled }: {
  icon: LucideIcon; label: string; value: string; open: boolean;
  onClick: () => void; wide?: boolean; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={open}
      className={cn(
        "group flex shrink-0 items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition-colors duration-200",
        wide ? "min-w-[8.5rem]" : "min-w-[4.5rem]",
        open ? "is-selected" : "border-line hover:bg-raised",
        disabled && "cursor-default opacity-60",
      )}
    >
      <Icon size={14} aria-hidden className={cn("shrink-0", open ? "text-accent" : "text-faint")} />
      <span className="min-w-0 flex-1">
        <span className="block text-[9.5px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</span>
        <span className="block truncate text-[12.5px] font-semibold text-ink">{value}</span>
      </span>
      {!disabled && (
        <ChevronUp size={12} aria-hidden
          className={cn("shrink-0 text-faint transition-transform duration-200", open && "rotate-180")} />
      )}
    </button>
  );
}
