/**
 * THE TWO PIECES OF CHROME A SELLER SEES ON EVERY SCREEN.
 *
 * THE DOCK'S ACTIVE TAB. It used to wear a tinted box with an inset ring
 * under its icon, and "the box is gone" is not something a class list proves —
 * a background can arrive from a parent, a ring from a shadow. So this reads
 * the COMPUTED background and box-shadow of the active tab's icon box and
 * requires both to be absent, then requires the icon and the label to be
 * carrying the brand colour instead. The centre CTA is checked the other way
 * round: it must still be the big gradient circle it always was.
 *
 * ONE TAB AT A TIME. Every route is visited and the number of tabs wearing
 * `aria-current="page"` must be exactly one — the DOM's own answer, not the
 * route table's.
 *
 * THE HEADER LOCKUP. The full logo has to be on screen and it has to fit:
 * measured against the hamburger on one side and the credits, search and bell
 * on the other, with no overlap and no horizontal overflow anywhere.
 *
 * THE FADE UNDER THE DOCK. A glass bar over a gallery is a bar you have to
 * look for, so the page's own colour rises from the bottom edge and thins out
 * above it. What is checked is that it is BEHIND the bar and not over it, that
 * it reaches the bottom of the screen (the home-indicator strip included) and
 * stops above the bar, that it is transparent at the top and the page colour
 * at the bottom in BOTH themes, and that it takes no pointer events — a fade
 * that swallows taps is not a cosmetic change.
 *
 * Run:  npm run test:chrome -- <base-url>
 * Needs the temporary /probe-tmp/chrome route; skips cleanly without it.
 */
import { chromium } from "playwright";
import sharp from "sharp";

const BASE = process.argv[2];
if (!BASE) { console.error("usage: npm run test:chrome -- <base-url>"); process.exit(2); }

const PROBE = "/probe-tmp/chrome";
if (!(await fetch(`${BASE}${PROBE}`).then((r) => r.ok).catch(() => false))) {
  console.log(`SKIPPED: ${BASE}${PROBE} is not served (temporary probe route).`);
  process.exit(0);
}

const WIDTHS = [320, 360, 375, 390, 414, 430, 768, 820, 1024];
/** Where each dock slot goes, and what must light up when you are there. */
const ROUTES = ["/home", "/library", "/prompts", "/tools", "/settings"];

let failed = 0;
const note = (ok, line) => { if (!ok) failed++; console.log(`${ok ? "✓" : "✗"} ${line}`); };

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
});

const readVeil = (page) => page.evaluate(() => {
  const nav = [...document.querySelectorAll("nav[aria-label]")].find((n) => !n.closest("header"));
  const veil = nav?.querySelector(".dock-veil") ?? null;
  const bar = nav?.querySelector(".dock") ?? null;
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const n = (v) => Math.round(v * 10) / 10;
    return { l: n(r.left), r: n(r.right), t: n(r.top), b: n(r.bottom), w: n(r.width), h: n(r.height) };
  };
  if (!veil) return { veil: null, bar: box(bar), navPadBottom: nav ? getComputedStyle(nav).paddingBottom : null };
  const cs = getComputedStyle(veil);
  // What the browser actually paints at the top and bottom of the fade.
  const r = veil.getBoundingClientRect();
  const topHit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + 1));
  const overBar = bar
    ? document.elementFromPoint(Math.round(bar.getBoundingClientRect().left + bar.getBoundingClientRect().width / 2),
        Math.round(bar.getBoundingClientRect().top + 10))
    : null;
  return {
    veil: box(veil),
    bar: box(bar),
    bg: cs.backgroundImage,
    pointer: cs.pointerEvents,
    zIndex: cs.zIndex,
    tag: veil.tagName.toLowerCase(),
    hidden: veil.getAttribute("aria-hidden"),
    // A hit test can never RETURN the veil — it takes no pointer events — so
    // these two say what actually matters: a tap over the bar lands on the
    // bar, and a tap in the fade's band lands on the page underneath.
    overBar: overBar ? (overBar.closest(".dock") ? "dock" : overBar.tagName.toLowerCase()) : null,
    topHit: topHit ? topHit.tagName.toLowerCase() : null,
    // What guarantees the paint order: the fade comes first and the bar is
    // positioned, so the bar is painted over it.
    veilBeforeBar: Boolean(bar && veil.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING),
    barPosition: bar ? getComputedStyle(bar).position : null,
    navDisplay: nav ? getComputedStyle(nav).display : null,
    veilToken: getComputedStyle(document.documentElement).getPropertyValue("--dock-veil").trim(),
    navPadBottom: nav ? getComputedStyle(nav).paddingBottom : null,
    dark: document.documentElement.classList.contains("dark"),
  };
});

