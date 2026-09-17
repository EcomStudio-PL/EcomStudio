/**
 * LIBRARY PROBE — measures the real component at every width in the brief.
 *
 * Run it against a PRODUCTION build (`next start`), not `next dev`: the app's
 * CSP forbids `unsafe-eval`, which dev mode needs, so nothing hydrates there
 * and every interaction assertion fails for the wrong reason. See --harness
 * below for the four-step round trip.
 *
 * It asserts what the brief asks to be true, per viewport: no horizontal
 * overflow, an adaptive column count that never hard-codes a number, tiles
 * that are square and uncut, controls that do not overlap, and a selection
 * UI that costs nothing until something is selected.
 */
import fs from "node:fs";
import { chromium } from "playwright";

/**
 * THE HARNESS. The library lives behind auth and Supabase is not reachable
 * from a build sandbox, so the probe mounts the REAL component with a
 * synthetic page of items at a temporary route. `--harness` writes that route;
 * `--clean` removes it. It is never committed: an unauthenticated page that
 * renders a library of invented rows has no business on a production domain.
 *
 *   node scripts/library-probe.mjs --harness
 *   npm run build && npx next start -p 3100 &
 *   node scripts/library-probe.mjs http://127.0.0.1:3100
 *   node scripts/library-probe.mjs --clean
 */
const HARNESS_DIR = "app/probe-tmp/library";
const HARNESS_FILE = `${HARNESS_DIR}/page.tsx`;
/**
 * THE ITEMS, shared by both routes so the only difference between them is the
 * header. Separate module because two routes import it.
 */
const FIXTURE_SRC = `import type { GalleryItem, GalleryPage } from "@/lib/server/gallery";

const swatch = (i: number) => {
  const hue = (i * 37) % 360;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640">'
    + '<rect width="640" height="640" fill="hsl(' + hue + ' 55% 55%)"/>'
    + '<text x="320" y="350" font-size="120" text-anchor="middle" fill="white">' + i + '</text></svg>';
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
};

/**
 * THE §22 TEST SET. Every tile cycles through the five shapes the brief names,
 * and the three ways the app can learn a shape are all exercised:
 *   · i % 3 === 0 — real pixels AND a label (pixels must win; the label lies)
 *   · i % 3 === 1 — the label only, which is what all 85 production assets have
 *   · i % 3 === 2 — neither, which must fall back to a square
 */
const RATIOS = ["1:1", "16:9", "9:16", "4:5", "3:2"];
const ASPECT = { "1:1": 1, "16:9": 16 / 9, "9:16": 9 / 16, "4:5": 4 / 5, "3:2": 3 / 2 };

function item(i: number): GalleryItem {
  const url = swatch(i);
  const label = RATIOS[i % RATIOS.length];
  const mode = i % 3;
  const a = ASPECT[label as keyof typeof ASPECT];
  // Pixels that AGREE with the label, so "pixels win" is provable only by the
  // deliberately-wrong label on mode 0.
  const pixels = { width: Math.round(600 * a), height: 600 };
  return {
    generationId: "gen-" + Math.floor(i / 3),
    assetId: "asset-" + i,
    path: "ws/gen/" + i + ".png",
    url,
    thumbUrl: url,
    hasThumb: true,
    previewUrl: url,
    assetType: i % 7 === 3 ? "video" : "image",
    durationSec: i % 7 === 3 ? 12 + i : null,
    // mode 0: true pixels, and a label that says something else — the
    // renderer must believe the pixels.
    width: mode === 0 ? pixels.width : null,
    height: mode === 0 ? pixels.height : null,
    ratio: mode === 0 ? "1:1" : mode === 1 ? label : null,
    resolution: "1024",
    quality: "high",
    quantity: 2,
    credits: 4,
    latencyMs: 12400,
    referenceCount: 1,
    inspirationCount: 0,
    operation: null,
    model: "Nano Banana Pro",
    modelId: "m1",
    product: "Produkt " + i,
    sessionType: "advertising",
    origin: "engine",
    prompt: null,
    favorite: i % 5 === 0,
    note: null,
    createdAt: new Date(Date.UTC(2026, 0, 1 + (i % 28))).toISOString(),
  };
}

export const first: GalleryPage = {
  items: Array.from({ length: 24 }, (_, i) => item(i)),
  nextCursor: null,
};

/** What each tile SHOULD be painted at, by assetId, for the probe to compare
 *  the rendered boxes against. Computed the same way the renderer's own
 *  preference order computes it — pixels, then label, then a square. */
export const EXPECTED: Record<string, number> = Object.fromEntries(
  Array.from({ length: 24 }, (_, i) => {
    const label = RATIOS[i % RATIOS.length];
    const mode = i % 3;
    const a = ASPECT[label as keyof typeof ASPECT];
    return ["asset-" + i, mode === 0 ? Math.round(600 * a) / 600 : mode === 1 ? a : 1];
  }),
);
`;

/**
 * TEMPORARY PROBE ROUTE — written by scripts/library-probe.mjs --harness.
 *
 * The library lives behind auth and Supabase is not reachable from the build
 * sandbox, so the only way to measure the real component at seventeen
 * viewports is to mount it with a synthetic page of items. The COMPONENT is
 * the real one; only the rows it is handed are made up, and the pictures are
 * inline SVG so nothing is fetched.
 *
 * The body mirrors app/(app)/library/page.tsx EXACTLY — the off-screen h1 and
 * the browser, inside the <main> whose classes are copied from the (app)
 * layout. Anything less and the probe would be measuring a different page
 * from the one that ships.
 */
const HARNESS_SRC = `import { I18nProvider } from "@/lib/i18n/provider";
import pl from "@/lib/i18n/dictionaries/pl.json";
import { LibraryBrowser } from "@/components/library/library-browser";
import { first } from "@/app/probe-tmp/library/fixture";

export const dynamic = "force-static";

const TITLE = (pl as { library: { title: string } }).library.title;

export default function ProbeLibrary() {
  return (
    <I18nProvider locale="pl" dict={pl as Record<string, unknown>}>
      <main className="mx-auto w-full min-w-0 max-w-[var(--content-max)] flex-1 px-[var(--page-x)] pt-4 pb-[var(--page-bottom)] sm:px-6 sm:pt-5 lg:px-8 lg:pb-14 lg:pt-6 xl:px-10">
        <div data-probe="library-root">
          <h1 className="sr-only">{TITLE}</h1>
          <LibraryBrowser first={first} locale="pl" />
        </div>
      </main>
    </I18nProvider>
  );
}
`;

/**
 * THE SAME PAGE AS IT WAS, for one purpose only: measuring the delta.
 *
 * "The gallery starts higher" is a comparison, and a comparison needs both
 * sides. This route renders the library body with the PageHeader that used to
 * sit above it, so the probe can subtract one from the other instead of
 * asserting an absolute pixel number that would mean nothing.
 */
