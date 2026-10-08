import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { statusBadge, type ItemState, type ItemStatus } from "@/lib/seller-home-model";

type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * The small pieces every /home section is made of.
 *
 * ONE RULE FOR EVERY TILE, BUTTON AND CAPTION THAT NAMES A TOOL: it opens the
 * tool's own route only while that tool is live for this viewer. Otherwise it
 * is drawn — quieter, with a badge saying why — and is not a link: no dead
 * link, no door into a "Wkrótce" screen, no request.
 */

/** The badge on an item that does not open. */
export function StatusBadge({ status, t, className }: { status: ItemStatus; t: T; className?: string }) {
  const kind = statusBadge(status);
  if (!kind) return null;
  return (
    <span data-status-badge={kind} className={cn(
      "inline-flex h-5 shrink-0 items-center rounded-full bg-[rgb(var(--bg)/0.78)] px-2 text-[9.5px] font-bold uppercase tracking-[0.08em] text-muted ring-1 ring-[rgb(var(--glass-border)/0.2)] backdrop-blur-sm",
      className,
    )}>
      {t(`sellerHome.status.${kind}`)}
    </span>
  );
}

/** A link to the tool while it is live; an inert element otherwise. */
export function ToolLink({ state, className, ariaLabel, tabIndex, children, ...rest }: {
  state: ItemState | null | undefined;
  className?: string;
  ariaLabel?: string;
  /** -1 for a drawing-only copy of a card (the looping carousel's). */
  tabIndex?: number;
  children: React.ReactNode;
} & Record<`data-${string}`, string | number | boolean | undefined>) {
  if (state?.status === "live") {
    return <Link href={state.href} aria-label={ariaLabel} tabIndex={tabIndex} className={className} {...rest}>{children}</Link>;
  }
  return (
    <span aria-disabled="true" className={cn(className, "cursor-default")} {...rest}>
      {children}
    </span>
  );
}

/** A section heading: small caps title, one muted line, an action right. */
export function SectionHead({ id, title, sub, action, className }: {
  id?: string;
  title: string;
  sub?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-2.5 flex items-end justify-between gap-3 sm:mb-3", className)}>
      <div className="min-w-0">
        <h2 id={id} className="truncate font-display text-[13px] font-bold uppercase tracking-[0.07em] text-ink sm:text-[14px]">
          {title}
        </h2>
        {sub && <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted sm:text-[12.5px]">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

/** The quiet "Wypróbuj →" on the right of a heading — only for a live tool. */
export function TryLink({ state, label }: { state: ItemState | null | undefined; label: string }) {
  if (state?.status !== "live") return null;
  return (
    <Link href={state.href} data-try={state.key}
      className="cta inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-semibold [--accent:var(--accent-strong)]">
      {label}
      <ArrowRight size={13} aria-hidden />
    </Link>
  );
}

/** A centred primary button over a faded gallery bottom — live tools only. */
export function GalleryCta({ state, label }: { state: ItemState | null | undefined; label: string }) {
  if (state?.status !== "live") return null;
  return (
    <Link href={state.href} data-gallery-cta={state.key}
      className="cta inline-flex h-10 items-center gap-2 rounded-full px-6 text-[13.5px] font-semibold shadow-[0_12px_30px_-12px_rgb(var(--accent)/0.85)] [--accent:var(--accent-strong)]">
      {label}
      <ArrowRight size={15} aria-hidden />
    </Link>
  );
}
