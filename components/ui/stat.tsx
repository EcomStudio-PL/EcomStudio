import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

/**
 * STAT — the reference stat card: a tracked overline, the number set large
 * on the display face, a one-line subtitle, and a big soft-tinted icon disc
 * holding the right edge. Each metric owns a hue from the violet/magenta
 * family, so a row of four reads as a set. An optional meter pins to the
 * bottom of the card (the credit traffic light).
 */
export function Stat({ label, value, hint, icon: Icon, tone, meter, meterClass, href, accent, accent2 }: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  tone?: "default" | "accent" | "accent2" | "success" | "indigo" | "violet" | "purple";
  /** 0–1 fill for the progress rail pinned to the card's bottom edge. */
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
    violet: "text-violet",
    purple: "text-purple",
  }[resolved];
  // Icon discs are the card's colour identity: a soft tinted gradient with a
  // matching glow, one hue per metric.
  const toneChip = {
    default: "bg-raised text-muted",
    accent: "bg-[linear-gradient(145deg,rgb(var(--accent)/0.32),rgb(var(--accent)/0.07))] text-accent shadow-[0_10px_26px_-12px_rgb(var(--accent)/0.9)]",
    accent2: "bg-[linear-gradient(145deg,rgb(var(--accent2)/0.32),rgb(var(--accent2)/0.07))] text-accent2 shadow-[0_10px_26px_-12px_rgb(var(--accent2)/0.8)]",
    success: "bg-[linear-gradient(145deg,rgb(var(--success)/0.28),rgb(var(--success)/0.06))] text-success shadow-[0_10px_26px_-12px_rgb(var(--success)/0.7)]",
    indigo: "bg-[linear-gradient(145deg,rgb(var(--indigo)/0.32),rgb(var(--indigo)/0.07))] text-indigo shadow-[0_10px_26px_-12px_rgb(var(--indigo)/0.8)]",
    violet: "bg-[linear-gradient(145deg,rgb(var(--violet)/0.32),rgb(var(--violet)/0.07))] text-violet shadow-[0_10px_26px_-12px_rgb(var(--violet)/0.8)]",
    purple: "bg-[linear-gradient(145deg,rgb(var(--purple)/0.32),rgb(var(--purple)/0.07))] text-purple shadow-[0_10px_26px_-12px_rgb(var(--purple)/0.8)]",
  }[resolved];

  const inner = (
    <>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">{label}</p>
          <p className={cn("metric mt-2 truncate text-[clamp(1.6rem,1.2rem+1.1vw,2.35rem)] leading-none", toneText)}>
            {value}
          </p>
          {hint && <p className="mt-2 truncate text-[11.5px] text-muted">{hint}</p>}
        </div>
        {Icon && (
          <span aria-hidden className={cn(
            "flex shrink-0 items-center justify-center rounded-full",
            "h-12 w-12 sm:h-14 sm:w-14",
            toneChip,
          )}>
            <Icon size={22} strokeWidth={1.9} />
          </span>
        )}
      </div>
      {typeof meter === "number" && (
        <div className="absolute inset-x-4 bottom-3 h-[3px] overflow-hidden rounded-full bg-[rgb(var(--ink)/0.10)] sm:inset-x-5">
          <div
            className={cn("h-full rounded-full", meterClass ?? (resolved === "accent2" ? "bg-accent2" : "brand-gradient"))}
            style={{ width: `${Math.max(3, Math.min(100, meter * 100))}%` }}
          />
        </div>
      )}
    </>
  );

  const className = cn(
    "panel panel-interactive relative block overflow-hidden rounded-2xl",
    "px-4 py-4 sm:px-5 sm:py-5",
    typeof meter === "number" && "pb-7 sm:pb-8",
  );
  return href
    ? <a href={href} className={className}>{inner}</a>
    : <div className={className}>{inner}</div>;
}