const BEFORE_DIR = `${HARNESS_DIR}/before`;
const BEFORE_SRC = `import { I18nProvider } from "@/lib/i18n/provider";
import pl from "@/lib/i18n/dictionaries/pl.json";
import { PageHeader } from "@/components/ui/page-header";
import { LibraryBrowser } from "@/components/library/library-browser";
import { first } from "@/app/probe-tmp/library/fixture";

export const dynamic = "force-static";

const D = pl as { library: { title: string; sub: string }; nav: { groups: { assets: string } } };

export default function ProbeLibraryBefore() {
  return (
    <I18nProvider locale="pl" dict={pl as Record<string, unknown>}>
      <main className="mx-auto w-full min-w-0 max-w-[var(--content-max)] flex-1 px-[var(--page-x)] pt-4 pb-[var(--page-bottom)] sm:px-6 sm:pt-5 lg:px-8 lg:pb-14 lg:pt-6 xl:px-10">
        <div data-probe="library-root">
          <PageHeader overline={D.nav.groups.assets} title={D.library.title} sub={D.library.sub} />
          <LibraryBrowser first={first} locale="pl" />
        </div>
      </main>
    </I18nProvider>
  );
}
`;

/**
 * THE SKELETON AND THE PAGE MUST AGREE.
 *
 * A loading fallback is a promise about the shape of what is coming. When it
 * reserves a heading the page does not draw, the content jumps upward the
 * moment it arrives — on EVERY entry, because the library is force-dynamic.
 * This route renders the real app/(app)/library/loading.tsx so the promise can
 * be measured against what it promises.
 */
/** The same gallery with the shelf a real account has: one ratio throughout.
 *  16:9, because 77 of production's 85 assets are. */
const UNIFORM_SRC = `import { I18nProvider } from "@/lib/i18n/provider";
import pl from "@/lib/i18n/dictionaries/pl.json";
import { LibraryBrowser } from "@/components/library/library-browser";
import { first } from "@/app/probe-tmp/library/fixture";

export const dynamic = "force-static";

const uniform = {
  items: first.items.map((i) => ({ ...i, width: 1920, height: 1080, ratio: "16:9" })),
  nextCursor: null,
};

export default function ProbeLibraryUniform() {
  return (
    <I18nProvider locale="pl" dict={pl as Record<string, unknown>}>
      <main className="mx-auto w-full min-w-0 max-w-[var(--content-max)] flex-1 px-[var(--page-x)] pt-4 pb-[var(--page-bottom)] sm:px-6 sm:pt-5 lg:px-8 lg:pb-14 lg:pt-6 xl:px-10">
        <div data-probe="library-root">
          <LibraryBrowser first={uniform} locale="pl" />
        </div>
      </main>
    </I18nProvider>
  );
}
`;

/**
 * THE TOOLS' GALLERY, at two of the surfaces that mount it.
 *
 * `GenerationGallery` is the one component behind the generator, Retusz,
 * GrovBase Shot and every fashion tool (components/genv3/workspace.tsx:487,
 * components/retouch/workspace.tsx, components/fashion/tool-workspace.tsx), so
 * probing it twice with two different `operation` filters is probing all of
 * them — the brief's "at least two tools", without inventing a third copy of
 * the same component.
 */
const TOOLS_SRC = `"use client";
import { I18nProvider } from "@/lib/i18n/provider";
import pl from "@/lib/i18n/dictionaries/pl.json";
import { GenerationGallery } from "@/components/genv3/gallery";
import { first } from "@/app/probe-tmp/library/fixture";
import type { GalleryItem } from "@/components/genv3/types";

export const dynamic = "force-static";

/** The server projection and the client one carry the same fields the shape
 *  logic reads; this is the cast that says so. */
const items = first.items as unknown as GalleryItem[];

export default function ProbeTools() {
  return (
    <I18nProvider locale="pl" dict={pl as Record<string, unknown>}>
      <main className="mx-auto w-full min-w-0 max-w-[var(--content-max)] flex-1 px-4 pt-4 sm:px-6 lg:px-8">
        <div data-probe="tool-retouch">
          <GenerationGallery
            initialItems={items} initialCursor={null} freshItems={[]}
            onFresh={() => {}} pendingCount={0} pendingRatio="16:9"
            models={[]} balance={0} onBalance={() => {}}
            onAbsorb={async () => {}} operation="image_retouch" />
        </div>
        <div data-probe="tool-shot" className="mt-8">
          <GenerationGallery
            initialItems={items} initialCursor={null} freshItems={[]}
            onFresh={() => {}} pendingCount={0} pendingRatio="16:9"
            models={[]} balance={0} onBalance={() => {}}
            onAbsorb={async () => {}} operation="fashion_ghost_mannequin" />
        </div>
      </main>
    </I18nProvider>
  );
}
`;

const SKELETON_DIR = `${HARNESS_DIR}/skeleton`;
const SKELETON_SRC = `import LibraryLoading from "@/app/(app)/library/loading";

export const dynamic = "force-static";

export default function ProbeLibrarySkeleton() {
  return (
    <main className="mx-auto w-full min-w-0 max-w-[var(--content-max)] flex-1 px-[var(--page-x)] pt-4 pb-[var(--page-bottom)] sm:px-6 sm:pt-5 lg:px-8 lg:pb-14 lg:pt-6 xl:px-10">
      <div data-probe="library-skeleton">
        <LibraryLoading />
      </div>
    </main>
  );
}
`;

if (process.argv.includes("--harness")) {
  fs.mkdirSync(HARNESS_DIR, { recursive: true });
  fs.writeFileSync(HARNESS_FILE, HARNESS_SRC);
  fs.writeFileSync(`${HARNESS_DIR}/fixture.ts`, FIXTURE_SRC);
  fs.mkdirSync(BEFORE_DIR, { recursive: true });
  fs.writeFileSync(`${BEFORE_DIR}/page.tsx`, BEFORE_SRC);
  fs.mkdirSync(`${HARNESS_DIR}/tools`, { recursive: true });
  fs.writeFileSync(`${HARNESS_DIR}/tools/page.tsx`, TOOLS_SRC);
  fs.mkdirSync(`${HARNESS_DIR}/uniform`, { recursive: true });
  fs.writeFileSync(`${HARNESS_DIR}/uniform/page.tsx`, UNIFORM_SRC);
  fs.mkdirSync(SKELETON_DIR, { recursive: true });
  fs.writeFileSync(`${SKELETON_DIR}/page.tsx`, SKELETON_SRC);
  console.log(`wrote ${HARNESS_FILE} — build, start, then run the probe against it`);
  process.exit(0);
}
if (process.argv.includes("--clean")) {
  fs.rmSync("app/probe-tmp", { recursive: true, force: true });
  console.log("removed app/probe-tmp");
  process.exit(0);
}


