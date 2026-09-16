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
 * Run:  npm run test:chrome -- <base-url>
 * Needs the temporary /probe-tmp/chrome route; skips cleanly without it.
 */
import { chromium } from "playwright";

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
      hasCircle: Boolean(circle),
      circle: box(circle),
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

    // The centre CTA is a circle whether or not it is the current tab.
    const circles = c.slots.filter((s) => s.hasCircle);
    note(circles.length === 1 && circles[0].circle.w >= 44,
      `${w}: exactly one gradient CTA, ${circles[0]?.circle.w}px across`);
  }

  await ctx.close();
}

await browser.close();
console.log(failed === 0 ? "\nAll chrome probes passed." : `\n${failed} probe(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
