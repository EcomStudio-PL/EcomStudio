/**
 * THE DETAILS MODAL, MEASURED IN A REAL BROWSER.
 *
 * Three things were asked for and each is a fact a browser can be asked about,
 * not a claim to be made in a report:
 *
 *   DOWNLOAD — one button, no menu, and what comes back is the file the model
 *   produced, byte for byte, with its own type. Checked by intercepting the
 *   save: a PNG asset must hand over a PNG, a WEBP a WEBP, and the click must
 *   never navigate anywhere near the storage host.
 *   ZOOM AND PAN — at 200% the picture must MOVE when dragged, in every
 *   direction, and must stop at its own edges rather than fly off screen.
 *   Dragging must not scroll the page or move the modal.
 *   PRZED / PO — gone from this modal, with nothing left where it was.
 *
 *   node scripts/details-probe.mjs --harness
 *   npm run build && npx next start -p 3160 &
 *   node scripts/details-probe.mjs http://127.0.0.1:3160
 *   node scripts/details-probe.mjs --clean
 */
import fs from "node:fs";
import { chromium } from "playwright";

const DIR = "app/probe-tmp/details";
const ASSETS = "public/probe-tmp";

/* Two files of two different TYPES, so "the original format" is a thing the
 * probe can read off the saved blob rather than take on trust.
 *
 * THEY ARE WRITTEN AS REAL FILES AND SERVED BY THE APP, not inlined as data
 * URIs, because the product's own Content-Security-Policy says
 * `connect-src 'self' https://*.supabase.co` — a `fetch()` of a data: URI is
 * refused. A fixture the real CSP would not allow proves nothing about the
 * real download.
 *
 * AND THEY ARE 900×1200, PORTRAIT, WHICH IS NOT DECORATION. `object-contain`
 * never enlarges a picture past its own pixels, so a 100px fixture is 100px
 * wide at 200% and there is nothing to pan — the first run of this probe
 * measured exactly that and reported "not pannable" nine times. A portrait
 * picture is TALLER than every one of these viewports is proportionally, so
 * it fits by one axis, and doubling it overflows BOTH on desktop, tablet and
 * phone alike. That is what makes "drag left, drag up, drag back" a question
 * with the same answer in all three bands. */
const FIXTURE = { width: 900, height: 1200 };
const PNG = "/probe-tmp/a.png";
const WEBP = "/probe-tmp/b.webp";

const PAGE_SRC = `"use client";
import { useState } from "react";
import { I18nProvider } from "@/lib/i18n/provider";
import pl from "@/lib/i18n/dictionaries/pl.json";
import { ImageDetails } from "@/components/genv3/image-details";
import type { GalleryItem } from "@/components/genv3/types";

export const dynamic = "force-static";

/** A tall picture so a 200% zoom overflows the viewport on BOTH axes — that
 *  is the only shape that can prove panning up, down, left and right. */
const base = {
  generationId: "gen-1", path: "ws/gen/0.png", thumbUrl: "${PNG}", hasThumb: true,
  previewUrl: "${PNG}", assetType: "image" as const, durationSec: null,
  width: ${FIXTURE.width}, height: ${FIXTURE.height}, ratio: "3:4", resolution: "2K", quality: "high",
  quantity: 1, credits: 4, latencyMs: 1200, referenceCount: 0, inspirationCount: 0,
  operation: null, model: "GPT Image 2 High", modelId: "m1", product: "Sofa",
  sessionType: "advertising" as const, origin: "engine" as const, prompt: "Prompt",
  favorite: false, note: null, createdAt: "2026-08-26T10:00:00.000Z",
};

const ITEMS = [
  { ...base, assetId: "png-asset", url: "${PNG}", path: "ws/gen/0.png" },
  { ...base, assetId: "webp-asset", url: "${WEBP}", path: "ws/gen/1.webp" },
] as unknown as GalleryItem[];

export default function ProbeDetails() {
  const [index, setIndex] = useState(0);
  return (
    <I18nProvider locale="pl" dict={pl as Record<string, unknown>}>
      <div data-probe="details" style={{ minHeight: "100dvh" }}>
        <ImageDetails
          items={ITEMS} index={index} onIndex={setIndex} onClose={() => {}}
          canRegenerate={false} onRegenerate={() => {}}
          onFavorite={() => {}} onDelete={() => {}} onNote={() => {}} />
      </div>
    </I18nProvider>
  );
}
`;