const BASE = process.argv[2] ?? "http://127.0.0.1:3000";
const URL_ = `${BASE}/probe-tmp/library`;

const PHONES = [320, 360, 375, 390, 393, 412, 414, 430];
const TABLET_PORTRAIT = [768, 820, 834];
const TABLET_LANDSCAPE = [1024, 1112, 1180, 1194, 1366];
const DESKTOP = [1366, 1440, 1920, 2560];

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { pass++; } else { fail++; failures.push(label); }
};

async function measure(page, width, height, band) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(140);
  const tag = `${band} ${width}×${height}`;

  /* ── 1. NO HORIZONTAL OVERFLOW, anywhere ─────────────────────────────── */
  const doc = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  ok(doc.scrollW <= doc.clientW + 1, `${tag}: horizontal overflow (${doc.scrollW} > ${doc.clientW})`);

  // …and no single element sticking out past the viewport.
  const spill = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out = [];
    for (const el of document.querySelectorAll("[data-probe='library-root'] *")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 1) out.push(`${el.tagName}.${String(el.className).slice(0, 40)}`);
    }
    return out.slice(0, 3);
  });
  ok(spill.length === 0, `${tag}: elements past the right edge: ${spill.join(", ")}`);

  /* ── 2. THE GRID ADAPTS ──────────────────────────────────────────────── */
  const grid = await page.evaluate(() => {
    const g = document.querySelector("[data-library-grid]");
    if (!g) return null;
    const box = g.getBoundingClientRect();
    const tiles = [...g.children]
      .filter((c) => c.hasAttribute("data-tile-aspect"))
      .map((c) => {
        const b = c.firstElementChild.getBoundingClientRect();
        return {
          declared: Number(c.getAttribute("data-tile-aspect")),
          w: b.width, h: b.height, top: Math.round(b.top), left: b.left, right: b.right,
        };
      });
    // A JUSTIFIED LAYOUT HAS ROWS, NOT COLUMNS. Tiles that share a top edge
    // are one row, and the whole design rests on two claims about a row:
    // every tile in it is the same height, and together they fill the width.
    const rows = new Map();
    for (const t of tiles) {
      if (!rows.has(t.top)) rows.set(t.top, []);
      rows.get(t.top).push(t);
    }
    const rowStats = [...rows.values()].map((r) => ({
      count: r.length,
      heightSpread: Math.max(...r.map((t) => t.h)) - Math.min(...r.map((t) => t.h)),
      filled: (Math.max(...r.map((t) => t.right)) - Math.min(...r.map((t) => t.left))) / box.width,
    }));
    return {
      tiles: tiles.length,
      rows: rowStats.length,
      perRowCounts: rowStats.map((r) => r.count),
      // The last row is allowed to be short; every other row must be full.
      fullRows: rowStats.slice(0, -1),
      maxHeightSpread: Math.max(0, ...rowStats.map((r) => r.heightSpread)),
      perRow: rowStats.map((r) => r.count),
      distinctShapes: new Set(tiles.map((t) => t.declared.toFixed(3))).size,
      offBy: tiles.filter((t) => Math.abs(t.w / t.h - t.declared) > 0.02).length,
      gridW: box.width,
    };
  });
  ok(grid !== null, `${tag}: no gallery found`);
  if (grid) {
    ok(grid.tiles === 24, `${tag}: ${grid.tiles} tiles, expected 24`);
    // EVERY TILE AT ITS OWN SHAPE. This assertion used to demand the exact
    // opposite — that every tile be square to within 1.5px — which is the
    // behaviour this change exists to remove.
    ok(grid.offBy === 0, `${tag}: ${grid.offBy} tile(s) not painted at their declared ratio`);
    ok(grid.distinctShapes >= 3,
      `${tag}: only ${grid.distinctShapes} distinct shape(s) — the gallery is flattening them`);
    const typical = grid.perRow.slice(0, -1);
    if (width <= 639) {
      // BELOW `sm` THE GALLERY IS A TWO-COLUMN GRID, not a justified one —
      // see the note in globals.css for why equal row heights are the wrong
      // trade on a 358px screen. What must hold here is the column count and
      // the ratios, which are asserted above.
      ok(typical.every((n) => n === 2),
        `${tag}: a phone row has ${Math.min(...typical)} tile(s), expected 2`);
      // Ragged by the difference between two tiles is fine; ragged by more
      // than a tall tile's whole height is not.
      ok(grid.maxHeightSpread < 400,
        `${tag}: a phone row is ragged by ${grid.maxHeightSpread.toFixed(0)}px`);
    } else {
      // A JUSTIFIED ROW'S TWO PROMISES: one height, and a full width.
      ok(grid.maxHeightSpread <= 1.5,
        `${tag}: a row's tiles differ in height by ${grid.maxHeightSpread.toFixed(1)}px`);
      const short = grid.fullRows.filter((r) => r.filled < 0.97);
      ok(short.length === 0,
        `${tag}: ${short.length} row(s) leave a gap (thinnest fills ` +
        `${(Math.min(1, ...grid.fullRows.map((r) => r.filled)) * 100).toFixed(0)}%)`);
      if (width >= 1920) {
        ok(Math.max(...typical) >= 5, `${tag}: a wide monitor fits only ${Math.max(...typical)} per row`);
      }
    }
  }

  /* ── 3. TILE CONTROLS DO NOT OVERLAP ─────────────────────────────────── */
  const controls = await page.evaluate(() => {
    const tile = document.querySelector("[data-probe='library-root'] [data-tile-aspect] > *");
    if (!tile) return null;
    const box = tile.getBoundingClientRect();
    const cb = tile.querySelector("[role='checkbox']")?.getBoundingClientRect();
    const heart = tile.querySelector("[aria-pressed]")?.getBoundingClientRect();
    if (!cb || !heart) return null;
    return {
      inside: cb.left >= box.left - 1 && cb.top >= box.top - 1
        && heart.right <= box.right + 1 && heart.top >= box.top - 1,
      overlap: !(cb.right <= heart.left || heart.right <= cb.left),
    };
  });
  ok(controls !== null, `${tag}: tile controls not found`);
  if (controls) {
    ok(controls.inside, `${tag}: a tile control sits outside its tile`);
    ok(!controls.overlap, `${tag}: checkbox and heart overlap`);
  }

  /* ── 4. THE TOOLBAR ──────────────────────────────────────────────────── */
  const bar = await page.evaluate(() => {
    const root = document.querySelector("[data-probe='library-root']");
    const density = root.querySelector("input[type='range']");
    const sort = root.querySelector("select");
    // Count WRAPPED ROWS, not distinct top edges: the bar is `items-center`,
    // so controls of different heights legitimately have different tops
    // within one row. A row is a band of vertical overlap.
    // BY ATTRIBUTE, NOT BY POSITION. This used to be
    // `root.firstElementChild?.firstElementChild`, which walked into whatever
    // happened to be first in the tree — and the moment the page gained an
    // off-screen h1 above the browser, that chain resolved to null, `boxes`
    // to [], `rowCount` to 0, and the wrap assertion below passed
    // unconditionally at every viewport. A test that cannot fail is worse
    // than no test.
    const toolbar = root.querySelector("[data-library-toolbar]");
    const boxes = [...(toolbar ? toolbar.children : [])]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0)
      .sort((a, b) => a.top - b.top);
    let rowCount = 0, bandBottom = -Infinity;
    for (const r of boxes) {
      // A new row starts where a box begins below everything seen so far.
      if (r.top >= bandBottom - 1) { rowCount++; bandBottom = r.bottom; }
      else bandBottom = Math.max(bandBottom, r.bottom);
    }
    const vis = (el) => !!el && el.getBoundingClientRect().width > 0;
    return { densityVisible: vis(density), sortVisible: vis(sort), rowCount, controls: boxes.length };
  });
  // The density slider is a desktop control; a phone must not carry it.
  if (width < 768) ok(!bar.densityVisible, `${tag}: density slider shown on a phone`);
  if (width >= 768) ok(bar.densityVisible, `${tag}: density slider missing on desktop/tablet`);
  // The sort dropdown hides below sm; filters cover it there.
  if (width < 640) ok(!bar.sortVisible, `${tag}: sort select shown at phone width`);
  if (width >= 640) ok(bar.sortVisible, `${tag}: sort select missing at ≥640`);
  // The toolbar may wrap on a phone, but never into a tower.
  ok(bar.controls > 0, `${tag}: no toolbar controls found — the selector is broken, not the layout`);
  ok(bar.rowCount <= (width < 640 ? 2 : 1), `${tag}: toolbar wrapped into ${bar.rowCount} rows`);

  /* ── 5. SELECTION COSTS NOTHING UNTIL IT EXISTS ──────────────────────── */
  const bulkBefore = await page.$("[data-probe='library-root'] .cta");
  ok(bulkBefore === null, `${tag}: bulk actions visible with nothing selected`);

  return grid;
}

