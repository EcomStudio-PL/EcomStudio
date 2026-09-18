/**
 * MODA — the five tools, and the optimisation they must not undo.
 *
 * THE ONE THAT MATTERS MOST. Switching workflow inside a category is local
 * state plus a History push; it does NOT navigate. That was a deliberate fix —
 * the route is force-dynamic, so a navigation re-ran auth, workspace, wallet,
 * the model chain, provider health, twenty-four gallery rows and a Storage
 * signing call, none of which depends on which workflow is selected. Adding
 * four tools to that category is exactly the kind of change that quietly
 * reintroduces a `router.push`, a `<Link>` or a server fetch on switch, so
 * section A pins all three shut.
 *
 * The rest guards the things that cost money or lose meaning: a tool that
 * cannot invent its own prompt, two photo pools that must not be flattened
 * into one, and a price that must never be a literal in a component.
 *
 * Run: npm run test:fashion
 */
process.env.APP_ENCRYPTION_KEY = "e".repeat(64); // throwaway, never a real one

import { readFileSync } from "fs";
import { FASHION_TOOLS, FASHION_HINT_MAX, fashionTool } from "../lib/fashion-tools";
import { CATEGORIES, offeredWorkflows } from "../lib/categories";
import { FEATURE_REGISTRY, defaultStatusFor } from "../lib/features";
import { AI_TOOL_KEYS, toolTabs } from "../lib/services/ai-tools";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

/** Comments explain history and quote the code being removed; they are not code. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

async function main() {

/* ── A. ONE TOOL PER SCREEN ──────────────────────────────────────────────── */
console.log("A. A TOOL PAGE OFFERS NO OTHER TOOL");

/*
  THIS SECTION USED TO ASSERT THE OPPOSITE, and the reversal is the product
  decision, not a weakening of the test.

  It guarded a sibling-chip row and the local-switching machinery that made
  clicking one instant: `active` state, a History pushState, a popstate
  listener and a pathname effect. The chips are gone — choosing a tool belongs
  to the category page, which is the one place that has to list them — and
  with no chips there is nothing left to switch client-side, so all four
  became unreachable rather than merely unused.

  What the checks below pin instead: the row does not come back, the dead
  machinery does not come back with it, and the panel is driven by the prop
  the server resolved rather than by state that can go stale.
*/
const runtime = stripComments(readFileSync("components/category/workflow-runtime.tsx", "utf8"));

