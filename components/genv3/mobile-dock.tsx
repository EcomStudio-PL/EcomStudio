"use client";
import { useState } from "react";
import Link from "next/link";
import { Check, Layers, Loader2, Maximize, Minus, PenLine, Plus, Ratio as RatioIcon, SlidersHorizontal, Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { BottomSheet } from "@/components/mobile/sheet";
import { ratioIcon, ratioName } from "@/components/genv3/ratio-options";
import { Diamond } from "@/components/layout/credits-control";
import { ModelBadge, ModelTile } from "@/components/genv3/model-select";
import type { GenModel } from "@/components/genv3/types";
import { cn } from "@/lib/utils";

type Sheet = null | "mode" | "model" | "ratio" | "res" | "quality" | "count";


/**
 * MOBILE GENERATION DOCK — phones only (hidden from lg up, where the left
 * panel owns every control). One thumb-reachable bar above the bottom
 * navigation: mode, model, format, size, count as compact chips opening
 * bottom sheets, then the price line, then a full-width CTA that is never
 * abbreviated.
 */
export function MobileDock({
  managed, models, modelId, onModel, ratio, ratios, onRatio,
  resolution, resolutions, onResolution, quality, qualities, onQuality, count, maxCount, onCount,
  perShot, total, balance, busy, busyLabel, canGenerate, onGenerate, priceOf,
}: {
  managed: boolean;
  models: GenModel[];
  modelId: string;
  onModel: (id: string) => void;
  ratio: string; ratios: string[]; onRatio: (v: string) => void;
  resolution: string; resolutions: string[]; onResolution: (v: string) => void;
  /** Present only for a model that declares render qualities. */
  quality?: string; qualities: string[]; onQuality: (v: string) => void;
  count: number; maxCount: number; onCount: (v: number) => void;
  perShot: number; total: number; balance: number;
  busy: boolean; busyLabel: string;
  canGenerate: boolean;
  onGenerate: () => void;
  priceOf: (m: GenModel) => number;
}) {
  const { t, locale } = useI18n();
  const [sheet, setSheet] = useState<Sheet>(null);
  const model = models.find((m) => m.id === modelId) ?? models[0];
  const n = (v: number) => new Intl.NumberFormat(locale).format(v);
  const qualityLabel = (q: string) =>
    q === "low" ? t("genv3.qualityLow") : q === "high" ? t("genv3.qualityHigh") : t("genv3.qualityMedium");

  return (
    <>
      <div className="fixed inset-x-0 z-30 px-[var(--page-x)] lg:hidden"
        style={{ bottom: "calc(var(--dock-h) + env(safe-area-inset-bottom))" }}>
        <div className="dock mx-auto w-full max-w-[var(--content-max)] rounded-2xl p-2 shadow-e4">
          <div className="thin-scroll -mx-1 flex items-stretch gap-1.5 overflow-x-auto px-1 pb-1.5">
            <DockChip icon={managed ? Sparkles : PenLine} label={t("gtb.mode")}
              value={managed ? t("genv3.modeManaged") : t("genv3.modeCustom")}
              onClick={() => setSheet("mode")} wide />
            <DockChip icon={Layers} label={t("gtb.model")} value={model?.name ?? "—"}
              onClick={() => setSheet("model")} wide disabled={models.length <= 1} />
            <DockChip icon={RatioIcon} label={t("gtb.ratio")} value={ratioName(t, ratio)}
              onClick={() => setSheet("ratio")} disabled={ratios.length <= 1} />
            <DockChip icon={Maximize} label={t("gtb.res")} value={resolution}
              onClick={() => setSheet("res")} disabled={resolutions.length <= 1} />
            {qualities.length > 0 && quality && (
              <DockChip icon={SlidersHorizontal} label={t("genv3.quality")} value={qualityLabel(quality)}
                onClick={() => setSheet("quality")} disabled={qualities.length <= 1} />
            )}
            <DockChip icon={Layers} label={managed ? t("genv3.countShots") : t("genv3.countImages")}
              value={String(count)} onClick={() => setSheet("count")} disabled={maxCount <= 1} />
          </div>
          <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">
              {t("concepts.perShot", { n: perShot })}
            </span>
            <span className="flex items-baseline gap-1.5">
              <span className="metric flex items-center gap-1 text-[15px] leading-none text-accent">
                <Diamond size={7} />{n(total)}
              </span>
              <span className="text-[10.5px] tabular-nums text-faint">{t("gtb.balance", { n: n(balance) })}</span>
            </span>
          </div>
          <button type="button" disabled={!canGenerate} onClick={onGenerate}
            aria-label={busy && busyLabel ? busyLabel : `${t("genv3.generateCta")} · ${n(total)} ${t("genv3.credits")}`}
            className={cn("cta flex min-h-[3rem] w-full items-center justify-center gap-2 rounded-xl px-5 text-[14.5px] font-semibold",
              !canGenerate && "cursor-not-allowed opacity-55")}>
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Sparkles size={16} aria-hidden />}
            {busy && busyLabel ? (
              <span>{busyLabel}</span>
            ) : (
              <>
                <span>{t("genv3.generateCta")}</span>
                <span aria-hidden className="opacity-60">•</span>
                <span className="tabular-nums">{n(total)}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* TRYB — the two generators are two routes; switching navigates. */}
      <BottomSheet open={sheet === "mode"} onClose={() => setSheet(null)} title={t("gtb.mode")}>
        <div className="grid gap-2 pb-1">
          {([
            { key: "managed", href: "/prompts", icon: Sparkles, name: t("genv3.modeManaged"), sub: t("genv3.modeManagedSub") },
            { key: "custom", href: "/generator", icon: PenLine, name: t("genv3.modeCustom"), sub: t("genv3.modeCustomSub") },
          ] as const).map((m) => {
            const on = managed ? m.key === "managed" : m.key === "custom";
            return on ? (
              <div key={m.key} className="is-selected rounded-xl border p-3">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <m.icon size={14} className="text-accent" aria-hidden />{m.name}
                  <Check size={13} strokeWidth={3} className="ml-auto text-accent" aria-hidden />
                </span>
                <span className="mt-1 block text-[11.5px] leading-relaxed text-muted">{m.sub}</span>
              </div>
            ) : (
              <Link key={m.key} href={m.href}
                className="rounded-xl border border-line p-3 transition-colors hover:bg-raised">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <m.icon size={14} className="text-muted" aria-hidden />{m.name}
                </span>
                <span className="mt-1 block text-[11.5px] leading-relaxed text-muted">{m.sub}</span>
              </Link>
            );
          })}
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === "model"} onClose={() => setSheet(null)} title={t("gtb.model")}>
        <div className="grid gap-1.5 pb-1">
          {models.map((m, idx) => {
            const on = m.id === model?.id;
            return (
              <button key={m.id} type="button" aria-pressed={on}
                onClick={() => { onModel(m.id); setSheet(null); }}
                className={cn("flex min-h-[56px] items-center gap-3 rounded-xl border p-2.5 text-left transition-colors duration-200",
                  on ? "is-selected" : "border-line hover:bg-raised")}>
                <ModelTile name={m.name} index={idx} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 truncate text-[13.5px] font-semibold">{m.name}</span>
                    <ModelBadge model={m} />
                    {on && <Check size={13} strokeWidth={3} className="ml-auto shrink-0 text-accent" aria-hidden />}
                  </span>
                  {m.description && (
                    <span className="mt-0.5 line-clamp-1 block text-[11px] text-faint">{m.description}</span>
                  )}
                  <span className="mt-0.5 block text-[11.5px] font-bold tabular-nums text-accent">
                    {t("genv3.perShotShort", { n: priceOf(m) })}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </BottomSheet>

      {/* One row per format: shape, ratio, nothing else — the same two things
          the desktop dropdown shows, at thumb size. */}
      <BottomSheet open={sheet === "ratio"} onClose={() => setSheet(null)} title={t("gtb.ratio")}>
        <div className="grid gap-1.5 pb-1">
          {ratios.map((r) => {
            const on = r === ratio;
            return (
              <button key={r} type="button" aria-pressed={on} data-ratio-row={r}
                onClick={() => { onRatio(r); setSheet(null); }}
                className={cn("flex min-h-[52px] items-center gap-3 rounded-xl border px-3 text-left transition-colors duration-200",
                  on ? "is-selected" : "border-line hover:bg-raised")}>
                <span className={cn("flex w-6 shrink-0 items-center justify-center", on ? "text-accent" : "text-muted")}>
                  {ratioIcon(r)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tabular-nums">
                  {ratioName(t, r)}
                </span>
                {on && <Check size={13} strokeWidth={3} aria-hidden className="shrink-0 text-accent" />}
              </button>
            );
          })}
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === "res"} onClose={() => setSheet(null)} title={t("gtb.res")}>
        <div className="grid grid-cols-3 gap-1.5 pb-1">
          {resolutions.map((r) => (
            <button key={r} type="button" aria-pressed={r === resolution}
              onClick={() => { onResolution(r); setSheet(null); }}
              className={cn("min-h-[60px] rounded-xl border text-center transition-colors duration-200",
                r === resolution ? "is-selected" : "border-line hover:bg-raised")}>
              <span className={cn("block text-[14px] font-bold", r === resolution ? "text-accent" : "text-ink")}>{r}</span>
            </button>
          ))}
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === "quality"} onClose={() => setSheet(null)} title={t("genv3.quality")}>
        <div className="grid grid-cols-3 gap-1.5 pb-1">
          {qualities.map((q) => (
            <button key={q} type="button" aria-pressed={q === quality}
              onClick={() => { onQuality(q); setSheet(null); }}
              className={cn("min-h-[60px] rounded-xl border text-center transition-colors duration-200",
                q === quality ? "is-selected" : "border-line hover:bg-raised")}>
              <span className={cn("block text-[14px] font-bold", q === quality ? "text-accent" : "text-ink")}>{qualityLabel(q)}</span>
            </button>
          ))}
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === "count"} onClose={() => setSheet(null)}
        title={managed ? t("genv3.countShots") : t("genv3.countImages")}>
        <div className="flex items-center justify-center gap-5 pb-2 pt-1">
          <button type="button" aria-label={t("genv3.less")} disabled={count <= 1}
            onClick={() => onCount(Math.max(1, count - 1))}
            className="flex h-12 w-12 items-center justify-center rounded-xl border border-line text-ink transition-colors hover:bg-raised disabled:opacity-40">
            <Minus size={18} aria-hidden />
          </button>
          <span className="metric w-14 text-center text-3xl">{count}</span>
          <button type="button" aria-label={t("genv3.more")} disabled={count >= maxCount}
            onClick={() => onCount(Math.min(maxCount, count + 1))}
            className="flex h-12 w-12 items-center justify-center rounded-xl border border-line text-ink transition-colors hover:bg-raised disabled:opacity-40">
            <Plus size={18} aria-hidden />
          </button>
        </div>
        <p className="pb-1 text-center text-[11.5px] tabular-nums text-faint">1–{maxCount}</p>
      </BottomSheet>
    </>
  );
}

function DockChip({ icon: Icon, label, value, onClick, wide, disabled }: {
  icon: typeof Sparkles; label: string; value: string;
  onClick: () => void; wide?: boolean; disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-xl border border-line px-2.5 py-1.5 text-left transition-colors duration-200 hover:bg-raised",
        wide ? "min-w-[8.5rem]" : "min-w-[4.5rem]",
        disabled && "cursor-default opacity-60",
      )}>
      <Icon size={14} aria-hidden className="shrink-0 text-faint" />
      <span className="min-w-0 flex-1">
        <span className="block text-[9.5px] font-semibold uppercase leading-tight tracking-[0.1em] text-faint">{label}</span>
        <span className="block truncate text-[12.5px] font-semibold leading-tight text-ink">{value}</span>
      </span>
    </button>
  );
}
