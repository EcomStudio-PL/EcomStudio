"use client";
import { useState } from "react";
import { ChevronDown, FlipHorizontal, FlipVertical, Loader2, RotateCcw, Scissors } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/record";
import {
  EDITOR_LIMITS, EDITOR_RATIOS, SHADOW_PRESETS, SHADOW_PRESET_KEYS,
  type EditorRatio, type EditorSection, type EditorState, type ShadowPreset,
} from "@/lib/images/editor-state";
import { cn } from "@/lib/utils";

/**
 * EDITOR PANELS — the five numbered sections of the left column.
 *
 * Every control here is a pure function of the editor state: it reads the
 * state it was handed and reports a PATCH, never a bitmap and never a request.
 * That is what lets the same five bodies serve the desktop accordion and the
 * phone's bottom sheets without a second implementation.
 *
 * Two things are deliberately absent, because the pipeline cannot do them
 * honestly (lib/images/local.ts): a generated backdrop and a customer-supplied
 * backdrop plate. composeEditor REFUSES `background.mode === "image"`, so both
 * are rendered with the project's "Wkrótce" treatment instead of as buttons
 * that would fail at export time.
 */

/** A live drag reports `commit: false`; the release commits one history step. */
export type PatchFn = <S extends EditorSection>(
  section: S, patch: Partial<EditorState[S]>, commit?: boolean,
) => void;

/** Everything the background section needs to know about the paid cutout. */
export type CutoutState = {
  available: boolean;
  /** Catalogue reason when it is not: no_provider / maintenance / disabled. */
  reason: string;
  credits: number;
  enough: boolean;
  busy: boolean;
  done: boolean;
  onRun: () => void;
};

export type PanelProps = {
  state: EditorState;
  patch: PatchFn;
  /** Called when a slider is released — the value is already in the state. */
  commit: (section: EditorSection) => void;
  cutout: CutoutState;
  /** A shadow is cut from the product's OWN alpha; without one there is none. */
  hasAlpha: boolean;
};

/** Panel order — the numbering the customer sees, 1 → 5. */
export const SECTIONS: readonly EditorSection[] = ["background", "shadow", "format", "adjust", "transform"];

/**
 * Swatches: the transparency checkerboard first, then the studio neutrals a
 * marketplace photo actually uses, the brand accent, and a few saturated
 * colours for campaign shots.
 */
const SWATCHES = [
  "#FFFFFF", "#F5F5F7", "#E5E7EB", "#9CA3AF", "#4B5563", "#111827",
  "#F7F3EE", "#E200D6", "#DB27B0", "#EF4444", "#F59E0B", "#22C55E", "#3B82F6", "#8B5CF6",
];

/* ── the accordion shell ───────────────────────────────────────────────── */

export function SectionShell({ index, section, open, onToggle, children }: {
  index: number;
  section: EditorSection;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <section className="border-b border-line last:border-b-0">
      <h3>
        <button type="button" aria-expanded={open} onClick={onToggle}
          className="flex w-full items-center gap-2.5 py-3 text-left">
          <span aria-hidden className="step-chip step-chip-sm">{index}</span>
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold tracking-tight">
            {t(`editor.s.${section}`)}
          </span>
          <ChevronDown size={15} aria-hidden
            className={cn("shrink-0 text-faint transition-transform duration-200", open && "rotate-180")} />
        </button>
      </h3>
      {open && <div className="space-y-4 pb-4">{children}</div>}
    </section>
  );
}

/** One section body, by key — the sheet and the accordion both render this. */
export function SectionBody({ section, ...props }: PanelProps & { section: EditorSection }) {
  if (section === "background") return <BackgroundPanel {...props} />;
  if (section === "shadow") return <ShadowPanel {...props} />;
  if (section === "format") return <FormatPanel {...props} />;
  if (section === "adjust") return <AdjustPanel {...props} />;
  return <TransformPanel {...props} />;
}

/* ── 1. Tło ────────────────────────────────────────────────────────────── */

