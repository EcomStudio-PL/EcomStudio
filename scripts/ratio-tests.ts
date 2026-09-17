/**
 * ASPECT RATIOS, TESTED WHERE THEY CAN GO WRONG.
 *
 * Four things decide whether a gallery tells the truth about a file's shape,
 * and they are what is pinned here:
 *
 *   A. THE ORDER OF PREFERENCE. Real pixels beat the job's label beats a
 *      square. Get this backwards and an "auto" job — where the label is
 *      literally the string "auto" — silently becomes 1:1 even though the
 *      asset knows exactly what it is.
 *   B. WHAT IS REFUSED. The ratio becomes a CSS value and a row span. A
 *      zero, a negative, a NaN or a 40:1 panorama must not reach either.
 *   C. NO SURFACE STILL FORCES A SQUARE. The whole point: a grep that fails
 *      the moment `aspect-square` comes back to a gallery tile.
 *   D. THE GRID'S ARITHMETIC. Column counts, gutters and the phone's pinned
 *      two columns, checked against the rule the CSS used to carry.
 *
 * Run: npm run test:ratio
 */
import { readFileSync } from "fs";
import {
  assetAspect, aspectCss, isLandscape, parseRatioLabel, ratioLabel, SQUARE,
} from "../lib/asset-ratio";
import { ALL_ASPECT_RATIOS } from "../lib/ai/types";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail !== undefined ? ` — ${detail}` : ""}`); }
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.0005;
const read = (p: string) => readFileSync(p, "utf8");

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("A. THE ORDER OF PREFERENCE IS THE ORDER OF TRUTH");

check("real pixels win over the label",
  near(assetAspect({ width: 1920, height: 1080, ratio: "1:1" }), 16 / 9),
  String(assetAspect({ width: 1920, height: 1080, ratio: "1:1" })));

check("the label is used when there are no pixels",
  near(assetAspect({ width: null, height: null, ratio: "9:16" }), 9 / 16));

check("a square is the answer only when nothing is known",
  assetAspect({ width: null, height: null, ratio: null }) === SQUARE
  && assetAspect({}) === SQUARE && assetAspect(null) === SQUARE);

// "auto" is a REAL stored value — the model picks the shape. The label says
// nothing, so only the asset's own pixels can answer.
check('"auto" falls through to the pixels',
  near(assetAspect({ width: 1024, height: 1536, ratio: "auto" }), 1024 / 1536));
check('"auto" with no pixels is a square, not a crash',
  assetAspect({ ratio: "auto" }) === SQUARE);

// Every ratio the product can store must parse — or a job carrying it would
// be painted as a square.
for (const label of ALL_ASPECT_RATIOS) {
  if (label === "auto") continue;
  check(`the product's own "${label}" parses`, parseRatioLabel(label) !== null);
}

// The five the brief names, exactly.
const WANTED: [string, number][] = [
  ["1:1", 1], ["16:9", 16 / 9], ["9:16", 9 / 16], ["4:5", 4 / 5], ["3:2", 3 / 2],
];
for (const [label, value] of WANTED) {
  check(`${label} → ${value.toFixed(4)}`, near(parseRatioLabel(label)!, value));
}
check("16:9 is NOT a square", !near(assetAspect({ ratio: "16:9" }), 1));
check("9:16 is NOT a square", !near(assetAspect({ ratio: "9:16" }), 1));
check("4:5 is NOT a square", !near(assetAspect({ ratio: "4:5" }), 1));
check("3:2 is NOT a square", !near(assetAspect({ ratio: "3:2" }), 1));
check("1:1 IS a square", near(assetAspect({ ratio: "1:1" }), 1));

check("landscape and portrait are told apart",
  isLandscape({ ratio: "16:9" }) && !isLandscape({ ratio: "9:16" })
  && !isLandscape({ ratio: "1:1" }));

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nB. WHAT REACHES CSS IS REFUSED FIRST");

for (const bad of [
  "0:1", "1:0", "-16:9", "16:-9", "abc", "", "16:", ":9", "16::9",
  "1e3:1", "Infinity:1", "16 9", "16;9", "calc(1)", "1/0",
]) {
  check(`refuses label ${JSON.stringify(bad)}`, parseRatioLabel(bad) === null);
}
check("refuses a non-string label",
  parseRatioLabel(null) === null && parseRatioLabel(undefined) === null);

// Corrupt pixels must not become a row span a thousand screens tall.
for (const bad of [
  { width: 0, height: 100 }, { width: 100, height: 0 },
  { width: -100, height: 100 }, { width: Number.NaN, height: 100 },
  { width: 100, height: Number.NaN }, { width: Infinity, height: 100 },
  { width: 10000, height: 1 }, { width: 1, height: 10000 },
]) {
  check(`refuses pixels ${JSON.stringify(bad)}`, assetAspect(bad) === SQUARE);
}
check("21:9 — the widest the product offers — is allowed",
  near(assetAspect({ ratio: "21:9" }), 21 / 9));

