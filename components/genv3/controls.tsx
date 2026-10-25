"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ImageOff, Megaphone, Minus, Plus, RotateCcw, Sparkles, Sun } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { InfoHint } from "@/components/ui/hint";
import { RatioGlyph } from "@/components/ui/dropdown";
import { BottomSheet } from "@/components/mobile/sheet";
import { Switch } from "@/components/ui/record";
import { useToolViewer } from "@/components/public-tools/tool-viewer";
import { RATIO_SHAPE } from "@/lib/ai/types";
import {
  PLAN_TEXT_MAX, plannedCount, type PlanRow,
} from "@/lib/generator/studio";
import type { UploadedRef } from "@/components/genv3/types";
import { cn } from "@/lib/utils";
import { humanizeKey } from "@/lib/i18n/t";

/**
 * THE SETTINGS VOCABULARY — Generator UX V3.
 *
 * One white card per tool, and inside it no card per control: a heading, the
 * control, the section rhythm (the card's `space-y-6`), a hairline where two
 * groups need telling apart. A help glyph only where an option needs saying.
 * Two to five values are segments or tiles, never a dropdown; the recommended
 * value says "Zalecane"; a value that costs more says by how much — from the
 * live price table, never a guess.
 */

/* ── a section ─────────────────────────────────────────────────────────── */