function BackgroundPanel({ state, patch, cutout, hasAlpha }: PanelProps) {
  const { t } = useI18n();
  const bg = state.background;
  const white = bg.mode === "color" && bg.color === "#FFFFFF";

  return (
    <>
      <div className="grid grid-cols-2 gap-1.5">
        <ModeButton
          icon={cutout.busy ? Loader2 : Scissors}
          spin={cutout.busy}
          label={t("editor.bg.remove")}
          // The price is stated BEFORE the click, exactly as the workbench
          // does it — this is the one step in the editor that costs credits.
          note={cutout.available
            ? (cutout.credits === 0 ? t("tools.free") : t("tools.creditsTotal", { n: cutout.credits }))
            : t(`tools.state.${cutout.reason}`)}
          tone={cutout.available && !cutout.enough ? "danger" : "accent"}
          active={cutout.done}
          disabled={!cutout.available || cutout.busy}
          onClick={cutout.onRun}
        />
        <ModeButton label={t("editor.bg.white")} active={white}
          onClick={() => patch("background", { mode: "color", color: "#FFFFFF" }, true)} />
        {/* White is a colour, so both tiles can read as chosen at once — that
            is the truth about the state, not a double selection. */}
        <ModeButton label={t("editor.bg.color")} active={bg.mode === "color"}
          onClick={() => patch("background", { mode: "color" }, true)} />
        {/* No text-to-background generator exists in this codebase, and the
            bake refuses a supplied plate — both say so rather than pretend. */}
        <ModeButton label={t("editor.bg.ai")} soon />
        <ModeButton label={t("editor.bg.mine")} soon />
      </div>

      <div>
        <div className="grid grid-cols-7 gap-1.5">
          <button type="button" aria-label={t("editor.bg.transparent")} title={t("editor.bg.transparent")}
            aria-pressed={bg.mode === "transparent"}
            onClick={() => patch("background", { mode: "transparent" }, true)}
            className={cn("bg-checker aspect-square rounded-lg ring-1 ring-inset ring-black/10 transition-transform",
              bg.mode === "transparent" && "scale-110 ring-2 ring-[rgb(var(--accent))]")} />
          {SWATCHES.map((swatch) => (
            <button key={swatch} type="button" aria-label={swatch} title={swatch}
              aria-pressed={bg.mode === "color" && bg.color === swatch}
              onClick={() => patch("background", { mode: "color", color: swatch }, true)}
              className={cn("aspect-square rounded-lg ring-1 ring-inset ring-black/10 transition-transform",
                bg.mode === "color" && bg.color === swatch && "scale-110 ring-2 ring-[rgb(var(--accent))]")}
              style={{ backgroundColor: swatch }} />
          ))}
        </div>
      </div>

      <HexField label={t("editor.bg.hex")} value={bg.color}
        onChange={(color) => patch("background", { mode: "color", color }, true)} />

      {bg.mode === "transparent" && !hasAlpha && (
        <Hint>{t("tools.err.needs_transparency")}</Hint>
      )}
    </>
  );
}

/* ── 2. Cień ───────────────────────────────────────────────────────────── */

function ShadowPanel({ state, patch, commit, hasAlpha }: PanelProps) {
  const { t } = useI18n();
  const shadow = state.shadow;
  const [advanced, setAdvanced] = useState(false);
  const limits = EDITOR_LIMITS.shadow;

  return (
    <>
      <div className="grid grid-cols-5 gap-1.5">
        {SHADOW_PRESET_KEYS.map((preset) => (
          <button key={preset} type="button" aria-pressed={shadow.preset === preset}
            onClick={() => patch("shadow", { preset }, true)}
            className={cn("rounded-xl border px-1 py-2 transition-colors duration-200",
              shadow.preset === preset ? "is-selected" : "border-line hover:bg-raised")}>
            <span aria-hidden className="mx-auto block h-6 w-6 rounded-md bg-[rgb(var(--ink)/0.55)]"
              style={{ boxShadow: tileShadow(preset) }} />
            <span className={cn("mt-2 block truncate text-[10px] font-semibold",
              shadow.preset === preset ? "text-accent" : "text-muted")}>
              {t(`editor.sh.${preset}`)}
            </span>
          </button>
        ))}
      </div>

      {shadow.preset !== "none" && !hasAlpha && <Hint>{t("tools.err.needs_transparency")}</Hint>}

      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] font-semibold text-muted">{t("editor.sh.advanced")}</span>
        <Switch checked={advanced} onChange={setAdvanced} label={t("editor.sh.advanced")} />
      </div>

      {advanced && (
        <div className="space-y-3.5">
          <Slider label={t("editor.sh.opacity")} suffix="%" value={shadow.opacity}
            min={limits.opacity[0]} max={limits.opacity[1]}
            onInput={(opacity) => patch("shadow", { opacity })} onCommit={() => commit("shadow")} />
          <Slider label={t("editor.sh.blur")} suffix="px" value={shadow.blur}
            min={limits.blur[0]} max={limits.blur[1]}
            onInput={(blur) => patch("shadow", { blur })} onCommit={() => commit("shadow")} />
          <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
            <Slider label={t("editor.sh.offsetX")} suffix="px" value={shadow.offsetX}
              min={limits.offsetX[0]} max={limits.offsetX[1]}
              onInput={(offsetX) => patch("shadow", { offsetX })} onCommit={() => commit("shadow")} />
            <Slider label={t("editor.sh.offsetY")} suffix="px" value={shadow.offsetY}
              min={limits.offsetY[0]} max={limits.offsetY[1]}
              onInput={(offsetY) => patch("shadow", { offsetY })} onCommit={() => commit("shadow")} />
          </div>
          <HexField label={t("editor.sh.color")} value={shadow.color}
            onChange={(color) => patch("shadow", { color }, true)} />
        </div>
      )}
    </>
  );
}

