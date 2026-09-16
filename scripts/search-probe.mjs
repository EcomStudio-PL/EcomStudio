/**
 * THE SEARCH OVERLAY — measured, not eyeballed.
 *
 * Everything this checks is something a screenshot hides:
 *
 *   · the modal leaving the viewport, or sliding under the header or the dock;
 *   · the page scrolling sideways because the panel is wider than the screen;
 *   · the header blurring itself — the design is explicit that the logo and the
 *     menu stay sharp while the page behind them softens;
 *   · the phone strip not actually snapping, or having nothing to swipe to;
 *   · a fetch firing when the magnifier is pressed, or one per keystroke.
 *
 * Run:  node scripts/search-probe.mjs <base-url>
 * It needs the temporary /probe-tmp/chrome route, which mounts the real
 * top bar with fixed props so a browser can drive it without a session.
 */
import { chromium } from "playwright";

const BASE = process.argv[2];
if (!BASE) { console.error("usage: node scripts/search-probe.mjs <base-url>"); process.exit(2); }
const PROBE = `${BASE}/probe-tmp/chrome`;

const VIEWPORTS = [
  { w: 320, h: 568, label: "320", mobile: true },
  { w: 360, h: 740, label: "360", mobile: true },
  { w: 375, h: 667, label: "375", mobile: true },
  { w: 390, h: 844, label: "390", mobile: true },
  { w: 414, h: 896, label: "414", mobile: true },
  { w: 430, h: 932, label: "430", mobile: true },
  { w: 768, h: 1024, label: "768", mobile: true },
  { w: 820, h: 1180, label: "820", mobile: true },
  { w: 1024, h: 1366, label: "1024", mobile: true },
  { w: 1280, h: 800, label: "1280" },
  { w: 1366, h: 768, label: "1366" },
  { w: 1440, h: 900, label: "1440" },
  { w: 1600, h: 900, label: "1600" },
  { w: 1920, h: 1080, label: "1920" },
  { w: 2560, h: 1440, label: "2560" },
];

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
});

let failures = 0;
const note = (ok, line) => { if (!ok) failures++; console.log(`${ok ? "✓" : "✗"} ${line}`); };

