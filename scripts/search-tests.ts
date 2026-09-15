/**
 * THE SEARCH AND THE ROUTES BEHIND IT.
 *
 * scripts/search-probe.mjs measures what a browser paints. This checks the
 * things a browser cannot tell you, because they only bite later or only bite
 * in a language nobody on the team reads:
 *
 *   · EVERY TILE OPENS SOMETHING REAL. A search result whose href has no page
 *     is a 404 that looks exactly like a working link until somebody clicks it.
 *     Every tool and every section is resolved against the app directory,
 *     dynamic segments included.
 *   · THE COPY EXISTS IN ALL THREE LANGUAGES. The name, the description and the
 *     search words are looked up through variables — `t(card.descKey)` — so
 *     scripts/i18n-check.mjs cannot see them and a German seller would get a
 *     humanised key where a sentence belongs.
 *   · SEARCHING ACTUALLY FINDS THINGS. The brief names its own examples —
 *     „tło", „moda", „retusz", „kompresja" — and they are run here, in each
 *     language, against the real index.
 *   · THE AI BADGE IS TRUE. It is derived from the tool catalogue's own `kind`,
 *     and a badge on a tool that never calls a model is a lie on a tile.
 *   · THE TWO LISTS ARE ALWAYS FULL. Three cards and six links, whatever the
 *     ranking contains and whatever the admin has switched off.
 *
 * Run:  npm run test:search
 */
