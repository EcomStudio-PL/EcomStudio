/**
 * THE PHONE'S SEARCH IS A SCREEN — proved by driving it, not by reading it.
 *
 * Every claim in this file is one a class list cannot settle:
 *
 *   · FULLSCREEN — the panel's rect has to equal the viewport's, with no
 *     gutter and no corner radius left over from the floating card.
 *   · HEADER AND DOCK COVERED — both still exist in the DOM (they are the
 *     app's chrome and the brief forbids touching them), so "hidden" means
 *     the overlay paints over them opaquely. That is checked by geometry and
 *     by the surface's own alpha, not by `display: none`.
 *   · THE BACKGROUND IS FROZEN — the real test. The page is scrolled to a
 *     known offset, the search is opened, the page is TOLD to scroll, and it
 *     must not have moved. Then the overlay closes and the page must be back
 *     at the exact offset it started from.
 *   · THE LIST INSIDE SCROLLS — scrolling the overlay's own body must move
 *     the overlay's own body and nothing else.
 *   · NO VISIBLE SCROLLBAR on the carousel, while it still scrolls.
 *   · NO iOS FOCUS ZOOM — the field computes to at least 16px, which is the
 *     only thing that stops Safari zooming when it takes focus.
 *
 * Run:  npm run test:searchmobile -- <base-url>
 * Needs the temporary /probe-tmp/search route; skips cleanly without it.
 */
import { chromium } from "playwright";

const BASE = process.argv[2];
if (!BASE) { console.error("usage: npm run test:searchmobile -- <base-url>"); process.exit(2); }

const PROBE = "/probe-tmp/search";
if (!(await fetch(`${BASE}${PROBE}`).then((r) => r.ok).catch(() => false))) {
  console.log(`SKIPPED: ${BASE}${PROBE} is not served (temporary probe route).`);
  process.exit(0);
}

const PHONES = [320, 360, 375, 390, 414, 430];
const DESKTOP = [1280, 1440];

let failed = 0;
const note = (ok, line) => { if (!ok) failed++; console.log(`${ok ? "✓" : "✗"} ${line}`); };

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
});

const openSearch = async (page) => {
  await page.click("[data-probe-header] button");
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  await page.waitForTimeout(320);
};

const readOverlay = (page) => page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) return null;
  const panel = dialog.querySelector(".search-panel");
  const input = dialog.querySelector("input");
  const body = dialog.querySelector(".overscroll-contain");
  const rail = dialog.querySelector(".snap-x");
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      top: Math.round(r.top), left: Math.round(r.left),
      w: Math.round(r.width), h: Math.round(r.height),
      bottom: Math.round(r.bottom), right: Math.round(r.right),
    };
  };
  const cs = panel ? getComputedStyle(panel) : null;
  return {
    panel: box(panel),
    vw: window.innerWidth, vh: window.innerHeight,
    radius: cs ? cs.borderTopLeftRadius : null,
    bg: cs ? cs.backgroundColor : null,
    inputPx: input ? parseFloat(getComputedStyle(input).fontSize) : null,
    focused: input ? document.activeElement === input : false,
    bodyScrollable: body ? body.scrollHeight > body.clientHeight + 4 : false,
    bodyOverscroll: body ? getComputedStyle(body).overscrollBehaviorY : null,
    railScrollable: rail ? rail.scrollWidth > rail.clientWidth + 4 : false,
    railBarWidth: rail ? rail.offsetHeight - rail.clientHeight : null,
    railScrollbarWidth: rail ? getComputedStyle(rail).scrollbarWidth : null,
    bodyPosition: getComputedStyle(document.body).position,
  };
});