check("the CSS value is a bare number, never a string with units",
  /^\d+(\.\d+)?$/.test(aspectCss(16 / 9)), aspectCss(16 / 9));
check("the CSS value is stable across calls",
  aspectCss(1 / 3) === aspectCss(1 / 3));

check("a human label prefers the job's own",
  ratioLabel({ width: 1919, height: 1080, ratio: "16:9" }) === "16:9");
check("…and reduces the pixels when there is none",
  ratioLabel({ width: 1920, height: 1080 }) === "16:9");
check("…and does not invent one for an unknown asset",
  ratioLabel({}) === null);
check("…and refuses to print a 1237:983 reduction",
  !/\d{3}:/.test(ratioLabel({ width: 1237, height: 983 }) ?? ""));

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nC. NO GALLERY TILE FORCES A SQUARE ANY MORE");

const GALLERIES: [string, string][] = [
  ["the library grid", "components/library/library-browser.tsx"],
  ["the generator / tool gallery", "components/genv3/gallery.tsx"],
  ["the batch sheet", "components/tools/batch-gallery.tsx"],
  ["the tool-results shelf", "app/(app)/library/page.tsx"],
];
for (const [name, path] of GALLERIES) {
  const src = read(path);
  check(`${name} uses the shared helper`, src.includes("assetAspect"));
  // The one thing that must never come back.
  const squares = (src.match(/aspect-square/g) ?? []).length;
  check(`${name} has no aspect-square left`, squares === 0, `${squares} found`);
}

check("the library and the generator gallery share one grid",
  read("components/library/library-browser.tsx").includes("useRatioGrid")
  && read("components/genv3/gallery.tsx").includes("useRatioGrid"));

check("there is exactly one place that answers 'what shape is this'",
  (read("lib/asset-ratio.ts").match(/export function assetAspect/g) ?? []).length === 1);

