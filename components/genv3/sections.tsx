"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  Check, ChevronDown, HelpCircle, ImageOff, Loader2, Megaphone, Minus, PenLine, Plus, Sparkles, Sun, X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Label, Textarea } from "@/components/ui/input";
import { Dropdown } from "@/components/ui/dropdown";
import { InfoHint } from "@/components/ui/hint";
import { RatioValue, ratioOptions } from "@/components/genv3/ratio-options";
import { Switch } from "@/components/ui/record";
import { PhotoUploader } from "@/components/genv3/uploader";
import { cn } from "@/lib/utils";
import type { BriefState, GenModel, UploadedRef } from "@/components/genv3/types";
import type { CategoryVariant } from "@/lib/categories";

/** Section heading exactly like the reference: bold label, optional
 *  "(opcjonalnie)", a help glyph carrying the hint as its tooltip. */
export function SectionLabel({ children, optional, hint }: {
  children: React.ReactNode; optional?: boolean; hint?: string;
}) {
  const { t } = useI18n();
  return (
    <p className="mb-2.5 flex items-center gap-1.5 text-[13.5px] font-semibold tracking-tight">
      {children}
      {optional && <span className="font-normal text-faint">({t("genv3.optional")})</span>}
      {hint && <InfoHint text={hint} />}
    </p>
  );
}

/* ── Zdjęcia produktu ─────────────────────────────────────────────────── */

export function ProductRefsSection({ refs, uploading, max, onUpload, onRemove }: {
  refs: UploadedRef[];
  uploading: boolean;
  max: number;
  onUpload: (files: File[]) => void;
  onRemove: (index: number) => void;
}) {
  const { t } = useI18n();
  // Heading carries the limit, nothing else — no help glyph, and `compact`
  // removes the "drag / paste / click" line under the tiles. All three ways
  // in still work; they are just no longer narrated. `zone` makes the empty
  // state one wide dropzone, the same one Retusz shows.
  return (
    <PhotoUploader
      items={refs}
      max={max}
      uploading={uploading}
      capturePaste
      compact
      zone
      dropTarget="refs"
      onFiles={onUpload}
      onRemove={onRemove}
      label={t("genv3.photos", { n: max })}
    />
  );
}

/* ── Sesja (reklamowa / lifestyle) ────────────────────────────────────── */

export type SessionKey = "advertising" | "lifestyle";
export type SessionPreviewMap = Partial<Record<SessionKey, string | null>>;

const VIDEO_SRC = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;

/**
 * The slot at the top of a session tile. What plays here is admin
 * configuration (app_settings.generator_ui, see lib/server/generator-ui.ts),
 * so the tile is only ever a frame: a short muted clip, a still, or — when
 * nothing is configured yet — a quiet placeholder with the mode's glyph.
 * Deliberately no player chrome: it is a hint of what the mode produces,
 * not a video the customer is meant to operate.
 */
function SessionPreview({ src, icon: Icon, active }: {
  src?: string | null; icon: typeof Sun; active: boolean;
}) {
  // A configured URL that fails to load (typo, removed file, a clip
  // without a recognisable extension) degrades to the placeholder — never
  // to a broken-image glyph on the customer's screen.
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [src]);
  const media = src && !broken ? src : null;
  return (
    <span
      data-session-preview={media ? (VIDEO_SRC.test(media) ? "video" : "image") : "empty"}
      className="relative block aspect-[16/10] w-full overflow-hidden bg-sunken/70"
    >
      {media ? (
        VIDEO_SRC.test(media) ? (
          <video
            src={media} muted playsInline loop autoPlay preload="metadata" aria-hidden
            onError={() => setBroken(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media} alt="" aria-hidden onError={() => setBroken(true)} className="h-full w-full object-cover" />
        )
      ) : (
        <span className="absolute inset-0 flex items-center justify-center">
          <Icon size={20} aria-hidden className={cn("transition-colors", active ? "text-accent/70" : "text-faint/70")} />
        </span>
      )}
    </span>
  );
}

