import { cn } from "@/lib/utils";

/** Tone vocabulary. Every badge is a soft tinted plate with a matching
 *  foreground — never a saturated block that fights the content. */
const tones = {
  neutral: "bg-raised text-muted ring-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.4))]",
  green: "bg-accent-soft text-accent ring-[rgb(var(--accent)/0.30)]",
  amber: "bg-accent2-soft text-accent2 ring-[rgb(var(--accent2)/0.30)]",
  red: "bg-[rgb(var(--danger)/0.14)] text-danger ring-[rgb(var(--danger)/0.30)]",
  blue: "bg-[rgb(var(--indigo)/0.14)] text-indigo ring-[rgb(var(--indigo)/0.32)]",
  info: "bg-[rgb(var(--indigo)/0.14)] text-indigo ring-[rgb(var(--indigo)/0.32)]",
  indigo: "bg-accent2-soft text-accent2 ring-[rgb(var(--accent2)/0.30)]",
  success: "bg-[rgb(var(--success)/0.14)] text-success ring-[rgb(var(--success)/0.30)]",
} as const;

export function Badge({ tone = "neutral", className, dot, children }: {
  tone?: keyof typeof tones;
  className?: string;
  /** Prefix the label with a status dot — used in lists and product cards. */
  dot?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5",
      "text-[11px] font-semibold ring-1",
      tones[tone], className
    )}>
      {dot && <span aria-hidden className="dot bg-current" />}
      {children}
    </span>
  );
}
