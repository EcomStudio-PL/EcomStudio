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

function item(i: number): GalleryItem {
  const url = swatch(i);
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
    width: 640,
    height: 640,
    ratio: "1:1",
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
    const g = document.querySelector("[data-probe='library-root'] .grid");
    if (!g) return null;
    const cs = getComputedStyle(g);
    const cols = cs.gridTemplateColumns.split(" ").filter(Boolean);
    const tiles = [...g.children].filter((c) => c.className.includes("aspect-square"));
    const r0 = tiles[0]?.getBoundingClientRect();
    return {
      columns: cols.length,
      colWidth: cols.length ? parseFloat(cols[0]) : 0,
      tiles: tiles.length,
      tileW: r0?.width ?? 0,
      tileH: r0?.height ?? 0,
      gridW: g.getBoundingClientRect().width,
    };
  });
  ok(grid !== null, `${tag}: no grid found`);
  if (grid) {
    ok(grid.columns >= 2, `${tag}: only ${grid.columns} column(s)`);
    // Square tiles, uncut.
    ok(Math.abs(grid.tileW - grid.tileH) <= 1.5, `${tag}: tile not square (${grid.tileW}×${grid.tileH})`);
    // The grid fills its container: no vast dead space on the right.
    const used = grid.columns * grid.colWidth;
    ok(used > grid.gridW - grid.colWidth, `${tag}: grid leaves a column of empty space`);
    // A phone gets two columns; a big monitor gets many.
    if (width <= 430) ok(grid.columns === 2, `${tag}: phone should be 2 columns, got ${grid.columns}`);
    if (width >= 1920) ok(grid.columns >= 6, `${tag}: wide monitor should be ≥6 columns, got ${grid.columns}`);
  }

  /* ── 3. TILE CONTROLS DO NOT OVERLAP ─────────────────────────────────── */
  const controls = await page.evaluate(() => {
    const tile = document.querySelector("[data-probe='library-root'] .aspect-square");
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
    const t = document.querySelector("[data-probe='library-root'] .aspect-square");
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
    const cols = await page.evaluate(() => getComputedStyle(
      document.querySelector("[data-probe='library-root'] .grid")).gridTemplateColumns.split(" ").filter(Boolean).length);
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
  const imgs = await page.$$eval("[data-probe='library-root'] .aspect-square img", (els) =>
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
  const restored = await page.$$eval("[data-probe='library-root'] .aspect-square", (e) => e.length);
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
      const tile = document.querySelector("[data-probe='library-root'] .aspect-square");
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
      const tile = root.querySelector(".aspect-square");
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
      const tile = document.querySelector("[data-probe='library-root'] .aspect-square");
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
    const tileDrift = sk.tileTop - real.tileTop;
    ok(Math.abs(tileDrift) <= 1,
      `${band}: first tile jumps ${tileDrift.toFixed(1)}px between skeleton and page`);
    console.log(`  ${band.padEnd(8)} toolbar drift ${barDrift.toFixed(1)}px, `
      + `tile drift ${tileDrift.toFixed(1)}px`);
  }
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
  await page.click("[data-probe='library-root'] .aspect-square [aria-label='Otwórz']");
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

  console.log("\nCOLUMNS PER VIEWPORT (default density)");
  for (const [label, g] of table) {
    if (g) console.log(`  ${label.padEnd(14)} ${String(g.columns).padStart(2)} cols × ${g.tileW.toFixed(0)}px`);
  }
  console.log(`\nDENSITY SWEEP @1440: ${density.join(" → ")} columns`);
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log("\nFAILURES");
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
})();
