import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

/**
 * STAT — one number, stated with confidence. An icon chip anchors it, the
 * value uses the display face with tabular figures, and an optional meter
 * turns an abstract count into something with a sense of scale. Sized to sit
 * two-across on a 375px screen without becoming a wall of oversized tiles.
 */
export function Stat({ label, value, hint, icon: Icon, tone, meter, href, accent, accent2 }: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  tone?: "default" | "accent" | "accent2" | "success";
  /** 0–1 fill for the progress rail under the value. */
  meter?: number;
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
  }[resolved];
  const toneChip = {
    default: "bg-raised text-muted",
    accent: "bg-accent-soft text-accent",
    accent2: "bg-accent2-soft text-accent2",
    success: "bg-[rgb(var(--success)/0.14)] text-success",
  }[resolved];

  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</p>
        {Icon && (
          <span aria-hidden className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", toneChip)}>
            <Icon size={14} />
          </span>
        )}
      </div>
      <p className={cn("mt-2 truncate metric text-[1.6rem] leading-none sm:text-[1.75rem]", toneText)}>{value}</p>
      {typeof meter === "number" && (
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-sunken">
          <div
            className={cn("h-full rounded-full", resolved === "accent2" ? "bg-accent2" : "brand-gradient")}
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