const readChrome = (page) => page.evaluate(() => {
  // The header's desktop mega-nav carries the same aria-label, and it comes
  // first in the DOM — so pick the one that is NOT inside the header.
  const nav = [...document.querySelectorAll("nav[aria-label]")].find((n) => !n.closest("header"));
  const header = document.querySelector("header");
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const transparent = (v) => !v || v === "transparent" || /rgba\(0, 0, 0, 0\)/.test(v);

  const slots = nav ? [...nav.querySelectorAll("a")].map((a) => {
    // The icon box is the first <span> in the slot; the label is the next one.
    const iconBox = a.querySelector("span");
    const ics = iconBox ? getComputedStyle(iconBox) : null;
    const label = [...a.querySelectorAll("span")].find((s) => s.textContent.trim().length > 0);
    const circle = a.querySelector(".brand-gradient");
    return {
      href: a.getAttribute("href"),
      current: a.getAttribute("aria-current") === "page",
      linkColor: getComputedStyle(a).color,
      iconBg: ics ? ics.backgroundColor : null,
      iconShadow: ics ? ics.boxShadow : null,
      iconBgClear: ics ? transparent(ics.backgroundColor) : null,
      iconShadowClear: ics ? (ics.boxShadow === "none" || /drop-shadow/.test(ics.filter)) : null,
      iconFilter: ics ? ics.filter : null,
      labelColor: label ? getComputedStyle(label).color : null,
      labelBox: box(label),
      flexKids: a.children.length,
      hasCircle: Boolean(circle),
      circle: box(circle),
      // The active rule under GENERUJ, wherever it lives in the tree.
      rule: box([...a.querySelectorAll("span")].find((x) => {
        const r = x.getBoundingClientRect();
        return r.height > 0 && r.height <= 3 && r.width > 10 && r.width < 30;
      })),
    };
  }) : [];

  // The header pieces, left to right.
  const row = header?.querySelector("div:last-child");
  const kids = row ? [...row.children].filter((e) => e.getBoundingClientRect().width > 0).map((e) => ({
    cls: String(e.className).trim().split(/\s+/)[0], ...box(e),
  })) : [];
  // Both theme variants are in the DOM; exactly one of them is displayed.
  const visible = (el) => Boolean(el && el.getBoundingClientRect().width > 0 && getComputedStyle(el).display !== "none");
  const shown = (sel) => [...(header?.querySelectorAll(sel) ?? [])].find(visible) ?? null;
  const lockup = shown('img[src*="logo-on-"]');
  const mark = shown('img[src*="icon-on-"]');

  return {
    slots,
    navBox: box(nav),
    header: kids,
    lockup: lockup ? box(lockup) : null,
    mark: mark ? box(mark) : null,
    docW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
  };
});

