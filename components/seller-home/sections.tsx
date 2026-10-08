import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BEFORE_AFTER, BEFORE_AFTER_SIZE, BANNER_FRAME, FEATURED, SECTION_COPY, SESSIONS, SHOWCASE, THUMBNAILS, TOOL_TILE,
  industryKey, ratioOf,
  type GalleryTileDef, type PromoBannerDef,
} from "@/lib/seller-home-config";
import type { ItemStates } from "@/lib/seller-home-model";
import type { SellerHomeData } from "@/lib/server/seller-home";
import { BeforeAfter } from "./before-after";
import { MediaSlot } from "./media-slot";
import { Rail } from "./rail";
import { GalleryCta, SectionHead, StatusBadge, ToolLink, TryLink } from "./parts";

type T = (key: string, vars?: Record<string, string | number>) => string;

const size = (t: T, w: number, h: number) => t("sellerHome.slot.size", { w, h });

/* ── 3. before / after ────────────────────────────────────────────────────*/

/**
 * One row of large before/after cards — a rail everywhere, showing as many
 * whole cards as the width allows (all six on a wide screen). The slider is
 * the picture; the CAPTION under it is the link to the tool, so dragging the
 * divider can never navigate. A tool that does not run keeps its card, and
 * its caption is plain text with a badge.
 */
export function BeforeAfterRow({ items, t }: { items: ItemStates; t: T }) {
  const cards = BEFORE_AFTER.filter((b) => items[b.item]);
  if (cards.length === 0) return null;
  const hint = size(t, BEFORE_AFTER_SIZE.width, BEFORE_AFTER_SIZE.height);
  return (
    <section className="relative" aria-labelledby="seller-ba-title" data-seller-before-after>
      <SectionHead id="seller-ba-title" title={t(SECTION_COPY.beforeAfter.titleKey)} sub={t(SECTION_COPY.beforeAfter.subKey)} />
      <Rail label={t(SECTION_COPY.beforeAfter.titleKey)} prevLabel={t("sellerHome.carousel.prev")} nextLabel={t("sellerHome.carousel.next")}
        role={t("sellerHome.carousel.role")} landmark={false} arrowTop="calc(50% - 1.4rem)"
        className="[--rail-cols:1.3] [--rail-gap:10px] sm:[--rail-cols:2.4] sm:[--rail-gap:12px] lg:[--rail-cols:4] lg:[--rail-gap:14px] xl:[--rail-cols:5] 2xl:[--rail-cols:6]">
        {cards.map((card, i) => {
          const state = items[card.item];
          const name = t(card.nameKey);
          return (
            <article key={card.key} className="min-w-0" data-ba-card={card.key}>
              <div className="overflow-hidden rounded-xl ring-1 ring-inset ring-[rgb(var(--glass-border)/0.14)]">
                <BeforeAfter pair={card.media} ratio={ratioOf(BEFORE_AFTER_SIZE)} tone={i * 2}
                  sizes="(max-width: 639px) 76vw, (max-width: 1023px) 40vw, 20vw"
                  labels={{
                    before: t("sellerHome.before"), after: t("sellerHome.after"),
                    slider: t("sellerHome.ba.slider", { name }),
                    emptyBefore: t("sellerHome.slot.before"), emptyAfter: t("sellerHome.slot.after"), hint,
                  }} />
              </div>
              <ToolLink state={state} data-ba-link={card.item}
                className="group mt-2 flex min-w-0 items-center gap-1.5 px-0.5">
                <span className="min-w-0">
                  <span className={cn("block truncate text-[13px] font-semibold leading-tight text-ink",
                    state.status === "live" && "group-hover:text-accent-strong dark:group-hover:text-accent")}>{name}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-muted">{t(industryKey(card.industry))}</span>
                </span>
                <StatusBadge status={state.status} t={t} className="ml-auto" />
              </ToolLink>
            </article>
          );
        })}
      </Rail>
    </section>
  );
}

