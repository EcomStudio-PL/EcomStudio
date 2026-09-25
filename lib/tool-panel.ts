import { CATEGORIES, categoryGates, categoryPath, type Category } from "./categories";
import { HUB_SECTIONS, hubSectionsFor, type HubCardDef, type HubSectionDef } from "./tool-cards";
import { homeModel, type HomeCard } from "./home-sections";
import {
  ACTIVE_STATE, FEATURE_REGISTRY, allDefaults, featureForHref, menuBadge, menuVisible,
  type AvailabilityMap, type FeatureDescriptor, type FeatureKey, type FeatureStatus, type MenuBadge,
} from "./features";
import { isAiToolKey } from "./services/ai-tools";

/**
 * ADMIN → NARZĘDZIA I SILNIKI — the shape of the one panel, derived.
 *
 * The panel used to be two screens: "Narzędzia i silniki" (engine, model,
 * credits — `ai_tools`, `ai_tool_models`, `service_catalog`) and "Dostępność
 * funkcji" (status, menu visibility — `feature_availability`). They are one
 * screen now, and this module is how that screen knows what to list, in which
 * group, and what a customer actually gets from each switch. It stores
 * nothing and decides nothing:
 *
 *   WHAT IS LISTED ... every FEATURE_REGISTRY entry, once. The registry is the
 *                      list the availability switchboard has always governed,
 *                      so nothing that could be switched before is lost.
 *   HOW IT IS GROUPED  from the registries themselves: the registry's own
 *                      menu groups, and each category of lib/categories.ts
 *                      with the tools whose route lives under it.
 *   WHAT A CUSTOMER    computed with the functions the customer app renders
 *   SEES               with — `hubSectionsFor` (/tools), `homeModel` (Start),
 *                      `menuVisible` / `menuBadge` (the menus). Not a copy of
 *                      their rules: the rules themselves, asked.
 *
 * Client-safe on purpose: the readout re-runs in the browser as the operator
 * flips a switch, before anything is saved.
 */

export type PanelKind = "tool" | "category" | "module";

export type PanelGroup = {
  key: string;
  /** Full i18n key of the group heading. */
  titleKey: string;
  keys: readonly FeatureKey[];
};

const descriptor = (key: FeatureKey): FeatureDescriptor | undefined =>
  FEATURE_REGISTRY.find((f) => f.key === key);

/** The category a feature key IS (image_moda → Moda), if any. */
export function categoryOf(key: FeatureKey): Category | null {
  return CATEGORIES.find((c) => featureForHref(categoryPath(c)) === key) ?? null;
}

/** The category a feature LIVES IN — its route sits under the category's
 *  (the Moda tools, /k/moda/<tool>). A category is not its own parent. */
export function parentCategory(key: FeatureKey): Category | null {
  const path = descriptor(key)?.path;
  if (!path) return null;
  return CATEGORIES.find((c) => path.startsWith(`${categoryPath(c)}/`)) ?? null;
}

/**
 * A TOOL is what the engine registry configures (lib/services/ai-tools.ts —
 * model, engine, credits). A CATEGORY is a section of /tools. Everything else
 * the switchboard governs — Start, Biblioteka, Historia, the tool hub itself —
 * is a MODULE: it has a status and a visibility, and no engine.
 */
export function panelKind(key: FeatureKey): PanelKind {
  if (isAiToolKey(key)) return "tool";
  if (categoryOf(key)) return "category";
  return "module";
}

function groupOf(f: FeatureDescriptor): string {
  const cat = categoryOf(f.key) ?? parentCategory(f.key);
  if (cat) return `cat:${cat.key}`;
  if (f.group === "create" || f.group === "edit" || f.group === "video") return f.group;
  return "modules";
}

/**
 * The panel's groups, in the order the customer meets them: making an image,
 * editing one, each category with its own tools, video, and the rest of the
 * application. Every registry key lands in exactly one group — a key the
 * rules above do not place falls to "modules" rather than out of the panel.
 */
export const PANEL_GROUPS: readonly PanelGroup[] = (() => {
  const order: { key: string; titleKey: string }[] = [
    { key: "create", titleKey: "featAdm.groups.create" },
    { key: "edit", titleKey: "featAdm.groups.edit" },
    ...CATEGORIES.map((c) => ({ key: `cat:${c.key}`, titleKey: `cats.${c.key}` })),
    { key: "video", titleKey: "featAdm.groups.video" },
    { key: "modules", titleKey: "aicc.panel.group.modules" },
  ];
  return order
    .map((g) => ({ ...g, keys: FEATURE_REGISTRY.filter((f) => groupOf(f) === g.key).map((f) => f.key) }))
    .filter((g) => g.keys.length > 0);
})();

export function panelGroupOf(key: FeatureKey): string {
  const f = descriptor(key);
  return f ? groupOf(f) : "modules";
}

/* ── what a switch covers ─────────────────────────────────────────────────── */

const ownGate = (c: HubCardDef): string => (c.gates ? c.gates[c.gates.length - 1] : c.href);
const governs = (key: FeatureKey, href: string): boolean => featureForHref(href) === key;
const sectionGoverned = (s: HubSectionDef, key: FeatureKey): boolean =>
  Boolean(s.gates && governs(key, s.gates[s.gates.length - 1]));

/**
 * The /tools cards that have no switch of their own and answer to this one —
 * "AI tło", "Relight"… all live behind the hub module, "Usuń tło" behind the
 * editor. For a category: every card of its section. The entry's own card
 * (the editor's "Edytor obrazu") is not listed under itself.
 */