export function SessionTypeSection({ value, onChange, previews }: {
  value: SessionKey;
  onChange: (v: SessionKey) => void;
  previews?: SessionPreviewMap;
}) {
  const { t } = useI18n();
  const options = [
    { key: "advertising" as const, icon: Megaphone, name: t("genv3.sessionAd"), sub: t("genv3.sessionAdSub") },
    { key: "lifestyle" as const, icon: Sun, name: t("genv3.sessionLife"), sub: t("genv3.sessionLifeSub") },
  ];
  // No heading on purpose: the two tiles ARE the choice, and the preview at
  // the top of each says what the mode does better than a label would.
  return (
    <section>
      <div className="grid grid-cols-2 gap-2 [&>*]:min-w-0">
        {options.map((o) => {
          const on = value === o.key;
          return (
            <button key={o.key} type="button" aria-pressed={on} onClick={() => onChange(o.key)}
              className={cn(
                "relative overflow-hidden rounded-xl border text-left transition-colors duration-200",
                on ? "is-selected" : "border-line hover:bg-raised",
              )}>
              <SessionPreview src={previews?.[o.key]} icon={o.icon} active={on} />
              <span className="block px-2.5 pb-2.5 pt-2">
                <span className="block text-[13px] font-semibold leading-tight">{o.name}</span>
                <span className="mt-1 block text-[11px] leading-snug text-muted">{o.sub}</span>
              </span>
              {on && (
                <span aria-hidden className="absolute right-2 top-2 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-accent p-0.5 text-white shadow-e2">
                  <Check size={11} strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ── Category workflow decisions (ported chips) ───────────────────────── */

export function VariantChips({ variant, choices, onChoose }: {
  variant: CategoryVariant;
  choices: Record<string, string>;
  onChoose: (key: string, option: string) => void;
}) {
  const { t } = useI18n();
  return (
    <section className="space-y-2.5">
      {variant.controls.map((c) => (
        <div key={c.key}>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">{t(`vc.${c.key}`)}</p>
          <div className="flex flex-wrap gap-1.5">
            {c.options.map((o) => {
              const on = (choices[c.key] ?? c.initial) === o.key;
              return (
                <button key={o.key} type="button" aria-pressed={on}
                  onClick={() => onChoose(c.key, o.key)}
                  className={cn("min-h-[34px] whitespace-nowrap rounded-lg border px-2.5 text-[12px] font-semibold transition-colors duration-200",
                    on ? "is-selected text-accent" : "border-line text-muted hover:bg-raised")}>
                  {t(`vc.${c.key}_${o.key}`)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

/* ── Twój prompt (custom) ─────────────────────────────────────────────── */

/**
 * TWÓJ PROMPT — one field, expanded in place.
 *
 * Collapsed it is a single line: the invitation when empty, otherwise the
 * prompt itself clamped to two lines with its length. Clicking opens the
 * textarea RIGHT HERE — no modal, no backdrop, no "apply" step, because a
 * dialog to type one field is a detour and the panel is where the work is.
 * Every keystroke goes straight into the form state, so collapsing can
 * never lose anything; it only stops showing it.
 *
 * The field grows with the text up to a ceiling and then scrolls inside
 * itself, so a four-thousand-character prompt still cannot push the engine
 * picker or the cost island off the screen.
 */
export function PromptSection({ value, onChange, max }: {
  value: string; onChange: (v: string) => void; max: number;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLElement>(null);
  const filled = value.trim().length > 0;
  const nearCap = value.length > max * 0.9;

  // Focus lands at the END of what is already written — expanding to edit a
  // long prompt should not put the caret at the top of it.
  useEffect(() => {
    if (!open) return;
    const el = areaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [open]);

  // Clicking anywhere else, or Escape, collapses the editor. The listener is
  // real containment (`node.contains`), not a timer: it runs on pointerdown so
  // the decision is made before the click can move focus, and a pointer that
  // STARTED inside — dragging the resize handle, selecting text and releasing
  // outside — is still inside. The text lives in the parent's form state, so
  // collapsing only stops showing it; nothing is ever lost.
  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) => {
      const node = target instanceof Node ? target : null;
      if (!node) return false;
      if (boxRef.current?.contains(node)) return true;
      // Layers that belong to the editor but portal out of the section.
      const el = node instanceof Element ? node : node.parentElement;
      return !!el?.closest("[role='dialog'],[data-dropdown-panel],[data-dropdown-sheet],[data-info-hint-panel]");
    };
    const onPointerDown = (e: PointerEvent) => { if (!inside(e.target)) setOpen(false); };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // A dropdown or dialog on top owns Escape first; it closes, we stay.
      if (document.querySelector("[role='dialog'],[data-dropdown-panel],[data-dropdown-sheet]")) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <section ref={boxRef} data-prompt-section data-open={open || undefined}>
      <SectionLabel hint={t("genv3.promptHint")}>{t("genv3.prompt")}</SectionLabel>
      {open ? (
        <div className="rounded-xl border border-[rgb(var(--accent)/0.45)] bg-sunken/50 p-2">
          <Textarea
            ref={areaRef}
            data-prompt-input
            value={value}
            maxLength={max}
            placeholder={t("genv3.promptPh")}
            aria-label={t("genv3.prompt")}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}
            className="thin-scroll max-h-[38dvh] min-h-[7.5rem] resize-y border-0 bg-transparent px-1.5 py-1 focus:bg-transparent focus:ring-0 sm:max-h-64"
          />
          <div className="mt-1 flex items-center justify-between gap-2 px-1.5">
            <button type="button" data-prompt-collapse onClick={() => setOpen(false)}
              className="flex items-center gap-1 text-[10.5px] font-semibold text-faint transition-colors hover:text-accent">
              <ChevronDown size={11} aria-hidden className="rotate-180" />
              {t("genv3.promptCollapse")}
            </button>
            <span data-prompt-counter className={cn("text-[10.5px] font-medium tabular-nums", nearCap ? "text-accent2" : "text-faint")}>
              {value.length}/{max}
            </span>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)}
          data-prompt-trigger aria-expanded={false}
          aria-label={filled ? t("genv3.promptEdit") : t("genv3.promptOpen")}
          className={cn(
            "group/prompt block w-full rounded-xl border bg-sunken/50 px-3.5 py-2.5 text-left transition-colors duration-200",
            "hover:border-[rgb(var(--accent)/0.45)] hover:bg-raised focus-visible:border-[rgb(var(--accent)/0.55)]",
            filled ? "border-line" : "border-dashed border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2.5))]",
          )}>
          {filled ? (
            <p data-prompt-preview className="line-clamp-2 whitespace-pre-line break-words text-[12.5px] leading-snug text-ink">
              {value.trim()}
            </p>
          ) : (
            <p className="flex items-center gap-2 text-[12.5px] leading-relaxed text-faint">
              <PenLine size={13} aria-hidden className="shrink-0" />
              {t("genv3.promptOpen")}
            </p>
          )}
          <span className="mt-1.5 flex items-center justify-between gap-2 text-[10.5px] font-medium">
            <span className="flex items-center gap-1 text-faint transition-colors group-hover/prompt:text-accent">
              {filled && <><PenLine size={10} aria-hidden />{t("genv3.promptEdit")}</>}
            </span>
            <span className={cn("tabular-nums", nearCap ? "text-accent2" : "text-faint")}>
              {value.length}/{max}
            </span>
          </span>
        </button>
      )}
    </section>
  );
}

/* ── Ustawienia generowania ───────────────────────────────────────────── */

export function SettingsSection({
  managed, model, ratio, onRatio, resolution, onResolution, quality, onQuality, count, maxCount, onCount, perShotAt,
}: {
  managed: boolean;
  model: GenModel | undefined;
  ratio: string; onRatio: (v: string) => void;
  resolution: string; onResolution: (v: string) => void;
  /** Effective quality for the current model, or undefined when the model
   *  has no such knob — then the field is not rendered at all. */
  quality?: string; onQuality: (v: string) => void;
  count: number; maxCount: number; onCount: (v: number) => void;
  perShotAt: (resolution: string, quality?: string) => number;
}) {
  const { t } = useI18n();
  const ratios = model?.ratios ?? [];
  const resolutions = model?.resolutions ?? [];
  const qualities = model?.qualities ?? [];
  const hasQuality = qualities.length > 0 && !!quality;
  const qualityLabel = (q: string) =>
    q === "low" ? t("genv3.qualityLow") : q === "high" ? t("genv3.qualityHigh") : t("genv3.qualityMedium");
  const exact = model?.exactRatios ?? ratios;
  const approx = ratio !== "auto" && ratios.includes(ratio) && !exact.includes(ratio);
  const priceMeta = (price: number) => t("genv3.creditsShort", { n: price });
  return (
    <section>
      <SectionLabel hint={t("genv3.settingsHint")}>{t("genv3.settings")}</SectionLabel>
      {/* FORMAT gets its own full-width row: the names are what make the
          choice legible ("Pionowy – Stories / Reels"), and they do not fit a
          quarter of a 440px column. Everything else stays on one line. */}
      <div className="cell mb-2 rounded-xl border border-line bg-sunken/50 p-2">
        <Dropdown
          testId="ratio"
          label={t("genv3.format")}
          value={ratio}
          options={ratioOptions(t, ratios, exact)}
          onChange={onRatio}
          panelWidth={272}
          renderValue={() => <RatioValue t={t} ratio={ratio} />}
        />
      </div>
      {approx && (
        // Said out loud only when it applies: this engine will render the
        // nearest shape it really has, and a customer who picked 4:5 should
        // hear that from us rather than from the result.
        <p className="mb-2 text-[10.5px] leading-snug text-faint" data-ratio-approx>
          {t("genv3.fmtApprox")}
        </p>
      )}
      {/* Rozdzielczość | (Jakość) | Liczba ujęć. The quality cell exists only
          for a model that declares the parameter — never a disabled
          placeholder. */}
      <div className={cn("grid gap-2 [&>*]:min-w-0", hasQuality ? "grid-cols-3" : "grid-cols-2")}>
        <div className="rounded-xl border border-line bg-sunken/50 p-2">
          <Dropdown
            testId="resolution"
            label={t("genv3.resolution")}
            value={resolution}
            options={resolutions.map((r) => ({ value: r, label: r, meta: priceMeta(perShotAt(r, quality)) }))}
            onChange={onResolution}
            panelWidth={200}
          />
        </div>
        {hasQuality && (
          <div className="rounded-xl border border-line bg-sunken/50 p-2" data-quality-cell>
            <Dropdown
              testId="quality"
              label={t("genv3.quality")}
              value={quality}
              options={qualities.map((q) => ({ value: q, label: qualityLabel(q), meta: priceMeta(perShotAt(resolution, q)) }))}
              onChange={onQuality}
              panelWidth={220}
            />
          </div>
        )}
        <div className="rounded-xl border border-line bg-sunken/50 p-2">
          <span className="mb-0.5 block text-[10.5px] font-semibold text-faint">
            {managed ? t("genv3.countShots") : t("genv3.countImages")}
          </span>
          <div className="flex items-center justify-between gap-1">
            <button type="button" aria-label={t("genv3.less")} disabled={count <= 1}
              onClick={() => onCount(Math.max(1, count - 1))}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:bg-raised disabled:opacity-40">
              <Minus size={13} aria-hidden />
            </button>
            <span className="text-[14px] font-bold tabular-nums">{count}</span>
            <button type="button" aria-label={t("genv3.more")} disabled={count >= maxCount}
              onClick={() => onCount(Math.min(maxCount, count + 1))}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:bg-raised disabled:opacity-40">
              <Plus size={13} aria-hidden />
            </button>
          </div>
          <span className="mt-0.5 block text-center text-[10px] tabular-nums text-faint">1–{maxCount}</span>
        </div>
      </div>
    </section>
  );
}

/* ── Opisy ujęć (managed) ─────────────────────────────────────────────── */

/** Pick which uploaded photo (if any) a shot should build on. The pool is
 *  shared: the same photo may drive several shots, and "no reference" is a
 *  first-class choice — nothing is ever assigned automatically. */
function ReferencePicker({ refs, value, onChange, index }: {
  refs: UploadedRef[];
  value: number | null;
  onChange: (next: number | null) => void;
  index: number;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const chosen = value && refs[value - 1] ? refs[value - 1] : null;

  // The rows live inside the form's own scroll container, so an absolutely
  // positioned panel would be clipped by it for the lower rows. The popover
  // is portalled to the body and positioned from the trigger's rect, flipping
  // above the trigger when it would run past the bottom of the viewport.
  const place = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const W = 224, H = 190;
    const below = r.bottom + 6;
    setPos({
      top: below + H > window.innerHeight ? Math.max(8, r.top - H - 6) : below,
      left: Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - W - 8)),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    const inside = (target: Node | null) =>
      (boxRef.current?.contains(target ?? null) ?? false) || (popRef.current?.contains(target ?? null) ?? false);
    const onDown = (e: MouseEvent) => { if (!inside(e.target as Node)) setOpen(false); };
    // Tabbing out must close it too, or the panel floats over the rows below
    // while the customer is already typing somewhere else.
    const onFocus = (e: FocusEvent) => { if (!inside(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("focusin", onFocus);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("focusin", onFocus);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button type="button"
        aria-haspopup="dialog" aria-expanded={open}
        aria-label={t("genv3.pickReferenceAria", { n: index + 1 })}
        title={refs.length === 0 ? t("genv3.pickReferenceEmpty") : t("genv3.pickReference")}
        disabled={refs.length === 0}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg ring-1 transition-colors disabled:opacity-50",
          chosen ? "ring-[rgb(var(--accent)/0.6)]" : "bg-sunken ring-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.5))] hover:ring-[rgb(var(--accent)/0.5)]",
        )}>
        {chosen ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={chosen.url} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <Plus size={12} aria-hidden className="text-faint" />
        )}
      </button>

      {open && pos && createPortal(
        <div ref={popRef} role="dialog" aria-label={t("genv3.pickReference")}
          style={{ top: pos.top, left: pos.left }}
          className="workspace overlay animate-pop fixed z-[70] w-56 rounded-xl p-2">
          <p className="mb-1.5 px-0.5 text-[11px] font-semibold text-muted">{t("genv3.pickReference")}</p>
          <div className="grid grid-cols-4 gap-1.5">
            {refs.map((r, i) => {
              const on = value === i + 1;
              return (
                <button key={r.key} type="button" aria-pressed={on}
                  aria-label={t("genv3.thumbAria", { n: i + 1 })}
                  onClick={() => { onChange(i + 1); setOpen(false); }}
                  className={cn("relative aspect-square overflow-hidden rounded-lg ring-2 transition-all",
                    on ? "ring-accent" : "opacity-80 ring-transparent hover:opacity-100")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  {on && (
                    <span aria-hidden className="absolute right-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-accent text-white">
                      <Check size={9} strokeWidth={3} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <button type="button"
            onClick={() => { onChange(null); setOpen(false); }}
            className={cn("mt-2 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11.5px] font-semibold transition-colors hover:bg-raised",
              value === null ? "text-accent" : "text-muted")}>
            <ImageOff size={12} aria-hidden />
            {t("genv3.noReference")}
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Room for a few real sentences. The old single-line input capped at 300,
 *  which cut people off mid-description of a scene. */
const BRIEF_MAX = 500;

export function ShotBriefsSection({ count, refs, briefs, onChange }: {
  count: number;
  refs: UploadedRef[];
  briefs: BriefState[];
  onChange: (index: number, patch: Partial<BriefState>) => void;
}) {
  const { t } = useI18n();
  /**
   * ONE shot open at a time. Five textareas expanded at once would push the
   * form into a scroll marathon and defeat the compact panel; opening a
   * second row therefore closes the first.
   */
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const openBoxRef = useRef<HTMLTextAreaElement>(null);
  /**
   * PROGRESSIVE ROWS. The panel opens with a single "Opisz ujęcie…" tile;
   * "+ Dodaj następne" adds the next one, up to the shot count. Five empty
   * tiles up front were noise for the majority who describe nothing — and
   * the engine plans every undescribed shot itself anyway. The shot count
   * still decides how many images are made; rows only ever describe shots
   * that exist, so a lower count trims the visible rows with it.
   */
  const [rows, setRows] = useState(1);
  const visible = Math.max(1, Math.min(rows, count));

  /**
   * COLLAPSE ON CLICK-OUTSIDE — but never in the middle of a click.
   *
   * The obvious implementation (collapse on the textarea's blur) fails in a
   * way that is easy to miss: blur fires on MOUSEDOWN, the tile shrinks by
   * a hundred pixels, the scroller clamps its scroll position, and by the
   * time the click arrives the thing the customer pressed has moved from
   * under the pointer — the click lands on nothing, and a tap on another
   * tile's header simply does not open it. So a pointer interaction defers
   * the decision to the CLICK, when layout is free to change; keyboard focus
   * leaving the tile (no pointer down) still collapses immediately.
   */
  const openRef = useRef<number | null>(null);
  openRef.current = openIndex;
  const pointerDown = useRef(false);
  // The flag is armed on pointerdown and disarmed a tick after pointerup —
  // independently of which tile is open — so a press released outside the
  // window, or one that never becomes a click, cannot leave it stuck and
  // silently disable the keyboard path below.
  useEffect(() => {
    const down = () => { pointerDown.current = true; };
    const up = () => { window.setTimeout(() => { pointerDown.current = false; }, 0); };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
    };
  }, []);
  useEffect(() => {
    if (openIndex === null) return;
    const onClick = (e: MouseEvent) => {
      const cur = openRef.current;
      if (cur === null) return;
      const target = e.target as Element | null;
      // Inside the open tile, inside another tile (its own header handles
      // the switch), or inside the portalled reference picker: not "outside".
      if (target?.closest?.("[data-brief-tile], [role='dialog']")) return;
      setOpenIndex(null);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [openIndex]);

  // Focusing the freshly opened textarea also brings it into view, which is
  // what keeps it above the on-screen keyboard on a phone.
  useEffect(() => {
    if (openIndex === null) return;
    const box = openBoxRef.current;
    if (!box) return;
    box.focus({ preventScroll: true });
    box.scrollIntoView({ block: "nearest" });
  }, [openIndex]);

  return (
    <section>
      <SectionLabel>{t("genv3.briefs")}</SectionLabel>
      <div className="space-y-1.5">
        {/* One tile per added shot — and every tile starts empty. Photos are
            a POOL: a shot only gets a reference when the customer picks one. */}
        {Array.from({ length: visible }, (_, i) => {
          const b = briefs[i] ?? { text: "", keepFraming: false, refIndex: null };
          const text = b.text;
          const hasText = text.trim().length > 0;
          const hasRef = !!b.refIndex && !!refs[b.refIndex - 1];
          const touched = hasText || hasRef;
          const open = openIndex === i;
          return (
            <div key={i} data-brief-tile className={cn(
              "overflow-hidden rounded-xl border transition-colors duration-200",
              touched || open ? "border-[rgb(var(--accent)/0.35)] bg-accent-soft/20" : "border-line bg-sunken/40",
            )}>
              <div className="flex items-center gap-2 p-1.5 pl-2.5">
                <span className={cn("w-4 shrink-0 text-center text-[11px] font-bold tabular-nums", touched ? "text-accent" : "text-faint")}>
                  {i + 1}
                </span>
                {/* Sibling of the toggle, never inside it: the picker is its
                    own popover control and must not be nested in a button. */}
                <ReferencePicker
                  refs={refs}
                  index={i}
                  value={b.refIndex}
                  onChange={(next) => onChange(i, {
                    refIndex: next,
                    // Framing can only be preserved from a reference that exists.
                    ...(next === null ? { keepFraming: false } : {}),
                  })}
                />
                <button
                  type="button"
                  onClick={() => setOpenIndex(open ? null : i)}
                  aria-expanded={open}
                  aria-controls={`shot-brief-${i}`}
                  className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg text-left"
                >
                  {/* Collapsed shows a PREVIEW, not the whole description:
                      `truncate` ellipsises at the tile's own width, so the
                      row keeps its height whatever the customer wrote. */}
                  <span className={cn(
                    "min-w-0 flex-1 truncate text-[12.5px] font-medium",
                    hasText ? "text-ink" : "text-faint",
                  )}>
                    {hasText ? text : t("genv3.briefPh")}
                  </span>
                  <ChevronDown
                    size={14} aria-hidden
                    className={cn("shrink-0 text-faint transition-transform duration-200", open && "rotate-180")}
                  />
                </button>
              </div>

              {/* Expands DIRECTLY BENEATH its own tile — no modal, no sideways
                  shift, no change to the column's width. The form body is the
                  only thing that scrolls, so growing this cannot move the
                  action island below it. */}
              {open && (
                <div id={`shot-brief-${i}`} className="space-y-2 border-t border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.6))] p-2">
                  <textarea
                    ref={openBoxRef}
                    value={text}
                    onChange={(e) => onChange(i, { text: e.target.value })}
                    // Keyboard only (Tab/Shift+Tab out of the tile): a pointer
                    // interaction is settled by the document click handler
                    // above, AFTER the click has landed.
                    onBlur={(e) => {
                      if (pointerDown.current) return;
                      const next = e.relatedTarget as Node | null;
                      const tile = e.currentTarget.closest("[data-brief-tile]");
                      if (next && !tile?.contains(next)) setOpenIndex((cur) => (cur === i ? null : cur));
                    }}
                    placeholder={t("genv3.briefPh")}
                    maxLength={BRIEF_MAX}
                    rows={3}
                    aria-label={t("genv3.briefAria", { n: i + 1 })}
                    className="thin-scroll w-full resize-y rounded-lg border border-line bg-surface px-2.5 py-2 text-[12.5px] leading-relaxed text-ink outline-none transition-colors duration-200 placeholder:text-faint focus:border-[rgb(var(--accent)/0.55)]"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="shrink-0 text-[10px] tabular-nums text-faint">
                      {text.length}/{BRIEF_MAX}
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5"
                      title={hasRef ? t("genv3.keepFramingHint") : t("genv3.keepFramingNeedsRef")}>
                      <span className={cn("truncate text-[10px] font-semibold", hasRef && b.keepFraming ? "text-accent" : "text-faint")}>
                        {t("genv3.keepFraming")}
                      </span>
                      <Switch
                        checked={hasRef && b.keepFraming}
                        disabled={!hasRef}
                        onChange={(next) => onChange(i, { keepFraming: next })}
                        label={t("genv3.keepFraming")}
                      />
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {visible < count && (
          <button
            type="button"
            onClick={() => { const next = visible + 1; setRows(next); setOpenIndex(next - 1); }}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line text-[12px] font-semibold text-muted transition-colors duration-200 hover:border-[rgb(var(--accent)/0.5)] hover:text-accent"
          >
            <Plus size={13} aria-hidden />
            {t("genv3.briefAdd")}
          </button>
        )}
      </div>
    </section>
  );
}

/* ── Inspiracja (custom) ──────────────────────────────────────────────── */

export function InspirationSection({ items, uploading, disabled, onUpload, onRemove }: {
  items: UploadedRef[];
  uploading: boolean;
  disabled?: boolean;
  onUpload: (files: File[]) => void;
  onRemove: (index: number) => void;
}) {
  const { t } = useI18n();
  if (disabled) {
    return (
      <section>
        <SectionLabel optional hint={t("genv3.inspHint")}>{t("genv3.insp")}</SectionLabel>
        <p className="rounded-xl bg-raised px-3.5 py-3 text-[12px] leading-relaxed text-muted">{t("genv3.inspUnsupported")}</p>
      </section>
    );
  }
  return (
    <PhotoUploader
      items={items}
      max={5}
      columns={5}
      uploading={uploading}
      compact
      dropTarget="insp"
      onFiles={onUpload}
      onRemove={onRemove}
      // No standing "upload surroundings, style or mood" line: what
      // inspiration photos do belongs in the hint, one tap away, not
      // permanently under the tiles.
      label={
        <>
          {t("genv3.insp")}
          <span className="font-normal text-faint">({t("genv3.optional")})</span>
          <InfoHint text={t("genv3.inspHint")} />
        </>
      }
    />
  );
}

/* ── Podsumowanie kosztów ─────────────────────────────────────────────── */

export function CostSummary({
  perShot, total, balance, missing, busy, busyLabel, canGenerate,
  engineUnavailable, needsPhotos, needsPrompt, onGenerate,
}: {
  perShot: number; total: number; balance: number; missing: number;
  busy: boolean; busyLabel: string; canGenerate: boolean;
  engineUnavailable?: boolean;
  needsPhotos?: boolean; needsPrompt?: boolean;
  onGenerate: () => void;
}) {
  const { t, locale } = useI18n();
  const n = (v: number) => new Intl.NumberFormat(locale).format(v);
  const note = engineUnavailable ? t("psess.unavailable")
    : needsPhotos ? t("genv3.needPhotos")
      : needsPrompt ? t("genv3.needPrompt")
        : null;
  /**
   * THE ACTION ISLAND — the second physical part of the left column, a
   * sibling of the scrolling body rather than anything inside it, so the
   * cost and the CTA cannot scroll away. `shrink-0` is what guarantees the
   * priority when the viewport gets short: the body shrinks, the island
   * never does. `relative z-20` is defensive rather than load-bearing today —
   * it fixes the paint order against the scrolling panel above regardless of
   * what shadow or overlay either one grows later.
   */
  // Two rows, not one crowded line: the figures first (each centred in its
  // own half, same type sizes as before), the status beneath them, and the
  // full-width CTA at the very bottom. The button names the TOTAL — what the
  // click actually costs — rather than a count of images.
  return (
    <div className="panel relative z-20 shrink-0 rounded-2xl px-4 py-3">
      {/* Two figures, one hairline between them — a single container rather
          than two floating numbers, so the island reads as the panel's
          footer and the CTA below is unmistakably its action. */}
      <div className="grid grid-cols-2 divide-x divide-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.4))]">
        <div className="min-w-0 px-2 text-center">
          <p className="text-[10px] font-medium leading-tight text-faint">{t("genv3.costPerShot")}</p>
          <p className="metric mt-0.5 text-[14px] leading-tight text-accent">
            {n(perShot)} <span className="text-[10px] font-semibold text-muted">{t("genv3.credits")}</span>
          </p>
        </div>
        <div className="min-w-0 px-2 text-center">
          <p className="text-[10px] font-medium leading-tight text-faint">{t("genv3.costTotal")}</p>
          <p className="metric mt-0.5 text-[14px] leading-tight text-accent">
            {n(total)} <span className="text-[10px] font-semibold text-muted">{t("genv3.credits")}</span>
          </p>
        </div>
      </div>
      {missing > 0 ? (
        <p className="mt-2 text-center text-[11px] font-medium text-danger">
          {t("studio.missing", { n: missing })}{" · "}
          <Link href="/credits" className="font-semibold text-accent hover:opacity-75">{t("credits.topup")}</Link>
        </p>
      ) : note ? (
        <p className="mt-2 text-center text-[11px] text-muted">{note}</p>
      ) : (
        <p className="mt-2 text-center text-[10.5px] tabular-nums text-faint">{t("gtb.balance", { n: n(balance) })}</p>
      )}
      <button type="button" disabled={!canGenerate} onClick={onGenerate}
        data-generate-cta
        aria-label={busy && busyLabel ? busyLabel : `${t("genv3.generateCta")} · ${n(total)} ${t("genv3.credits")}`}
        className={cn(
          "cta mt-2.5 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold",
          !canGenerate && "cursor-not-allowed opacity-55",
        )}>
        {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}
        {busy && busyLabel ? (
          <span className="truncate">{busyLabel}</span>
        ) : (
          <>
            <span>{t("genv3.generateCta")}</span>
            <span aria-hidden className="opacity-60">•</span>
            <span className="tabular-nums">{n(total)}</span>
          </>
        )}
      </button>
    </div>
  );
}