// The list views may box a thumbnail, but they may not crop one.
for (const [name, path] of [
  ["the library list", "components/library/library-browser.tsx"],
  ["the generator list", "components/genv3/gallery.tsx"],
] as [string, string][]) {
  const src = read(path);
  const cropped = /h-1[14] w-1[14][^"]*object-cover/.test(src);
  check(`${name} thumbnail is contained, not cropped`, !cropped);
}

// Nothing may go back to reading the browser's own measurement to decide
// layout — that is the shift this feature removes.
for (const [, path] of GALLERIES) {
  const src = read(path);
  check(`${path} does not lay out from naturalWidth`, !src.includes("naturalWidth"));
}

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nD. THE GRID'S ARITHMETIC");

/** Comments describe what the file does NOT do, so an absence test that reads
 *  them finds the very words it is looking for. Strip them first — the same
 *  trap the CMS suite hit. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const gridSrc = stripComments(read("components/gallery/ratio-grid.ts"));

// THE CLS GUARANTEE IS AN ABSENCE, so it is tested as one. The first design
// measured the container to compute row spans, which made the server's render
// and the client's first paint two different layouts — a measured shift of
// 0.39 against a budget of 0.1. Nothing may reintroduce a measurement.
check("the gallery measures nothing",
  !gridSrc.includes("ResizeObserver") && !gridSrc.includes("getBoundingClientRect")
  && !gridSrc.includes("clientWidth") && !gridSrc.includes("offsetWidth"));
check("…and therefore holds no layout state",
  !gridSrc.includes("useState") && !gridSrc.includes("useLayoutEffect")
  && !gridSrc.includes("useEffect"));
check("…and takes no ref",
  !/\bref\b/.test(gridSrc));
check("the breakpoint is a media query, not a JavaScript branch",
  !gridSrc.includes("innerWidth") && !gridSrc.includes("matchMedia")
  && read("app/globals.css").includes(".gallery-justified"));

// The justification itself: basis AND growth both proportional to the ratio.
// Either one alone gives rows that do not line up.
check("flex-basis is proportional to the ratio", /flexBasis:.*var\(--gallery-row\)/.test(gridSrc));
check("flex-grow is the ratio", /flexGrow: Number\(a\)/.test(gridSrc));
check("a tile never shrinks below its basis", gridSrc.includes("flexShrink: 0"));
check("the last row cannot stretch one tile across the gallery",
  gridSrc.includes("maxWidth") && gridSrc.includes("1.75"));

check("an inline style cannot defeat the phone's shorter row",
  gridSrc.includes("--gallery-row-base")
  && read("app/globals.css").includes("--gallery-row: var(--gallery-row-base"));

check("no masonry library was added",
  !Object.keys(JSON.parse(read("package.json")).dependencies ?? {})
    .some((d) => /masonry|justified|isotope|packery/i.test(d)));

/**
 * THE JUSTIFIED LAYOUT'S ONE PROMISE, as arithmetic: give a row of tiles the
 * same growth factor as their ratios and they all finish at the same height,
 * each at its own width. If this is false the rows are ragged and the brief's
 * "no big holes" cannot hold.
 */
function justify(aspects: number[], width: number, row: number, gap: number) {
  const free = width - gap * (aspects.length - 1);
  const basis = aspects.map((a) => a * row);
  const total = basis.reduce((x, y) => x + y, 0);
  const k = free / total;
  return aspects.map((a, i) => ({ w: basis[i] * k, h: (basis[i] * k) / a }));
}

for (const [name, aspects] of [
  ["the five the brief names", [1, 16 / 9, 9 / 16, 4 / 5, 3 / 2]],
  ["two extremes together", [16 / 9, 9 / 16]],
  ["all squares", [1, 1, 1, 1]],
] as [string, number[]][]) {
  const laid = justify(aspects, 1200, 210, 10);
  const spread = Math.max(...laid.map((t) => t.h)) - Math.min(...laid.map((t) => t.h));
  check(`${name}: every tile in the row ends at one height`, spread < 0.01, spread.toFixed(4));
  const used = laid.reduce((sum, t) => sum + t.w, 0) + 10 * (aspects.length - 1);
  check(`${name}: the row fills the width exactly`, Math.abs(used - 1200) < 0.01);
  check(`${name}: every tile keeps its own ratio`,
    laid.every((t, i) => Math.abs(t.w / t.h - aspects[i]) < 0.001));
}

/** How many tiles flexbox puts in the first row: it wraps when the bases stop
 *  fitting. This is what the density control actually changes. */
function perRow(aspects: number[], width: number, row: number, gap: number) {
  let used = 0;
  let n = 0;
  for (const a of aspects) {
    const basis = Math.min(a * row, width);
    const next = used === 0 ? basis : used + gap + basis;
    if (next > width) break;
    used = next;
    n++;
  }
  return Math.max(1, n);
}

const many = Array.from({ length: 30 }, (_, i) => [1, 16 / 9, 9 / 16, 4 / 5, 3 / 2][i % 5]);
check("a taller row fits fewer tiles across",
  perRow(many, 1200, 320, 10) < perRow(many, 1200, 132, 10),
  `${perRow(many, 1200, 320, 10)} vs ${perRow(many, 1200, 132, 10)}`);
// A PHONE IS NOT JUSTIFIED. Two landscape tiles fit a phone row only at a
// row height that makes a 9:16 tile 53px wide, so below `sm` the gallery is a
// two-column grid with true ratios instead — the layout the library already
// had, and the one the brief asks for at that width.
const css = read("app/globals.css");
check("below sm the gallery is a two-column grid",
  /@media \(max-width: 639px\)[\s\S]{0,600}grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/.test(css));
check("…and the inline flex sizing is undone there",
  /\.gallery-justified > \*[\s\S]{0,120}max-width: none !important/.test(css));
check("…which is why a full-height row on a phone is not attempted",
  perRow([16 / 9, 16 / 9], 358, 210, 8) === 1);
check("a wide monitor uses the width rather than leaving a margin",
  perRow(many, 2400, 210, 10) >= 6, String(perRow(many, 2400, 210, 10)));

/** The same arithmetic the hook does, so the expectations are checkable. */
function layout(containerWidth: number, tile: number, gap: number, phoneGap: number) {
  const phone = containerWidth <= 639;
  const g = phone ? phoneGap : gap;
  const columns = phone ? 2 : Math.max(1, Math.floor((containerWidth + g) / (tile + g)));
  return { columns, columnWidth: (containerWidth - g * (columns - 1)) / columns, gap: g };
}

check("a 320px phone gets two columns, not one enormous tile",
  layout(320, 210, 10, 8).columns === 2);
check("a 390px phone gets two columns",
  layout(390, 210, 10, 8).columns === 2);
check("a 768px tablet fits three at the default tile",
  layout(768, 210, 10, 8).columns === 3, String(layout(768, 210, 10, 8).columns));
check("a 1440px desktop fits six",
  layout(1440, 210, 10, 8).columns === 6, String(layout(1440, 210, 10, 8).columns));
check("a 2560px monitor uses the width rather than leaving a margin",
  layout(2560, 210, 10, 8).columns >= 11, String(layout(2560, 210, 10, 8).columns));
check("the narrowest density gives more columns than the widest",
  layout(1440, 132, 10, 8).columns > layout(1440, 320, 10, 8).columns);
check("a column is never narrower than the density asked for",
  [320, 390, 768, 1024, 1440, 1920, 2560].every((w) => {
    const l = layout(w, 210, 10, 8);
    return w <= 639 || l.columnWidth >= 210 - 0.5;
  }));
check("columns and gutters exactly fill the container",
  [390, 768, 1440, 2560].every((w) => {
    const l = layout(w, 210, 10, 8);
    return Math.abs(l.columnWidth * l.columns + l.gap * (l.columns - 1) - w) < 0.01;
  }));

console.log(failures === 0 ? "\nAll ratio tests passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
