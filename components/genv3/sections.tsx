"use client";
import { useRef } from "react";
import Link from "next/link";
import {
  Check, HelpCircle, ImagePlus, Loader2, Megaphone, Minus, Plus, Sparkles, Sun, Upload, X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/record";
import { ProductChoice, type PickableProduct } from "@/components/products/product-picker";
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

const ACCEPT = "image/jpeg,image/png,image/webp,image/avif";

/* ── Zdjęcia produktu ─────────────────────────────────────────────────── */

export function ProductRefsSection({ refs, uploading, product, onPickProduct, onClearProduct, onUpload, onRemove }: {
  refs: UploadedRef[];
  uploading: boolean;
  product: PickableProduct | null;
  onPickProduct: () => void;
  onClearProduct: () => void;
  onUpload: (files: FileList) => void;
  onRemove: (index: number) => void;
}) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <section>
      <SectionLabel hint={t("genv3.photosHint")}>{t("genv3.photos")}</SectionLabel>
      <div className="mb-2.5">
        <ProductChoice
          subtle
          product={product}
          onPick={onPickProduct}
          onClear={onClearProduct}
          newLabel={t("studio.newProduct")}
        />
      </div>
      <input ref={fileRef} type="file" multiple accept={ACCEPT} className="hidden"
        onChange={(e) => { if (e.target.files?.length) onUpload(e.target.files); e.target.value = ""; }} />
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 [&>*]:min-w-0">
        {refs.map((r, i) => (
          <div key={r.key} className="group relative aspect-square overflow-hidden rounded-xl ring-1 ring-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2))]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={r.url} alt="" className="h-full w-full object-cover" loading="lazy" />
            <button type="button" aria-label={t("common.delete")}
              onClick={() => onRemove(i)}
              className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity duration-200 focus-visible:opacity-100 group-hover:opacity-100">
              <X size={10} aria-hidden />
            </button>
          </div>
        ))}
        {refs.length < 8 && (
          <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}
            aria-label={t("genv3.addPhotos")}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) onUpload(e.dataTransfer.files); }}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2.5))] bg-sunken/60 text-faint transition-colors duration-200 hover:border-[rgb(var(--accent)/0.6)] hover:bg-accent-soft/30 hover:text-accent">
            {uploading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <ImagePlus size={16} aria-hidden />}
            <span className="px-1 text-center text-[9.5px] font-semibold leading-tight">{t("genv3.addPhotos")}</span>
          </button>
        )}
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-faint">{t("genv3.photosTip")}</p>
    </section>
  );
}

/* ── Opis produktu ────────────────────────────────────────────────────── */

