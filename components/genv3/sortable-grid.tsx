"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import { GripVertical, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { useSortablePhotos } from "@/components/genv3/sortable-photos";
import type { UploadedRef } from "@/components/genv3/types";

/**
 * THE ONE PHOTO GRID OF EVERY MULTI-PHOTO FIELD (Drag & drop zdjęć V2) —
 * product photos, references, inspiration, model photos: thumbnails, their
 * number, ×, and — when the field has an order (`onMove`) — drag & drop by
 * mouse, touch and keyboard (components/genv3/sortable-photos.ts).
 *
 * `trailing` is what follows the photos in the same grid (the Import tile):
 * never part of the order, never draggable.
 */
export function SortablePhotoGrid({
  items, onMove, onRemove, onOpen, gridClass, primaryLabel, reorderHint, trailing, usable,
}: {
  items: UploadedRef[];
  onMove?: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  /** A click on a thumbnail (the read-only preview). Absent: not clickable. */
  onOpen?: (index: number) => void;
  gridClass: string;
  primaryLabel?: boolean;
  /** undefined = the default line, "" = none, else the tool's own wording. */
  reorderHint?: string | null;
  trailing?: React.ReactNode;
  /** Generator UX V3: how many photos (from the first) this mode sends. The
   *  rest stay in the list, greyed, for the mode that uses them. */
  usable?: number;
}) {
  const { t } = useI18n();
  const [said, setSaid] = useState("");
  const sortable = useSortablePhotos({
    items, onMove, enabled: !!onMove && items.length > 1,
    announce: (kind, n, m) => setSaid(t(`dnd.${kind}`, { n, m })),
  });
  const list = onMove ? sortable.order : items;
  const hintText = reorderHint === undefined ? t("dnd.hint") : reorderHint;
  const preview = !!onOpen;
  const setViewIndex = (i: number) => onOpen?.(i);

  return (
    <>
      <div ref={sortable.gridRef} data-photo-grid={onMove ? "sortable" : undefined}
        className={cn("relative grid gap-2 [&>*]:min-w-0", gridClass)}>
        {list.map((r, i) => {
          // While a photo is held, `list` is the order it WOULD have; the
          // index into the customer's own array is what every action uses.
          const at = items.indexOf(r);
          const held = sortable.drag?.key === r.key;
          const floating = held && sortable.drag?.mode !== "keyboard";
          const picked = held && sortable.drag?.mode === "keyboard";
          return (
            <div key={r.key} data-sort-slot={onMove ? "" : undefined} data-sort-key={onMove ? r.key : undefined}
              data-photo-key={r.key} data-held={held ? sortable.drag?.mode : undefined}
              data-photo-unused={usable !== undefined && i >= usable ? "" : undefined}
              onPointerDown={onMove ? (e) => sortable.handlers.onPointerDown(e, i, r.key) : undefined}
              onTouchStart={onMove ? (e) => sortable.handlers.onTouchStart(e, i, r.key) : undefined}
              className={cn(
                "group relative aspect-square overflow-hidden rounded-xl ring-1 ring-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2))]",
                onMove && items.length > 1 && "sortable-photo",
                picked && "z-10 scale-[1.04] shadow-e2 ring-2 ring-accent",
              )}>
              {/* The photo stays in the page while it is held — only hidden.
                  A touch keeps talking to the element it started on; were
                  that element removed, the finger's moves would be lost. */}
              <div className={cn("contents", floating && "[&>*]:invisible",
                usable !== undefined && i >= usable && "[&_img]:opacity-35 [&_img]:grayscale")}>
                  {preview ? (
                    <button type="button" onClick={() => { if (!sortable.consumeClick()) setViewIndex(at); }} data-photo-preview
                      aria-label={t("genv3.thumbAria", { n: i + 1 })}
                      className="block h-full w-full cursor-zoom-in focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.url} alt="" draggable={false} className="h-full w-full object-cover" loading="lazy" />
                    </button>
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={r.url} alt="" draggable={false} className="h-full w-full object-cover" loading="lazy" />
                  )}
                  <button type="button" aria-label={t("common.delete")} data-photo-remove
                    onPointerDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); onRemove(at); }}
                    className="absolute right-1 top-1 z-10 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity duration-200 focus-visible:opacity-100 group-hover:opacity-100">
                    <X size={10} aria-hidden />
                  </button>
                  {onMove && (
                    // The photo's NUMBER is its keyboard handle: Space/Enter
                    // lifts it, arrows move it, Space/Enter drops, Escape
                    // cancels. It updates the moment the order changes.
                    <button type="button" data-photo-order={i + 1} aria-pressed={picked || undefined}
                      aria-label={t("dnd.handle", { n: i + 1, count: items.length })}
                      onKeyDown={(e) => sortable.handlers.onKeyDown(e, i, r.key)}
                      onClick={(e) => e.stopPropagation()}
                      className={cn(
                        "absolute left-1 top-1 z-10 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums text-white",
                        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                        picked ? "bg-accent" : "bg-black/60",
                      )}>
                      {i + 1}
                    </button>
                  )}
                  {primaryLabel && i === 0 && items.length > 1 && (
                    <span data-photo-primary
                      className="pointer-events-none absolute inset-x-1 bottom-1 z-10 truncate rounded-md bg-black/60 px-1 py-0.5 text-center text-[9.5px] font-semibold text-white">
                      {t("dnd.primary")}
                    </span>
                  )}
              </div>
              {floating && (
                // The held photo's slot: the place it will land, visibly.
                <span data-photo-drop-target aria-hidden
                  className="absolute inset-0 rounded-xl border-2 border-dashed border-[rgb(var(--accent)/0.7)] bg-accent-soft/30" />
              )}
            </div>
          );
        })}
        {trailing}
      </div>
      {onMove && items.length > 1 && hintText && (
        <p data-reorder-hint className="mt-1.5 flex items-center gap-1 text-[10.5px] leading-relaxed text-faint">
          <GripVertical size={11} aria-hidden className="shrink-0" />{hintText}
        </p>
      )}
      {onMove && <p className="sr-only" aria-live="assertive" data-photo-announcer>{said}</p>}
      {onMove && sortable.drag && sortable.drag.mode !== "keyboard" && typeof document !== "undefined" && createPortal(
        // The photo in the hand: it follows the pointer, a little larger and
        // lifted, while its slot in the grid shows where it will land.
        <div data-photo-floating aria-hidden
          className="photo-floating pointer-events-none fixed z-[80] overflow-hidden rounded-xl ring-2 ring-accent"
          style={{ left: sortable.drag.x, top: sortable.drag.y, width: sortable.drag.w, height: sortable.drag.h }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={items.find((x) => x.key === sortable.drag!.key)?.url} alt="" draggable={false} className="h-full w-full object-cover" />
          <span className="absolute left-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold tabular-nums text-white">
            {sortable.drag.over + 1}
          </span>
        </div>,
        document.body,
      )}
    </>
  );
}
