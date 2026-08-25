import Link from "next/link";
import { PenLine, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ONE GENERATOR, TWO MODES — the spec folds the old "AI Studio" into the
 * Generator as its advanced mode. This switch sits at the top of both
 * screens so the user sees a single tool with a mode toggle, never two
 * separate applications. The per-shot price difference (custom prompt is
 * cheaper) is stated right on the toggle, per spec §5.2.
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
      <Link
        href={href}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-center text-[13px] font-semibold transition-all sm:flex-none sm:px-4",
          isActive
            ? "bg-surface text-ink shadow-e2 ring-1 ring-[rgb(var(--accent)/0.45)]"
            : "text-muted hover:bg-surface/60 hover:text-ink",
        )}
      >
        <Icon size={14} aria-hidden className={isActive ? "text-accent" : "text-faint"} />
        <span className="truncate">{label}</span>
        {typeof cost === "number" && cost > 0 && (
          <span className={cn("shrink-0 text-[11px] font-bold tabular-nums", isActive ? "text-accent" : "text-faint")}>
            {perShotLabel(cost)}
          </span>
        )}
      </Link>
    );
  };
  return (
    <div className="mb-5 flex w-full items-stretch gap-1 rounded-xl border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*0.8))] bg-sunken/80 p-1 sm:w-fit">
      {item("engine", "/prompts", Sparkles, engineLabel, engineCost)}
      {item("custom", "/generator", PenLine, customLabel, customCost)}
    </div>
  );
}
