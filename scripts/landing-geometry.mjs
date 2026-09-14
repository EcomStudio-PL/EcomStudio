/**
 * THE LANDING PAGE, MEASURED — not eyeballed in three screenshots.
 *
 * The pre-launch page is supposed to be ONE SCREEN: headline, proof chips,
 * form and perks all above the fold, with the artwork behind them. Whether it
 * actually is depends on arithmetic nobody can do by looking — the band is
 * `min(62vw, 32svh)` tall, the content pad is derived from it, and every
 * element from lg up is sized in vw. A width where the sum overflows looks
 * fine in a screenshot of the top of the page.
 *
 * So this reports, per viewport, the five things that can actually be wrong:
 *
 *   · SIDEWAYS SCROLL. scrollWidth past the viewport, and the widest element
 *     that causes it. The commonest way a page is broken without anyone seeing
 *     it on a desktop.
 *   · THE PAGE NOT FITTING. How far the document scrolls vertically. On this
 *     page that is a defect, not a preference: the form is the whole point and
 *     a visitor who has to scroll to find it is a visitor who does not fill it
 *     in.
 *   · THE FORM OUT OF REACH. Whether the submit control is inside the first
 *     screenful, and by how much it misses.
 *   · OVERLAP. The badge is MEANT to sit on the artwork; nothing else is. Any
 *     other pair of landmarks sharing pixels is a bug.
 *   · THE BAND ITSELF. Where the artwork starts and ends, so a change to
 *     `--hero-top` / `--hero-art` can be confirmed as the few pixels it was
 *     supposed to be rather than assumed.
 *
 * Run:  npm start &  then  node scripts/landing-geometry.mjs http://localhost:3000
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3000";

/** The widths the brief names, plus the tablet landscapes those portraits
 *  become when somebody turns the device over. Height is the real device's,
 *  because every cap on this page is in svh. */
const VIEWPORTS = [
  { w: 320, h: 568, label: "320 phone (SE)", mobile: true },
  { w: 375, h: 667, label: "375 phone", mobile: true },
  { w: 390, h: 844, label: "390 phone", mobile: true },
  { w: 414, h: 896, label: "414 phone", mobile: true },
  { w: 430, h: 932, label: "430 phone", mobile: true },
  { w: 768, h: 1024, label: "768 tablet portrait", mobile: true },
  { w: 810, h: 1080, label: "810 tablet portrait", mobile: true },
  { w: 820, h: 1180, label: "820 tablet portrait", mobile: true },
  { w: 834, h: 1112, label: "834 tablet portrait", mobile: true },
  { w: 1024, h: 1366, label: "1024 tablet portrait", mobile: true },
  { w: 1024, h: 768, label: "1024 tablet landscape", mobile: true },
  { w: 1080, h: 810, label: "1080 tablet landscape", mobile: true },
  { w: 1112, h: 834, label: "1112 tablet landscape", mobile: true },
  { w: 1180, h: 820, label: "1180 tablet landscape", mobile: true },
  { w: 1280, h: 800, label: "1280 desktop" },
  { w: 1440, h: 900, label: "1440 desktop" },
  { w: 1920, h: 1080, label: "1920 desktop" },
];

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
});

const rows = [];
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: 2,
    isMobile: Boolean(vp.mobile),
    hasTouch: Boolean(vp.mobile),
  });
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(450);

  const probe = await page.evaluate((vw) => {
    const doc = document.documentElement;
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top + window.scrollY), left: Math.round(r.left),
        right: Math.round(r.right), bottom: Math.round(r.bottom + window.scrollY),
        w: Math.round(r.width), h: Math.round(r.height),
      };
    };

    // What actually sticks out sideways. An element inside its own horizontal
    // scroller is allowed to; nothing on this page has one, so anything past
    // the edge is real.
    let worst = null;
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const over = Math.round(r.right - vw);
      if (over > 1 && (!worst || over > worst.over)) {
        worst = { over, tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 70) };
      }
    }

    const style = getComputedStyle(document.querySelector("[data-launch-page]"));
    return {
      scrollW: Math.round(doc.scrollWidth),
      scrollH: Math.round(doc.scrollHeight),
      viewH: Math.round(window.innerHeight),
      worst,
      heroTop: style.getPropertyValue("--hero-top").trim(),
      heroArt: style.getPropertyValue("--hero-art").trim(),
      band: box("[data-launch-art-mobile]"),
      badge: box("[data-launch-badge]"),
      h1: box("[data-launch-h1]"),
      chips: box("[data-launch-features]"),
      form: box("[data-launch-form-card]"),
      submit: box("[data-launch-form-card] button[type=submit]"),
      perks: box("[data-launch-perks]"),
      brand: box("header a[href='/']"),
      login: box("[data-launch-login]"),
      footer: box("footer"),
    };
  }, vp.w);

  rows.push({ vp, ...probe });
  await ctx.close();
}
await browser.close();

/** Two boxes share pixels. The badge ON the artwork is the composition; every
 *  other pair is a defect. */
function overlap(a, b) {
  if (!a || !b) return 0;
  const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  return y > 1 && x > 1 ? y : 0;
}

let bad = 0;
for (const r of rows) {
  const { vp } = r;
  const notes = [];

  if (r.scrollW > vp.w + 1) {
    notes.push(`SIDEWAYS +${r.scrollW - vp.w}px` + (r.worst ? ` (${r.worst.tag}.${r.worst.cls})` : ""));
  }
  const scrollBy = r.scrollH - r.viewH;
  if (scrollBy > 2) notes.push(`page scrolls ${scrollBy}px`);

  // The form is the page's one job.
  if (r.submit && r.submit.bottom > r.viewH) {
    notes.push(`SUBMIT ${r.submit.bottom - r.viewH}px below the fold`);
  }

  // Pairs that must never meet. The badge/band pair is deliberately absent.
  for (const [an, bn] of [["h1", "band"], ["chips", "form"], ["form", "perks"],
    ["h1", "chips"], ["brand", "h1"], ["perks", "footer"], ["form", "footer"]]) {
    const px = overlap(r[an], r[bn]);
    if (px > 2) notes.push(`${an}×${bn} overlap ${px}px`);
  }
  // The login entry and the logo are in the same row: they must not collide.
  if (r.brand && r.login && r.brand.right > r.login.left + 1) notes.push("logo runs into sign-in");

  if (notes.length) bad++;
  const band = r.band ? `band ${r.band.top}→${r.band.bottom} (${r.band.h}px)` : "band: desktop panel";
  const badge = r.badge ? `badge@${r.badge.top}` : "badge: none";
  console.log(
    `${notes.length ? "✗" : "✓"} ${String(vp.label).padEnd(24)} ${String(vp.w + "×" + vp.h).padEnd(10)}` +
    ` ${band.padEnd(28)} ${badge.padEnd(14)} doc ${r.scrollH}/${r.viewH}` +
    (notes.length ? `\n     ${notes.join("\n     ")}` : "")
  );
}
console.log(`\n${rows.length - bad}/${rows.length} viewports clean`);
process.exit(bad > 0 ? 1 : 0);