check("the runtime never calls router.push/replace",
  !/router\s*\.\s*(push|replace|refresh)\s*\(/.test(runtime));

// The row was a list of sibling workflows rendered as chips. Any of these
// coming back means a tool page is advertising other tools again.
check("no sibling row is rendered",
  !/offeredWorkflows\(/.test(runtime)
  && !/offered\.filter\(/.test(runtime)
  && !/aria-current=\{isActive/.test(runtime),
  "choosing a tool belongs to /k/{cat}, not to the tool's own screen");

// The four pieces of switching machinery, named one by one so a partial
// revival fails loudly rather than leaving a listener nothing can trigger.
for (const [what, pattern] of [
  ["local active state", /useState\(/],
  ["History pushState", /window\.history\.pushState\(/],
  ["popstate listener", /popstate/],
  ["pathname effect", /usePathname\(/],
] as const) {
  check(`…and no ${what} survives it`, !pattern.test(runtime));
}

check("the panel follows the prop the server resolved",
  /w\.key === initialWorkflow/.test(runtime),
  "state seeded once would show the previous tool if the router reused this instance");

// A fetch here would put a network round trip inside a component whose whole
// job is to render what the page already resolved.
check("the runtime fetches nothing",
  !/\bfetch\s*\(/.test(runtime) && !/useEffect\([^)]*fetch/.test(runtime));
check("both branches are still keyed by workflow",
  (runtime.match(/key=\{workflow\.key\}/g) ?? []).length === 2, "expected 2");

// WHAT MUST NOT BE COLLATERAL DAMAGE. Removing the row must not touch the
// registry, the routes or the category's own catalogue.
check("the tool registry is untouched",
  FASHION_TOOLS.length === 5 && FASHION_TOOLS.every((t) => t.toolKey && t.operation));

/* ── B. A TOOL'S DATA ARRIVES AS A PROP ──────────────────────────────────
 * If any of it were fetched when a tool becomes active, the switch would be a
 * round trip again. The page resolves all four up front. */
console.log("\nB. TOOL DATA IS RESOLVED BY THE PAGE, NOT ON SWITCH");

const panel = stripComments(readFileSync("components/fashion/tool-workspace.tsx", "utf8"));
const page = stripComments(readFileSync("app/(app)/k/[cat]/[wf]/page.tsx", "utf8"));

check("the page resolves every tool in one batch",
  /FASHION_TOOLS\.map\(/.test(page) && /Promise\.all\(/.test(page));
check("the runtime takes the tool data as a prop",
  /fashion\?\s*:\s*FashionRuntimeData\s*\|\s*null/.test(runtime));
check("the panel does not fetch its own gallery on mount",
  !/useEffect\([\s\S]{0,200}?fetch\(/.test(panel));

/* ── C. NO INVENTED PROMPT, EVER ─────────────────────────────────────────
 * The brief supplies the prompts later and forbids making them up. A tool
 * without one must refuse rather than send something plausible and charge for
 * the result. */
console.log("\nC. A TOOL WITHOUT A PUBLISHED PROMPT REFUSES");

const server = readFileSync("lib/server/fashion.ts", "utf8");
check("the prompt comes from the admin system",
  /resolveSystemPrompt\(supabase, config\.toolKey\)/.test(server));
check("an absent prompt is refused, not substituted",
  /if \(!prompt \|\| !prompt\.trim\(\)\) return \{ ok: false, error: "prompt_unconfigured" \}/.test(server));
// A long string literal in this file would be a built-in prompt by another name.
const longLiterals = (stripComments(server).match(/`[^`]{200,}`/g) ?? []).length;
check("the server module carries no prompt text of its own", longLiterals === 0);
check("the seller's hint is appended, never substituted",
  /\$\{prompt\}\\n\\n\[WSKAZÓWKA OD SPRZEDAWCY\]/.test(server));

/* ── D. TWO POOLS STAY TWO POOLS ─────────────────────────────────────────
 * For "Zmiana postaci" the garment and the person are different inputs. If the
 * two were flattened anywhere between the panel and the provider, the tool
 * would silently do the wrong job and nobody could see why. */
console.log("\nD. THE GARMENT AND THE PERSON NEVER MERGE");

const dual = fashionTool("changePerson");
check("changePerson declares two required pools",
  dual?.slots.length === 2 && dual.slots.every((s) => s.required));
check("its pools are named reference and model",
  dual?.slots.map((s) => s.key).join(",") === "reference,model");
check("it offers no resolution and no hint — its reference shows neither",
  dual?.showResolution === false && dual?.showHint === false);
check("it defaults to Auto framing", dual?.defaultFormat === "auto");
check("the wire keeps the pool names (an object, not an array)",
  /inputs:\s*Record<string,\s*string\[\]>/.test(server));

const route = readFileSync("app/api/fashion/route.ts", "utf8");
check("the route rebuilds pools from the tool's own slot list",
  /for \(const slot of config\.slots\)/.test(route));
check("the route refuses a path outside the caller's workspace",
  /path\.startsWith\(`\$\{workspaceId\}\/`\)/.test(route));

/* ── E. THE THREE SINGLE-INPUT TOOLS SHARE ONE PANEL ─────────────────────── */
console.log("\nE. ONE PANEL, NOT THREE NEAR-IDENTICAL ONES");

const singles = FASHION_TOOLS.filter((tool) => tool.slots.length === 1);
check("three tools take a single pool", singles.length === 3);
/*
  THE PANEL'S SHAPE IS SHARED; THE HINT IS NOT, AND THAT IS DELIBERATE.

  `showHint` was in this set until Wyprasuj dropped its textarea. Leaving it
  in would have meant one of two bad outcomes: the test fails forever, or
  somebody "fixes" it by putting the box back on a tool that has nothing to
  say into it. What must not drift is the geometry — the pool, its size, the
  two selects, the default framing — so that is what is compared, and the
  hint gets its own explicit expectation below.
*/
check("and they share the panel's shape apart from identity",
  new Set(singles.map((t) => JSON.stringify({
    slots: t.slots, r: t.showResolution, f: t.showFormat, d: t.defaultFormat,
  }))).size === 1);
check("the single pool takes 200 photos, as the reference panel says",
  singles.every((t) => t.slots[0]!.max === 200));
check("the hint ceiling matches the reference's 0 / 1000", FASHION_HINT_MAX === 1000);

/* ── E2. WYPRASUJ ASKS FOR NO INSTRUCTION ────────────────────────────────── */
//
// One flag, three consequences to hold in place: the textarea is gone from
// Wyprasuj, it is still there on the two tools that share its panel, and the
// component reaches that outcome through configuration rather than through a
// deletion that would have taken all three.

const iron = FASHION_TOOLS.find((t) => t.key === "iron");
check("Wyprasuj exists and offers no hint field", iron?.showHint === false);
check("…while Niewidzialny manekin still offers one",
  FASHION_TOOLS.find((t) => t.key === "ghostMannequin")?.showHint === true);
check("…and Leżący produkt still offers one",
  FASHION_TOOLS.find((t) => t.key === "flatlay")?.showHint === true);
check("…and nothing else about Wyprasuj moved",
  iron?.showResolution === true && iron?.showFormat === true
  && iron?.defaultFormat === "1:1" && iron?.slots.length === 1
  && iron?.toolKey === "fashion_iron" && iron?.operation === "fashion_iron");

// The panel must stay driven by the flag. A hard-coded textarea would put the
// field back on Wyprasuj; a deleted one would take it from the other two.
check("the panel renders the hint block behind the flag",
  /\{config\.showHint && \(/.test(panel));
// An unconditional hint on the wire would send an empty string where the
// server currently gets nothing at all.
check("…and sends no hint when the flag is off",
  /hint:\s*config\.showHint \?/.test(panel));

/* ── E3. A TOOL PAGE OPENS ON THE TOOL ───────────────────────────────────── */
//
// The hero card — category overline, icon tile, tool name, description — used
// to sit above the switcher on every category tool page. Everything it said
// was already on screen, and it cost the fold. What replaces it is a link
// back to the category and nothing else.

check("the tool page renders no category hero",
  !/<CategoryHeader/.test(runtime) && !/CategoryHeader/.test(runtime));
check("…but it does offer a way back", /data-tool-back/.test(runtime));
// A real href, not history.back(): a tool opened from a bookmark or a shared
// URL has no history entry to return to.
check("…which is a link to the category, not history.back()",
  /href=\{`\/k\/\$\{category\.slug\}`\}/.test(runtime)
  && !/history\.back\(\)/.test(runtime));
// The back link is now the ONLY thing above the panel. Section A pins the
// absence of the chips; this pins that nothing else crept in to replace them.
check("…and the back link is the only band above the panel",
  runtime.indexOf("data-tool-back") < runtime.indexOf("{tool && fashion")
  && !/<nav\b/.test(runtime) && !/<header\b/.test(runtime));

// The CATEGORY page is a different screen and keeps its header: that is where
// the wash and the icon are the subject, and it is where the back link goes.
const categoryPage = readFileSync("app/(app)/k/[cat]/page.tsx", "utf8");
check("the category page still has its header", /<CategoryHeader/.test(categoryPage));
// With one caller gone, the compact variant had no caller at all.
const header = readFileSync("components/category/category-header.tsx", "utf8");
check("and CategoryHeader no longer carries a dead compact variant",
  !/compact/.test(stripComments(header)));

// One component file for all four — a second panel file would be the drift the
// brief asked to avoid.
check("there is exactly one Moda panel component",
  readFileSync("components/fashion/tool-workspace.tsx", "utf8").length > 0
  && !existsSafe("components/fashion/dual-tool-workspace.tsx"));

/* ── E4. ZMIANA POSTACI IS TWO UPLOADS AND ONE DROPDOWN ──────────────────── */
//
// This tool's whole panel is: a reference photo, a model photo, a format. No
// resolution, no hint textarea, no "what the AI will do" card. Every one of
// those was on the panel at some point — the hint and the resolution because
// the three single-input tools spread one config object and it was easy to
// spread it here too, the AI card because the tool briefly had numbered steps
// and the card explained them. Each of them is a thing that comes back by
// accident, so each is named here separately.

console.log("\nE4. ZMIANA POSTACI: TWO POOLS, ONE CONTROL, NOTHING ELSE");

const cp = FASHION_TOOLS.find((t) => t.key === "changePerson");
check("Zmiana postaci exists", !!cp);
check("…offers NO resolution", cp?.showResolution === false);
check("…offers NO hint textarea", cp?.showHint === false);
check("…offers NO 'what the AI will do' card", cp?.showAiNote === false);
check("…offers a format, defaulting to Auto",
  cp?.showFormat === true && cp?.defaultFormat === "auto");

// The other three must not have picked any of this up. A flag flipped on the
// shared SINGLE_INPUT object would silently change three tools at once.
for (const key of ["ghostMannequin", "flatlay", "iron"] as const) {
  const other = FASHION_TOOLS.find((t) => t.key === key);
  check(`…and ${key} still has its resolution`, other?.showResolution === true);
  check(`…and ${key} still has no AI card`, other?.showAiNote === false);
}

// TWO POOLS, IDENTICAL GEOMETRY. Section D pins that they never merge; this
// pins that neither is the bigger or the more important of the two — the
// brief's "both boxes look the same" is a property of the config, not of a
// stylesheet.
check("two pools, reference then model",
  cp?.slots.length === 2 && cp?.slots[0]?.key === "reference" && cp?.slots[1]?.key === "model");
check("…both take the same number of photographs",
  cp?.slots[0]?.max === 10 && cp?.slots[1]?.max === 10);
check("…both are required",
  cp?.slots.every((s) => s.required) === true);
check("…and each says inside its own box which one it is",
  cp?.slots.every((s) => !!s.zoneLabelKey) === true,
  "two identical 'Import' boxes are indistinguishable until something lands in the wrong one");

// THE HEADING NAMES THE POOL AND ITS CAPACITY; THE BOX SAYS WHAT TO DO. These
// were once the other way round, which left "(max. 10)" off the screen.
const plJson = JSON.parse(readFileSync("lib/i18n/dictionaries/pl.json", "utf8"));
const dict = plJson.fashion as Record<string, string>;
for (const slot of cp?.slots ?? []) {
  const heading = dict[slot.labelKey.replace(/^fashion\./, "")] as string;
  const zone = dict[slot.zoneLabelKey!.replace(/^fashion\./, "")] as string;
  check(`the ${slot.key} heading carries the capacity`, /\{n\}/.test(heading ?? ""));
  check(`…and the ${slot.key} box carries the instruction, not the capacity`,
    !!zone && !/\{n\}/.test(zone));
  // NO STEP NUMBERS. "1. Dodaj zdjęcie referencyjne" competed with the pool's
  // own name and taught an order that does not exist.
  check(`…and neither is numbered (${slot.key})`,
    !/^\s*\d+\s*[.)]/.test(heading ?? "") && !/^\s*\d+\s*[.)]/.test(zone));
}
// THE NUMBERS ARE OFF FOR THIS TOOL, NOT ABSENT FROM THE PANEL — and that is
// the reversal, not a weakening. The panel grew a second dual-pool tool whose
// own reference shows numbered blocks, so "the panel numbers nothing" became
// the wrong thing to pin. What matters is unchanged: Zmiana postaci is not
// numbered, and nothing can number it except its own config.
check("Zmiana postaci is not numbered", cp?.numberedSteps === false);
check("…and numbering is reachable only through the config",
  /config\.numberedSteps \&\& slot\.zoneLabelKey/.test(panel)
  && /config\.numberedSteps \? `\$\{config\.slots\.length \+ n\}\. ` : ""/.test(panel),
  "a hard-coded index would number every tool at once");

// A SINGLE CONTROL IS NEVER HALF A ROW. With no resolution to sit beside it,
// `grid-cols-2` would leave Format in a half-width cell with empty space.
check("the controls grid is two columns only when there are two controls",
  /config\.showResolution && config\.showFormat\s*\n?\s*\?\s*"grid-cols-2 lg:grid-cols-1"\s*\n?\s*:\s*"grid-cols-1"/.test(panel),
  "one dropdown must fill the row");

// The three blocks stay behind their flags in the panel, and the wire stays
// clean: a control that is off sends nothing rather than an empty value.
check("the resolution block is behind the flag", /\{\(config\.showResolution \|\| config\.showFormat\) && \(/.test(panel));
check("…the AI card is behind its own flag", /\{config\.showAiNote && \(/.test(panel));
check("…and no resolution goes on the wire when it is off",
  /resolution:\s*config\.showResolution \?/.test(panel));

// THE BOX IS AN EXPLICIT PER-TOOL CHOICE, and this too is a deliberate
// reversal. It used to be derived from `slots.length > 1`, on the reasoning
// that a panel stacking two dropzones cannot give each the room a panel with
// one gives its only one. That still holds — but it is not the whole rule.
// The counter inside the box is redundant only while the HEADING carries the
// capacity, and numbered mode stops it doing that. Two dual-pool tools
// therefore want different boxes, so the SHAPE can no longer decide it.
const uploaderSrc = stripComments(readFileSync("components/genv3/uploader.tsx", "utf8"));
check("the dense box is the tool's own choice, not an inference from the shape",
  /zoneDense=\{config\.denseZones\}/.test(panel)
  && !/zoneDense=\{config\.slots\.length/.test(panel));
check("…and Zmiana postaci still gets the compact one it was given",
  cp?.denseZones === true);
check("…the single-pool tools keep the generous box",
  /zoneDense && "lg:py-4"/.test(uploaderSrc) && /px-4 py-7/.test(uploaderSrc));
check("…and the count line is dropped only where it repeats the heading",
  /\{!zoneDense && \(/.test(uploaderSrc));

// §13 of the brief: the reference screenshot carries Retusz's wording. The
// screenshot decides the LOOK; this tool's own config decides the words.
check("the action is this tool's own, not Retusz's",
  !/retusz/i.test(plJson.wf.moda.changePerson.cta)
  && !/retusz/i.test(plJson.wf.moda.changePerson.name));

/* ── E5. ZMIANA TWARZY MODELA ────────────────────────────────────────────── */
//
// THE FIFTH TOOL, AND THE SECOND DUAL-POOL ONE — which is the whole risk. It
// rhymes with "Zmiana postaci" closely enough that the cheap way to build it
// would have been a flag inside that tool, or a copy of its panel. Neither is
// what happened, and neither may happen later: the two do different jobs, run
// different prompts and own different histories.
//
// What this section pins: the tool exists end to end (registry, category,
// route, admin, availability), its two pools are its own and cannot collapse
// into the other tool's, its panel shows exactly what it is briefed to show,
// and none of it is hard-coded where it would leak into the other four.

console.log("\nE5. ZMIANA TWARZY MODELA: A TOOL OF ITS OWN, NOT A MODE OF ANOTHER");

const cf = FASHION_TOOLS.find((t) => t.key === "changeFace");
check("the tool is registered", !!cf);
check("…under its own tool key", cf?.toolKey === "fashion_change_face");
check("…with its own operation tag, so its results are its own",
  cf?.operation === "fashion_change_face"
  && new Set(FASHION_TOOLS.map((t) => t.operation)).size === FASHION_TOOLS.length);
check("…and it resolves from the route segment",
  fashionTool("changeFace") === cf, "/k/moda/changeFace has to find this config");

// TWO POOLS, AND THE SECOND ONE IS NOT `model`. A face is not the person the
// garment is being moved onto: this tool keeps the whole photograph and
// changes only the face in it. Sharing the key would make the two tools'
// inputs indistinguishable in the request, the prompt and the history.
check("it declares exactly two pools", cf?.slots.length === 2);
check("…named reference and face — never reference and model",
  cf?.slots.map((s) => s.key).join(",") === "reference,face");
check("…both required, so a run cannot start half-supplied",
  cf?.slots.every((s) => s.required) === true);
check("…both capped at ten photographs",
  cf?.slots.every((s) => s.max === 10) === true);
check("…and each says inside its own box which one it is",
  cf?.slots.every((s) => !!s.zoneLabelKey) === true);

// The two dual-pool tools must not converge. If `face` ever became an alias
// for `model`, both tools would post the same shape and the server could no
// longer tell a garment swap from a face swap.
check("the two dual-pool tools keep different second pools",
  cf?.slots[1]?.key !== cp?.slots[1]?.key,
  "changeFace and changePerson would otherwise be the same request");
check("…and `face` is a real slot key, not a string the panel invents",
  /"source" \| "reference" \| "model" \| "face"/.test(
    readFileSync("lib/fashion-tools.ts", "utf8")));

// THE PANEL: two uploads, one dropdown, one explanation. Nothing else.
check("NO resolution", cf?.showResolution === false);
check("NO hint textarea", cf?.showHint === false);
check("a format, defaulting to Auto",
  cf?.showFormat === true && cf?.defaultFormat === "auto");
check("AND the 'what the AI will do' card, which only this tool has",
  cf?.showAiNote === true
  && FASHION_TOOLS.filter((t) => t.showAiNote).length === 1,
  "turning it on for the other four would put a paragraph on every panel");

// NUMBERED, AND ONLY HERE. The numbers were removed from Zmiana postaci on
// purpose; this tool's own reference shows them, so it gets them through its
// config rather than by reviving the shared behaviour.
check("it numbers its blocks", cf?.numberedSteps === true);
check("…and it is the only tool that does",
  FASHION_TOOLS.filter((t) => t.numberedSteps).length === 1);
// Numbered mode moves the capacity into the box's counter, so the box has to
// keep the counter. Both flags on at once would take "max. 10" off the screen.
check("…so it keeps the generous box with its counter",
  cf?.denseZones === false);
check("…and no tool is ever numbered AND compact at the same time",
  FASHION_TOOLS.every((t) => !(t.numberedSteps && t.denseZones)),
  "that combination hides the pool's capacity entirely");

// THE COPY IS THIS TOOL'S. The reference screenshot carries Retusz's wording
// — its CTA, its AI card, its empty state — and none of it may be copied.
for (const locale of ["pl", "en", "de"] as const) {
  const wf = JSON.parse(readFileSync(`lib/i18n/dictionaries/${locale}.json`, "utf8")).wf.moda.changeFace;
  check(`${locale}: name, description, CTA, AI note and empty state all exist`,
    ["name", "sub", "cta", "aiNote", "empty"].every(
      (k) => typeof wf?.[k] === "string" && wf[k].trim().length > 0));
  check(`${locale}: …and none of it is Retusz's`,
    !/retusz|retouch/i.test([wf?.cta, wf?.name, wf?.aiNote].join(" ")));
}
check("the Polish action says what it does", plJson.wf.moda.changeFace.cta === "Zmień twarz");
// A tool that shows the AI card without an `aiNote` renders "Ai note": t()
// humanizes a missing key rather than failing, and this key is interpolated,
// so `i18n:check` cannot see it. This is the only thing that can.
for (const locale of ["pl", "en", "de"] as const) {
  const wfAll = JSON.parse(readFileSync(`lib/i18n/dictionaries/${locale}.json`, "utf8")).wf.moda;
  check(`${locale}: every tool showing the AI card has copy for it`,
    FASHION_TOOLS.filter((t) => t.showAiNote)
      .every((t) => typeof wfAll?.[t.key]?.aiNote === "string" && wfAll[t.key].aiNote.trim().length > 0));
}
check("the panel reads that key rather than reusing the catalogue line",
  /t\(`wf\.moda\.\$\{config\.key\}\.aiNote`\)/.test(panel));

// The three pool phrases the panel needs, in all three languages.
for (const locale of ["pl", "en", "de"] as const) {
  const d = JSON.parse(readFileSync(`lib/i18n/dictionaries/${locale}.json`, "utf8")).fashion;
  check(`${locale}: the face pool has a heading, a box and a nudge`,
    typeof d["slot.face"] === "string" && /\{n\}/.test(d["slot.face"])
    && typeof d["zone.face"] === "string"
    && typeof d["need.face"] === "string");
}

// THE CATEGORY, THE SWITCHBOARD AND THE ADMIN REGISTRY. A tool missing from
// any one of these is either invisible, un-switchable or un-configurable.
check("Moda's catalogue offers it",
  offeredWorkflows(CATEGORIES.find((c) => c.key === "moda")!).some((w) => w.key === "changeFace"));
check("…it is registered as a feature at its own path",
  FEATURE_REGISTRY.some((f) => f.key === "fashion_change_face" && f.path === "/k/moda/changeFace"));
check("…it starts as 'Wkrótce', like every tool without a published prompt",
  defaultStatusFor("fashion_change_face") === "COMING_SOON");
// A separate key is what lets an operator switch THIS tool off without taking
// Zmiana postaci down with it.
check("…and it is its own switch, not a rider on another tool's",
  defaultStatusFor("fashion_change_face") === defaultStatusFor("fashion_change_person")
  && FEATURE_REGISTRY.filter((f) => f.path.startsWith("/k/moda/")).length === 5);
const faceTabs = toolTabs({ key: "fashion_change_face", engineMode: "grovbase", serviceSlug: "image_edit" });
check("…and it is a full admin tool: engine, models, prompt history",
  (AI_TOOL_KEYS as readonly string[]).includes("fashion_change_face")
  && faceTabs.includes("engine") && faceTabs.includes("models") && faceTabs.includes("history"));
// Without the ai_tools row `ai_save_tool_prompt` refuses with `unknown_tool`,
// so the operator can never publish the prompt and the tile never activates.
const migration0098 = readFileSync("supabase/migrations/0098_fashion_change_face.sql", "utf8");
check("…and a migration gives it the row the prompt editor needs",
  /insert into public\.ai_tools/.test(migration0098)
  && /'fashion_change_face'/.test(migration0098)
  && /on conflict \(tool_key\) do nothing/.test(migration0098));

// THE AVAILABILITY GUARD IS A CAST, SO THE REGISTRY IS WHAT MAKES IT REAL.
// app/api/fashion/route.ts writes `config.toolKey as FeatureKey` — a cast
// compiles for a key that is not in the registry, and `featureBlockedForApi`
// would then look up nothing and wave the request through. A tool missing
// from FEATURE_KEYS would therefore be UNSWITCHABLE AND STILL RUNNABLE: the
// operator flips it off in the admin panel and the API keeps generating.
// Asked of every tool, not just this one, because the cast covers them all.
check("every tool's admin key is a real feature key, not just a cast",
  FASHION_TOOLS.every((t) => FEATURE_REGISTRY.some((f) => f.key === t.toolKey)),
  FASHION_TOOLS.filter((t) => !FEATURE_REGISTRY.some((f) => f.key === t.toolKey))
    .map((t) => t.toolKey).join(",") || "—");
check("…and every tool's route is the one the registry guards",
  FASHION_TOOLS.every((t) => FEATURE_REGISTRY.some(
    (f) => f.key === t.toolKey && f.path === `/k/moda/${t.key}`)),
  "a path that disagrees leaves the page and the API guarded by different rows");

// THE PRICE AND THE RESULT COUNT ARE THE SHARED ONES. A second pairing rule
// would be the one place a 10×10 Cartesian product could appear.
check("the result count is the shared longest-pool rule, not a product",
  /counts\.reduce\(\(a, b\) => Math\.max\(a, b\), 0\)/.test(panel)
  && !/reduce\(\(a, b\) => a \* b/.test(panel),
  "ten by ten must never mean a hundred paid generations");

/* ── F. THE PRICE IS NEVER A LITERAL ─────────────────────────────────────── */
console.log("\nF. CREDITS COME FROM CONFIGURATION, NOT FROM THE COMPONENT");

check("the panel takes pricing as a prop", /pricing:\s*Record<string,\s*number>/.test(panel));
check("the panel computes the total as per-image × results",
  /const total = perImage \* runCount/.test(panel));
check("no credit amount is hard-coded in the panel",
  !/(perImage|total)\s*=\s*\d+/.test(stripComments(panel)));
check("the config file names no price at all", !/serviceSlug|credits?\s*:\s*\d+/.test(
  readFileSync("lib/fashion-tools.ts", "utf8")));
check("the server reserves the same figure the panel quoted",
  /costOverride: fashionPrice\(model, resolution\)/.test(server));

/* ── G. ONE CLICK, ONE PAID RUN ──────────────────────────────────────────── */
console.log("\nG. A DOUBLE CLICK CANNOT START TWO PAID BATCHES");

check("the guard is a ref, not state", /const running = useRef\(false\)/.test(panel));
check("and it is checked before anything is spent",
  /if \(running\.current \|\| runCount === 0\) return;/.test(panel));
check("the button is disabled while a batch is in flight",
  /disabled=\{!canRun\}/.test(panel) && /!busy/.test(panel));
check("a run needs every required pool filled",
  /emptyRequired/.test(panel) && /runCount > 0/.test(panel));

/* ── H. EACH TOOL OWNS ITS RESULTS AND ITS SWITCHES ──────────────────────── */
console.log("\nH. FOUR TOOLS, FOUR IDENTITIES");

check("every tool has a distinct operation tag",
  new Set(FASHION_TOOLS.map((t) => t.operation)).size === FASHION_TOOLS.length);
check("every tool has a distinct admin key",
  new Set(FASHION_TOOLS.map((t) => t.toolKey)).size === FASHION_TOOLS.length);

const features = readFileSync("lib/features.ts", "utf8");
const aiTools = readFileSync("lib/services/ai-tools.ts", "utf8");
for (const tool of FASHION_TOOLS) {
  check(`${tool.key}: registered as a feature`, features.includes(`"${tool.toolKey}"`));
  check(`${tool.key}: registered as an admin tool`, aiTools.includes(`"${tool.toolKey}"`));
}
check("all four are model-driven, so the admin gets the prompt tab",
  FASHION_TOOLS.every((t) => new RegExp(`MODEL_DRIVEN[\\s\\S]{0,240}"${t.toolKey}"`).test(aiTools)));

/* ── H2. THE RESPONSIVE SHELL ──────────────────────────────────────────────
 * The panel's breakpoints are not re-invented here: the mobile stack is still
 * the retouch screen's, character for character, because that one has been
 * through the sweep.
 *
 * The DESKTOP column widths deliberately no longer match. Retouch gives its
 * settings 380–430; this panel was measured against its own reference and
 * takes 300–330, so a wide monitor spends the difference on the gallery
 * instead of on whitespace beside two selects. That is a decision, so it is
 * pinned as a number here rather than as "whatever retouch does". */
console.log("\nH2. THE PANEL'S SHELL IS PINNED, NOT INHERITED");

const retouch = readFileSync("components/retouch/workspace.tsx", "utf8");
const SHELL = "lg:grid-cols-[clamp(300px,23vw,330px)_minmax(0,1fr)] lg:items-stretch lg:gap-6 lg:overflow-hidden lg:pb-0";
check("the settings column is the measured 300–330, and the gallery takes the rest",
  panel.includes(SHELL));
check("retouch keeps its own width — this change did not reach another tab",
  retouch.includes("clamp(380px,27vw,430px)"));
/*
  THE EMPTY GALLERY HUGS ITS CONTENTS — the reverse of what this asserted.

  `fillEmpty` stretched the empty state to the column's full height so the two
  columns ended level. Measured at 1280×720 that turned a 217px card into a
  478px one holding four lines of text, which reads as a panel that failed to
  load rather than as a workspace with nothing in it yet. The desktop
  reference and /retusz agree with each other against it, so the prop is gone
  from the whole app rather than merely unused here.

  Asserted against retouch, not a literal: the point is that the two screens
  match, and a literal would fail the day they move together.
*/
const RIGHT_COLUMN = 'className="thin-scroll min-w-0 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pb-4 lg:pr-1"';
check("the results column is the retouch column, to the character",
  panel.includes(RIGHT_COLUMN) && retouch.includes(RIGHT_COLUMN));
check("…and nothing asks the empty state to fill it any more",
  !stripComments(panel).includes("fillEmpty")
  && !stripComments(readFileSync("components/genv3/gallery.tsx", "utf8")).includes("fillEmpty"));

/*
  ROZDZIELCZOŚĆ AND FORMAT STACK ON A DESKTOP.

  Two controls across a 300px settings column give each 146px, which fits "2K"
  and truncates "1:1 (kwadrat)" to "1:1" — a labelled choice reduced to a bare
  number. Below `lg` the panel is the whole page and two across it are fine,
  so this is a `lg:` rule and the phone layout is untouched. A tool showing
  only one of the two keeps a full-width single column at every size.
*/
check("the two controls stack from lg, and only from lg",
  panel.includes('"grid-cols-2 lg:grid-cols-1"'));
check("…while a tool with one control never gets a half-width cell",
  /showResolution && config\.showFormat[\s\S]{0,80}:\s*"grid-cols-1"/.test(panel));
// Compared against retouch rather than against a literal, like the shell
// above it. The literal used to carry `pb-[var(--gen-page-bottom)]`, and
// pinning that here meant the test failed the day the bottom offset moved to
// the one box where it belongs — the app shell's <main> — even though the two
// panels still matched each other perfectly. Neither of these screens docks a
// toolbar, so neither reserves room for one.
const STACK = "gen-shell-body relative grid min-w-0 items-start gap-5 [&>*]:min-w-0";
check("the mobile stack is the same single column below lg",
  retouch.includes(STACK) && panel.includes(STACK));
check("the left column scrolls inside itself rather than the page",
  panel.includes("lg:h-full lg:min-h-0 lg:overflow-y-auto"));
check("the cost island keeps the retouch card's geometry",
  panel.includes('className="panel relative z-20 shrink-0 rounded-2xl px-4 py-3"')
  && retouch.includes('className="panel relative z-20 shrink-0 rounded-2xl px-4 py-3"'));
// Every width the panel names must be a clamp or a breakpoint, never a fixed
// px that a 320px phone cannot honour.
check("no fixed pixel width is set on the panel column",
  !/\bw-\[\d{3,}px\]/.test(panel));

/* ── I. NOTHING ELSE MOVED ───────────────────────────────────────────────── */
console.log("\nI. THE REST OF THE APP IS UNTOUCHED");

const uploader = readFileSync("components/genv3/uploader.tsx", "utf8");
// The shared uploader gained an optional label. Optional is the whole point:
// every existing screen must render exactly as it did.
check("the uploader's new zone label is optional",
  /zoneLabel\?\s*:\s*string;/.test(uploader));
check("and it falls back to the old wording",
  /zoneLabel \?\? t\("genv3\.uploadImport"\)/.test(uploader));
// Same rule for the dense box: optional, so the generator's own upload blocks
// and the three single-input tools render exactly as they did.
check("the uploader's dense box is optional too",
  /zoneDense\?\s*:\s*boolean;/.test(uploader));

const categories = readFileSync("lib/categories.ts", "utf8");
check("the four presets that were already in Moda are still there",
  ["onModel", "street", "editorial", "detail"].every((k) => categories.includes(`key: "${k}"`)));
// Was a count of `tool: true` in the source, which said "there are exactly
// four tools" rather than "only Moda has tools" — so adding a fifth Moda tool
// broke it while nothing it meant to guard had changed. Asked structurally
// now, of the registry rather than of the file's text.
check("no other category gained a tool",
  CATEGORIES.filter((c) => c.key !== "moda")
    .every((c) => c.workflows.every((w) => !w.tool)));
check("…and every Moda tool has a config behind it",
  CATEGORIES.find((c) => c.key === "moda")!.workflows
    .filter((w) => w.tool).every((w) => fashionTool(w.key) !== null));

/* ── J. WHAT MODA OFFERS IS EXACTLY THE FIVE TOOLS ───────────────────────
 * The category's public face — the catalogue on /k/moda and the switcher
 * inside a workspace — must list the five tools and nothing else. The retired
 * presets stay in the registry (section I) so their routes and their copy
 * survive; what this section pins is that they are no longer OFFERED, and that
 * both surfaces answer that question from the same list. */
console.log("\nJ. THE CATEGORY OFFERS FIVE TOOLS, IN ORDER");

const moda = CATEGORIES.find((c) => c.key === "moda")!;
const offered = offeredWorkflows(moda);
// "Zmiana twarzy modela" is LAST, next to the tool it is most easily confused
// with: a seller deciding between "put this outfit on someone else" and "keep
// this photograph, change the face" should see both without scrolling.
const EXPECTED = ["ghostMannequin", "flatlay", "iron", "changePerson", "changeFace"];

check("Moda offers exactly five workflows",
  offered.length === 5, `got ${offered.length}`);
check("and they are the five tools, in the briefed order",
  offered.map((w) => w.key).join(",") === EXPECTED.join(","), offered.map((w) => w.key).join(","));
check("every offered Moda workflow is a tool",
  offered.every((w) => w.tool === true && fashionTool(w.key) !== null));
check("the retired presets are hidden, not deleted and not faked as 'soon'",
  ["onModel", "street", "editorial", "detail"].every((k) => {
    const w = moda.workflows.find((x) => x.key === k);
    return !!w && w.hidden === true && !w.soon;
  }));
check("no other category hides anything",
  CATEGORIES.filter((c) => c.key !== "moda").every((c) => c.workflows.every((w) => !w.hidden)));

const cards = stripComments(readFileSync("components/category/workflow-cards.tsx", "utf8"));
check("the catalogue renders the offered list, not the whole registry",
  /offeredWorkflows\(category\)\.map\(/.test(cards) && !/category\.workflows\.map\(/.test(cards));
// The runtime used to render the offered list as chips; it renders no list at
// all now, so the only consumers left are the catalogue, the category page and
// the media-slot keys — and those three must keep agreeing with each other.
check("the runtime lists no workflows at all",
  !/offeredWorkflows\(/.test(runtime) && !/category\.workflows\.filter\(/.test(runtime));
// Indexing previews off a different list than the grid renders would hand card
// n the thumbnail of card n+1 the moment anything is hidden.
const catPage = stripComments(readFileSync("app/(app)/k/[cat]/page.tsx", "utf8"));
check("the card thumbnails are indexed off the same offered list",
  /offeredWorkflows\(category\)/.test(catPage) && !/category\.workflows\.map\(/.test(catPage));

/* Copy: the four descriptions are the seller's only explanation of what a tool
 * does, and a missing key renders as the key itself. */
console.log("\nJ2. NAMES AND DESCRIPTIONS EXIST IN ALL THREE LANGUAGES");

const PL_NAME: Record<string, string> = {
  ghostMannequin: "Niewidzialny manekin",
  flatlay: "Leżący produkt",
  iron: "Wyprasuj",
  changePerson: "Zmiana postaci",
  changeFace: "Zmiana twarzy modela",
};
for (const locale of ["pl", "en", "de"]) {
  const dict = JSON.parse(readFileSync(`lib/i18n/dictionaries/${locale}.json`, "utf8"));
  const wf = dict?.wf?.moda ?? {};
  check(`${locale}: every offered tool has a name and a description`,
    EXPECTED.every((k) => typeof wf[k]?.name === "string" && wf[k].name.trim().length > 0
      && typeof wf[k]?.sub === "string" && wf[k].sub.trim().length > 0));
}
const pl = JSON.parse(readFileSync("lib/i18n/dictionaries/pl.json", "utf8")).wf.moda;
check("the Polish names are the ones the category is supposed to show",
  EXPECTED.every((k) => pl[k].name === PL_NAME[k]),
  EXPECTED.map((k) => pl[k].name).join(" / "));
}

function existsSafe(path: string): boolean {
  try { readFileSync(path); return true; } catch { return false; }
}

function report() {
  console.log(failures === 0 ? "\nAll Moda tool tests passed." : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().then(report).catch((e) => {
  console.error("fashion tests crashed:", e);
  process.exit(1);
});
