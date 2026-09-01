"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { UploadedRef } from "@/components/genv3/types";

export const UPLOAD_ACCEPT = "image/jpeg,image/png,image/webp,image/avif";
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

/**
 * THE ONE UPLOADER — both generators use this component, so "add photos"
 * behaves identically everywhere. Three ways in, all real:
 *
 *   1. click        → the native file picker
 *   2. drag & drop  → files dragged straight from Finder/Explorer. The
 *      window-level dragover/drop guards below are what stop the browser
 *      from NAVIGATING to a dropped image (the default action that used to
 *      open the photo as if it were a link) — a dropzone alone cannot
 *      prevent it, because a drop landing anywhere outside the zone is still
 *      the browser's to handle.
 *   3. paste        → Ctrl/Cmd+V of an image copied from a shop page. Only
 *      real image blobs on the clipboard are taken; pasting into a text
 *      field is left alone.
 */
export function PhotoUploader({
  items, max, uploading, label, hint, counter = true, compact, onFiles, onRemove, columns = 4,
}: {
  items: UploadedRef[];
  max: number;
  uploading: boolean;
  label: React.ReactNode;
  /** Small helper under the grid — kept short; the counter lives in the header. */
  hint?: string;
  counter?: boolean;
  compact?: boolean;
  onFiles: (files: File[]) => void;
  onRemove: (index: number) => void;
  columns?: 4 | 5;
}) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  // A drag over nested children fires enter/leave repeatedly; counting the
  // pairs is what keeps the highlight from flickering.
  const dragDepth = useRef(0);
  const full = items.length >= max;

  const take = useCallback((list: FileList | File[] | null | undefined) => {
    if (!list) return;
    const files = Array.from(list).filter((f) => ACCEPTED.has(f.type));
    if (files.length > 0) onFiles(files);
  }, [onFiles]);

  // The browser's default for a dropped file is to open it. Suppress that for
  // the whole document while this uploader is mounted, so a near-miss drop
  // never throws the seller out of the generator.
  useEffect(() => {
    const swallow = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, []);

  // Ctrl/Cmd+V anywhere on the page — except while typing, where a paste
  // belongs to the field the caret is in.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (full || uploading) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const files: File[] = [];
      for (const item of Array.from(e.clipboardData?.items ?? [])) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (file && ACCEPTED.has(file.type)) files.push(file);
      }
      if (files.length > 0) {
        e.preventDefault();
        onFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [full, uploading, onFiles]);

  return (
    <section
      ref={zoneRef}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        take(e.dataTransfer.files);
      }}
      className={cn(
        "relative rounded-xl transition-colors",
        dragging && "outline-dashed outline-2 outline-offset-4 outline-[rgb(var(--accent)/0.6)]",
      )}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[13.5px] font-semibold tracking-tight">{label}</p>
        {counter && (
          <span className="shrink-0 text-[11.5px] font-semibold tabular-nums text-faint">
            {items.length}/{max}
          </span>
        )}
      </div>

      <input ref={fileRef} type="file" multiple accept={UPLOAD_ACCEPT} className="hidden"
        onChange={(e) => { take(e.target.files); e.target.value = ""; }} />

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
            className={cn(
              "flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed bg-sunken/60 text-faint transition-colors duration-200 hover:border-[rgb(var(--accent)/0.6)] hover:bg-accent-soft/30 hover:text-accent",
              dragging
                ? "border-[rgb(var(--accent)/0.7)] bg-accent-soft/40 text-accent"
                : "border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2.5))]",
            )}>
            {uploading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <ImagePlus size={16} aria-hidden />}
            <span className="px-1 text-center text-[9.5px] font-semibold leading-tight">
              {dragging ? t("genv3.dropHere") : t("genv3.addPhotos")}
            </span>
          </button>
        )}
      </div>

      {!compact && (
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-faint">{hint ?? t("genv3.uploadWays")}</p>
      )}
    </section>
  );
}