/** The tile wears the preset's OWN numbers, scaled to 24px — so what the
 *  seller taps is a real, if tiny, sample of the shadow it applies. */
function tileShadow(preset: ShadowPreset): string {
  if (preset === "none") return "none";
  const look = SHADOW_PRESETS[preset];
  return `${look.offsetX / 6}px ${look.offsetY / 6}px ${look.blur / 4}px -1px rgb(0 0 0 / ${look.opacity / 100})`;
}

/* ── 3. Format ─────────────────────────────────────────────────────────── */

function FormatPanel({ state, patch }: PanelProps) {
  const { t } = useI18n();
  const format = state.format;
  const [min, max] = EDITOR_LIMITS.format.width;

  const ratioLabel = (ratio: EditorRatio) =>
    ratio === "original" ? t("editor.f.original") : ratio === "custom" ? t("editor.f.custom") : ratio;

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {EDITOR_RATIOS.map((ratio) => (
          <button key={ratio} type="button" aria-pressed={format.ratio === ratio}
            onClick={() => patch("format", { ratio }, true)}
            className={cn("rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold tabular-nums transition-colors duration-200",
              format.ratio === ratio ? "is-selected text-accent" : "border-line text-muted hover:bg-raised")}>
            {ratioLabel(ratio)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
        <NumberField label={t("editor.f.width")} value={format.width} min={min} max={max}
          onChange={(width) => patch("format", { width }, true)} />
        <NumberField label={t("editor.f.height")} value={format.height} min={min} max={max}
          // With the lock on, the height FOLLOWS the width (composeEditor's
          // targetBox), so an editable field here would be a value the bake
          // silently ignores.
          disabled={format.lockRatio}
          onChange={(height) => patch("format", { height }, true)} />
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] font-semibold text-muted">{t("editor.f.lock")}</span>
        <Switch checked={format.lockRatio} label={t("editor.f.lock")}
          onChange={(lockRatio) => patch("format", { lockRatio }, true)} />
      </div>
    </>
  );
}

/* ── 4. Korekta ────────────────────────────────────────────────────────── */

/** Exactly the five dials sharp applies for real (modulate, linear, sharpen /
 *  blur in applyAdjust) — nothing here is a slider with no pixel behind it. */
const ADJUST_KEYS = ["brightness", "contrast", "saturation", "temperature", "sharpness"] as const;

function AdjustPanel({ state, patch, commit }: PanelProps) {
  const { t } = useI18n();
  const limits = EDITOR_LIMITS.adjust;
  const touched = ADJUST_KEYS.some((key) => state.adjust[key] !== 0);

  return (
    <>
      <div className="space-y-3.5">
        {ADJUST_KEYS.map((key) => (
          <Slider key={key} label={t(`editor.a.${key}`)} value={state.adjust[key]}
            min={limits[key][0]} max={limits[key][1]}
            onInput={(value) => patch("adjust", { [key]: value })}
            onCommit={() => commit("adjust")} />
        ))}
      </div>
      <button type="button" disabled={!touched}
        onClick={() => patch("adjust", { brightness: 0, contrast: 0, saturation: 0, temperature: 0, sharpness: 0 }, true)}
        className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted transition-colors hover:text-ink disabled:opacity-40">
        <RotateCcw size={13} aria-hidden /> {t("editor.a.reset")}
      </button>
    </>
  );
}

/* ── 5. Kadr ───────────────────────────────────────────────────────────── */

function TransformPanel({ state, patch, commit }: PanelProps) {
  const { t } = useI18n();
  const transform = state.transform;
  const limits = EDITOR_LIMITS.transform;

  return (
    <>
      <Slider label={t("editor.t.rotate")} suffix="°" value={transform.rotate}
        min={limits.rotate[0]} max={limits.rotate[1]}
        onInput={(rotate) => patch("transform", { rotate })} onCommit={() => commit("transform")} />

      <div className="grid grid-cols-2 gap-1.5">
        <ToggleButton icon={FlipHorizontal} label={t("editor.t.flipH")} active={transform.flipH}
          onClick={() => patch("transform", { flipH: !transform.flipH }, true)} />
        <ToggleButton icon={FlipVertical} label={t("editor.t.flipV")} active={transform.flipV}
          onClick={() => patch("transform", { flipV: !transform.flipV }, true)} />
      </div>

      <Slider label={t("editor.t.scale")} suffix="%" value={transform.scale}
        min={limits.scale[0]} max={limits.scale[1]}
        onInput={(scale) => patch("transform", { scale })} onCommit={() => commit("transform")} />

      <div>
        <p className="mb-2 text-[12.5px] font-semibold text-muted">{t("editor.t.position")}</p>
        <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
          <Slider label="X" suffix="%" value={transform.offsetX}
            min={limits.offsetX[0]} max={limits.offsetX[1]}
            onInput={(offsetX) => patch("transform", { offsetX })} onCommit={() => commit("transform")} />
          <Slider label="Y" suffix="%" value={transform.offsetY}
            min={limits.offsetY[0]} max={limits.offsetY[1]}
            onInput={(offsetY) => patch("transform", { offsetY })} onCommit={() => commit("transform")} />
        </div>
      </div>
    </>
  );
}

/* ── shared controls ───────────────────────────────────────────────────── */

function ModeButton({ icon: Icon, label, note, onClick, active, disabled, soon, spin, tone = "accent" }: {
  icon?: typeof Scissors;
  label: string;
  note?: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  soon?: boolean;
  spin?: boolean;
  tone?: "accent" | "danger";
}) {
  const { t } = useI18n();
  return (
    <button type="button" onClick={onClick} disabled={disabled || soon} aria-pressed={soon ? undefined : !!active}
      className={cn(
        "flex min-h-[3.25rem] flex-col justify-center gap-0.5 rounded-xl border px-2.5 py-2 text-left transition-colors duration-200",
        active ? "is-selected" : "border-line hover:bg-raised",
        (disabled || soon) && "cursor-default opacity-60 hover:bg-transparent",
      )}>
      <span className="flex min-w-0 items-center gap-1.5">
        {Icon && <Icon size={13} aria-hidden className={cn("shrink-0", spin && "animate-spin", active ? "text-accent" : "text-faint")} />}
        <span className={cn("min-w-0 truncate text-[12.5px] font-semibold", active && "text-accent")}>{label}</span>
      </span>
      {soon
        ? <Badge tone="neutral" className="self-start">{t("common.soon")}</Badge>
        : note && (
          <span className={cn("truncate text-[10.5px] font-semibold tabular-nums",
            tone === "danger" ? "text-danger" : "text-faint")}>
            {note}
          </span>
        )}
    </button>
  );
}

function ToggleButton({ icon: Icon, label, active, onClick }: {
  icon: typeof FlipHorizontal; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={cn("flex min-h-[2.75rem] items-center gap-2 rounded-xl border px-2.5 text-left transition-colors duration-200",
        active ? "is-selected" : "border-line hover:bg-raised")}>
      <Icon size={14} aria-hidden className={cn("shrink-0", active ? "text-accent" : "text-faint")} />
      <span className={cn("min-w-0 truncate text-[12px] font-semibold", active && "text-accent")}>{label}</span>
    </button>
  );
}

function Slider({ label, value, min, max, suffix, onInput, onCommit }: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onInput: (value: number) => void;
  /** The release, not the drag: one history step per gesture. */
  onCommit: () => void;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-[12.5px] font-medium text-muted">{label}</span>
        <span className="shrink-0 text-[11.5px] font-semibold tabular-nums">{value}{suffix ?? ""}</span>
      </div>
      <input type="range" min={min} max={max} value={value} aria-label={label}
        onChange={(e) => onInput(Number(e.target.value))}
        onPointerUp={onCommit} onKeyUp={onCommit} onBlur={onCommit}
        className="w-full accent-[rgb(var(--accent))]" />
    </div>
  );
}

function NumberField({ label, value, min, max, disabled, onChange }: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[12.5px] font-medium text-muted">{label}</span>
      <Input type="number" inputMode="numeric" min={min} max={max} disabled={disabled}
        value={value == null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="py-2.5 text-[13px]" />
    </label>
  );
}

/**
 * HEX + the native picker. The field keeps its own draft so a half-typed
 * "#FF" never reaches the state — only a complete six-digit colour commits.
 */
function HexField({ label, value, onChange }: {
  label: string; value: string; onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;

  return (
    <div className="min-w-0">
      <span className="mb-1 block text-[12.5px] font-medium text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <input type="color" value={value} aria-label={label}
          onChange={(e) => { setDraft(null); onChange(e.target.value.toUpperCase()); }}
          className="h-9 w-11 shrink-0 cursor-pointer rounded-lg bg-transparent p-0" />
        <Input value={shown} spellCheck={false} maxLength={7} aria-label={label}
          onChange={(e) => {
            const next = e.target.value.toUpperCase();
            setDraft(next);
            if (/^#[0-9A-F]{6}$/.test(next)) onChange(next);
          }}
          onBlur={() => setDraft(null)}
          className="py-2.5 font-mono text-[13px] uppercase" />
      </div>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl bg-accent2-soft px-3 py-2 text-[11.5px] font-medium leading-relaxed text-accent2">
      {children}
    </p>
  );
}
