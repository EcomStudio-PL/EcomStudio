/**
 * /tools IS THE ONE PLACE FOR EVERY TOOL — AND THE CATEGORIES ARE ITS SECTIONS.
 *
 * The regression list for the navigation rebuild, numbered as the brief numbers
 * it (§20). Everything a browser is not needed for is proved here, from the
 * registries and the source the product runs on; what does need a browser —
 * the scroll, Back/Forward, the drawer closing — is proved by
 * scripts/tools-hub-probe.mjs against a production build.
 *
 *   1  every tool the product has is on /tools
 *   2  no tool twice (canonical key, route — never the display name)
 *   3  each category is a section holding exactly the workflows it offers
 *   4–6  Moda / E-commerce / Social in the menu → /tools?category=<slug>
 *   7  the section is opened from the URL on the server (survives refresh)
 *   8  the client follows the URL (Back/Forward)
 *   9  the drawer closes, navigates and lands on the section
 *   10 "Wkrótce" still badges
 *   11 hidden / disabled still hides — a category's link and its section obey
 *      the category's own switch as well as the hub's
 *   12 every card opens a real, existing screen
 *   13 an old /k/<slug> forwards instead of ending on a dead screen
 *   14 Media → Kategorie lists categories only
 *   15 Media → Narzędzia lists tools only — every tool slot
 *   16 the pictures already in production are all still listed, keys unchanged
 *   17 every listed slot can still be written (upload / replace)
 *   18 the slot counters add up
 *
 * Run: npm run test:toolshub
 */
