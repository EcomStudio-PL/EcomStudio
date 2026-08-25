import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { Category } from "@/lib/categories";
import { cn } from "@/lib/utils";

/**
 * CATEGORY HEADER — the wash that gives each workspace its own identity.
 *
 * The colour comes from the category's accent (violet for Moda, magenta for
 * E-commerce, coral for Social…), applied to the wash, the icon tile and the
 * overline only. The primary CTA stays brand magenta everywhere, so the
 * accent reads as "which room am I in", not as six competing brands.
 */
export function CategoryHeader({ category, title, lead, backLabel, backHref = "/home", children, compact }: {
  category: Category;
  title: string;
  lead: string;
  backLabel: string;
  backHref?: string;
  /** Actions rendered on the right at desktop widths. */
  children?: React.ReactNode;
  compact?: boolean;
}) {
  const Icon = category.icon;
  const { rgb, rgb2 } = category.accent;
  return (
    <header
      className="panel relative mb-5 overflow-hidden rounded-2xl"
      style={{ ["--cat" as string]: rgb, ["--cat2" as string]: rgb2 }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            `radial-gradient(38rem 20rem at 8% -30%, rgb(${rgb} / 0.28), transparent 68%),` +
            `radial-gradient(26rem 16rem at 92% 120%, rgb(${rgb2} / 0.16), transparent 70%)`,
        }}
      />
      <div className={cn("relative flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-end lg:justify-between", compact ? "lg:p-6" : "lg:p-8")}>
        <div className="min-w-0">
          <Link href={backHref}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[rgb(var(--cat))] transition-opacity duration-200 hover:opacity-75">
            <ArrowLeft size={12} aria-hidden />
            {backLabel}
          </Link>
          <div className="mt-3 flex items-center gap-3.5">
            <span
              aria-hidden
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-[rgb(var(--cat))] shadow-[0_14px_30px_-18px_rgb(var(--cat)/0.9)] sm:h-14 sm:w-14"
              style={{ background: `linear-gradient(145deg, rgb(${rgb} / 0.30), rgb(${rgb2} / 0.12))` }}
            >
              <Icon size={24} strokeWidth={1.8} />
            </span>
            <div className="min-w-0">
              <h1 className={cn(
                "font-display font-semibold leading-[1.05] tracking-[-0.03em]",
                compact ? "text-[clamp(1.35rem,1rem+0.9vw,2rem)]" : "text-[clamp(1.6rem,1rem+1.4vw,2.6rem)]",
              )}>
                {title}
              </h1>
              <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-muted">{lead}</p>
            </div>
          </div>
        </div>
        {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
      </div>
    </header>
  );
}
