"use client";
import { useI18n } from "@/lib/i18n/provider";
import { Input, Label, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import {
  ASPECT_RATIOS, BACKGROUND_PRESETS, COMPRESSION_LEVELS, OUTPUT_FORMATS,
  SHADOW_STYLES, SIZE_PRESETS, UPSCALE_FACTORS, WATERMARK_POSITIONS,
  type ToolSlug,
} from "@/lib/images/tools";
import { cn } from "@/lib/utils";

type Settings = Record<string, unknown>;
type Patch = (patch: Settings) => void;

/**
 * TOOL SETTINGS — every dial for every tool, in one place.
 *
 * Controls are laid out as a single stacked column so they read the same at
 * 320px and on a desktop rail; the server re-clamps every value anyway, so
 * the panel is free to be forgiving about what a seller types.
 */
export function ToolSettingsPanel({ tool, settings, onChange }: {
  tool: ToolSlug;
  settings: Settings;
  onChange: Patch;
}) {
  const { t } = useI18n();
  const set = (patch: Settings) => onChange({ ...settings, ...patch });

  switch (tool) {
    case "upscale":
      return (
        <Field label={t("tools.opt.factor")}>
          <Segmented
            value={String(settings.factor ?? 2)}
            onChange={(v) => set({ factor: Number(v) })}
            options={UPSCALE_FACTORS.map((f) => ({ value: String(f), label: `${f}×` }))}
          />
        </Field>
      );

    case "remove_bg":
      return (
        <Field label={t("tools.opt.format")} hint={t("tools.opt.alphaHint")}>
          <Segmented
            value={String(settings.format ?? "png")}
            onChange={(v) => set({ format: v })}
            options={[{ value: "png", label: "PNG" }, { value: "webp", label: "WebP" }]}
          />
        </Field>
      );

    case "expand":
      return (
        <Field label={t("tools.opt.ratio")} hint={t("tools.opt.ratioHint")}>
          <Segmented
            value={String(settings.ratio ?? "1:1")}
            onChange={(v) => set({ ratio: v })}
            options={ASPECT_RATIOS.map((r) => ({ value: r, label: r }))}
          />
        </Field>
      );

    case "white_bg":
      return (
        <>
          <Field label={t("tools.opt.color")}>
            <ColorRow value={String(settings.color ?? "#FFFFFF")} onChange={(color) => set({ color })} />
          </Field>
          <Slider label={t("tools.opt.padding")} value={Number(settings.padding ?? 0)} min={0} max={25}
            suffix="%" onChange={(padding) => set({ padding })} />
          <Field label={t("tools.opt.format")}>
            <Segmented
              value={String(settings.format ?? "jpeg")}
              onChange={(v) => set({ format: v })}
              options={OUTPUT_FORMATS.map((f) => ({ value: f, label: f.toUpperCase() }))}
            />
          </Field>
          <Slider label={t("tools.opt.quality")} value={Number(settings.quality ?? 92)} min={40} max={100}
            onChange={(quality) => set({ quality })} />
        </>
      );

    case "shadow":
      return (
        <>
          <Field label={t("tools.opt.style")} hint={t("tools.opt.shadowHint")}>
            <Segmented
              value={String(settings.style ?? "soft")}
              onChange={(v) => set({ style: v })}
              options={SHADOW_STYLES.map((s) => ({ value: s, label: t(`tools.shadowStyle.${s}`) }))}
            />
          </Field>
          <Slider label={t("tools.opt.opacity")} value={Number(settings.opacity ?? 35)} min={5} max={100}
            suffix="%" onChange={(opacity) => set({ opacity })} />
          <Slider label={t("tools.opt.blur")} value={Number(settings.blur ?? 24)} min={1} max={120}
            suffix="px" onChange={(blur) => set({ blur })} />
          <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
            <Slider label={t("tools.opt.offsetX")} value={Number(settings.offsetX ?? 0)} min={-150} max={150}
              suffix="px" onChange={(offsetX) => set({ offsetX })} />
            <Slider label={t("tools.opt.offsetY")} value={Number(settings.offsetY ?? 18)} min={-150} max={150}
              suffix="px" onChange={(offsetY) => set({ offsetY })} />
          </div>
          <Field label={t("tools.opt.background")}>
            <ColorRow value={String(settings.background ?? "#FFFFFF")} onChange={(background) => set({ background })} />
          </Field>
        </>
      );

    case "format":
      return (
        <>
          <Field label={t("tools.opt.preset")}>
            <Select
              value={presetKeyFor(settings)}
              onChange={(e) => {
                const preset = SIZE_PRESETS.find((p) => p.key === e.target.value);
                if (preset) set({ width: preset.width, height: preset.height });
              }}
            >
              {SIZE_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>{t(`tools.preset.${p.key}`)}</option>
              ))}
              <option value="custom">{t("tools.preset.custom")}</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
            <Field label={t("tools.opt.width")}>
              <Input type="number" inputMode="numeric" min={16} max={8000}
                value={settings.width == null ? "" : String(settings.width)}
                placeholder={t("tools.opt.auto")}
                onChange={(e) => set({ width: e.target.value === "" ? null : Number(e.target.value) })} />
            </Field>
            <Field label={t("tools.opt.height")}>
              <Input type="number" inputMode="numeric" min={16} max={8000}
                value={settings.height == null ? "" : String(settings.height)}
                placeholder={t("tools.opt.auto")}
                onChange={(e) => set({ height: e.target.value === "" ? null : Number(e.target.value) })} />
            </Field>
          </div>
          <Field label={t("tools.opt.fit")} hint={t("tools.opt.fitHint")}>
            <Segmented
              value={String(settings.fit ?? "inside")}
              onChange={(v) => set({ fit: v })}
              options={[
                { value: "inside", label: t("tools.fit.inside") },
                { value: "cover", label: t("tools.fit.cover") },
              ]}
            />
          </Field>
          <Field label={t("tools.opt.format")}>
            <Segmented
              value={String(settings.format ?? "jpeg")}
              onChange={(v) => set({ format: v })}
              options={OUTPUT_FORMATS.map((f) => ({ value: f, label: f.toUpperCase() }))}
            />
          </Field>
          <Slider label={t("tools.opt.quality")} value={Number(settings.quality ?? 90)} min={40} max={100}
            onChange={(quality) => set({ quality })} />
        </>
      );

    case "compress":
      return (
        <>
          <Field label={t("tools.opt.level")} hint={t("tools.opt.levelHint")}>
            <Segmented
              value={String(settings.level ?? "auto")}
              onChange={(v) => set({ level: v })}
              options={COMPRESSION_LEVELS.map((l) => ({ value: l, label: t(`tools.level.${l}`) }))}
            />
          </Field>
          <Field label={t("tools.opt.format")}>
            <Segmented
              value={String(settings.format ?? "keep")}
              onChange={(v) => set({ format: v })}
              options={[
                { value: "keep", label: t("tools.opt.keep") },
                ...OUTPUT_FORMATS.map((f) => ({ value: f, label: f.toUpperCase() })),
              ]}
            />
          </Field>
        </>
      );

    default:
      return (
        <>
          <Field label={t("tools.opt.position")}>
            <PositionGrid value={String(settings.position ?? "bottom-right")}
              onChange={(position) => set({ position })} />
          </Field>
          <Slider label={t("tools.opt.scale")} value={Number(settings.scale ?? 18)} min={2} max={100}
            suffix="%" onChange={(scale) => set({ scale })} />
          <Slider label={t("tools.opt.opacity")} value={Number(settings.opacity ?? 60)} min={5} max={100}
            suffix="%" onChange={(opacity) => set({ opacity })} />
          {settings.position === "pattern" ? (
            <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
              <Slider label={t("tools.opt.rotation")} value={Number(settings.rotation ?? 0)} min={-90} max={90}
                suffix="°" onChange={(rotation) => set({ rotation })} />
              <Slider label={t("tools.opt.spacing")} value={Number(settings.spacing ?? 24)} min={0} max={200}
                onChange={(spacing) => set({ spacing })} />
            </div>
          ) : (
            <Slider label={t("tools.opt.margin")} value={Number(settings.margin ?? 4)} min={0} max={40}
              suffix="%" onChange={(margin) => set({ margin })} />
          )}
        </>
      );
  }
}

