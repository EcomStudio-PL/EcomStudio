import { Eraser, ImageOff, Maximize2, Palette, Sparkles, SquareDashed, Wand2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { TOOLS, toolAvailable, type ToolSlug } from "@/lib/ai/tools";

/** Each tool's icon and the colour it carries through the module. */
const PRESENTATION: Record<ToolSlug, { icon: LucideIcon; tone: string }> = {
  remove_background: { icon: ImageOff, tone: "text-accent bg-accent-soft" },
  white_background: { icon: SquareDashed, tone: "text-indigo bg-[rgb(var(--indigo)/0.14)]" },
  replace_background: { icon: Palette, tone: "text-accent2 bg-accent2-soft" },
  remove_object: { icon: Eraser, tone: "text-danger bg-[rgb(var(--danger)/0.12)]" },
  expand: { icon: Maximize2, tone: "text-indigo bg-[rgb(var(--indigo)/0.14)]" },
  enhance: { icon: Sparkles, tone: "text-success bg-[rgb(var(--success)/0.14)]" },
};

export default async function ToolsPage() {
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const tools = [...TOOLS].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div>
      <PageHeader overline={t("nav.groups.create")} title={t("tools.title")} sub={t("tools.sub")} />

      <div className="stagger grid gap-3.5 [&>*]:min-w-0 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((tool) => {
          const { icon: Icon, tone } = PRESENTATION[tool.slug];
          const available = toolAvailable(tool);
          return (
            <Panel key={tool.slug} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <span aria-hidden className={`flex h-11 w-11 items-center justify-center rounded-2xl ${tone}`}>
                  <Icon size={19} />
                </span>
                <span className="shrink-0 rounded-lg bg-raised px-2 py-1 text-[11px] font-bold tabular-nums text-muted">
                  {tool.defaultCost} ◆
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold tracking-tight">{t(`tools.${tool.slug}.name`)}</h2>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">{t(`tools.${tool.slug}.body`)}</p>
              </div>
              {available ? (
                <button type="button"
                  className="cta flex h-10 items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold">
                  {t("tools.open")}
                </button>
              ) : (
                /* No provider offers this capability yet. The card states that
                   honestly rather than opening a panel that cannot work. */
                <div className="flex items-center justify-between gap-2 rounded-xl bg-sunken/70 px-3 py-2.5">
                  <Badge tone="amber">{t("common.comingSoon")}</Badge>
                  <span className="text-[11px] text-faint">{t("tools.needsProvider")}</span>
                </div>
              )}
            </Panel>
          );
        })}
      </div>

      <Panel className="mt-5 flex items-start gap-3 p-4">
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Wand2 size={16} />
        </span>
        <p className="text-[13px] leading-relaxed text-muted">{t("tools.note")}</p>
      </Panel>
    </div>
  );
}
