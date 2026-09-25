import { CATEGORIES, categoryPath, type Category } from "./categories";
import { CATALOG_ITEMS, type HubCardDef } from "./tool-cards";
import { homeModel, type HomeCard } from "./home-sections";
import {
  ACTIVE_STATE, FEATURE_REGISTRY, allDefaults, featureForHref, menuBadge, menuVisible, routeReachable,
  type AvailabilityMap, type FeatureDescriptor, type FeatureKey, type FeatureStatus, type MenuBadge,
  type MenuGate,
} from "./features";
import {
  IMAGE_CREATE, IMAGE_MODES, VIDEO_CREATE, VIDEO_EDIT, editEntriesFor, entryGate, menuShowsGenerator,
} from "./topnav";
import { DOCK_SLOTS } from "./bottom-nav";
import { DEFAULT_LAYOUT, hubSectionsFor, menuItemKeys, type ToolsLayout } from "./tool-layout";
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
 *   SEES               with, fed the catalogue layout (lib/tool-layout.ts)
 *                      — `hubSectionsFor` (/tools), `homeModel` (Start),
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

/**
 * The catalogue items that have no switch of their own and answer to this one
 * — "Tło AI", "Relight"… all live behind the hub module, "Usuń tło" behind
 * the editor, a category's presets behind the category. The entry's own card
 * (the editor's "Edytor obrazu") is not listed under itself.
 */
export function coveredCards(key: FeatureKey): HubCardDef[] {
  const nameKey = descriptor(key)?.nameKey;
  return CATALOG_ITEMS.filter((c) => governs(key, ownGate(c)) && c.titleKey !== nameKey);
}

/** Every catalogue item this switch governs, its own card included — the
 *  items whose three layout switches a tool's row shows. */
export function governedItems(key: FeatureKey): HubCardDef[] {
  return CATALOG_ITEMS.filter((c) => governs(key, ownGate(c)));
}

/* ── what a customer gets ─────────────────────────────────────────────────── */

export type Surface = "tools" | "home" | "category" | "menu";
export type ExposureState = "shown" | "badged" | "hidden" | "na";

export type ExposureRow = {
  surface: Surface;
  state: ExposureState;
  /** The badge a customer sees when the state is "badged". */
  badge: MenuBadge;
  /** Full i18n keys of where it shows: section titles, Start rows. */
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
    where: [...new Set(found.map((f) => f.where).filter(Boolean))],
  };
}

/** What the /tools page itself is for a customer: open, a "Wkrótce" or
 *  maintenance screen (FeatureGate), or gone (DISABLED → 404). */
function hubState(map: AvailabilityMap): { open: boolean; reachable: boolean; badge: MenuBadge } {
  const reachable = routeReachable(map, "/tools", false);
  const badge = menuBadge(map, "/tools");
  return { reachable, badge, open: reachable && badge === null };
}

function toolsRow(key: FeatureKey, map: AvailabilityMap, layout: ToolsLayout): ExposureRow {
  const hub = hubState(map);
  // The hub's own entry: the whole tab, whatever it lists.
  if (key === "tools") {
    if (!hub.reachable) return { surface: "tools", state: "hidden", badge: null, where: [] };
    return { surface: "tools", state: hub.open ? "shown" : "badged", badge: hub.badge, where: ["aicc.panel.tools.whole"] };
  }
  const cat = categoryOf(key);
  const inUniverse = Boolean(cat) || CATALOG_ITEMS.some((c) => governs(key, ownGate(c)));
  // /tools is wrapped in FeatureGate("tools"): switched off it is a 404, and
  // restricted it is the Wkrótce / maintenance screen — no card is drawn.
  if (inUniverse && !hub.open) {
    return hub.reachable
      ? { surface: "tools", state: "badged", badge: hub.badge, where: ["aicc.panel.tools.whole"] }
      : { surface: "tools", state: "hidden", badge: null, where: [] };
  }
  const found: { badge: MenuBadge; where: string }[] = [];
  for (const s of hubSectionsFor(map, false, layout)) {
    for (const c of s.cards) {
      // A category is listed through every card behind its door (its
      // workflows, the Moda tools, Matching); anything else through the cards
      // whose own route it governs.
      const behind = cat ? (c.gates ?? []).includes(categoryPath(cat)) : governs(key, ownGate(c));
      if (behind) found.push({ badge: cardBadge(map, c), where: s.titleKey });
    }
  }
  return fold("tools", found, inUniverse);
}

const HOME_ROWS = ["rail", "chips", "effects", "video"] as const;

function homeCards(map: AvailabilityMap, isAdmin: boolean, layout: ToolsLayout): { row: (typeof HOME_ROWS)[number]; card: HomeCard }[] {
  const model = homeModel(map, isAdmin, layout);
  return HOME_ROWS.flatMap((row) => model[row].map((card) => ({ row, card })));
}

/** Every card the curated Start rows can show, for anyone — computed once. */
const HOME_UNIVERSE: readonly { row: (typeof HOME_ROWS)[number]; card: HomeCard }[] =
  homeCards(allDefaults(), true, DEFAULT_LAYOUT);