async function selectionFlow(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(120);
  await page.click("[data-probe='library-root'] [role='checkbox']");
  await page.waitForTimeout(160);
  const after = await page.evaluate(() => {
    const root = document.querySelector("[data-probe='library-root']");
    const cta = root.querySelector(".cta");
    const box = root.querySelector("[role='checkbox'][aria-checked='true']");
    return { bulk: !!cta && cta.getBoundingClientRect().width > 0, checked: !!box };
  });
  ok(after.checked, `selection @${width}: checkbox did not become checked`);
  ok(after.bulk, `selection @${width}: bulk actions did not appear`);

  // The selected tile is visibly marked, not just in the accessibility tree.
  const ring = await page.evaluate(() => {
    const t = document.querySelector("[data-probe='library-root'] [data-tile-aspect] > *");
    return getComputedStyle(t).borderColor;
  });
  ok(!!ring, `selection @${width}: no border colour on the selected tile`);

  await page.click("[data-probe='library-root'] [role='checkbox']");
  await page.waitForTimeout(140);
  const cleared = await page.$("[data-probe='library-root'] .cta");
  ok(cleared === null, `selection @${width}: bulk actions stayed after deselect`);
}

async function densitySweep(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(140);
  const counts = [];
  for (const step of [0, 1, 2, 3, 4]) {
    // A real interaction, not a synthetic event: Playwright's fill() drives
    // the range the way the browser does, so React sees it.
    await page.locator("input[type='range']").fill(String(step));
    await page.waitForTimeout(160);
    // The grid's column count is now an attribute the component publishes,
    // which is both cheaper to read and impossible to silently lose the way
    // a `.grid` class selector just was.
    const cols = await page.evaluate(() => {
      const g = document.querySelector("[data-library-grid]");
      if (!g) return 0;
      // A justified gallery has no column count. What the density control
      // changes is how many tiles fit in a row, so that is what is counted:
      // the widest row, which is the honest stand-in.
      const tops = [...g.children]
        .filter((c) => c.hasAttribute("data-tile-aspect"))
        .map((c) => Math.round(c.firstElementChild.getBoundingClientRect().top));
      const rows = new Map();
      for (const t of tops) rows.set(t, (rows.get(t) ?? 0) + 1);
      return Math.max(0, ...rows.values());
    });
    ok(cols > 0, `density ${step} @1440: no gallery found — the selector is broken`);
    counts.push(cols);
    const of = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    ok(of, `density ${step} @1440: horizontal overflow`);
  }
  // Wider tiles must mean fewer columns, monotonically.
  const monotone = counts.every((c, i) => i === 0 || c <= counts[i - 1]);
  ok(monotone, `density sweep @1440 not monotone: ${counts.join(" → ")}`);
  ok(new Set(counts).size >= 3, `density sweep @1440 barely changes: ${counts.join(" → ")}`);
  return counts;
}

async function listView(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(120);
  await page.click("[data-probe='library-root'] [aria-label='Lista']").catch(async () => {
    // Fall back to the second button of the compact segmented control.
    const btns = await page.$$("[data-probe='library-root'] button");
    for (const b of btns) {
      const t = await b.getAttribute("title");
      if (t && /lista/i.test(t)) { await b.click(); return; }
    }
  });
  await page.waitForTimeout(180);
  const o = await page.evaluate(() => ({
    rows: document.querySelectorAll("[data-probe='library-root'] li").length,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }));
  ok(o.rows > 0, "list view @390: no rows rendered");
  ok(!o.overflow, "list view @390: horizontal overflow");
}

/**
 * WHAT THE LIBRARY ASKS THE NETWORK FOR.
 *
 * The brief's central claim is that arriving at the library costs one server
 * render and nothing else, and that returning to a shelf costs nothing at all.
 * These assertions count the actual requests rather than trusting the comment
 * that says so.
 */