import fs from "node:fs";
import path from "node:path";
import {
  SEARCHABLE, TOOL_CARDS, TOOL_SECTIONS, buildToolIndex, matchTools, normalise,
  splitPopular, ALL_TOOLS_HREF,
} from "@/lib/tool-search";
import { DOCK_SLOTS, dockSlotActive } from "@/lib/bottom-nav";
import { allDefaults, type AvailabilityMap, type FeatureKey } from "@/lib/features";
import { FALLBACK_ORDER } from "@/lib/server/tool-popularity";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : `\n     ${detail}`}`);
}

/* ── every destination is a page that exists ─────────────────────────────── */

/**
 * Resolve an app-router path against the customer directory, honouring dynamic
 * segments: /k/moda/ghostMannequin is served by k/[cat]/[wf]/page.tsx and is a
 * real route even though no folder is named after it.
 */
const APP = "app/(app)";
function routeExists(href: string): boolean {
  const segments = (href.split(/[?#]/, 1)[0] ?? "").split("/").filter(Boolean);
  let dirs = [APP];
  for (const segment of segments) {
    const next: string[] = [];
    for (const dir of dirs) {
      const exact = path.join(dir, segment);
      if (fs.existsSync(exact)) next.push(exact);
      // A dynamic segment matches anything at this level.
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && /^\[.+\]$/.test(entry.name)) next.push(path.join(dir, entry.name));
      }
    }
    if (next.length === 0) return false;
    dirs = next;
  }
  return dirs.some((d) => fs.existsSync(path.join(d, "page.tsx")));
}

check("the route resolver understands dynamic segments",
  routeExists("/k/moda/ghostMannequin") && routeExists("/tools/upscale") && !routeExists("/nope/nope"));

for (const entry of SEARCHABLE) {
  check(`${entry.id} → ${entry.href} is a real page`, routeExists(entry.href));
}
check(`the footer link → ${ALL_TOOLS_HREF} is a real page`, routeExists(ALL_TOOLS_HREF));
for (const slot of DOCK_SLOTS) {
  check(`dock “${slot.key}” → ${slot.href} is a real page`, routeExists(slot.href));
}

/* ── the copy exists in every language ───────────────────────────────────── */

const LOCALES = ["pl", "en", "de"] as const;
const dicts = Object.fromEntries(LOCALES.map((l) => [
  l, JSON.parse(fs.readFileSync(`lib/i18n/dictionaries/${l}.json`, "utf8")) as Record<string, unknown>,
])) as Record<(typeof LOCALES)[number], Record<string, unknown>>;

/** Mirrors lookup() in lib/i18n/t.ts, flat dotted keys included. */
function lookup(dict: Record<string, unknown>, key: string): string | null {
  const parts = key.split(".");
  let node: unknown = dict;
  for (let i = 0; i < parts.length; i++) {
    if (!node || typeof node !== "object") return null;
    const flat = (node as Record<string, unknown>)[parts.slice(i).join(".")];
    if (typeof flat === "string") return flat;
    node = (node as Record<string, unknown>)[parts[i]];
  }
  return typeof node === "string" ? node : null;
}

const missing: string[] = [];
for (const entry of SEARCHABLE) {
  for (const key of [entry.nameKey, entry.descKey, entry.wordsKey]) {
    for (const locale of LOCALES) {
      if (!lookup(dicts[locale], key)) missing.push(`${locale}:${key}`);
    }
  }
}
check("every name, description and word list exists in pl / en / de",
  missing.length === 0, missing.slice(0, 12).join(", "));

for (const key of [
  "search.toolPlaceholder", "search.mostUsed", "search.popularTools",
  "search.allTools", "search.seeAll", "search.browseAll", "search.ai",
]) {
  check(`${key} is translated everywhere`, LOCALES.every((l) => Boolean(lookup(dicts[l], key))));
}
check(
  "the placeholder is the one the brief dictates",
  /generuj obraz/i.test(lookup(dicts.pl, "search.toolPlaceholder") ?? "")
  && /film produktowy/i.test(lookup(dicts.pl, "search.toolPlaceholder") ?? "")
  && /usuń tło/i.test(lookup(dicts.pl, "search.toolPlaceholder") ?? ""),
  lookup(dicts.pl, "search.toolPlaceholder") ?? "(missing)",
);

/* ── nothing is declared twice ───────────────────────────────────────────── */

check("no entry id appears twice", new Set(SEARCHABLE.map((e) => e.id)).size === SEARCHABLE.length);
check("no ranked tool points at the same route as another",
  new Set(TOOL_CARDS.map((c) => c.href)).size === TOOL_CARDS.length);
check("the sections are deep links, not screens",
  TOOL_SECTIONS.length > 0 && TOOL_SECTIONS.every((s) => s.href.includes("?")),
  TOOL_SECTIONS.map((s) => s.href).join(", "));
check("a section is never ranked",
  TOOL_SECTIONS.every((s) => !TOOL_CARDS.some((c) => c.id === s.id)),
  "its runs already count towards the screen that hosts it");
check("the catalogue page is not offered as a tool",
  !SEARCHABLE.some((e) => e.href === ALL_TOOLS_HREF));

/* ── the icons came from somewhere ───────────────────────────────────────── */

// Sparkles is the fallback for a feature nothing declares an icon for. It is
// also, legitimately, the prompt engine's own icon — so exactly one card may
// carry it, and a second one means a new registry entry arrived unnoticed.
const sparkly = TOOL_CARDS.filter((c) => c.icon === TOOL_CARDS.find((x) => x.key === "prompts")?.icon);
check("every tool has an icon of its own", sparkly.length === 1 && sparkly[0].key === "prompts",
  `using the fallback icon: ${sparkly.map((c) => c.key).join(", ")}`);
check("the category tools carry their category's accent",
  TOOL_CARDS.filter((c) => c.key.startsWith("image_") || c.key.startsWith("fashion_"))
    .every((c) => Boolean(c.accent)),
  TOOL_CARDS.filter((c) => (c.key.startsWith("image_") || c.key.startsWith("fashion_")) && !c.accent)
    .map((c) => c.key).join(", "));

/* ── the AI badge is true ────────────────────────────────────────────────── */

const ai = (key: string) => SEARCHABLE.find((e) => e.id === key)?.ai;
for (const [key, expected, why] of [
  ["prompts", true, "calls a model"],
  ["generator", true, "calls a model"],
  ["retouch", true, "calls a model"],
  ["image_moda", true, "calls a model"],
  ["editor", true, "hosts removal/relight, which are provider calls"],
  ["tool_upscale", true, "a paid provider call"],
  ["tool_expand", true, "a paid provider call"],
  ["compress", false, "sharp, in our own runtime"],
  ["resize", false, "sharp, in our own runtime"],
  ["tool_watermark", false, "sharp, in our own runtime"],
] as const) {
  check(`AI badge on ${key} is ${expected} — ${why}`, ai(key) === expected, `got ${ai(key)}`);
}

/* ── matching, in every language ─────────────────────────────────────────── */

const indexFor = (locale: (typeof LOCALES)[number]) =>
  buildToolIndex(SEARCHABLE, (key) => lookup(dicts[locale], key) ?? "");

check("accents do not matter", normalise("TŁO") === "tlo" && normalise("Zdjęć") === "zdjec");

for (const [locale, term, expected] of [
  // The brief's own examples.
  ["pl", "tło", ["section:remove_bg", "editor"]],
  ["pl", "tlo", ["section:remove_bg", "editor"]],
  ["pl", "usuń tło", ["section:remove_bg"]],
  ["pl", "moda", ["image_moda"]],
  ["pl", "retusz", ["retouch"]],
  ["pl", "kompresja", ["compress"]],
  ["pl", "generuj obraz", ["prompts", "generator"]],
  ["pl", "film produktowy", ["video"]],
  ["en", "background", ["section:remove_bg", "editor"]],
  ["en", "compress", ["compress"]],
  ["en", "fashion", ["image_moda"]],
  ["de", "hintergrund", ["section:remove_bg", "editor"]],
  ["de", "kompression", ["compress"]],
  ["de", "mode", ["image_moda"]],
] as const) {
  const hits = matchTools(indexFor(locale), term).map((e) => e.id);
  const found = expected.every((id) => hits.includes(id));
  check(`${locale}: “${term}” finds ${expected.join(" + ")}`, found,
    `got: ${hits.slice(0, 6).join(", ") || "(nothing)"}`);
}
check("a name beating an alias: “kom” puts Kompresja first",
  matchTools(indexFor("pl"), "kom")[0]?.id === "compress",
  matchTools(indexFor("pl"), "kom").slice(0, 3).map((e) => e.id).join(", "));
check("an empty query matches nothing", matchTools(indexFor("pl"), "   ").length === 0);
check("nonsense matches nothing", matchTools(indexFor("pl"), "qzxqzx").length === 0);

/* ── the two lists are always full ───────────────────────────────────────── */

const COUNTS = { top: 3, popular: 6 };
const avail = allDefaults();

const full = splitPopular(FALLBACK_ORDER, avail, false, COUNTS);
check("the registry order alone fills both lists",
  full.top.length === 3 && full.popular.length === 6);
check("no tool appears in both lists",
  full.top.every((c) => !full.popular.some((p) => p.key === c.key)));

const empty = splitPopular([], avail, false, COUNTS);
check("an EMPTY ranking still fills both lists — “nigdy pusty modal”",
  empty.top.length === 3 && empty.popular.length === 6,
  `${empty.top.length} + ${empty.popular.length}`);

const dupes = splitPopular(["compress", "compress", "compress"] as FeatureKey[], avail, false, COUNTS);
check("a ranking that repeats itself is de-duplicated and padded",
  dupes.top.length === 3 && new Set([...dupes.top, ...dupes.popular].map((c) => c.key)).size === 9,
  dupes.top.map((c) => c.key).join(", "));

// A module switched off must not reach the grid, and must not leave a hole.
const hidden: AvailabilityMap = {
  ...avail,
  compress: { ...avail.compress, status: "DISABLED" },
  retouch: { ...avail.retouch, status: "DISABLED" },
};
const filtered = splitPopular(["compress", "retouch", "generator", "prompts"] as FeatureKey[], hidden, false, COUNTS);
check("a disabled tool is dropped and the next one moves up",
  filtered.top.length === 3
  && !filtered.top.some((c) => c.key === "compress" || c.key === "retouch")
  && filtered.top[0].key === "generator",
  filtered.top.map((c) => c.key).join(", "));
check("…and an admin still sees it, because they are who switches it back on",
  splitPopular(["compress"] as FeatureKey[], hidden, true, COUNTS).top[0].key === "compress");

/* ── the dock ────────────────────────────────────────────────────────────── */

check("five slots, in the brief's order",
  DOCK_SLOTS.map((s) => s.key).join(",") === "home,library,generate,tools,profile",
  DOCK_SLOTS.map((s) => s.key).join(", "));
check("exactly one of them is the primary action", DOCK_SLOTS.filter((s) => s.primary).length === 1);
check("…and it is the middle one", DOCK_SLOTS.findIndex((s) => s.primary) === 2);
check("the withdrawn products module has no slot",
  !DOCK_SLOTS.some((s) => s.href.startsWith("/products")));

for (const [route, expected] of [
  ["/home", "home"],
  ["/library", "library"],
  ["/library?tab=history", "library"],
  ["/library/anything", "library"],
  ["/prompts", "generate"],
  ["/prompts/abc-123", "generate"],
  ["/generator", "generate"],
  ["/generator?prompt=x", "generate"],
  ["/k/moda", "generate"],
  ["/k/moda/ghostMannequin", "generate"],
  ["/tools", "tools"],
  ["/tools/editor", "tools"],
  ["/tools/editor?tool=remove-background", "tools"],
  ["/retusz", "tools"],
  ["/settings", "profile"],
  ["/settings#security", "profile"],
] as const) {
  const lit = DOCK_SLOTS.filter((s) => dockSlotActive(s, route)).map((s) => s.key);
  check(`${route} lights ${expected}`, lit.length === 1 && lit[0] === expected,
    `lit: ${lit.join(", ") || "(nothing)"}`);
}
check("/home does not claim a route that merely starts with it",
  !dockSlotActive(DOCK_SLOTS.find((s) => s.key === "home")!, "/homework"));
check("a route belonging to no slot lights nothing",
  DOCK_SLOTS.every((s) => !dockSlotActive(s, "/credits")));

console.log(failed === 0 ? "\nsearch: all checks passed" : `\nsearch: ${failed} check(s) failed`);
process.exit(failed > 0 ? 1 : 0);
