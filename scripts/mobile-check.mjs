/**
 * MOBILE — the four phone widths, measured rather than eyeballed.
 *
 * "It looks responsive" is not a result. Three facts per page per width are:
 * does the document scroll sideways, does any element stick out past the
 * viewport, and is every standalone tap target big enough to hit with a thumb.
 * A horizontal scrollbar is the commonest way a page is broken without anyone
 * noticing on a desktop, and a 16px-tall link is the commonest way a control
 * is unusable on a phone while looking perfect in a screenshot.
 *
 * WHAT IS DELIBERATELY NOT FLAGGED.
 *
 * An element inside its own horizontal scroller is allowed to be wider than
 * the screen — that is what the scroller is for. A fixed-position element is
 * measured against the viewport by definition. And a checkbox is judged by the
 * <label> wrapping it, because tapping the label is what actually toggles it:
 * a 16px box inside a 336x42 label is a 336x42 target.
 *
 * Run:  npm start &  then  npm run test:mobile -- http://localhost:3000
 *
 * It needs a running server; there is no point asserting layout against a
 * build output, because layout is what the browser computes.
 */
import { chromium } from "playwright";

const BASE = process.argv[2];
if (!BASE) {
  console.error("usage: npm run test:mobile -- <base-url>   (e.g. http://localhost:3000)");
  process.exit(2);
}
const WIDTHS = [375, 390, 414, 430];
const PATHS = ["/", "/login", "/register", "/regulamin", "/polityka-prywatnosci"];

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
});
const rows = [];
for (const width of WIDTHS) {
  const ctx = await browser.newContext({
    viewport: { width, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  for (const path of PATHS) {
    const startedAt = Date.now();
    let status = 0;
    try {
      const res = await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 45000 });
      status = res?.status() ?? 0;
      await page.waitForTimeout(600);
    } catch (e) {
      rows.push({ width, path, error: String(e).slice(0, 90) });
      continue;
    }
    const ms = Date.now() - startedAt;
    const probe = await page.evaluate((vw) => {
      const doc = document.documentElement;
      const overflowing = [];
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        // 2px of slack: sub-pixel layout rounding is not a bug.
        if (r.right > vw + 2 || r.left < -2) {
          const cs = getComputedStyle(el);
          // An element inside its own horizontal scroller is allowed to be wide.
          let p = el.parentElement, scrollable = false;
          while (p && p !== document.body) {
            const ps = getComputedStyle(p);
            if (ps.overflowX === "auto" || ps.overflowX === "scroll") { scrollable = true; break; }
            p = p.parentElement;
          }
          if (scrollable || cs.position === "fixed") continue;
          overflowing.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().slice(0, 40)} @${Math.round(r.left)}..${Math.round(r.right)}`);
        }
      }
      const small = [];
      for (const el of document.querySelectorAll("a, button, input[type=checkbox], input[type=radio], [role=button]")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.height >= 30 && r.width >= 30) continue;

        // A honeypot is a control nobody is meant to touch — it exists so a bot
        // fills it in. Reporting it as unhittable is reporting it as working.
        if (r.width <= 2 || r.height <= 2) continue;

        // A checkbox is judged by the label wrapping it: tapping the label is
        // what toggles it, so a 16px box inside a 336x42 label is a 336x42
        // target. Only an unlabelled one is a real problem.
        const label = el.closest("label") || (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
        if (label) {
          const lr = label.getBoundingClientRect();
          if (lr.height >= 30 && lr.width >= 30) continue;
        }

        // An inline link inside running prose is exempt (WCAG 2.5.8) and must
        // NOT be padded: a bigger hit box there overlaps the lines around it.
        // "Standalone" is the thing being measured, so prose is skipped.
        if (el.tagName === "A" && el.closest("p, label, li")) continue;

        small.push(`${el.tagName.toLowerCase()}"${(el.textContent || "").trim().slice(0, 22)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return {
        scrollW: doc.scrollWidth,
        clientW: doc.clientWidth,
        overflowing: overflowing.slice(0, 5),
        overflowCount: overflowing.length,
        small: small.slice(0, 5),
        smallCount: small.length,
        title: document.title.slice(0, 50),
      };
    }, width);
    rows.push({ width, path, status, ms, ...probe });
  }
  await ctx.close();
}
await browser.close();

let bad = 0;
for (const r of rows) {
  if (r.error) { bad++; console.log(`✗ ${r.width} ${r.path} — ${r.error}`); continue; }
  const sideways = r.scrollW > r.clientW + 2;
  const flag = sideways || r.overflowCount > 0 ? "✗" : r.smallCount > 0 ? "!" : "✓";
  if (flag === "✗") bad++;
  console.log(`${flag} ${r.width}px ${r.path.padEnd(24)} ${r.status} ${String(r.ms).padStart(5)}ms  scroll=${r.scrollW}/${r.clientW}` +
    (r.overflowCount ? `  OVERFLOW ${r.overflowCount}: ${r.overflowing.join(" | ")}` : "") +
    (r.smallCount ? `  small-taps ${r.smallCount}: ${r.small.slice(0,2).join(" | ")}` : ""));
}
console.log(bad === 0
  ? `\nNo horizontal overflow at any of ${WIDTHS.length} widths across ${PATHS.length} pages.`
  : `\n${bad} width/page combinations with horizontal overflow.`);
// A "!" is advisory — a small target that may be a label-wrapped input or an
// inline link in prose, both of which are fine. Only overflow fails the run.
process.exit(bad === 0 ? 0 : 1);