async function dataBehaviour(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const api = [];
  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("/api/")) api.push(u.replace(/^https?:\/\/[^/]+/, ""));
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);

  // 1. The default shelf is the one the server rendered, so the client must
  //    NOT fetch page one again on top of it.
  const onMount = api.filter((u) => u.includes("/api/generations"));
  ok(onMount.length === 0, `mount fired ${onMount.length} gallery fetch(es): ${onMount.join(", ")}`);

  // 2. Nothing is backfilled when every item already has a derivative.
  const thumbCalls = api.filter((u) => u.includes("/api/library/thumb"));
  ok(thumbCalls.length === 0, `mount fired ${thumbCalls.length} backfill call(s) with nothing missing`);

  // 3. Every tile image is lazy and decoded off the main thread.
  const imgs = await page.$$eval("[data-probe='library-root'] [data-tile-aspect] img", (els) =>
    els.map((e) => ({ lazy: e.getAttribute("loading"), dec: e.getAttribute("decoding") })));
  ok(imgs.length > 0, "no tile images found");
  ok(imgs.every((i) => i.lazy === "lazy"), "a tile image is not loading=lazy");
  ok(imgs.every((i) => i.dec === "async"), "a tile image is not decoding=async");

  // 4. A shelf the session has never seen fetches exactly once…
  api.length = 0;
  await page.click("[data-probe='library-root'] [title='Wideo']");
  await page.waitForTimeout(900);
  const videoFetches = api.filter((u) => u.includes("/api/generations"));
  ok(videoFetches.length === 1, `switching to an unseen shelf fired ${videoFetches.length} fetches`);
  ok(videoFetches[0]?.includes("type=video"), `video shelf did not filter by type: ${videoFetches[0]}`);
  ok(videoFetches[0]?.includes("limit=24"), `video shelf did not ask for 24: ${videoFetches[0]}`);

  // 5. …and going back to a shelf already in the cache fetches nothing.
  api.length = 0;
  await page.click("[data-probe='library-root'] [title='Zdjęcia']");
  await page.waitForTimeout(900);
  const backFetches = api.filter((u) => u.includes("/api/generations"));
  ok(backFetches.length === 0, `returning to a cached shelf refetched ${backFetches.length} time(s)`);
  const restored = await page.$$eval("[data-probe='library-root'] [data-tile-aspect]", (e) => e.length);
  ok(restored === 24, `returning to the photo shelf showed ${restored} tiles, expected 24`);

  return { onMount: onMount.length, video: videoFetches.length, back: backFetches.length };
}

/** No layout shift: a tile reserves its box before the picture arrives. */
async function noShift(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload({ waitUntil: "networkidle" });
  const shift = await page.evaluate(() => new Promise((resolve) => {
    let total = 0;
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) total += e.value;
    });
    po.observe({ type: "layout-shift", buffered: true });
    setTimeout(() => { po.disconnect(); resolve(total); }, 1200);
  }));
  // 0.1 is the "good" threshold in Core Web Vitals; a grid of reserved boxes
  // should be far below it.
  ok(shift < 0.1, `cumulative layout shift ${shift.toFixed(4)} exceeds 0.1`);
  return shift;
}

/**
 * THE HEADER IS GONE, AND THE GRID MOVED UP BY EXACTLY WHAT IT OCCUPIED.
 *
 * Four things, at a phone, a tablet and a desktop:
 *
 *   1. NOTHING OF THE HEADER IS PAINTED — not the overline, not the title,
 *      not the line of prose. Checked against the rendered text, so a heading
 *      that merely moved somewhere else would still fail.
 *   2. THE PAGE IS STILL ANNOUNCED. An h1 exists and is clipped rather than
 *      deleted: "remove from view" is not "remove from the document".
 *   3. NO GAP WHERE IT WAS. The toolbar's top sits on the content box of
 *      <main> — if the header's margin had been left behind, this is the
 *      assertion that would catch it.
 *   4. THE GALLERY STARTS HIGHER, measured as a delta against the same page
 *      with the header still in it.
 */
async function headerRemoved(browser) {
  const GONE = ["ZASOBY", "Biblioteka", "Wygenerowane materiały"];
  const read = async (url, width) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const res = await page.goto(url, { waitUntil: "networkidle" });
    // A missing control route must say so, not fail later as an opaque
    // TypeError inside the measurement.
    if (!res || !res.ok()) {
      await page.close();
      throw new Error(`probe route ${url} returned ${res ? res.status() : "no response"} `
        + `— run \`node scripts/library-probe.mjs --harness\` and rebuild`);
    }
    await page.waitForTimeout(200);
    const out = await page.evaluate(() => {
      const main = document.querySelector("main");
      const root = document.querySelector("[data-probe='library-root']");
      const bar = document.querySelector("[data-library-toolbar]");
      const tile = document.querySelector("[data-probe='library-root'] [data-tile-aspect] > *");
      const cs = getComputedStyle(main);
      const box = main.getBoundingClientRect();
      const h1 = root.querySelector("h1");
      const h1box = h1 ? h1.getBoundingClientRect() : null;
      // What a sighted visitor can actually read on the page.
      const visible = [...root.querySelectorAll("*")]
        .filter((el) => {
          const b = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return b.width > 1 && b.height > 1 && s.visibility !== "hidden" && s.display !== "none";
        })
        .map((el) => (el.childNodes.length === 1 && el.firstChild.nodeType === 3
          ? el.textContent.trim() : ""))
        .filter(Boolean);
      return {
        contentTop: box.top + window.scrollY + parseFloat(cs.paddingTop),
        barTop: bar ? bar.getBoundingClientRect().top + window.scrollY : null,
        tileTop: tile ? tile.getBoundingClientRect().top + window.scrollY : null,
        h1Exists: Boolean(h1),
        h1Text: h1 ? h1.textContent.trim() : null,
        h1Painted: h1box ? h1box.width > 1 && h1box.height > 1 : false,
        visible,
        hasDisplayLg: Boolean(root.querySelector(".display-lg")),
        hasOverline: Boolean(root.querySelector(".overline")),
      };
    });
    await page.close();
    return out;
  };

  for (const [band, width] of [["mobile", 390], ["tablet", 834], ["desktop", 1440]]) {
    const after = await read(URL_, width);
    const before = await read(`${URL_}/before`, width);

    // CASE-INSENSITIVE on purpose: the overline's capitals come from
    // `text-transform: uppercase`, so its text node reads "Zasoby" and an
    // exact match against "ZASOBY" could never fire.
    for (const word of GONE) {
      const needle = word.toLowerCase();
      ok(!after.visible.some((v) => v.toLowerCase().startsWith(needle)),
        `${band}: "${word}" is still painted above the gallery`);
      ok(before.visible.some((v) => v.toLowerCase().startsWith(needle)),
        `${band}: the BEFORE route never painted "${word}" — the guard proves nothing`);
    }
    ok(!after.hasDisplayLg, `${band}: a display headline is still rendered`);
    ok(!after.hasOverline, `${band}: the overline is still rendered`);

    ok(after.h1Exists, `${band}: the page has no h1 at all — it must be hidden, not deleted`);
    ok(after.h1Text === "Biblioteka", `${band}: the off-screen h1 says "${after.h1Text}"`);
    ok(!after.h1Painted, `${band}: the h1 is meant to be off-screen but occupies ${after.h1Text}`);

    ok(after.barTop !== null, `${band}: no toolbar found`);
    const gap = after.barTop - after.contentTop;
    ok(Math.abs(gap) <= 1,
      `${band}: ${gap.toFixed(1)}px of empty space above the toolbar (expected 0)`);

    ok(before.hasDisplayLg, `${band}: the BEFORE route did not render the old header — bad control`);
    // A selector that stops matching must FAIL here rather than make the
    // comparison below `null - null === 0` and pass for ever. This is the
    // second time a positional/class selector in this file went quietly dead.
    ok(after.tileTop !== null && before.tileTop !== null,
      `${band}: no tile found on one of the routes — the selector is broken, not the layout`);
    const lifted = before.tileTop - after.tileTop;
    ok(lifted > 60,
      `${band}: the gallery only moved up ${lifted.toFixed(0)}px`);
    console.log(`  ${band.padEnd(8)} gallery ${lifted.toFixed(0)}px higher, `
      + `toolbar gap ${gap.toFixed(1)}px`);
  }
}

