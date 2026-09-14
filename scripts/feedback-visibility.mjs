/**
 * IS THE FEEDBACK CTA ACTUALLY ON THE SCREEN?
 *
 * "Rendered" is not the question — the element is in the DOM on every customer
 * page. The question is whether a person can see it and press it, which is a
 * different thing and fails in four distinct ways:
 *
 *   · switched off by a rule (`display: none` on a breakpoint);
 *   · clipped by an ancestor's `overflow: hidden` — the viewport-locked
 *     generator frame is exactly this shape;
 *   · pushed outside the document, so no amount of scrolling reaches it;
 *   · covered by something fixed or sticky at the moment you scroll to it.
 *
 * So each width is checked at the page's real scroll bottom, against the real
 * computed styles and the real fixed chrome, and every ancestor between the CTA
 * and the document root is walked looking for the box that swallows it. A
 * report that says "hidden" without naming the ancestor is the report that
 * sends the next person hunting through a stylesheet.
 *
 * Run:  npm run dev &  then  node scripts/feedback-visibility.mjs <url> [<url>…]
 */
import { chromium } from "playwright";

const URLS = process.argv.slice(2);
if (URLS.length === 0) {
  console.error("usage: node scripts/feedback-visibility.mjs <url> [<url>…]");
  process.exit(2);
}

const WIDTHS = [
  { w: 390, h: 844, label: "390 phone", mobile: true },
  { w: 768, h: 1024, label: "768 tablet", mobile: true },
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
for (const url of URLS) {
  console.log(`\n── ${url}`);
  for (const vp of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1,
      isMobile: Boolean(vp.mobile), hasTouch: Boolean(vp.mobile),
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(350);

    const r = await page.evaluate(() => {
      const el = document.querySelector("[data-feedback-cta]");
      if (!el) return { missing: true };
      const cs = getComputedStyle(el);
      const b = el.getBoundingClientRect();

      // Which ancestor, if any, is eating it.
      let clipper = null;
      let hider = null;
      for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (!hider && (s.display === "none" || s.visibility === "hidden" || s.opacity === "0")) {
          hider = `${p.tagName.toLowerCase()}.${String(p.className).slice(0, 48)} (${s.display === "none" ? "display:none" : s.visibility === "hidden" ? "visibility:hidden" : "opacity:0"})`;
        }
        if (p === el) continue;
        const clips = s.overflow !== "visible" && s.overflow !== "clip visible";
        if (clips && !clipper) {
          const pb = p.getBoundingClientRect();
          // Only a box that actually cuts this element off counts.
          if (b.bottom > pb.bottom + 1 || b.top < pb.top - 1) {
            clipper = `${p.tagName.toLowerCase()}.${String(p.className).slice(0, 48)} (overflow:${s.overflow}, its bottom ${Math.round(pb.bottom)} vs cta bottom ${Math.round(b.bottom)})`;
          }
        }
      }

      // What covers the point the button occupies, right now.
      const btn = el.querySelector("button");
      const bb = btn?.getBoundingClientRect();
      const at = bb ? document.elementFromPoint(
        Math.round(bb.left + bb.width / 2), Math.round(bb.top + bb.height / 2),
      ) : null;
      const coveredBy = at && btn && !btn.contains(at) && at !== btn
        ? `${at.tagName.toLowerCase()}.${String(at.className).slice(0, 48)}`
        : null;

      const doc = document.documentElement;
      return {
        display: cs.display,
        box: { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height), w: Math.round(b.width) },
        inViewport: b.height > 0 && b.bottom > 0 && b.top < window.innerHeight,
        pastDocument: Math.round(b.bottom + window.scrollY - doc.scrollHeight),
        hider, clipper, coveredBy,
        buttonText: btn?.textContent?.trim().slice(0, 40) ?? null,
      };
    });

    const problems = [];
    if (r.missing) problems.push("not in the DOM");
    else {
      if (r.display === "none") problems.push("display:none");
      if (r.hider) problems.push(`hidden by ${r.hider}`);
      if (r.clipper) problems.push(`clipped by ${r.clipper}`);
      if (r.pastDocument > 1) problems.push(`${r.pastDocument}px past the end of the document`);
      if (!r.inViewport && !r.hider && r.display !== "none") problems.push("not on screen at the page's scroll bottom");
      if (r.coveredBy) problems.push(`covered by ${r.coveredBy}`);
    }

    if (problems.length) failures++;
    console.log(
      `${problems.length ? "✗" : "✓"} ${vp.label.padEnd(12)}`
      + (r.missing ? " —" : ` ${r.display.padEnd(6)} box ${r.box.top}..${r.box.bottom} (${r.box.w}×${r.box.h})`)
      + (problems.length ? `\n    ${problems.join("\n    ")}` : "")
    );
    await ctx.close();
  }
}
await browser.close();
console.log(failures === 0 ? "\nthe CTA is visible and pressable everywhere" : `\n${failures} case(s) where nobody can press it`);
process.exit(failures > 0 ? 1 : 0);