if (process.argv.includes("--harness")) {
  const sharp = (await import("sharp")).default;
  const source = {
    create: {
      width: FIXTURE.width, height: FIXTURE.height, channels: 3,
      background: { r: 38, g: 42, b: 58 },
    },
  };
  fs.mkdirSync(DIR, { recursive: true });
  fs.mkdirSync(ASSETS, { recursive: true });
  fs.writeFileSync(`${DIR}/page.tsx`, PAGE_SRC);
  await sharp(source).png().toFile(`${ASSETS}/a.png`);
  await sharp(source).webp().toFile(`${ASSETS}/b.webp`);
  console.log(`harness written to ${DIR} and ${ASSETS}`);
  process.exit(0);
}
if (process.argv.includes("--clean")) {
  fs.rmSync("app/probe-tmp", { recursive: true, force: true });
  fs.rmSync(ASSETS, { recursive: true, force: true });
  console.log("harness removed");
  process.exit(0);
}

const BASE = process.argv[2] ?? "http://127.0.0.1:3160";
const URL_ = `${BASE}/probe-tmp/details`;

let pass = 0;
const failures = [];
const ok = (cond, label) => { if (cond) pass++; else failures.push(label); };

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
});

/** Where the picture sits right now, and how big it is drawn. */
const readImage = (page) => page.evaluate(() => {
  const box = document.querySelector("[data-zoom-viewport]");
  const img = box?.querySelector("img");
  if (!box || !img) return null;
  const b = box.getBoundingClientRect();
  const i = img.getBoundingClientRect();
  return {
    pannable: box.hasAttribute("data-pannable"),
    cursor: getComputedStyle(box).cursor,
    touch: getComputedStyle(box).touchAction,
    draggable: img.getAttribute("draggable"),
    // The picture's centre relative to the viewport's: zero when centred.
    dx: (i.left + i.width / 2) - (b.left + b.width / 2),
    dy: (i.top + i.height / 2) - (b.top + b.height / 2),
    w: i.width, h: i.height,
    boxW: b.width, boxH: b.height,
    clipped: getComputedStyle(box).overflow,
  };
});

async function drag(page, fromDx, fromDy) {
  const box = await page.locator("[data-zoom-viewport]").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  // Several steps: one jump can be swallowed as a click.
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(cx + (fromDx * i) / 6, cy + (fromDy * i) / 6);
  }
  await page.mouse.up();
  await page.waitForTimeout(80);
}

const setZoom = async (page, target) => {
  for (let i = 0; i < 12; i++) {
    const now = Number((await page.locator("[data-zoom-bar] span").first().textContent()).replace("%", ""));
    if (now === target) return;
    await page.locator(`[data-zoom-bar] button[aria-label="${now < target ? "Powiększ" : "Pomniejsz"}"]`).click();
    await page.waitForTimeout(60);
  }
};