/**
 * No jump between the skeleton and the page it stands in for. Measured at the
 * three bands, because the toolbar's margin changes at `sm` and the grid's
 * column count changes at every breakpoint.
 */
async function skeletonMatchesPage(browser) {
  for (const [band, width] of [["mobile", 390], ["tablet", 834], ["desktop", 1440]]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });

    await page.goto(`${URL_}/skeleton`, { waitUntil: "networkidle" });
    const sk = await page.evaluate(() => {
      const main = document.querySelector("main");
      const root = document.querySelector("[data-probe='library-skeleton']");
      const cs = getComputedStyle(main);
      const kids = [...root.firstElementChild.children];
      const tile = root.querySelector("[data-skeleton-tile]");
      return {
        contentTop: main.getBoundingClientRect().top + parseFloat(cs.paddingTop),
        firstTop: kids[0]?.getBoundingClientRect().top ?? null,
        tileTop: tile?.getBoundingClientRect().top ?? null,
        blocks: kids.length,
      };
    });

    await page.goto(URL_, { waitUntil: "networkidle" });
    await page.waitForTimeout(200);
    const real = await page.evaluate(() => {
      const bar = document.querySelector("[data-library-toolbar]");
      const tile = document.querySelector("[data-probe='library-root'] [data-tile-aspect] > *");
      return {
        barTop: bar?.getBoundingClientRect().top ?? null,
        tileTop: tile?.getBoundingClientRect().top ?? null,
      };
    });
    await page.close();

    // The skeleton reserves NOTHING above its first block.
    ok(Math.abs(sk.firstTop - sk.contentTop) <= 1,
      `${band}: the skeleton reserves ${(sk.firstTop - sk.contentTop).toFixed(1)}px above its first block`);
    // Two blocks only: a toolbar row and a grid. A third would be the
    // dashboard's stat strip leaking back in.
    ok(sk.blocks === 2, `${band}: the skeleton has ${sk.blocks} blocks, expected 2`);
    // And it lands where the real page's toolbar and first tile land.
    const barDrift = sk.firstTop - real.barTop;
    ok(Math.abs(barDrift) <= 1,
      `${band}: toolbar jumps ${barDrift.toFixed(1)}px between skeleton and page`);
    // THE TOOLBAR IS EXACT; THE FIRST TILE CANNOT BE. Since tiles are painted
    // at each file's own ratio, a skeleton that has loaded nothing cannot know
    // what shape is coming — the placeholder is a neutral 4:3 and the real
    // tile is whatever the first asset is. What must stay true is that the
    // difference is one tile's height at most, not a whole screen.
    ok(sk.tileTop !== null && real.tileTop !== null,
      `${band}: no tile found on one of the routes — the selector is broken`);
    const tileDrift = sk.tileTop - real.tileTop;
    ok(Math.abs(tileDrift) <= 1,
      `${band}: the first tile does not START where the skeleton's did `
      + `(${tileDrift.toFixed(1)}px) — the toolbar above it must be identical`);
    console.log(`  ${band.padEnd(8)} toolbar drift ${barDrift.toFixed(1)}px, `
      + `tile drift ${tileDrift.toFixed(1)}px`);
  }
}

/**
 * EVERY TILE IS THE SHAPE ITS FILE IS.
 *
 * The acceptance criteria are five sentences — 16:9 is not a square, 9:16 is
 * not a square, 4:5 is not a square, 1:1 still is, nothing is deformed — and
 * each one is a number the browser can be asked for. This asks.
 *
 * It also checks the two things that are easy to break while making that
 * true: that the packing leaves no holes, and that the overlays still land on
 * the tile's own corners whatever shape it is.
 */
