"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Images, Loader2, PenLine, Upload } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Textarea } from "@/components/ui/input";
import { SortablePhotoGrid } from "@/components/genv3/sortable-grid";
import { InfoHint } from "@/components/ui/hint";
import { PhotoUploader, UPLOAD_ACCEPT, normalizeFiles } from "@/components/genv3/uploader";
import { cn } from "@/lib/utils";
import type { UploadedRef } from "@/components/genv3/types";
import type { CategoryVariant } from "@/lib/categories";
import {
  SmartPromptButton, SmartPromptCorner, SmartPromptRestore, SmartPromptStatus, type SmartPromptControls,
} from "@/components/genv3/smart-prompt";

/** Section heading exactly like the reference: bold label, optional
 *  "(opcjonalnie)", a help glyph carrying the hint as its tooltip. */
export function SectionLabel({ children, optional, hint }: {
  children: React.ReactNode; optional?: boolean; hint?: string;
}) {
  const { t } = useI18n();
  return (
    <p className="mb-2.5 flex items-center gap-1.5 text-[14px] font-semibold tracking-tight">
      {children}
      {optional && <span className="font-normal text-faint">({t("genv3.optional")})</span>}
      {hint && <InfoHint text={hint} />}
    </p>
  );
}

/* ── Zdjęcia produktu ─────────────────────────────────────────────────── */

export function ProductRefsSection({ refs, uploading, max, onUpload, onRemove, onMove, reorderHint, usable, usableNote }: {
  refs: UploadedRef[];
  uploading: boolean;
  max: number;
  onUpload: (files: File[]) => void;
  onRemove: (index: number) => void;
  /** Drag & drop zdjęć V2: the photos' order is the order they are sent in. */
  onMove?: (from: number, to: number) => void;
  reorderHint?: string | null;
  /** Generator UX V3: the active mode sends only the first `usable`; the
   *  rest stay, greyed, and `usableNote` says so. */
  usable?: number;
  usableNote?: string;
}) {
  const { t } = useI18n();
  // Heading carries the limit, nothing else — no help glyph, and `compact`
  // removes the "drag / paste / click" line under the tiles. All three ways
  // in still work; they are just no longer narrated. `zone` makes the empty
  // state one wide dropzone, the same one Retusz shows.
  return (
    <PhotoUploader
      preview
      items={refs}
      max={max}
      uploading={uploading}
      capturePaste
      compact
      zone
      dropTarget="refs"
      onFiles={onUpload}
      onRemove={onRemove}
      onMove={onMove}
      // The first product photo is the one a model with fewer reference
      // slots always keeps (lib/server/generation.ts trims from the end).
      primaryLabel
      reorderHint={reorderHint}
      usable={usable}
      usableNote={usableNote}
      label={t("genv3.photos", { n: max })}
    />
  );
}

/* ── Sesja (reklamowa / lifestyle) ────────────────────────────────────── */

export type SessionKey = "advertising" | "lifestyle";
export type SessionPreviewMap = Partial<Record<SessionKey, string | null>>;

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
export function PromptSection({ value, onChange, max, smart }: {
  value: string; onChange: (v: string) => void; max: number;
  /** Inteligentny prompt (components/genv3/smart-prompt.tsx); absent = no button. */
  smart?: SmartPromptControls;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLElement>(null);
  const filled = value.trim().length > 0;
  const nearCap = value.length > max * 0.9;
  // The corner icon sits over the text's first line; the text makes room.
  const corner = !!smart?.offered && !!smart.session && smart.enhanced;

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
        <div className="relative rounded-xl border border-[rgb(var(--accent)/0.45)] bg-sunken/50 p-2">
          {smart && <SmartPromptCorner smart={smart} />}
          <Textarea
            ref={areaRef}
            data-prompt-input
            value={value}
            maxLength={max}
            // While a rewrite is on its way the text stays put: typing now
            // would be overwritten by the answer a moment later.
            readOnly={smart?.busy}
            aria-busy={smart?.busy || undefined}
            placeholder={t("genv3.promptPh")}
            aria-label={t("genv3.prompt")}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}
            className={cn(
              "thin-scroll max-h-[38dvh] min-h-[7.5rem] resize-y border-0 bg-transparent px-1.5 py-1 focus:bg-transparent focus:ring-0 sm:max-h-64",
              corner && "pr-9",
              smart?.busy && "opacity-70",
            )}
          />
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-1.5">
            <span className="flex items-center gap-3">
              <button type="button" data-prompt-collapse onClick={() => setOpen(false)}
                className="flex items-center gap-1 text-[10.5px] font-semibold text-faint transition-colors hover:text-accent">
                <ChevronDown size={11} aria-hidden className="rotate-180" />
                {t("genv3.promptCollapse")}
              </button>
              {smart && <SmartPromptRestore smart={smart} />}
            </span>
            {/* Wraps on its own too: on a 320px phone the pill and the counter
                do not fit side by side, and the counter takes the next line. */}
            <span className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
              {smart && <SmartPromptButton smart={smart} />}
              <span data-prompt-counter className={cn("text-[10.5px] font-medium tabular-nums", nearCap ? "text-accent2" : "text-faint")}>
                {value.length}/{max}
              </span>
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
      {smart && <SmartPromptStatus smart={smart} />}
    </section>
  );
}

