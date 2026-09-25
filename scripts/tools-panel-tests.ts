/**
 * ADMIN → NARZĘDZIA I SILNIKI: TWO SCREENS BECAME ONE, NOTHING ELSE MOVED.
 *
 * "Narzędzia i silniki" (engine, model, credits) and "Dostępność funkcji"
 * (status, visibility) were merged into one admin panel. The brief's promise
 * is that this is a SCREEN merge: the same tables, the same actions, the same
 * rules the customer side reads — so every check here is either about the
 * panel listing everything it must, or about the customer side being
 * untouched and correctly described.
 *
 *   A  every registry entry is listed, once, in a registry-derived group
 *   B  the six scenarios of the brief, read with the customer's own rules:
 *        active generator · local tool without an engine · "Wkrótce" tool ·
 *        hidden tool · active category · hidden category (+ disabled)
 *   C  status ≠ visibility, and the readout is the customer rules, not a copy
 *      (fed the catalogue layout: /tools, menu and Start listing of an item
 *      are its three layout switches; `hidden_from_menu` is navigation)
 *   D  one source of truth: no new table, no new write path, no parallel list
 *   E  the menu entry is gone and its route redirects, never a 404
 *   F  two forms on one screen cannot overwrite each other
 *   G  the layout contract: one column on a phone, nothing under the dock
 *   H  every new string exists in PL, EN and DE
 *
 * The browser half — the real page at 13 widths — is scripts/tools-panel-probe.mjs.
 *
 * Run: npm run test:toolspanel
 */
import fs from "node:fs";
import path from "node:path";
import {
  ACTIVE_STATE, FEATURE_KEYS, FEATURE_REGISTRY, allDefaults, featureForHref, menuBadge, menuVisible,
  routeReachable, type AvailabilityMap, type FeatureKey, type FeatureState,
} from "@/lib/features";
import { CATEGORIES, categoryGates, categoryPath, offeredWorkflows } from "@/lib/categories";
import { DEFAULT_LAYOUT, hubSectionsFor, type ToolsLayout } from "@/lib/tool-layout";
import { homeModel } from "@/lib/home-sections";
import {
  AI_TOOL_KEYS, MODEL_PRICED, mergeToolConfig, toolTabs, type ToolConfigValues,
} from "@/lib/services/ai-tools";
import {
  PANEL_GROUPS, categoryOf, coveredCards, customerExposure, panelGroupOf, panelKind,
  parentCategory, staticallySoon, withDraft, type ExposureRow, type Surface,
} from "@/lib/tool-panel";
import { ADMIN_NAV } from "@/lib/navigation";
import OldAvailabilityPage from "@/app/admin/settings/features/page";

