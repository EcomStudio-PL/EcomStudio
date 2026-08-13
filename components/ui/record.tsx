"use client";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

/**
 * RECORD ROW — how an admin list item looks at every screen size.
 *
 * A list of configurable objects (templates, blocks, plans) is not tabular
 * data: it is a set of records with a title, a line of metadata, a state and
 * a couple of actions. Rendering it as a table forces "H.. P.. S.."
 * truncation on a phone, so it is a stacked record instead — title and meta
 * on their own line, state and actions on the next, comfortable to tap.
 */
export function RecordRow({ title, meta, state, actions, leading, className }: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  /** Status badge or switch — the record's current state. */
  state?: React.ReactNode;
  actions?: React.ReactNode;
  /** Optional leading marker: order number, thumbnail, icon. */
  leading?: React.ReactNode;
  className?: string;
}) {
  return (
    <li className={cn("px-4 py-3 transition-colors hover:bg-raised/40 sm:px-5", className)}>
      <div className="flex items-start gap-3">
        {leading}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{title}</p>
          {meta && <p className="mt-0.5 truncate text-xs text-muted">{meta}</p>}
        </div>
        {state && <div className="shrink-0 pt-0.5">{state}</div>}
      </div>
      {actions && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">{actions}</div>
      )}
    </li>
  );
}

/** Compact action inside a record row: icon + label, 40px tap target. */
export function RowAction({ icon: Icon, label, tone, ...props }: {
  icon?: LucideIcon;
  label: string;
  tone?: "danger";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold transition-colors",
        tone === "danger"
          ? "text-danger hover:bg-[rgb(var(--danger)/0.12)]"
          : "text-muted hover:bg-raised hover:text-ink",
        "disabled:pointer-events-none disabled:opacity-50"
      )}
      {...props}
    >
      {Icon && <Icon size={14} aria-hidden />}
      {label}
    </button>
  );
}

/**
 * SWITCH — an on/off state that reads as state, not as a command. Replaces
 * "Deactivate" buttons that took half a phone row to say what a 44px toggle
 * says instantly.
 */
export function Switch({ checked, onChange, label, disabled }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200",
        "after:absolute after:-inset-2.5 after:content-['']", // 44px touch area
        checked ? "bg-accent" : "bg-[rgb(var(--faint)/0.35)]",
        disabled && "pointer-events-none opacity-50"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block h-4.5 w-4.5 rounded-full bg-white shadow-e1 transition-transform duration-200",
          "h-[18px] w-[18px]",
          checked ? "translate-x-[24px]" : "translate-x-[4px]"
        )}
      />
    </button>
  );
}
