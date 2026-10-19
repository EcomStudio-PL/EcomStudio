"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ImageOff } from "lucide-react";
import { BeforeAfter } from "@/components/seller-home/before-after";
import { Rail } from "@/components/seller-home/rail";
import { useI18n } from "@/lib/i18n/provider";
import type { MediaPair } from "@/lib/seller-home-config";
import type { LaunchGalleryTile } from "@/lib/server/prelaunch/landing";
import type { GalleryKey } from "@/lib/launch/gallery";
import { goToForm, launchAnalyticsMuted, launchTrack } from "./launch-analytics";

/**
 * MINIATURKI · RETUSZ · MODA — one before/after gallery of the launch page.
 *
 * The /home pieces, reused rather than copied: `Rail` is the native-scroll
 * carousel (snap, arrows from sm, ←/→ between cards, reduced motion) and
 * `BeforeAfter` the divider slider whose touch drag starts only on its 44px
 * grip, so a swipe anywhere else on the picture pans the row. Four tiles
 * across from lg, two and a bit on a tablet, one and a bit on a phone — the
 * visible slice of the next tile is what says "there is more".
 *
 * `BeforeAfter` wants a config pair; a launch tile has none, so it gets
 * EMPTY_PAIR (both config halves empty) and its two library pictures as the
 * editor's halves — the same path /home takes for a slot filled in the visual
 * editor. Only COMPLETE pairs reach this component (the view model drops the
 * rest), so its empty-half placeholder never shows to a visitor.
 *
 * THE FIRST TOUCH OF EACH TILE IS A FUNNEL EVENT, measured without modifying
 * the slider: capture-phase listeners on a wrapper see the press before the
 * slider does. A mouse press anywhere on the frame moves the divider; a finger
 * or pen only does on the grip (anywhere else it scrolls the row, which is
 * not an interaction with the comparison); a key only when it is one that
 * moves the range — a Tab passing through is not one.
 */

/**
 * 1080² — the square every launch tile is drawn at, the same as /home's
 * BEFORE_AFTER_SIZE. Written out rather than imported: lib/seller-home-config
 * is the /home registry and carries its whole `sellerHome.*` key table, and
 * a runtime import from this public page would put that namespace into every
 * public page's client dictionary (scripts/i18n-scope-tests.ts derives the
 * scopes from the import graph). Types are imported; values are not.
 */
const TILE = { width: 1080, height: 1080 } as const;

/** BeforeAfter's config pair, empty on both sides: the pictures come in as
 *  the editor's halves. */
const EMPTY_PAIR: MediaPair = {
  before: { configKey: "launch-gallery-before", kind: "image", src: null, ...TILE },
  after: { configKey: "launch-gallery-after", kind: "image", src: null, ...TILE },
};

const RATIO = `${TILE.width}/${TILE.height}`;
/** Four across from lg, about 2.4 on a tablet, 1.3 on a phone (R2.3). */
const SIZES = "(max-width: 639px) 76vw, (max-width: 1023px) 40vw, 25vw";
const SLIDER_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

