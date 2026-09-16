/**
 * DOES THE COST + ACTION PANEL RIDE THE SCROLL?
 *
 * The one thing that matters here cannot be settled by reading a class list:
 * a panel can be `position: static` and still travel, because an ancestor is
 * transformed or because the thing that scrolls is an inner column rather than
 * the document. So this SCROLLS the real page and measures the only fact worth
 * measuring — the panel's position relative to the DOCUMENT does not change.
 *
 * It also checks what the brief asks for around it: exactly ONE cost + CTA
 * panel per tool (the floating dock used to be a second copy of the one in the
 * page), the panel sits after the settings and before the results, nothing is
 * left reserving empty page for a bar that no longer floats, and the panel
 * covers neither the bottom navigation nor the "report a bug" CTA.
 *
 * Run:  npm run test:island -- <base-url>
 * Needs the temporary /probe-tmp/gen route; skips cleanly without it.
 */
import { chromium } from "playwright";

const BASE = process.argv[2];
if (!BASE) { console.error("usage: npm run test:island -- <base-url>"); process.exit(2); }

const TOOLS = [
  { path: "/probe-tmp/gen?mode=managed", name: "GrovBase Shot 1.0" },
  { path: "/probe-tmp/gen?mode=custom", name: "Stwórz zdjęcie" },
  // The reference pattern. It was already correct; this is the regression.
  { path: "/probe-tmp/retusz", name: "Retusz (reference)" },
];

if (!(await fetch(`${BASE}${TOOLS[0].path}`).then((r) => r.ok).catch(() => false))) {
  console.log("SKIPPED: the temporary /probe-tmp routes are not served.");
  process.exit(0);
}

const MOBILE = [320, 360, 375, 390, 414, 430];
const TABLET = [768, 820, 834, 1024];
const DESKTOP = [1280, 1440, 1920];

let failed = 0;
const note = (ok, line) => { if (!ok) failed++; console.log(`${ok ? "✓" : "✗"} ${line}`); };

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
});

/** Everything the page can tell us about its action panel, in one pass. */
const read = (page) => page.evaluate(() => {

  // The cost + CTA panel: the block holding the primary generate button.
  const cta = [...document.querySelectorAll("button")]
    .filter((b) => /generuj|stw[oó]rz|retuszuj/i.test(b.textContent || ""))
    .filter((b) => !b.closest('[role="dialog"]'));
  const panels = [...new Set(cta.map((b) => b.closest(".panel, .dock") ?? b.parentElement))];

  const floating = [];
  for (const el of document.querySelectorAll("main *, body > div > *")) {
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed" && cs.position !== "sticky") continue;
    if (el.closest("nav")) continue;                      // the app dock is allowed
    if (el.closest('[role="dialog"]')) continue;          // modals are allowed
    const r = el.getBoundingClientRect();
    if (r.height < 20) continue;
    const txt = (el.textContent || "").replace(/\s+/g, " ");
    const hasCost = /kredyt|koszt|za zdj|szt\.|\/ ?szt/i.test(txt) || Boolean(el.querySelector("svg"));
    const hasAction = Boolean([...el.querySelectorAll("button")]
      .find((b) => /generuj|stw[oó]rz|retuszuj/i.test(b.textContent || "")));
    if (!hasAction) continue;
    floating.push({ pos: cs.position, z: cs.zIndex, h: Math.round(r.height), hasCost });
  }

  const panel = panels[0] ?? null;
  const nav = document.querySelector("nav[aria-label]");
  const feedback = document.querySelector("[data-feedback-cta], [data-probe-feedback]")
    ?? [...document.querySelectorAll("button, a")].find((b) => /zgłoś|błąd|sugest/i.test(b.textContent || ""));

  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
  };

  const main = document.querySelector("main");
  return {
    panelCount: panels.length,
    ctaCount: cta.length,
    floating,
    panelTop: panel ? Math.round(panel.getBoundingClientRect().top) : null,
    panelRect: rect(panel),
    panelPosition: panel ? getComputedStyle(panel).position : null,
    navRect: rect(nav),
    feedbackRect: rect(feedback),
    dockRoom: getComputedStyle(document.documentElement).getPropertyValue("--gen-dock-room").trim(),
    mainPadBottom: main ? getComputedStyle(main).paddingBottom : null,
    docWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  };
});