const openSearch = (page, w) => page.evaluate((width) => {
  const buttons = [...document.querySelectorAll("header button")];
  const s = buttons.find((b) => width >= 1024
    ? b.hasAttribute("aria-keyshortcuts")
    : !b.hasAttribute("aria-keyshortcuts") && b.closest("div")?.className.includes("lg:hidden"));
  s?.click();
}, w);
const isOpen = (page) => page.evaluate(() => Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')));

/* ── geometry, at every width and in both themes ─────────────────────────── */

for (const theme of ["dark", "light"]) {
  console.log(`\n══ ${theme} ══`);
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1,
      isMobile: Boolean(vp.mobile), hasTouch: Boolean(vp.mobile),
      colorScheme: theme,
    });
    const page = await ctx.newPage();
    await page.goto(PROBE, { waitUntil: "networkidle", timeout: 60000 });
    await page.evaluate((t) => {
      document.documentElement.classList.toggle("dark", t === "dark");
      document.documentElement.classList.toggle("light", t === "light");
    }, theme);
    await page.waitForTimeout(250);

    await openSearch(page, vp.w);
    await page.waitForTimeout(350);

    const m = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (!dialog) return { missing: true };
      const panel = dialog.querySelector(".search-panel");
      const header = document.querySelector("header");
      const dock = document.querySelector("nav.fixed .dock");
      const veil = [...document.body.children].find(
        (el) => el.className && String(el.className).includes("z-30") && String(el.className).includes("backdrop-blur"));
      const p = panel?.getBoundingClientRect();
      const h = header?.getBoundingClientRect();
      const d = dock?.getBoundingClientRect();
      const strip = panel?.querySelector('[class*="snap-x"]');
      const field = panel?.querySelector(".search-field");
      const cards = strip ? strip.children.length : 0;
      // The six links are the grid right after the strip.
      const links = panel?.querySelectorAll('[data-row]')?.length ?? 0;
      return {
        panel: p ? {
          top: Math.round(p.top), bottom: Math.round(p.bottom),
          left: Math.round(p.left), right: Math.round(p.right), w: Math.round(p.width),
        } : null,
        headerBottom: h ? Math.round(h.bottom) : 0,
        headerZ: header ? getComputedStyle(header).zIndex : null,
        headerFilter: header ? getComputedStyle(header).filter : null,
        dockTop: d ? Math.round(d.top) : null,
        dockH: d ? Math.round(d.height) : 0,
        veilZ: veil ? getComputedStyle(veil).zIndex : null,
        veilBlur: veil ? getComputedStyle(veil).backdropFilter : null,
        cards, rows: links,
        fieldLit: field ? getComputedStyle(field).boxShadow !== "none" : false,
        stripSnap: strip ? getComputedStyle(strip).scrollSnapType : null,
        stripOverflow: strip ? getComputedStyle(strip).overflowX : null,
        stripScrollable: strip ? strip.scrollWidth - strip.clientWidth : 0,
        dots: panel?.querySelectorAll('[class*="rounded-full"][class*="h-1.5"]')?.length ?? 0,
        docScroll: document.documentElement.scrollWidth,
        docClient: document.documentElement.clientWidth,
      };
    });

    const bad = [];
    if (m.missing) bad.push("the overlay did not open");
    else {
      const p = m.panel;
      if (!p) bad.push("no .search-panel inside the dialog");
      else {
        // A PHONE GETS A SCREEN; EVERYTHING ELSE GETS A PANEL.
        // Below 640 the search fills the viewport by design — over the header,
        // over the dock, corner to corner — so the two rules that keep it
        // clear of both are the wrong question there and are replaced by the
        // one that matters: it really does cover the whole screen.
        const fullscreen = vp.w < 640;
        if (fullscreen) {
          if (p.top !== 0) bad.push(`fullscreen panel starts at ${p.top}, not 0`);
          if (Math.abs(p.bottom - vp.h) > 2) bad.push(`fullscreen panel ends at ${p.bottom}, not ${vp.h}`);
          if (p.left !== 0 || p.w !== vp.w) bad.push(`fullscreen panel is ${p.left}..${p.right}, not 0..${vp.w}`);
        } else {
          if (p.top < m.headerBottom - 1) bad.push(`panel starts under the header (${p.top} < ${m.headerBottom})`);
          if (p.bottom > vp.h + 1) bad.push(`panel bottom ${p.bottom} is past the viewport (${vp.h})`);
          if (p.left < -1 || p.right > vp.w + 1) bad.push(`panel ${p.left}..${p.right} is outside 0..${vp.w}`);
          // Only where there IS a dock: above lg it is `hidden`, and a hidden
          // element's rect is a zero-height box at the top of the page.
          if (m.dockH && p.bottom > m.dockTop + 1) bad.push(`panel runs under the dock (${p.bottom} > ${m.dockTop})`);
        }
        if (p.bottom - p.top < 200) bad.push(`panel is only ${p.bottom - p.top}px tall — it has collapsed`);
        if (vp.w >= 1280 && (p.w < 700 || p.w > 860)) bad.push(`panel is ${p.w}px — the design is an 800px modal`);
      }
      if (m.docScroll > m.docClient + 1) bad.push("the open modal makes the page scroll sideways");
      // THE VEIL EXISTS TO SOFTEN A PAGE YOU CAN STILL SEE. Below 640 the
      // search covers the screen with an opaque surface, so there is no page
      // left showing and no header to blur — and a second full-viewport
      // backdrop-filter composited under something nobody can see through is
      // pure cost on every scrolled frame. It is not rendered there.
      if (vp.w >= 640) {
        if (m.veilZ !== "30") bad.push(`the veil is at z-index ${m.veilZ}, not 30 — the header would be blurred`);
        if (!/blur/.test(m.veilBlur ?? "")) bad.push("the veil does not blur");
      } else if (m.veilZ !== null) {
        bad.push(`a veil is still rendered behind the full-screen search (z-index ${m.veilZ})`);
      }
      if (m.headerZ !== "40") bad.push(`the header is at z-index ${m.headerZ}, so it is not above the veil`);
      if (m.headerFilter && m.headerFilter !== "none") bad.push(`the header itself is filtered (${m.headerFilter})`);
      if (m.cards !== 3) bad.push(`${m.cards} cards, expected 3`);
      if (m.rows !== 9) bad.push(`${m.rows} navigable tiles, expected 3 + 6`);
      if (!m.fieldLit) bad.push("the search field has no lit edge");
      if (vp.w < 640) {
        if (!m.stripSnap || m.stripSnap === "none") bad.push("the phone carousel does not snap");
        if (m.stripOverflow !== "auto" && m.stripOverflow !== "scroll") bad.push(`the carousel does not scroll (overflow-x: ${m.stripOverflow})`);
        if (m.stripScrollable <= 0) bad.push("the carousel has nothing to swipe to");
        if (m.dots !== 3) bad.push(`${m.dots} indicator dots, expected 3`);
      }
    }

    note(bad.length === 0,
      `${vp.label.padEnd(5)} panel ${m.panel ? `${m.panel.top}..${m.panel.bottom} (${m.panel.w}px)` : "—"}`
      + ` · ${m.cards ?? 0} cards · ${m.rows ?? 0} tiles`
      + (vp.w < 640 ? ` · ${m.dots} dots · swipe ${m.stripScrollable}px` : "")
      + (bad.length ? `\n     ${bad.join("\n     ")}` : ""));

    await ctx.close();
  }
}

