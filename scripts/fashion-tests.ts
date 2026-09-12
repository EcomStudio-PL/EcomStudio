/**
 * MODA — the four tools, and the optimisation they must not undo.
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

/* ── A. THE SWITCH STAYS LOCAL ───────────────────────────────────────────── */
console.log("A. SWITCHING WORKFLOW MUST NOT NAVIGATE");

const runtime = stripComments(readFileSync("components/category/workflow-runtime.tsx", "utf8"));

check("the runtime never calls router.push/replace",
  !/router\s*\.\s*(push|replace|refresh)\s*\(/.test(runtime));
check("the chips are plain anchors, not next/link",
  !/from\s+"next\/link"/.test(runtime));
check("the switch still uses the History API",
  /window\.history\.pushState\(/.test(runtime));
check("the selection is still local state",
  /setActive\(key\)/.test(runtime));
// A fetch here would be a network round trip on every switch — the exact cost
// the optimisation removed.
check("the runtime fetches nothing",
  !/\bfetch\s*\(/.test(runtime) && !/useEffect\([^)]*fetch/.test(runtime));
check("both branches are keyed by workflow, so a switch cannot show stale state",
  (runtime.match(/key=\{workflow\.key\}/g) ?? []).length === 2, "expected 2");

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
check("and they are configured identically apart from identity",
  new Set(singles.map((t) => JSON.stringify({
    slots: t.slots, r: t.showResolution, f: t.showFormat, h: t.showHint, d: t.defaultFormat,
  }))).size === 1);
check("the single pool takes 200 photos, as the reference panel says",
  singles.every((t) => t.slots[0]!.max === 200));
check("the hint ceiling matches the reference's 0 / 1000", FASHION_HINT_MAX === 1000);

// One component file for all four — a second panel file would be the drift the
// brief asked to avoid.
check("there is exactly one Moda panel component",
  readFileSync("components/fashion/tool-workspace.tsx", "utf8").length > 0
  && !existsSafe("components/fashion/dual-tool-workspace.tsx"));

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

/* ── H2. THE RESPONSIVE SHELL IS THE PROVEN ONE, CHARACTER FOR CHARACTER ──
 * The panel's breakpoints are not re-invented here. The retouch screen already
 * ships this exact grid and has been through the mobile sweep, so the strongest
 * guarantee available is that the two strings are identical — a divergence is
 * then a test failure rather than a phone-only bug nobody sees on a desktop. */
console.log("\nH2. THE PANEL REUSES THE SHELL THAT IS ALREADY PROVEN");

const retouch = readFileSync("components/retouch/workspace.tsx", "utf8");
const SHELL = "lg:grid-cols-[clamp(380px,27vw,430px)_minmax(0,1fr)] lg:items-stretch lg:gap-6 lg:overflow-hidden lg:pb-0";
check("the two-column shell matches the retouch panel exactly",
  retouch.includes(SHELL) && panel.includes(SHELL));
check("the mobile stack is the same single column below lg",
  panel.includes("gen-shell-body relative grid min-w-0 items-start gap-5 pb-[var(--gen-page-bottom)]"));
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

const categories = readFileSync("lib/categories.ts", "utf8");
check("the four presets that were already in Moda are still there",
  ["onModel", "street", "editorial", "detail"].every((k) => categories.includes(`key: "${k}"`)));
check("no other category gained a tool",
  (categories.match(/tool: true/g) ?? []).length === 4);

/* ── J. WHAT MODA OFFERS IS EXACTLY THE FOUR TOOLS ───────────────────────
 * The category's public face — the catalogue on /k/moda and the switcher
 * inside a workspace — must list the four tools and nothing else. The retired
 * presets stay in the registry (section I) so their routes and their copy
 * survive; what this section pins is that they are no longer OFFERED, and that
 * both surfaces answer that question from the same list. */
console.log("\nJ. THE CATEGORY OFFERS FOUR TOOLS, IN ORDER");

const moda = CATEGORIES.find((c) => c.key === "moda")!;
const offered = offeredWorkflows(moda);
const EXPECTED = ["ghostMannequin", "flatlay", "iron", "changePerson"];

check("Moda offers exactly four workflows",
  offered.length === 4, `got ${offered.length}`);
check("and they are the four tools, in the briefed order",
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
check("the switcher renders the offered list too",
  /offeredWorkflows\(category\)/.test(runtime) && !/category\.workflows\.filter\(/.test(runtime));
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
