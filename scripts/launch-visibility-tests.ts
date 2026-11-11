/**
 * PREMIERA — WHAT A CUSTOMER IS OFFERED, PROVEN FROM THE REAL CONFIGURATION.
 *
 * The launch visibility is DATA (migration 0172: feature_availability rows and
 * one /tools-layout flag). This test reads the DISABLED list straight out of
 * that migration, applies it over the registry defaults and production's own
 * rows (as read before the launch), and asks every surface the code draws from
 * the same switchboard:
 *
 *   A  the migration's keys are real registry keys; the launch four are not in it
 *   B  the header „Obrazy” list: a customer gets exactly Generator GrovShot,
 *      Miniaturka, Packshot, Stwórz zdjęcie — in that order, with the right
 *      routes and names; one „Wszystkie narzędzia” link
 *   C  an admin gets every row, the hidden ones marked „Ukryte”
 *   D  „Wideo” is gone for customers, kept (badged) for admins, and comes back
 *      by itself when the video switch is opened again
 *   E  /tools, the home page items (carousel, pairs, pills, tiles) and the
 *      search list only the launch tools; direct URLs of the rest are closed
 *   F  Packshot vs the old e-commerce packshot: two tools, two switches
 *   G  turning one more tool on later puts it in the menu with no code change
 *
 * Run: npm run test:launch
 */