/* ── what it does when you use it ────────────────────────────────────────── */

for (const [w, h, label] of [[390, 844, "phone"], [1440, 900, "desktop"]]) {
  console.log(`\n══ ${label} — interaction ══`);
  const ctx = await browser.newContext({
    viewport: { width: w, height: h }, isMobile: w < 900, hasTouch: w < 900,
  });
  const page = await ctx.newPage();
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto(PROBE, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(300);

  // OPENING FETCHES NOTHING. The ranking is a prop and the tool index is
  // module-scope data — pressing the magnifier must not start a request.
  requests.length = 0;
  await openSearch(page, w);
  await page.waitForTimeout(600);
  note(await isOpen(page), `${label}: the magnifier opens the overlay`);
  const onOpen = requests.filter((u) => !/\.(png|jpg|jpeg|webp|svg|ico|woff2?)$/i.test(u) && !u.startsWith("data:"));
  note(onOpen.length === 0, `${label}: opening it fetches nothing`
    + (onOpen.length ? `\n     ${onOpen.slice(0, 4).join("\n     ")}` : ""));

  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  note(!(await isOpen(page)), `${label}: Esc closes it`);

  await openSearch(page, w);
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    [...d.querySelectorAll("button")].find((b) => b.getAttribute("aria-label"))?.click();
  });
  await page.waitForTimeout(250);
  note(!(await isOpen(page)), `${label}: the X closes it`);

  // ONLY WHERE THERE IS AN OUTSIDE. On a phone the panel fills the screen, so
  // the bottom edge is inside it and this gesture does not exist; the X, Esc
  // and the back button are the ways out, and they are checked above and in
  // scripts/search-mobile-probe.mjs.
  if (w >= 640) {
    await openSearch(page, w);
    await page.waitForTimeout(300);
    await page.mouse.click(Math.round(w / 2), h - 6);
    await page.waitForTimeout(250);
    note(!(await isOpen(page)), `${label}: a click outside the panel closes it`);
  }

  // TYPING IS LOCAL AND INSTANT: the tool rows must be painted before the
  // debounced content request has even been sent.
  await openSearch(page, w);
  await page.waitForTimeout(300);
  requests.length = 0;
  await page.keyboard.type("tlo", { delay: 20 });
  await page.waitForTimeout(90);
  const early = await page.evaluate(() => document.querySelectorAll('[role="dialog"] [data-row]').length);
  const duringTyping = requests.filter((u) => u.includes("/api/search"));
  note(early > 0, `${label}: results appear before any request (${early} rows at 90ms)`);
  note(duringTyping.length === 0, `${label}: no request per keystroke (${duringTyping.length} in the first 90ms)`);
  await page.waitForTimeout(500);
  const after = requests.filter((u) => u.includes("/api/search"));
  note(after.length <= 1, `${label}: the content search is debounced to one request (${after.length})`);

  // THE KEYBOARD, and the route a result opens.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await openSearch(page, w);
  await page.waitForTimeout(300);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(120);
  const first = await page.evaluate(() => {
    const el = document.querySelector('[role="dialog"] [data-row="0"]');
    return { current: el?.getAttribute("aria-current"), text: el?.textContent?.trim().slice(0, 24) };
  });
  note(first.current === "true", `${label}: ArrowDown selects the first card (${first.text})`);
  // WHERE THE HIGHLIGHTED CARD ACTUALLY POINTS, read before pressing Enter.
  // This used to be hard-coded to /prompts, which made the check a test of the
  // ranking data rather than of the keyboard: whichever tool happens to rank
  // first, Enter has to open THAT one.
  const target = await page.evaluate(() => {
    const el = document.querySelector('[role="dialog"] [aria-current="true"]');
    return el?.getAttribute("href") ?? el?.closest("a")?.getAttribute("href") ?? null;
  });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
  const landed = page.url();
  // The probe browser has no session, so the app's own guard bounces it to
  // sign-in with `next=` pointing at where it was going. That redirect IS the
  // proof: the tile sent it somewhere real and the route is still protected.
  const parsed = new globalThis.URL(landed);
  const wanted = parsed.searchParams.get("next") ?? parsed.pathname;
  note(!landed.includes("/probe-tmp/chrome") && wanted.length > 1 && (!target || wanted === target),
    `${label}: Enter closes the modal and opens the tool (→ ${wanted}${target ? `, card pointed at ${target}` : ""})`);

  // THE PHONE CAROUSEL — a real swipe has to move it, land on a card, and
  // move the dot that claims to follow it.
  if (w < 900) {
    await page.goto(PROBE, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    await openSearch(page, w);
    await page.waitForTimeout(350);
    const swiped = await page.evaluate(async () => {
      const strip = document.querySelector('[role="dialog"] [class*="snap-x"]');
      if (!strip) return null;
      const activeDot = () => [...document.querySelectorAll('[role="dialog"] [class*="h-1.5"]')]
        .findIndex((d) => d.className.includes("bg-accent"));
      const before = { left: strip.scrollLeft, dot: activeDot() };
      strip.scrollBy({ left: strip.clientWidth, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 250));
      return { before, after: { left: strip.scrollLeft, dot: activeDot() }, max: strip.scrollWidth - strip.clientWidth };
    });
    note(swiped !== null && swiped.after.left > swiped.before.left,
      `phone: the strip scrolls (${swiped?.before.left} → ${swiped?.after.left} of ${swiped?.max})`);
    note(swiped !== null && swiped.after.dot > swiped.before.dot,
      `phone: the indicator follows the strip (dot ${swiped?.before.dot} → ${swiped?.after.dot})`);
  }

  await ctx.close();
}

