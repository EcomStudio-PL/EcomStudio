"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Upload, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { UploadedRef } from "@/components/genv3/types";
import {
  acceptFiles, filesFromClipboard as clipboardFiles, type IntakeLimits,
} from "@/lib/images/file-intake";
import { FileDropOverlay, useFileDrop as useSharedFileDrop } from "@/components/ui/file-drop";

export const UPLOAD_ACCEPT = "image/jpeg,image/png,image/webp,image/avif";

/**
 * What the generator takes. Ten megabytes rather than the fifteen the batch
 * tools allow, because every one of these is uploaded to storage and then sent
 * to a provider — the ceiling is the provider's, not sharp's.
 */
const GENERATOR_LIMITS: IntakeLimits = {
  mime: ["image/jpeg", "image/png", "image/webp", "image/avif"],
  ext: null,
  maxBytes: 10 * 1024 * 1024,
  maxFiles: 24,
};

export type NormalizedFiles = {
  files: File[];
  /** Rejected because the type is not one the pipeline can process. */
  badType: number;
  /** Rejected because the file is larger than the per-image limit. */
  tooLarge: number;
};

/**
 * THE ONE ENTRY POINT for every image the seller adds to the generator — the
 * file picker, a drag from Finder/Explorer and a clipboard paste all pass
 * through here.
 *
 * The rules themselves now live in lib/images/file-intake.ts, shared with the
 * editor and the batch tools; this function is the generator's limits applied
 * to that gate, kept under its old name and shape so nothing that calls it had
 * to change.
 */
export function normalizeFiles(list: FileList | File[] | null | undefined): NormalizedFiles {
  const { accepted, badType, tooLarge } = acceptFiles(list, GENERATOR_LIMITS, GENERATOR_LIMITS.maxFiles);
  return { files: accepted, badType, tooLarge };
}

/** Files pulled off a paste event, same validation as every other route. */
export function filesFromClipboard(e: ClipboardEvent): File[] {
  return normalizeFiles(clipboardFiles(e)).files;
}

/**
 * WORKSPACE-WIDE FILE DROP — the generator's adapter over the shared hook.
 *
 * This behaviour started here and is now `useFileDrop` in
 * components/ui/file-drop.tsx, used by every image tool in GrovBase. The
 * wrapper survives because the generator and Retusz want validated `File[]`,
 * while the batch tools want the raw list so they can report their own batch
 * ceiling.
 */
export function useFileDrop({ onDrop, enabled = true }: {
  onDrop: (files: File[], event: DragEvent) => void;
  enabled?: boolean;
}): boolean {
  const handler = useRef(onDrop);
  handler.current = onDrop;
  return useSharedFileDrop({
    enabled,
    onFiles: (list, event) => handler.current(normalizeFiles(list).files, event),
  });
}

/** The generator's drop card. Panel-scoped rather than fullscreen: the
 *  workspace is one column of a wider page here. */
export const DropOverlay = FileDropOverlay;

/**
 * The photos block itself: thumbnails, the add tile and the counter. Drops
 * are handled by the workspace (see `useFileDrop`), so this component only
 * owns the picker and — for the one instance that asks for it — the paste
 * shortcut.
 */
