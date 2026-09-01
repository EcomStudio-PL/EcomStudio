"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  Check, HelpCircle, ImageOff, Loader2, Megaphone, Minus, Plus, Sparkles, Sun,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Label, Select, Textarea } from "@/components/ui/input";
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
      {hint && (
        <span title={hint} className="cursor-help text-faint" aria-label={hint}>
          <HelpCircle size={13} aria-hidden />
        </span>
      )}
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
  return (
    <PhotoUploader
      items={refs}
      max={max}
      uploading={uploading}
      capturePaste
      dropTarget="refs"
      onFiles={onUpload}
      onRemove={onRemove}
      label={
        <>
          {t("genv3.photos")}
          <span title={t("genv3.photosHint")} className="cursor-help text-faint" aria-label={t("genv3.photosHint")}>
            <HelpCircle size={13} aria-hidden />
          </span>
        </>
      }
    />
  );
}

/* ── Opis produktu ────────────────────────────────────────────────────── */

export function DescriptionSection({ description, onDescription }: {
  description: string; onDescription: (v: string) => void;
}) {
  const { t } = useI18n();
  return (
    <section>
      <SectionLabel optional hint={t("genv3.descHint")}>{t("genv3.desc")}</SectionLabel>
      <Textarea rows={2} value={description} placeholder={t("genv3.descPh")}
        aria-label={t("genv3.desc")}
        onChange={(e) => onDescription(e.target.value)} />
    </section>
  );
}

/* ── Typ sesji ────────────────────────────────────────────────────────── */

