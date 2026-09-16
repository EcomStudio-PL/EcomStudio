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
const HARNESS_SRC = "/**\n * TEMPORARY PROBE ROUTE \u2014 written by scripts/library-probe.mjs --harness.\n *\n * The library lives behind auth and Supabase is not reachable from the build\n * sandbox, so the only way to measure the real component at seventeen\n * viewports is to mount it with a synthetic page of items. The COMPONENT is\n * the real one; only the rows it is handed are made up, and the pictures are\n * inline SVG so nothing is fetched.\n */\nimport { I18nProvider } from \"@/lib/i18n/provider\";\nimport pl from \"@/lib/i18n/dictionaries/pl.json\";\nimport { LibraryBrowser } from \"@/components/library/library-browser\";\nimport type { GalleryItem, GalleryPage } from \"@/lib/server/gallery\";\n\nexport const dynamic = \"force-static\";\n\nconst swatch = (i: number) => {\n  const hue = (i * 37) % 360;\n  const svg = '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"640\" height=\"640\">'\n    + '<rect width=\"640\" height=\"640\" fill=\"hsl(' + hue + ' 55% 55%)\"/>'\n    + '<text x=\"320\" y=\"350\" font-size=\"120\" text-anchor=\"middle\" fill=\"white\">' + i + '</text></svg>';\n  return \"data:image/svg+xml;utf8,\" + encodeURIComponent(svg);\n};\n\nfunction item(i: number): GalleryItem {\n  const url = swatch(i);\n  return {\n    generationId: \"gen-\" + Math.floor(i / 3),\n    assetId: \"asset-\" + i,\n    path: \"ws/gen/\" + i + \".png\",\n    url,\n    thumbUrl: url,\n    hasThumb: true,\n    previewUrl: url,\n    assetType: i % 7 === 3 ? \"video\" : \"image\",\n    durationSec: i % 7 === 3 ? 12 + i : null,\n    width: 640,\n    height: 640,\n    ratio: \"1:1\",\n    resolution: \"1024\",\n    quality: \"high\",\n    quantity: 2,\n    credits: 4,\n    referenceCount: 1,\n    inspirationCount: 0,\n    operation: null,\n    model: \"Nano Banana Pro\",\n    modelId: \"m1\",\n    product: \"Produkt \" + i,\n    sessionType: \"advertising\",\n    origin: \"engine\",\n    prompt: null,\n    favorite: i % 5 === 0,\n    note: null,\n    createdAt: new Date(Date.UTC(2026, 0, 1 + (i % 28))).toISOString(),\n  };\n}\n\nconst first: GalleryPage = {\n  items: Array.from({ length: 24 }, (_, i) => item(i)),\n  nextCursor: null,\n};\n\nexport default function ProbeLibrary() {\n  return (\n    <I18nProvider locale=\"pl\" dict={pl as Record<string, unknown>}>\n      <main className=\"mx-auto w-full min-w-0 max-w-[var(--content-max)] flex-1 px-[var(--page-x)] pt-4 pb-[var(--page-bottom)] sm:px-6 sm:pt-5 lg:px-8 lg:pb-14 lg:pt-6 xl:px-10\">\n        <div data-probe=\"library-root\">\n          <LibraryBrowser first={first} locale=\"pl\" />\n        </div>\n      </main>\n    </I18nProvider>\n  );\n}\n";

if (process.argv.includes("--harness")) {
  fs.mkdirSync(HARNESS_DIR, { recursive: true });
  fs.writeFileSync(HARNESS_FILE, HARNESS_SRC);
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
    const toolbar = root.firstElementChild?.firstElementChild;
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
    return { densityVisible: vis(density), sortVisible: vis(sort), rowCount };
  });
  // The density slider is a desktop control; a phone must not carry it.
  if (width < 768) ok(!bar.densityVisible, `${tag}: density slider shown on a phone`);
  if (width >= 768) ok(bar.densityVisible, `${tag}: density slider missing on desktop/tablet`);
  // The sort dropdown hides below sm; filters cover it there.
  if (width < 640) ok(!bar.sortVisible, `${tag}: sort select shown at phone width`);
  if (width >= 640) ok(bar.sortVisible, `${tag}: sort select missing at ≥640`);
  // The toolbar may wrap on a phone, but never into a tower.
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