/* ── 1. THE MODAL'S TOOLBAR ──────────────────────────────────────────────── */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const res = await page.goto(URL_, { waitUntil: "networkidle" });
  ok(res && res.ok(), `harness unreachable: ${res && res.status()}`);
  await page.waitForTimeout(300);

  const bar = await page.evaluate(() => {
    const zoomBar = document.querySelector("[data-zoom-bar]");
    const text = (document.body.innerText || "");
    return {
      exists: Boolean(zoomBar),
      compareToggle: Boolean(document.querySelector("[data-compare-toggle]")),
      beforeAfter: Boolean(document.querySelector("[data-before-after]")),
      comparePhrase: /przed\s*\/\s*po/i.test(text),
      buttons: [...(zoomBar?.querySelectorAll("button") ?? [])].map((b) => b.getAttribute("aria-label")),
      dividers: (zoomBar?.querySelectorAll("span[aria-hidden]") ?? []).length,
    };
  });
  ok(bar.exists, "no zoom bar");
  // PRZED / PO — gone, and gone completely.
  ok(!bar.compareToggle, "the compare toggle is still in the toolbar");
  ok(!bar.beforeAfter, "the before/after slider still renders");
  ok(!bar.comparePhrase, "the words 'Przed / po' are still on screen");
  ok(bar.buttons.join(",") === "Pomniejsz,Powiększ,Pełny obraz",
    `toolbar is ${bar.buttons.join(",")}`);
  // One divider, not the two the removed button sat between.
  ok(bar.dividers === 1, `${bar.dividers} dividers left in the toolbar`);

  /* ── 2. THE DOWNLOAD BUTTON ───────────────────────────────────────────── */
  const dl = await page.evaluate(() => {
    const btn = document.querySelector("[data-download-btn]");
    if (!btn) return null;
    const svgs = btn.querySelectorAll("svg").length;
    return {
      expanded: btn.getAttribute("aria-expanded"),
      text: btn.textContent.trim(),
      icons: svgs,
      height: btn.getBoundingClientRect().height,
      siblings: [...btn.parentElement.children].length,
    };
  });
  ok(dl !== null, "no download button");
  // A menu button announces itself; this one must not, because there is none.
  ok(dl.expanded === null, "the download button still claims to expand a menu");
  ok(dl.icons === 1, `the download button has ${dl.icons} icons — a chevron is back`);
  ok(dl.text === "Pobierz obraz", `the download button says "${dl.text}"`);
  ok(Math.abs(dl.height - 44) <= 1, `the download button is ${dl.height}px tall`);
  ok(dl.siblings === 3, "the actions row is no longer three equal buttons");

  await page.locator("[data-download-btn]").click();
  await page.waitForTimeout(250);
  const menu = await page.evaluate(() => {
    const t = document.body.innerText;
    return { jpg: /\bJPG\b/.test(t), webp: /\bWEBP\b/.test(t), tiff: /\bTIFF\b/.test(t) };
  });
  ok(!menu.jpg && !menu.webp && !menu.tiff, "a format list appeared after clicking Pobierz");

  /* ── 2b. A PRESSED BUTTON STAYS UNDER THE FINGER ──────────────────────
     The global press feedback used to write `transform`, which REPLACED the
     `-translate-y-1/2` that centres the chevrons over the image: pressing one
     dropped it 18px, the pointer was no longer over it on release, and the
     click never happened. Press and hold, then ask whether the button is
     still where the press landed. */
  {
    const box = await page.locator('[aria-label="Następny"]').boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(200);
    const held = await page.evaluate(({ x, y }) => {
      const btn = document.querySelector('[aria-label="Następny"]');
      const r = btn.getBoundingClientRect();
      const under = document.elementFromPoint(x, y);
      return { covers: x >= r.left && x <= r.right && y >= r.top && y <= r.bottom, hit: Boolean(under && btn.contains(under)) };
    }, { x, y });
    await page.mouse.up();
    await page.waitForTimeout(120);
    ok(held.covers, "the next chevron slides out from under the pointer while pressed");
    ok(held.hit, "a pressed next chevron is no longer the element under the pointer");
    // …and the press actually advanced the picture.
    const advanced = await page.evaluate(() => Boolean(document.querySelector('[aria-label="Poprzedni"]')));
    ok(advanced, "clicking the next chevron did not change the picture");
  }

  await page.close();
}

/* ── 3. THE DOWNLOAD ITSELF ──────────────────────────────────────────────── */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // Intercept the save: the anchor click is what actually writes the file.
  await page.addInitScript(() => {
    window.__saved = [];
    window.__navigated = [];
    const realCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      window.__saved.push({ type: blob.type, size: blob.size });
      return realCreate(blob);
    };
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      window.__navigated.push(this.getAttribute("href") || "");
      window.__downloadName = this.getAttribute("download") || "";
    };
    void realClick;
  });
  await page.goto(URL_, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);

  for (const [label, expectType, expectExt] of [
    ["png", "image/png", ".png"],
    ["webp", "image/webp", ".webp"],
  ]) {
    if (label === "webp") {
      await page.locator('[aria-label="Następny"]').click();
      await page.waitForTimeout(300);
    }
    await page.evaluate(() => { window.__saved = []; window.__navigated = []; });
    await page.locator("[data-download-btn]").click();
    await page.waitForTimeout(900);
    const out = await page.evaluate(() => ({
      saved: window.__saved, navigated: window.__navigated, name: window.__downloadName,
    }));
    ok(out.saved.length === 1, `${label}: ${out.saved.length} blobs handed over, expected 1`);
    // THE ORIGINAL TYPE, not a re-encode.
    ok(out.saved[0]?.type === expectType,
      `${label}: saved as ${out.saved[0]?.type}, expected ${expectType}`);
    ok((out.name || "").endsWith(expectExt),
      `${label}: filename "${out.name}" does not end ${expectExt}`);
    // AND NOWHERE NEAR THE STORAGE HOST.
    ok(!out.navigated.some((h) => h.includes("supabase.co")),
      `${label}: the click reached a supabase.co URL`);
    ok(out.navigated.every((h) => h.startsWith("blob:")),
      `${label}: the click used ${out.navigated.join(",")} rather than a blob`);
  }
  await page.close();
}

