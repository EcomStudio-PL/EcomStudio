import type { LucideIcon } from "lucide-react";
import { Scaling, Sparkles, Video } from "lucide-react";
import { CATEGORIES, categoryPath, offeredWorkflows, type Category } from "./categories";
import {
  CATALOG_ITEMS, TOOL_SECTIONS, catalogItem, type HubCardDef, type HubSectionDef,
} from "./tool-cards";
import {
  featureForHref, menuBadge, routeReachable, type AvailabilityMap, type FeatureKey, type MenuBadge,
} from "./features";
import { START_PICKED_ITEMS } from "./home-picks";

/**
 * THE CATALOGUE LAYOUT — how the customer's /tools is organised, and where
 * each item is promoted.
 *
 * TWO LAYERS, NEVER MIXED:
 *
 *   the tool itself .......... route, engine, model, credits, prompt, status —
 *                              unchanged, owned where it always was
 *                              (lib/features.ts + feature_availability,
 *                              ai_tools, service_catalog, lib/tool-cards.ts)
 *   its presentation ......... THIS: which sections /tools draws and in what
 *                              order, which items each holds and in what order
 *                              (one item may sit in several — Matching is in
 *                              E-commerce AND Moda, still one tool with one
 *                              route), and three independent switches per item:
 *                              show on /tools, show in the menu, show on Start.
 *
 * The status still decides whether an item can be USED (and a DISABLED one is
 * gone for customers everywhere, as FeatureGate has always made it). The
 * layout only decides where a usable-or-badged item is SHOWN.
 *
 * STORAGE. The default below is the layout the product ships with. An admin's
 * changes are one JSON document in `app_settings` (key `tools_layout`, admin
 * write, public read — migration 0008/0110 policies), merged over this default
 * by `normalizeLayout`: an empty or unreadable store is exactly this default,
 * unknown keys are dropped, and an item added to the code later takes its
 * default place instead of vanishing. No second registry of tools exists: the
 * items are lib/tool-cards.ts CATALOG_ITEMS, addressed by their keys.
 *
 * Client-safe on purpose: the menus and the admin editor use it in the browser.
 */

export type LayoutFlags = {
  /** Listed on /tools, in every section it is placed in. */
  tools: boolean;
  /** Listed in the header menu's tool column and the drawer's "Narzędzia". */
  menu: boolean;
  /** Promoted on the Start page. */
  start: boolean;
};

export type LayoutSection = {
  key: string;
  /** Shown on /tools. Hiding a section never removes what is placed in it. */
  visible: boolean;
  /** Item keys, in the order /tools draws them. */
  items: string[];
};

export type ToolsLayout = {
  v: 1;
  sections: LayoutSection[];
  /** One entry per catalogue item — also the record of which items the stored
   *  layout already knows (an item missing here is new in the code). */
  flags: Record<string, LayoutFlags>;
};

/** A section the layout can hold: its heading and what governs its note. */
export type SectionDef = {
  key: string;
  titleKey: string;
  icon: LucideIcon;
  /** The category whose switch this section's note reports (and whose
   *  `?category=` slug addresses it). */
  category?: string;
  /** Where "Zobacz wszystkie" goes, when the section has a screen of its own. */
  seeAll?: string;
  defaultItems: readonly string[];
};

const category = (key: string): Category => {
  const c = CATEGORIES.find((x) => x.key === key);
  if (!c) throw new Error(`unknown category ${key}`);
  return c;
};

/**
 * THE EIGHT SECTIONS, in the order /tools shows them by default, each with
 * the items it holds by default. Every key below is an existing catalogue item
 * (a test proves it); nothing here is a new tool.
 *
 * Mailing and Wideo AI keep exactly what they held before, derived from their
 * registries rather than retyped.
 */
