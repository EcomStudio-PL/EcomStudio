/**
 * FEATURE AVAILABILITY — the central registry (C4: one list, not fifty ifs).
 *
 * Client-safe on purpose: the nav components filter and badge from this file
 * plus a plain serialisable map the (app) layout hands them. Everything that
 * touches the database or the admin role lives in
 * lib/server/feature-availability.ts.
 *
 * ONLY real product modules are listed. Login, logout, the auth confirm flow,
 * the security challenge, settings, billing and credits are NOT features and
 * can never be switched off here (C11) — they are absent from this registry,
 * and the admin actions refuse any key outside it, so there is no code path
 * that could disable them.
 */

export const FEATURE_KEYS = [
  "generator",
  "prompts",
  "video",
  "retouch",
  "editor",
  "resize",
  "compress",
  "tools",
  "products",
  "library",
  "inspirations",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type FeatureStatus = "ACTIVE" | "COMING_SOON" | "MAINTENANCE" | "DISABLED";

export const FEATURE_STATUSES: readonly FeatureStatus[] = [
  "ACTIVE", "COMING_SOON", "MAINTENANCE", "DISABLED",
];

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

/** Everything ACTIVE — the fallback when the table is empty or unreadable:
 *  an availability outage must never take the product down with it. */
export function allActive(): AvailabilityMap {
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, ACTIVE_STATE])) as AvailabilityMap;
}

export type FeatureDescriptor = {
  key: FeatureKey;
  /** i18n key of the display name (existing nav labels reused). */
  nameKey: string;
  /** The canonical page — shown in the admin tile, used for revalidation. */
  path: string;
  /** Batch group for the admin panel's bulk actions. */
  group: "create" | "edit" | "workspace";
};

export const FEATURE_REGISTRY: readonly FeatureDescriptor[] = [
  { key: "generator", nameKey: "nav.generator", path: "/generator", group: "create" },
  { key: "prompts", nameKey: "nav.prompts", path: "/prompts", group: "create" },
  { key: "video", nameKey: "video.title", path: "/wideo", group: "create" },
  { key: "retouch", nameKey: "tools.retouch.name", path: "/retusz", group: "edit" },
  { key: "editor", nameKey: "nav.editor", path: "/tools/editor", group: "edit" },
  { key: "resize", nameKey: "nav.resize", path: "/tools/resize", group: "edit" },
  { key: "compress", nameKey: "tools.compress.name", path: "/tools/compress", group: "edit" },
  { key: "tools", nameKey: "nav.tools", path: "/tools", group: "edit" },
  { key: "products", nameKey: "nav.products", path: "/products", group: "workspace" },
  { key: "library", nameKey: "nav.library", path: "/library", group: "workspace" },
  { key: "inspirations", nameKey: "nav.inspirations", path: "/inspirations", group: "workspace" },
] as const;

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}

/**
 * Which feature governs a navigation href. Prefix rules, most specific first;
 * null means "not a feature — always available" (home, settings, billing…).
 * Query string and hash never decide anything (C9: no `?admin=true` tricks —
 * they are stripped before matching).
 */
export function featureForHref(href: string): FeatureKey | null {
  const path = href.split(/[?#]/, 1)[0] ?? "";
  const rules: readonly [string, FeatureKey][] = [
    ["/tools/editor", "editor"],
    ["/tools/resize", "resize"],
    ["/tools/compress", "compress"],
    ["/tools", "tools"],
    ["/generator", "generator"],
    ["/k/", "generator"],
    ["/prompts", "prompts"],
    ["/wideo", "video"],
    ["/retusz", "retouch"],
    ["/products", "products"],
    ["/library", "library"],
    ["/history", "library"],
    ["/inspirations", "inspirations"],
  ];
  for (const [prefix, key] of rules) {
    if (path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`)) return key;
  }
  return null;
}

/** Which feature governs one image-tool run. The editor, the resize screen
 *  (tool "format") and compression are features of their own; every other
 *  catalogue tool belongs to the hub. */
export function featureForToolSlug(slug: string): FeatureKey {
  if (slug === "editor") return "editor";
  if (slug === "format") return "resize";
  if (slug === "compress") return "compress";
  return "tools";
}

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