/* ── 4. ZOOM, PAN, BOUNDS, RESET ─────────────────────────────────────────── */
for (const [band, width, height] of [
  ["desktop", 1440, 900], ["tablet", 834, 1100], ["mobile", 390, 844],
]) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(URL_, { waitUntil: "networkidle" });
  await page.waitForTimeout(350);

  // At 100% the picture fits, so there is nothing to pan and no grab cursor.
  const rest = await readImage(page);
  ok(rest !== null, `${band}: no zoom viewport`);
  ok(rest.clipped === "hidden", `${band}: the viewport is not clipping (${rest.clipped})`);
  ok(rest.draggable === "false", `${band}: the image is still natively draggable`);
  ok(!rest.pannable, `${band}: claims to be pannable at 100%`);
  ok(rest.cursor !== "grab", `${band}: shows a grab cursor with nothing to grab`);
  ok(Math.abs(rest.dx) < 1 && Math.abs(rest.dy) < 1, `${band}: not centred at 100%`);

  await setZoom(page, 200);
  const zoomed = await readImage(page);
  ok(zoomed.w > rest.w * 1.9, `${band}: 200% did not enlarge the picture`);
  ok(zoomed.pannable, `${band}: 200% is not pannable`);
  ok(zoomed.cursor === "grab", `${band}: no grab cursor at 200% (${zoomed.cursor})`);
  ok(zoomed.touch === "none", `${band}: touch-action is ${zoomed.touch}, so a finger scrolls the page`);

  // DRAG LEFT, and the picture moves left.
  const pageYBefore = await page.evaluate(() => window.scrollY);
  await drag(page, -120, -90);
  const moved = await readImage(page);
  ok(moved.dx < zoomed.dx - 20, `${band}: dragging left moved the picture ${(moved.dx - zoomed.dx).toFixed(0)}px`);
  ok(moved.dy < zoomed.dy - 20, `${band}: dragging up moved the picture ${(moved.dy - zoomed.dy).toFixed(0)}px`);
  // …and nothing else moved.
  ok((await page.evaluate(() => window.scrollY)) === pageYBefore, `${band}: the page scrolled during a pan`);
  ok((await page.evaluate(() =>
    document.querySelector("[data-details-modal]")?.getBoundingClientRect().top ?? 0)) >= -1,
  `${band}: the modal itself moved`);

  // DRAG BACK the other way, and it comes back.
  await drag(page, 240, 180);
  const back = await readImage(page);
  ok(back.dx > moved.dx + 20, `${band}: dragging right did not move the picture back`);
  ok(back.dy > moved.dy + 20, `${band}: dragging down did not move the picture back`);

  // BOUNDS. A huge drag cannot push the picture off its own edges: the
  // viewport must still be fully covered by it.
  await drag(page, 4000, 4000);
  const flung = await readImage(page);
  const maxX = (flung.w - flung.boxW) / 2;
  const maxY = (flung.h - flung.boxH) / 2;
  ok(flung.dx <= maxX + 1.5, `${band}: panned ${flung.dx.toFixed(0)}px past the ${maxX.toFixed(0)}px limit`);
  ok(flung.dy <= maxY + 1.5, `${band}: panned ${flung.dy.toFixed(0)}px past the ${maxY.toFixed(0)}px limit`);

  // RESET at 100%.
  await setZoom(page, 100);
  const reset = await readImage(page);
  ok(Math.abs(reset.dx) < 1 && Math.abs(reset.dy) < 1,
    `${band}: back at 100% the picture is still off-centre (${reset.dx.toFixed(0)}, ${reset.dy.toFixed(0)})`);
  ok(!reset.pannable, `${band}: still pannable after returning to 100%`);

  // RESET when the picture changes.
  await setZoom(page, 300);
  await drag(page, -200, -200);
  await page.locator('[aria-label="Następny"]').click();
  await page.waitForTimeout(400);
  const next = await readImage(page);
  const level = await page.locator("[data-zoom-bar] span").first().textContent();
  ok(level.trim() === "100%", `${band}: the next picture opened at ${level}`);
  ok(Math.abs(next.dx) < 1 && Math.abs(next.dy) < 1,
    `${band}: the next picture opened off-centre`);

  // Nothing overflows the page at any of this.
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  ok(!overflow, `${band}: horizontal overflow`);

  console.log(`  ${band.padEnd(8)} ${width}×${height}  `
    + `200% → ${zoomed.w.toFixed(0)}px wide, pan limit ±${maxX.toFixed(0)}/${maxY.toFixed(0)}px`);
  await page.close();
}

