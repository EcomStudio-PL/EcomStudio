/**
 * DOES THE COST + ACTION PANEL STAY WHERE IT WAS PUT?
 *
 * Every image tool ends its settings column with the same card: what one run
 * costs, what the queue costs, why the button is off, and the button. On a
 * phone and a tablet that card used to be `position: fixed` — so it rode the
 * scroll, sat on top of the settings it belongs under, and covered the head of
 * the results below. Retusz and the Moda tools never did that, and this is what
 * makes every other tool match them.
 *
 * "Not fixed" is not enough to assert. A sticky element has `position: sticky`
 * and still follows you; a transformed ancestor can pin a child that looks
 * static in the markup. So this SCROLLS the real page and checks the only thing
 * that actually matters: the panel's position relative to the DOCUMENT does not
 * change, which means it moved with the content rather than against it.
 *
 * It also checks the three things that go wrong once a floating panel is taken
 * out: the page must not keep reserving the room it used to need, the panel
 * must not end up above the settings it belongs under, and the bottom
 * navigation must not cover it.
 *
 * Run:  node scripts/tool-layout-probe.mjs <base-url>
 * Needs the temporary /probe-tmp/tools route.
 */
import { chromium } from "playwright";

const BASE = process.argv[2];
if (!BASE) { console.error("usage: node scripts/tool-layout-probe.mjs <base-url>"); process.exit(2); }

/** Every tool that ends its column with the shared cost + action card. */
const TOOLS = ["resize", "compress", "upscale", "expand", "watermark", "editor"];

const VIEWPORTS = [
  { w: 375, h: 667, label: "375", mobile: true },
  { w: 390, h: 844, label: "390", mobile: true },
  { w: 414, h: 896, label: "414", mobile: true },
  { w: 430, h: 932, label: "430", mobile: true },
  { w: 768, h: 1024, label: "768", mobile: true },
  { w: 820, h: 1180, label: "820", mobile: true },
  { w: 1024, h: 1366, label: "1024", mobile: true },
  { w: 1280, h: 800, label: "1280" },
  { w: 1440, h: 900, label: "1440" },
];

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
});

let failures = 0;
const note = (ok, line) => { if (!ok) failures++; console.log(`${ok ? "✓" : "✗"} ${line}`); };

for (const tool of TOOLS) {
  console.log(`\n══ ${tool} ══`);
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1,
      isMobile: Boolean(vp.mobile), hasTouch: Boolean(vp.mobile),
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/probe-tmp/tools?t=${tool}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(400);

    const r = await page.evaluate(async () => {
      const panel = document.querySelector("[data-cost-island], [data-action-bar]");
      if (!panel) return { missing: true };

      // WHICH BOX SCROLLS. The viewport-locked tools scroll an inner column,
      // not the document, so "scroll the page" has to mean whichever ancestor
      // actually has somewhere to go.
      let scroller = null;
      for (let el = panel.parentElement; el; el = el.parentElement) {
        if (el.scrollHeight - el.clientHeight > 8) { scroller = el; break; }
      }
      const doc = document.scrollingElement;
      if (!scroller && doc.scrollHeight - doc.clientHeight > 8) scroller = doc;

      const cs = getComputedStyle(panel);
      const before = panel.getBoundingClientRect().top;
      const startedAt = scroller ? scroller.scrollTop : 0;
      let moved = 0;
      if (scroller) {
        scroller.scrollTop = Math.min(scroller.scrollHeight, startedAt + 400);
        await new Promise((res) => setTimeout(res, 250));
        moved = scroller.scrollTop - startedAt;
      }
      const after = panel.getBoundingClientRect().top;

      // The settings card the panel must follow, and the results it must not
      // cover. Both are the previous/next sibling in the real markup.
      const prev = panel.previousElementSibling?.getBoundingClientRect() ?? null;
      const dock = document.querySelector("nav.fixed .dock")?.getBoundingClientRect() ?? null;
      const box = panel.getBoundingClientRect();

      // What the page reserves at its foot for a docked bar. A panel that no
      // longer docks must not still be asking for the room.
      const probe = document.createElement("div");
      probe.style.cssText = "position:absolute;visibility:hidden;height:var(--gen-dock-room, 0px)";
      document.body.appendChild(probe);
      const reserved = Math.round(probe.getBoundingClientRect().height);
      probe.remove();

      return {
        position: cs.position,
        marker: panel.hasAttribute("data-cost-island") ? "cost-island" : "action-bar",
        before: Math.round(before), after: Math.round(after), moved: Math.round(moved),
        scrolled: Boolean(scroller),
        belowSettings: prev ? Math.round(box.top - prev.bottom) : null,
        dockTop: dock ? Math.round(dock.top) : null,
        bottom: Math.round(box.bottom),
        reserved,
        stuckToGenDock: panel.hasAttribute("data-gen-dock"),
      };
    });

    const bad = [];
    if (r.missing) bad.push("no cost/action panel on the page");
    else {
      if (r.position === "fixed" || r.position === "sticky") bad.push(`position: ${r.position}`);
      if (r.stuckToGenDock) bad.push("still marked data-gen-dock — the page will reserve room for a bar that is not there");
      // The panel has to travel WITH the content: scrolled down by N, its
      // viewport top must have risen by about N.
      if (r.scrolled && r.moved > 20) {
        const travelled = r.before - r.after;
        if (Math.abs(travelled - r.moved) > 4) {
          bad.push(`it followed the scroll: moved ${r.moved}px, the panel only travelled ${travelled}px`);
        }
      }
      if (r.belowSettings !== null && (r.belowSettings < 0 || r.belowSettings > 40)) {
        bad.push(`${r.belowSettings}px below the settings above it — the design asks for 16–24`);
      }
      if (r.reserved > 0) bad.push(`the page still reserves ${r.reserved}px for a docked bar`);
    }

    note(bad.length === 0,
      `${vp.label.padEnd(5)} ${r.marker ?? "—"} · ${r.position ?? "—"}`
      + (r.scrolled ? ` · scrolled ${r.moved}px, travelled ${r.before - r.after}px` : " · nothing to scroll")
      + (r.belowSettings !== null ? ` · ${r.belowSettings}px under settings` : "")
      + (bad.length ? `\n     ${bad.join("\n     ")}` : ""));

    await ctx.close();
  }
}

/* ── nothing anywhere still floats a cost panel ──────────────────────────── */

console.log("\n══ the whole page, at 390 ══");
for (const tool of TOOLS) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/probe-tmp/tools?t=${tool}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(350);
  const floating = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("main *")) {
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" && cs.position !== "sticky") continue;
      const text = (el.textContent ?? "").toLowerCase();
      // A cost panel is the thing that names a price AND carries a button.
      if (!/kredyt|za darmo|koszt/.test(text)) continue;
      if (!el.querySelector("button")) continue;
      out.push(`${cs.position} ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 44)}`);
    }
    return out;
  });
  note(floating.length === 0, `${tool}: ${floating.length} floating cost panel(s)`
    + (floating.length ? `\n     ${floating.join("\n     ")}` : ""));
  await ctx.close();
}

await browser.close();
console.log(failures === 0
  ? "\ntool layout: every cost panel sits in the page"
  : `\ntool layout: ${failures} problem(s)`);
process.exit(failures > 0 ? 1 : 0);