export function SessionTypeSection({ value, onChange }: {
  value: "advertising" | "lifestyle";
  onChange: (v: "advertising" | "lifestyle") => void;
}) {
  const { t } = useI18n();
  const options = [
    { key: "advertising" as const, icon: Megaphone, name: t("genv3.sessionAd"), sub: t("genv3.sessionAdSub") },
    { key: "lifestyle" as const, icon: Sun, name: t("genv3.sessionLife"), sub: t("genv3.sessionLifeSub") },
  ];
  return (
    <section>
      <SectionLabel hint={t("genv3.sessionHint")}>{t("genv3.session")}</SectionLabel>
      <div className="grid grid-cols-2 gap-2 [&>*]:min-w-0">
        {options.map((o) => {
          const on = value === o.key;
          return (
            <button key={o.key} type="button" aria-pressed={on} onClick={() => onChange(o.key)}
              className={cn(
                "relative rounded-xl border p-3 text-left transition-colors duration-200",
                on ? "is-selected" : "border-line hover:bg-raised",
              )}>
              <o.icon size={16} aria-hidden className={cn("mb-1.5", on ? "text-accent" : "text-faint")} />
              <span className="block text-[13px] font-semibold leading-tight">{o.name}</span>
              <span className="mt-1 block text-[11px] leading-snug text-muted">{o.sub}</span>
              {on && (
                <span aria-hidden className="absolute right-2 top-2 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-accent p-0.5 text-white">
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

export function PromptSection({ value, onChange, max }: {
  value: string; onChange: (v: string) => void; max: number;
}) {
  const { t } = useI18n();
  return (
    <section>
      <SectionLabel hint={t("genv3.promptHint")}>{t("genv3.prompt")}</SectionLabel>
      <div className="relative">
        <Textarea rows={6} value={value} placeholder={t("genv3.promptPh")}
          aria-label={t("genv3.prompt")}
          maxLength={max}
          onChange={(e) => onChange(e.target.value)}
          className="pb-7" />
        <span className={cn("pointer-events-none absolute bottom-2 right-3 text-[11px] font-medium tabular-nums",
          value.length > max * 0.9 ? "text-accent2" : "text-faint")}>
          {value.length}/{max}
        </span>
      </div>
    </section>
  );
}

/* ── Ustawienia generowania ───────────────────────────────────────────── */

export function SettingsSection({ managed, model, ratio, onRatio, resolution, onResolution, count, maxCount, onCount, perShotAt }: {
  managed: boolean;
  model: GenModel | undefined;
  ratio: string; onRatio: (v: string) => void;
  resolution: string; onResolution: (v: string) => void;
  count: number; maxCount: number; onCount: (v: number) => void;
  perShotAt: (resolution: string) => number;
}) {
  const { t } = useI18n();
  const ratios = model?.ratios ?? [];
  const resolutions = model?.resolutions ?? [];
  return (
    <section>
      <SectionLabel hint={t("genv3.settingsHint")}>{t("genv3.settings")}</SectionLabel>
      <div className="grid grid-cols-3 gap-2 [&>*]:min-w-0">
        <div className="rounded-xl border border-line bg-sunken/50 p-2">
          <label htmlFor="gen-ratio" className="mb-0.5 block text-[10.5px] font-semibold text-faint">{t("genv3.format")}</label>
          <Select id="gen-ratio" value={ratio} onChange={(e) => onRatio(e.target.value)}
            className="!border-0 !bg-transparent !px-1 !py-1 text-[13px] font-semibold">
            {ratios.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </div>
        <div className="rounded-xl border border-line bg-sunken/50 p-2">
          <label htmlFor="gen-res" className="mb-0.5 block text-[10.5px] font-semibold text-faint">{t("genv3.resolution")}</label>
          <Select id="gen-res" value={resolution} onChange={(e) => onResolution(e.target.value)}
            className="!border-0 !bg-transparent !px-1 !py-1 text-[13px] font-semibold">
            {resolutions.map((r) => (
              <option key={r} value={r}>{r}{perShotAt(r) !== perShotAt(resolution) ? ` · ${perShotAt(r)} kr.` : ""}</option>
            ))}
          </Select>
        </div>
        <div className="rounded-xl border border-line bg-sunken/50 p-2">
          <span className="mb-0.5 block text-[10.5px] font-semibold text-faint">
            {managed ? t("genv3.countShots") : t("genv3.countImages")}
          </span>
          <div className="flex items-center justify-between gap-1">
            <button type="button" aria-label={t("genv3.less")} disabled={count <= 1}
              onClick={() => onCount(Math.max(1, count - 1))}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:bg-raised disabled:opacity-40">
              <Minus size={13} aria-hidden />
            </button>
            <span className="text-[14px] font-bold tabular-nums">{count}</span>
            <button type="button" aria-label={t("genv3.more")} disabled={count >= maxCount}
              onClick={() => onCount(Math.min(maxCount, count + 1))}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:bg-raised disabled:opacity-40">
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

export function ShotBriefsSection({ count, refs, briefs, onChange }: {
  count: number;
  refs: UploadedRef[];
  briefs: BriefState[];
  onChange: (index: number, patch: Partial<BriefState>) => void;
}) {
  const { t } = useI18n();
  return (
    <section>
      <SectionLabel optional hint={t("genv3.briefsHint")}>{t("genv3.briefs")}</SectionLabel>
      <div className="space-y-1.5">
        {/* One row per ordered shot — and every row starts empty. Photos are a
            POOL: a shot only gets a reference when the customer picks one. */}
        {Array.from({ length: count }, (_, i) => {
          const b = briefs[i] ?? { text: "", keepFraming: false, refIndex: null };
          const hasText = b.text.trim().length > 0;
          const hasRef = !!b.refIndex && !!refs[b.refIndex - 1];
          const touched = hasText || hasRef;
          return (
            <div key={i} className={cn(
              "flex items-center gap-2 rounded-xl border p-1.5 pl-2.5 transition-colors duration-200",
              touched ? "border-[rgb(var(--accent)/0.35)] bg-accent-soft/20" : "border-line bg-sunken/40",
            )}>
              <span className={cn("w-4 shrink-0 text-center text-[11px] font-bold tabular-nums", touched ? "text-accent" : "text-faint")}>
                {i + 1}
              </span>
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
              <input
                value={b.text}
                onChange={(e) => onChange(i, { text: e.target.value })}
                placeholder={t("genv3.briefPh")}
                maxLength={300}
                aria-label={t("genv3.briefAria", { n: i + 1 })}
                className="h-9 min-w-0 flex-1 bg-transparent text-[12.5px] font-medium text-ink outline-none placeholder:text-faint"
              />
              {/* The panel is ~420px wide whatever the viewport, so the full
                  label only appears where it genuinely fits; below that the
                  switch carries its meaning through the tooltip and its
                  accessible name, and the description keeps the room. */}
              <span className="flex shrink-0 items-center gap-1.5 pr-1"
                title={hasRef ? t("genv3.keepFramingHint") : t("genv3.keepFramingNeedsRef")}>
                <span className={cn("hidden text-[10px] font-semibold 2xl:block", hasRef && b.keepFraming ? "text-accent" : "text-faint")}>
                  {t("genv3.keepFraming")}
                </span>
                <span className={cn("text-[10px] font-semibold 2xl:hidden", hasRef && b.keepFraming ? "text-accent" : "text-faint")}>
                  {t("genv3.keepFramingShort")}
                </span>
                <Switch
                  checked={hasRef && b.keepFraming}
                  disabled={!hasRef}
                  onChange={(next) => onChange(i, { keepFraming: next })}
                  label={t("genv3.keepFraming")}
                />
              </span>
            </div>
          );
        })}
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
      dropTarget="insp"
      onFiles={onUpload}
      onRemove={onRemove}
      hint={t("genv3.inspSub")}
      label={
        <>
          {t("genv3.insp")}
          <span className="font-normal text-faint">({t("genv3.optional")})</span>
          <span title={t("genv3.inspHint")} className="cursor-help text-faint" aria-label={t("genv3.inspHint")}>
            <HelpCircle size={13} aria-hidden />
          </span>
        </>
      }
    />
  );
}

/* ── Podsumowanie kosztów ─────────────────────────────────────────────── */

export function CostSummary({
  perShot, total, count, balance, missing, busy, busyLabel, canGenerate,
  engineUnavailable, needsPhotos, needsPrompt, onGenerate,
}: {
  perShot: number; total: number; count: number; balance: number; missing: number;
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
   * THE ACTION ISLAND — pinned to the bottom of the left column so the cost
   * and the CTA are reachable from any scroll position. Deliberately small:
   * two figures, one button, one status line.
   */
  return (
    <div className="panel shrink-0 rounded-2xl px-3.5 py-3">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 shrink-0 gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-medium leading-tight text-faint">{t("genv3.costPerShot")}</p>
            <p className="metric text-[14px] leading-tight text-accent">
              {n(perShot)} <span className="text-[10px] font-semibold text-muted">{t("genv3.credits")}</span>
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-medium leading-tight text-faint">{t("genv3.costTotal")}</p>
            <p className="metric text-[14px] leading-tight text-accent">
              {n(total)} <span className="text-[10px] font-semibold text-muted">{t("genv3.credits")}</span>
            </p>
          </div>
        </div>
        <button type="button" disabled={!canGenerate} onClick={onGenerate}
          className={cn(
            "cta flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold",
            !canGenerate && "cursor-not-allowed opacity-55",
          )}>
          {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}
          <span className="truncate">{busy && busyLabel ? busyLabel : t("genv3.generateN", { n: count })}</span>
        </button>
      </div>
      {missing > 0 ? (
        <p className="mt-1.5 text-[11px] font-medium text-danger">
          {t("studio.missing", { n: missing })}{" · "}
          <Link href="/credits" className="font-semibold text-accent hover:opacity-75">{t("credits.topup")}</Link>
        </p>
      ) : note ? (
        <p className="mt-1.5 text-[11px] text-muted">{note}</p>
      ) : (
        <p className="mt-1.5 text-[10.5px] tabular-nums text-faint">{t("gtb.balance", { n: n(balance) })}</p>
      )}
    </div>
  );
}