let failed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ✓ ${name}`);
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const read = (p: string) => fs.readFileSync(p, "utf8");

/** The switchboard with some entries overridden — the way an operator leaves it. */
function board(over: Partial<Record<FeatureKey, Partial<FeatureState>>> = {}): AvailabilityMap {
  const map = allDefaults();
  for (const [k, v] of Object.entries(over) as [FeatureKey, Partial<FeatureState>][]) {
    map[k] = { ...(map[k] ?? ACTIVE_STATE), ...v };
  }
  return map;
}
const row = (rows: ExposureRow[], s: Surface) => rows.find((r) => r.surface === s);
const state = (key: FeatureKey, map: AvailabilityMap, s: Surface, layout: ToolsLayout = DEFAULT_LAYOUT) =>
  row(customerExposure(key, map, layout), s)?.state;
/** The shipped layout with some change an admin made in "Układ dla klientów". */
function arranged(fn: (l: ToolsLayout) => void): ToolsLayout {
  const l: ToolsLayout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
  fn(l);
  return l;
}

/* ── A ─────────────────────────────────────────────────────────────────── */
console.log("A. every entry the switchboard governs is listed, once, grouped by the registries");
{
  const listed = PANEL_GROUPS.flatMap((g) => g.keys);
  check("every FEATURE_KEY is in the panel", FEATURE_KEYS.every((k) => listed.includes(k)),
    FEATURE_KEYS.filter((k) => !listed.includes(k)).join(","));
  check("…and none of them twice", new Set(listed).size === listed.length && listed.length === FEATURE_KEYS.length);
  check("every engine-registry tool is a registry entry (so it is listed)",
    AI_TOOL_KEYS.every((k) => (FEATURE_KEYS as readonly string[]).includes(k)));

  const tools = FEATURE_KEYS.filter((k) => panelKind(k) === "tool");
  const cats = FEATURE_KEYS.filter((k) => panelKind(k) === "category");
  const modules = FEATURE_KEYS.filter((k) => panelKind(k) === "module");
  console.log(`       ${tools.length} tools · ${cats.length} categories · ${modules.length} modules`);
  check("every engine-registry tool gets the full tool card", tools.length === AI_TOOL_KEYS.length);
  check("every category of lib/categories.ts is a category entry", cats.length === CATEGORIES.length
    && CATEGORIES.every((c) => cats.includes(featureForHref(categoryPath(c)) as FeatureKey)));
  check("the rest are modules with a status and no engine",
    modules.every((k) => !AI_TOOL_KEYS.includes(k as (typeof AI_TOOL_KEYS)[number])));

  const order = PANEL_GROUPS.map((g) => g.key);
  check("groups follow the registries: making, editing, each category, video, the rest",
    JSON.stringify(order) === JSON.stringify([
      "create", "edit", ...CATEGORIES.map((c) => `cat:${c.key}`), "video", "modules",
    ]), order.join(","));
  const moda = PANEL_GROUPS.find((g) => g.key === "cat:moda")!;
  check("Moda holds the category itself first, then its five tools",
    moda.keys[0] === "image_moda" && moda.keys.length === 6
    && moda.keys.slice(1).every((k) => parentCategory(k)?.key === "moda"));
  check("the user's list is all there: GrovShot, Własny prompt, Retusz, Edycja, Rozmiar, Kompresja, Upscale, Rozszerz, Watermark, 5× Moda, Wideo",
    ["prompts", "generator", "retouch", "editor", "resize", "compress", "tool_upscale", "tool_expand",
      "tool_watermark", "fashion_ghost_mannequin", "fashion_flat_lay", "fashion_iron",
      "fashion_change_person", "fashion_change_face", "video"]
      .every((k) => listed.includes(k as FeatureKey) && panelKind(k as FeatureKey) === "tool"));
  check("panelGroupOf agrees with the groups", FEATURE_KEYS.every((k) =>
    PANEL_GROUPS.find((g) => g.key === panelGroupOf(k))?.keys.includes(k)));

  const panel = read("components/admin/tool-registry.tsx");
  check("the panel types no list of its own — it renders PANEL_GROUPS",
    panel.includes("PANEL_GROUPS") && !/"fashion_iron"|"tool_upscale"|"image_moda"/.test(panel));
  const page = read("app/admin/ai/page.tsx");
  check("the page lists every registry row, tool or not",
    page.includes("listFeatureAvailabilityAction()") && page.includes("(adminRows ?? []).map"));
}

/* ── B ─────────────────────────────────────────────────────────────────── */
console.log("\nB. the six scenarios, read with the rules the customer side renders with");
{
  // Production today: three categories and video announced, Moda tools pending.
  const live = board();

  // 1 — active generator
  const gen = customerExposure("prompts", live);
  check("1 active generator: on /tools, on Start, in the menu",
    row(gen, "tools")?.state === "shown" && row(gen, "home")?.state === "shown" && row(gen, "menu")?.state === "shown",
    JSON.stringify(gen));
  check("1 …in the section the hub really draws it in", row(gen, "tools")!.where.includes("hub.sec.generate"));
  check("1 …on the row of Start it really sits in", row(gen, "home")!.where.includes("aicc.panel.home.rail"));
  check("1 …and the same generator is what Start's primary action opens",
    homeModel(live, false).startHref === "/prompts");

  // 2 — local tool without an engine
  check("2 local tool: no engine tab and no model tab to fake",
    !toolTabs({ key: "compress", engineMode: "off", serviceSlug: "tool_compress" }).some((t) => t === "engine" || t === "models"));
  check("2 …the panel says 'local processing' for exactly that case",
    read("components/admin/tool-registry.tsx").includes('tool.category === "local" ? "aicc.panel.localNote"'));
  check("2 …listed on /tools, not on Start by default (Start is a curated set — its switch can add it)",
    state("compress", live, "tools") === "shown" && state("compress", live, "home") === "hidden");

  // 3 — "Wkrótce" tool
  const soon = customerExposure("fashion_ghost_mannequin", live);
  check("3 Wkrótce tool: still listed, with its badge",
    row(soon, "tools")?.state === "badged" && row(soon, "tools")?.badge === "soon", JSON.stringify(soon));
  check("3 …the customer menu badges it too", menuBadge(live, ["/k/moda", "/k/moda/ghostMannequin"]) === "soon");
  check("3 …and its route opens onto the Wkrótce screen, not a 404",
    routeReachable(live, "/k/moda/ghostMannequin", false) && live.fashion_ghost_mannequin.status === "COMING_SOON");

  // 4 — hidden tool: its layout switches, one surface at a time
  const offTools = arranged((l) => { l.flags.compress.tools = false; });
  check("4 hidden tool: its /tools switch off → gone from /tools, still in the menu",
    state("compress", live, "tools", offTools) === "hidden" && state("compress", live, "menu", offTools) === "shown");
  const offMenu = arranged((l) => { l.flags.compress.menu = false; });
  check("4 …its menu switch off → gone from the menu, still on /tools",
    state("compress", live, "menu", offMenu) === "hidden" && state("compress", live, "tools", offMenu) === "shown");
  const onStart = arranged((l) => { l.flags.compress.start = true; });
  check("4 …its Start switch on → on Start, nothing else moved",
    state("compress", live, "home", onStart) === "shown" && state("compress", live, "tools", onStart) === "shown"
    && state("compress", live, "menu", onStart) === "shown");
  check("4 …but not switched off: its address still opens", routeReachable(live, "/tools/compress", false)
    && live.compress.status === "ACTIVE");
  check("4 …and nothing else lost its place", state("resize", live, "tools", offTools) === "shown");

  // 5 — active category
  const eco = customerExposure("image_ecommerce", live);
  check("5 active category: its section on /tools, its cards on Start, its menu entry",
    row(eco, "tools")?.state === "shown" && row(eco, "home")?.state === "shown" && row(eco, "menu")?.state === "shown",
    JSON.stringify(eco));

  // 6 — hidden category: its navigation switch (menu link) and, separately,
  // its /tools section switch in the layout
  const hc = board({ image_ecommerce: { hiddenFromMenu: true } });
  check("6 category hidden from navigation: off the menu, its /tools section untouched",
    state("image_ecommerce", hc, "menu") === "hidden" && state("image_ecommerce", hc, "tools") === "shown");
  const hiddenSection = arranged((l) => { l.sections.find((x) => x.key === "ecommerce")!.visible = false; });
  check("6 …its /tools section hidden in the layout: gone from /tools, the items stay placed",
    !hubSectionsFor(live, false, hiddenSection).some((s) => s.key === "ecommerce")
    && hiddenSection.sections.find((x) => x.key === "ecommerce")!.items.length > 0);
  const eCat = CATEGORIES.find((c) => c.key === "ecommerce")!;
  check("6 …and hiding it deleted none of its tools",
    coveredCards("image_ecommerce").length === eCat.workflows.length && offeredWorkflows(eCat).length > 0);

  // + disabled, which must still work exactly as before
  const off = board({ image_ecommerce: { status: "DISABLED" }, tool_upscale: { status: "DISABLED" } });
  check("Wyłączony category: gone everywhere, its door shut, even when asked for by URL",
    state("image_ecommerce", off, "tools") === "hidden" && !routeReachable(off, categoryPath(eCat), false)
    && !hubSectionsFor(off, false).some((s) => s.cards.some((c) => c.gates?.includes(categoryPath(eCat)))));
  check("…while the editing tools that share its section stay (they never answered to it)",
    state("retouch", off, "tools") === "shown");
  check("Wyłączony tool: gone from every list and its route closed",
    state("tool_upscale", off, "tools") === "hidden" && state("tool_upscale", off, "menu") !== "shown"
    && !routeReachable(off, "/tools/upscale", false));
  check("…while an admin still sees both to switch them back on",
    menuVisible(off, "/tools/upscale", true) && routeReachable(off, categoryGates(eCat), true));
}

/* ── C ─────────────────────────────────────────────────────────────────── */
console.log("\nC. status ≠ visibility, and the readout IS the customer's rules");
{
  const base = board();
  const draft = withDraft(base, "retouch", { status: "COMING_SOON", hiddenFromMenu: false });
  check("a draft changes exactly one entry", FEATURE_KEYS.every((k) =>
    k === "retouch" || JSON.stringify(draft[k]) === JSON.stringify(base[k])));
  check("…and never mutates the live board", base.retouch.status === "ACTIVE");
  check("Wkrótce + visible → listed with the badge", state("retouch", draft, "tools") === "badged");
  const unlisted = arranged((l) => { l.flags.retouch.tools = false; });
  check("Aktywny + switched off /tools → unlisted, still usable",
    state("retouch", base, "tools", unlisted) === "hidden" && routeReachable(base, "/retusz", false));
  check("Wkrótce + switched off /tools → unlisted (visibility never shows what the switch hid)",
    state("retouch", draft, "tools", unlisted) === "hidden");

  // The readout must agree with the functions /tools and Start render with,
  // for every entry, under a few boards — it is those functions, asked.
  const allOff = arranged((l) => {
    for (const k of Object.keys(l.flags)) l.flags[k] = { tools: false, menu: false, start: false };
  });
  const boards: [string, AvailabilityMap, ToolsLayout][] = [
    ["defaults", base, DEFAULT_LAYOUT],
    ["everything hidden from navigation", board(Object.fromEntries(FEATURE_KEYS.map((k) => [k, { hiddenFromMenu: true }]))), DEFAULT_LAYOUT],
    ["everything active", board(Object.fromEntries(FEATURE_KEYS.map((k) => [k, { status: "ACTIVE" as const }]))), DEFAULT_LAYOUT],
    ["every item switched off everywhere", base, allOff],
    ["a rearranged layout", base, arranged((l) => {
      l.sections.reverse();
      l.sections[0].visible = false;
      l.flags.compress.tools = false;
      l.flags.white_bg.start = false;
      l.flags.expand.start = true;
    })],
  ];
  for (const [name, map, layout] of boards) {
    // /tools is FeatureGate("tools"): unless it is ACTIVE, no card is drawn.
    const hubOpen = map.tools.status === "ACTIVE";
    const hubKeys = new Set(!hubOpen ? [] : hubSectionsFor(map, false, layout).flatMap((s) =>
      [s.gates ? featureForHref(s.gates[s.gates.length - 1]) : null,
        ...s.cards.map((c) => featureForHref(c.gates ? c.gates[c.gates.length - 1] : c.href))]));
    const m = homeModel(map, false, layout);
    const homeKeys = new Set([...m.rail, ...m.chips, ...m.effects, ...m.video].map((c) => featureForHref(c.href)));
    const bad = FEATURE_KEYS.filter((k) => {
      const t = state(k, map, "tools", layout);
      const h = state(k, map, "home", layout);
      const onHub = k === "tools" ? hubKeys.has(k) : t === "shown" || t === "badged";
      const onHome = h === "shown" || h === "badged";
      if (k === "home") return false; // the Start page itself, checked below
      return (k !== "tools" && onHub !== hubKeys.has(k)) || onHome !== homeKeys.has(k);
    });
    check(`the readout matches /tools and Start exactly — ${name}`, bad.length === 0, bad.join(","));
  }
  // Hiding unlists; it never closes a page. Start and /tools themselves
  // still open — the readout says exactly that and nothing more.
  check("every item switched off → nothing listed on /tools or Start for a customer (the two pages themselves still open)",
    FEATURE_KEYS.every((k) => customerExposure(k, base, allOff).filter((r) => r.surface !== "menu")
      .every((r) => r.state === "hidden" || r.state === "na"
        || (k === "home" && r.surface === "home") || (k === "tools" && r.surface === "tools")
        // Category tiles on Start are the category's navigation, not an item.
        || (r.surface === "home" && categoryOf(k) !== null))));
  check("everything hidden from navigation → no module or category link in the menus",
    FEATURE_KEYS.filter((k) => panelKind(k) !== "tool").every((k) =>
      state(k, boards[1][1], "menu") === "hidden" || state(k, boards[1][1], "menu") === "na"));
}

/* ── C2 ────────────────────────────────────────────────────────────────── */
console.log("\nC2. the readout follows the switches the review found it ignoring");
{
  const off = board({ tools: { status: "DISABLED" } });
  check("/tools switched off → every tool on it reads hidden, not 'Widoczne'",
    ["resize", "retouch", "tool_upscale", "image_ecommerce", "fashion_iron"].every((k) =>
      state(k as FeatureKey, off, "tools") === "hidden"));
  const soonHub = board({ tools: { status: "COMING_SOON" } });
  const r = row(customerExposure("resize", soonHub), "tools")!;
  check("/tools in Wkrótce → its tools read as behind the Wkrótce screen", r.state === "badged" && r.badge === "soon");
  check("the hub's own entry describes the whole tab",
    row(customerExposure("tools", board()), "tools")?.where.includes("aicc.panel.tools.whole") === true);

  check("Start's own switch governs the whole Start page",
    state("home", board(), "home") === "shown" && state("home", board({ home: { status: "MAINTENANCE" } }), "home") === "badged"
    && state("home", board({ home: { status: "DISABLED" } }), "home") === "hidden");

  // The menu row reads the menus' real lists.
  check("no menu entry is claimed for Historia, Pomoc or Kredyty",
    (["history", "support", "credits"] as FeatureKey[]).every((k) => state(k, board(), "menu") === "na"));
  check("Własny prompt is off the menu by default, and its switch puts it there",
    state("generator", board(), "menu") === "hidden"
    && state("generator", board(), "menu", arranged((l) => { l.flags.custom.menu = true; })) === "shown");
  check("…while the entries the menus DO gate are read", state("library", board(), "menu") === "shown"
    && state("library", board({ library: { hiddenFromMenu: true } }), "menu") === "hidden"
    && state("compress", board(), "menu") === "shown");
  check("an ACTIVE Matching still reads 'Wkrótce' in the menu, as customers see it",
    row(customerExposure("image_matching", board({ image_matching: { status: "ACTIVE" } })), "menu")?.badge === "soon");
  check("…and so does an ACTIVE Wideo",
    row(customerExposure("video", board({ video: { status: "ACTIVE" } })), "menu")?.state === "badged");
  check("the panel flags both as having no engine yet", staticallySoon("image_matching") && staticallySoon("video")
    && !staticallySoon("image_ecommerce") && !staticallySoon("retouch"));
}

/* ── D ─────────────────────────────────────────────────────────────────── */
console.log("\nD. one source of truth: no new table, no new write path, no parallel list");
{
  const panelFiles = [
    "components/admin/tool-registry.tsx", "components/admin/availability-controls.tsx",
    "lib/tool-panel.ts", "app/admin/ai/page.tsx",
  ];
  check("the panel never talks to a table directly", panelFiles.every((f) => !/\.from\(|\.rpc\(/.test(read(f))));
  check("…and the page only reads", !/\.(insert|update|upsert|delete)\(/.test(read("app/admin/ai/page.tsx")));
  const controls = read("components/admin/availability-controls.tsx");
  check("status and visibility are written by the availability actions, as before",
    controls.includes("saveFeatureAvailabilityAction") && controls.includes("batchFeatureStatusAction")
    && controls.includes("batchMenuVisibilityAction") && controls.includes('from "@/app/actions/features"'));
  const features = read("app/actions/features.ts");
  check("those actions still write feature_availability, admin-checked, registry-bound",
    features.includes('from("feature_availability")') && features.includes("requireAdmin()")
    && features.includes("isFeatureKey(input.key)"));
  check("…and refresh the screen they are made from", features.includes('const PAGE = "/admin/ai"'));
  const aiActions = read("app/actions/ai-tools.ts");
  check("model and credits are written by the engine actions, which still never touch availability",
    !aiActions.includes("feature_availability") && !aiActions.includes("credits_cost:"));
  const pure = read("lib/tool-panel.ts");
  check("the derivation module is client-safe and stores nothing",
    !pure.includes("server-only") && !pure.includes("supabase") && !/useState|"use server"/.test(pure));
  check("the availability row gained no per-surface column — the item switches live in the layout document only",
    read("lib/features.ts").includes("hiddenFromMenu: boolean;")
    && !/hidden_from_(home|tools|category)|show_on_home|showOnHome/.test(
      [...panelFiles, "lib/features.ts", "lib/server/feature-availability.ts", "app/actions/features.ts"].map(read).join("\n"))
    && read("app/actions/tool-layout.ts").includes("normalizeLayout(") && read("lib/server/tool-layout.ts").includes('"tools_layout"'));
  const migrations = fs.readdirSync("supabase/migrations");
  check("no migration mentions a per-surface visibility column",
    !migrations.some((m) => /hidden_from_(home|tools|category)/.test(read(path.join("supabase/migrations", m)))));
  check("the customer side was not edited to fit the panel: menu rules unchanged",
    read("lib/features.ts").includes("return state.status !== \"DISABLED\" && !state.hiddenFromMenu;"));
}

/* ── E ─────────────────────────────────────────────────────────────────── */
console.log("\nE. the menu entry is gone, its route redirects");
{
  const hrefs = ADMIN_NAV.flatMap((g) => g.items.map((i) => i.href as string));
  check("„Dostępność funkcji” is no longer in the admin menu", !hrefs.includes("/admin/settings/features"));
  check("„Narzędzia i silniki” still is, in AI i generowanie",
    ADMIN_NAV.find((g) => g.key === "ai")?.items.some((i) => i.href === "/admin/ai") === true);
  const old = read("app/admin/settings/features/page.tsx");
  check("the old route redirects to the merged panel, never a 404",
    /redirect\("\/admin\/ai"\)/.test(old) && !old.includes("createClient") && !old.includes("notFound"));
  // The real page, run: Next's redirect() throws a digest naming the target.
  let digest = "";
  try { OldAvailabilityPage(); } catch (e) { digest = String((e as { digest?: string }).digest ?? ""); }
  check("…and running it really redirects there", digest.startsWith("NEXT_REDIRECT;") && digest.includes(";/admin/ai;"), digest);
  check("the tool workspace links status to its row of the panel",
    read("app/admin/ai/[tool]/page.tsx").includes("href={`/admin/ai?tool=${row.key}`}"));
  check("the panel opens a deep-linked row", read("app/admin/ai/page.tsx").includes("openKey={tool && isFeatureKey(tool) ? tool : null}"));
  const stale: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(tsx?)$/.test(e.name)) continue;
      if (p === path.join("app", "admin", "settings", "features", "page.tsx")) continue;
      if (/href=\{?["'`]\/admin\/settings\/features|revalidatePath\("\/admin\/settings\/features/.test(read(p))) stale.push(p);
    }
  };
  ["app", "components", "lib"].forEach(walk);
  check("nothing links to or revalidates the old address", stale.length === 0, stale.join(", "));
}

