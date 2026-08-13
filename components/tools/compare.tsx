"use client";
import { useId, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";

/**
 * BEFORE / AFTER — one slider, both layouts.
 *
 * A phone has no room for two photos side by side, so the comparison is a
 * single frame with a draggable divider; the same component on a wide screen
 * simply gets more pixels. The control is a real range input, which means
 * keyboard and screen-reader users get the comparison too, and touch dragging
 * works without any pointer-event bookkeeping.
 */
export function Compare({ before, after, alt }: { before: string; after: string; alt: string }) {
  const { t } = useI18n();
  const [position, setPosition] = useState(50);
  const id = useId();

  return (
    <div className="min-w-0">
      <div className="relative overflow-hidden rounded-xl bg-checker">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={after} alt={alt} className="block max-h-[52vh] w-full object-contain" />
        <div className="absolute inset-0 overflow-hidden" style={{ width: `${position}%` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={before}
            alt=""
            aria-hidden
            className="block h-full w-full object-contain"
            style={{ width: `${(100 / Math.max(position, 1)) * 100}%`, maxWidth: "none" }}
          />
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/90 shadow-e2"
          style={{ left: `${position}%` }} />
        <span aria-hidden className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
          {t("tools.before")}
        </span>
        <span aria-hidden className="pointer-events-none absolute right-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
          {t("tools.after")}
        </span>
      </div>
      <label htmlFor={id} className="sr-only">{t("tools.compare")}</label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        value={position}
        onChange={(e) => setPosition(Number(e.target.value))}
        className="mt-2 w-full accent-[rgb(var(--accent))]"
      />
    </div>
  );
}
