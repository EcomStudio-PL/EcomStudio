"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Badge } from "@/components/ui/badge";
import { modelBadgeLabel } from "@/lib/model-badge";
import { badgeToneOf, type GenModel } from "@/components/genv3/types";
import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/genv3/sections";

const TILES = [
  "bg-[linear-gradient(135deg,#C900CF,#F800F8_60%,#FF3DDA)]",
  "bg-[linear-gradient(135deg,#4338CA,#7A82FF_60%,#A5B4FC)]",
  "bg-[linear-gradient(135deg,#B45309,#F59E0B_60%,#FCD34D)]",
  "bg-[linear-gradient(135deg,#047857,#10B981_60%,#6EE7B7)]",
  "bg-[linear-gradient(135deg,#0E7490,#06B6D4_60%,#67E8F9)]",
] as const;

export function ModelTile({ name, index, size = "md" }: { name: string; index: number; size?: "sm" | "md" }) {
  return (
    <span aria-hidden className={cn(
      "flex shrink-0 items-center justify-center rounded-lg font-display font-bold text-white",
      "shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_5px_12px_-6px_rgb(0_0_0/0.45)]",
      size === "sm" ? "h-7 w-7 text-[11px]" : "h-9 w-9 text-[13px]",
      TILES[index % TILES.length],
    )}>
      {name.replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase() || "AI"}
    </span>
  );
}

export function ModelBadge({ model }: { model: Pick<GenModel, "badge" | "badgeTone"> }) {
  const { t } = useI18n();
  const label = modelBadgeLabel(model.badge, t);
  if (!label) return null;
  return <Badge tone={badgeToneOf(model.badge, model.badgeTone)}>{label}</Badge>;
}

/**
 * MODEL SELECTOR — the reference's "Silnik AI" row: the chosen model as a
 * compact row (tile, name, badge, price, caret) that expands in place to the
 * full list with descriptions. Closes on pick, ESC and outside click.
 */
export function ModelSelect({ label, models, value, onChange, priceOf }: {
  label: string;
  models: GenModel[];
  value: string;
  onChange: (id: string) => void;
  priceOf: (m: GenModel) => number;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = models.find((m) => m.id === value) ?? models[0];
  const selectedIdx = Math.max(0, models.findIndex((m) => m.id === selected?.id));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, [open]);

  if (!selected) return null;

  return (
    <section ref={rootRef}>
      <SectionLabel hint={t("genv3.modelHint")}>{label}</SectionLabel>
      <button type="button" onClick={() => setOpen(!open)}
        aria-expanded={open} aria-haspopup="listbox"
        className={cn(
          "flex w-full items-center gap-2.5 rounded-xl border p-2.5 text-left transition-colors duration-200",
          open ? "border-[rgb(var(--accent)/0.5)] bg-raised/70" : "border-line bg-sunken/40 hover:bg-raised/60",
        )}>
        <ModelTile name={selected.name} index={selectedIdx} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 truncate text-[13.5px] font-semibold">{selected.name}</span>
            <ModelBadge model={selected} />
          </span>
        </span>
        <span className="shrink-0 text-[11.5px] font-bold tabular-nums text-accent">
          {t("genv3.perShotShort", { n: priceOf(selected) })}
        </span>
        <ChevronDown size={14} aria-hidden className={cn("shrink-0 text-faint transition-transform duration-200", open && "rotate-180")} />
      </button>

      {open && (
        <div role="listbox" aria-label={label} className="animate-fade mt-1.5 space-y-1.5">
          {models.map((m, idx) => {
            const on = m.id === selected.id;
            return (
              <button key={m.id} type="button" role="option" aria-selected={on}
                onClick={() => { onChange(m.id); setOpen(false); }}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-xl border p-2.5 text-left transition-colors duration-200",
                  on ? "is-selected" : "border-line hover:bg-raised",
                )}>
                <ModelTile name={m.name} index={idx} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 truncate text-[13px] font-semibold">{m.name}</span>
                    <ModelBadge model={m} />
                    {on && <Check size={13} strokeWidth={3} aria-hidden className="ml-auto shrink-0 text-accent" />}
                  </span>
                  {m.description && (
                    <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-muted">{m.description}</span>
                  )}
                </span>
                <span className="shrink-0 pt-0.5 text-[11.5px] font-bold tabular-nums text-accent">
                  {t("genv3.perShotShort", { n: priceOf(m) })}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