export const LAYOUT_SECTIONS: readonly SectionDef[] = [
  {
    key: "generate", titleKey: "hub.sec.generate", icon: Sparkles,
    defaultItems: ["generator", "custom"],
  },
  {
    key: "ecommerce", titleKey: "cats.ecommerce", icon: category("ecommerce").icon, category: "ecommerce",
    defaultItems: [
      "retouch", "remove_bg", "background", "ai_background", "shadow",
      "ecommerce.thumbnail", "matching",
    ],
  },
  {
    key: "moda", titleKey: "cats.moda", icon: category("moda").icon, category: "moda",
    defaultItems: [
      "moda.ghostMannequin", "moda.flatlay", "moda.iron", "moda.changePerson", "moda.changeFace",
      "moda.street", "matching",
    ],
  },
  {
    key: "prepare", titleKey: "hub.sec.prepare", icon: Scaling,
    defaultItems: ["resize", "compress", "expand", "watermark"],
  },
  {
    key: "inne", titleKey: "cats.inne", icon: category("inne").icon, category: "inne",
    defaultItems: ["inne.label", "inne.packaging", "inne.leaflet", "inne.icons"],
  },
  {
    key: "social", titleKey: "cats.social", icon: category("social").icon, category: "social",
    defaultItems: ["social.feed", "social.ads", "social.ugc", "social.carousel"],
  },
  {
    key: "mailing", titleKey: "cats.mailing", icon: category("mailing").icon, category: "mailing",
    defaultItems: offeredWorkflows(category("mailing")).map((w) => `mailing.${w.key}`),
  },
  {
    key: "video", titleKey: "hub.sec.video", icon: Video, seeAll: "/wideo",
    defaultItems: (TOOL_SECTIONS.find((s) => s.key === "video")?.cards ?? []).map((c) => c.key),
  },
];

const SECTION_BY_KEY = new Map(LAYOUT_SECTIONS.map((s) => [s.key, s]));
const ITEM_KEYS = new Set(CATALOG_ITEMS.map((i) => i.key));

export function sectionDef(key: string): SectionDef | undefined {
  return SECTION_BY_KEY.get(key);
}

/**
 * THE NAME /tools GIVES AN ITEM, where the catalogue's own name differs from
 * the one the product presents it under. The item and its route are the same;
 * only the label on the card changes. Everything else keeps the item's own
 * title (lib/tool-cards.ts).
 */
const ITEM_LABEL: Readonly<Record<string, string>> = {
  generator: "hub.name.generator",
  background: "hub.name.background",
  ai_background: "hub.name.ai_background",
  shadow: "hub.name.shadow",
  "moda.street": "hub.name.moda_street",
};

export function itemLabelKey(item: HubCardDef): string {
  return ITEM_LABEL[item.key] ?? item.titleKey;
}

/**
 * The menu's tool column as it has always been — the four editing
 * destinations — plus the generator, whose menu entry is the panel's primary
 * button. These are the items whose "menu" switch starts ON; every other item
 * starts OFF, so the menu looks exactly as it did until an admin changes it.
 */
export const MENU_DEFAULT: readonly string[] = ["retouch", "editor", "resize", "compress", "generator"];

/** The order the menu's tool column has always used for its own entries. */
const MENU_BASE_ORDER: readonly string[] = ["retouch", "editor", "resize", "compress"];

/** The item whose menu entry is the header panel's primary button. */
export const MENU_CTA_ITEM = "generator";

function defaultFlags(key: string): LayoutFlags {
  return {
    tools: true,
    menu: MENU_DEFAULT.includes(key),
    // Start keeps promoting exactly what it promoted before.
    start: START_PICKED_ITEMS.includes(key),
  };
}

export const DEFAULT_LAYOUT: ToolsLayout = {
  v: 1,
  sections: LAYOUT_SECTIONS.map((s) => ({ key: s.key, visible: true, items: [...s.defaultItems] })),
  flags: Object.fromEntries(CATALOG_ITEMS.map((i) => [i.key, defaultFlags(i.key)])),
};

/* ── merging a stored layout over the default ───────────────────────────── */

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/**
 * A stored layout, made safe to render: sections and items the code does not
 * know are dropped, duplicates collapse, every known item gets flags, sections
 * the store predates take their default place, and an item the store never
 * heard of (it has no flags entry) is placed where the default places it. An
 * item the store DOES know but placed nowhere stays unplaced — that was an
 * admin's choice. Anything unreadable is the default.
 */
