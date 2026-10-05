"use client";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

/**
 * READ-ONLY IMAGE PREVIEW — a big look at photos the customer already added.
 *
 * Purely presentational: it receives display URLs and shows them. It never
 * touches the files, their order, the upload state or any request, and it
 * never revokes a URL (the owner of the ObjectURL does that, or not at all).
 *
 * Portalled to <body>: a `fixed` element inside `.panel` (backdrop-filter) is
 * clipped to the card — see components/ui/modal.tsx.
 *
 * Keys: Escape closes, ←/→ step through. Captured on the window and stopped,
 * so an Escape here closes the preview only, never a dialog underneath.
 */
export function ImageLightbox({
  images, index, onIndex, onClose,
}: {
  images: { key: string; src: string }[];
  /** The image shown, or null when closed. */
  index: number | null;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);
  const count = images.length;
  const open = index !== null && count > 0;
  const current = open ? Math.min(index, count - 1) : 0;

  // The list can change underneath (a photo removed elsewhere): close when it
  // empties rather than pointing at nothing.
  useEffect(() => {
    if (index !== null && count === 0) onClose();
  }, [index, count, onClose]);

  // Latest callbacks/position in refs, so opening (focus + scroll lock) runs
  // once per open — not on every parent render.
  const live = useRef({ onIndex, onClose, current, count });
  live.current = { onIndex, onClose, current, count };

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      const l = live.current;
      if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); l.onClose(); return; }
      if (l.count < 2) return;
      if (e.key === "ArrowLeft") { e.stopPropagation(); e.preventDefault(); l.onIndex((l.current - 1 + l.count) % l.count); }
      if (e.key === "ArrowRight") { e.stopPropagation(); e.preventDefault(); l.onIndex((l.current + 1) % l.count); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      // Focus returns to the thumbnail that opened the preview.
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  const shown = images[current]!;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-3 backdrop-blur-sm sm:p-6"
      role="dialog" aria-modal="true" data-image-lightbox>
      <button type="button" aria-label={t("common.close")} onClick={onClose} tabIndex={-1}
        className="absolute inset-0 cursor-zoom-out" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img key={shown.key} src={shown.src} alt=""
        className="relative max-h-[86dvh] max-w-full rounded-xl object-contain shadow-2xl" />
      <button ref={closeRef} type="button" aria-label={t("common.close")} onClick={onClose}
        className="absolute right-3 top-3 rounded-full bg-black/55 p-2 text-white transition-colors hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
        <X size={18} aria-hidden />
      </button>
      {count > 1 && (
        <>
          <button type="button" aria-label={t("genv3.prev")} onClick={() => onIndex((current - 1 + count) % count)}
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/55 p-2 text-white transition-colors hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white sm:left-4">
            <ChevronLeft size={22} aria-hidden />
          </button>
          <button type="button" aria-label={t("genv3.next")} onClick={() => onIndex((current + 1) % count)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/55 p-2 text-white transition-colors hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white sm:right-4">
            <ChevronRight size={22} aria-hidden />
          </button>
          <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-2.5 py-1 text-[12px] font-semibold tabular-nums text-white">
            {current + 1} / {count}
          </span>
        </>
      )}
    </div>,
    document.body,
  );
}
