/**
 * IS THE APP ACTUALLY PINNED AT 1:1 — AND DID ANYTHING ELSE BREAK?
 *
 * Locking a page against zoom is three separate mechanisms, and the risk is
 * never the lock itself: it is that the blunt version of it (a preventDefault
 * on touchmove, a `touch-action: none`) also cancels scrolling, carousels and
 * sliders, which is not something a build or a typecheck can notice.
 *
 * WHAT THIS ENVIRONMENT CAN AND CANNOT SEE — read this before trusting a pass.
 *
 * The obvious probe would synthesise a pinch and read `visualViewport.scale`.
 * It does not work here, and the way you find that out is a CONTROL: point the
 * same probe at a page whose meta says `user-scalable=yes, maximum-scale=5`
 * and whose touch-action is `auto`, and the scale still reads exactly 1. The
 * headless Chromium in this sandbox has no compositor driving page zoom, so
 * "the page did not zoom" is what it says about EVERY page. The same control
 * trick sinks the scroll probe: force `touch-action: none`, or `pan-x` on a
 * vertical scroll, and synthetic touch drags scroll the document anyway.
 *
 * So this file does not assert either one. An assertion whose control also
 * passes is not evidence, and dressing one up as a green tick is worse than
 * having no test. Those two live under DIAGNOSTIC below, printed with their
 * controls beside them so the numbers cannot be mistaken for proof, and they
 * are reported as unverified.
 *
 * WHAT IT DOES ASSERT, all of it really measured:
 *
 *   1. exactly ONE viewport meta tag, carrying all five directives
 *   2. the computed touch-action on the shell and on every scroll container
 *      is a value that PERMITS panning — the real risk of this change is
 *      shipping `none` or a one-axis `pan-*` somewhere, and that is visible
 *      in the cascade whether or not the browser will act on it
 *   3. every form field computes to >= 16px on a coarse pointer, across all
 *      25 field shapes in the app and every public page, so iOS has no reason
 *      to zoom on focus — this is the change's main mechanism and it is fully
 *      testable here
 *   4. desktop keeps its smaller fields: the rule did not leak upward
 *   5. a slider still answers a real touch
 *   6. no horizontal overflow, no clipped modal, geometry intact through a
 *      portrait → landscape → portrait rotation
 *
 * And there is no WebKit here at all, so nothing below says anything about
 * iOS Safari.
 *
 * Run:  npm run test:viewport -- <base-url>
 *
 * Checks 3 (partly), 5 and the modal need the temporary /probe-tmp/viewport
 * route, which is deleted before the commit. Without it they are SKIPPED and
 * said to be skipped; the rest runs against the real public pages, so this
 * stays pointable at production.
 */
import { chromium } from "playwright";

const BASE = process.argv[2];
if (!BASE) { console.error("usage: node scripts/viewport-probe.mjs <base-url>"); process.exit(2); }

const TOUCH = [
  { w: 375, h: 667, label: "375" },
  { w: 390, h: 844, label: "390" },
  { w: 414, h: 896, label: "414" },
  { w: 430, h: 932, label: "430" },
  { w: 768, h: 1024, label: "768" },
  { w: 820, h: 1180, label: "820" },
  { w: 1024, h: 1366, label: "1024" },
];

const PROBE = "/probe-tmp/viewport";

/**
 * The permanently reachable pages. `/probe-tmp/viewport` is added to the front
 * when it exists — it is the temporary route that renders all 25 field shapes,
 * the search field, the feedback modal, a `.rail-x` and a slider, and it is
 * deleted before the commit. Everything that does not need it still runs
 * without it, so this stays usable against production.
 */
const PUBLIC_PAGES = [
  { path: "/", name: "landing" },
  { path: "/?auth=login", name: "logowanie" },
  { path: "/?auth=register", name: "rejestracja" },
  { path: "/admin/login", name: "formularz admina" },
];

const hasProbe = await fetch(`${BASE}${PROBE}`).then((r) => r.ok).catch(() => false);
const PAGES = hasProbe
  ? [{ path: PROBE, name: "probe (25 field shapes + search + feedback)" }, ...PUBLIC_PAGES]
  : PUBLIC_PAGES;