export function DescriptionSection({ showName, name, onName, description, onDescription }: {
  showName: boolean;
  name: string; onName: (v: string) => void;
  description: string; onDescription: (v: string) => void;
}) {
  const { t } = useI18n();
  return (
    <section>
      <SectionLabel optional hint={t("genv3.descHint")}>{t("genv3.desc")}</SectionLabel>
      <div className="space-y-2.5">
        {showName && (
          <div>
            <Label htmlFor="gen-name">{t("psess.name")} *</Label>
            <Input id="gen-name" value={name} placeholder={t("products.namePh")}
              onChange={(e) => onName(e.target.value)} />
          </div>
        )}
        <Textarea rows={2} value={description} placeholder={t("genv3.descPh")}
          aria-label={t("genv3.desc")}
          onChange={(e) => onDescription(e.target.value)} />
      </div>
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
        {Array.from({ length: count }, (_, i) => {
          const b = briefs[i] ?? { text: "", keepFraming: false };
          const ref = refs[i] ?? null;
          const hasText = b.text.trim().length > 0;
          return (
            <div key={i} className={cn(
              "flex items-center gap-2 rounded-xl border p-1.5 pl-2.5 transition-colors duration-200",
              hasText ? "border-[rgb(var(--accent)/0.35)] bg-accent-soft/20" : "border-line bg-sunken/40",
            )}>
              <span className={cn("w-4 shrink-0 text-center text-[11px] font-bold tabular-nums", hasText ? "text-accent" : "text-faint")}>
                {i + 1}
              </span>
              <span className="h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-sunken ring-1 ring-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.5))]">
                {ref ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ref.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-faint"><Upload size={11} aria-hidden /></span>
                )}
              </span>
              <input
                value={b.text}
                onChange={(e) => onChange(i, { text: e.target.value })}
                placeholder={t("genv3.briefPh")}
                maxLength={300}
                aria-label={t("genv3.briefAria", { n: i + 1 })}
                className="h-9 min-w-0 flex-1 bg-transparent text-[12.5px] font-medium text-ink outline-none placeholder:text-faint"
              />
              <span className="flex shrink-0 items-center gap-1.5 pr-1" title={t("genv3.keepFramingHint")}>
                <span className={cn("hidden text-[10px] font-semibold sm:block", hasText && b.keepFraming ? "text-accent" : "text-faint")}>
                  {t("genv3.keepFraming")}
                </span>
                <Switch
                  checked={hasText && b.keepFraming}
                  disabled={!hasText}
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
  onUpload: (files: FileList) => void;
  onRemove: (index: number) => void;
}) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <section>
      <SectionLabel optional hint={t("genv3.inspHint")}>{t("genv3.insp")}</SectionLabel>
      {disabled ? (
        <p className="rounded-xl bg-raised px-3.5 py-3 text-[12px] leading-relaxed text-muted">{t("genv3.inspUnsupported")}</p>
      ) : (
        <>
          <input ref={fileRef} type="file" multiple accept={ACCEPT} className="hidden"
            onChange={(e) => { if (e.target.files?.length) onUpload(e.target.files); e.target.value = ""; }} />
          {items.length > 0 && (
            <div className="mb-2 grid grid-cols-5 gap-2 [&>*]:min-w-0">
              {items.map((r, i) => (
                <div key={r.key} className="group relative aspect-square overflow-hidden rounded-xl ring-1 ring-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2))]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  <button type="button" aria-label={t("common.delete")} onClick={() => onRemove(i)}
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity duration-200 focus-visible:opacity-100 group-hover:opacity-100">
                    <X size={10} aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          )}
          {items.length < 5 && (
            <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) onUpload(e.dataTransfer.files); }}
              className="flex w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2.5))] bg-sunken/40 px-3 py-5 text-faint transition-colors duration-200 hover:border-[rgb(var(--accent)/0.6)] hover:bg-accent-soft/20 hover:text-accent">
              {uploading ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Upload size={15} aria-hidden />}
              <span className="text-[12px] font-semibold">{t("genv3.inspAdd")}</span>
              <span className="text-[10.5px] text-faint">{t("genv3.inspSub")}</span>
            </button>
          )}
          <p className="mt-1.5 text-right text-[10.5px] font-semibold tabular-nums text-faint">{items.length}/5</p>
        </>
      )}
    </section>
  );
}

/* ── Podsumowanie kosztów ─────────────────────────────────────────────── */

export function CostSummary({
  perShot, total, count, balance, missing, busy, busyLabel, canGenerate,
  engineUnavailable, needsPhotos, needsContext, needsPrompt, onGenerate,
}: {
  perShot: number; total: number; count: number; balance: number; missing: number;
  busy: boolean; busyLabel: string; canGenerate: boolean;
  engineUnavailable?: boolean;
  needsPhotos?: boolean; needsContext?: boolean; needsPrompt?: boolean;
  onGenerate: () => void;
}) {
  const { t, locale } = useI18n();
  const n = (v: number) => new Intl.NumberFormat(locale).format(v);
  const note = engineUnavailable ? t("psess.unavailable")
    : needsPhotos ? t("genv3.needPhotos")
      : needsContext ? t("studio.needContext")
        : needsPrompt ? t("genv3.needPrompt")
          : missing > 0 ? null : null;
  return (
    <div className="panel shrink-0 rounded-2xl p-4">
      <p className="mb-2.5 text-[13.5px] font-semibold tracking-tight">{t("genv3.costTitle")}</p>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex gap-5">
          <div>
            <p className="text-[10.5px] font-medium text-faint">{t("genv3.costPerShot")}</p>
            <p className="metric text-[15px] leading-tight text-accent">{n(perShot)} <span className="text-[11px] font-semibold text-muted">{t("genv3.credits")}</span></p>
          </div>
          <div>
            <p className="text-[10.5px] font-medium text-faint">{t("genv3.costTotal")}</p>
            <p className="metric text-[15px] leading-tight text-accent">{n(total)} <span className="text-[11px] font-semibold text-muted">{t("genv3.credits")}</span></p>
          </div>
        </div>
        <button type="button" disabled={!canGenerate} onClick={onGenerate}
          className={cn(
            "cta flex h-11 min-w-[11rem] flex-1 items-center justify-center gap-2 rounded-xl px-4 text-[14px] font-semibold sm:flex-none",
            !canGenerate && "cursor-not-allowed opacity-55",
          )}>
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Sparkles size={15} aria-hidden />}
          <span className="truncate">{busy && busyLabel ? busyLabel : t("genv3.generateCta")}</span>
          {!busy && <span className="shrink-0 rounded-md bg-white/20 px-1.5 py-0.5 text-[12px] tabular-nums">◇ {n(total)}</span>}
        </button>
      </div>
      {missing > 0 ? (
        <p className="mt-2 text-[11.5px] font-medium text-danger">
          {t("studio.missing", { n: missing })}{" "}
          <Link href="/credits" className="font-semibold text-accent hover:opacity-75">{t("credits.topup")}</Link>
        </p>
      ) : note ? (
        <p className="mt-2 text-[11.5px] text-muted">{note}</p>
      ) : (
        <p className="mt-2 text-[11px] tabular-nums text-faint">{t("gtb.balance", { n: n(balance) })} · {t("genv3.countLabel", { n: count })}</p>
      )}
    </div>
  );
}