/* ── Inspiracja (custom) ──────────────────────────────────────────────── */

/** The cap this section has always had, named so the tiles, the counter and
 *  the library picker cannot drift apart. The workspace enforces the same
 *  number again on upload — this one only shapes what the panel offers. */
const INSP_MAX = 5;

/**
 * TWO WAYS IN, ONE POOL.
 *
 * The section used to be a bare thumbnail grid whose only affordance was a
 * small "Import" tile, which made the GrovBase library invisible — there was
 * nowhere for it to be. It is now the two tiles the rest of the app already
 * speaks in (see `SessionTypeSection` above: 2-up grid, `gap-2`, `rounded-xl`,
 * `border-line`, a quiet `hover:bg-raised`):
 *
 *     [ Własna inspiracja ]   [ Wybierz inspirację ]
 *        the file picker         the curated library
 *
 * BOTH END IN THE SAME PLACE. The left one opens the file input; the right one
 * hands URLs back to the workspace, which fetches them and sends them through
 * the SAME upload. One `UploadedRef[]`, one cap, one `inspirationPaths` — the
 * generator cannot tell the two apart and does not have to.
 *
 * The header, the counter and the thumbnail grid keep the markup and the
 * classes they had, so the only thing that changed on screen is that there are
 * now two tiles where there was one.
 */
export function InspirationSection({
  items, uploading, disabled, onUpload, onRemove, onMove, reorderHint, onOpenLibrary,
}: {
  items: UploadedRef[];
  uploading: boolean;
  disabled?: boolean;
  onUpload: (files: File[]) => void;
  onRemove: (index: number) => void;
  /** Drag & drop zdjęć V2: inspiration is sent in this order (the first two
   *  go to the model). Never labelled "Główne". */
  onMove?: (from: number, to: number) => void;
  reorderHint?: string | null;
  /** Opens the GrovBase library. Omitted → only the upload tile is offered. */
  onOpenLibrary?: () => void;
}) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const full = items.length >= INSP_MAX;

  if (disabled) {
    return (
      <section>
        <SectionLabel optional hint={t("genv3.inspHint")}>{t("genv3.insp")}</SectionLabel>
        <p className="rounded-xl bg-raised px-3.5 py-3 text-[12px] leading-relaxed text-muted">{t("genv3.inspUnsupported")}</p>
      </section>
    );
  }

  const take = (list: FileList | null) => {
    const { files } = normalizeFiles(list);
    if (files.length > 0) onUpload(files);
  };

  return (
    // `data-drop-target` is what routes a drag landing here to the inspiration
    // pool rather than to product photos. It stays on the section, so dropping
    // anywhere in the block — over either tile or the thumbnails — still works
    // exactly as it did.
    <section data-drop-target="insp">
      {/* Unchanged from the uploader's own header: same spacing, same sizes,
          same counter. */}
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[14px] font-semibold tracking-tight">
          {t("genv3.insp")}
          <span className="font-normal text-faint">({t("genv3.optional")})</span>
          <InfoHint text={t("genv3.inspHint")} />
        </p>
        <span className="shrink-0 text-[11.5px] font-semibold tabular-nums text-faint">
          {items.length}/{INSP_MAX}
        </span>
      </div>

      <input ref={fileRef} type="file" multiple accept={UPLOAD_ACCEPT} className="hidden"
        onChange={(e) => { take(e.target.files); e.target.value = ""; }} />

      {/* 50/50, and it stays 50/50 all the way down. Two tiles carrying one
          short line each still read at 320px — the panel is the full width of
          the phone there, which is wider than the desktop column they already
          share. Stacking them would be a rule with nothing to fix. */}
      <div className="flex flex-wrap gap-2">
        <InspTile
          icon={Upload}
          label={t("genv3.inspOwn")}
          busy={uploading}
          disabled={full || uploading}
          onClick={() => fileRef.current?.click()}
        />
        {onOpenLibrary && (
          <InspTile
            icon={Images}
            label={t("genv3.inspPick")}
            disabled={full}
            onClick={onOpenLibrary}
          />
        )}
      </div>

      {items.length > 0 && (
        <div className="mt-2">
          <SortablePhotoGrid items={items} onMove={onMove} onRemove={onRemove} gridClass="grid-cols-5" reorderHint={reorderHint} />
        </div>
      )}
    </section>
  );
}

/** One of the two — a compact row button (Generator UX V3), not a card. */
function InspTile({ icon: Icon, label, onClick, disabled, busy }: {
  icon: typeof Upload; label: string; onClick: () => void;
  disabled?: boolean; busy?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={cn(
        "flex h-10 min-w-0 flex-1 basis-[9rem] items-center justify-center gap-2 rounded-xl border px-3 text-[12.5px] font-semibold text-ink transition-colors duration-200",
        "border-line hover:border-[rgb(var(--accent)/0.55)] hover:bg-accent-soft/25",
        "focus-visible:border-[rgb(var(--accent)/0.55)]",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line disabled:hover:bg-transparent",
      )}>
      {busy ? <Loader2 size={15} className="animate-spin text-accent" aria-hidden /> : <Icon size={15} aria-hidden className="text-accent" />}
      <span className="truncate">{label}</span>
    </button>
  );
}