export function PhotoUploader({
  items, max, uploading, label, hint, counter = true, compact, capturePaste, dropTarget,
  onFiles, onRemove, columns = 4, zone,
}: {
  items: UploadedRef[];
  max: number;
  uploading: boolean;
  label: React.ReactNode;
  /** Small helper under the grid — kept short; the counter lives in the
   *  header. `compact` drops it entirely: the product-photo block wants
   *  nothing under the tiles, and the ways to add a file (click, drop,
   *  paste) all keep working without being spelled out. */
  hint?: string;
  counter?: boolean;
  compact?: boolean;
  /** Exactly ONE uploader per screen may claim the page-wide paste shortcut.
   *  The custom generator mounts two (product photos + inspiration); without
   *  this only-one rule a single Ctrl+V would land the same image in both
   *  pools, uploading it twice and seeding inspiration the seller never
   *  chose. Product photos are the sensible owner of a paste. */
  capturePaste?: boolean;
  /** Marks this block so a drop landing on it is routed to THIS pool. */
  dropTarget?: string;
  onFiles: (files: File[]) => void;
  onRemove: (index: number) => void;
  columns?: 4 | 5;
  /** THE BIG ZONE. With nothing uploaded yet the block is one wide dropzone —
   *  icon, "Import", "0 / 10 zdjęć" — instead of a row of empty tiles: ten
   *  identical dashed squares read as ten separate slots to fill one by one,
   *  and each one is a smaller target than the single area they occupy. The
   *  moment a photo lands the block becomes the thumbnail grid with ONE small
   *  add tile, because from then on the photos are the content and the zone
   *  would only push them down. Off by default — the inspiration strip stays
   *  the compact grid it is. */
  zone?: boolean;
}) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const full = items.length >= max;
  const bigZone = !!zone && items.length === 0;

  const take = useCallback((list: FileList | File[] | null | undefined) => {
    const { files } = normalizeFiles(list);
    if (files.length > 0) onFiles(files);
  }, [onFiles]);

  // Ctrl/Cmd+V anywhere on the page — except while typing, where a paste
  // belongs to the field the caret is in.
  useEffect(() => {
    if (!capturePaste) return;
    const onPaste = (e: ClipboardEvent) => {
      if (full || uploading) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const files = filesFromClipboard(e);
      if (files.length > 0) {
        e.preventDefault();
        onFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [capturePaste, full, uploading, onFiles]);

  return (
    <section data-drop-target={dropTarget}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[13.5px] font-semibold tracking-tight">{label}</p>
        {counter && !bigZone && (
          <span className="shrink-0 text-[11.5px] font-semibold tabular-nums text-faint">
            {items.length}/{max}
          </span>
        )}
      </div>

      <input ref={fileRef} type="file" multiple accept={UPLOAD_ACCEPT} className="hidden"
        onChange={(e) => { take(e.target.files); e.target.value = ""; }} />

      {bigZone ? (
        <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}
          data-upload-zone
          aria-label={t("genv3.addPhotos")}
          className={cn(
            "flex w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed px-4 py-7 text-center transition-colors duration-200",
            "border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*3))] bg-sunken/50 text-faint",
            "hover:border-[rgb(var(--accent)/0.55)] hover:bg-accent-soft/25 hover:text-accent",
            "focus-visible:border-[rgb(var(--accent)/0.55)] disabled:cursor-wait disabled:opacity-60",
          )}>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgb(var(--accent)/0.1)] text-accent">
            {uploading
              ? <Loader2 size={18} className="animate-spin" aria-hidden />
              : <ImagePlus size={18} aria-hidden />}
          </span>
          <span className="text-[13px] font-semibold tracking-tight text-ink">{t("genv3.uploadImport")}</span>
          <span className="text-[11px] font-medium tabular-nums text-faint">
            {t("genv3.uploadCount", { n: items.length, max })}
          </span>
        </button>
      ) : (
      <div className={cn("grid gap-2 [&>*]:min-w-0", columns === 5 ? "grid-cols-5" : "grid-cols-4 sm:grid-cols-5")}>
        {items.map((r, i) => (
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
        {!full && (
          <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}
            aria-label={t("genv3.addPhotos")}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2.5))] bg-sunken/60 text-faint transition-colors duration-200 hover:border-[rgb(var(--accent)/0.6)] hover:bg-accent-soft/30 hover:text-accent">
            {uploading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Upload size={16} aria-hidden />}
            <span className="px-1 text-center text-[10px] font-semibold leading-tight">{t("genv3.addPhotos")}</span>
          </button>
        )}
      </div>
      )}

      {!compact && (
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-faint">{hint ?? t("genv3.uploadWays")}</p>
      )}
    </section>
  );
}
