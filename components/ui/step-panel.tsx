import { Lightbulb } from "lucide-react";
import { Panel } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

/**
 * STEP PANEL — one stage of a generator workflow. A large numbered chip sits
 * in a left gutter with a fading rail connecting it to the next step, so the
 * whole screen reads as "four simple steps" instead of a wall of forms. On
 * phones the gutter disappears and the number joins the heading, keeping the
 * full width for content.
 */
export function StepPanel({ n, overline, title, sub, action, last, children, className }: {
  n: number;
  /** Tracked label above the title, e.g. "KROK 1 — PRODUKT". */
  overline: string;
  title: string;
  sub?: string;
  action?: React.ReactNode;
  /** Last step: no connecting rail below the chip. */
  last?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("relative flex min-w-0 gap-4", className)}>
      <div className="hidden w-12 shrink-0 flex-col items-center sm:flex" aria-hidden>
        <span className="step-chip">{n}</span>
        {!last && (
          <span className="mt-3 w-px flex-1 bg-gradient-to-b from-[rgb(var(--accent)/0.4)] via-[rgb(var(--accent)/0.14)] to-transparent" />
        )}
      </div>
      <Panel className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
          <div className="min-w-0">
            <p className="overline !text-accent">{overline}</p>
            <h2 className="mt-1.5 flex min-w-0 items-center gap-2.5 font-display text-[17px] font-semibold tracking-tight">
              <span aria-hidden className="step-chip step-chip-sm sm:hidden">{n}</span>
              <span className="min-w-0">{title}</span>
            </h2>
            {sub && <p className="mt-1 text-[13px] leading-relaxed text-muted">{sub}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
        <div className="px-4 pb-5 sm:px-5">{children}</div>
      </Panel>
    </section>
  );
}

/** WSKAZÓWKA — the soft inline tip card used across the generator screens.
 *  One per screen, informative, never a modal. */
export function TipCard({ title, children, className }: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(
      "flex items-start gap-2.5 rounded-xl border border-[rgb(var(--accent)/0.22)]",
      "bg-[linear-gradient(120deg,rgb(var(--accent)/0.10),rgb(var(--indigo)/0.05)_70%,transparent)]",
      "px-3.5 py-3",
      className,
    )}>
      <span aria-hidden className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--accent)/0.16)] text-accent">
        <Lightbulb size={13} />
      </span>
      <div className="min-w-0 text-xs leading-relaxed text-muted">
        {title && <span className="mr-1 font-semibold text-ink">{title}</span>}
        {children}
      </div>
    </div>
  );
}