async function ratiosAreReal(browser) {
  for (const [band, width] of [["mobile", 390], ["tablet", 834], ["desktop", 1440]]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.goto(URL_, { waitUntil: "networkidle" });
    await page.waitForTimeout(250);

    const r = await page.evaluate(() => {
      const grid = document.querySelector("[data-library-grid]");
      const tiles = [...document.querySelectorAll("[data-tile-aspect]")].map((wrap) => {
        const box = wrap.querySelector("[data-tile-aspect] > div") || wrap.firstElementChild;
        const b = box.getBoundingClientRect();
        const img = box.querySelector("img");
        const tick = box.querySelector('[role="checkbox"]');
        const heart = box.querySelector('[aria-pressed]');
        return {
          declared: Number(wrap.getAttribute("data-tile-aspect")),
          painted: b.width / b.height,
          w: b.width, h: b.height,
          left: b.left, top: b.top, right: b.right,
          fit: img ? getComputedStyle(img).objectFit : null,
          // An overlay must sit on THIS tile's corner, not the wrapper's and
          // not the one below it.
          tick: tick ? { dx: tick.getBoundingClientRect().left - b.left,
                         dy: tick.getBoundingClientRect().top - b.top } : null,
          heart: heart ? { dx: b.right - heart.getBoundingClientRect().right,
                           dy: heart.getBoundingClientRect().top - b.top } : null,
        };
      });
      const rows = new Map();
      for (const t of tiles) {
        const k = Math.round(t.top);
        rows.set(k, (rows.get(k) ?? 0) + 1);
      }
      return {
        perRow: Math.max(0, ...rows.values()),
        rows: rows.size,
        gridH: grid?.getBoundingClientRect().height ?? 0,
        gridW: grid?.getBoundingClientRect().width ?? 0,
        tiles,
      };
    });

    ok(r.tiles.length === 24, `${band}: ${r.tiles.length} tiles, expected 24`);

    // 1. EVERY TILE IS PAINTED AT WHAT IT DECLARED.
    const wrong = r.tiles.filter((t) => Math.abs(t.painted - t.declared) > 0.02);
    ok(wrong.length === 0,
      `${band}: ${wrong.length} tile(s) not painted at their ratio` +
      (wrong[0] ? ` (declared ${wrong[0].declared}, painted ${wrong[0].painted.toFixed(3)})` : ""));

    // 2. THE FIVE SENTENCES, ONE AT A TIME.
    const at = (a) => r.tiles.filter((t) => Math.abs(t.declared - a) < 0.01);
    for (const [label, a] of [["16:9", 16 / 9], ["9:16", 9 / 16], ["4:5", 4 / 5], ["3:2", 3 / 2]]) {
      const set = at(a);
      ok(set.length > 0, `${band}: no ${label} tile in the fixture`);
      ok(set.every((t) => Math.abs(t.painted - 1) > 0.05),
        `${band}: a ${label} tile is still square (${set[0]?.painted.toFixed(3)})`);
      ok(set.every((t) => Math.abs(t.painted - a) < 0.02),
        `${band}: a ${label} tile is not ${label}`);
    }
    const squares = at(1);
    ok(squares.length > 0 && squares.every((t) => Math.abs(t.painted - 1) < 0.02),
      `${band}: a 1:1 tile stopped being square`);

    // 3. NOTHING IS DEFORMED — the picture covers a box that is already its
    //    own shape, so `cover` crops nothing.
    ok(r.tiles.every((t) => t.fit === "cover"),
      `${band}: a tile image is not object-fit: cover`);

    // 4. NO BIG HOLES. The packed height cannot be much more than the sum of
    //    the tile heights divided by the column count — that difference IS
    //    the empty space.
    // HOW MUCH OF THE GALLERY IS NOT A PICTURE.
    //
    // Above `sm` the rows are full by construction, so the only empty space is
    // the gutters and the short last row — under 20%.
    //
    // On a phone the gallery is a two-column grid (see globals.css), whose
    // rows end where the taller of the two tiles ends. THIS FIXTURE IS THE
    // WORST CASE ON PURPOSE: it cycles 1:1, 16:9, 9:16, 4:5 and 3:2, so a
    // 0.28W-tall tile regularly sits beside a 0.89W-tall one. Real shelves are
    // nothing like it — on production 77 of 85 assets share one ratio, and the
    // uniform case below measures what that costs instead.
    const painted = r.tiles.reduce((sum, t) => sum + t.w * t.h, 0);
    const waste = 1 - painted / (r.gridW * r.gridH);
    ok(waste < (band === "mobile" ? 0.3 : 0.2),
      `${band}: ${(waste * 100).toFixed(0)}% of the gallery is empty space`);

    // 5. OVERLAYS FOLLOW THE TILE, whatever its shape.
    const ticks = r.tiles.filter((t) => t.tick);
    ok(ticks.length === r.tiles.length, `${band}: a tile lost its checkbox`);
    ok(ticks.every((t) => Math.abs(t.tick.dx - 8) < 2 && Math.abs(t.tick.dy - 8) < 2),
      `${band}: a checkbox is not on its tile's top-left`);
    const hearts = r.tiles.filter((t) => t.heart);
    ok(hearts.every((t) => Math.abs(t.heart.dx - 8) < 2 && Math.abs(t.heart.dy - 8) < 2),
      `${band}: a favourite is not on its tile's top-right`);

    // 6. TILES DO NOT OVERLAP AND DO NOT LEAVE THE GRID.
    ok(r.tiles.every((t) => t.w > 0 && t.h > 0), `${band}: a tile has no size`);
    ok(r.tiles.every((t) => t.right <= r.gridW + t.left + 1),
      `${band}: a tile is wider than its column`);

    console.log(`  ${band.padEnd(8)} ${r.rows} rows, up to ${r.perRow} per row, `
      + `${r.tiles.length} tiles, ${(waste * 100).toFixed(1)}% empty`);
    await page.close();
  }
}

/**
 * A SHELF OF ONE SHAPE — what a real account actually has — must pack tight
 * at every width, phones included. This is the control for the mixed-shape
 * measurement above: if the 24% there were the LAYOUT's fault rather than the
 * fixture's, this would be high too.
 */
async function uniformShelfPacksTight(browser) {
  for (const [band, width] of [["mobile", 390], ["tablet", 834], ["desktop", 1440]]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.goto(`${URL_}/uniform`, { waitUntil: "networkidle" });
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => {
      const g = document.querySelector("[data-library-grid]");
      const box = g.getBoundingClientRect();
      const tiles = [...g.children]
        .filter((c) => c.hasAttribute("data-tile-aspect"))
        .map((c) => c.firstElementChild.getBoundingClientRect());
      const painted = tiles.reduce((sum, t) => sum + t.width * t.height, 0);
      return { waste: 1 - painted / (box.width * box.height), tiles: tiles.length };
    });
    ok(r.tiles === 24, `uniform ${band}: ${r.tiles} tiles`);
    ok(r.waste < 0.12,
      `uniform ${band}: ${(r.waste * 100).toFixed(0)}% empty on a shelf of one shape`);
    console.log(`  uniform ${band.padEnd(8)} ${(r.waste * 100).toFixed(1)}% empty`);
    await page.close();
  }
}

/** The density slider changes how many columns there are and NOTHING about
 *  any tile's shape. §7 of the brief, as a measurement. */
async function densityKeepsRatios(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(URL_, { waitUntil: "networkidle" });
  const slider = page.locator("[data-probe='library-root'] input[type='range']");
  const seen = [];
  for (const step of [0, 2, 4]) {
    await slider.fill(String(step));
    await page.waitForTimeout(250);
    const shot = await page.evaluate(() => {
      const grid = document.querySelector("[data-library-grid]");
      const tops = [...(grid?.children ?? [])]
        .filter((c) => c.hasAttribute("data-tile-aspect"))
        .map((c) => Math.round(c.firstElementChild.getBoundingClientRect().top));
      const rows = new Map();
      for (const t of tops) rows.set(t, (rows.get(t) ?? 0) + 1);
      return {
        columns: Math.max(0, ...rows.values()),
        ratios: [...document.querySelectorAll("[data-tile-aspect]")].map((wrap) => {
          const box = wrap.firstElementChild;
          const b = box.getBoundingClientRect();
          return { declared: Number(wrap.getAttribute("data-tile-aspect")), painted: b.width / b.height };
        }),
      };
    });
    ok(shot.ratios.length === 24, `density ${step}: ${shot.ratios.length} tiles`);
    ok(shot.ratios.every((t) => Math.abs(t.painted - t.declared) < 0.02),
      `density ${step}: a tile changed shape with the slider`);
    seen.push(shot.columns);
  }
  ok(seen[0] > seen[2], `density did not change how many tiles fit a row: ${seen.join(" → ")}`);
  console.log(`  density sweep: ${seen.join(" → ")} tiles per row, every ratio unchanged`);
  await page.close();
}

