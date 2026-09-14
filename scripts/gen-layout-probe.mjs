/**
 * THE BOTTOM OF A GENERATOR PAGE, MEASURED.
 *
 * A phone screenshot shows "a big empty gap"; it cannot show WHICH box owns
 * that height. This walks the chain from the app shell down to the last card
 * and prints every element's own padding, so the gap has an owner rather than
 * a guess — and then answers the two questions that actually decide whether
 * the page is usable:
 *
 *   · Is the feedback CTA reachable by scrolling to the bottom, or does it end
 *     up underneath the docked toolbar and the navigation, where only an
 *     overscroll bounce reveals it?
 *   · Is the LAST image of the gallery reachable on the same terms?
 *
 * Both are asked at the real scroll bottom, against the real fixed chrome
 * measured from the live DOM — not against the token that is supposed to
 * describe it. A token that disagrees with the bar it describes is exactly the
 * bug this is looking for.
 *
 * Run:  npm run dev &  then  node scripts/gen-layout-probe.mjs http://localhost:3000/<path>
 */
import { chromium } from "playwright";

const URL = process.argv[2] ?? "http://localhost:3000/probe-tmp";

const PHONES = [
  { w: 375, h: 667, label: "375 iPhone SE/8" },
  { w: 390, h: 844, label: "390 iPhone 14" },
  { w: 414, h: 896, label: "414 iPhone 11" },
  { w: 430, h: 932, label: "430 iPhone Pro Max" },
];
const WIDE = [
  { w: 768, h: 1024, label: "768 tablet portrait", mobile: true },
  { w: 820, h: 1180, label: "820 tablet portrait", mobile: true },
  { w: 1024, h: 768, label: "1024 landscape", mobile: true },
  { w: 1280, h: 800, label: "1280 desktop" },
  { w: 1440, h: 900, label: "1440 desktop" },
  { w: 1920, h: 1080, label: "1920 desktop" },
];

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
});

let failures = 0;
for (const vp of [...PHONES, ...WIDE]) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2,
    isMobile: vp.mobile ?? vp.w < 768, hasTouch: vp.mobile ?? vp.w < 768,
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(500);
  // Scroll to the real bottom: everything below is judged from there, because
  // that is where the customer ends up and where the bug shows.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(350);

  const r = await page.evaluate(() => {
    const px = (v) => Math.round(parseFloat(v) || 0);
    const one = (sel, name) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      return {
        name, padBottom: px(cs.paddingBottom), marginBottom: px(cs.marginBottom),
        height: Math.round(b.height),
        top: Math.round(b.top + window.scrollY), bottom: Math.round(b.bottom + window.scrollY),
      };
    };
    const chain = [
      one(".app-shell", "app-shell"),
      one(".app-shell > main", "main"),
      one(".gen-shell", "gen-shell"),
      one(".gen-shell-body", "gen-shell-body"),
    ].filter(Boolean);

    // The fixed chrome, measured rather than taken from a token.
    const dockEl = document.querySelector("[data-gen-dock]")
      ?? [...document.querySelectorAll("div")].find((d) => {
        const cs = getComputedStyle(d);
        return cs.position === "fixed" && d.querySelector(".cta") && cs.display !== "none";
      });
    const navEl = document.querySelector("nav.fixed");
    const box = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return null;
      const b = el.getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height) };
    };
    const dock = box(dockEl);
    const nav = box(navEl);
    // Top edge of everything the fixed chrome covers, in viewport coordinates.
    const chromeTop = Math.min(
      dock ? dock.top : Number.POSITIVE_INFINITY,
      nav ? nav.top : Number.POSITIVE_INFINITY,
    );

    const vis = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        top: Math.round(b.top), bottom: Math.round(b.bottom),
        // How far its bottom edge sits INSIDE the covered strip. >0 means the
        // fixed chrome is on top of it at the page's own scroll bottom.
        covered: Math.round(b.bottom - chromeTop),
      };
    };

    const cards = document.querySelectorAll("[data-gallery-card]");
    const lastCard = cards.length ? cards[cards.length - 1] : null;
    const lastCardBox = lastCard ? (() => {
      const b = lastCard.getBoundingClientRect();
      return { bottom: Math.round(b.bottom), covered: Math.round(b.bottom - chromeTop) };
    })() : null;

    const doc = document.documentElement;
    return {
      chain,
      scrollH: doc.scrollHeight, viewH: window.innerHeight,
      scrolledBy: Math.round(window.scrollY),
      atBottom: Math.round(doc.scrollHeight - window.innerHeight - window.scrollY),
      dock, nav, chromeTop: Number.isFinite(chromeTop) ? chromeTop : null,
      cta: vis("[data-feedback-cta]"),
      cards: cards.length,
      lastCard: lastCardBox,
      // The distance between the end of the workspace's own content and the
      // start of the CTA — the "empty gap" a screenshot shows.
      gap: (() => {
        const body = document.querySelector(".gen-shell-body");
        const cta = document.querySelector("[data-feedback-cta]");
        if (!body || !cta) return null;
        return Math.round(cta.getBoundingClientRect().top - body.getBoundingClientRect().bottom);
      })(),
    };
  });

  const problems = [];
  if (r.cta) {
    if (r.cta.covered > 0) problems.push(`FEEDBACK CTA under the fixed chrome by ${r.cta.covered}px`);
  } else if (vp.w < 1024) {
    problems.push("feedback CTA missing");
  }
  if (r.lastCard && r.lastCard.covered > 0) {
    problems.push(`LAST IMAGE under the fixed chrome by ${r.lastCard.covered}px`);
  }
  // Reserved room that nothing occupies. Some is right — the dock has to be
  // cleared — but it must be reserved ONCE, at the outermost scroller.
  const doubled = r.chain.filter((c) => c.padBottom > 0).map((c) => `${c.name} pb=${c.padBottom}`);
  if (doubled.length > 1 && vp.w < 1024) problems.push(`bottom offset in ${doubled.length} nested boxes: ${doubled.join(", ")}`);

  if (problems.length) failures++;
  const chainStr = r.chain.map((c) => `${c.name}(h${c.height} pb${c.padBottom})`).join(" > ");
  console.log(
    `${problems.length ? "✗" : "✓"} ${vp.label.padEnd(22)} doc ${r.scrollH}/${r.viewH}`
    + `  dock ${r.dock ? `${r.dock.height}px@${r.dock.top}` : "—"}`
    + `  nav ${r.nav ? `${r.nav.height}px@${r.nav.top}` : "—"}`
    + `  cta ${r.cta ? `${r.cta.top}..${r.cta.bottom} cov${r.cta.covered}` : "—"}`
    + `  gapBodyToCta ${r.gap ?? "—"}`
    + `\n    ${chainStr}`
    + (problems.length ? `\n    ${problems.join("\n    ")}` : "")
  );
  await ctx.close();
}
await browser.close();
console.log(failures === 0 ? "\nbottom of the page is clean at every width" : `\n${failures} viewport(s) failed`);
process.exit(failures > 0 ? 1 : 0);
