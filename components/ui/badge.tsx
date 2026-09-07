import { cn } from "@/lib/utils";

/**
 * Tone vocabulary. Every badge is a soft tinted plate with a matching
 * foreground — never a saturated block that fights the content.
 *
 * FOUR MEANINGS, NAMED AFTER THE MEANING.
 *
 * The old vocabulary was named after colours that were not the colours: a
 * "green" badge rendered magenta and an "amber" one rendered orange, so
 * `published ? "green" : "amber"` was a pair of brand tints that told a reader
 * nothing and pulled the admin panel visually away from the rest of GrovBase.
 *
 *   success — it is on, live, published, healthy   → real green
 *   accent  — secondary state worth noticing: draft, inactive, featured,
 *             a category, a percentage                → brand magenta
 *   danger  — it failed, it is blocked                → red
 *   info    — a neutral fact in a coloured slot       → indigo
 *   neutral — no signal at all                        → grey
 *
 * There is deliberately no amber and no yellow: attention is the brand colour
 * in this system, and anything genuinely wrong is `danger`.
 */
const tones = {
  neutral: "bg-raised text-muted ring-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.4))]",
  success: "bg-[rgb(var(--success)/0.14)] text-success ring-[rgb(var(--success)/0.30)]",
  accent: "bg-accent2-soft text-accent2 ring-[rgb(var(--accent2)/0.30)]",
  danger: "bg-[rgb(var(--danger)/0.14)] text-danger ring-[rgb(var(--danger)/0.30)]",
  info: "bg-[rgb(var(--indigo)/0.14)] text-indigo ring-[rgb(var(--indigo)/0.32)]",
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