import fs from "node:fs";
import path from "node:path";
import {
  CATEGORIES, CATEGORY_PARAM, categoryGates, categoryHref, categoryPath, offeredWorkflows,
  VIDEO_CREATE_WF, VIDEO_EDIT_WF,
} from "@/lib/categories";
import {
  CATEGORY_SECTIONS, HUB_CARDS, HUB_SECTIONS, TOOL_CARDS, hubSection, hubSectionsFor,
} from "@/lib/tool-cards";
import {
  FEATURE_REGISTRY, allDefaults, featureForHref, menuBadge, menuVisible,
  type AvailabilityMap, type FeatureKey, type FeatureStatus,
} from "@/lib/features";
import { IMAGE_CREATE, IMAGE_EDIT, IMAGE_EDIT_MORE, entryGate } from "@/lib/topnav";
import { TOOL_SLUGS } from "@/lib/images/tools";
import { MEDIA_SLOTS, categorySlotKey, isKnownSlot, toolSlotKey, workflowSlotKey } from "@/lib/media-slots";
import { categoryGroups, toolGroups } from "@/lib/media-groups";
import { homeModel } from "@/lib/home-sections";
import type { SlotRow } from "@/lib/services/media-slots";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : `\n       ${detail}`}`);
}
function section(title: string) { console.log(`\n${title}`); }

const read = (f: string) => fs.readFileSync(f, "utf8");
/** Comments explain history and quote removed code; they are not code. */
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const APP = "app/(app)";
function routeExists(href: string): boolean {
  const segments = (href.split(/[?#]/, 1)[0] ?? "").split("/").filter(Boolean);
  let dirs = [APP];
  for (const segment of segments) {
    const next: string[] = [];
    for (const dir of dirs) {
      const exact = path.join(dir, segment);
      if (fs.existsSync(exact)) next.push(exact);
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && /^\[.+\]$/.test(entry.name)) next.push(path.join(dir, entry.name));
      }
    }
    if (next.length === 0) return false;
    dirs = next;
  }
  return dirs.some((d) => fs.existsSync(path.join(d, "page.tsx")));
}

const withStatus = (over: Partial<Record<FeatureKey, FeatureStatus | "HIDDEN">>): AvailabilityMap => {
  const map = allDefaults();
  for (const k of Object.keys(map) as FeatureKey[]) map[k] = { ...map[k], status: "ACTIVE" };
  for (const [k, v] of Object.entries(over) as [FeatureKey, FeatureStatus | "HIDDEN"][]) {
    map[k] = v === "HIDDEN" ? { ...map[k], status: "ACTIVE", hiddenFromMenu: true } : { ...map[k], status: v };
  }
  return map;
};
const ALL_ACTIVE = withStatus({});
const keysOf = (secs: { cards: readonly { key: string }[] }[]) => secs.flatMap((s) => s.cards.map((c) => c.key));

/* ── 1 ─────────────────────────────────────────────────────────────────── */
section("1. EVERY TOOL THE PRODUCT HAS IS ON /tools");

const hubKeys = new Set(HUB_CARDS.map((c) => c.key));
const hubHrefs = new Set(HUB_CARDS.map((c) => c.href));
check("every catalogue tool is a card", TOOL_CARDS.every((c) => hubKeys.has(c.key)));
const offeredIds = CATEGORIES.flatMap((c) => offeredWorkflows(c).map((w) => `${c.key}.${w.key}`));
check("every workflow any category offers is a card",
  offeredIds.every((id) => hubKeys.has(id)), offeredIds.filter((id) => !hubKeys.has(id)).join(", "));
check("every image-tool slug the server runs has a card",
  TOOL_SLUGS.every((slug) => HUB_CARDS.some((c) => c.slug === slug
    || (slug === "editor" && c.href === "/tools/editor")
    || (slug === "white_bg" && c.href === "/tools/editor?tool=white-background")
    || (slug === "shadow" && c.href === "/tools/editor?tool=shadow"))),
  TOOL_SLUGS.filter((slug) => !HUB_CARDS.some((c) => c.slug === slug)).join(", "));
check("every entry of the EDYTUJ menu and of its 'more' list is a card",
  [...IMAGE_EDIT, ...IMAGE_EDIT_MORE].filter((e) => e.href !== "/tools").every((e) => hubHrefs.has(e.href)),
  [...IMAGE_EDIT, ...IMAGE_EDIT_MORE].filter((e) => e.href !== "/tools" && !hubHrefs.has(e.href)).map((e) => e.href).join(", "));
check("both halves of the video menu are cards (making AND editing)",
  [...VIDEO_CREATE_WF, ...VIDEO_EDIT_WF].every((w) => hubKeys.has(`video_${w.key}`)));
// Every switchable TOOL module has a door on the hub. The exclusions are
// deliberate and named: the hub itself, the categories (sections, not cards)
// and the blank-prompt mode, which the generator's own switch reaches.
const NOT_A_CARD = new Set<FeatureKey>(["tools", "generator"]);
const toolModules = FEATURE_REGISTRY.filter((f) =>
  ["image", "create", "edit", "video"].includes(f.group) && !NOT_A_CARD.has(f.key) && !f.key.startsWith("image_"));
const reached = new Set(HUB_CARDS.map((c) => featureForHref(c.href)));
check("every tool module in the switchboard is reachable from a card",
  toolModules.every((f) => reached.has(f.key)),
  toolModules.filter((f) => !reached.has(f.key)).map((f) => f.key).join(", "));
check("every category has a section", CATEGORIES.every((c) => hubSection(c.slug)?.category === c.key));

/* ── 2 ─────────────────────────────────────────────────────────────────── */
section("2. NO TOOL TWICE — BY KEY AND BY ROUTE");

check("card keys are unique across the whole hub", hubKeys.size === HUB_CARDS.length,
  HUB_CARDS.map((c) => c.key).filter((k, i, a) => a.indexOf(k) !== i).join(", "));
const liveHrefs = HUB_CARDS.filter((c) => !c.soon).map((c) => c.href);
check("no two openable cards lead to the same screen", new Set(liveHrefs).size === liveHrefs.length,
  liveHrefs.filter((h, i, a) => a.indexOf(h) !== i).join(", "));
check("section keys are unique", new Set(HUB_SECTIONS.map((s) => s.key)).size === HUB_SECTIONS.length);
check("a tool sits in exactly one section",
  HUB_CARDS.every((c) => HUB_SECTIONS.filter((s) => s.cards.some((x) => x.key === c.key)).length === 1));
check("a workflow's card key IS its media-slot entity id (one identity, not two)",
  CATEGORY_SECTIONS.flatMap((s) => s.cards).every((c) =>
    c.workflow && c.key === `${c.workflow.category}.${c.workflow.key}`
    && MEDIA_SLOTS.some((d) => d.entityType === "workflow" && d.entityId === c.key)));

/* ── 3 ─────────────────────────────────────────────────────────────────── */
section("3. EACH CATEGORY IS A SECTION OF EXACTLY ITS OFFERED WORKFLOWS");

for (const c of CATEGORIES) {
  const s = hubSection(c.slug);
  check(`${c.slug}: titled by the category, holding exactly what it offers, in order`,
    !!s && s.titleKey === `cats.${c.key}`
    && s.cards.map((x) => x.workflow?.key).join() === offeredWorkflows(c).map((w) => w.key).join());
}
check("no category is a CARD anywhere — categories are sections, not tools",
  HUB_CARDS.every((c) => !CATEGORIES.some((k) => c.href === categoryPath(k) || c.key === k.key)));
check("the retired Moda presets are not offered (hidden stays hidden)",
  ["onModel", "street", "editorial", "detail"].every((k) => !hubKeys.has(`moda.${k}`)));
check("the categories sit together, straight after the generator",
  HUB_SECTIONS.map((s) => s.key).join() ===
    ["edit", "create", ...CATEGORIES.map((c) => c.slug), "prepare", "video"].join());

/* ── 4–6 ───────────────────────────────────────────────────────────────── */
section("4–6. THE MENU'S CATEGORIES OPEN THEIR SECTION OF /tools");

for (const slug of ["moda", "ecommerce", "social"]) {
  const e = IMAGE_CREATE.find((x) => x.key === slug);
  check(`desktop menu: ${slug} → /tools?${CATEGORY_PARAM}=${slug}`,
    e?.href === `/tools?${CATEGORY_PARAM}=${slug}` && hubSection(slug) !== null);
}
check("every category in the desktop menu links to its section",
  CATEGORIES.every((c) => IMAGE_CREATE.find((e) => e.key === c.key)?.href === categoryHref(c)));
const drawer = code("components/layout/customer-drawer.tsx");
check("the mobile drawer links each category to its section, not to /k/",
  /href=\{categoryHref\(c\)\}/.test(drawer) && !/href=\{`\/k\//.test(drawer));