/* ── 4 / 6 / 10. the banners ──────────────────────────────────────────────*/

/** The empty banner's own art — the old GrovBase banner: the page's surface
 *  lit by soft brand light (a different fall of light per banner). */
const BANNER_TONES: readonly string[] = [
  "radial-gradient(40rem 18rem at 50% 118%, rgb(var(--accent) / 0.28), transparent 70%), radial-gradient(30rem 16rem at 8% -10%, rgb(var(--violet) / 0.24), transparent 70%), radial-gradient(30rem 16rem at 92% -10%, rgb(var(--accent-glow) / 0.20), transparent 70%)",
  "radial-gradient(36rem 18rem at 100% 50%, rgb(var(--violet) / 0.26), transparent 70%), radial-gradient(34rem 16rem at 0% 110%, rgb(var(--accent) / 0.24), transparent 70%), radial-gradient(26rem 14rem at 40% -20%, rgb(var(--accent-glow) / 0.16), transparent 70%)",
  "radial-gradient(36rem 18rem at 0% 40%, rgb(var(--accent-glow) / 0.22), transparent 70%), radial-gradient(34rem 18rem at 100% 100%, rgb(var(--violet) / 0.26), transparent 70%), radial-gradient(28rem 14rem at 60% -20%, rgb(var(--accent) / 0.18), transparent 70%)",
];

/**
 * PROMO BANNER — one reusable wide banner: a picture or a clip behind, and an
 * optional badge, short title, one-line subtitle and one button, centred.
 * Desktop about 4.7 : 1, a tablet 5 : 2, a phone square (its own file when
 * `mobileSrc` is set — a phone crop is a different picture, not a squeeze).
 * The button is drawn only while its tool runs.
 *
 * With media the copy is white over a scrim; with none yet the banner is the
 * old GrovBase banner — the surface lit by brand light, a gradient title —
 * finished, quiet, and never louder than a real picture would be.
 */