/* ── 5. TOUCH PAN ────────────────────────────────────────────────────────── */
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await page.goto(URL_, { waitUntil: "networkidle" });
  await page.waitForTimeout(350);
  await setZoom(page, 200);
  const before = await readImage(page);

  // A real finger: pointer events of type "touch", which is what the
  // component listens for.
  const box = await page.locator("[data-zoom-viewport]").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart", touchPoints: [{ x: cx, y: cy }],
  });
  for (let i = 1; i <= 6; i++) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove", touchPoints: [{ x: cx - (100 * i) / 6, y: cy - (80 * i) / 6 }],
    });
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(150);

  const after = await readImage(page);
  ok(after.dx < before.dx - 20,
    `touch: a finger drag moved the picture ${(after.dx - before.dx).toFixed(0)}px horizontally`);
  ok(after.dy < before.dy - 20,
    `touch: a finger drag moved the picture ${(after.dy - before.dy).toFixed(0)}px vertically`);
  console.log(`  touch    390×844   finger drag moved the picture `
    + `${(after.dx - before.dx).toFixed(0)}px / ${(after.dy - before.dy).toFixed(0)}px`);
  await page.close();
}

/* ── 6. EVERY WIDTH THE BRIEF NAMES ──────────────────────────────────────── */
{
  const WIDTHS = [
    [1920, 1080], [1600, 900], [1440, 900], [1366, 768], [1280, 800],
    [1024, 1366], [834, 1112], [820, 1180], [768, 1024],
    [430, 932], [414, 896], [393, 852], [390, 844], [375, 812], [360, 800],
  ];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const wide = [];
  for (const [width, height] of WIDTHS) {
    await page.setViewportSize({ width, height });
    await page.goto(URL_, { waitUntil: "networkidle" });
    await page.waitForTimeout(250);
    const rest = await readImage(page);
    ok(rest !== null, `${width}px: no zoom viewport`);
    ok(rest.clipped === "hidden", `${width}px: the viewport is not clipping`);
    ok(!await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1),
    `${width}px: horizontal overflow at 100%`);
    // The picture must stay inside its own viewport, not spill over the panel.
    ok(rest.w <= rest.boxW + 1 && rest.h <= rest.boxH + 1,
      `${width}px: the picture is larger than its viewport at 100%`);

    await setZoom(page, 200);
    const zoomed = await readImage(page);
    ok(zoomed.pannable, `${width}px: not pannable at 200%`);
    const spill = await page.evaluate(() => {
      const box = document.querySelector("[data-zoom-viewport]").getBoundingClientRect();
      const img = document.querySelector("[data-zoom-viewport] img").getBoundingClientRect();
      // The zoomed picture is bigger than the box — that is the point — but
      // `overflow: hidden` must mean the PAGE never grows because of it.
      return {
        bigger: img.width > box.width + 1,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    });
    ok(spill.bigger, `${width}px: 200% did not overflow the viewport`);
    ok(!spill.overflow, `${width}px: horizontal overflow at 200%`);
    wide.push(`${width}`);
  }
  console.log(`  widths   ${wide.join(" ")} — clipped, pannable, no overflow`);
  await page.close();
}

await browser.close();
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
