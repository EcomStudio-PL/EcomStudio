/**
 * THE LANDING PAGE, MEASURED — not eyeballed in three screenshots.
 *
 * WHAT CHANGED, AND WHY THIS FILE WAS REWRITTEN RATHER THAN RELAXED.
 *
 * The first launch page was ONE SCREEN, and this probe enforced exactly that:
 * a document that scrolled by more than a few pixels was a defect. Landing V2
 * is a long page on purpose — the hero, then three before/after galleries,
 * an optional cost line and "who is behind it" tile, a final call to action,
 * the footer, and on a phone a sticky bar back to the form. "The page
 * scrolls" is no longer a finding, so the one-screen assertion is gone; what
 * replaced it is what can still be wrong on a long page:
 *
 *   · SIDEWAYS SCROLL at any width, portrait or landscape — and the widest
 *     element causing it. Elements inside a horizontal scroller (the gallery
 *     rails) are exempt: overflowing their own box is how a carousel works.
 *   · THE HERO FORM OUT OF REACH. From 768 up, the submit button of the hero
 *     form must be inside the first screenful: the hero geometry is still the
 *     approved one-screen composition, only the page under it grew.
 *   · OVERLAP INSIDE THE HERO. The badge is MEANT to sit on the artwork;
 *     nothing else is: headline × art, chips × form, headline × chips,
 *     brand × headline, offer × chips, form × benefits.
 *   · SECTIONS STACKED, NOT PILED. Hero, galleries, cost strip, creators tile,
 *     final call to action and footer follow each other top to bottom.
 *   · THE STICKY BAR (phones) never covers the footer or either form. The page
 *     is scrolled through in half-screen steps; wherever the bar is showing,
 *     it must not share a pixel with them — and at the very bottom (footer in
 *     view) it must be hidden.
 *   · ONE HERO IMAGE. Exactly one <img> inside [data-launch-art].
 *
 * Run:  npm start &  then
 *       node scripts/landing-geometry.mjs http://localhost:3000 [/path]
 *
 * The path defaults to "/". Against a database where "/" is not the launch
 * page, point it at a page that renders <LaunchPage> (the integration harness
 * uses a temporary fixture route; it is not part of the app).
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3000";
const PATH = process.argv[3] ?? "/";

/** Eleven portrait widths from the brief (phone → wide desktop) and the
 *  landscapes the phones and tablets become when turned. Heights are the real
 *  devices', because the hero still caps in svh. */
const VIEWPORTS = [
  { w: 320, h: 568, label: "320 phone (SE)", mobile: true },
  { w: 360, h: 780, label: "360 Android", mobile: true },
  { w: 375, h: 667, label: "375 phone", mobile: true },
  { w: 390, h: 844, label: "390 phone", mobile: true },
  { w: 414, h: 896, label: "414 phone", mobile: true },
  { w: 430, h: 932, label: "430 phone", mobile: true },
  { w: 768, h: 1024, label: "768 tablet portrait", mobile: true },
  { w: 820, h: 1180, label: "820 tablet portrait", mobile: true },
  { w: 1024, h: 1366, label: "1024 tablet portrait", mobile: true },
  { w: 1280, h: 800, label: "1280 desktop" },
  { w: 1440, h: 900, label: "1440 desktop" },
  { w: 1920, h: 1080, label: "1920 desktop" },
  { w: 667, h: 375, label: "667 phone landscape", mobile: true, landscape: true },
  { w: 844, h: 390, label: "844 phone landscape", mobile: true, landscape: true },
  { w: 1024, h: 768, label: "1024 tablet landscape", mobile: true },
  { w: 1180, h: 820, label: "1180 tablet landscape", mobile: true },
];

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
});

/** Two boxes share pixels (both axes), by how much vertically. */
function overlap(a, b) {
  if (!a || !b) return 0;
  const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  return y > 1 && x > 1 ? y : 0;
}