export function PromoBanner({ def, items, t }: { def: PromoBannerDef; items: ItemStates; t: T }) {
  const state = def.item ? items[def.item] : null;
  // A banner about a tool this viewer may not see (switched off, off /tools)
  // is not drawn at all — it would advertise something that is not there.
  if (def.item && !state) return null;
  const live = state?.status === "live";
  const hasMedia = Boolean(def.media.src);
  const title = def.titleKey ? t(def.titleKey) : null;
  return (
    <section className="relative" aria-label={title ?? t("sellerHome.promo.label")} data-promo={def.key}>
      <div className={cn(
        "relative isolate aspect-[var(--ar-phone)] overflow-hidden rounded-2xl sm:aspect-[var(--ar-tablet)] lg:aspect-[var(--ar-wide)]",
        !hasMedia && "border border-[rgb(var(--accent)/0.26)] bg-surface",
      )} style={{
        "--ar-phone": ratioOf(BANNER_FRAME.phone), "--ar-tablet": ratioOf(BANNER_FRAME.tablet), "--ar-wide": ratioOf(BANNER_FRAME.wide),
      } as CSSProperties}>
        {hasMedia ? (
          <>
            <MediaSlot media={def.media} fill sizes="100vw" label={title ?? t("sellerHome.promo.label")} hint="" />
            {/* Legibility: darker at the edges and behind the centred copy. */}
            <span aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_90%_at_50%_50%,rgb(0_0_0/0.42),rgb(0_0_0/0.18)_70%,rgb(0_0_0/0.35))]" />
          </>
        ) : (
          <span aria-hidden className="absolute inset-0" style={{ background: BANNER_TONES[def.tone % BANNER_TONES.length] }} data-media-slot="empty" data-config-key={def.media.configKey}>
            <span className="absolute inset-0 opacity-[0.5] [background-image:linear-gradient(rgb(var(--accent)/0.07)_1px,transparent_1px),linear-gradient(90deg,rgb(var(--accent)/0.07)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(60%_80%_at_50%_50%,black,transparent)]" />
            <span className="absolute bottom-2.5 right-3 text-[10px] tabular-nums text-faint">
              {t("sellerHome.slot.banner")} · <span className="sm:hidden">{size(t, BANNER_FRAME.phone.width, BANNER_FRAME.phone.height)}</span>
              <span className="max-sm:hidden">{size(t, BANNER_FRAME.wide.width, BANNER_FRAME.wide.height)}</span>
            </span>
          </span>
        )}
        {/* The copy lets pointers through to the clip; only its button takes them. */}
        <div className={cn(
          "pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center sm:gap-2.5",
          hasMedia ? "text-white" : "text-ink",
        )}>
          {def.badgeKey && (
            <span className={cn(
              "rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] backdrop-blur-sm",
              hasMedia
                ? "bg-white/15 ring-1 ring-white/30"
                : "bg-[rgb(var(--accent)/0.10)] text-accent-strong ring-1 ring-[rgb(var(--accent)/0.30)] dark:text-accent",
            )}>
              {t(def.badgeKey)}
            </span>
          )}
          {title && (
            <h2 className={cn(
              "max-w-[22ch] text-balance font-display text-[24px] font-bold uppercase leading-[1.02] tracking-[-0.01em] sm:text-[30px] lg:text-[36px]",
              hasMedia
                ? "drop-shadow-[0_2px_12px_rgb(0_0_0/0.25)]"
                : "bg-[linear-gradient(100deg,rgb(var(--accent-glow)),rgb(var(--accent))_48%,rgb(var(--violet)))] bg-clip-text text-transparent",
            )}>
              {title}
            </h2>
          )}
          {def.subKey && (
            <p className={cn("max-w-[46ch] text-[13px] sm:truncate sm:text-[14px]", hasMedia ? "text-white/85" : "font-medium text-muted")}>
              {t(def.subKey)}
            </p>
          )}
          {/* Not running: no button — the badge says why. */}
          {state && !live && <StatusBadge status={state.status} t={t} className="mt-1" />}
          {def.ctaKey && live && state && (
            <Link href={state.href} data-promo-cta={def.key}
              className={cn(
                "pointer-events-auto mt-1 inline-flex h-10 items-center gap-2 rounded-full px-5 text-[13.5px] font-semibold transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
                hasMedia
                  ? "bg-white text-[rgb(32_22_45)] shadow-[0_10px_26px_-12px_rgb(0_0_0/0.6)]"
                  : "cta",
              )}>
              {t(def.ctaKey)}
              <ArrowRight size={15} aria-hidden />
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

/* ── the fading masonry gallery (Showcase, Sesje) ─────────────────────────*/

/**
 * A masonry of slots that FADES into whatever is behind it: the window shows
 * a fixed share of the gallery (its own aspect-ratio per breakpoint, so the
 * height never depends on what loaded), the last row melts away under a
 * mask, and one button can sit centred on that fade. CSS columns keep every
 * tile in its own shape — nothing is stretched or cropped to fit a grid.
 */
function FadeGallery({ tiles, label, cols, window: frame, cta, sizes, toneOffset = 0, t }: {
  tiles: readonly GalleryTileDef[];
  /** Name of a tile in the empty state ("Miniaturka", "Sesja"). */
  label: string;
  /** column-count per breakpoint. */
  cols: string;
  /** aspect-ratio of the visible window per breakpoint. */
  window: string;
  cta?: React.ReactNode;
  sizes: string;
  toneOffset?: number;
  t: T;
}) {
  return (
    <div className="relative">
      <div className={cn("relative overflow-hidden [mask-image:linear-gradient(to_bottom,black_72%,transparent_99%)]", frame)} data-fade-gallery>
        <div className={cn("absolute inset-x-0 top-0 gap-2 sm:gap-2.5", cols)}>
          {tiles.map((tile, i) => (
            <div key={tile.media.configKey} className="mb-2 break-inside-avoid overflow-hidden rounded-xl sm:mb-2.5">
              <MediaSlot media={tile.media} tone={i + toneOffset} sizes={sizes}
                label={`${label} ${String(i + 1).padStart(2, "0")}`} hint={size(t, tile.media.width, tile.media.height)} />
            </div>
          ))}
        </div>
      </div>
      {cta && <div className="absolute inset-x-0 bottom-[5%] flex justify-center">{cta}</div>}
    </div>
  );
}

/* ── 5. the showcase ──────────────────────────────────────────────────────*/

/**
 * A wide premium panel: the tool shown big on the left (a clip, ideally),
 * twelve of its results on the right fading into the panel, one button. No
 * heading, no paragraph — the pictures make the case.
 */
export function Showcase({ items, t }: { items: ItemStates; t: T }) {
  const state = items[SHOWCASE.item];
  if (!state) return null;
  const visual = SHOWCASE.visual;
  return (
    <section className="relative overflow-hidden rounded-3xl border border-[rgb(var(--glass-border)/0.16)] bg-[rgb(var(--surface)/0.62)] p-2 shadow-[0_24px_60px_-40px_rgb(var(--accent)/0.6)] sm:p-2.5"
      aria-label={t("sellerHome.showcase.label")} data-seller-showcase>
      <div className="grid gap-2 sm:gap-2.5 lg:grid-cols-[2fr_3fr]">
        <div className="relative aspect-[var(--ar-phone)] overflow-hidden rounded-2xl sm:aspect-[var(--ar-tablet)] lg:aspect-auto"
          style={{ "--ar-phone": ratioOf(SHOWCASE.frame.phone), "--ar-tablet": ratioOf(SHOWCASE.frame.tablet) } as CSSProperties}>
          <MediaSlot media={visual} fill tone={2} sizes="(max-width: 1023px) 100vw, 40vw"
            label={t("sellerHome.slot.showcase")} hint={size(t, visual.width, visual.height)} />
          <StatusBadge status={state.status} t={t} className="absolute left-3 top-3" />
        </div>
        <FadeGallery tiles={SHOWCASE.gallery.map((media) => ({ media }))} label={t("sellerHome.slot.result")}
          cols="columns-2 sm:columns-3" window="aspect-[2/2.4] sm:aspect-[3/2.7]"
          sizes="(max-width: 639px) 46vw, (max-width: 1023px) 31vw, 19vw" toneOffset={3} t={t}
          cta={<GalleryCta state={state} label={t(SHOWCASE.ctaKey)} />} />
      </div>
    </section>
  );
}

/* ── 7. Miniaturki ────────────────────────────────────────────────────────*/

/**
 * Miniaturki's own gallery: an even grid of SQUARE thumbnails, as a
 * marketplace shows them — 5 columns on a desktop, 3 on a tablet, 2 on a
 * phone; every tile 1:1, every gap the same. The window is exactly whole rows
 * tall (4 on a desktop — all twenty — 3 below), worked out from its own width
 * (container units), so it never depends on what loaded; the rows past it
 * stay in the page, under the fade. The last row melts into whatever is
 * behind the section — a mask, so it is the real page background in either
 * theme — and the button sits on that fade.
 */
function SquareGallery({ tiles, label, cta, t }: {
  tiles: readonly GalleryTileDef[];
  label: string;
  cta: React.ReactNode;
  t: T;
}) {
  return (
    <div className="relative [container-type:inline-size]">
      <div data-square-gallery
        className={cn(
          "relative overflow-hidden [--sq-cols:2] [--sq-gap:8px] [--sq-rows:3] sm:[--sq-cols:3] sm:[--sq-gap:10px] lg:[--sq-cols:5] lg:[--sq-rows:4]",
          "h-[calc(var(--sq-rows)_*_((100cqw_-_(var(--sq-cols)_-_1)_*_var(--sq-gap))_/_var(--sq-cols))_+_(var(--sq-rows)_-_1)_*_var(--sq-gap))]",
          "[mask-image:linear-gradient(to_bottom,black_58%,rgb(0_0_0/0.78)_70%,rgb(0_0_0/0.4)_84%,transparent_99%)]",
          "lg:[mask-image:linear-gradient(to_bottom,black_70%,rgb(0_0_0/0.78)_79%,rgb(0_0_0/0.4)_89%,transparent_99%)]",
        )}>
        <div className="grid grid-cols-[repeat(var(--sq-cols),minmax(0,1fr))] gap-[var(--sq-gap)]">
          {tiles.map((tile, i) => (
            <div key={tile.media.configKey} className="overflow-hidden rounded-xl" data-square-tile>
              <MediaSlot media={tile.media} ratio="1/1" tone={i}
                sizes="(max-width: 639px) 46vw, (max-width: 1023px) 31vw, 19vw"
                label={`${label} ${String(i + 1).padStart(2, "0")}`} hint={size(t, tile.media.width, tile.media.height)} />
            </div>
          ))}
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-[5%] z-[1] flex justify-center">{cta}</div>
    </div>
  );
}

export function ThumbnailsSection({ items, t }: { items: ItemStates; t: T }) {
  const state = items[THUMBNAILS.item];
  // The section is the thumbnail tool's: gone when the viewer may not see it.
  if (!state) return null;
  return (
    <section className="relative" aria-labelledby="seller-thumbs-title" data-seller-thumbnails>
      <SectionHead id="seller-thumbs-title" title={t(THUMBNAILS.titleKey)} sub={t(THUMBNAILS.subKey)}
        action={<TryLink state={state} label={t(THUMBNAILS.tryKey)} />} />
      <SquareGallery tiles={THUMBNAILS.tiles} label={t("sellerHome.slot.thumbnail")} t={t}
        cta={<GalleryCta state={state} label={t(THUMBNAILS.ctaKey)} />} />
    </section>
  );
}

/* ── 8. Sesje produktowe ──────────────────────────────────────────────────*/

export function SessionsSection({ items, t }: { items: ItemStates; t: T }) {
  const studio = items[SESSIONS.studio.item];
  const outdoor = items[SESSIONS.outdoor.item];
  // Both tools out of this viewer's reach: the section has nothing to open.
  if (!studio && !outdoor) return null;
  const button = (state: typeof studio, labelKey: string, primary: boolean) => {
    // A tool this viewer may not see is not drawn, not even greyed out.
    if (!state) return null;
    const label = t(labelKey);
    if (state?.status === "live") {
      return (
        <Link href={state.href} data-session-cta={state.key}
          className={cn(
            "inline-flex h-9 items-center justify-center rounded-full px-4 text-[13px] font-semibold transition-colors",
            primary
              ? "cta [--accent:var(--accent-strong)]"
              : "border border-[rgb(var(--accent)/0.55)] text-accent-strong hover:bg-[rgb(var(--accent)/0.08)] dark:text-accent",
          )}>
          {label}
        </Link>
      );
    }
    // Not running: drawn, with its badge, and not a link.
    return (
      <span aria-disabled="true" className="inline-flex h-9 cursor-default items-center gap-1.5 rounded-full border border-line px-4 text-[13px] font-semibold text-faint">
        {label}
        <StatusBadge status={state.status} t={t} />
      </span>
    );
  };
  return (
    <section className="relative overflow-hidden rounded-3xl border border-[rgb(var(--glass-border)/0.16)] bg-raised p-3 sm:p-4 lg:p-5"
      aria-labelledby="seller-sessions-title" data-seller-sessions>
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_100%_0%,rgb(var(--accent)/0.10),transparent_70%),radial-gradient(50%_40%_at_0%_100%,rgb(var(--violet)/0.10),transparent_70%)]" />
      <div className="relative mb-3 flex flex-col gap-3 sm:mb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 id="seller-sessions-title" className="font-display text-[13px] font-bold uppercase tracking-[0.07em] text-ink sm:text-[14px]">
            {t(SESSIONS.titleKey)}
          </h2>
          <p className="mt-0.5 text-[12px] text-muted sm:text-[12.5px]">{t(SESSIONS.subKey)}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {button(studio, SESSIONS.studio.labelKey, true)}
          {button(outdoor, SESSIONS.outdoor.labelKey, false)}
        </div>
      </div>
      <div className="relative">
        <FadeGallery tiles={SESSIONS.tiles} label={t("sellerHome.slot.session")}
          cols="columns-2 sm:columns-3 lg:columns-4" window="aspect-[2/2.9] sm:aspect-[3/3] lg:aspect-[4/2.75]"
          sizes="(max-width: 639px) 46vw, (max-width: 1023px) 31vw, 24vw" toneOffset={1} t={t} />
      </div>
    </section>
  );
}

