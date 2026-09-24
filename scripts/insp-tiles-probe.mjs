/**
 * THE TWO INSPIRATION TILES, MEASURED — not eyeballed on one screenshot.
 *
 * What it asserts at every width the brief named:
 *   · exactly two tiles under the heading
 *   · equal width to the pixel, and each one half the row minus the gap
 *   · equal height
 *   · neither tile overflows the panel that holds it
 *   · the label is not clipped (scrollWidth vs clientWidth on the text span)
 *   · the section introduces no horizontal page scroll
 *
 * Run: build, start on :3000 with app/probe-tmp/page.tsx present, then
 *      node scripts/insp-tiles-probe.mjs
 */
import { chromium } from "playwright";

const URL = process.argv[2] ?? "http://localhost:3000/probe-tmp";

const WIDTHS = [
  { w: 320, h: 720, label: "320 smallest phone", mobile: true },
  { w: 360, h: 800, label: "360 Android", mobile: true },
  { w: 375, h: 667, label: "375 iPhone SE", mobile: true },
  { w: 390, h: 844, label: "390 iPhone 14", mobile: true },
  { w: 430, h: 932, label: "430 Pro Max", mobile: true },
  { w: 768, h: 1024, label: "768 tablet portrait", mobile: true },
  { w: 820, h: 1180, label: "820 tablet portrait", mobile: true },
  { w: 1024, h: 768, label: "1024 tablet landscape", mobile: true },
  { w: 1280, h: 800, label: "1280 laptop" },
  { w: 1440, h: 900, label: "1440 desktop" },
  { w: 1920, h: 1080, label: "1920 large desktop" },
];

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
});

let failures = 0;
const fail = (vp, msg) => { failures++; console.error(`  ✗ ${vp.label} — ${msg}`); };

for (const vp of WIDTHS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1,
    isMobile: vp.mobile ?? false, hasTouch: vp.mobile ?? false,
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(250);

  const r = await page.evaluate(() => {
    const section = document.querySelector('[data-drop-target="insp"]');
    if (!section) return { error: "no inspiration section" };
    const col = document.querySelector("[data-probe-column]");
    const row = section.querySelector(".grid");
    const tiles = row ? [...row.children] : [];
    const rect = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right }; };
    return {
      count: tiles.length,
      tiles: tiles.map((tl) => {
        const label = tl.querySelector("span:last-child");
        return {
          ...rect(tl),
          text: label?.textContent ?? "",
          clipped: label ? label.scrollWidth > label.clientWidth + 1 : false,
        };
      }),
      rowW: row ? rect(row).w : 0,
      colR: col ? rect(col).r : 0,
      docScroll: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    };
  });

  if (r.error) { fail(vp, r.error); await ctx.close(); continue; }
  if (r.count !== 2) { fail(vp, `expected 2 tiles, got ${r.count}`); await ctx.close(); continue; }

  const [a, b] = r.tiles;
  const dw = Math.abs(a.w - b.w);
  const dh = Math.abs(a.h - b.h);
  if (dw > 1) fail(vp, `tile widths differ by ${dw.toFixed(1)}px (${a.w.toFixed(1)} vs ${b.w.toFixed(1)})`);
  if (dh > 1) fail(vp, `tile heights differ by ${dh.toFixed(1)}px (${a.h.toFixed(1)} vs ${b.h.toFixed(1)})`);
  // 50/50: each tile is half the row minus half the 8px gap.
  const expect = (r.rowW - 8) / 2;
  if (Math.abs(a.w - expect) > 1.5) fail(vp, `tile is ${a.w.toFixed(1)}px, expected ~${expect.toFixed(1)}px (half the row)`);
  for (const tl of r.tiles) {
    if (tl.r > r.colR + 1) fail(vp, `tile "${tl.text}" overflows the panel by ${(tl.r - r.colR).toFixed(1)}px`);
    if (tl.clipped) fail(vp, `label "${tl.text}" is clipped`);
    if (!tl.text.trim()) fail(vp, "a tile has no label");
  }
  if (r.docScroll > r.viewport + 1) fail(vp, `page scrolls horizontally (${r.docScroll} > ${r.viewport})`);

  console.log(
    `  ✓ ${vp.label.padEnd(24)} 2 tiles  ${a.w.toFixed(1)}×${a.h.toFixed(1)}px each  "${a.text}" | "${b.text}"`,
  );
  await ctx.close();
}

await browser.close();
console.log(failures === 0
  ? "\nInspiration tiles: all widths passed."
  : `\n${failures} inspiration tile check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