for (const w of PHONES) {
  console.log(`\n══ ${w}px ══`);
  const ctx = await browser.newContext({
    viewport: { width: w, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${PROBE}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(300);

  // Stand somewhere down the page, so "restores the scroll" means something.
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(200);
  const startY = await page.evaluate(() => window.scrollY);
  note(startY > 400, `${w}: page scrolled to ${startY} before opening`);

  await openSearch(page);
  const o = await readOverlay(page);

  /* 1. fullscreen */
  note(o.panel.w === o.vw && o.panel.left === 0,
    `${w}: panel spans the full width (${o.panel.w} of ${o.vw}, left=${o.panel.left})`);
  note(o.panel.top === 0 && Math.abs(o.panel.h - o.vh) <= 2,
    `${w}: panel spans the full height (top=${o.panel.top}, ${o.panel.h} of ${o.vh})`);
  note(o.radius === "0px", `${w}: no corner radius (${o.radius})`);
  note(/^rgb\(/.test(o.bg ?? "") && !/rgba/.test(o.bg ?? ""),
    `${w}: surface is opaque, so nothing shows through (${o.bg})`);

  /* 2. header and dock are covered */
  const covered = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const panel = dialog.querySelector(".search-panel");
    const pr = panel.getBoundingClientRect();
    const inside = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.top >= pr.top - 1 && r.bottom <= pr.bottom + 1 && r.left >= pr.left - 1 && r.right <= pr.right + 1;
    };
    const zOf = (el) => (el ? Number(getComputedStyle(el).zIndex) || 0 : null);
    return {
      header: inside(document.querySelector("[data-probe-header]")),
      headerOffscreen: (document.querySelector("[data-probe-header]")?.getBoundingClientRect().bottom ?? 1) <= 0,
      nav: inside(document.querySelector("nav[aria-label]")),
      dialogZ: Number(getComputedStyle(dialog).zIndex),
      headerZ: zOf(document.querySelector("[data-probe-header]")),
      navZ: zOf(document.querySelector("nav[aria-label]")),
    };
  });
  // "Hidden" here means NOT SHOWING, which is true two different ways: the
  // header is painted over by the opaque full-screen panel, or the frozen body
  // has carried it off the top of the screen. Requiring only the first was a
  // wrong assertion — the second is what actually happens on a scrolled page.
  note((covered.header || covered.headerOffscreen) && covered.dialogZ > covered.headerZ,
    `${w}: header is not showing (covered: ${covered.header}, off-screen: ${covered.headerOffscreen}, z ${covered.headerZ} < ${covered.dialogZ})`);
  note(covered.nav && covered.dialogZ > covered.navZ,
    `${w}: bottom dock sits under the overlay (z ${covered.navZ} < ${covered.dialogZ})`);

  /* 3. autofocus, and no iOS zoom reason */
  note(o.focused, `${w}: the field has focus on open`);
  note(o.inputPx >= 16, `${w}: field is ${o.inputPx}px — iOS has no reason to zoom`);

  /* 4. the background really is frozen */
  note(o.bodyPosition === "fixed", `${w}: body is pinned while open (position: ${o.bodyPosition})`);
  const drift = await page.evaluate(() => {
    const before = window.scrollY;
    window.scrollTo(0, before + 500);
    const after = window.scrollY;
    return { before, after };
  });
  note(drift.after === drift.before,
    `${w}: the page behind refuses to scroll (${drift.before} → ${drift.after})`);

  /* 5. the overlay's own list scrolls, and keeps it to itself */
  note(o.bodyOverscroll === "contain",
    `${w}: overlay body has overscroll-behavior: ${o.bodyOverscroll}`);
  // TYPE SOMETHING FIRST. With an empty field the two ranked lists can fit a
  // tall phone, and "nothing scrolled because there was nothing to scroll" is
  // not a test of the bug this change exists to fix. A query fills the list,
  // which is exactly when a seller tries to scroll it and the page moves
  // instead.
  await page.fill('[role="dialog"] input', "a");
  await page.waitForTimeout(500);
  const listed = await page.evaluate(() => {
    const b = document.querySelector('[role="dialog"] .overscroll-contain');
    return { scrollable: b.scrollHeight > b.clientHeight + 4, h: b.scrollHeight, c: b.clientHeight };
  });
  note(listed.scrollable, `${w}: with a query typed the list overflows (${listed.h} > ${listed.c})`);
  const inner = await page.evaluate(() => {
    const b = document.querySelector('[role="dialog"] .overscroll-contain');
    const beforeY = window.scrollY;
    const before = b.scrollTop;
    b.scrollTop += 200;
    return { before, after: b.scrollTop, pageBefore: beforeY, pageAfter: window.scrollY };
  });
  note(inner.after > inner.before,
    `${w}: the overlay's own list scrolls (${inner.before} → ${inner.after})`);
  note(inner.pageAfter === inner.pageBefore,
    `${w}: …and the page behind did not move with it (${inner.pageBefore} → ${inner.pageAfter})`);
  await page.fill('[role="dialog"] input', "");
  await page.waitForTimeout(300);

  /* 6. the carousel swipes with no visible bar */
  note(o.railScrollable, `${w}: the top-three carousel is horizontally scrollable`);
  note(o.railBarWidth === 0 || o.railScrollbarWidth === "none",
    `${w}: its scrollbar takes no space (${o.railBarWidth}px, scrollbar-width: ${o.railScrollbarWidth})`);
  const swipe = await page.evaluate(() => {
    const r = document.querySelector('[role="dialog"] .snap-x');
    const before = r.scrollLeft;
    r.scrollLeft += 150;
    return { before, after: r.scrollLeft };
  });
  note(swipe.after > swipe.before, `${w}: the carousel still moves (${swipe.before} → ${swipe.after})`);

  /* 7. closing puts everything back */
  await page.click('[role="dialog"] button[aria-label]');
  await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 5000 });
  await page.waitForTimeout(260);
  const after = await page.evaluate(() => ({
    y: window.scrollY,
    bodyPosition: getComputedStyle(document.body).position,
    bodyOverflow: getComputedStyle(document.body).overflow,
    headerVisible: Boolean(document.querySelector("[data-probe-header]")?.getBoundingClientRect().height),
    navVisible: Boolean(document.querySelector("nav[aria-label]")?.getBoundingClientRect().height),
    focused: document.activeElement?.tagName?.toLowerCase(),
  }));
  note(after.y === startY, `${w}: page came back to exactly ${startY} (got ${after.y})`);
  note(after.bodyPosition !== "fixed", `${w}: body unpinned after closing (${after.bodyPosition})`);
  note(after.bodyOverflow !== "hidden", `${w}: body scroll released (overflow: ${after.bodyOverflow})`);
  note(after.headerVisible && after.navVisible, `${w}: header and dock are back`);
  note(after.focused !== "input", `${w}: the field released focus, so the keyboard drops (${after.focused})`);

  /* 8. Android back closes instead of navigating away */
  await openSearch(page);
  const urlBefore = page.url();
  await page.goBack();
  await page.waitForTimeout(400);
  const back = await page.evaluate(() => ({
    open: Boolean(document.querySelector('[role="dialog"]')),
    bodyPosition: getComputedStyle(document.body).position,
  }));
  note(!back.open, `${w}: back closes the overlay`);
  note(back.bodyPosition !== "fixed", `${w}: …and releases the scroll lock (${back.bodyPosition})`);
  note(page.url() === urlBefore, `${w}: …and stays on the page (${page.url() === urlBefore})`);

  await ctx.close();
}

