/**
 * FEATURE AVAILABILITY — the central registry (one list, not fifty ifs).
 *
 * Every user-facing module GrovBase actually ships is here, once, with the
 * route that opens it and the menu group it belongs to. The admin panel, the
 * customer menu, the badges, the route guards and the API guards all read
 * THIS — there is no second list anywhere, which is the only way a new page
 * cannot quietly escape the switchboard.
 *
 * Client-safe on purpose: the nav components filter and badge from this file
 * plus a plain serialisable map the (app) layout hands them. Everything that
 * touches the database or the admin role lives in
 * lib/server/feature-availability.ts.
 *
 * WHAT IS DELIBERATELY ABSENT (and can therefore never be switched off):
 * login and logout, the e-mail confirmation flow, the security challenge,
 * account settings, and the subscription/plan screen — the things a customer
 * needs in order to get in, get out, stay safe or exercise a right, plus the
 * availability panel itself. A key that does not exist cannot be disabled by
 * accident, and the admin actions refuse any key outside this registry.
 */

export const FEATURE_KEYS = [
  // Główne
  "home",
  "library",
  "history",
  // Obraz — the six category workspaces, each its own /k/<slug>
  "image_moda",
  "image_ecommerce",
  "image_social",
  "image_mailing",
  "image_inne",
  "image_matching",
  // Tworzenie
  "prompts",
  "generator",
  // Edytuj
  "retouch",
  "editor",
  "resize",
  "compress",
  "tools",
  "tool_upscale",
  "tool_expand",
  "tool_watermark",
  // Wideo
  "video",
  // Konto i zasoby
  "products",
  "inspirations",
  "credits",
  "support",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type FeatureStatus = "ACTIVE" | "COMING_SOON" | "MAINTENANCE" | "DISABLED";

export const FEATURE_STATUSES: readonly FeatureStatus[] = [
  "ACTIVE", "COMING_SOON", "MAINTENANCE", "DISABLED",
];

/** The menu groups, in the order the customer's drawer shows them. */
export const FEATURE_GROUPS = ["main", "image", "create", "edit", "video", "account"] as const;
export type FeatureGroup = (typeof FEATURE_GROUPS)[number];

/** The EFFECTIVE state of one feature, after the time window is applied. */
export type FeatureState = {
  status: FeatureStatus;
  hiddenFromMenu: boolean;
  customTitle: string | null;
  customMessage: string | null;
  /** ISO timestamp when it reopens automatically (ends_at + auto_reenable). */
  reopensAt: string | null;
};

export type AvailabilityMap = Record<FeatureKey, FeatureState>;

export const ACTIVE_STATE: FeatureState = {
  status: "ACTIVE", hiddenFromMenu: false, customTitle: null, customMessage: null, reopensAt: null,
};

export type FeatureDescriptor = {
  key: FeatureKey;
  /** i18n key of the display name — the same label the menu uses. */
  nameKey: string;
  /** The canonical route. Also what the admin panel shows under the name. */
  path: string;
  group: FeatureGroup;
  /**
   * Extra route prefixes this feature owns, so a guard covers the children
   * too (/products/new, /prompts/<id>, /k/moda/<workflow>…).
   */
  extraPaths?: readonly string[];
  /** A module with no backend yet starts restricted rather than pretending. */
  defaultStatus?: FeatureStatus;
};

export const FEATURE_REGISTRY: readonly FeatureDescriptor[] = [
  // ── GŁÓWNE ───────────────────────────────────────────────────────────────
  { key: "home", nameKey: "topnav.home", path: "/home", group: "main", extraPaths: ["/dashboard"] },
  { key: "library", nameKey: "topnav.library", path: "/library", group: "main" },
  { key: "history", nameKey: "nav.history", path: "/history", group: "main" },
  // ── OBRAZ ────────────────────────────────────────────────────────────────
  { key: "image_moda", nameKey: "cats.moda", path: "/k/moda", group: "image" },
  { key: "image_ecommerce", nameKey: "cats.ecommerce", path: "/k/ecommerce", group: "image" },
  { key: "image_social", nameKey: "cats.social", path: "/k/social", group: "image" },
  { key: "image_mailing", nameKey: "cats.mailing", path: "/k/mailing", group: "image" },
  { key: "image_inne", nameKey: "cats.inne", path: "/k/inne", group: "image" },
  // No engine behind it yet — the registry says so, rather than the menu
  // hard-coding a badge next to a link that leads nowhere.
  { key: "image_matching", nameKey: "cats.matching", path: "/k/matching", group: "image", defaultStatus: "COMING_SOON" },
  // ── TWORZENIE ────────────────────────────────────────────────────────────
  { key: "prompts", nameKey: "mega.engine", path: "/prompts", group: "create" },
  { key: "generator", nameKey: "mega.custom", path: "/generator", group: "create" },
  // ── EDYTUJ ───────────────────────────────────────────────────────────────
  { key: "retouch", nameKey: "tools.retouch.name", path: "/retusz", group: "edit" },
  { key: "editor", nameKey: "nav.editor", path: "/tools/editor", group: "edit" },
  { key: "resize", nameKey: "nav.resize", path: "/tools/resize", group: "edit" },
  { key: "compress", nameKey: "tools.compress.name", path: "/tools/compress", group: "edit" },
  { key: "tools", nameKey: "nav.allTools", path: "/tools", group: "edit" },
  { key: "tool_upscale", nameKey: "tools.upscale.name", path: "/tools/upscale", group: "edit" },
  { key: "tool_expand", nameKey: "tools.expand.name", path: "/tools/expand", group: "edit" },
  { key: "tool_watermark", nameKey: "tools.watermark.name", path: "/tools/watermark", group: "edit" },
  // ── WIDEO ────────────────────────────────────────────────────────────────
  { key: "video", nameKey: "video.title", path: "/wideo", group: "video", defaultStatus: "COMING_SOON" },
  // ── KONTO I ZASOBY ───────────────────────────────────────────────────────
  { key: "products", nameKey: "nav.products", path: "/products", group: "account" },
  { key: "inspirations", nameKey: "nav.inspirations", path: "/inspirations", group: "account" },
  { key: "credits", nameKey: "nav.credits", path: "/credits", group: "account" },
  { key: "support", nameKey: "nav.help", path: "/support", group: "account" },
] as const;

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}