let bad = 0;
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: 2,
    isMobile: Boolean(vp.mobile),
    hasTouch: Boolean(vp.mobile),
  });
  const page = await ctx.newPage();
  await page.goto(BASE + PATH, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(450);

  const probe = await page.evaluate((vw) => {
    if (!document.querySelector("[data-launch-page]")) return { missing: true };
    const doc = document.documentElement;
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return {
        top: Math.round(r.top + window.scrollY), left: Math.round(r.left),
        right: Math.round(r.right), bottom: Math.round(r.bottom + window.scrollY),
        w: Math.round(r.width), h: Math.round(r.height),
      };
    };
    const q = (sel) => box(document.querySelector(sel));

    // What sticks out sideways, ignoring anything inside its own horizontal
    // scroller — a carousel's cards are SUPPOSED to run past the edge of the
    // rail, which clips them.
    // (Only auto/scroll: the page's own `overflow-x: clip` is what keeps the
    // artwork from widening the document, and the scrollWidth figure above
    // already tells whether anything escapes it.)
    const scrollsX = (el) => /(auto|scroll)/.test(getComputedStyle(el).overflowX) && el !== document.body && el !== doc;
    let worst = null;
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (scrollsX(p)) { clipped = true; break; }
      }
      if (clipped) continue;
      const over = Math.round(r.right - vw);
      if (over > 1 && (!worst || over > worst.over)) {
        worst = { over, tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 70) };
      }
    }

    const sections = [
      ["hero", "[data-launch-hero]"], ["galleries", "[data-launch-galleries]"], ["cost", "[data-launch-cost]"],
      ["creators", "[data-launch-creators]"], ["final", "[data-launch-final]"], ["footer", "[data-launch-footer]"],
    ].map(([name, sel]) => [name, q(sel)]).filter(([, b]) => b);

    return {
      scrollW: Math.round(doc.scrollWidth),
      scrollH: Math.round(doc.scrollHeight),
      viewH: Math.round(window.innerHeight),
      worst,
      artImages: document.querySelectorAll("[data-launch-art] img").length,
      art: q("[data-launch-art]"),
      badge: q("[data-launch-badge]"),
      h1: q("[data-launch-h1]"),
      offer: q("[data-launch-offer]"),
      chips: q("[data-launch-features]"),
      form: q("#zapis"),
      submit: q("#zapis button[type=submit]"),
      perks: q("[data-launch-perks]"),
      brand: q("header a[href='/']"),
      login: q("[data-launch-login]"),
      sections,
    };
  }, vp.w);

  if (probe.missing) {
    console.log(`✗ ${vp.label}: no [data-launch-page] at ${PATH} — is this the launch page?`);
    bad++;
    await ctx.close();
    continue;
  }

  const notes = [];
  const info = [];
  if (probe.scrollW > vp.w + 1) {
    notes.push(`SIDEWAYS +${probe.scrollW - vp.w}px` + (probe.worst ? ` (${probe.worst.tag}.${probe.worst.cls})` : ""));
  }
  if (probe.artImages !== 1) notes.push(`${probe.artImages} hero images (want exactly 1)`);

  // The hero form, within reach on every screen with room for it. A phone is
  // a document and has always asked for one swipe to reach the field; a
  // landscape phone is shorter than the form itself.
  if (vp.w >= 768 && !vp.landscape && probe.submit && probe.submit.bottom > probe.viewH) {
    notes.push(`hero SUBMIT ${probe.submit.bottom - probe.viewH}px below the fold`);
  }

  // The art box's bottom sixth is a fade to the page background; type laid
  // over that strip sits on plain ground, so the art is compared by its
  // picture, not its box. On desktop the art is a right-hand panel — the
  // headline never reaches it horizontally.
  const art = probe.art && probe.art.h > 0
    ? { ...probe.art, bottom: Math.round(probe.art.top + probe.art.h * 0.84) } : null;
  for (const [an, a, bn, b] of [
    ["h1", probe.h1, "art", vp.w < 1024 ? art : null],
    ["chips", probe.chips, "form", probe.form], ["form", probe.form, "perks", probe.perks],
    ["h1", probe.h1, "chips", probe.chips], ["brand", probe.brand, "h1", probe.h1],
    ["offer", probe.offer, "chips", probe.chips], ["h1", probe.h1, "offer", probe.offer],
  ]) {
    const px = overlap(a, b);
    if (px > 2) notes.push(`${an}×${bn} overlap ${px}px`);
  }
  if (probe.brand && probe.login && probe.brand.right > probe.login.left + 1) notes.push("logo runs into sign-in");

  // Sections in document order, none on top of the next.
  for (let i = 1; i < probe.sections.length; i++) {
    const [pn, prev] = probe.sections[i - 1];
    const [cn, cur] = probe.sections[i];
    if (cur.top < prev.bottom - 2) notes.push(`${cn} starts ${prev.bottom - cur.top}px inside ${pn}`);
  }
  info.push(`doc ${probe.scrollH}px`);

  // ── THE STICKY BAR, scrolled through (phones and small tablets only) ──
  if (vp.w < 768) {
    const height = probe.scrollH;
    let shownSomewhere = false;
    for (let y = 0; y <= height; y += Math.max(200, Math.round(vp.h / 2))) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(380);
      const s = await page.evaluate(() => {
        const bar = document.querySelector("[data-launch-sticky-cta]");
        if (!bar) return null;
        const wrap = document.querySelector("[data-launch-sticky]");
        const shown = Number(getComputedStyle(wrap).opacity) > 0.5 && wrap.getAttribute("aria-hidden") !== "true";
        const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
        const footer = r(document.querySelector("[data-launch-footer]"));
        const footerInView = footer && footer.top < window.innerHeight && footer.bottom > 0;
        return {
          shown, bar: r(bar), footer, footerInView,
          forms: [r(document.getElementById("zapis")), r(document.getElementById("zapis-koniec"))].filter(Boolean),
        };
      });
      if (!s) break;
      if (s.shown) {
        shownSomewhere = true;
        if (overlap(s.bar, s.footer) > 0) notes.push(`sticky bar covers the footer at scrollY ${y}`);
        for (const f of s.forms) if (overlap(s.bar, f) > 0) notes.push(`sticky bar covers a form at scrollY ${y}`);
      }
      if (s.footerInView && s.shown) notes.push(`sticky bar showing while the footer is on screen (scrollY ${y})`);
    }
    info.push(shownSomewhere ? "sticky: appears mid-page" : "sticky: never shown");
  }

  if (notes.length) bad++;
  console.log(
    `${notes.length ? "✗" : "✓"} ${String(vp.label).padEnd(24)} ${String(vp.w + "×" + vp.h).padEnd(10)}`
    + (probe.submit ? ` submit@${probe.submit.bottom}/${probe.viewH}` : " submit: —")
    + (info.length ? `  [${info.join(", ")}]` : "")
    + (notes.length ? `\n     ${[...new Set(notes)].join("\n     ")}` : ""),
  );
  await ctx.close();
}
await browser.close();
console.log(`\n${VIEWPORTS.length - bad}/${VIEWPORTS.length} viewports clean`);
process.exit(bad > 0 ? 1 : 0);