/* Desktop must be exactly the floating panel it always was. */
console.log("\n══ desktop regression ══");
for (const w of DESKTOP) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${PROBE}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(200);
  const headerBefore = await page.evaluate(() =>
    Math.round(document.querySelector("[data-probe-header]").getBoundingClientRect().top));
  await openSearch(page);
  const headerDuring = await page.evaluate(() =>
    Math.round(document.querySelector("[data-probe-header]").getBoundingClientRect().top));
  // The regression that gating the scroll lock to phones exists to prevent:
  // a pinned body drops a sticky header to its static position, and on the
  // desktop the page around the panel is still on show while that happens.
  note(headerBefore === headerDuring,
    `${w}: header does not move when the search opens (${headerBefore} → ${headerDuring})`);
  const bodyPos = await page.evaluate(() => getComputedStyle(document.body).position);
  note(bodyPos !== "fixed", `${w}: desktop body is not pinned (${bodyPos})`);

  const o = await readOverlay(page);
  note(o.panel.w <= 800 && o.panel.left > 0,
    `${w}: still a centred panel, not fullscreen (${o.panel.w}px wide, left=${o.panel.left})`);
  note(o.radius !== "0px", `${w}: keeps its rounded corners (${o.radius})`);
  note(o.panel.top > 0, `${w}: still sits below the header (top=${o.panel.top})`);
  await ctx.close();
}

await browser.close();
console.log(failed === 0 ? "\nAll mobile search probes passed." : `\n${failed} probe(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
