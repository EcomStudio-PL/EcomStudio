import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CATEGORIES } from "@/lib/categories";
import { cn } from "@/lib/utils";

/**
 * CATEGORY GRID — the homepage's main navigation surface: six tiles, each
 * leading to a real category workspace.
 *
 * Every tile carries its own accent — violet, magenta, coral, indigo, cyan,
 * warm violet — applied to the icon tile, the wash and the hover border. One
 * hue per tile from a single family: the grid reads as six rooms in one
 * building, not six unrelated apps.
 */
export function CategoryGrid({ t, previews }: {
  t: (key: string) => string;
  /** One signed thumbnail per tile, from the account's own library. */
  previews?: (string | null)[];
}) {
  return (
    <div id="kategorie" className="stagger grid grid-cols-2 gap-3 [&>*]:min-w-0 md:grid-cols-3 xl:grid-cols-6 xl:gap-3.5">
      {CATEGORIES.map((c, i) => {
        const Icon = c.icon;
        const { rgb, rgb2 } = c.accent;
        const preview = previews?.[i] ?? null;
        const body = (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-24 opacity-70 transition-opacity duration-300 group-hover:opacity-100"
              style={{ background: `radial-gradient(12rem 6rem at 22% -10%, rgb(${rgb} / 0.30), transparent 72%)` }}
            />
            {preview && (
              <span aria-hidden className="relative mb-3 block overflow-hidden rounded-xl ring-1 ring-[rgb(var(--hairline)/var(--hairline-alpha))]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="" loading="lazy"
                  className="h-16 w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]" />
              </span>
            )}
            <span
              aria-hidden
              className={cn(
                "relative flex h-11 w-11 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110",
                c.soon ? "bg-raised text-faint" : "text-[rgb(var(--cat))]",
              )}
              style={c.soon ? undefined : {
                background: `linear-gradient(145deg, rgb(${rgb} / 0.28), rgb(${rgb2} / 0.10))`,
                boxShadow: `0 10px 24px -16px rgb(${rgb} / 0.95)`,
              }}
            >
              <Icon size={20} strokeWidth={1.9} />
            </span>
            <span className="relative mt-3 flex items-center gap-1.5 text-sm font-semibold tracking-tight">
              {t(`cats.${c.key}`)}
              {c.soon && (
                <span className="rounded-full bg-raised px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-faint">
                  {t("common.soon")}
                </span>
              )}
            </span>
            <span className="relative mt-1 line-clamp-2 text-[11.5px] leading-snug text-muted">
              {t(`cats.${c.key}Sub`)}
            </span>
            {!c.soon && (
              <ArrowRight
                size={13}
                aria-hidden
                className="relative mt-2.5 text-[rgb(var(--cat))] opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100"
              />
            )}
          </>
        );
        const cls = cn(
          "group panel relative flex flex-col overflow-hidden rounded-2xl p-4",
          c.soon ? "opacity-70" : "panel-interactive hover:border-[rgb(var(--cat)/0.55)]",
        );
        const style = { ["--cat" as string]: rgb } as React.CSSProperties;
        // Even a "soon" category links: its page is what explains the status.
        return <Link key={c.key} href={`/k/${c.slug}`} className={cls} style={style}>{body}</Link>;
      })}
    </div>
  );
}