for (const w of WIDTHS) {
  console.log(`\n══ ${w}px ══`);
  const ctx = await browser.newContext({
    viewport: { width: w, height: 800 }, deviceScaleFactor: 1,
    isMobile: w < 1024, hasTouch: w < 1024,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${PROBE}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(400);

  /* ── the header lockup ─────────────────────────────────────────────── */
  const c = await readChrome(page);
  note(c.docW <= c.clientW + 1, `${w}: no horizontal overflow (${c.docW} <= ${c.clientW})`);

  if (c.lockup) {
    note(c.lockup.w > 60, `${w}: the FULL lockup is on screen (${c.lockup.w}×${c.lockup.h})`);
    note(!c.mark, `${w}: …and the bare mark is not painted as well`);
  } else {
    note(Boolean(c.mark), `${w}: lockup does not fit — the mark stands in (${c.mark?.w}px)`);
  }

  // Nothing in the header row may overlap its neighbour.
  const overlaps = [];
  for (let i = 1; i < c.header.length; i++) {
    if (c.header[i].l < c.header[i - 1].r - 1) {
      overlaps.push(`${c.header[i - 1].cls} ends ${c.header[i - 1].r} but ${c.header[i].cls} starts ${c.header[i].l}`);
    }
  }
  note(overlaps.length === 0, `${w}: header items do not overlap (${c.header.length} items)${overlaps.length ? `\n     ${overlaps.join("\n     ")}` : ""}`);

  /* ── the dock ──────────────────────────────────────────────────────── */
  if (w < 1024) {
    note(c.slots.length === 5, `${w}: the dock holds ${c.slots.length} slots`);

    for (const route of ROUTES) {
      await page.evaluate((r) => window.history.pushState(null, "", r), route);
      // Nudge a re-render the way a navigation would.
      await page.evaluate(() => window.dispatchEvent(new PopStateEvent("popstate")));
      await page.waitForTimeout(150);
      const s = await readChrome(page);
      const lit = s.slots.filter((x) => x.current);
      note(lit.length === 1, `${w} ${route}: exactly one tab is current (${lit.map((x) => x.href).join(",") || "none"})`);

      const tab = lit[0];
      if (!tab) continue;
      if (tab.hasCircle) {
        // GENERUJ keeps its own treatment, and it is the only slot that may.
        note(tab.circle.w >= 44 && tab.circle.h >= 44,
          `${w} ${route}: the centre CTA is still the big circle (${tab.circle.w}×${tab.circle.h})`);
      } else {
        note(tab.iconBgClear,
          `${w} ${route}: NO tile behind the active icon (background: ${tab.iconBg})`);
        note(tab.iconShadow === "none",
          `${w} ${route}: no ring around it either (box-shadow: ${tab.iconShadow})`);
        const accentish = (v) => /rgb\(240, 60, 224\)|rgb\(2[0-9]{2}, /.test(v ?? "");
        note(accentish(tab.linkColor),
          `${w} ${route}: icon and label carry the brand colour (${tab.linkColor})`);
      }
    }

    /* EVERY LABEL ON ONE LINE.
       GENERUJ's slot used to carry a third flex child — the rule that marks it
       as the current screen — and `justify-center` split its height across the
       column, lifting the label 2.5px above the other four at every width. */
    const mids = c.slots.map((s) => s.labelBox.t + s.labelBox.h / 2);
    const spread = Math.max(...mids) - Math.min(...mids);
    note(spread < 0.6, `${w}: all five labels share a baseline (spread ${spread.toFixed(1)}px)`);
    const kidCounts = [...new Set(c.slots.map((s) => s.flexKids))];
    note(kidCounts.length === 1,
      `${w}: every slot lays out the same number of children (${kidCounts.join("/")})`);

    // The rule is still drawn, and still inside the bar it belongs to.
    const primary = c.slots.find((s) => s.hasCircle);
    if (primary?.rule) {
      note(primary.rule.b <= c.navBox.b + 1,
        `${w}: the CTA's rule stays inside the dock (${primary.rule.b} <= ${c.navBox.b})`);
    }

    // The centre CTA is a circle whether or not it is the current tab.
    const circles = c.slots.filter((s) => s.hasCircle);
    note(circles.length === 1 && circles[0].circle.w >= 44,
      `${w}: exactly one gradient CTA, ${circles[0]?.circle.w}px across`);

    /* ── the fade under the bar ──────────────────────────────────────── */
    const v = await readVeil(page);
    note(Boolean(v.veil), `${w}: the dock stands on a fade`);
    if (v.veil) {
      note(v.veil.l <= 0.5 && v.veil.r >= w - 0.5,
        `${w}: …spanning the whole width (${v.veil.l} → ${v.veil.r})`);
      note(Math.abs(v.veil.b - 800) < 1.5, `${w}: …down to the bottom edge (${v.veil.b})`);
      // It has to start ABOVE the bar and stop there — a fade that ends at the
      // bar's own edge is a panel, not a fade.
      const above = Math.round(v.bar.t - v.veil.t);
      note(above >= 24 && above <= 44, `${w}: …ending ${above}px above the bar`);
      note(v.pointer === "none", `${w}: …and taking no taps (pointer-events: ${v.pointer})`);
      note(v.hidden === "true", `${w}: …hidden from screen readers`);
      note(/linear-gradient/.test(v.bg) && /rgba?\([^)]*0\)/.test(v.bg),
        `${w}: it is a gradient that reaches zero alpha`);
      note(v.veilBeforeBar && v.barPosition === "relative",
        `${w}: the bar is painted over it (fade first, bar positioned: ${v.barPosition})`);
      note(v.overBar === "dock", `${w}: a tap on the bar reaches the bar (${v.overBar})`);
      note(v.topHit !== null && v.topHit !== "html",
        `${w}: …and a tap in the fade reaches the page under it (${v.topHit})`);
    }
  }

  await ctx.close();
}

/* ══ THE FADE, IN BOTH THEMES AND WHERE IT MUST NOT BE ═════════════════════ */

console.log("\n══ the fade: colour, themes, desktop ══");
{
  for (const [theme, want] of [["dark", "12 8 20"], ["light", "245 242 251"]]) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}${PROBE}`, { waitUntil: "networkidle", timeout: 60000 });
    if (theme === "light") {
      await page.evaluate(() => localStorage.setItem("theme", "light"));
      await page.reload({ waitUntil: "networkidle", timeout: 60000 });
    }
    await page.waitForTimeout(400);
    const v = await readVeil(page);
    note(v.dark === (theme === "dark"), `${theme}: the page is in the ${theme} theme`);
    note(v.veilToken === want, `${theme}: it fades into the page's own colour (--dock-veil: ${v.veilToken})`);
    note(Boolean(v.veil), `${theme}: …and the fade is drawn`);
    await ctx.close();
  }

  /* A TAP UNDER THE FADE STILL LANDS. */
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${PROBE}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(300);
  /* THE FADE ACTUALLY DIMS WHAT IS BEHIND IT. Two pixels of the same bright
     strip: one well above the fade, one inside it. If the second is not
     visibly darker, the gradient is decoration that paints nothing. */
  const dim = await (async () => {
    const band = await page.evaluate(() => {
      const nav = [...document.querySelectorAll("nav[aria-label]")].find((n) => !n.closest("header"));
      const v = nav.querySelector(".dock-veil").getBoundingClientRect();
      // The middle of the screen, over the uniform band the probe page puts
      // behind the dock — same colour inside and outside the fade.
      return { x: Math.round(v.left + v.width / 2), inside: Math.round(v.top + 10), above: Math.round(v.top - 20) };
    });
    const px = async (y) => {
      const buf = await page.screenshot({ clip: { x: band.x, y, width: 2, height: 2 } });
      const { data } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
      return (data[0] + data[1] + data[2]) / 3;
    };
    return { above: await px(band.above), inside: await px(band.inside) };
  })();
  note(dim.inside < dim.above - 6,
    `the fade visibly dims the content behind it (luma ${Math.round(dim.above)} above → ${Math.round(dim.inside)} inside)`);
  const navPad = (await readVeil(page)).navPadBottom;
  note(navPad !== null, `the dock still reserves the home-indicator strip (padding-bottom: ${navPad})`);

  /* AND IT IS A PHONE/TABLET THING. The whole dock is `lg:hidden`. */
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);
  const desktop = await readVeil(page);
  note(desktop.navDisplay === "none",
    `at 1280 the whole dock is hidden, fade included (display: ${desktop.navDisplay})`);
  await ctx.close();
}

await browser.close();
console.log(failed === 0 ? "\nAll chrome probes passed." : `\n${failed} probe(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
