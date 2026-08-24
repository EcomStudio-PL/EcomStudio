import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

/**
 * STAT — one number, stated with confidence. An icon chip anchors it, the
 * value uses the display face with tabular figures, and an optional meter
 * turns an abstract count into something with a sense of scale. Sized to sit
 * two-across on a 375px screen without becoming a wall of oversized tiles.
 */
export function Stat({ label, value, hint, icon: Icon, tone, meter, meterClass, href, accent, accent2 }: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  tone?: "default" | "accent" | "accent2" | "success" | "indigo";
  /** 0–1 fill for the progress rail under the value. */
  meter?: number;
  /** Override for the meter fill colour (credit traffic-light states). */
  meterClass?: string;
  href?: string;
  /** Kept from the previous API so existing admin screens read the same. */
  accent?: boolean;
  accent2?: boolean;
}) {
  const resolved = tone ?? (accent ? "accent" : accent2 ? "accent2" : "default");
  const toneText = {
    default: "text-ink",
    accent: "text-accent",
    accent2: "text-accent2",
    success: "text-success",
    indigo: "text-indigo",
  }[resolved];
  // Icon plates are the card's colour identity: a soft tinted gradient with a
  // matching glow, one hue per metric, like a set of collectible chips.
  const toneChip = {
    default: "bg-raised text-muted",
    accent: "bg-[linear-gradient(140deg,rgb(var(--accent)/0.28),rgb(var(--accent)/0.08))] text-accent shadow-[0_6px_16px_-8px_rgb(var(--accent)/0.8)]",
    accent2: "bg-[linear-gradient(140deg,rgb(var(--accent2)/0.30),rgb(var(--accent2)/0.08))] text-accent2 shadow-[0_6px_16px_-8px_rgb(var(--accent2)/0.7)]",
    success: "bg-[linear-gradient(140deg,rgb(var(--success)/0.26),rgb(var(--success)/0.07))] text-success shadow-[0_6px_16px_-8px_rgb(var(--success)/0.6)]",
    indigo: "bg-[linear-gradient(140deg,rgb(var(--indigo)/0.28),rgb(var(--indigo)/0.08))] text-indigo shadow-[0_6px_16px_-8px_rgb(var(--indigo)/0.7)]",
  }[resolved];

  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</p>
        {Icon && (
          <span aria-hidden className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", toneChip)}>
            <Icon size={16} />
          </span>
        )}
      </div>
      <p className={cn("mt-2 truncate metric text-[1.6rem] leading-none sm:text-[1.75rem]", toneText)}>{value}</p>
      {typeof meter === "number" && (
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-sunken">
          <div
            className={cn("h-full rounded-full", meterClass ?? (resolved === "accent2" ? "bg-accent2" : "brand-gradient"))}
            style={{ width: `${Math.max(3, Math.min(100, meter * 100))}%` }}
          />
        </div>
      )}
      {hint && <p className="mt-1.5 truncate text-[11px] text-muted">{hint}</p>}
    </>
  );

  const className = "panel panel-interactive block rounded-2xl px-4 py-3.5";
  return href
    ? <a href={href} className={className}>{inner}</a>
    : <div className={className}>{inner}</div>;
}