/* ── 9. three featured tools ──────────────────────────────────────────────*/

export function FeaturedTools({ data, t }: { data: SellerHomeData; t: T }) {
  const cards = FEATURED.filter((f) => data.items[f.item]);
  if (cards.length === 0) return null;
  const hint = size(t, TOOL_TILE.width, TOOL_TILE.height);
  return (
    <section className="relative" aria-labelledby="seller-featured-title" data-seller-featured>
      <SectionHead id="seller-featured-title" title={t(SECTION_COPY.featured.titleKey)} sub={t(SECTION_COPY.featured.subKey)} />
      <Rail label={t(SECTION_COPY.featured.titleKey)} prevLabel={t("sellerHome.carousel.prev")} nextLabel={t("sellerHome.carousel.next")}
        role={t("sellerHome.carousel.role")} landmark={false} arrowTop="calc(50% - 1.5rem)"
        className="[--rail-cols:1.15] [--rail-gap:10px] sm:[--rail-cols:2.2] sm:[--rail-gap:12px] lg:[--rail-cols:3] lg:[--rail-gap:14px]">
        {cards.map((card, i) => {
          const state = data.items[card.item];
          const live = state.status === "live";
          const name = t(card.nameKey);
          const slot = data.toolSlots[card.item];
          return (
            // Hover lift, rim and zoom only on a card that opens — an inert
            // card must not look clickable.
            <ToolLink key={card.item} state={state} ariaLabel={name} data-featured={card.item}
              className={cn("group block min-w-0 rounded-2xl outline-offset-2",
                live && "transition-transform duration-300 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0")}>
              <span className={cn("relative block overflow-hidden rounded-2xl ring-1 ring-inset ring-[rgb(var(--glass-border)/0.14)]",
                live && "transition-[box-shadow] duration-300 group-hover:shadow-[0_0_0_1.5px_rgb(var(--accent)/0.55),0_20px_40px_-22px_rgb(var(--accent)/0.7)]")}>
                <MediaSlot media={card.media} ratio={ratioOf(TOOL_TILE)} tone={i + 2}
                  admin={slot ? { slot, slots: data.slots } : null} dim={!live}
                  label={name} hint={hint} sizes="(max-width: 639px) 86vw, (max-width: 1023px) 44vw, 32vw"
                  className={cn(live && "transition-transform duration-700 ease-out group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100")} />
                <StatusBadge status={state.status} t={t} className="absolute left-2.5 top-2.5" />
              </span>
              <span className="mt-2 block truncate px-0.5 text-[14px] font-semibold leading-tight text-ink">{name}</span>
              <span className="mt-0.5 block truncate px-0.5 text-[12.5px] text-muted">{t(card.subKey)}</span>
            </ToolLink>
          );
        })}
      </Rail>
    </section>
  );
}
