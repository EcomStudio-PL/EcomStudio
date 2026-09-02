import Link from "next/link";
import { PenLine, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ONE GENERATOR, TWO MODES — the spec folds the old "AI Studio" into the
 * Generator as its advanced mode. This switch sits at the top of both
 * screens so the user sees a single tool with a mode toggle, never two
 * separate applications.
 *
 * Width: on desktop the two segments together are EXACTLY as wide as the
 * configuration column beneath them (same clamp as the workspace grid), so
 * the switch reads as the column's own header rather than a loose pill.
 * Each segment takes half; the price per photo is a small tail on the
 * label, marked with the credit sparkle, not a badge.
 */
export function GeneratorModeSwitch({ active, engineLabel, customLabel, engineCost, customCost, perShotLabel }: {
  active: "engine" | "custom";
  engineLabel: string;
  customLabel: string;
  /** Per-shot prices at the default model; omitted when no model is usable. */
  engineCost?: number | null;
  customCost?: number | null;
  perShotLabel: (n: number) => string;
}) {
  const item = (mode: "engine" | "custom", href: string, Icon: typeof Sparkles, label: string, cost?: number | null) => {
    const isActive = active === mode;
    return (
      // Two lines per segment: the name, then the price as a small tail
      // beneath it. Side by side they do not fit two segments into the
      // column width without truncating one of them — a cut-off "GrovBase
      // Sho…" is exactly the opposite of subtle.
      <Link
        href={href}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1.5 text-center transition-all",
          isActive
            ? "bg-surface text-ink shadow-e2 ring-1 ring-[rgb(var(--accent)/0.45)]"
            : "text-muted hover:bg-surface/60 hover:text-ink",
        )}
      >
        <span className="flex min-w-0 max-w-full items-center gap-1.5 text-[13px] font-semibold leading-tight">
          <Icon size={14} aria-hidden className={cn("shrink-0", isActive ? "text-accent" : "text-faint")} />
          <span className="truncate">{label}</span>
        </span>
        {typeof cost === "number" && cost > 0 && (
          <span className={cn(
            "inline-flex shrink-0 items-center gap-0.5 text-[10.5px] font-semibold leading-none tabular-nums",
            isActive ? "text-accent" : "text-faint",
          )}>
            <Sparkles size={9} aria-hidden />
            {perShotLabel(cost)}
          </span>
        )}
      </Link>
    );
  };
  return (
    <div className="mb-4 flex w-full items-stretch gap-1 rounded-xl border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*0.8))] bg-sunken/80 p-1 lg:w-[clamp(420px,29vw,470px)]">
      {item("engine", "/prompts", Sparkles, engineLabel, engineCost)}
      {item("custom", "/generator", PenLine, customLabel, customCost)}
    </div>
  );
}