export function LaunchGallery({ galleryKey, eyebrow, title, tiles, labels, cta }: {
  galleryKey: GalleryKey;
  eyebrow: string;
  title: string;
  tiles: LaunchGalleryTile[];
  /** PRZED / PO — the launch copy's own words for the two sides. */
  labels: { before: string; after: string };
  /** "Zapisz się i wypróbuj na swoim produkcie". */
  cta: string;
}) {
  const { t } = useI18n();
  const seen = useRef(new Set<string>());
  const titleId = `launch-gallery-${galleryKey}-title`;

  const first = (tile: LaunchGalleryTile) => {
    if (seen.current.has(tile.id)) return;
    seen.current.add(tile.id);
    launchTrack("prelaunch_before_after_interaction", { section: galleryKey, pair_index: tile.index });
  };

  return (
    <section data-launch-gallery={galleryKey} aria-labelledby={titleId}
      className="relative scroll-mt-6 py-10 sm:py-14 lg:py-[clamp(56px,5vw,96px)]">
      <div className="max-w-3xl">
        {eyebrow && (
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent sm:text-[12px]">{eyebrow}</p>
        )}
        <h2 id={titleId}
          className="mt-2 font-display text-[1.6rem] font-semibold leading-[1.1] tracking-[-0.025em] text-ink sm:text-[2.1rem] lg:text-[clamp(2.1rem,2.6vw,2.9rem)]">
          {title}
        </h2>
      </div>

      <div className="mt-6 sm:mt-8">
        <Rail label={title || eyebrow} role={t("prelaunchUi.gallery.carousel")}
          prevLabel={t("prelaunchUi.gallery.prev")} nextLabel={t("prelaunchUi.gallery.next")}
          landmark={false} arrowTop="calc(50% - 1.1rem)"
          className="[--rail-cols:1.3] [--rail-gap:10px] sm:[--rail-cols:2.4] sm:[--rail-gap:12px] lg:[--rail-cols:4] lg:[--rail-gap:16px]">
          {tiles.map((tile) => (
            <figure key={tile.id} className="min-w-0" data-launch-tile={tile.index}>
              <div
                className="overflow-hidden rounded-2xl ring-1 ring-inset ring-[rgb(var(--glass-border)/0.16)]"
                onPointerDownCapture={(e) => {
                  const target = e.target as Element;
                  const grip = target.closest("[data-before-after-grip]");
                  if ((e.pointerType === "mouse" && e.button === 0) || grip) first(tile);
                }}
                onKeyDownCapture={(e) => { if (SLIDER_KEYS.has(e.key)) first(tile); }}>
                <BeforeAfter pair={EMPTY_PAIR} ratio={RATIO} sizes={SIZES}
                  before={tile.before} after={tile.after}
                  labels={{
                    before: labels.before, after: labels.after,
                    slider: t("prelaunchUi.gallery.slider", { name: tile.caption || title }),
                    emptyBefore: "", emptyAfter: "", hint: "",
                  }} />
              </div>
              {tile.caption && (
                <figcaption className="mt-2 px-0.5 text-[13px] leading-snug text-muted">{tile.caption}</figcaption>
              )}
            </figure>
          ))}
        </Rail>
      </div>

      <a href="#zapis" data-launch-gallery-cta={galleryKey}
        onClick={(e) => {
          e.preventDefault();
          launchTrack("prelaunch_cta_clicked", { cta_id: "gallery_cta", section: galleryKey });
          goToForm("zapis");
        }}
        className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl border border-[rgb(var(--accent)/0.4)] bg-[rgb(var(--accent)/0.12)] px-4 py-2.5 text-[14px] font-semibold text-ink transition-colors hover:border-[rgb(var(--accent)/0.7)] hover:bg-[rgb(var(--accent)/0.2)] sm:mt-8">
        {cta}
        <ArrowDown size={15} aria-hidden className="text-accent" />
      </a>
    </section>
  );
}

/**
 * WHERE A GALLERY WILL BE — for an admin, and only on the real page.
 *
 * A visitor never sees an empty or switched-off gallery; the section is simply
 * not there. An admin does, as a dashed frame saying why and where to fill it,
 * because a section that is absent cannot be clicked in the visual editor. Not
 * inside a frame (the builder's device preview and the editor's own preview
 * must show the VISITOR's page) and not with ?preview — decided after mount,
 * since only the browser knows whether it is framed, so the server render and
 * the first client render are both empty and hydrate identically.
 */
export function GalleryPlaceholder({ galleryKey, eyebrow, title, reason }: {
  galleryKey: GalleryKey;
  eyebrow: string;
  title: string;
  reason: "missing" | "empty" | "hidden";
}) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  useEffect(() => { setShow(!launchAnalyticsMuted()); }, []);
  if (!show) return null;
  return (
    <section data-launch-gallery={galleryKey} data-launch-gallery-empty={reason}
      aria-label={eyebrow || title}
      className="my-8 rounded-3xl border-2 border-dashed border-[rgb(var(--accent)/0.4)] bg-[rgb(var(--accent)/0.05)] px-5 py-8 text-center sm:px-8">
      <ImageOff size={22} aria-hidden className="mx-auto text-accent" />
      {eyebrow && <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">{eyebrow}</p>}
      {title && <p className="mt-1 font-display text-[1.15rem] font-semibold text-ink">{title}</p>}
      <p className="mt-2 text-[13.5px] text-muted">
        {t(reason === "hidden" ? "prelaunchUi.gallery.hidden" : "prelaunchUi.gallery.empty")}
      </p>
      <p className="mt-1 text-[12.5px] font-semibold text-ink">{t("prelaunchUi.gallery.hint")}</p>
      <p className="mt-3 text-[11px] uppercase tracking-[0.12em] text-muted">{t("prelaunchUi.gallery.adminOnly")}</p>
    </section>
  );
}
