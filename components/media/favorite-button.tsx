"use client";
import { useState } from "react";
import { Heart } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * ULUBIONE V2 — THE ONE HEART. Every gallery (the Library, a tool's results,
 * the generator) and the image view use this button, so a like looks and
 * behaves the same everywhere; the styles are `.fav-*` in globals.css.
 *
 *   tile — the corner of a picture: 40×40 hit area, 32px glass pill, 18px
 *          heart. Liked: always shown, red. Not liked: hover/focus reveal
 *          with a pointer, quieter but present on touch.
 *   wide — the image view: "♡ Dodaj do ulubionych" / "♥ W ulubionych".
 *
 * A click toggles the like and nothing else: it never opens the picture,
 * ticks the checkbox or reaches the tile's other handlers. Filled vs outlined
 * is the state's shape, not only its colour.
 */
export function FavoriteButton({ active, onToggle, variant = "tile", className }: {
  active: boolean;
  onToggle: () => void;
  variant?: "tile" | "wide";
  className?: string;
}) {
  const { t } = useI18n();
  // The pop plays on a LIKE only, and only for the click that made it.
  const [pop, setPop] = useState(0);
  const label = active ? t("library.favRemove") : t("library.favAdd");
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={variant === "tile" ? label : undefined}
      data-favorite={active ? "on" : "off"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!active) setPop((n) => n + 1);
        onToggle();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") e.stopPropagation(); }}
      className={cn(variant === "tile" ? "fav-btn fav-tile" : "fav-wide", active && pop > 0 && "fav-pop", className)}
    >
      {variant === "tile" ? (
        <span key={pop} className="fav-pill"><Heart aria-hidden strokeWidth={2.2} /></span>
      ) : (
        <>
          <Heart key={pop} aria-hidden strokeWidth={2.2} />
          {active ? t("library.favIn") : t("library.favAdd")}
        </>
      )}
    </button>
  );
}

/** The thin red ring around a liked tile. An inset shadow on an overlay, so
 *  the tile never changes size; hidden when the admin turned the ring off. */
export function FavoriteRing({ active }: { active: boolean }) {
  if (!active) return null;
  return <span aria-hidden data-fav-ring className="fav-ring pointer-events-none absolute inset-0 z-[1] rounded-[inherit]" />;
}