export function coveredCards(key: FeatureKey): HubCardDef[] {
  const cat = categoryOf(key);
  if (cat) return [...(HUB_SECTIONS.find((s) => s.category === cat.key)?.cards ?? [])];
  const nameKey = descriptor(key)?.nameKey;
  return HUB_SECTIONS.flatMap((s) => s.cards)
    .filter((c) => governs(key, ownGate(c)) && c.titleKey !== nameKey);
}

/* ── what a customer gets ─────────────────────────────────────────────────── */

export type Surface = "tools" | "home" | "category" | "menu";
export type ExposureState = "shown" | "badged" | "hidden" | "na";

export type ExposureRow = {
  surface: Surface;
  state: ExposureState;
  /** The badge a customer sees when the state is "badged". */
  badge: MenuBadge;
  /** Full i18n keys of where it shows: section titles, Start rows, a category. */
  where: string[];
};

/** A map where one key has the draft status and visibility — the switchboard
 *  as it will be once the operator presses Save. */
export function withDraft(
  map: AvailabilityMap,
  key: FeatureKey,
  draft: { status: FeatureStatus; hiddenFromMenu: boolean },
): AvailabilityMap {
  return { ...map, [key]: { ...(map[key] ?? ACTIVE_STATE), status: draft.status, hiddenFromMenu: draft.hiddenFromMenu } };
}

const cardBadge = (map: AvailabilityMap, c: HubCardDef): MenuBadge =>
  c.soon ? "soon" : menuBadge(map, c.gates ?? c.href);

/** Folds what was found into one state: open if any occurrence is open. */
function fold(surface: Surface, found: { badge: MenuBadge; where: string }[], inUniverse: boolean): ExposureRow {
  if (!inUniverse) return { surface, state: "na", badge: null, where: [] };
  if (found.length === 0) return { surface, state: "hidden", badge: null, where: [] };
  const open = found.some((f) => f.badge === null);
  return {
    surface,
    state: open ? "shown" : "badged",
    badge: open ? null : found[0].badge,
    where: [...new Set(found.map((f) => f.where))],
  };
}

function toolsRow(key: FeatureKey, map: AvailabilityMap): ExposureRow {
  const inUniverse = HUB_SECTIONS.some((s) =>
    sectionGoverned(s, key) || s.cards.some((c) => governs(key, ownGate(c))));
  const found: { badge: MenuBadge; where: string }[] = [];
  for (const s of hubSectionsFor(map, false)) {
    if (sectionGoverned(s, key)) {
      // A category's section: it is listed, and its cards carry their badges.
      const open = s.cards.some((c) => cardBadge(map, c) === null);
      found.push({ badge: open ? null : cardBadge(map, s.cards[0]), where: s.titleKey });
      continue;
    }
    for (const c of s.cards) {
      if (governs(key, ownGate(c))) found.push({ badge: cardBadge(map, c), where: s.titleKey });
    }
  }
  return fold("tools", found, inUniverse);
}

const HOME_ROWS = ["rail", "chips", "effects", "video"] as const;

function homeCards(map: AvailabilityMap, isAdmin: boolean): { row: (typeof HOME_ROWS)[number]; card: HomeCard }[] {
  const model = homeModel(map, isAdmin);
  return HOME_ROWS.flatMap((row) => model[row].map((card) => ({ row, card })));
}

/** Every card Start can show, for anyone — computed once. */
const HOME_UNIVERSE: readonly { row: (typeof HOME_ROWS)[number]; card: HomeCard }[] = homeCards(allDefaults(), true);

function homeRow(key: FeatureKey, map: AvailabilityMap): ExposureRow {
  const inUniverse = HOME_UNIVERSE.some(({ card }) => governs(key, card.href));
  const found = homeCards(map, false)
    .filter(({ card }) => governs(key, card.href))
    .map(({ row, card }) => ({ badge: card.badge, where: `aicc.panel.home.${row}` }));
  return fold("home", found, inUniverse);
}

function categoryRow(key: FeatureKey, parent: Category, map: AvailabilityMap): ExposureRow {
  const section = hubSectionsFor(map, false).find((s) => s.category === parent.key);
  const found = (section?.cards ?? [])
    .filter((c) => governs(key, ownGate(c)))
    .map((c) => ({ badge: cardBadge(map, c), where: `cats.${parent.key}` }));
  return fold("category", found, true);
}

function menuRow(key: FeatureKey, map: AvailabilityMap): ExposureRow {
  const cat = categoryOf(key);
  const gate = cat ? categoryGates(cat) : descriptor(key)?.path;
  if (!gate) return { surface: "menu", state: "na", badge: null, where: [] };
  if (!menuVisible(map, gate, false)) return { surface: "menu", state: "hidden", badge: null, where: [] };
  const badge = menuBadge(map, gate);
  return { surface: "menu", state: badge ? "badged" : "shown", badge, where: [] };
}

/**
 * WHERE A CUSTOMER MEETS THIS ENTRY, under the given switchboard.
 *
 * Three rows, always in the same order: the Narzędzia tab, the Start page,
 * and — for a tool that lives in a category — that category's section, else
 * the menu. "na" is an honest "this surface has no place for it" (Start shows
 * a curated set, not every tool), never a guess.
 */
export function customerExposure(key: FeatureKey, map: AvailabilityMap): ExposureRow[] {
  const parent = parentCategory(key);
  return [
    toolsRow(key, map),
    homeRow(key, map),
    parent ? categoryRow(key, parent, map) : menuRow(key, map),
  ];
}
