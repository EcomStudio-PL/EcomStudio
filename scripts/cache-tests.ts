/**
 * WHAT GOES INTO A CACHE MUST COME BACK OUT THE SAME SHAPE.
 *
 * This file exists because of one production outage, and it is written to stop
 * that exact class of bug rather than that one instance of it.
 *
 * WHAT HAPPENED. `loadSlots` returned a `Map` from inside `unstable_cache`.
 * Next persists whatever the cached function returns and hands back a
 * DESERIALIZED copy on every hit — and a `Map` does not survive that: it comes
 * back as `{}`. Every caller then did `slots.get(...)` or `slots.has(...)` on a
 * plain object and threw "get is not a function". Four routes at once —
 * /home, /tools, /prompts and the generator at /k/[cat]/[wf] — all showing the
 * error boundary.
 *
 * WHY NOTHING CAUGHT IT. On a cache MISS the value never round-trips: the
 * function's own return value is passed straight through, a real Map, and
 * everything works. Only the first HIT breaks. So every build passed, every
 * probe passed, the first request after each deploy passed — and the crash
 * arrived later, with no deployment behind it to blame.
 *
 * SO THE TEST IS THE ROUND TRIP ITSELF. `A` proves the shipped payload
 * survives JSON with the fields the renderers actually read. `B` is the guard
 * for the future: it reads the source of every `unstable_cache` call in the
 * repo and fails if any of them is declared to return something JSON cannot
 * carry — a Map, a Set, a Date, a class instance. Adding one is now a failing
 * test rather than a production incident ten minutes later.
 *
 * Run: npm run test:cache
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import type { ResolvedSlot } from "../lib/server/media-slots";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail !== undefined ? ` — ${detail}` : ""}`); }
}

/** What a cache hit does to a value, in one line. */
const roundTrip = <T,>(v: T): unknown => JSON.parse(JSON.stringify(v));

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("A. THE SLOT PAYLOAD SURVIVES A CACHE HIT");

const SLOT: ResolvedSlot = {
  key: "tools.card.retouch",
  mediaType: "image",
  alt: "Retusz",
  fit: "cover",
  position: "center center",
  autoplay: false,
  muted: true,
  loop: true,
  controls: false,
  desktop: "https://example.supabase.co/storage/v1/object/public/media/a.webp",
  desktopWidth: 1600,
  desktopHeight: 900,
  variants: { "800": "https://example.supabase.co/storage/v1/object/public/media/a-800.webp" },
  tablet: "https://example.supabase.co/storage/v1/object/public/media/a-t.webp",
  mobile: "https://example.supabase.co/storage/v1/object/public/media/a-m.webp",
  poster: "https://example.supabase.co/storage/v1/object/public/media/a-p.webp",
};

// THE MAP IS THE BUG. Kept as a live demonstration so the reason this file
// exists cannot be mistaken for a style rule.
const asMap = new Map([[SLOT.key, SLOT]]);
const mapAfter = roundTrip(asMap) as Record<string, unknown>;
check("a Map does not survive a cache hit — it comes back as {}",
  typeof (mapAfter as { get?: unknown }).get !== "function" && Object.keys(mapAfter).length === 0,
  JSON.stringify(mapAfter));

// THE RECORD IS THE FIX.
const asRecord: Record<string, ResolvedSlot> = { [SLOT.key]: SLOT };
const recordAfter = roundTrip(asRecord) as Record<string, ResolvedSlot>;
check("a Record does survive it, whole", JSON.stringify(recordAfter) === JSON.stringify(asRecord));

const rebuilt = new Map(Object.entries(recordAfter));
check("…and rebuilding the Map from it restores the callers' API",
  typeof rebuilt.get === "function" && typeof rebuilt.has === "function"
  && rebuilt.has(SLOT.key) && rebuilt.size === 1);

// Every field a renderer reads, still there after the trip. A silently
// dropped `fit` or `variants` would be a layout bug nobody could trace back
// to the cache.
const back = rebuilt.get(SLOT.key)!;
for (const field of [
  "key", "mediaType", "alt", "fit", "position", "autoplay", "muted", "loop",
  "controls", "desktop", "desktopWidth", "desktopHeight", "tablet", "mobile", "poster",
] as const) {
  check(`…${field} survives`, JSON.stringify(back[field]) === JSON.stringify(SLOT[field]),
    `${JSON.stringify(back[field])} vs ${JSON.stringify(SLOT[field])}`);
}
check("…and so does the srcset map",
  JSON.stringify(back.variants) === JSON.stringify(SLOT.variants));