function homeRow(key: FeatureKey, map: AvailabilityMap, layout: ToolsLayout): ExposureRow {
  // The signed-in Start itself (/home, FeatureGate("home")): this switch
  // governs the whole page, not a card on it.
  if (key === "home") {
    if (!routeReachable(map, "/home", false)) return { surface: "home", state: "hidden", badge: null, where: [] };
    const badge = menuBadge(map, "/home");
    return { surface: "home", state: badge ? "badged" : "shown", badge, where: ["aicc.panel.home.page"] };
  }
  // Any catalogue item can be switched onto Start (it joins "Wybierz efekt"),
  // so every switch that governs one has a place there.
  const inUniverse = HOME_UNIVERSE.some(({ card }) => governs(key, card.href))
    || CATALOG_ITEMS.some((c) => governs(key, ownGate(c)));
  const found = homeCards(map, false, layout)
    .filter(({ card }) => governs(key, card.href))
    .map(({ row, card }) => ({ badge: card.badge, where: `aicc.panel.home.${row}` }));
  return fold("home", found, inUniverse);
}

type MenuEntry = { gate: MenuGate; soon: boolean; kind: "module" | "item" };

/**
 * EVERY MENU ENTRY — read from the lists the menus are drawn from
 * (lib/topnav.ts: the mega panel and the drawer; lib/bottom-nav.ts: the dock).
 * Module and category entries answer to the switchboard, as they always have;
 * the tool column and the generator button are the layout's "menu" switches
 * (`editEntriesFor`, `menuShowsGenerator`), so an item switched out of the menu
 * is simply not in this list. A link the menus draw unconditionally (Pomoc,
 * Kredyty, the drawer's Start tile) is not here: no switch hides it.
 */
function menuEntries(layout: ToolsLayout): MenuEntry[] {
  const items = menuItemKeys(layout);
  return [
    ...IMAGE_CREATE.map((e): MenuEntry => ({ gate: entryGate(e), soon: Boolean(e.soon), kind: "module" })),
    ...IMAGE_MODES
      .filter((e) => e.key !== "engine" || menuShowsGenerator(items))
      .map((e): MenuEntry => ({ gate: entryGate(e), soon: false, kind: e.key === "engine" ? "item" : "module" })),
    ...editEntriesFor(items)
      .map((e): MenuEntry => ({ gate: entryGate(e), soon: Boolean(e.soon), kind: e.key === "allTools" ? "module" : "item" })),
    ...VIDEO_CREATE.map((e): MenuEntry => ({ gate: entryGate(e), soon: true, kind: "module" })),
    ...VIDEO_EDIT.map((e): MenuEntry => ({ gate: entryGate(e), soon: true, kind: "module" })),
    // The drawer's and the mega panel's own gated rows.
    { gate: "/library", soon: false, kind: "module" },
    { gate: "/inspirations", soon: false, kind: "module" },
    { gate: "/wideo", soon: true, kind: "module" },
    ...DOCK_SLOTS.map((d): MenuEntry => ({ gate: d.href, soon: false, kind: "module" })),
  ];
}

/** Every module entry the menus could ever show, whatever the layout. */
const MODULE_MENU_UNIVERSE = menuEntries({
  ...DEFAULT_LAYOUT,
  flags: Object.fromEntries(Object.entries(DEFAULT_LAYOUT.flags).map(([k, f]) => [k, { ...f, menu: false }])),
}).filter((e) => e.kind === "module");

const ownOf = (gate: MenuGate): string => (typeof gate === "string" ? gate : gate[gate.length - 1]);

function menuRow(key: FeatureKey, map: AvailabilityMap, layout: ToolsLayout): ExposureRow {
  // In the universe when a module entry is governed by this switch, or when an
  // item it governs could be switched into the tool column.
  const inUniverse = MODULE_MENU_UNIVERSE.some((e) => governs(key, ownOf(e.gate)))
    || CATALOG_ITEMS.some((c) => governs(key, ownGate(c)));
  const found = menuEntries(layout)
    .filter((e) => governs(key, ownOf(e.gate)))
    .filter((e) => (e.kind === "module" ? menuVisible(map, e.gate, false) : routeReachable(map, e.gate, false)))
    .map((e) => ({ badge: menuBadge(map, e.gate) ?? (e.soon ? ("soon" as const) : null), where: "" }));
  return fold("menu", found, inUniverse);
}

/**
 * Has this entry no backend yet, whatever its status? A category flagged
 * `soon`, or a switch whose every card is (Wideo): customers see "Wkrótce"
 * on it even when the status is Aktywny, and the panel must say so.
 */
export function staticallySoon(key: FeatureKey): boolean {
  if (categoryOf(key)?.soon) return true;
  const cards = governedItems(key);
  return cards.length > 0 && cards.every((c) => c.soon);
}

/**
 * WHERE A CUSTOMER MEETS THIS ENTRY, under the given switchboard and layout.
 *
 * Three rows, always in the same order: the Narzędzia tab, the Start page and
 * the menu. "na" is an honest "this surface has no place for it", never a
 * guess.
 */
export function customerExposure(key: FeatureKey, map: AvailabilityMap, layout: ToolsLayout = DEFAULT_LAYOUT): ExposureRow[] {
  return [
    toolsRow(key, map, layout),
    homeRow(key, map, layout),
    menuRow(key, map, layout),
  ];
}