export function normalizeLayout(raw: unknown): ToolsLayout {
  const stored = isObject(raw) ? raw : {};
  const storedFlags = isObject(stored.flags) ? stored.flags : {};

  const flags: Record<string, LayoutFlags> = {};
  for (const item of CATALOG_ITEMS) {
    const d = defaultFlags(item.key);
    const s = storedFlags[item.key];
    flags[item.key] = isObject(s)
      ? { tools: bool(s.tools, d.tools), menu: bool(s.menu, d.menu), start: bool(s.start, d.start) }
      : d;
  }

  const sections: LayoutSection[] = [];
  const seen = new Set<string>();
  if (Array.isArray(stored.sections)) {
    for (const rs of stored.sections) {
      if (!isObject(rs) || typeof rs.key !== "string" || !SECTION_BY_KEY.has(rs.key) || seen.has(rs.key)) continue;
      seen.add(rs.key);
      const items = Array.isArray(rs.items)
        ? [...new Set(rs.items.filter((k): k is string => typeof k === "string" && ITEM_KEYS.has(k)))]
        : [...(SECTION_BY_KEY.get(rs.key)?.defaultItems ?? [])];
      sections.push({ key: rs.key, visible: rs.visible !== false, items });
    }
  }
  // A section the stored layout predates takes its default position.
  LAYOUT_SECTIONS.forEach((d, i) => {
    if (seen.has(d.key)) return;
    sections.splice(Math.min(i, sections.length), 0, { key: d.key, visible: true, items: [...d.defaultItems] });
  });
  // An item the store never knew is placed where the default places it.
  for (const item of CATALOG_ITEMS) {
    if (isObject(storedFlags[item.key])) continue;
    if (sections.some((s) => s.items.includes(item.key))) continue;
    for (const d of LAYOUT_SECTIONS) {
      if (d.defaultItems.includes(item.key)) sections.find((s) => s.key === d.key)?.items.push(item.key);
    }
  }
  return { v: 1, sections, flags };
}

/* ── what customers get ─────────────────────────────────────────────────── */

const gateOf = (c: HubCardDef) => c.gates ?? c.href;
const ownGate = (c: HubCardDef): string => (c.gates ? c.gates[c.gates.length - 1] : c.href);

/** May this viewer be shown this item at all? The status decides: a DISABLED
 *  module (its own switch or an outer one) is gone for customers; "Wkrótce"
 *  and maintenance stay, badged. Admins see everything. */
export function itemReachable(avail: AvailabilityMap, item: HubCardDef, isAdmin: boolean): boolean {
  return routeReachable(avail, gateOf(item), isAdmin);
}

function toSection(s: LayoutSection, cards: HubCardDef[]): HubSectionDef {
  const def = SECTION_BY_KEY.get(s.key);
  const cat = def?.category ? CATEGORIES.find((c) => c.key === def.category) : undefined;
  return {
    key: s.key,
    icon: def?.icon ?? Sparkles,
    titleKey: def?.titleKey ?? s.key,
    seeAll: def?.seeAll,
    category: cat?.key,
    gates: cat ? [categoryPath(cat)] : undefined,
    cards: cards.map((c) => ({ ...c, titleKey: itemLabelKey(c) })),
  };
}

/**
 * /tools AS ONE VIEWER SEES IT: the layout's visible sections, in its order,
 * each with the items placed in it whose "tools" switch is on and whose status
 * lets this viewer see them — in the layout's order. A section left with
 * nothing is not drawn. Card titles are the names /tools presents them under.
 */
export function hubSectionsFor(
  avail: AvailabilityMap,
  isAdmin: boolean,
  layout: ToolsLayout = DEFAULT_LAYOUT,
): HubSectionDef[] {
  return layout.sections
    .filter((s) => s.visible)
    // A category switched OFF takes its section with it, as it always has —
    // "Wkrótce" and maintenance keep it, badged.
    .filter((s) => {
      const cat = CATEGORIES.find((c) => c.key === SECTION_BY_KEY.get(s.key)?.category);
      return !cat || routeReachable(avail, categoryPath(cat), isAdmin);
    })
    .map((s) => toSection(s, s.items
      .map((k) => catalogItem(k))
      .filter((c): c is HubCardDef => Boolean(c))
      .filter((c) => layout.flags[c.key]?.tools !== false && itemReachable(avail, c, isAdmin))))
    .filter((s) => s.cards.length > 0);
}

