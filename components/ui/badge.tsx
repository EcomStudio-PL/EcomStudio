import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-raised text-muted",
  green: "bg-accent-soft text-accent",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  red: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400",
  blue: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400",
} as const;

export function Badge({ tone = "neutral", className, children }: {
  tone?: keyof typeof tones; className?: string; children: React.ReactNode;
}) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}