/* ── F ─────────────────────────────────────────────────────────────────── */
console.log("\nF. two forms on one screen cannot overwrite each other");
{
  const saved: ToolConfigValues = {
    toolKey: "generator", engineMode: "hybrid", serviceSlug: "image_generation",
    allowModelChoice: true, fallbackEnabled: true, timeoutMs: 90000, maxAttempts: 2, notes: "keep me",
  };
  // Each form holds a local copy; the other section's fields in it are stale.
  const staleCopy: ToolConfigValues = { ...saved, engineMode: "off", serviceSlug: null, notes: null, timeoutMs: 1, maxAttempts: 9 };

  const billing = mergeToolConfig("billing", saved, { ...staleCopy, serviceSlug: "image_edit" });
  check("saving Kredyty writes the service and keeps the saved engine",
    billing.serviceSlug === "image_edit" && billing.engineMode === "hybrid" && billing.timeoutMs === 90000
    && billing.maxAttempts === 2 && billing.notes === "keep me");
  const engine = mergeToolConfig("engine", saved, { ...staleCopy, engineMode: "grovbase", timeoutMs: 60000, maxAttempts: 1 });
  check("saving Silnik writes the engine and keeps the saved service and note",
    engine.engineMode === "grovbase" && engine.timeoutMs === 60000 && engine.serviceSlug === "image_generation"
    && engine.notes === "keep me");
  check("…and neither touches the model-choice flags the model picker owns",
    billing.allowModelChoice && billing.fallbackEnabled && engine.allowModelChoice && engine.fallbackEnabled);
  const basics = mergeToolConfig("basics", saved, { ...staleCopy, serviceSlug: "upscale", notes: "new" });
  check("the workspace's Podstawowe still saves service + note", basics.serviceSlug === "upscale"
    && basics.notes === "new" && basics.engineMode === "hybrid");
  check("a form is dirty only for its own fields",
    JSON.stringify(mergeToolConfig("billing", saved, saved)) === JSON.stringify(saved)
    && JSON.stringify(mergeToolConfig("billing", saved, { ...saved, engineMode: "off", notes: "x" })) === JSON.stringify(saved)
    && JSON.stringify(mergeToolConfig("engine", saved, { ...saved, serviceSlug: null })) === JSON.stringify(saved));
  const actions = read("app/actions/ai-tools.ts");
  check("the server writes only the saving section's columns",
    /engine: \["engine_mode", "timeout_ms", "max_attempts"\]/.test(actions)
    && /billing: \["service_slug"\]/.test(actions) && /models: \["allow_model_choice", "fallback_enabled"\]/.test(actions)
    && actions.includes("...owned,"));
  check("…and the forms say which section they are",
    read("components/admin/tool-basics.tsx").includes("saveToolConfigAction(payload, section)")
    && read("components/admin/tool-models.tsx").includes('}, "models");'));
  check("a save without a section still writes the whole row (the old callers)",
    actions.includes("!section || SECTION_COLUMNS[section].includes(col)"));
  const panel = read("components/admin/tool-registry.tsx");
  check("model-priced tools are the ones that reach runGeneration",
    ["generator", "retouch", "prompts", "fashion_iron"].every((k) => MODEL_PRICED.includes(k as (typeof MODEL_PRICED)[number]))
    && !MODEL_PRICED.includes("compress" as (typeof MODEL_PRICED)[number])
    && /costOverride: retouchPrice/.test(read("lib/server/retouch.ts"))
    && /costOverride: fashionPrice/.test(read("lib/server/fashion.ts")));
  check("…and the panel never shows them a catalogue number as their price",
    panel.includes("if (MODEL_PRICED.includes(r.key)) return t(\"aicc.panel.byModel\")") && panel.includes("modelPriced ?"));
  check("the forms get the STORED policy, not defaults",
    panel.includes("timeoutMs: tool.timeoutMs") && panel.includes("maxAttempts: tool.maxAttempts") && panel.includes("notes: tool.notes"));
  check("the availability editor remounts when its saved record changes",
    panel.includes("key={savedKey(admin)}"));
  check("form ids are unique per instance",
    read("components/admin/tool-basics.tsx").includes("useId()") && read("components/admin/tool-models.tsx").includes("useId()"));
}