/** Every section of the default layout with everything placed in it — the
 *  catalogue as it ships, for screens that list it without a viewer (Admin →
 *  Media) and for the tests. */
export const HUB_SECTIONS: readonly HubSectionDef[] = DEFAULT_LAYOUT.sections.map((s) =>
  toSection(s, s.items.map((k) => catalogItem(k)).filter((c): c is HubCardDef => Boolean(c))));

/**
 * Which drawn section a `?category=` value opens. A section's own key first;
 * then, for a category that is no longer a section of its own (Matching), the
 * first section holding an item that category governs — so an old link lands
 * where the thing now lives instead of on the top of the page.
 */
export function sectionKeyFor(requested: string | null | undefined, sections: readonly HubSectionDef[]): string | null {
  if (!requested) return null;
  if (sections.some((s) => s.key === requested)) return requested;
  const cat = CATEGORIES.find((c) => c.slug === requested || c.key === requested);
  if (!cat) return null;
  const feature = featureForHref(categoryPath(cat));
  const hit = sections.find((s) => s.cards.some((c) => featureForHref(ownGate(c)) === feature));
  return hit?.key ?? null;
}

/** Which feature switch governs an item (its own route's). */
export function itemFeature(item: HubCardDef): FeatureKey | null {
  return featureForHref(ownGate(item));
}

/* ── the menu ───────────────────────────────────────────────────────────── */

/**
 * The items the menu lists, in the order it lists them: the tool column's
 * own four first (as they have always been ordered), then any other item an
 * admin switched into the menu, in /tools order, then anything unplaced. The
 * generator is in here too when its switch is on — the menu draws it as the
 * panel's primary button (MENU_CTA_ITEM), not as a row.
 */
export function menuItemKeys(layout: ToolsLayout = DEFAULT_LAYOUT): string[] {
  const on = (k: string) => layout.flags[k]?.menu === true;
  const out: string[] = [];
  const add = (k: string) => { if (on(k) && !out.includes(k) && ITEM_KEYS.has(k)) out.push(k); };
  MENU_BASE_ORDER.forEach(add);
  add(MENU_CTA_ITEM);
  layout.sections.forEach((s) => s.items.forEach(add));
  CATALOG_ITEMS.forEach((i) => add(i.key));
  return out;
}

/* ── the Start page ─────────────────────────────────────────────────────── */

export function startOn(layout: ToolsLayout, key: string): boolean {
  return layout.flags[key]?.start === true;
}

/**
 * Items switched onto Start that its curated rows do not name: the Start page
 * appends them to "Wybierz efekt", in /tools order, so the switch is never a
 * control that does nothing.
 */
export function startExtras(layout: ToolsLayout = DEFAULT_LAYOUT): string[] {
  const out: string[] = [];
  const add = (k: string) => {
    if (startOn(layout, k) && !START_PICKED_ITEMS.includes(k) && !out.includes(k) && ITEM_KEYS.has(k)) out.push(k);
  };
  layout.sections.forEach((s) => s.items.forEach(add));
  CATALOG_ITEMS.forEach((i) => add(i.key));
  return out;
}

/* ── the admin screens ──────────────────────────────────────────────────── */

/** The sections an item is placed in, in layout order (Matching: two). */
export function placementsOf(layout: ToolsLayout, key: string): string[] {
  return layout.sections.filter((s) => s.items.includes(key)).map((s) => s.key);
}

/** The badge a customer sees on an item: switched off or under maintenance
 *  wins; otherwise an item with no engine yet is "Wkrótce" whatever its
 *  status, and a live one carries its status's badge (none when active). */
export function itemBadge(avail: AvailabilityMap, item: HubCardDef): MenuBadge {
  const b = menuBadge(avail, gateOf(item));
  if (b === "disabled" || b === "maintenance") return b;
  return item.soon ? "soon" : b;
}

/** Items no section holds — the admin editor lists them so none is lost. */
export function unplacedItems(layout: ToolsLayout): string[] {
  const placed = new Set(layout.sections.flatMap((s) => s.items));
  return CATALOG_ITEMS.map((i) => i.key).filter((k) => !placed.has(k));
}
