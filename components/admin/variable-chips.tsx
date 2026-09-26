"use client";
import { useId, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { VariableDef } from "@/lib/ai/prompt-variables";
import { cn } from "@/lib/utils";

// Same tinted-plate vocabulary as <Badge>: customer data reads as "info",
// model-produced values as "accent", system values as neutral.
const SOURCE_TONE: Record<VariableDef["source"], string> = {
  customer: "bg-[rgb(var(--indigo)/0.14)] text-indigo ring-[rgb(var(--indigo)/0.32)]",
  product: "bg-[rgb(var(--indigo)/0.14)] text-indigo ring-[rgb(var(--indigo)/0.32)]",
  system: "bg-raised text-ink ring-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.4))]",
  ai: "bg-accent2-soft text-accent2 ring-[rgb(var(--accent2)/0.30)]",
  knowledge: "bg-accent2-soft text-accent2 ring-[rgb(var(--accent2)/0.30)]",
  workflow: "bg-[rgb(var(--success)/0.14)] text-success ring-[rgb(var(--success)/0.30)]",
};

/**
 * The variables a prompt may use, as chips. A tap inserts the placeholder at
 * the cursor of the editor the chips belong to; the toggle decides whether it
 * goes in as REQUIRED ({{name}}) or OPTIONAL ({{name?}}).
 */
export function VariableChips({ defs, onInsert }: {
  defs: VariableDef[];
  onInsert: (token: string) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const [optional, setOptional] = useState(false);
  if (defs.length === 0) return null;
  return (
    <div className="space-y-2" data-variable-chips>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted">{t("aicc.vars.insert")}</p>
        <label htmlFor={`${id}-opt`} className="inline-flex min-h-[32px] cursor-pointer items-center gap-2 text-xs text-muted">
          <input id={`${id}-opt`} type="checkbox" checked={optional} onChange={(e) => setOptional(e.target.checked)}
            className="size-4 accent-[rgb(var(--accent))]" />
          {t("aicc.vars.optionalToggle")}
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {defs.map((d) => (
          <button key={d.key} type="button"
            title={t(`aicc.var.${d.key.startsWith("step") ? "stepN" : d.key}`)}
            onClick={() => onInsert(optional ? `{{${d.key}?}}` : `{{${d.key}}}`)}
            className={cn(
              "inline-flex min-h-[32px] items-center rounded-lg px-2.5 font-mono text-[11.5px] font-semibold ring-1 transition-[filter] hover:brightness-110",
              SOURCE_TONE[d.source],
            )}>
            {`{{${d.key}}}`}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Insert `token` at the textarea's cursor and return the new value. */
export function insertAtCursor(el: HTMLTextAreaElement | null, value: string, token: string): { value: string; cursor: number } {
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? value.length;
  return { value: value.slice(0, start) + token + value.slice(end), cursor: start + token.length };
}