/* ── the copy, in every language ─────────────────────────────────────────── */

console.log("\n══ languages ══");
for (const locale of ["pl", "en", "de"]) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addCookies([{ name: "ecs_locale", value: locale, url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(PROBE, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(250);
  await openSearch(page, 390);
  await page.waitForTimeout(350);
  const copy = await page.evaluate(() => {
    const panel = document.querySelector(".search-panel");
    return {
      placeholder: panel?.querySelector("input")?.placeholder ?? "",
      headings: [...panel.querySelectorAll("p")].map((p) => p.textContent.trim()).filter(Boolean).slice(0, 3),
      // A humanised key leaking through looks like "Toolsearch.compress.desc".
      rawKeys: panel.textContent.match(/\b[a-z]+search\.[a-z_.]+/gi) ?? [],
      clipped: [...panel.querySelectorAll("[data-row]")]
        .filter((el) => el.scrollWidth > el.clientWidth + 2).length,
    };
  });
  note(copy.placeholder.length > 20 && copy.rawKeys.length === 0 && copy.clipped === 0,
    `${locale}: “${copy.placeholder.slice(0, 44)}…” · ${copy.headings.join(" / ")}`
    + (copy.rawKeys.length ? `\n     untranslated: ${copy.rawKeys.slice(0, 3).join(", ")}` : "")
    + (copy.clipped ? `\n     ${copy.clipped} tile(s) overflow their box` : ""));
  await ctx.close();
}

await browser.close();
console.log(failures === 0 ? "\nsearch probe: everything measured checks out" : `\nsearch probe: ${failures} problem(s)`);
process.exit(failures > 0 ? 1 : 0);