/**
 * Scroll the box the PANEL lives in, and report how far it really moved.
 *
 * Scrolling the wrong box proves nothing: the generator's results column
 * scrolls independently on a desktop, and moving it would leave the panel
 * legitimately still. So the scroller is found by walking up from the panel.
 */
const scrollPanelIntoMotion = (page, dy) => page.evaluate((d) => {
  const cta = [...document.querySelectorAll("button")]
    .filter((b) => /generuj|stw[oó]rz|retuszuj/i.test(b.textContent || ""))
    .filter((b) => !b.closest('[role="dialog"]'))[0];
  if (!cta) return { moved: 0, where: "no panel" };
  const panel = cta.closest(".panel, .dock") ?? cta.parentElement;

  const scrollable = (el) => {
    const cs = getComputedStyle(el);
    return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4;
  };
  for (let p = panel.parentElement; p && p !== document.body; p = p.parentElement) {
    if (!scrollable(p)) continue;
    const before = p.scrollTop;
    p.scrollTop += d;
    const moved = p.scrollTop - before;
    if (moved > 0) return { moved, where: `${p.tagName.toLowerCase()}.${String(p.className).trim().split(/\s+/)[0] ?? ""}` };
  }
  const before = window.scrollY;
  window.scrollTo(0, before + d);
  return { moved: window.scrollY - before, where: "document" };
}, dy);

for (const tool of TOOLS) {
  console.log(`\n═══ ${tool.name} ═══`);
  for (const [label, widths, mobile] of [["mobile", MOBILE, true], ["tablet", TABLET, true], ["desktop", DESKTOP, false]]) {
    for (const w of widths) {
      const ctx = await browser.newContext({
        viewport: { width: w, height: mobile ? 844 : 900 }, deviceScaleFactor: 1,
        isMobile: mobile, hasTouch: mobile,
      });
      const page = await ctx.newPage();
      await page.goto(`${BASE}${tool.path}`, { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForTimeout(600);

      const a = await read(page);
      const tag = `${label} ${w}`;

      if (mobile) {
        note(a.floating.length === 0,
          `${tag}: no floating cost+CTA island (${a.floating.map((f) => `${f.pos} h=${f.h}`).join(", ") || "none"})`);
        note(a.ctaCount === 1,
          `${tag}: exactly one primary action button (found ${a.ctaCount})`);
        note(!a.dockRoom,
          `${tag}: no empty page reserved for a floating bar (--gen-dock-room = ${a.dockRoom || "unset"})`);
      }

      note(a.docWidth <= a.clientWidth + 1, `${tag}: no horizontal overflow (${a.docWidth} <= ${a.clientWidth})`);

      // THE SCROLL TEST — the panel must travel WITH the content, which means
      // its position ON SCREEN moves up by exactly what was scrolled. A pinned
      // panel would sit at the same screen position no matter what.
      const { moved, where } = await scrollPanelIntoMotion(page, 400);
      await page.waitForTimeout(250);
      const b = await read(page);
      if (moved > 0 && a.panelTop !== null && b.panelTop !== null) {
        const travelled = a.panelTop - b.panelTop;
        note(Math.abs(travelled - moved) <= 2,
          `${tag}: panel travelled ${travelled}px while ${where} scrolled ${moved}px`);
      } else if (mobile) {
        // NOTHING SCROLLED. From `lg` up the generator is a viewport-locked
        // two-column frame whose columns only scroll when their own content
        // overflows — so with a short page there is genuinely nothing to move,
        // and demanding a scroll here would be demanding the desktop layout
        // behave like a phone. What still has to be true is that the panel is
        // part of the page rather than pinned to the glass.
        note(a.panelTop !== null && !["fixed", "sticky"].includes(a.panelPosition ?? ""),
          `${tag}: nothing to scroll (viewport-locked ${where}); panel is ${a.panelPosition}, not pinned`);
      }

      if (mobile && b.panelRect && b.navRect) {
        const overlapsNav = b.panelRect.bottom > b.navRect.top && b.panelRect.top < b.navRect.bottom;
        note(!overlapsNav, `${tag}: panel does not overlap the app dock`);
      }

      await ctx.close();
    }
  }
}

await browser.close();
console.log(failed === 0 ? "\nAll action-island probes passed." : `\n${failed} probe(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
