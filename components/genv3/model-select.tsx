"use client";
import { useI18n } from "@/lib/i18n/provider";
import { Badge } from "@/components/ui/badge";
import { modelBadgeLabel } from "@/lib/model-badge";
import { badgeToneOf, type GenModel } from "@/components/genv3/types";
import { cn } from "@/lib/utils";
import { Dropdown } from "@/components/ui/dropdown";
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
 * SILNIK AI — the same control as format, resolution and quality.
 *
 * It used to expand its own list in place, which meant a fourth kind of menu
 * in one panel. It now goes through the shared dropdown: identical panel,
 * spacing, hover, check and animation, with the model's tile as the icon,
 * its badge as the note and its price as the meta column.
 */
export function ModelSelect({ label, models, value, onChange, priceOf }: {
  label: string;
  models: GenModel[];
  value: string;
  onChange: (id: string) => void;
  priceOf: (m: GenModel) => number;
}) {
  const { t } = useI18n();
  const selected = models.find((m) => m.id === value) ?? models[0];
  const selectedIdx = Math.max(0, models.findIndex((m) => m.id === selected?.id));
  if (!selected) return null;

  const options = models.map((m, idx) => ({
    value: m.id,
    label: m.name,
    sub: m.description ?? undefined,
    meta: t("genv3.perShotShort", { n: priceOf(m) }),
    note: modelBadgeLabel(m.badge, t) ?? undefined,
    icon: <ModelTile name={m.name} index={idx} size="sm" />,
  }));

  return (
    <section>
      <SectionLabel hint={t("genv3.modelHint")}>{label}</SectionLabel>
      <div className="rounded-xl border border-line bg-sunken/40 p-2 transition-colors hover:bg-raised/60">
        <Dropdown
          testId="model"
          value={selected.id}
          options={options}
          onChange={onChange}
          ariaLabel={label}
          panelWidth={320}
          renderValue={() => (
            <span className="flex min-w-0 items-center gap-2.5">
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
            </span>
          )}
        />
      </div>
    </section>
  );
}
