"use client";
import { Check } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import type { HistoryEntry } from "@/lib/images/editor-state";
import { cn } from "@/lib/utils";

/**
 * HISTORY — the list of steps, oldest first, starting at the untouched photo.
 *
 * Every row is a STATE, never a bitmap (see pushHistory): fifty steps cost a
 * few kilobytes, so the way back to the original is always there, and jumping
 * to any point is one assignment rather than a re-render of the pipeline.
 * Steps carry i18n KEYS, translated here — the state module has no dictionary.
 */
export function HistoryList({ entries, cursor, onRestore }: {
  entries: HistoryEntry[];
  /** Index of the step currently on screen. */
  cursor: number;
  onRestore: (index: number) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="pb-1">
      {entries.length <= 1 && (
        <p className="px-1 pb-3 text-[12.5px] leading-relaxed text-muted">{t("editor.historyEmpty")}</p>
      )}
      <ol className="space-y-1">
        {entries.map((entry, index) => {
          const current = index === cursor;
          // Steps after the cursor are the redo tail: still real, but not part
          // of what the canvas is showing, so they read as spent.
          const ahead = index > cursor;
          return (
            <li key={entry.id}>
              <button type="button" onClick={() => onRestore(index)} aria-current={current}
                title={current ? undefined : t("editor.restore")}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors duration-200",
                  current ? "is-selected" : "border-line hover:bg-raised",
                  ahead && !current && "opacity-55",
                )}>
                <span aria-hidden className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[10.5px] font-bold tabular-nums",
                  current ? "bg-accent text-white" : "bg-sunken text-faint",
                )}>
                  {index}
                </span>
                <span className={cn("min-w-0 flex-1 truncate text-[12.5px] font-semibold", current && "text-accent")}>
                  {t(entry.label)}
                </span>
                {current
                  ? <Check size={13} strokeWidth={3} aria-hidden className="shrink-0 text-accent" />
                  : <span className="shrink-0 text-[11px] font-semibold text-faint">{t("editor.restore")}</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