export function PanelSection({ title, hint, optional, aside, children, data }: {
  title: React.ReactNode;
  hint?: string;
  optional?: boolean;
  /** Right-hand fact (a counter, a range). */
  aside?: React.ReactNode;
  children: React.ReactNode;
  data?: string;
}) {
  const { t } = useI18n();
  return (
    <section data-panel-section={data}>
      <div className="mb-2.5 flex min-w-0 items-baseline justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-[14px] font-semibold tracking-tight">
          <span className="truncate">{title}</span>
          {optional && <span className="shrink-0 font-normal text-faint">({t("genv3.optional")})</span>}
          {hint && <InfoHint text={hint} />}
        </p>
        {aside && <span className="shrink-0 text-[11.5px] font-medium tabular-nums text-faint">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

/* ── price differences ─────────────────────────────────────────────────── */

/** "+4 kr." / "Zalecane" / nothing — what a segment says under its value. */
export function useDeltaMeta() {
  const { t, locale } = useI18n();
  const n = (v: number) => new Intl.NumberFormat(locale).format(v);
  return (price: number, base: number, recommended: boolean): string | undefined => {
    const d = price - base;
    if (d > 0) return t("controls.extra", { n: n(d) });
    if (d < 0) return t("controls.less", { n: n(-d) });
    return recommended ? t("controls.recommended") : undefined;
  };
}

/* ── − 5 + ─────────────────────────────────────────────────────────────── */

export function Stepper({ value, min, max, onChange, label, data }: {
  value: number; min: number; max: number;
  onChange: (v: number) => void;
  label: string;
  data?: string;
}) {
  const { t } = useI18n();
  const btn = "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-ink transition-colors hover:bg-raised disabled:opacity-35";
  return (
    <div data-stepper={data}>
      <div className="flex items-center gap-3" role="group" aria-label={label}>
        <button type="button" className={btn} aria-label={t("genv3.less")} disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}>
          <Minus size={16} aria-hidden />
        </button>
        <output aria-live="polite" className="min-w-[2.5rem] text-center text-[20px] font-bold tabular-nums">{value}</output>
        <button type="button" className={btn} aria-label={t("genv3.more")} disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}>
          <Plus size={16} aria-hidden />
        </button>
      </div>
      <p className="mt-1.5 text-[11px] tabular-nums text-faint">{t("controls.range", { min, max })}</p>
    </div>
  );
}

/* ── format tiles ──────────────────────────────────────────────────────── */

export type FormatOption = {
  value: string;
  /** The shape drawn on the tile; absent for "auto" / "original". */
  ratio?: string;
  label: string;
  /** What the shape is for ("Allegro", "Rolki"). */
  use?: string;
  icon?: React.ReactNode;
  /** The engine serves the nearest shape. */
  approx?: boolean;
};

/**
 * WYBÓR FORMATU — the shape itself, its name, what it is for. The options are
 * the tool's own (its model's catalogue): a shape the engine cannot render is
 * never offered. Wraps into a grid on a desktop; one row that scrolls sideways
 * on a phone.
 */
export function FormatTiles({ options, value, onChange, label }: {
  options: FormatOption[];
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} data-format-tiles
      className="thin-scroll -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-[repeat(auto-fill,minmax(5.75rem,1fr))] sm:overflow-visible sm:px-0 sm:pb-0">
      {options.map((o) => {
        const on = o.value === value;
        const shape = o.ratio ? RATIO_SHAPE[o.ratio as keyof typeof RATIO_SHAPE] : undefined;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} data-format={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex w-[6.25rem] shrink-0 flex-col items-start gap-1 rounded-xl border px-2.5 py-2 text-left transition-colors duration-150 sm:w-auto",
              on ? "is-selected" : "border-line hover:bg-raised",
            )}>
            <span className={cn("flex h-6 items-center", on ? "text-accent" : "text-muted")}>
              {shape ? <RatioGlyph w={shape.w} h={shape.h} size={22} /> : o.icon ?? <Sparkles size={16} aria-hidden />}
            </span>
            <span className="flex w-full min-w-0 items-baseline gap-1">
              <span className="truncate text-[13px] font-semibold tabular-nums">{o.label}</span>
              {o.approx && <span className="shrink-0 text-[11px] text-faint" title="≈">≈</span>}
            </span>
            {o.use && <span className="w-full truncate text-[11px] leading-tight text-muted">{o.use}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** What a format is for when the admin wrote nothing for this tool (the
 *  shipped `fmtUse.*` line). The dictionary humanises a missing key instead
 *  of echoing it, so "is there a line" is asked against that fallback too. */
export function fmtDefault(t: (k: string) => string, ratio: string): string | undefined {
  const key = `fmtUse.${ratio}`;
  const v = t(key);
  return v && v !== key && v !== humanizeKey(key) ? v : undefined;
}

/* ── remembered open / closed ──────────────────────────────────────────── */

/** A section's open state, remembered per account and per tool in this
 *  browser (a convenience, never anything the server needs). */
export function useRememberedOpen(key: string, initial = false): [boolean, (v: boolean) => void] {
  const viewer = useToolViewer();
  const who = viewer?.facts.kind === "member" ? viewer.facts.viewerKey : "guest";
  const storageKey = `gb:open:${key}:${who}`;
  const [open, setOpen] = useState(initial);
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(storageKey);
      if (v === "1" || v === "0") setOpen(v === "1");
    } catch { /* private mode: the default */ }
  }, [storageKey]);
  const set = useCallback((v: boolean) => {
    setOpen(v);
    try { window.localStorage.setItem(storageKey, v ? "1" : "0"); } catch { /* nothing to keep */ }
  }, [storageKey]);
  return [open, set];
}

/* ── Więcej ustawień ───────────────────────────────────────────────────── */

export function MoreSettings({ storageKey, summary, changed, onRestore, children }: {
  storageKey: string;
  /** "Zalecany model · 1K · Średnia jakość" — the real current values. */
  summary: string;
  /** Something differs from the tool's recommended values. */
  changed: boolean;
  onRestore: () => void;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useRememberedOpen(storageKey, false);
  const id = useId();
  return (
    <section data-more-settings={open ? "open" : "closed"} className="border-t border-line pt-5">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}
        className="flex w-full min-w-0 items-center gap-2 text-left">
        <span className="shrink-0 text-[14px] font-semibold tracking-tight">{t("genv3.moreSettings")}</span>
        {changed && (
          <span data-more-changed className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
            {t("genv3.changed")}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-right text-[12px] text-muted">{summary}</span>
        <ChevronDown size={16} aria-hidden className={cn("shrink-0 text-faint transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && (
        <div id={id} className="mt-4 space-y-5">
          {children}
          {changed && (
            <button type="button" onClick={onRestore} data-more-restore
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-accent transition-opacity hover:opacity-75">
              <RotateCcw size={13} aria-hidden />
              {t("genv3.restore")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/* ── Scenariusz ────────────────────────────────────────────────────────── */

const VIDEO_SRC = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;

/** The small picture on a scenario card: what the admin set for it (Media →
 *  Sekcje aplikacji), else the mode's glyph — never an empty frame. */
function ScenarioThumb({ src, icon: Icon, active }: { src?: string | null; icon: typeof Sun; active: boolean }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [src]);
  const media = src && !broken ? src : null;
  return (
    <span data-session-preview={media ? (VIDEO_SRC.test(media) ? "video" : "image") : "empty"}
      className={cn("relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg",
        media ? "bg-sunken" : active ? "bg-accent-soft" : "bg-sunken")}>
      {media ? (
        VIDEO_SRC.test(media)
          ? <video src={media} muted playsInline loop autoPlay preload="metadata" aria-hidden onError={() => setBroken(true)} className="h-full w-full object-cover" />
          // eslint-disable-next-line @next/next/no-img-element
          : <img src={media} alt="" aria-hidden onError={() => setBroken(true)} className="h-full w-full object-cover" />
      ) : (
        <Icon size={18} aria-hidden className={active ? "text-accent" : "text-faint"} />
      )}
    </span>
  );
}

export function ScenarioCards({ value, onChange, previews }: {
  value: "advertising" | "lifestyle";
  onChange: (v: "advertising" | "lifestyle") => void;
  previews?: Partial<Record<"advertising" | "lifestyle", string | null>>;
}) {
  const { t } = useI18n();
  const options = [
    { key: "advertising" as const, icon: Megaphone, name: t("genv3.sessionAd"), sub: t("genv3.sessionAdSub") },
    { key: "lifestyle" as const, icon: Sun, name: t("genv3.sessionLife"), sub: t("genv3.sessionLifeSub") },
  ];
  return (
    <div role="radiogroup" aria-label={t("genv3.scenario")} className="grid gap-2 [&>*]:min-w-0">
      {options.map((o) => {
        const on = value === o.key;
        return (
          <button key={o.key} type="button" role="radio" aria-checked={on} aria-pressed={on} data-scenario={o.key}
            onClick={() => onChange(o.key)}
            className={cn("flex items-center gap-2.5 rounded-xl border p-2 text-left transition-colors duration-150",
              on ? "is-selected" : "border-line hover:bg-raised")}>
            <ScenarioThumb src={previews?.[o.key]} icon={o.icon} active={on} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold leading-tight">{o.name}</span>
              <span className="mt-0.5 block truncate text-[11.5px] leading-snug text-muted">{o.sub}</span>
            </span>
            <span aria-hidden className={cn("flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full",
              on ? "bg-accent text-white" : "border border-line")}>
              {on && <Check size={11} strokeWidth={3} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Plan ujęć ─────────────────────────────────────────────────────────── */

const PLACEHOLDERS = ["genv3.planPh1", "genv3.planPh2", "genv3.planPh3"] as const;

/**
 * PLAN UJĘĆ (opcjonalnie) — one row per shot, as many as the shot count:
 * which photo it builds on ("Dowolne" by default) and what it should show.
 * An empty row is planned by the engine. Rows beyond the count are kept, so
 * a lower count and a higher one again bring them back; a photo that leaves
 * the pool turns its rows back to "Dowolne"; reordering the photos changes
 * nothing here — a row names its photo, not a position.
 */
export function ShotPlan({ count, refs, plan, onPatch }: {
  count: number;
  refs: UploadedRef[];
  plan: PlanRow[];
  onPatch: (index: number, patch: Partial<PlanRow>) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useRememberedOpen("shot-plan", false);
  const id = useId();
  const planned = plannedCount(plan, count);
  return (
    <section data-shot-plan={open ? "open" : "closed"}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}
        className="flex w-full min-w-0 items-center gap-2 rounded-xl border border-dashed border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2.4))] px-3 py-2.5 text-left transition-colors hover:border-[rgb(var(--accent)/0.5)]">
        <span className="min-w-0 flex-1 text-[13px] font-semibold">
          {t("genv3.shotPlan")} <span className="font-normal text-faint">({t("genv3.optional")})</span>
        </span>
        <span data-plan-count className={cn("shrink-0 text-[11.5px] font-semibold tabular-nums", planned > 0 ? "text-accent" : "text-faint")}>
          {t("genv3.planned", { n: planned, m: count })}
        </span>
        <ChevronDown size={15} aria-hidden className={cn("shrink-0 text-faint transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && (
        <div id={id} className="mt-3">
          <p className="mb-3 text-[12px] leading-relaxed text-muted">{t("genv3.shotPlanHint")}</p>
          <ol className="space-y-2.5">
            {Array.from({ length: count }, (_, i) => {
              const row = plan[i] ?? { text: "", photo: null, keepFraming: false };
              const chosen = row.photo ? refs.find((r) => r.key === row.photo) ?? null : null;
              return (
                <li key={i} data-plan-row={i + 1} className="rounded-xl bg-sunken/60 p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 text-[12.5px] font-semibold">{t("genv3.shot", { n: i + 1 })}</span>
                    <PhotoPick refs={refs} value={chosen?.key ?? null} index={i}
                      onChange={(photo) => onPatch(i, { photo })} />
                  </div>
                  <textarea
                    value={row.text}
                    maxLength={PLAN_TEXT_MAX}
                    rows={2}
                    data-plan-text={i + 1}
                    aria-label={t("genv3.briefAria", { n: i + 1 })}
                    placeholder={t(PLACEHOLDERS[i % PLACEHOLDERS.length]!)}
                    onChange={(e) => onPatch(i, { text: e.target.value })}
                    className="thin-scroll mt-2 w-full resize-y rounded-lg border border-line bg-surface px-2.5 py-2 text-[12.5px] leading-relaxed text-ink outline-none transition-colors placeholder:text-faint focus:border-[rgb(var(--accent)/0.55)]"
                  />
                  {chosen && (
                    <label className="mt-1.5 flex items-center justify-between gap-2 text-[11.5px] text-muted">
                      <span title={t("genv3.keepFramingHint")}>{t("genv3.keepFramingShort")}</span>
                      <Switch checked={row.keepFraming} onChange={(v) => onPatch(i, { keepFraming: v })} label={t("genv3.keepFramingShort")} />
                    </label>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}

/**
 * Which uploaded photo a shot builds on. A popover beside the trigger on a
 * desktop, a bottom sheet on a phone; "Dowolne" is a first-class choice.
 */
function PhotoPick({ refs, value, index, onChange }: {
  refs: UploadedRef[];
  value: string | null;
  index: number;
  onChange: (key: string | null) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const boxRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const chosen = value ? refs.find((r) => r.key === value) ?? null : null;
  const at = chosen ? refs.indexOf(chosen) + 1 : 0;

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const place = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const W = 232, H = 200;
    setPos({
      top: r.bottom + 6 + H > window.innerHeight ? Math.max(8, r.top - H - 6) : r.bottom + 6,
      left: Math.min(Math.max(8, r.right - W), Math.max(8, window.innerWidth - W - 8)),
    });
  }, []);

  useEffect(() => {
    if (!open || phone) return;
    place();
    const inside = (n: Node | null) => !!n && (!!boxRef.current?.contains(n) || !!popRef.current?.contains(n));
    const onDown = (e: PointerEvent) => { if (!inside(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, phone, place]);

  const pick = (key: string | null) => { onChange(key); setOpen(false); boxRef.current?.focus(); };
  const grid = (
    <>
      <div className="grid grid-cols-4 gap-1.5">
        {refs.map((r, i) => {
          const on = value === r.key;
          return (
            <button key={r.key} type="button" aria-pressed={on} data-plan-photo={i + 1}
              aria-label={t("genv3.thumbAria", { n: i + 1 })}
              onClick={() => pick(r.key)}
              className={cn("relative aspect-square overflow-hidden rounded-lg ring-2 transition-all",
                on ? "ring-accent" : "opacity-85 ring-transparent hover:opacity-100")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.url} alt="" className="h-full w-full object-cover" loading="lazy" />
              <span aria-hidden className="absolute left-0.5 top-0.5 rounded bg-black/55 px-1 text-[9px] font-bold text-white">{i + 1}</span>
            </button>
          );
        })}
      </div>
      <button type="button" onClick={() => pick(null)} data-plan-photo="any"
        className={cn("mt-2 flex w-full items-center gap-1.5 rounded-lg px-2 py-2 text-[12px] font-semibold transition-colors hover:bg-raised",
          value === null ? "text-accent" : "text-muted")}>
        <ImageOff size={13} aria-hidden />
        {t("genv3.anyPhoto")}
      </button>
    </>
  );

  return (
    <>
      <button ref={boxRef} type="button" aria-haspopup="dialog" aria-expanded={open}
        aria-label={t("genv3.pickPhoto", { n: index + 1 })}
        disabled={refs.length === 0} data-plan-pick={index + 1}
        onClick={() => setOpen((o) => !o)}
        className={cn("flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50",
          chosen ? "border-[rgb(var(--accent)/0.5)] bg-surface text-ink" : "border-line bg-surface text-muted hover:text-ink")}>
        {chosen ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={chosen.url} alt="" className="h-6 w-6 rounded object-cover" />
            <span className="pr-1 tabular-nums">#{at}</span>
          </>
        ) : (
          <span className="px-1">{t("genv3.anyPhoto")}</span>
        )}
        <ChevronDown size={13} aria-hidden className="text-faint" />
      </button>
      {open && phone && (
        <BottomSheet open onClose={() => setOpen(false)} title={t("genv3.pickPhoto", { n: index + 1 })}>
          <div className="px-1 pb-3">{grid}</div>
        </BottomSheet>
      )}
      {open && !phone && pos && createPortal(
        <div ref={popRef} role="dialog" aria-label={t("genv3.pickPhoto", { n: index + 1 })}
          style={{ top: pos.top, left: pos.left }}
          className="workspace overlay animate-pop fixed z-[70] w-[232px] rounded-xl p-2">
          {grid}
        </div>,
        document.body,
      )}
    </>
  );
}
