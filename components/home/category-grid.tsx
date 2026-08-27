import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CATEGORIES } from "@/lib/categories";
import { Media } from "@/components/mobile/media";
import { cn } from "@/lib/utils";

/**
 * CATEGORY GRID — the homepage's main navigation surface: six tiles, each
 * leading to a real category workspace.
 *
 * Every tile is the SAME four parts in the same order — picture, title,
 * one-line-or-two description, footer — so a row of tiles lines up on every
 * width. The picture frame claims its aspect ratio before the thumbnail
 * arrives, the description is clamped with a reserved height, and the footer
 * is pushed down with `mt-auto`; between them those three rules remove the
 * ragged heights the phone screenshots showed.
 *
 * Every tile carries its own accent — violet, magenta, coral, indigo, cyan,
 * warm violet — applied to the icon chip, the wash and the hover border. One
 * hue per tile from a single family: the grid reads as six rooms in one
 * building, not six unrelated apps.
 */
export function CategoryGrid({ t, previews, hoverStrip }: {
  t: (key: string) => string;
  /** One signed thumbnail per tile, from the account's own library. */
  previews?: (string | null)[];
  /** Two or three extra thumbnails revealed on desktop hover. */
  hoverStrip?: string[];
}) {
  return (
    <div id="kategorie" className="stagger grid grid-cols-2 gap-2.5 [&>*]:min-w-0 sm:gap-3 md:grid-cols-3 xl:grid-cols-6 xl:gap-3.5">
      {CATEGORIES.map((c, i) => {
        const Icon = c.icon;
        const { rgb, rgb2 } = c.accent;
        return (
          <Link
            key={c.key}
            href={`/k/${c.slug}`}
            style={{ ["--cat" as string]: rgb } as React.CSSProperties}
            className={cn(
              "group panel relative flex h-full flex-col overflow-hidden rounded-2xl p-2.5 sm:p-3",
              // Even a "soon" category links: its page is what explains the
              // status. It is dimmed, never disabled.
              c.soon ? "opacity-75" : "panel-interactive hover:border-[rgb(var(--cat)/0.55)]",
            )}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-20 opacity-70 transition-opacity duration-300 group-hover:opacity-100"
              style={{ background: `radial-gradient(12rem 5rem at 22% -10%, rgb(${rgb} / 0.28), transparent 72%)` }}
            />

            {/* PICTURE — always rendered, with or without a thumbnail, so the
                tiles keep one anatomy. The icon chip rides on the frame
                instead of taking a row of its own: on a 164px phone column
                that is the difference between a tile and a tower. */}
            <span className="relative block">
              <Media
                src={previews?.[i] ?? null}
                ratio="16/10"
                rounded="rounded-xl"
                className="w-full ring-1 ring-[rgb(var(--hairline)/var(--hairline-alpha))]"
              />
              <span
                aria-hidden
                className={cn(
                  "absolute bottom-1.5 left-1.5 flex h-8 w-8 items-center justify-center rounded-lg backdrop-blur-md transition-transform duration-300 group-hover:scale-110 sm:h-9 sm:w-9",
                  c.soon ? "bg-[rgb(var(--surface)/0.85)] text-faint" : "text-[rgb(var(--cat))]",
                )}
                style={c.soon ? undefined : {
                  background: `linear-gradient(145deg, rgb(${rgb} / 0.42), rgb(${rgb2} / 0.24))`,
                  boxShadow: `0 8px 20px -14px rgb(${rgb} / 0.95)`,
                }}
              >
                <Icon size={17} strokeWidth={1.9} />
              </span>
              {c.soon && (
                <span className="absolute right-1.5 top-1.5 rounded-full bg-[rgb(var(--surface)/0.9)] px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide text-faint backdrop-blur-md">
                  {t("common.soon")}
                </span>
              )}
            </span>

            <span className="relative mt-2 block truncate text-[13px] font-semibold tracking-tight sm:text-sm">
              {t(`cats.${c.key}`)}
            </span>
            {/* Two clamped lines with the height reserved for both: a
                one-line description no longer shortens its tile. */}
            <span className="relative mt-0.5 line-clamp-2 min-h-[2.1rem] text-[11px] leading-snug text-muted sm:text-[11.5px]">
              {t(`cats.${c.key}Sub`)}
            </span>

            {/* HOVER STRIP — a glimpse of what this category produces,
                revealed only on pointer devices where there is room. It
                reserves its space at rest, so hovering never resizes a row. */}
            {!c.soon && hoverStrip && hoverStrip.length > 0 && (
              <span aria-hidden className="relative mt-2 hidden gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 xl:flex">
                {hoverStrip.slice(0, 3).map((url, k) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={k} src={url} alt="" loading="lazy"
                    className="h-9 w-9 rounded-md object-cover ring-1 ring-[rgb(var(--hairline)/var(--hairline-alpha))]" />
                ))}
              </span>
            )}

            {/* FOOTER — pinned to the bottom of every tile, so the arrows sit
                on one line across the row. */}
            <span className="relative mt-auto flex items-center justify-end pt-2">
              <ArrowRight
                size={13}
                aria-hidden
                className={cn(
                  "transition-all duration-200",
                  c.soon
                    ? "text-faint opacity-40"
                    : "text-[rgb(var(--cat))] opacity-60 group-hover:translate-x-0.5 group-hover:opacity-100",
                )}
              />
            </span>
          </Link>
        );
      })}
    </div>
  );
}