export function featureDescriptor(key: FeatureKey): FeatureDescriptor | undefined {
  return FEATURE_REGISTRY.find((f) => f.key === key);
}

/** The status a feature has before anyone touches it (§45: absent row = the
 *  registry's own default, which is ACTIVE unless stated otherwise). */
export function defaultStatusFor(key: FeatureKey): FeatureStatus {
  return featureDescriptor(key)?.defaultStatus ?? "ACTIVE";
}

export function defaultStateFor(key: FeatureKey): FeatureState {
  const status = defaultStatusFor(key);
  return status === "ACTIVE" ? ACTIVE_STATE : { ...ACTIVE_STATE, status };
}

/** Every feature at its registry default — the fallback when the table is
 *  empty OR unreadable: an availability outage must never take the product
 *  down with it. */
export function allDefaults(): AvailabilityMap {
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, defaultStateFor(k)])) as AvailabilityMap;
}

/* ── route → feature ────────────────────────────────────────────────────────*/

/**
 * Longest-prefix routing table, built from the registry itself so a new
 * feature is covered the moment it is declared. Sorted longest-first, which
 * is what makes /tools/editor win over /tools.
 */
const ROUTE_TABLE: readonly { prefix: string; key: FeatureKey }[] = FEATURE_REGISTRY
  .flatMap((f) => [f.path, ...(f.extraPaths ?? [])].map((prefix) => ({ prefix, key: f.key })))
  .sort((a, b) => b.prefix.length - a.prefix.length);

/**
 * Which feature governs a path. Query string and hash never decide anything —
 * they are stripped before matching, so no `?admin=true` can steer this.
 * null means "not a feature": settings, billing plan, auth, support pages the
 * registry deliberately leaves alone.
 */
export function featureForHref(href: string): FeatureKey | null {
  const path = href.split(/[?#]/, 1)[0] ?? "";
  for (const { prefix, key } of ROUTE_TABLE) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return key;
  }
  return null;
}

/** Which feature governs one image-tool run (the batch API takes a slug). */
export function featureForToolSlug(slug: string): FeatureKey {
  switch (slug) {
    case "editor": return "editor";
    case "format": return "resize";
    case "compress": return "compress";
    case "upscale": return "tool_upscale";
    case "expand": return "tool_expand";
    case "watermark": return "tool_watermark";
    // remove_bg / white_bg / shadow are sections of the editor, not screens.
    case "remove_bg": case "white_bg": case "shadow": return "editor";
    default: return "tools";
  }
}

/* ── menu rules ─────────────────────────────────────────────────────────────*/

/** Menu visibility: DISABLED and "hidden from menu" disappear for customers;
 *  admins keep seeing everything (with a badge) so they can operate it. */
export function menuVisible(map: AvailabilityMap, href: string, isAdmin: boolean): boolean {
  const key = featureForHref(href);
  if (!key) return true;
  const state = map[key] ?? ACTIVE_STATE;
  if (isAdmin) return true;
  return state.status !== "DISABLED" && !state.hiddenFromMenu;
}

export type MenuBadge = "soon" | "maintenance" | "disabled" | null;

/** The badge a menu entry carries: Wkrótce / Prace techniczne, and for admins
 *  also "wyłączony" on entries customers cannot see. */
export function menuBadge(map: AvailabilityMap, href: string): MenuBadge {
  const key = featureForHref(href);
  if (!key) return null;
  const status = (map[key] ?? ACTIVE_STATE).status;
  if (status === "COMING_SOON") return "soon";
  if (status === "MAINTENANCE") return "maintenance";
  if (status === "DISABLED") return "disabled";
  return null;
}

/** Does a menu GROUP still have anything to show? An empty "WIDEO" heading
 *  with nothing under it is worse than no heading at all. */
export function groupHasVisible(
  map: AvailabilityMap,
  hrefs: readonly string[],
  isAdmin: boolean,
): boolean {
  return hrefs.some((href) => menuVisible(map, href, isAdmin));
}
