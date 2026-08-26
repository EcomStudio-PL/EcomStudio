"use client";
import { useRef, useState } from "react";
import { ImagePlus, Info, Sparkles, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { GenerationToolbar, type ToolbarModel, type ToolbarState } from "@/components/generator/generation-toolbar";
import { cn } from "@/lib/utils";

type Slot = { url: string; name: string };

/**
 * MATCHING WORKSPACE — inspiration on the left, the product on the right,
 * settings underneath, then the generation CTA and the results shelf.
 *
 * The layout is real and fully interactive: files can be staged and removed,
 * the style-strength control works. What is deliberately NOT here is a
 * working generate call — no style-matching engine is connected, so the CTA
 * stays disabled behind an explicit notice rather than charging a credit for
 * an asset that would never arrive. Files are held in the browser only; the
 * page uploads nothing until there is a backend to upload for.
 */
export function MatchingWorkspace({ accent, models = [], credits = 0 }: {
  accent: string;
  /** The same engines every other generator offers, so the toolbar reads
   *  identically here — only the CTA is disabled. */
  models?: ToolbarModel[];
  credits?: number;
}) {
  const { t } = useI18n();
  const [inspiration, setInspiration] = useState<Slot | null>(null);
  const [product, setProduct] = useState<Slot[]>([]);
  const [strength, setStrength] = useState(60);
  const first = models[0];
  const [bar, setBar] = useState<ToolbarState>({
    mode: "engine",
    modelId: first?.id ?? "",
    ratio: "4:5",
    resolution: first?.resolutions[0] ?? "1K",
    shots: 5,
  });

  return (
    // Bottom padding clears the docked toolbar (and the phone dock under it).
    <div className={cn(models.length > 0 && "pb-[13rem] lg:pb-[8.5rem]")} style={{ ["--cat" as string]: accent }}>
      {/* THE TWO REFERENCE PANELS, side by side on desktop. */}
      <div className="grid gap-3.5 [&>*]:min-w-0 lg:grid-cols-2">
        <DropPanel
          title={t("match.inspirationTitle")}
          sub={t("match.inspirationSub")}
          uploadLabel={t("match.upload")}
          removeLabel={t("common.remove")}
          items={inspiration ? [inspiration] : []}
          max={1}
          onAdd={(files) => setInspiration(files[0] ?? null)}
          onRemove={() => setInspiration(null)}
        />
        <DropPanel
          title={t("match.productTitle")}
          sub={t("match.productSub")}
          uploadLabel={t("match.upload")}
          removeLabel={t("common.remove")}
          items={product}
          max={6}
          onAdd={(files) => setProduct((p) => [...p, ...files].slice(0, 6))}
          onRemove={(i) => setProduct((p) => p.filter((_, j) => j !== i))}
        />
      </div>

      {/* SETTINGS */}
      <div className="panel mt-3.5 rounded-2xl p-5">
        <p className="overline">{t("match.settingsTitle")}</p>
        <div className="mt-4 max-w-xl">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="match-strength" className="text-sm font-semibold">{t("match.strength")}</label>
            <span className="metric text-[15px] leading-none text-[rgb(var(--cat))]">{strength}%</span>
          </div>
          <input
            id="match-strength"
            type="range"
            min={10}
            max={90}
            step={5}
            value={strength}
            onChange={(e) => setStrength(Number(e.target.value))}
            className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[rgb(var(--ink)/0.12)] accent-[rgb(var(--cat))]"
          />
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{t("match.strengthSub")}</p>
        </div>
      </div>

      {/* WHY THE CTA IS DEAD — stated in full, above the bar that carries it. */}
      <div className="panel mt-3.5 flex items-start gap-3 rounded-2xl p-5">
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--cat)/0.18)] text-[rgb(var(--cat))]">
          <Info size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{t("match.disabledTitle")}</p>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted">{t("match.disabledBody")}</p>
        </div>
      </div>

      {/* RESULTS SHELF — the space the output will occupy, so the workspace
          reads as complete rather than truncated. */}
      <section className="mt-5">
        <p className="overline mb-2.5">{t("match.resultsTitle")}</p>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} aria-hidden
              className="flex aspect-square items-center justify-center rounded-xl border border-dashed border-[rgb(var(--cat)/0.28)] bg-sunken/50 text-faint">
              <Sparkles size={16} className="opacity-40" />
            </div>
          ))}
        </div>
        <p className="mt-2.5 text-[12.5px] text-faint">{t("match.resultsEmpty")}</p>
      </section>

      {/* THE SAME TOOLBAR every other generator uses — one component, one
          set of behaviours. Only the CTA is disabled, because no matching
          engine is connected; nothing here can spend a credit. */}
      {models.length > 0 && (
        <GenerationToolbar
          models={models}
          state={bar}
          onChange={(next) => setBar((b) => ({ ...b, ...next }))}
          shotRange={[3, 4, 5, 6, 7, 8]}
          credits={credits}
          disabled
          ctaLabel={t("match.generate")}
          onGenerate={() => { /* no engine: the button never fires */ }}
        />
      )}
    </div>
  );
}

/** One reference panel: a large drop target plus the staged thumbnails. */
function DropPanel({ title, sub, uploadLabel, removeLabel, items, max, onAdd, onRemove }: {
  title: string; sub: string; uploadLabel: string; removeLabel: string;
  items: Slot[]; max: number;
  onAdd: (files: Slot[]) => void;
  onRemove: (index: number) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = (list: FileList | null) => {
    if (!list) return;
    const picked = Array.from(list)
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, max)
      .map((f) => ({ url: URL.createObjectURL(f), name: f.name }));
    if (picked.length > 0) onAdd(picked);
  };

  return (
    <div className="panel flex flex-col rounded-2xl p-5">
      <p className="text-sm font-semibold tracking-tight">{title}</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{sub}</p>

      <input ref={ref} type="file" accept="image/*" multiple={max > 1} className="hidden"
        onChange={(e) => take(e.target.files)} />

      {items.length === 0 ? (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}
          className={cn(
            "mt-4 flex min-h-[13rem] flex-1 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed transition-colors duration-200",
            over
              ? "border-[rgb(var(--cat)/0.7)] bg-[rgb(var(--cat)/0.08)] text-[rgb(var(--cat))]"
              : "border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2.5))] bg-sunken/50 text-faint hover:border-[rgb(var(--cat)/0.55)] hover:text-[rgb(var(--cat))]",
          )}
        >
          <ImagePlus size={22} aria-hidden />
          <span className="text-[13px] font-semibold">{uploadLabel}</span>
        </button>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {items.map((it, i) => (
            <div key={it.url} className="group relative aspect-square overflow-hidden rounded-xl ring-1 ring-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2))]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.url} alt={it.name} className="h-full w-full object-cover" />
              <button type="button" aria-label={removeLabel} onClick={() => onRemove(i)}
                className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                <X size={11} />
              </button>
            </div>
          ))}
          {items.length < max && (
            <button type="button" onClick={() => ref.current?.click()}
              className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2.5))] bg-sunken/60 text-faint transition-colors duration-200 hover:border-[rgb(var(--cat)/0.6)] hover:text-[rgb(var(--cat))]">
              <ImagePlus size={18} aria-hidden />
              <span className="text-[10px] font-semibold">{uploadLabel}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