/* ── G ─────────────────────────────────────────────────────────────────── */
console.log("\nG. the layout contract");
{
  const panel = read("components/admin/tool-registry.tsx");
  const controls = read("components/admin/availability-controls.tsx");
  check("no fixed-width table left to scroll sideways", !/min-w-\[\d{3,}px\]/.test(panel + controls));
  check("config is one column below lg, two from lg", panel.includes("grid gap-3.5 lg:grid-cols-2"));
  check("the bulk bar sits above the admin dock on a phone",
    controls.includes("bottom-[calc(var(--dock-h)+env(safe-area-inset-bottom))]") && controls.includes("lg:bottom-0"));
  check("the admin page still reserves the dock + safe area under its last row",
    read("app/admin/layout.tsx").includes("pb-[calc(var(--dock-h)+2rem+env(safe-area-inset-bottom))]"));
  check("the quick filter scrolls inside itself, not the page",
    panel.includes('role="group" aria-label={t("aicc.panel.quick.label")}') && panel.includes("overflow-x-auto"));
  check("a collapsed row keeps its configuration mounted (drafts survive)",
    panel.includes("hidden={!open}") && panel.includes("mounted && ("));
  check("the status badge and filters read the status in force",
    panel.includes("STATUS_TONE[live]") && panel.includes("if (status && live !== status) return false;"));
  check("each Konfiguruj button names its row", panel.includes("aria-describedby={nameId}"));
  check("the published prompt version is on the row again", panel.includes("v{tool.promptVersion}"));
  const palette = read("components/layout/command-palette.tsx");
  check("the admin search still finds the panel by its old name",
    ADMIN_NAV.find((g) => g.key === "ai")!.items.find((i) => i.href === "/admin/ai")?.aliasKeys?.includes("features") === true
    && palette.includes("r.alias"));
}

