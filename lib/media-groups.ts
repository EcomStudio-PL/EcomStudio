import { CATEGORIES, categoryHref } from "./categories";
import { MEDIA_SLOTS, type SlotDef, type SlotEntity } from "./media-slots";
import { toolCard } from "./tool-cards";
import { HUB_SECTIONS } from "./tool-layout";
import type { SlotRow } from "./services/media-slots";
import type { SlotGroupView } from "@/components/admin/media/slots-panel";

/**
 * WHAT THE ADMIN'S KATEGORIE AND NARZĘDZIA TABS LIST — as data.
 *
 * These lived inside app/admin/media/page.tsx, where they could only be checked
 * by rendering the admin. They are pure: the registries plus whatever rows are
 * configured go in, the groups come out. That is what lets a test feed them the
 * rows production actually holds and prove that no picture changed tab in a way
 * that hides it, and that each tab lists only its own kind of thing.
 *
 * ONLY THE GROUPING LIVES HERE. Every slot keeps the key it always had; a
 * configured row is looked up by that key and merged in untouched. Nothing here
 * writes, renames or drops a row.
 */

type T = (key: string, values?: Record<string, string | number>) => string;

/** The slots of one entity, in declaration order, with whatever is configured
 *  merged in. A slot with no row is not missing — it is using its fallback. */
export function slotsOf(
  configured: Map<string, SlotRow>, entityType: SlotEntity, entityId: string,
): { def: SlotDef; row: SlotRow | null }[] {
  return MEDIA_SLOTS
    .filter((d) => d.entityType === entityType && d.entityId === entityId)
    .map((def) => ({ def, row: configured.get(def.key) ?? null }));
}

/**
 * KATEGORIE — the categories, and nothing but the categories.
 *
 * One group per category, holding the category's OWN picture. Its tools —
 * Niewidzialny manekin, Packshot, Rolki… — are tools, and live on the Narzędzia
 * tab beside every other tool. They used to be listed here, under the category,
 * which put a tool on the tab meant for categories and left it off the tab
 * meant for tools.
 */
export function categoryGroups(configured: Map<string, SlotRow>, t: T): SlotGroupView[] {
  return CATEGORIES.map((c) => ({
    id: c.key, name: t(`cats.${c.key}`), sub: categoryHref(c),
    slots: slotsOf(configured, "category", c.key),
  }));
}

/**
 * NARZĘDZIA — every tool that has a slot, in the order /tools shows them and
 * under the section /tools shows them in.
 *
 * Not a second list: HUB_SECTIONS (lib/tool-layout.ts — the shipped layout of
 * /tools) is what this enumerates — the catalogue's own tools and every
 * category's workflows alike. A workflow's slot is the `workflow` entity it
 * always was; only the tab it is listed on moved.
 *
 * Then a safety net: any tool or workflow slot the registry declares that the
 * hub did not list is appended rather than silently dropped. An operator must
 * never lose sight of a slot that holds a picture.
 */
export function toolGroups(configured: Map<string, SlotRow>, t: T): SlotGroupView[] {
  const groups: SlotGroupView[] = [];
  const listed = new Set<string>();
  const add = (entityType: SlotEntity, entityId: string, name: string, sub: string) => {
    const id = `${entityType}:${entityId}`;
    if (listed.has(id)) return;
    const slots = slotsOf(configured, entityType, entityId);
    if (slots.length === 0) return;
    listed.add(id);
    groups.push({ id: entityId, name, sub, slots });
  };
  for (const section of HUB_SECTIONS) {
    for (const card of section.cards) {
      add(card.workflow ? "workflow" : "tool", card.key, t(card.titleKey), t(section.titleKey));
    }
  }
  for (const def of MEDIA_SLOTS) {
    if (def.entityType === "tool") {
      add("tool", def.entityId, t(toolCard(def.entityId)?.titleKey ?? def.entityId), t("media.tab.narzedzia"));
    }
    if (def.entityType === "workflow") {
      const [cat, wf] = def.entityId.split(".");
      add("workflow", def.entityId, t(`wf.${cat}.${wf}.name`), t(`cats.${cat}`));
    }
  }
  return groups;
}