function presetKeyFor(settings: Settings): string {
  const match = SIZE_PRESETS.find((p) => p.width === (settings.width ?? null) && p.height === (settings.height ?? null));
  return match?.key ?? "custom";
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label hint={hint}>{label}</Label>
      {children}
    </div>
  );
}

function Slider({ label, value, min, max, suffix, onChange }: {
  label: string; value: number; min: number; max: number; suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-muted">{label}</span>
        <span className="shrink-0 text-[12px] font-semibold tabular-nums">{value}{suffix ?? ""}</span>
      </div>
      <input type="range" min={min} max={max} value={value} aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[rgb(var(--accent))]" />
    </div>
  );
}

function ColorRow({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {BACKGROUND_PRESETS.map((preset) => (
        <button key={preset} type="button" onClick={() => onChange(preset)} aria-label={preset}
          aria-pressed={value.toUpperCase() === preset.toUpperCase()}
          className={cn("h-8 w-8 rounded-lg ring-1 ring-inset ring-black/10 transition-transform",
            value.toUpperCase() === preset.toUpperCase() && "scale-110 ring-2 ring-[rgb(var(--accent))]")}
          style={{ backgroundColor: preset }} />
      ))}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())}
        aria-label={value} className="h-8 w-10 cursor-pointer rounded-lg bg-transparent p-0" />
    </div>
  );
}

/** Nine anchors as a 3×3 grid, plus the repeating pattern as a tenth choice. */
function PositionGrid({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useI18n();
  const anchors = WATERMARK_POSITIONS.filter((p) => p !== "pattern");
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="grid w-[92px] shrink-0 grid-cols-3 gap-1 rounded-xl bg-sunken/80 p-1">
        {anchors.map((position) => (
          <button key={position} type="button" onClick={() => onChange(position)}
            aria-label={t(`tools.pos.${position}`)} aria-pressed={value === position}
            className={cn("aspect-square rounded-md transition-colors",
              value === position ? "bg-[rgb(var(--accent))] shadow-e1" : "bg-surface/70 hover:bg-surface")} />
        ))}
      </div>
      <button type="button" onClick={() => onChange("pattern")} aria-pressed={value === "pattern"}
        className={cn("min-w-0 flex-1 rounded-xl px-3 py-2 text-left text-[13px] font-semibold transition-colors",
          value === "pattern" ? "bg-accent-soft text-accent" : "bg-sunken/80 text-muted hover:text-ink")}>
        {t("tools.pos.pattern")}
        <span className="mt-0.5 block text-[11px] font-medium text-faint">{t("tools.pos.patternHint")}</span>
      </button>
    </div>
  );
}