/* ── H ─────────────────────────────────────────────────────────────────── */
console.log("\nH. every new string in PL, EN and DE");
{
  const dicts = ["pl", "en", "de"].map((l) => JSON.parse(read(`lib/i18n/dictionaries/${l}.json`)) as {
    aicc: Record<string, string>; featAdm: Record<string, unknown>;
  });
  const keys = [
    "group.modules", "kind.tool", "kind.category", "kind.module", "allGroups",
    "quick.label", "quick.all", "quick.active", "quick.soon", "quick.hidden",
    "sec.model", "sec.credits", "sec.status", "sec.visibility", "provider", "localNote", "capabilityNote",
    "providersLink", "fullConfig", "perRun", "noBilling", "priceLink", "usage30d",
    "statusHint.ACTIVE", "statusHint.COMING_SOON", "statusHint.MAINTENANCE", "statusHint.DISABLED",
    "nav", "navHint.tool", "navHint.category", "navHint.module", "whereTitle",
    "surface.tools", "surface.home", "surface.menu",
    "state.shown", "state.badged", "state.hidden", "state.na",
    "na.tools", "na.home", "na.menu",
    "home.rail", "home.chips", "home.effects", "home.video",
    "windowPreview", "categoryNote", "coversNote", "saveAvailability", "categoryLine",
    "tools.whole", "home.page", "creditsN", "byModel", "modelBase", "modelPriced", "modelsLink", "staticSoon",
    "storedStatus",
  ].map((k) => `panel.${k}`);
  const missing = dicts.flatMap((d, i) => keys.filter((k) => typeof d.aicc[k] !== "string" || !d.aicc[k].trim())
    .map((k) => `${["pl", "en", "de"][i]}:${k}`));
  check("every aicc.panel.* key is translated", missing.length === 0, missing.join(", "));
  const sets = dicts.map((d) => Object.keys(d.aicc).filter((k) => k.startsWith("panel.")).sort().join("|"));
  check("PL, EN and DE carry the same aicc.panel.* keys", sets[0] === sets[1] && sets[1] === sets[2]);
  check("the header says what the panel now does",
    dicts[0].aicc["tools.sub"] === "Modele, koszty, status i widoczność wszystkich narzędzi GrovBase w jednym miejscu.");
  // Every literal aicc.panel key the new code asks for exists.
  const src = ["components/admin/tool-registry.tsx", "components/admin/availability-controls.tsx", "lib/tool-panel.ts"]
    .map(read).join("\n");
  const used = [...src.matchAll(/"aicc\.panel\.([a-zA-Z.]+)"/g)].map((m) => `panel.${m[1]}`);
  const unknown = used.filter((k) => !keys.includes(k));
  check("the code asks for no key the dictionaries lack", unknown.length === 0, unknown.join(", "));
  check("the category entries' names resolve", CATEGORIES.every((c) =>
    dicts.every((d) => typeof (d as unknown as { cats: Record<string, string> }).cats[c.key] === "string")));
  check("every registry name resolves (the panel shows them all)", FEATURE_REGISTRY.every((f) =>
    dicts.every((d) => resolve(d as unknown as Record<string, unknown>, f.nameKey) !== undefined)),
    FEATURE_REGISTRY.filter((f) => resolve(dicts[0] as unknown as Record<string, unknown>, f.nameKey) === undefined).map((f) => f.nameKey).join(","));
  check("categoryOf/parentCategory never disagree", FEATURE_KEYS.every((k) => !(categoryOf(k) && parentCategory(k))));
}

console.log(failed ? `\n${failed} tools-panel test(s) failed.` : "\nAll tools-panel tests passed.");
process.exit(failed ? 1 : 0);

function resolve(d: Record<string, unknown>, key: string): string | undefined {
  const parts = key.split(".");
  let node: unknown = d;
  for (let i = 0; i < parts.length; i++) {
    if (!node || typeof node !== "object") return undefined;
    const obj = node as Record<string, unknown>;
    const rest = parts.slice(i).join(".");
    if (typeof obj[rest] === "string") return obj[rest] as string;
    node = obj[parts[i]];
  }
  return typeof node === "string" ? node : undefined;
}
