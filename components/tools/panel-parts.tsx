"use client";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * THE BATCH PANEL, IN PIECES.
 *
 * Resize and Compression are the same screen with a different dial: a column
 * of choices on the left, a gallery on the right, a cost at the foot. They
 * were drawing that column twice, and it showed — the compression format row
 * squeezed four chips into a 21rem rail until "Bez zmiany formatu" rendered as
 * "Bez z…", which is a control that has stopped saying what it does.
 *
 * These are the shapes both now use. A radio ROW has all the width it needs
 * for a name, a second line of detail, and — the part a segmented control
 * cannot do at all — a reason when the option is off.
 */

/* ── a list of choices, one per row ─────────────────────────────────────── */

export type RadioRow<V extends string> = {
  value: V;
  label: string;
  /** The detail under the name: a pixel ceiling, a quality number. */
  meta?: string;
  icon?: LucideIcon;
  /** Present ONLY when the option cannot be chosen — and then it says why,
   *  in words, instead of greying out and leaving the seller guessing. */
  disabledReason?: string;
};

export function RadioRows<V extends string>({ name, value, rows, onChange, disabled }: {
  name: string;
  value: V | null;
  rows: readonly RadioRow<V>[];
  onChange: (value: V) => void;
  /** The whole group is off — e.g. a custom size is driving instead. */
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="space-y-1.5">
      {rows.map((row) => {
        const off = disabled || !!row.disabledReason;
        const active = value === row.value && !off;
        const Icon = row.icon;
        return (
          <label key={row.value}
            className={cn(
              "flex min-h-[2.75rem] items-center gap-2.5 rounded-xl border px-3 py-2 transition-colors duration-200",
              active ? "is-selected" : "border-line",
              off ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-raised",
            )}>
            <input type="radio" name={name} value={row.value} checked={active} disabled={off}
              onChange={() => onChange(row.value)}
              className="h-4 w-4 shrink-0 accent-[rgb(var(--accent))]" />
            {Icon && <Icon size={15} aria-hidden className={cn("shrink-0", active ? "text-accent" : "text-faint")} />}
            <span className="min-w-0 flex-1">
              <span className={cn("block truncate text-[13px] font-semibold", active && "text-accent")}>
                {row.label}
              </span>
              {/* A reason WRAPS; a spec line truncates. Clipping the reason is
                  how "unavailable — our encoder stops at 8000 px" became
                  "unavailable — our encoder stops at 80…", which explains
                  nothing at all. */}
              {row.disabledReason
                ? <span className="block text-[11px] leading-snug text-faint">{row.disabledReason}</span>
                : row.meta && <span className="block truncate text-[11px] tabular-nums text-faint">{row.meta}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/* ── the cost line ──────────────────────────────────────────────────────── */

/**
 * What one photo costs and what the queue costs, side by side.
 *
 * ALWAYS both figures, including when the tool is free. The free version used
 * to collapse into one line saying "Za darmo", which answered a question
 * nobody had asked — a seller looking at this card wants to know the price per
 * photo and the price of what is queued, and "0 kredytów / 0 kredytów" is a
 * true and useful answer to both. The word "za darmo" stays as the per-photo
 * value, where it explains the zero.
 *
 * The count is the number of photos WAITING, so the total is the cost of
 * pressing the button now — not of everything that has ever been in the queue.
 */
export function CostSummary({ perImage, count, enough }: {
  perImage: number;
  count: number;
  enough: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-stretch gap-3">
      <Figure
        label={t("tools.costPerImage")}
        value={perImage === 0 ? t("tools.free") : t("tools.creditsTotal", { n: perImage })}
        tone={perImage === 0 ? "free" : undefined}
      />
      <span aria-hidden className="w-px shrink-0 bg-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2))]" />
      <Figure label={t("tools.costTotal")} value={t("tools.creditsTotal", { n: perImage * count })}
        tone={enough ? undefined : "danger"} />
    </div>
  );
}

function Figure({ label, value, tone }: {
  label: string; value: string; tone?: "danger" | "free";
}) {
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">{label}</p>
      <p className={cn("truncate text-[15px] font-semibold tabular-nums",
        tone === "danger" ? "text-danger" : tone === "free" ? "text-success" : "text-ink")}>
        {value}
      </p>
    </div>
  );
}

/* ── the section label above a group ────────────────────────────────────── */

/** A group heading with an optional right-hand fact — the quality number the
 *  chosen strength really uses, the pixel ceiling the encoder really has. */
export function GroupLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <span className="min-w-0 truncate text-[12.5px] font-semibold text-ink">{children}</span>
      {hint && <span className="shrink-0 text-[11px] tabular-nums text-faint">{hint}</span>}
    </div>
  );
}