check("the menus keep the category entries (the menu itself did not lose them)",
  IMAGE_CREATE.length === CATEGORIES.length);
// The signed-in application and its menus. The PUBLIC product homepage
// (lib/home-sections.ts, components/home/product-*) is deliberately outside
// this: it belongs to the CMS homepage switch, production serves the launch
// page at "/" instead of it, and the brief keeps both out of scope. Its
// category links still land on the right section — through the forward (13).
const APP_NAV = ["components/layout", "components/tools", "components/category", `${APP}`,
  "lib/topnav.ts", "lib/tool-cards.ts", "lib/categories.ts", "lib/nav-active.ts", "lib/bottom-nav.ts"];
check("no link in the app or its menus still points at a category's old page",
  APP_NAV.every((p) => !grep(p, /href[=:]\s*\{?[`"]\/k\/\$\{[a-z.]+\.slug\}[`"]/)));

/* ── 7–9 ───────────────────────────────────────────────────────────────── */
section("7–9. THE URL IS THE STATE: REFRESH, BACK/FORWARD, DRAWER");

const page = code(`${APP}/tools/page.tsx`);
check("7: the server reads ?category= and renders that section active",
  /query\[CATEGORY_PARAM\]/.test(page) && /active:\s*s\.key === wanted/.test(page));
const catalogue = code("components/tools/tools-catalogue.tsx");
check("7: every section carries its key as its anchor, clear of the sticky bar",
  /id=\{s\.key\}/.test(catalogue) && /scroll-mt-\[calc\(var\(--header-h\)/.test(catalogue));
const deep = code("components/tools/tools-deep-link.tsx");
check("8: the client follows the URL param (so history moves the view)",
  /useSearchParams\(\)\.get\(CATEGORY_PARAM\)/.test(deep) && /\[target, known\]/.test(deep));
check("8: no timers — the reveal runs off the committed page, not a delay",
  !/setTimeout|setInterval/.test(deep));
check("8: a link to the section you are already on is answered too — before the router",
  /addEventListener\("click", onClick, true\)/.test(deep) && /e\.preventDefault\(\);\s*reveal\(wanted/.test(deep));
check("9: a drawer category tile closes the drawer as it navigates",
  /href=\{categoryHref\(c\)\}[\s\S]{0,200}onNavigate=\{closeNav\}/.test(drawer));
check("9: a category link does not let the router jump to the page top first",
  /scroll=\{false\} label=\{t\(`cats\./.test(drawer)
  && /scroll=\{entry\.match \? false : undefined\}/.test(code("components/layout/mega-topbar.tsx"))
  && IMAGE_CREATE.every((e) => e.match === categoryPath(CATEGORIES.find((c) => c.key === e.key)!)));
check("9: the desktop panel closes when one of its links is followed",
  /onNavigate=\{close\}/.test(code("components/layout/mega-topbar.tsx")));
check("an unknown ?category= opens nothing (no crash, top of the hub)",
  hubSection("nope") === null && hubSection(null) === null && hubSection("") === null);

/* ── 10 ────────────────────────────────────────────────────────────────── */
section("10. „WKRÓTCE” STILL BADGES");

const DEFAULTS = allDefaults();
for (const c of CATEGORIES.filter((k) => ["social", "mailing", "inne", "matching"].includes(k.key))) {
  check(`${c.slug}: its menu link carries the "soon" badge by default`,
    menuBadge(DEFAULTS, categoryGates(c)) === "soon");
  check(`${c.slug}: every card in its section is badged "soon" by default`,
    (hubSection(c.slug)?.cards ?? []).every((x) => x.soon || menuBadge(DEFAULTS, x.gates ?? x.href) === "soon"));
}
check("a Moda tool still answers to its OWN switch ('Wkrótce' while Moda is live)",
  menuBadge(withStatus({ fashion_iron: "COMING_SOON" }), hubSection("moda")!.cards.find((x) => x.key === "moda.iron")!.gates!) === "soon"
  && menuBadge(ALL_ACTIVE, hubSection("moda")!.cards.find((x) => x.key === "moda.iron")!.gates!) === null);
check("…and to its category's (a Moda tool under a 'Wkrótce' Moda is 'Wkrótce')",
  menuBadge(withStatus({ image_moda: "COMING_SOON" }), hubSection("moda")!.cards[0].gates!) === "soon");
check("the most closed switch wins the badge",
  menuBadge(withStatus({ image_moda: "MAINTENANCE", fashion_iron: "COMING_SOON" }), ["/k/moda", "/k/moda/iron"]) === "maintenance");
check("matching (no engine) is badged on every card whatever the switch says",
  hubSection("matching")!.cards.every((x) => x.soon));
const toolsPage = code(`${APP}/tools/page.tsx`);
check("an operator's own words on a restricted category travel to its section",
  /note: s\.category \? noteFor\(s\.gates\) : null/.test(toolsPage)
  && /state\.customTitle, state\.customMessage, reopens/.test(toolsPage)
  && /data-tools-note/.test(catalogue));
check("the catalogue card reads the badge through the card's gates",
  /menuBadge\(avail, gate\)/.test(catalogue) && /card\.gates \?\? card\.href/.test(catalogue));

/* ── 11 ────────────────────────────────────────────────────────────────── */
section("11. HIDDEN / DISABLED STILL HIDES — NO FLAG IS BYPASSED");

const noSocial = withStatus({ image_social: "DISABLED" });
check("a DISABLED category loses its section for a customer",
  !hubSectionsFor(noSocial, false).some((s) => s.key === "social"));
check("…and its menu link", !menuVisible(noSocial, categoryGates(CATEGORIES.find((c) => c.key === "social")!), false));
check("…while an admin keeps both, to operate it",
  hubSectionsFor(noSocial, true).some((s) => s.key === "social")
  && menuVisible(noSocial, categoryGates(CATEGORIES.find((c) => c.key === "social")!), true));
const hidden = withStatus({ image_ecommerce: "HIDDEN" });
check("a category hidden from the menu is hidden from the hub too",
  !hubSectionsFor(hidden, false).some((s) => s.key === "ecommerce"));
const noHub = withStatus({ tools: "DISABLED" });
check("a category link is not offered when the hub it opens is switched off",
  CATEGORIES.every((c) => !menuVisible(noHub, categoryGates(c), false)));
check("the query string never steers the route table (the hub stays 'tools')",
  featureForHref(categoryHref(CATEGORIES[0])) === "tools");
const noIron = withStatus({ fashion_iron: "DISABLED" });
check("a DISABLED Moda tool leaves the Moda section, the rest stays",
  !keysOf(hubSectionsFor(noIron, false)).includes("moda.iron")
  && keysOf(hubSectionsFor(noIron, false)).includes("moda.flatlay"));
check("a DISABLED catalogue tool leaves the hub", !keysOf(hubSectionsFor(withStatus({ tool_upscale: "DISABLED" }), false)).includes("upscale"));
check("a section with nothing left in it is dropped, not drawn empty",
  !hubSectionsFor(withStatus({ video: "DISABLED" }), false).some((s) => s.key === "video"));
// "Hidden from the menu" hides the row it was set on — not what lives behind it.
const hubHidden = withStatus({ tools: "HIDDEN" });
check("hiding „Wszystkie narzędzia” from the menu does not take the categories with it",
  CATEGORIES.every((c) => menuVisible(hubHidden, categoryGates(c), false)));
check("…a 'Wkrótce' hub badges every category link (it leads to the hub's screen)",
  CATEGORIES.every((c) => menuBadge(withStatus({ tools: "COMING_SOON" }), categoryGates(c)) === "soon"));
check("a category hidden from the menu is not LISTED on the hub…",
  !hubSectionsFor(hidden, false).some((s) => s.key === "ecommerce"));
check("…but its own address still opens it, with all its workflows (hidden ≠ unreachable)",
  (hubSectionsFor(hidden, false, "ecommerce").find((s) => s.key === "ecommerce")?.cards.length ?? 0)
    === offeredWorkflows(CATEGORIES.find((c) => c.key === "ecommerce")!).length);
check("a DISABLED category does not open even by its own address",
  !hubSectionsFor(noSocial, false, "social").some((s) => s.key === "social"));
check("a Moda tool hidden from the menu leaves the Moda section",
  !keysOf(hubSectionsFor(withStatus({ fashion_iron: "HIDDEN" }), false)).includes("moda.iron"));
check("with everything live, a customer sees every section",
  hubSectionsFor(ALL_ACTIVE, false).length === HUB_SECTIONS.length);
check("the menus ask through the gates, never the bare href, for categories",
  /menuVisible\(avail, entryGate\(e\), isAdmin\)/.test(code("components/layout/mega-topbar.tsx"))
  && /show\(categoryGates\(c\)\)/.test(drawer)
  && IMAGE_CREATE.every((e) => Array.isArray(entryGate(e))));

/* ── 12 ────────────────────────────────────────────────────────────────── */
section("12. EVERY CARD OPENS A REAL, EXISTING SCREEN");

for (const c of HUB_CARDS.filter((x) => !x.soon)) {
  let ok = routeExists(c.href);
  if (c.workflow) {
    const cat = CATEGORIES.find((k) => k.key === c.workflow!.category)!;
    const wf = cat.workflows.find((w) => w.key === c.workflow!.key);
    // /k/[cat]/[wf] 404s a soon workflow or category; an offered card must not.
    ok = ok && !!wf && !wf.soon && !cat.soon && c.href === `${categoryPath(cat)}/${wf.key}`;
  }
  const slug = c.href.match(/^\/tools\/([a-z_]+)$/)?.[1];
  if (slug && !["editor", "resize", "compress"].includes(slug)) {
    ok = ok && (TOOL_SLUGS as readonly string[]).includes(slug);
  }
  check(`${c.key} → ${c.href}`, ok);
}

/* ── 13 ────────────────────────────────────────────────────────────────── */
section("13. AN OLD CATEGORY ADDRESS FORWARDS — NEVER A DEAD SCREEN");

const catPage = code(`${APP}/k/[cat]/page.tsx`);
check("/k/<slug> forwards to its section", /redirect\(categoryHref\(category\)\)/.test(catPage));
check("…an unknown slug is still a 404, not a forward to nowhere", /if \(!category\) notFound\(\)/.test(catPage));
check("…and a DISABLED category's old address still 404s for a customer (admins are forwarded)",
  /if \(!routeReachable\(avail, categoryPath\(category\), isAdmin\)\) notFound\(\)/.test(catPage)
  && catPage.indexOf("routeReachable(") < catPage.indexOf("redirect(categoryHref"));
check("the old page's copy is gone with it (no orphaned catpage / match namespaces)",
  ["pl", "en", "de"].every((l) => { const d = JSON.parse(read(`lib/i18n/dictionaries/${l}.json`));
    return !("catpage" in d) && !("match" in d) && !("categoriesTitle" in (d.home ?? {})); }));
check("the category segment's layout no longer shows a gate screen in front of the forward",
  !/FeatureGate/.test(code(`${APP}/k/[cat]/layout.tsx`)));
check("…the gate moved to the workflow screens, on the same key",
  /FeatureGate feature=\{key\}/.test(code(`${APP}/k/[cat]/[wf]/layout.tsx`))
  && /`image_\$\{cat\}`/.test(code(`${APP}/k/[cat]/[wf]/layout.tsx`)));
check("every category's forward lands on a section that exists",
  CATEGORIES.every((c) => hubSection(new URLSearchParams(categoryHref(c).split("?")[1]).get(CATEGORY_PARAM)) !== null));
check("the workflow screens are untouched and still resolve",
  routeExists("/k/moda/ghostMannequin") && routeExists("/k/ecommerce/packshot"));
check("the old landing's components are gone, not left reachable",
  ["components/category/category-header.tsx", "components/category/workflow-cards.tsx",
    "components/category/matching-workspace.tsx", "components/home/category-grid.tsx"].every((f) => !fs.existsSync(f)));
check("a workflow's way back goes through the category's forwarding address",
  /href=\{categoryPath\(category\)\}/.test(code("components/category/workflow-runtime.tsx")));
check("the forward never turns an in-app link into a 404 when only the hub is off",
  /if \(!routeReachable\(avail, "\/tools", isAdmin\)\) redirect\("\/home"\)/.test(catPage)
  && catPage.indexOf('routeReachable(avail, "/tools"') < catPage.indexOf("redirect(categoryHref"));

section("THE START: THE SHARED HOME, ITS CATEGORY DOORS THROUGH THE FORWARD");
// The dashboard (and its category grid) is gone: the signed-in Start renders
// the shared Home (components/home/product-home.tsx). That page DOES show
// category cards — the rail's Moda tile, the chips — so what matters now is
// that each opens through the forward that asks the switchboard, and wears the
// category's own card slot.
const home = code(`${APP}/home/page.tsx`);
check("the Start renders the shared Home, not a dashboard of its own",
  /<ProductSurface scope="shell" \/>/.test(home) && !/CategoryGrid|#kategorie/.test(home));
{
  const model = homeModel(ALL_ACTIVE);
  const categoryCards = [...model.rail, ...model.chips, ...model.effects].filter((c) => c.key.startsWith("cat:"));
  check("the Home shows category cards, each opening through /k/<slug>",
    categoryCards.length > 0 && categoryCards.every((c) => CATEGORIES.some((k) => c.href === categoryPath(k))));
  check("…each wearing the category's own card slot",
    categoryCards.every((c) => CATEGORIES.some((k) => c.slot === categorySlotKey(k.key))));
}

/* ── 14–18 ─────────────────────────────────────────────────────────────── */
section("14–18. ADMIN → MEDIA: CATEGORIES ON ONE TAB, TOOLS ON THE OTHER");

/** The rows production holds, as read on the day this shipped. Keys only —
 *  the picture ids are irrelevant to where a row is listed. */
const PROD_ROWS = [
  "tools.ghost_mannequin.card", "tools.remove_bg.card", "tools.resize.card",
  "category.moda.workflow.flatlay.card", "category.moda.workflow.iron.card",
];
const row = (key: string): SlotRow => ({
  slotKey: key, mediaType: "image", mediaId: `m-${key}`, tabletMediaId: null, mobileMediaId: null,
  posterMediaId: null, altText: "", objectFit: "cover", objectPosition: "center center",
  autoplay: false, muted: true, loop: false, controls: false, enabled: true, updatedAt: null, updatedBy: null,
});
const configured = new Map(PROD_ROWS.map((k) => [k, row(k)]));
const t = (k: string) => k;
const cats = categoryGroups(configured, t);
const tools = toolGroups(configured, t);
const slotsIn = (gs: typeof cats) => gs.flatMap((g) => g.slots);

check("14: Kategorie lists one group per category and nothing else",
  cats.map((g) => g.id).join() === CATEGORIES.map((c) => c.key).join());
check("14: …holding only category slots", slotsIn(cats).every((s) => s.def.entityType === "category"));
check("14: …no tool name on the Kategorie tab",
  cats.every((g) => g.name.startsWith("cats.")) && !cats.some((g) => g.name.startsWith("wf.") || g.name.startsWith("tools.")));
check("15: Narzędzia holds only tool and workflow slots",
  slotsIn(tools).every((s) => s.def.entityType === "tool" || s.def.entityType === "workflow"));
const toolish = MEDIA_SLOTS.filter((d) => d.entityType === "tool" || d.entityType === "workflow");
check("15: …and every one of them — no tool slot left off the tab",
  toolish.every((d) => slotsIn(tools).some((s) => s.def.key === d.key)),
  toolish.filter((d) => !slotsIn(tools).some((s) => s.def.key === d.key)).map((d) => d.key).join(", "));
check("15: …each listed once", new Set(slotsIn(tools).map((s) => s.def.key)).size === slotsIn(tools).length);
check("15: …in the order /tools shows them",
  tools.filter((g) => hubKeys.has(g.id)).map((g) => g.id).join() === HUB_CARDS.filter((c) => tools.some((g) => g.id === c.key)).map((c) => c.key).join());

check("16: every picture production holds is still a declared slot, key unchanged",
  PROD_ROWS.every((k) => isKnownSlot(k)));
const listed = [...slotsIn(cats), ...slotsIn(tools)];
check("16: …and is listed exactly once across the two tabs, with its row attached",
  PROD_ROWS.every((k) => listed.filter((s) => s.def.key === k && s.row?.mediaId === `m-${k}`).length === 1));
check("16: the two Moda pictures moved from Kategorie to Narzędzia — nothing else about them",
  ["category.moda.workflow.flatlay.card", "category.moda.workflow.iron.card"].every((k) =>
    slotsIn(tools).some((s) => s.def.key === k && s.def.entityType === "workflow")
    && !slotsIn(cats).some((s) => s.def.key === k)));
check("16: keys are still the ones the surfaces paint",
  workflowSlotKey("moda", "flatlay") === "category.moda.workflow.flatlay.card"
  && toolSlotKey("remove_bg") === "tools.remove_bg.card");

const adminMedia = code("app/admin/media/page.tsx");
check("14: the Kategorie tab says plainly that its pictures have no surface in the app now",
  /data-media-categories-note/.test(adminMedia) && /t\("media\.categoriesNote"\)/.test(adminMedia)
  && ["pl", "en", "de"].every((l) => typeof (JSON.parse(read(`lib/i18n/dictionaries/${l}.json`)).media ?? {}).categoriesNote === "string"));
const actions = read("app/actions/media-slots.ts");
check("17: the save path still admits exactly the declared slots (upload / replace)",
  /isKnownSlot\(/.test(actions));
check("17: every slot on either tab is writable", listed.every((s) => isKnownSlot(s.def.key)));

const filled = (gs: typeof cats) => slotsIn(gs).filter((s) => s.row?.mediaId && s.row.enabled).length;
check("18: Narzędzia counts the five production pictures (5 filled)", filled(tools) === 5, String(filled(tools)));
check("18: Kategorie counts none (production holds no category picture)", filled(cats) === 0);
check("18: each Kategorie group keeps its two slots, card and hero (0/2, as before)",
  cats.every((g) => g.slots.map((s) => s.def.slotName).join() === "card,hero"));
check("18: each tool group counts its one card slot",
  tools.every((g) => g.slots.length === 1 && g.slots[0].def.slotName === "card"));
const sectionSlots = MEDIA_SLOTS.filter((d) => d.entityType === "section").length;
check("18: the page's total is exactly what the tabs list (nothing counted but hidden)",
  MEDIA_SLOTS.length === slotsIn(cats).length + slotsIn(tools).length + sectionSlots);

console.log(failed ? `\n${failed} tools-hub test(s) failed.` : "\nAll tools-hub tests passed.");
process.exit(failed ? 1 : 0);

/* ── helpers ───────────────────────────────────────────────────────────── */

function grep(dir: string, re: RegExp): boolean {
  if (fs.statSync(dir).isFile()) return re.test(code(dir));
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "node_modules" && grep(p, re)) return true; continue; }
    if (/\.(tsx?|mjs)$/.test(entry.name) && re.test(code(p))) { console.log(`       found in ${p}`); return true; }
  }
  return false;
}