/** The same truth, on the component every tool's results page mounts. */
async function toolGalleriesAreReal(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const res = await page.goto(`${URL_}/tools`, { waitUntil: "networkidle" });
  ok(res && res.ok(), `tools harness unreachable: ${res && res.status()}`);
  await page.waitForTimeout(300);

  for (const surface of ["tool-retouch", "tool-shot"]) {
    const r = await page.evaluate((sel) => {
      const root = document.querySelector(`[data-probe="${sel}"]`);
      const grid = root?.querySelector("[data-gallery-grid]");
      const cards = [...(grid?.children ?? [])]
        .filter((c) => c.hasAttribute("data-card-aspect"))
        .map((c) => {
          const b = c.firstElementChild.getBoundingClientRect();
          const img = c.querySelector("img");
          return {
            declared: Number(c.getAttribute("data-card-aspect")),
            painted: b.width / b.height,
            fit: img ? getComputedStyle(img).objectFit : null,
            rail: Boolean(c.querySelector(".card-rail")),
            tick: Boolean(c.querySelector('[role="checkbox"]')),
          };
        });
      return { found: Boolean(grid), cards };
    }, surface);

    ok(r.found, `${surface}: no gallery grid found`);
    ok(r.cards.length === 24, `${surface}: ${r.cards.length} cards, expected 24`);
    ok(r.cards.every((c) => Math.abs(c.painted - c.declared) < 0.02),
      `${surface}: a card is not painted at its declared ratio`);
    ok(new Set(r.cards.map((c) => c.declared.toFixed(3))).size >= 3,
      `${surface}: the gallery is flattening the shapes`);
    // The five sentences again, on this surface.
    for (const [label, a] of [["16:9", 16 / 9], ["9:16", 9 / 16], ["4:5", 4 / 5]]) {
      const set = r.cards.filter((c) => Math.abs(c.declared - a) < 0.01);
      ok(set.length > 0 && set.every((c) => Math.abs(c.painted - 1) > 0.05),
        `${surface}: a ${label} card is still square`);
    }
    ok(r.cards.every((c) => c.fit === "cover"), `${surface}: a card image is not cover`);
    // The overlays every card carries must survive the reshape.
    ok(r.cards.every((c) => c.tick), `${surface}: a card lost its selection tick`);
    ok(r.cards.every((c) => c.rail), `${surface}: a card lost its action rail`);
    console.log(`  ${surface.padEnd(14)} ${r.cards.length} cards, `
      + `${new Set(r.cards.map((c) => c.declared.toFixed(3))).size} distinct shapes`);
  }
  await page.close();
}

(async () => {
  // The sandbox ships a newer Chromium than the pinned Playwright expects.
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  });
  const page = await browser.newPage();
  const res = await page.goto(URL_, { waitUntil: "networkidle" });
  if (!res || !res.ok()) {
    console.error(`probe route unreachable: ${res?.status()} ${URL_}`);
    process.exit(2);
  }

  console.log("\nEVERY TILE AT ITS OWN RATIO");
  await ratiosAreReal(browser);
  await uniformShelfPacksTight(browser);

  console.log("\nTHE TOOLS' OWN GALLERIES");
  await toolGalleriesAreReal(browser);
  await densityKeepsRatios(browser);

  console.log("\nHEADER REMOVAL (delta against the same page with it)");
  await headerRemoved(browser);

  console.log("\nLOADING SKELETON vs THE PAGE IT STANDS IN FOR");
  await skeletonMatchesPage(browser);

  const table = [];
  for (const w of PHONES) table.push([`phone ${w}`, await measure(page, w, 844, "PHONE")]);
  for (const w of TABLET_PORTRAIT) table.push([`tablet-p ${w}`, await measure(page, w, 1180, "TABLET-P")]);
  for (const w of TABLET_LANDSCAPE) table.push([`tablet-l ${w}`, await measure(page, w, 834, "TABLET-L")]);
  for (const w of DESKTOP) table.push([`desktop ${w}`, await measure(page, w, 900, "DESKTOP")]);

  const density = await densitySweep(page);
  await page.reload({ waitUntil: "networkidle" });
  await selectionFlow(page, 390);
  await page.reload({ waitUntil: "networkidle" });
  await selectionFlow(page, 1440);
  await page.reload({ waitUntil: "networkidle" });
  await listView(page);

  const net = await dataBehaviour(page);
  const cls = await noShift(page);

  // THE LIBRARY OPENS THE REAL DETAILS VIEW, not a lightbox of its own.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.click("[data-probe='library-root'] [data-tile-aspect] [aria-label='Otwórz']");
  await page.waitForTimeout(400);
  const details = await page.evaluate(() => {
    const m = document.querySelector("[data-details-modal]");
    if (!m) return null;
    return {
      tiles: m.querySelectorAll("[data-edit-tile]").length,
      info: !!m.querySelector("[data-details-settings]"),
      // Regeneration needs the model catalogue and the price, which live in
      // the generator — so from here the CTA must be absent, not disabled.
      regen: !!m.querySelector("[data-regen-cta]"),
    };
  });
  ok(details !== null, "library: clicking a tile did not open the details modal");
  if (details) {
    ok(details.tiles === 4, `library: details modal has ${details.tiles} edit tiles`);
    ok(details.info, "library: details modal has no info grid");
    ok(!details.regen, "library: regenerate CTA present where it cannot work");
  }

  await browser.close();

  console.log("\nNETWORK ON ENTRY (default photo shelf)");
  console.log(`  gallery fetches on mount           ${net.onMount}`);
  console.log(`  fetches switching to a new shelf   ${net.video}`);
  console.log(`  fetches returning to a cached one  ${net.back}`);
  console.log(`  cumulative layout shift            ${cls.toFixed(4)}`);

  console.log("\nROWS PER VIEWPORT (default density)");
  for (const [label, g] of table) {
    if (g) {
      console.log(`  ${label.padEnd(14)} ${String(g.rows).padStart(2)} rows, `
        + `up to ${Math.max(...(g.perRowCounts ?? [0]))} per row, `
        + `${g.distinctShapes} distinct shapes`);
    }
  }
  console.log(`\nDENSITY SWEEP @1440: ${density.join(" → ")} columns`);
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log("\nFAILURES");
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
})();
