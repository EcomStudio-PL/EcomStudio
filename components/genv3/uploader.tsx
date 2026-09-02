"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { UploadedRef } from "@/components/genv3/types";

export const UPLOAD_ACCEPT = "image/jpeg,image/png,image/webp,image/avif";
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type NormalizedFiles = {
  files: File[];
  /** Rejected because the type is not one the pipeline can process. */
  badType: number;
  /** Rejected because the file is larger than the per-image limit. */
  tooLarge: number;
};

/**
 * THE ONE ENTRY POINT for every image the seller adds — the file picker, a
 * drag & drop from Finder/Explorer and a clipboard paste all hand their
 * File objects to this function, so validation can never drift between the
 * three routes.
 */
export function normalizeFiles(list: FileList | File[] | null | undefined): NormalizedFiles {
  const out: NormalizedFiles = { files: [], badType: 0, tooLarge: 0 };
  for (const file of Array.from(list ?? [])) {
    // A directory dragged in arrives as a zero-typed, zero-sized entry.
    if (!ACCEPTED.has(file.type)) { out.badType++; continue; }
    if (file.size === 0 || file.size > MAX_FILE_BYTES) { out.tooLarge++; continue; }
    out.files.push(file);
  }
  return out;
}

/** Files pulled off a paste event, same validation as every other route. */
export function filesFromClipboard(e: ClipboardEvent): File[] {
  const picked: File[] = [];
  for (const item of Array.from(e.clipboardData?.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) picked.push(file);
  }
  return normalizeFiles(picked).files;
}

const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types?.includes("Files");

/**
 * WORKSPACE-WIDE FILE DROP.
 *
 * The old dropzone only accepted a drop that landed inside the small photos
 * block; a drop anywhere else on the panel was swallowed by the navigation
 * guard and then went nowhere — which is exactly what "przeciągam i nic się
 * nie dodaje" looked like. The listeners live on the window now, so the
 * whole generator is a drop target, and `drop` is prevented unconditionally
 * for file drags so the browser can never navigate to the dropped image.
 *
 * `dragenter`/`dragleave` are counted rather than toggled: they fire again
 * for every child element the pointer crosses, and toggling made the overlay
 * flicker.
 */
export function useFileDrop({ onDrop, enabled = true }: {
  onDrop: (files: File[], event: DragEvent) => void;
  enabled?: boolean;
}): boolean {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const handler = useRef(onDrop);
  handler.current = onDrop;

  useEffect(() => {
    const reset = () => { depth.current = 0; setDragging(false); };
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Some engines only allow the drop when dragenter is prevented too.
      e.preventDefault();
      depth.current += 1;
      if (enabled) setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // WITHOUT THIS THERE IS NO DROP AT ALL: the default dragover action
      // refuses the drag, and the browser then treats the release as a
      // navigation to the file.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = enabled ? "copy" : "none";
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const onDropEvent = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      reset();
      if (!enabled) return;
      const { files } = normalizeFiles(e.dataTransfer?.files);
      handler.current(files, e);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDropEvent);
    window.addEventListener("dragend", reset);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDropEvent);
      window.removeEventListener("dragend", reset);
      window.removeEventListener("blur", reset);
    };
  }, [enabled]);

  return dragging;
}

/** The large, quiet target that appears over the workspace while files are
 *  being dragged — the seller aims at the panel, not at a 90px tile. */
export function DropOverlay({ show, title, sub }: { show: boolean; title: string; sub: string }) {
  return (
    <div
      aria-hidden={!show}
      className={cn(
        "pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-2xl transition-opacity duration-150",
        show ? "opacity-100" : "opacity-0",
      )}
      style={{ visibility: show ? "visible" : "hidden" }}
    >
      <div className="absolute inset-0 rounded-2xl bg-[rgb(var(--sunken)/0.82)] backdrop-blur-[3px]" />
      <div className="relative flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-[rgb(var(--accent)/0.55)] bg-[rgb(var(--surface))] px-8 py-7 text-center shadow-[0_20px_60px_-30px_rgb(0_0_0/0.5)]">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[rgb(var(--accent)/0.12)] text-accent">
          <Upload size={20} aria-hidden />
        </span>
        <p className="text-[14px] font-semibold tracking-tight">{title}</p>
        <p className="text-[11.5px] text-muted">{sub}</p>
      </div>
    </div>
  );
}

/**
 * The photos block itself: thumbnails, the add tile and the counter. Drops
 * are handled by the workspace (see `useFileDrop`), so this component only
 * owns the picker and — for the one instance that asks for it — the paste
 * shortcut.
 */
export function PhotoUploader({
  items, max, uploading, label, hint, counter = true, compact, capturePaste, dropTarget,
  onFiles, onRemove, columns = 4,
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
}) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const full = items.length >= max;

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
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2.5))] bg-sunken/60 text-faint transition-colors duration-200 hover:border-[rgb(var(--accent)/0.6)] hover:bg-accent-soft/30 hover:text-accent">
            {uploading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Upload size={16} aria-hidden />}
            <span className="px-1 text-center text-[10px] font-semibold leading-tight">{t("genv3.addPhotos")}</span>
          </button>
        )}
      </div>

      {!compact && (
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-faint">{hint ?? t("genv3.uploadWays")}</p>
      )}
    </section>
  );
}