// An unfilled slot is an absent key, not a null row — the surfaces branch on
// `has`, so an empty payload has to mean "draw the fallback".
const empty = new Map(Object.entries(roundTrip({}) as Record<string, ResolvedSlot>));
check("an empty payload rebuilds into an empty Map, not a crash",
  empty instanceof Map && empty.size === 0 && empty.get("anything") === undefined);

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nB. NO CACHED FUNCTION MAY RETURN SOMETHING JSON CANNOT CARRY");

/** Every .ts/.tsx under these roots, which is where server caching lives. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = [...walk("lib"), ...walk("app")];
const cacheSites: { file: string; returns: string; resolved: string }[] = [];

/**
 * AN ALIAS HIDES THE SHAPE, and that is how the outage got through in the
 * first place: the cached function was declared `Promise<SlotMap>`, and
 * `SlotMap` is `Map<string, ResolvedSlot>` one line higher up. Reading the
 * annotation alone sees a friendly name. So a bare identifier is followed to
 * its `type X = …` in the same file before it is judged.
 */
function resolveAlias(src: string, name: string): string {
  let current = name;
  for (let depth = 0; depth < 4; depth++) {
    if (!/^[A-Za-z_$][\w$]*$/.test(current)) return current;
    const decl = new RegExp(`^\\s*(?:export\\s+)?type\\s+${current}\\s*=\\s*([^;]+);`, "m").exec(src);
    if (!decl) return current;
    current = decl[1].trim();
  }
  return current;
}

for (const file of files) {
  const src = readFileSync(file, "utf8");
  if (!src.includes("unstable_cache(")) continue;
  // The declared return type of the async function handed to unstable_cache:
  //   unstable_cache(async (…): Promise<X> => {
  const rx = /unstable_cache\(\s*async\s*\([^)]*\)\s*:\s*Promise<([^>]*(?:<[^>]*>)?[^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(src)) !== null) {
    const returns = m[1].trim();
    cacheSites.push({ file, returns, resolved: resolveAlias(src, returns) });
  }
}

check("every unstable_cache call declares what it returns",
  cacheSites.length >= 4, `${cacheSites.length} found — the matcher may have gone blind`);

// A positive control: the matcher must really see a Map when one is there.
// Without this, a broken regex would turn section B into a row of free passes.
const CANARY = "unstable_cache(async (k: string): Promise<Map<string, number>> => {";
check("the matcher can actually spot a cached Map (control)",
  /unstable_cache\(\s*async\s*\([^)]*\)\s*:\s*Promise<([^>]*(?:<[^>]*>)?[^>]*)>/.exec(CANARY)?.[1]
    .startsWith("Map<") === true);

// A second control, for the alias path specifically — the one the outage used.
check("the matcher follows a type alias to the Map behind it (control)",
  resolveAlias("export type SlotMap = Map<string, ResolvedSlot>;", "SlotMap").startsWith("Map<"),
  resolveAlias("export type SlotMap = Map<string, ResolvedSlot>;", "SlotMap"));

const UNSERIALIZABLE = /^(Map|Set|WeakMap|WeakSet|Date|RegExp|Promise|Function|Error)\b/;
for (const site of cacheSites) {
  const via = site.resolved === site.returns ? "" : ` (= ${site.resolved})`;
  check(`${site.file} caches ${site.returns}${via}`,
    !UNSERIALIZABLE.test(site.resolved),
    `${site.resolved} cannot survive the cache — it comes back as a plain object`);
}

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nC. THE SLOT READER KEEPS THE CACHE AND THE CALLERS APART");

const slotsSrc = readFileSync("lib/server/media-slots.ts", "utf8");
// Strip the doc comments before grepping for shapes: this file explains the
// bug in prose, and the prose says "Map" more than the code does.
const code = slotsSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

check("the cached function returns a Record",
  /unstable_cache\(\s*async[^)]*\)\s*:\s*Promise<Record<string,\s*ResolvedSlot>>/.test(code),
  "the payload shape changed");
check("loadSlots is what turns it into a Map",
  /new Map\(Object\.entries\(await readSlots\(/.test(code));
check("no Map is constructed inside the cached function",
  !/Promise<Map[\s\S]*?new Map\(/.test(code));

/* ═══════════════════════════════════════════════════════════════════════ */
console.log(failures === 0 ? "\nAll cache tests passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
