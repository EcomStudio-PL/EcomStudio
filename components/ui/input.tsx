import { cn } from "@/lib/utils";

/**
 * FORM FIELDS. Inputs sit on the inset plane rather than the card plane, so
 * a form reads as fields carved into the panel instead of boxes stacked on
 * it. Focus lifts the field onto the surface plane with an accent ring —
 * one clear state change rather than a colour swap.
 * text-base on touch screens keeps iOS Safari from auto-zooming (<16px).
 */
const base = cn(
  "w-full rounded-xl bg-sunken/70 px-3.5 py-3 text-base sm:text-sm text-ink",
  "border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.2))]",
  "placeholder:text-faint",
  "transition-[background-color,border-color,box-shadow] duration-150",
  "hover:border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2))]",
  "focus:bg-surface focus:border-[rgb(var(--accent)/0.55)] focus:outline-none focus:ring-4 focus:ring-[rgb(var(--accent)/0.14)]",
  "disabled:opacity-50"
);

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(base, props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(base, "min-h-24 leading-relaxed thin-scroll", props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        base,
        "appearance-none bg-[length:14px] bg-[right_0.9rem_center] bg-no-repeat pr-10",
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23808198%22 stroke-width=%223%22 stroke-linecap=%22round%22><path d=%22M5 9l7 7 7-7%22/></svg>')]",
        props.className
      )}
    />
  );
}

export function Label({ children, htmlFor, hint }: {
  children: React.ReactNode;
  htmlFor?: string;
  /** Right-aligned helper (optional / max length / cost) on the label row. */
  hint?: React.ReactNode;
}) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <label htmlFor={htmlFor} className="text-[13px] font-semibold tracking-tight text-ink">
        {children}
      </label>
      {hint && <span className="text-[11px] text-faint">{hint}</span>}
    </div>
  );
}