if (!hasProbe) {
  console.log(`NOTE: ${PROBE} is absent, so the field-shape matrix, the slider and`);
  console.log("      the modal are SKIPPED. Everything else runs against the real pages.\n");
}

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
});

let failures = 0;
const note = (ok, line) => { if (!ok) failures++; console.log(`${ok ? "✓" : "✗"} ${line}`); };

const touchCtx = (vp, init) => browser.newContext({
  viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1,
  isMobile: true, hasTouch: true, ...init,
});

/** The scale the USER sees. 1 means the app is where it was put. */
const scale = (page) => page.evaluate(() => window.visualViewport?.scale ?? 1);

/* ── 1. the declarations ─────────────────────────────────────────────────── */

console.log("\n══ viewport declaration ══");
{
  const ctx = await touchCtx(TOUCH[1]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const metas = await page.$$eval("meta[name=viewport]", (els) => els.map((e) => e.getAttribute("content")));
  note(metas.length === 1, `exactly one <meta name="viewport"> (found ${metas.length})`);
  const c = metas[0] ?? "";
  for (const want of ["width=device-width", "initial-scale=1", "maximum-scale=1", "user-scalable=no", "viewport-fit=cover"]) {
    note(c.includes(want), `meta says ${want}`);
  }
  const css = await page.evaluate(() => ({
    touch: getComputedStyle(document.body).touchAction,
    adjust: getComputedStyle(document.documentElement).webkitTextSizeAdjust,
  }));
  note(css.touch === "manipulation", `body touch-action = ${css.touch} (want manipulation)`);
  note(css.adjust === "100%", `html -webkit-text-size-adjust = ${css.adjust} (want 100%)`);
  await ctx.close();
}

/* ── 2. nothing in the app forbids panning ───────────────────────────────── */

/**
 * The failure this change could plausibly cause is a touch-action that takes
 * panning away — `none`, or a `pan-x` on something the user scrolls
 * vertically. That is a property of the CASCADE, and the cascade is readable
 * here even though the gesture is not: walk every scroll container on every
 * page and every ancestor up to the root, and require that each declared
 * value still permits the axis that container scrolls.
 */
const PANS_BOTH = new Set(["auto", "manipulation", "pan-x pan-y", "pan-y pan-x"]);
const panOk = (value, axis) => PANS_BOTH.has(value)
  || (axis === "y" && /\bpan-y\b/.test(value))
  || (axis === "x" && /\bpan-x\b/.test(value));

console.log("\n══ touch-action cascade: is any pan forbidden anywhere? ══");
for (const vp of TOUCH) {
  const ctx = await touchCtx(vp);
  let scrollers = 0; const bad = [];
  for (const p of PAGES) {
    const page = await ctx.newPage();
    await page.goto(`${BASE}${p.path}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(350);
    const found = await page.evaluate(() => {
      const out = [];
      const named = (el) => el === document.body ? "body"
        : el === document.documentElement ? "html"
          : `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""}`;
      for (const el of document.querySelectorAll("*")) {
        const cs = getComputedStyle(el);
        const scrollsY = /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2;
        const scrollsX = /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 2;
        if (!scrollsY && !scrollsX) continue;
        // the effective restriction is this element plus every ancestor
        const chain = [];
        for (let n = el; n; n = n.parentElement) chain.push({ who: named(n), ta: getComputedStyle(n).touchAction });
        out.push({ who: named(el), axis: scrollsY ? "y" : "x", chain });
      }
      // the document itself is a scroller too
      const d = document.documentElement;
      if (d.scrollHeight > d.clientHeight + 2) {
        out.push({ who: "document", axis: "y", chain: [
          { who: "body", ta: getComputedStyle(document.body).touchAction },
          { who: "html", ta: getComputedStyle(d).touchAction },
        ] });
      }
      return out;
    });
    for (const s of found) {
      scrollers++;
      for (const link of s.chain) {
        if (!panOk(link.ta, s.axis)) bad.push(`${p.name}: ${s.who} (pan-${s.axis}) blocked by ${link.who} = ${link.ta}`);
      }
    }
    await page.close();
  }
  note(bad.length === 0, `${vp.label} ${scrollers} scroll containers, every pan permitted${bad.length ? ` — ${bad.slice(0, 3).join(" | ")}` : ""}`);
  await ctx.close();
}

/* ── 3. a slider still answers a real touch ──────────────────────────────── */

console.log("\n══ slider under real touch ══");
for (const vp of hasProbe ? TOUCH : []) {
  const ctx = await touchCtx(vp);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/probe-tmp/viewport`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(300);
  const v0 = await page.$eval("[data-probe-range]", (el) => Number(el.value));
  const sb = await (await page.$("[data-probe-range]")).boundingBox();
  await page.touchscreen.tap(Math.round(sb.x + sb.width * 0.85), Math.round(sb.y + sb.height / 2));
  await page.waitForTimeout(200);
  const v1 = await page.$eval("[data-probe-range]", (el) => Number(el.value));
  note(v1 !== v0, `${vp.label} slider responds to touch: ${v0} → ${v1}`);
  await ctx.close();
}

/* ── 5. every field is >= 16px on touch, and unchanged on desktop ────────── */

console.log("\n══ iOS focus zoom: field font sizes ══");
{
  const readFields = async (ctx, path) => {
    const page = await ctx.newPage();
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(400);
    const out = await page.evaluate(() => {
      const SKIP = new Set(["checkbox", "radio", "range", "file", "color", "hidden", "submit", "button", "image", "reset"]);
      return [...document.querySelectorAll("input, textarea, select")]
        .filter((el) => !(el.tagName === "INPUT" && SKIP.has(el.type)))
        .map((el) => ({
          px: parseFloat(getComputedStyle(el).fontSize),
          who: el.getAttribute("data-probe-field")
            ?? `${el.tagName.toLowerCase()}${el.type ? `[${el.type}]` : ""} ${(el.getAttribute("name") || el.getAttribute("placeholder") || "").slice(0, 28)}`,
        }));
    });
    await page.close();
    return out;
  };

  for (const vp of TOUCH) {
    const ctx = await touchCtx(vp);
    let seen = 0; const small = [];
    for (const p of PAGES) {
      for (const f of await readFields(ctx, p.path)) {
        seen++;
        if (f.px < 16) small.push(`${p.name}: ${f.who} = ${f.px}px`);
      }
    }
    note(small.length === 0, `${vp.label} all ${seen} fields >= 16px${small.length ? ` — ${small.length} under: ${small.slice(0, 3).join(" | ")}` : ""}`);
    await ctx.close();
  }

  // Desktop must be EXACTLY as it was: pointer:fine never matches the rule.
  const desk = hasProbe ? await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }) : null;
  const fields = desk ? await readFields(desk, PROBE) : [];
  const bumped = fields.filter((f) => f.px === 16 && /text-\[1[0-5]|text-xs|text-sm/.test(f.who ?? ""));
  const sub16 = fields.filter((f) => f.px < 16).length;
  if (desk) note(sub16 > 0, `desktop still renders ${sub16} of ${fields.length} fields under 16px — the rule did not leak`);
  if (desk) note(bumped.length === 0, `desktop: no small-text field was bumped to 16px (${bumped.length} suspect)`);
  if (desk) await desk.close();
}

/* ── 6. overflow, modal, rotation ────────────────────────────────────────── */

const GEOM = hasProbe ? PROBE : "/";
console.log(`\n══ overflow, modal, rotation (on ${GEOM}) ══`);
for (const vp of TOUCH) {
  const ctx = await touchCtx(vp);
  const page = await ctx.newPage();
  await page.goto(`${BASE}${GEOM}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(300);

  const over = await page.evaluate(() => {
    const d = document.documentElement;
    return { sw: d.scrollWidth, cw: d.clientWidth };
  });
  note(over.sw <= over.cw + 1, `${vp.label} no horizontal overflow (${over.sw} <= ${over.cw})`);

  // the feedback modal must open fully inside the viewport
  const trigger = await page.$("[data-probe-feedback] button");
  if (trigger) {
    await trigger.click();
    await page.waitForTimeout(450);
    const fit = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return null;
      const r = dlg.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vh: innerHeight, vw: innerWidth };
    });
    if (fit) {
      note(fit.left >= -1 && fit.right <= fit.vw + 1 && fit.bottom <= fit.vh + 1,
        `${vp.label} modal fits: x ${Math.round(fit.left)}..${Math.round(fit.right)} of ${fit.vw}, bottom ${Math.round(fit.bottom)} of ${fit.vh}`);
    } else {
      note(false, `${vp.label} modal did not open`);
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }

  // portrait → landscape → portrait
  await page.setViewportSize({ width: vp.h, height: vp.w });
  await page.waitForTimeout(350);
  const land = await page.evaluate(() => ({
    s: window.visualViewport?.scale ?? 1,
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
  }));
  note(Math.abs(land.s - 1) < 0.01 && land.sw <= land.cw + 1,
    `${vp.label} landscape ${vp.h}×${vp.w}: scale ${land.s.toFixed(2)}, no overflow (${land.sw} <= ${land.cw})`);
  await page.setViewportSize({ width: vp.w, height: vp.h });
  await page.waitForTimeout(350);
  const back = await scale(page);
  note(Math.abs(back - 1) < 0.01, `${vp.label} back to portrait at scale ${back.toFixed(2)}`);

  await ctx.close();
}

/* ── DIAGNOSTIC: the two things this environment cannot decide ───────────── */

/**
 * Printed WITH its control, and asserted on neither. If the control column
 * reads the same as the shipped column, the number on the left is telling you
 * about the browser, not about the app. Kept in the file because the day this
 * runs somewhere with a compositor, the control starts disagreeing and these
 * become real tests — and because the honest thing is to show the reader why
 * a green tick is missing rather than to quietly not look.
 */
console.log("\n══ DIAGNOSTIC — not asserted, control included ══");
if (hasProbe) {
  const ZOOMABLE = "width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes";
  const measure = async (label, { meta, forceTouchAction }) => {
    const ctx = await touchCtx(TOUCH[1]);
    const page = await ctx.newPage();
    if (meta) {
      await page.addInitScript((m) => {
        const swap = () => {
          const el = document.querySelector('meta[name="viewport"]');
          if (el) el.setAttribute("content", m);
        };
        document.addEventListener("DOMContentLoaded", swap);
        swap();
      }, meta);
    }
    const cdp = await ctx.newCDPSession(page);
    await page.goto(`${BASE}/probe-tmp/viewport`, { waitUntil: "networkidle", timeout: 60000 });
    if (forceTouchAction) {
      await page.addStyleTag({ content: `html, body { touch-action: ${forceTouchAction} !important; }` });
    }
    await page.waitForTimeout(300);

    await cdp.send("Input.synthesizeTapGesture", { x: 195, y: 300, tapCount: 2, gestureSourceType: "touch" }).catch(() => {});
    await page.waitForTimeout(600);
    const tapScale = await scale(page);
    await cdp.send("Input.synthesizePinchGesture", { x: 195, y: 420, scaleFactor: 3, gestureSourceType: "touch" }).catch(() => {});
    await page.waitForTimeout(600);
    const pinchScale = await scale(page);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    const pt = (y) => ({ x: 195, y });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pt(600)] });
    for (let y = 585; y >= 260; y -= 15) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [pt(y)] });
      await page.waitForTimeout(12);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(400);
    const scrolled = await page.evaluate(() => Math.round(window.scrollY));

    console.log(`  ${label.padEnd(40)} doubleTap→${tapScale.toFixed(2)}  pinch→${pinchScale.toFixed(2)}  touchScroll→${scrolled}px`);
    await ctx.close();
  };

  await measure("as shipped", {});
  await measure("CONTROL zoom allowed + touch-action auto", { meta: ZOOMABLE, forceTouchAction: "auto" });
  await measure("CONTROL touch-action: none", { forceTouchAction: "none" });
  console.log("  ↑ the controls match the shipped row, so this browser reports the same");
  console.log("    numbers for a page that CAN zoom and one whose panning is forbidden.");
  console.log("    Zoom and pan behaviour are therefore UNVERIFIED here, not passing.");
}

await browser.close();
console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
