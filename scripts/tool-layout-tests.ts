/**
 * /tools ORGANISED BY THE CATALOGUE LAYOUT — the brief's validation list.
 *
 *   A  the sections, their order and their headings
 *   B  what each section holds, in order, under the names the brief uses
 *   C  Matching sits in E-commerce AND Moda — one item, one route, one engine
 *   D  the old groupings are gone; nothing they held was deleted
 *   E  the admin's changes (order, sections, placements) survive the round
 *      trip through `normalizeLayout`, and a stored layout can never lose an
 *      item or invent one
 *   F  the three switches are independent: each moves exactly its own surface
 *   G  "Wkrótce" is still shown with its badge; DISABLED still hides
 *   H  the gates and routes are the ones the tools always had
 *   I  the defaults change nothing the customer had outside /tools: the menu
 *      column, the generator button and the Start page are as before
 *   J  the storage contract: admin-only writes, conflict check, no second list
 *
 * The browser half (every width, no overflow) is scripts/tools-hub-probe.mjs
 * (/tools) and scripts/tools-panel-probe.mjs (the admin screens).
 *
 * Run: npm run test:catalogue
 */
import fs from "node:fs";
import {
  ACTIVE_STATE, allDefaults, menuBadge, routeReachable, type AvailabilityMap, type FeatureKey,
  type FeatureState,
} from "@/lib/features";
import { CATEGORIES, categoryPath, offeredWorkflows } from "@/lib/categories";
import { CATALOG_ITEMS, TOOL_SECTIONS, catalogItem, isVideoCard, majorityVideo } from "@/lib/tool-cards";
import { MEDIA_SLOTS, toolSlotKey } from "@/lib/media-slots";
import { PHOTO_THUMB_RATIO, VIDEO_THUMB_RATIO, thumbRatio } from "@/components/tools/tool-thumb";
import {
  DEFAULT_LAYOUT, HUB_SECTIONS, LAYOUT_SECTIONS, MENU_DEFAULT, hubSectionsFor, itemBadge, itemLabelKey,
  menuItemKeys, normalizeLayout, placementsOf, sectionKeyFor, startExtras, unplacedItems,
  type ToolsLayout,
} from "@/lib/tool-layout";
import { IMAGE_EDIT, editEntriesFor, menuShowsGenerator } from "@/lib/topnav";
import { homeModel } from "@/lib/home-sections";
import { CHIPS, EFFECTS, RAIL, VIDEO_ROW } from "@/lib/home-picks";
import pl from "@/lib/i18n/dictionaries/pl.json";
import { makeT } from "@/lib/i18n/t";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : `\n       ${detail}`}`);
}
const read = (f: string) => fs.readFileSync(f, "utf8");
const t = makeT(pl as never);

function board(over: Partial<Record<FeatureKey, Partial<FeatureState>>> = {}): AvailabilityMap {
  const map = allDefaults();
  for (const k of Object.keys(map) as FeatureKey[]) map[k] = { ...map[k], status: "ACTIVE" };
  for (const [k, v] of Object.entries(over) as [FeatureKey, Partial<FeatureState>][]) {
    map[k] = { ...(map[k] ?? ACTIVE_STATE), ...v };
  }
  return map;
}
const LIVE = board();
const clone = (l: ToolsLayout): ToolsLayout => JSON.parse(JSON.stringify(l));
const arranged = (fn: (l: ToolsLayout) => void): ToolsLayout => { const l = clone(DEFAULT_LAYOUT); fn(l); return l; };
const names = (l: ToolsLayout, key: string, avail: AvailabilityMap = LIVE) =>
  hubSectionsFor(avail, false, l).find((s) => s.key === key)?.cards.map((c) => t(c.titleKey)) ?? [];
const keysOn = (l: ToolsLayout, avail: AvailabilityMap = LIVE) =>
  new Set(hubSectionsFor(avail, false, l).flatMap((s) => s.cards.map((c) => c.key)));

/* ── A ─────────────────────────────────────────────────────────────────── */
console.log("A. the sections, in the order the brief set");
{
  const titles = hubSectionsFor(LIVE, false).map((s) => t(s.titleKey));
  check("Generowanie obrazów · E-commerce · Moda · Przygotowanie plików · Inne · Social Media · Mailing · Wideo AI",
    titles.join(" · ") === "Generowanie obrazów · E-commerce · Moda · Przygotowanie plików · Inne · Social Media · Mailing · Wideo AI",
    titles.join(" · "));
  check("the default layout and the shipped sections agree", DEFAULT_LAYOUT.sections.map((s) => s.key).join()
    === LAYOUT_SECTIONS.map((s) => s.key).join() && HUB_SECTIONS.length === LAYOUT_SECTIONS.length);
  check("every section starts visible", DEFAULT_LAYOUT.sections.every((s) => s.visible));
}

/* ── B ─────────────────────────────────────────────────────────────────── */
console.log("\nB. what each section holds, in order, under the brief's names");
{
  const expected: Record<string, string[]> = {
    generate: ["Generator GrovBase", "Własny prompt"],
    ecommerce: ["Retusz zdjęć", "Usuń tło", "Zmień kolor tła", "Dodaj tło AI", "Dodaj cień", "Miniaturka", "Matching"],
    moda: ["Niewidzialny manekin", "Leżący produkt", "Wyprasuj", "Zmiana postaci", "Zmiana twarzy modela", "Sesja zewnątrz", "Matching"],
    prepare: ["Zmiana rozmiaru", "Kompresja", "Rozszerz kadr AI", "Watermark"],
    inne: ["Etykieta", "Opakowanie", "Ulotka", "Piktogramy"],
    social: ["Post na feed", "Reklama", "UGC", "Karuzela"],
  };
  for (const [key, want] of Object.entries(expected)) {
    const got = names(DEFAULT_LAYOUT, key);
    check(`${key}: ${want.join(", ")}`, got.join("|") === want.join("|"), got.join(", "));
  }
  const mailing = CATEGORIES.find((c) => c.key === "mailing")!;
  check("Mailing: exactly what it held before (its offered workflows, in order)",
    DEFAULT_LAYOUT.sections.find((s) => s.key === "mailing")!.items.join()
      === offeredWorkflows(mailing).map((w) => `mailing.${w.key}`).join());
  check("Wideo AI: exactly what it held before (the video cards, in order)",
    DEFAULT_LAYOUT.sections.find((s) => s.key === "video")!.items.join()
      === (TOOL_SECTIONS.find((s) => s.key === "video")?.cards ?? []).map((c) => c.key).join());
  check("every placed key is an existing catalogue item (nothing new was invented)",
    DEFAULT_LAYOUT.sections.every((s) => s.items.every((k) => catalogItem(k) !== undefined)));
  check("„Zmiana koloru produktu” does not exist in the product, so it was not invented",
    !CATALOG_ITEMS.some((c) => /kolor[a-z]* produktu/i.test(t(itemLabelKey(c)))));
  check("the only new card is „Własny prompt” — the existing /generator screen, given a door on /tools",
    catalogItem("custom")?.href === "/generator" && fs.existsSync("app/(app)/generator/page.tsx"));
}

/* ── C ─────────────────────────────────────────────────────────────────── */
console.log("\nC. Matching: two placements, one tool");
{
  const where = placementsOf(DEFAULT_LAYOUT, "matching");
  check("placed in E-commerce and in Moda", where.join() === "ecommerce,moda");
  const cards = hubSectionsFor(LIVE, false).flatMap((s) => s.cards.filter((c) => c.key === "matching"));
  check("both cards are the same item: same key, route and gate",
    cards.length === 2 && cards.every((c) => c.href === "/k/matching" && JSON.stringify(c.gates) === JSON.stringify(["/k/matching"])));
  check("…so they answer to the same switch (image_matching) — one engine, not a copy",
    cards.every((c) => menuBadge(board({ image_matching: { status: "MAINTENANCE" } }), c.gates ?? c.href) === "maintenance"));
  const off = arranged((l) => { l.flags.matching.tools = false; });
  check("one /tools switch for both placements", !keysOn(off).has("matching"));
  const once = arranged((l) => { l.sections.find((s) => s.key === "moda")!.items = l.sections.find((s) => s.key === "moda")!.items.filter((k) => k !== "matching"); });
  check("removing it from Moda leaves it in E-commerce", placementsOf(once, "matching").join() === "ecommerce"
    && keysOn(once).has("matching"));
  check("an old ?category=matching link opens the first section holding it",
    sectionKeyFor("matching", hubSectionsFor(LIVE, false)) === "ecommerce"
    && sectionKeyFor("matching", hubSectionsFor(LIVE, false, arranged((l) => {
      l.sections.find((s) => s.key === "ecommerce")!.visible = false;
    }))) === "moda");
}

/* ── D ─────────────────────────────────────────────────────────────────── */
console.log("\nD. the old groupings are gone; nothing was deleted");
{
  const keys = hubSectionsFor(LIVE, false).map((s) => s.key);
  check("no „Edycja obrazu”, „Kompozycja i generowanie” or „Matching” section",
    !keys.includes("edit") && !keys.includes("create") && !keys.includes("matching"));
  const aside = unplacedItems(DEFAULT_LAYOUT);
  check("what the brief did not list is kept aside — still an item, with its route and switches",
    aside.length > 0 && aside.every((k) => catalogItem(k) && DEFAULT_LAYOUT.flags[k] !== undefined));
  check("…including the tools of the old groupings (Białe tło, Upscale, Edycja obrazu…)",
    ["white_bg", "upscale", "editor", "relight", "ai_shadow", "adjust"].every((k) => aside.includes(k)));
  check("…and an admin can put any of them back",
    keysOn(arranged((l) => { l.sections[0].items.push("upscale"); })).has("upscale"));
}

/* ── E ─────────────────────────────────────────────────────────────────── */
console.log("\nE. an admin's layout survives storage, and storage cannot break it");
{
  const custom = arranged((l) => {
    l.sections.reverse();
    l.sections[1].items.reverse();
    l.sections[2].visible = false;
    l.sections[0].items.push("upscale");
  });
  const round = normalizeLayout(JSON.parse(JSON.stringify(custom)));
  check("section order, item order, visibility and placements round-trip exactly",
    JSON.stringify(round) === JSON.stringify(custom));
  check("nothing stored → the shipped default", JSON.stringify(normalizeLayout(null)) === JSON.stringify(DEFAULT_LAYOUT)
    && JSON.stringify(normalizeLayout("garbage")) === JSON.stringify(DEFAULT_LAYOUT)
    && JSON.stringify(normalizeLayout({ sections: 7, flags: [] })) === JSON.stringify(DEFAULT_LAYOUT));
  // A store that knew every item but two (retouch, compress: "new in the code").
  const knownFlags: Record<string, unknown> = { ...DEFAULT_LAYOUT.flags, resize: { tools: false }, "made.up": { tools: true, menu: true, start: true } };
  delete knownFlags.retouch;
  delete knownFlags.compress;
  const dirty = normalizeLayout({
    sections: [
      { key: "ecommerce", visible: true, items: ["remove_bg"] },
      { key: "moda", visible: true, items: ["moda.iron", "moda.iron", "made.up", 42, "matching"] },
      { key: "nope", visible: true, items: ["resize"] },
      { key: "moda", visible: false, items: [] },
      { key: "prepare", visible: true, items: ["resize"] },
    ],
    flags: knownFlags,
  });
  check("unknown sections and items are dropped, duplicates collapse",
    dirty.sections.find((s) => s.key === "moda")!.items.join() === "moda.iron,matching"
    && !dirty.sections.some((s) => s.key === "nope") && !("made.up" in dirty.flags)
    && dirty.sections.filter((s) => s.key === "moda").length === 1);
  check("a section the store predates takes its default place",
    dirty.sections.map((s) => s.key).join() === "generate,ecommerce,moda,prepare,inne,social,mailing,video",
    dirty.sections.map((s) => s.key).join());
  check("a partial flag entry keeps the default for the flags it does not name",
    dirty.flags.resize.tools === false && dirty.flags.resize.menu === true && dirty.flags.resize.start === false);
  check("an item the store never knew lands where the default places it (never vanishes on deploy)",
    dirty.sections.find((s) => s.key === "prepare")!.items.join() === "resize,compress"
    && dirty.sections.find((s) => s.key === "ecommerce")!.items.join() === "remove_bg,retouch");
  const removed = normalizeLayout(arranged((l) => { l.sections.find((s) => s.key === "prepare")!.items = ["resize"]; }));
  check("an item an admin took out stays out (it has flags, so the store knew it)",
    !removed.sections.some((s) => s.items.includes("compress")) && unplacedItems(removed).includes("compress"));
  check("every catalogue item always has flags", CATALOG_ITEMS.every((c) => dirty.flags[c.key] !== undefined));
  const hiddenSec = arranged((l) => { l.sections.find((s) => s.key === "social")!.visible = false; });
  check("a hidden section is not drawn, and keeps every item placed in it",
    !hubSectionsFor(LIVE, false, hiddenSec).some((s) => s.key === "social")
    && normalizeLayout(hiddenSec).sections.find((s) => s.key === "social")!.items.length === 4);
  check("a section left with nothing is not drawn", !hubSectionsFor(LIVE, false,
    arranged((l) => { l.sections.find((s) => s.key === "inne")!.items = []; })).some((s) => s.key === "inne"));
}

/* ── F ─────────────────────────────────────────────────────────────────── */
console.log("\nF. three independent switches — each moves only its own surface");
{
  const surfaces = (l: ToolsLayout, key: string) => {
    const m = homeModel(LIVE, false, l);
    return {
      tools: keysOn(l).has(key),
      menu: editEntriesFor(menuItemKeys(l)).some((e) => e.key === key) || (key === "generator" && menuShowsGenerator(menuItemKeys(l))),
      start: [...m.rail, ...m.chips, ...m.effects, ...m.video].some((c) => c.key === key),
    };
  };
  for (const key of ["compress", "retouch", "resize", "generator", "moda.iron", "expand"]) {
    const base = surfaces(DEFAULT_LAYOUT, key);
    for (const f of ["tools", "menu", "start"] as const) {
      const flipped = arranged((l) => { l.flags[key] = { ...l.flags[key], [f]: !l.flags[key][f] }; });
      const after = surfaces(flipped, key);
      const moved = (["tools", "menu", "start"] as const).filter((s) => after[s] !== base[s]);
      check(`${key}: flipping „${f}” moves ${f} and nothing else`, moved.join() === f,
        `moved: ${moved.join() || "nothing"} · before ${JSON.stringify(base)} after ${JSON.stringify(after)}`);
    }
  }
  const flipped = arranged((l) => { l.flags.compress.tools = false; });
  check("…and never another item's flags", Object.keys(DEFAULT_LAYOUT.flags).every((k) => k === "compress"
    || JSON.stringify(flipped.flags[k]) === JSON.stringify(DEFAULT_LAYOUT.flags[k])));
  check("an item switched onto Start that no curated row names joins „Wybierz efekt”",
    startExtras(arranged((l) => { l.flags.expand.start = true; })).join() === "expand"
    && homeModel(LIVE, false, arranged((l) => { l.flags.expand.start = true; })).effects.some((c) => c.key === "expand"));
  check("the menu's tool column never carries the generator (it is the panel's button)",
    !editEntriesFor(menuItemKeys(DEFAULT_LAYOUT)).some((e) => e.key === "generator"));
}

/* ── G ─────────────────────────────────────────────────────────────────── */
console.log("\nG. „Wkrótce” is shown with its badge; DISABLED still hides");
{
  const soon = board({ fashion_iron: { status: "COMING_SOON" } });
  const iron = hubSectionsFor(soon, false).find((s) => s.key === "moda")!.cards.find((c) => c.key === "moda.iron");
  check("a „Wkrótce” tool stays listed, badged", Boolean(iron) && menuBadge(soon, iron!.gates ?? iron!.href) === "soon"
    && itemBadge(soon, catalogItem("moda.iron")!) === "soon");
  check("…and its route still opens (onto the Wkrótce screen)", routeReachable(soon, "/k/moda/iron", false));
  check("an item with no engine (Matching, Wideo) is badged whatever its status says",
    itemBadge(LIVE, catalogItem("matching")!) === "soon" && itemBadge(LIVE, catalogItem("video_ugc")!) === "soon");
  const off = board({ fashion_iron: { status: "DISABLED" } });
  check("a DISABLED tool is gone for a customer, whatever the layout says", !keysOn(DEFAULT_LAYOUT, off).has("moda.iron"));
  check("…while an admin still sees it to switch it back",
    hubSectionsFor(off, true).some((s) => s.cards.some((c) => c.key === "moda.iron")));
  check("a DISABLED category takes its section; „Wkrótce” keeps it, badged",
    !hubSectionsFor(board({ image_social: { status: "DISABLED" } }), false).some((s) => s.key === "social")
    && hubSectionsFor(board({ image_social: { status: "COMING_SOON" } }), false).some((s) => s.key === "social"));
  const noEco = hubSectionsFor(board({ image_ecommerce: { status: "DISABLED" } }), false)
    .find((s) => s.key === "ecommerce")?.cards.map((c) => c.key) ?? [];
  check("…but only what it governs: E-commerce switched off keeps the editing tools placed there",
    noEco.join() === "retouch,remove_bg,background,ai_background,shadow,matching", noEco.join());
  const gate = read("components/feature-gate.tsx");
  check("FeatureGate is untouched by the layout (it never reads it)", !/tool-layout|tools_layout/.test(gate));
}

/* ── H ─────────────────────────────────────────────────────────────────── */
console.log("\nH. the routes are the ones the tools always had");
{
  // Every destination the brief names, as it was on the day this shipped.
  const ROUTES: Record<string, string> = {
    generator: "/prompts", custom: "/generator", retouch: "/retusz",
    remove_bg: "/tools/editor?tool=remove-background", background: "/tools/editor?tool=background",
    ai_background: "/tools/ai_background", shadow: "/tools/editor?tool=shadow",
    "ecommerce.thumbnail": "/k/ecommerce/thumbnail", matching: "/k/matching",
    "moda.ghostMannequin": "/k/moda/ghostMannequin", "moda.flatlay": "/k/moda/flatlay", "moda.iron": "/k/moda/iron",
    "moda.changePerson": "/k/moda/changePerson", "moda.changeFace": "/k/moda/changeFace", "moda.street": "/k/moda/street",
    resize: "/tools/resize", compress: "/tools/compress", expand: "/tools/expand", watermark: "/tools/watermark",
    "inne.label": "/k/inne/label", "inne.packaging": "/k/inne/packaging", "inne.leaflet": "/k/inne/leaflet",
    "inne.icons": "/k/inne/icons", "social.feed": "/k/social/feed", "social.ads": "/k/social/ads",
    "social.ugc": "/k/social/ugc", "social.carousel": "/k/social/carousel",
  };
  const wrong = Object.entries(ROUTES).filter(([k, href]) => catalogItem(k)?.href !== href);
  check("every item the brief names opens the route it always opened", wrong.length === 0,
    wrong.map(([k]) => `${k}→${catalogItem(k)?.href}`).join(", "));
  check("a card on /tools is the catalogue item itself — only the label may differ",
    hubSectionsFor(LIVE, true).every((s) => s.cards.every((c) => {
      const item = catalogItem(c.key)!;
      return c.href === item.href && c.gates === item.gates && c.slug === item.slug && c.soon === item.soon;
    })));
  const moda = CATEGORIES.find((c) => c.key === "moda")!;
  check("„Sesja zewnątrz” is the existing Moda preset, whose screen still resolves",
    moda.workflows.some((w) => w.key === "street" && !w.soon) && catalogItem("moda.street")?.href === `${categoryPath(moda)}/street`);
}

/* ── I ─────────────────────────────────────────────────────────────────── */
console.log("\nI. the defaults change nothing outside /tools");
{
  check("the menu's tool column is exactly what it was",
    editEntriesFor(menuItemKeys(DEFAULT_LAYOUT)).map((e) => e.href).join() === IMAGE_EDIT.map((e) => e.href).join());
  check("…and the generator button is still there", menuShowsGenerator(menuItemKeys(DEFAULT_LAYOUT)));
  check("only the menu's own entries start with their menu switch on",
    CATALOG_ITEMS.filter((c) => DEFAULT_LAYOUT.flags[c.key].menu).map((c) => c.key).sort().join()
      === [...MENU_DEFAULT].filter((k) => catalogItem(k)).sort().join());
  const m = homeModel(LIVE, false, DEFAULT_LAYOUT);
  const resolved = (row: { key: string }[]) => row.map((c) => c.key).join();
  check("Start's rail, chips, effects and video row are the curated picks, as before",
    resolved(m.rail) === RAIL.join() && resolved(m.chips) === CHIPS.join()
    && resolved(m.effects) === EFFECTS.join() && resolved(m.video) === VIDEO_ROW.join(),
    `${resolved(m.rail)} | ${resolved(m.effects)}`);
  check("nothing extra is appended to Start by default", startExtras(DEFAULT_LAYOUT).length === 0);
}

/* ── J ─────────────────────────────────────────────────────────────────── */
console.log("\nJ. the storage contract");
{
  const actions = read("app/actions/tool-layout.ts");
  check("every write is admin-checked and normalised",
    actions.includes('profile?.role !== "admin"') && (actions.match(/normalizeLayout\(/g) ?? []).length >= 2);
  check("a save refuses to overwrite a newer stored version — in the write itself, not a check before it",
    /\.eq\("updated_at", base\)/.test(actions) && /error\.code === "23505" \? "conflict"/.test(actions)
    && /writeIf\(supabase, layout, baseUpdatedAt\)/.test(actions));
  check("a failed read is a failure, never the default written over the stored layout",
    /if \(!current\.ok\) return \{ ok: false, error: "generic" \}/.test(actions));
  check("each write is audited", ["tools_layout.saved", "tools_layout.flags", "tools_layout.reset"].every((a) => actions.includes(a)));
  // Code only — the comments name those things to say they are not touched.
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check("the layout never touches what a tool does",
    !/ai_tools|service_catalog|prompt_versions|credit|feature_availability|stripe/i.test(
      code(actions + read("lib/tool-layout.ts") + read("lib/server/tool-layout.ts"))));
  check("the raw settings editor cannot write it, nor list it",
    read("app/actions/admin.ts").includes("if (key === TOOLS_LAYOUT_KEY) return")
    && read("app/admin/system/page.tsx").includes("s.key !== TOOLS_LAYOUT_KEY"));
  check("no migration was needed: it is a row of app_settings (public read, admin write)",
    !fs.readdirSync("supabase/migrations").some((f) => read(`supabase/migrations/${f}`).includes("tools_layout")));
  const surfaces = ["app/(app)/tools/page.tsx", "app/(app)/layout.tsx", "components/home/product-surface.tsx"];
  check("/tools, the app menus and Start all read the one stored layout",
    surfaces.every((f) => /getToolsLayout\(supabase\)/.test(read(f))));
  check("no component keeps a list of tools of its own for /tools",
    !/"moda\.iron"|"ecommerce\.thumbnail"/.test(read("app/(app)/tools/page.tsx") + read("components/tools/tools-catalogue.tsx")
      + read("components/layout/mega-topbar.tsx") + read("components/layout/customer-drawer.tsx")));
}

/* ── K ─────────────────────────────────────────────────────────────────── */
console.log("\nK. two thumbnail frames on Start and /tools: the 2336×1744 photo, 9:16 video — asset always whole");
{
  const thumb = read("components/tools/tool-thumb.tsx");
  const art = read("components/home/card-art.tsx");
  const cards = read("components/home/product-cards.tsx");
  const home = read("components/home/product-home.tsx");
  const catalogue = read("components/tools/tools-catalogue.tsx");
  const gallery = read("components/home/home-gallery.tsx");
  const banner = read("components/home/grovshot-banner.tsx");
  const skeleton = read("app/(app)/home/loading.tsx");
  const slotMedia = read("components/media/slot-media.tsx");
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  check("the photo frame is exactly the assets' 2336×1744, the video frame 9:16",
    PHOTO_THUMB_RATIO === "2336/1744" && VIDEO_THUMB_RATIO === "9/16"
    && thumbRatio(false) === PHOTO_THUMB_RATIO && thumbRatio(true) === VIDEO_THUMB_RATIO);
  check("ToolThumb (every placeholder) paints thumbRatio(video) and takes no free ratio",
    thumb.includes("aspectRatio: thumbRatio(video)") && !/\bratio\??:/.test(code(thumb)));
  check("CardArt and its shipped photo paint the row's frame; GalleryArt its own (video = UGC)",
    (code(art).match(/thumbRatio\(vertical\)/g) ?? []).length === 2 && (code(art).match(/thumbRatio\(video\)/g) ?? []).length === 1
    && /ToolThumb[^>]*video=\{vertical\}/.test(code(art)) && !/\bratio\??:/.test(code(art))
    && !/<CardArt[^>]*ratio=/.test(cards) && !/<EffectCard[^>]*ratio=/.test(home)
    && !/<GalleryArt[^>]*ratio=/.test(gallery));
  check("a row has ONE shape — its majority's: majorityVideo",
    majorityVideo([true, true, true]) && majorityVideo([true, true, false]) && !majorityVideo([true, false, false, false, false, false])
    && !majorityVideo([true, false]) && !majorityVideo([]));
  check("each Start row (rail, Wybierz efekt, Wideo) passes its majority to every card",
    /vertical=\{majorityVideo\(rail\.map/.test(home) && /vertical=\{majorityVideo\(effects\.map/.test(home)
    && /vertical=\{majorityVideo\(video\.map/.test(home) && /vertical=\{vertical\}/.test(cards));
  check("with the shipped layout: the rail and Wybierz efekt are photo rows, the Wideo row is vertical",
    (() => { const m = homeModel(allDefaults(), false);
      return !majorityVideo(m.rail.map((c) => c.video)) && !majorityVideo(m.effects.map((c) => c.video))
        && m.video.length > 0 && majorityVideo(m.video.map((c) => c.video)); })());
  check("/tools: each section passes its majority; picture and placeholder paint it",
    catalogue.includes("vertical={majorityVideo(s.cards.map((x) => isVideoCard(x.key)))}")
    && catalogue.includes("ratio={thumbRatio(vertical)}")
    && (code(catalogue).match(/<ToolThumb[^>]*video=\{vertical\}/g) ?? []).length === 2);
  check("with the shipped layout only /tools → Wideo AI is vertical",
    hubSectionsFor(allDefaults(), false).every((sec) => majorityVideo(sec.cards.map((c) => isVideoCard(c.key))) === (sec.key === "video")));
  check("a video tool is a `video_` card, and only those: exactly the Wideo AI section",
    TOOL_SECTIONS.flatMap((sec) => sec.cards).every((c) => isVideoCard(c.key) === (TOOL_SECTIONS.find((sec) => sec.key === "video")?.cards.includes(c) ?? false))
    && (TOOL_SECTIONS.find((sec) => sec.key === "video")?.cards.length ?? 0) > 0);
  check("the Start marks video cards with the same test",
    read("lib/home-sections.ts").includes("video: isVideoCard(c.key)"));
  check("the Wideo UGC clips are video tiles; Packshoty and Reklamy are photo tiles",
    /<GalleryArt slot=\{HOME_SLOT\.ugc\(n\)\}[^>]*\bvideo\b/.test(gallery)
    && !/<GalleryArt slot=\{HOME_SLOT\.(packshot|ad)\(n\)\}[^>]*\bvideo\b/.test(gallery));

  check("every picture is shown WHOLE: each SlotMedia on Start and /tools passes `whole`",
    [art, catalogue].every((src) => (code(src).match(/<SlotMedia\b[^>]*>/g) ?? []).every((tag) => /\bwhole\b/.test(tag)))
    && (code(art).match(/<SlotMedia\b/g) ?? []).length === 2 && (code(catalogue).match(/<SlotMedia\b/g) ?? []).length === 1);
  check("`whole` contains the picture (never cover/crop) over a blurred copy of it",
    /whole\s*\?\s*\{ objectFit: "contain", objectPosition: "center" \}/.test(slotMedia)
    && /fit=\{whole \? "contain" : config\.fit\}/.test(slotMedia) && slotMedia.includes("blur-xl"));
  check("without `whole` every other surface renders as before (the slot's own fit)",
    slotMedia.includes("whole = false") && slotMedia.includes("{ objectFit: config.fit, objectPosition: config.position }"));
  check("the shipped example photos are contained too (card tiles and the GrovShot frames)",
    art.includes('className="object-contain"') && !/className="object-cover"\s*\/>/.test(code(art).replace(/blur-xl[^"]*"/g, ""))
    && banner.includes("aspectRatio: PHOTO_THUMB_RATIO") && banner.includes("<WholeImage"));
  check("the Start skeleton reserves photo frames (2336/1744)",
    skeleton.includes("aspect-[2336/1744]") && !/aspect-\[(5\/4|16\/9|4\/5|1\/1|16\/10)\]/.test(skeleton));
  check("no other shape is left on a Start or /tools thumbnail",
    ![art, cards, home, catalogue, gallery, banner, skeleton, thumb].some((src) => /["\[](5\/4|1\/1|4\/5|16\/9|16\/10)["\]]/.test(code(src))));

  const cardSlots = MEDIA_SLOTS.filter((d) => d.slotName === "card" && d.entityType !== "section");
  check("every tool / workflow / category card's admin frame is its card's frame",
    cardSlots.length > 30 && cardSlots.every((d) =>
      d.ratio === (d.entityType === "tool" && isVideoCard(d.entityId) ? VIDEO_THUMB_RATIO : PHOTO_THUMB_RATIO)),
    cardSlots.filter((d) => d.ratio !== PHOTO_THUMB_RATIO && !(d.entityType === "tool" && isVideoCard(d.entityId))).map((d) => d.key).join(", "));
  check("every video tool's admin frame is 9:16",
    TOOL_SECTIONS.find((sec) => sec.key === "video")!.cards.every((c) => MEDIA_SLOTS.find((d) => d.key === toolSlotKey(c.key))?.ratio === VIDEO_THUMB_RATIO));
}

console.log(failed ? `\n${failed} tool-layout test(s) failed.` : "\nAll tool-layout tests passed.");
process.exit(failed ? 1 : 0);