import fs from "node:fs";
import path from "node:path";
import {
  ACTIVE_STATE, FEATURE_KEYS, allDefaults, featureForHref, isFeatureKey, menuVisible, routeReachable,
  type AvailabilityMap, type FeatureKey, type FeatureState,
} from "@/lib/features";
import { categoryGates, CATEGORIES } from "@/lib/categories";
import { CATALOG_ITEMS, catalogItem } from "@/lib/tool-cards";
import { DEFAULT_LAYOUT, hubSectionsFor, itemReachable, menuItemKeys, normalizeLayout, type ToolsLayout } from "@/lib/tool-layout";
import { ALL_TOOLS_ENTRY, imageMenuRows } from "@/lib/topnav";
import { homeModel } from "@/lib/home-sections";
import { referencedItems } from "@/lib/server/seller-home";
import { defaultHomeLayout } from "@/lib/home-layout";
import { SEARCHABLE, searchGate } from "@/lib/tool-search";
import { THUMBNAIL_PATH } from "@/lib/thumbnail/config";
import { PACKSHOT_PATH, LEGACY_RETOUCH_PATH, HELP_HREF } from "@/lib/tool-routes";
import pl from "@/lib/i18n/dictionaries/pl.json";
import { makeT } from "@/lib/i18n/t";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : `\n       ${detail}`}`);
}
const t = makeT(pl as never);
const ROOT = process.cwd();
const MIGRATION = fs.readFileSync(path.join(ROOT, "supabase/migrations/0172_launch_tool_visibility.sql"), "utf8");

/** The keys inside `unnest(array[ … ])` — comments stripped. */
const disabled: string[] = (() => {
  const body = MIGRATION.slice(MIGRATION.indexOf("from unnest(array["), MIGRATION.indexOf("]) as k"));
  return [...body.replace(/--[^\n]*/g, "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
})();

/** Production's rows before the launch (read 2026-11-11), then 0172 on top. */
const PROD_BEFORE: Readonly<Record<string, FeatureState["status"]>> = {
  compress: "ACTIVE", editor: "ACTIVE", generator: "ACTIVE", image_inne: "COMING_SOON", image_mailing: "COMING_SOON",
  image_social: "COMING_SOON", inspirations: "ACTIVE", library: "ACTIVE", products: "DISABLED", prompts: "ACTIVE",
  resize: "ACTIVE", retouch: "ACTIVE", tool_ai_background: "ACTIVE", tool_ai_shadow: "ACTIVE", tool_remove_bg: "ACTIVE",
  tool_white_bg: "ACTIVE", tools: "ACTIVE", video: "COMING_SOON",
};
function launchBoard(over: Partial<Record<FeatureKey, FeatureState["status"]>> = {}): AvailabilityMap {
  const map = allDefaults();
  const apply = (rows: Partial<Record<string, FeatureState["status"]>>) => {
    for (const [k, status] of Object.entries(rows)) if (isFeatureKey(k) && status) map[k] = { ...(map[k] ?? ACTIVE_STATE), status };
  };
  apply(PROD_BEFORE);
  apply(Object.fromEntries(disabled.map((k) => [k, "DISABLED" as const])));
  if (/values \('image_ecommerce', true, now\(\)\)/.test(MIGRATION)) map.image_ecommerce = { ...map.image_ecommerce, hiddenFromMenu: true };
  apply(over);
  return map;
}
/** Production's stored layout flags (menu ON: generator, thumbnail, retouch,
 *  editor, resize, compress, remove_bg) with 0172's `custom.menu = true`. */
const PROD_LAYOUT: ToolsLayout = (() => {
  const l = normalizeLayout(JSON.parse(JSON.stringify(DEFAULT_LAYOUT)));
  for (const k of Object.keys(l.flags)) l.flags[k] = { ...l.flags[k], menu: false };
  for (const k of ["generator", "ecommerce.thumbnail", "retouch", "editor", "resize", "compress", "remove_bg", "custom"]) {
    l.flags[k] = { ...l.flags[k], menu: true };
  }
  return l;
})();

const LAUNCH = ["generator", "ecommerce.thumbnail", "retouch", "custom"];
const MAP = launchBoard();

/* ── A ─────────────────────────────────────────────────────────────────── */
console.log("A. the migration's list");
check("every key 0172 disables is a registry key", disabled.length > 0 && disabled.every(isFeatureKey),
  disabled.filter((k) => !isFeatureKey(k)).join(", "));
check("…none twice", new Set(disabled).size === disabled.length);
check("the launch tools and the account pages are not in it",
  ["prompts", "generator", "retouch", "image_ecommerce", "ecommerce_thumbnail", "tools", "home", "library", "history", "credits", "support", "grovnews", "inspirations"]
    .every((k) => !disabled.includes(k)));
check("every other image/edit/video module is in it (nothing left over by accident)",
  FEATURE_KEYS.filter((k) => !["home", "library", "history", "prompts", "generator", "retouch", "image_ecommerce", "ecommerce_thumbnail", "tools",
    "inspirations", "credits", "support", "grovnews"].includes(k)).every((k) => disabled.includes(k)),
  FEATURE_KEYS.filter((k) => !disabled.includes(k)).join(", "));
check("it backs up the table once and only touches statuses and one flag",
  /on conflict \(key\) do nothing/.test(MIGRATION) && !/\bdelete\s+from\b(?![^\n]*--)/i.test(MIGRATION.replace(/--[^\n]*/g, ""))
  && !/\b(alter|drop|create)\s+(table|policy|function)\b/i.test(MIGRATION.replace(/--[^\n]*/g, "")));

/* ── B ─────────────────────────────────────────────────────────────────── */
console.log("\nB. the header „Obrazy” list, as a customer");
{
  const rows = imageMenuRows(MAP, false, menuItemKeys(PROD_LAYOUT));
  check("exactly four rows, in the launch order", rows.map((r) => r.entry.key).join() === LAUNCH.join(), rows.map((r) => r.entry.key).join());
  check("names: Generator GrovShot · Miniaturka · Packshot · Stwórz zdjęcie",
    rows.map((r) => t(r.entry.labelKey!)).join(" · ") === "Generator GrovShot · Miniaturka · Packshot · Stwórz zdjęcie",
    rows.map((r) => t(r.entry.labelKey!)).join(" · "));
  check("routes: /prompts (GrovShot mode) · Miniaturka · /narzedzia/packshot · /generator (Stwórz mode)",
    rows.map((r) => r.entry.href).join() === ["/prompts", THUMBNAIL_PATH, PACKSHOT_PATH, "/generator"].join());
  check("every row has a one-line description, no badge", rows.every((r) => r.entry.subKey && t(r.entry.subKey).length <= 60 && r.badge === null),
    rows.map((r) => `${r.entry.key}:${r.badge}:${r.entry.subKey && t(r.entry.subKey)}`).join(" | "));
  check("„Wszystkie narzędzia” is the one link under them", menuVisible(MAP, ALL_TOOLS_ENTRY.href, false)
    && !rows.some((r) => r.entry.href === ALL_TOOLS_ENTRY.href) && t(ALL_TOOLS_ENTRY.labelKey!) === "Wszystkie narzędzia");
  check("Pomoc goes to the contact page", HELP_HREF === "/kontakt");
}

/* ── C ─────────────────────────────────────────────────────────────────── */
console.log("\nC. the same list, as an admin");
{
  const rows = imageMenuRows(MAP, true, menuItemKeys(PROD_LAYOUT));
  check("every row the layout lists, the launch four first", rows.length === 8 && rows.slice(0, 4).map((r) => r.entry.key).join() === LAUNCH.join(),
    rows.map((r) => r.entry.key).join());
  check("the rows customers do not get say „Ukryte”, the launch rows nothing",
    rows.every((r) => (LAUNCH.includes(r.entry.key) ? r.badge === null : r.badge === "hidden")) && t("mega.hidden") === "Ukryte",
    rows.map((r) => `${r.entry.key}:${r.badge}`).join(" "));
  check("an admin can still open every hidden tool", rows.every((r) => routeReachable(MAP, r.entry.gates ?? r.entry.href, true)));
}

/* ── D ─────────────────────────────────────────────────────────────────── */
console.log("\nD. „Wideo”");
check("a customer has no video menu", !menuVisible(MAP, "/wideo", false));
check("an admin keeps it", menuVisible(MAP, "/wideo", true));
check("it comes back by itself when the switch opens again (Wkrótce or Aktywny)",
  menuVisible(launchBoard({ video: "COMING_SOON" }), "/wideo", false) && menuVisible(launchBoard({ video: "ACTIVE" }), "/wideo", false));

/* ── E ─────────────────────────────────────────────────────────────────── */
console.log("\nE. every other list, and the direct URLs");
{
  const hub = hubSectionsFor(MAP, false, PROD_LAYOUT).flatMap((s) => s.cards.map((c) => c.key));
  check("/tools lists only the launch tools", hub.length > 0 && hub.every((k) => LAUNCH.includes(k)), hub.join(", "));
  check("…all four of them", LAUNCH.every((k) => hub.includes(k)), hub.join(", "));
  const m = homeModel(MAP, false, PROD_LAYOUT);
  const startKeys = [...m.rail, ...m.chips, ...m.effects, ...m.video].map((c) => c.key);
  check("the Start rows offer only the launch tools", startKeys.every((k) => LAUNCH.includes(k)), startKeys.join(", "));
  // The seller home (carousel, before/after pairs, upload pills, tiles,
  // banners) resolves each item exactly like this (lib/server/seller-home.ts).
  const homeItems = referencedItems(defaultHomeLayout()).filter((key) => {
    if (key.startsWith("cat:")) {
      const cat = CATEGORIES.find((c) => c.key === key.slice(4));
      return Boolean(cat) && menuVisible(MAP, categoryGates(cat!), false);
    }
    const item = catalogItem(key);
    return Boolean(item) && itemReachable(MAP, item!, false) && PROD_LAYOUT.flags[key]?.tools !== false;
  });
  check("the home page's tool items are only the launch tools (no category card either)",
    homeItems.length > 0 && homeItems.every((k) => LAUNCH.includes(k)), homeItems.join(", "));
  const search = SEARCHABLE.filter((e) => routeReachable(MAP, searchGate(e.href), false) && menuVisible(MAP, searchGate(e.href), false))
    .map((e) => e.href);
  check("the search finds only the four launch tools",
    search.sort().join() === ["/prompts", "/generator", PACKSHOT_PATH, THUMBNAIL_PATH].sort().join(), search.join(", "));
  check("the E-commerce category stays open — Miniaturka lives in it", routeReachable(MAP, "/k/ecommerce", false) && routeReachable(MAP, THUMBNAIL_PATH, false));
  check("…and never a switch that is not a tool (the preview actions)", !SEARCHABLE.some((e) => e.id === "preview_actions"));
  const closed = CATALOG_ITEMS.filter((c) => !LAUNCH.includes(c.key));
  check("every other catalogue tool's URL is closed to a customer (FeatureGate → 404, API → 503)",
    closed.every((c) => !itemReachable(MAP, c, false)), closed.filter((c) => itemReachable(MAP, c, false)).map((c) => c.key).join(", "));
  check("…and open to an admin", closed.every((c) => itemReachable(MAP, c, true)));
  check("the preview's smart actions are off for customers", MAP.preview_actions.status === "DISABLED");
}

/* ── F ─────────────────────────────────────────────────────────────────── */
console.log("\nF. Packshot (formerly Retusz) and the old e-commerce packshot");
check("/narzedzia/packshot is the retouch tool's switch", featureForHref(PACKSHOT_PATH) === "retouch");
check("the old address is the legacy one (301 in next.config.mjs)", LEGACY_RETOUCH_PATH === "/retusz"
  && /source:\s*"\/retusz",\s*destination:\s*"\/narzedzia\/packshot",\s*statusCode:\s*301/.test(fs.readFileSync(path.join(ROOT, "next.config.mjs"), "utf8")));
check("/k/ecommerce/packshot keeps its own switch (ecommerce_packshot)", featureForHref("/k/ecommerce/packshot") === "ecommerce_packshot");
check("the old one is hidden from customers, the new one is not",
  !routeReachable(MAP, "/k/ecommerce/packshot", false) && routeReachable(MAP, PACKSHOT_PATH, false));
check("two catalogue items, two routes", catalogItem("retouch")?.href === PACKSHOT_PATH && catalogItem("ecommerce.packshot")?.href === "/k/ecommerce/packshot");
check("the old one is named apart in every language", ["pl", "en", "de"].every((lang) => {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, `lib/i18n/dictionaries/${lang}.json`), "utf8"));
  const tl = makeT(d);
  return tl("wf.ecommerce.packshot.name") !== tl("tools.retouch.name");
}));

/* ── G ─────────────────────────────────────────────────────────────────── */
console.log("\nG. a tool switched on later appears with no code change");
{
  const later = launchBoard({ resize: "ACTIVE" });
  const rows = imageMenuRows(later, false, menuItemKeys(PROD_LAYOUT));
  check("„Zmień rozmiar” is back in the menu, after the launch four", rows.map((r) => r.entry.key).join() === [...LAUNCH, "resize"].join(), rows.map((r) => r.entry.key).join());
  check("…and on /tools", hubSectionsFor(later, false, PROD_LAYOUT).some((s) => s.cards.some((c) => c.key === "resize")));
}

console.log(failed ? `\n${failed} LAUNCH VISIBILITY TEST(S) FAILED` : "\nAll launch visibility tests passed.");
process.exit(failed ? 1 : 0);
