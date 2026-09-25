/**
 * THE HOME / START, DRIVEN IN A REAL BROWSER AT EVERY WIDTH THE BRIEF NAMES.
 *
 * `npm run test:home` proves the lists, the routes, the slots and the wiring.
 * This proves what only a browser can: that no width scrolls sideways, that
 * the rail and the chips are carousels on a phone and grids above it, that a
 * desktop row really is one row, that the seven Reklamy tiles are equal
 * photo tiles in their rows, that nothing shifts once it has painted, that a
 * visitor's press opens the existing sign-in dialog instead of navigating, and
 * that in the signed-in shell the bottom navigation neither covers the page
 * nor lights up twice.
 *
 * THE HARNESS. /start and /home read Supabase, which this probe runs without.
 * So the harness mounts the REAL ProductHome, fed by `homeModel()` over the
 * registry defaults and the real dictionary, at /probe-tmp/home — in the public
 * chrome (the same MegaTopbar ProductSurface draws) or, with ?signed=1, in the
 * (app) shell (bar, <main> padding, bottom navigation). The browser is then
 * told that /start and /home ARE that page, so the address bar — and the
 * bottom navigation's active tab — say what production says.
 *
 *   node scripts/home-probe.mjs --harness
 *   npm run build && npx next start -p 3121 &
 *   node scripts/home-probe.mjs http://127.0.0.1:3121
 *   node scripts/home-probe.mjs --clean
 */
import fs from "node:fs";
import { chromium } from "playwright";

const DIR = "app/probe-tmp/home";

const PAGE_SRC = `import { getDictionary, getScopedDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { allDefaults } from "@/lib/features";
import { homeModel } from "@/lib/home-sections";
import { HOME_SLOT, toolSlotKey } from "@/lib/media-slots";
import type { ResolvedSlot, SlotMap } from "@/lib/server/media-slots";
import { ProductHome } from "@/components/home/product-home";
import { ProbeChrome } from "./chrome";

export const dynamic = "force-dynamic";

/** ?filled=1 dresses a few slots with the shipped example files, so the
 *  filled branch renders next to the empty one. Nothing here ships. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const { dict } = await getDictionary();
  const { dict: appDict } = await getScopedDictionary("app");
  const t = makeT(dict);
  const availability = allDefaults();
  const model = homeModel(availability, false);
  const slots: SlotMap = new Map();
  if (q.filled === "1") {
    const img = (key: string, src: string): ResolvedSlot => ({
      key, mediaType: "image", alt: "", fit: "cover", position: "center center",
      autoplay: false, muted: true, loop: true, controls: false, desktop: src,
    });
    const files = ["ecommerce-packshot", "tool-relight", "ecommerce-set", "moda-ghost", "tool-shadow", "grovshot-studio"];
    [1, 2, 3, 7, 8].forEach((n, i) => slots.set(HOME_SLOT.packshot(n), img(HOME_SLOT.packshot(n), "/showcase/" + files[i] + ".webp")));
    [1, 6].forEach((n, i) => slots.set(HOME_SLOT.ad(n), img(HOME_SLOT.ad(n), "/showcase/" + files[i + 3] + ".webp")));
    slots.set(HOME_SLOT.ugc(1), img(HOME_SLOT.ugc(1), "/showcase/moda-ghost.webp"));
    slots.set(toolSlotKey("ghost_mannequin"), img(toolSlotKey("ghost_mannequin"), "/showcase/moda-ghost.webp"));
  }
  const signed = q.signed === "1";
  return (
    <ProbeChrome dict={appDict} availability={availability} signed={signed}>
      <ProductHome signedIn={signed} model={model} slots={slots} t={t} />
    </ProbeChrome>
  );
}
`;

const CHROME_SRC = `"use client";
import { I18nScope } from "@/lib/i18n/provider";
import { DrawerProvider } from "@/components/layout/shell-context";
import { MegaTopbar } from "@/components/layout/mega-topbar";
import { CustomerBottomNav } from "@/components/layout/customer-bottom-nav";
import type { AvailabilityMap } from "@/lib/features";

/** ProductSurface's public chrome, or the (app) shell with a made-up account. */
export function ProbeChrome({ dict, availability, signed, children }: {
  dict: Parameters<typeof I18nScope>[0]["dict"]; availability: AvailabilityMap; signed: boolean; children: React.ReactNode;
}) {
  return (
    <I18nScope dict={dict}>
      <DrawerProvider>
        <div className="app-shell flex min-h-dvh w-full min-w-0 flex-col bg-bg">
          {signed
            ? <MegaTopbar name="Probe" email="probe@example.com" credits={175} plan="Pro" isAdmin={false} navAdmin={false} availability={availability} popularTools={[]} />
            : <MegaTopbar guest menu={false} brandHref="/" name="" credits={0} plan="Free" availability={availability} popularTools={[]} />}
          <main className={signed
            ? "mx-auto w-full min-w-0 max-w-[var(--content-max)] flex-1 px-[var(--page-x)] pt-4 pb-[var(--page-bottom)] sm:px-6 sm:pt-5 lg:px-8 lg:pb-14 lg:pt-6 xl:px-10"
            : "mx-auto w-full min-w-0 max-w-[var(--content-max)] flex-1 px-[var(--page-x)] pb-16 pt-4 sm:px-6 sm:pt-5 lg:px-8 lg:pt-6 xl:px-10"}>
            {children}
          </main>
          {signed && <CustomerBottomNav availability={availability} isAdmin={false} />}
        </div>
      </DrawerProvider>
    </I18nScope>
  );
}
`;

if (process.argv.includes("--harness")) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(`${DIR}/page.tsx`, PAGE_SRC);
  fs.writeFileSync(`${DIR}/chrome.tsx`, CHROME_SRC);
  console.log(`harness written to ${DIR}`);
  process.exit(0);
}
if (process.argv.includes("--clean")) {
  fs.rmSync(DIR, { recursive: true, force: true });
  if (fs.existsSync("app/probe-tmp") && fs.readdirSync("app/probe-tmp").length === 0) fs.rmSync("app/probe-tmp", { recursive: true });
  console.log("harness removed");
  process.exit(0);
}

const BASE = process.argv[2] ?? "http://127.0.0.1:3121";
const SHOTS = process.env.HOME_PROBE_SHOTS ?? null;
let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail !== undefined ? ` — ${detail}` : ""}`); }
};

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
});

/** A page on which /start is the public Home and /home the signed-in one. */
async function open(width, height, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: "dark", ...opts });
  await ctx.addCookies([{ name: "ecs_locale", value: "pl", url: BASE }]);
  const page = await ctx.newPage();
  await page.route((url) => url.pathname === "/start" || url.pathname === "/home", async (route) => {
    const url = new URL(route.request().url());
    const signed = url.pathname === "/home";
    url.pathname = "/probe-tmp/home";
    if (signed) url.searchParams.set("signed", "1");
    const response = await route.fetch({ url: url.toString() });
    await route.fulfill({ response });
  });
  // Every layout shift, from the first paint on.
  await page.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  return { ctx, page };
}

const PHONES = [320, 360, 375, 390, 414, 430].map((w) => ({ w, h: 820, kind: "phone" }));
const TABLETS = [[768, 1024], [810, 1080], [834, 1194], [1024, 1366]].flatMap(([a, b]) => [
  { w: a, h: b, kind: "tablet-portrait" }, { w: b, h: a, kind: "tablet-landscape" },
]);
const DESKTOPS = [[1280, 720], [1366, 768], [1440, 900], [1536, 864], [1920, 1080]].map(([w, h]) => ({ w, h, kind: "desktop" }));

/** Everything measured on one render, in one round trip. */
const measure = (page) => page.evaluate(() => {
  const doc = document.documentElement;
  const vw = doc.clientWidth;
  const inScroller = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.overflowX === "auto" || s.overflowX === "scroll" || s.overflowX === "hidden" || s.overflowX === "clip") return p;
    }
    return null;
  };
  const escapees = [];
  for (const el of document.querySelectorAll("main *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if ((r.right > vw + 0.5 || r.left < -0.5) && !inScroller(el)) {
      escapees.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} [${Math.round(r.left)},${Math.round(r.right)}]`);
    }
  }
  const box = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right, h: r.height, w: r.width }; };
  const sectionOrder = ["[aria-label] .rail-x-sm, section[aria-label]", "#home-start-title", "#home-effects", "#home-grovshot", "#home-packshots", "#home-ugc", "#home-ads", "#home-video"]
    .map((s) => box(s)?.top ?? null);
  const rail = document.querySelector("section[aria-label] > div");
  const railKids = rail ? [...rail.children].map((c) => c.getBoundingClientRect()) : [];
  const effects = document.querySelector("#home-effects")?.closest("section")?.querySelector(":scope > div:last-child");
  const effectKids = effects ? [...effects.children].map((c) => c.getBoundingClientRect()) : [];
  const chips = document.querySelector("#home-start-title")?.closest("section")?.querySelector(":scope > div.rail-x-sm");
  const packs = document.querySelector("#packshoty .grid");
  const packKids = packs ? [...packs.children].map((c) => c.getBoundingClientRect()) : [];
  const ads = document.querySelector("#home-ads")?.closest("section")?.querySelector(":scope > div.grid");
  // The VISIBLE art, not the grid cell: a cell is stretched to the row, so
  // measuring cells would call a row equal even when the art inside is not.
  const adKids = ads ? [...ads.children].map((c) => (c.firstElementChild ?? c).getBoundingClientRect()) : [];
  const imgs = [...document.querySelectorAll("main img")];
  const nav = document.querySelector("nav.fixed, [data-bottom-nav], nav[class*='bottom-0']");
  return {
    vw, sw: doc.scrollWidth, escapees: escapees.slice(0, 5), escapeCount: escapees.length,
    h1: document.querySelectorAll("h1").length,
    order: sectionOrder,
    rail: { n: railKids.length, scroll: rail ? getComputedStyle(rail).overflowX : null, tops: railKids.map((r) => Math.round(r.top)), rights: railKids.map((r) => Math.round(r.right)) },
    effects: { n: effectKids.length, tops: effectKids.map((r) => Math.round(r.top)), rights: effectKids.map((r) => Math.round(r.right)) },
    chips: chips ? {
      overflowX: getComputedStyle(chips).overflowX, scrollable: chips.scrollWidth > chips.clientWidth + 1,
      barH: chips.offsetHeight - chips.clientHeight, n: chips.children.length,
      tops: [...chips.children].map((c) => Math.round(c.getBoundingClientRect().top)),
      rights: [...chips.children].map((c) => Math.round(c.getBoundingClientRect().right)),
    } : null,
    packs: { n: packKids.length, tops: packKids.map((r) => Math.round(r.top)) },
    ads: { n: adKids.length, tops: adKids.map((r) => Math.round(r.top)), heights: adKids.map((r) => Math.round(r.height)),
      maxRight: adKids.length ? Math.round(Math.max(...adKids.map((r) => r.right))) : 0 },
    broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src).slice(0, 3),
    preloads: document.querySelectorAll('link[rel="preload"][as="image"]').length,
    eager: imgs.filter((i) => i.loading !== "lazy").length,
    gated: document.querySelectorAll("main [data-gated]").length,
    nav: nav ? { top: Math.round(nav.getBoundingClientRect().top), active: nav.querySelectorAll('[aria-current="page"]').length,
      starts: nav.querySelectorAll('a[href="/home"]').length,
      activeText: [...nav.querySelectorAll('[aria-current="page"]')].map((a) => a.textContent.trim()) } : null,
    mainBottomPad: parseFloat(getComputedStyle(document.querySelector("main")).paddingBottom),
    cls: window.__cls,
  };
});

async function scrollThrough(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += Math.round(innerHeight * 0.8)) {
      scrollTo(0, y); await new Promise((r) => setTimeout(r, 60));
    }
    scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 250));
  });
}

/* ── 1. EVERY WIDTH ────────────────────────────────────────────────────── */
console.log("\n1. EVERY WIDTH: NO SIDEWAYS SCROLL, THE RIGHT LAYOUT, NOTHING SHIFTS");
for (const vp of [...PHONES, ...TABLETS, ...DESKTOPS]) {
  for (const who of ["start", "home"]) {
    const { ctx, page } = await open(vp.w, vp.h);
    await page.goto(`${BASE}/${who}${who === "start" ? "?filled=1" : ""}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(250);
    await scrollThrough(page);
    const m = await measure(page);
    const tag = `${vp.w}×${vp.h} ${who}`;
    const phone = vp.w < 640;
    const desktopRow = vp.w >= 1024;

    check(`${tag}: no horizontal page overflow`, m.sw <= m.vw, `scrollWidth ${m.sw} > ${m.vw}`);
    check(`${tag}: nothing escapes the viewport outside a scroller`, m.escapeCount === 0, m.escapees.join(" | "));
    check(`${tag}: one <h1>`, m.h1 === 1, m.h1);
    check(`${tag}: sections in the reference order`,
      m.order.every((v) => v !== null) && m.order.every((v, i) => i === 0 || v > m.order[i - 1]), JSON.stringify(m.order));
    check(`${tag}: no broken images`, m.broken.length === 0, m.broken.join(", "));
    check(`${tag}: no layout shift (CLS < 0.02)`, m.cls < 0.02, m.cls.toFixed(4));
    check(`${tag}: at most two images preloaded`, m.preloads <= 2, m.preloads);

    if (phone) {
      check(`${tag}: the rail is a carousel`, m.rail.scroll === "auto" && Math.max(...m.rail.rights) > m.vw, JSON.stringify(m.rail));
      check(`${tag}: the chips scroll sideways with no visible scrollbar`,
        m.chips?.overflowX === "auto" && m.chips.scrollable && m.chips.barH === 0, JSON.stringify(m.chips));
    } else {
      check(`${tag}: the rail is a grid inside the page`, Math.max(...m.rail.rights) <= m.vw, JSON.stringify(m.rail.rights));
      // One line always: centred when it fits, a scroller when not — with its
      // scrollbar, above a phone, so a mouse can find what is off the edge.
      check(`${tag}: the chips are one line, inside the page`,
        m.chips && new Set(m.chips.tops).size === 1
        && (m.chips.scrollable ? m.chips.overflowX === "auto" : Math.max(...m.chips.rights) <= m.vw), JSON.stringify(m.chips));
    }
    if (desktopRow) {
      check(`${tag}: the six rail tiles are one row`, m.rail.n === 6 && new Set(m.rail.tops).size === 1, JSON.stringify(m.rail.tops));
      check(`${tag}: the eight effects are one row`, m.effects.n === 8 && new Set(m.effects.tops).size === 1, JSON.stringify(m.effects.tops));
      check(`${tag}: six packshots to a row`, m.packs.n === 6 && new Set(m.packs.tops).size === 1, JSON.stringify(m.packs.tops));
      check(`${tag}: the seven Reklamy tiles are one row of equal tiles`,
        m.ads.n === 7 && new Set(m.ads.tops).size === 1 && Math.max(...m.ads.heights) - Math.min(...m.ads.heights) <= 1, JSON.stringify(m.ads));
    } else {
      // Two to a row on a phone, four on a tablet; the seventh starts a row.
      const perRow = m.ads.tops.filter((t) => t === m.ads.tops[0]).length;
      check(`${tag}: Reklamy is ${phone ? "two" : "four"} equal tiles to a row, inside the page`,
        m.ads.n === 7 && perRow === (phone ? 2 : 4) && Math.max(...m.ads.heights) - Math.min(...m.ads.heights) <= 1
        && m.ads.maxRight <= m.vw, JSON.stringify(m.ads));
    }
    if (who === "home" && vp.w < 1024) {
      // The harness answers from /probe-tmp/home, which is the path the
      // router reports, so "Start is the lit tab ON /home" is proven by
      // dockSlotActive in scripts/home-tests.ts. What a browser can prove is
      // that the dock is there, has ONE Start, and never lights two tabs.
      check(`${tag}: the bottom navigation has one Start, to /home, and lights at most one tab`,
        m.nav && m.nav.starts === 1 && m.nav.active <= 1, JSON.stringify(m.nav));
      check(`${tag}: the page is padded clear of the bottom navigation`,
        m.nav && m.mainBottomPad >= vp.h - m.nav.top, `${m.mainBottomPad} vs ${m.nav ? vp.h - m.nav.top : "?"}`);
    }
    if (who === "start") check(`${tag}: a visitor's doors are gated`, m.gated > 10, m.gated);
    else check(`${tag}: a customer's doors are plain links`, m.gated === 0, m.gated);

    if (SHOTS && [320, 390, 768, 1024, 1440, 1920].includes(vp.w) && vp.kind !== "tablet-landscape") {
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `${SHOTS}/home-${who}-${vp.w}x${vp.h}.png`, fullPage: true });
    }
    await ctx.close();
  }
}

/* ── 2. A VISITOR IS ASKED, NOT BOUNCED ────────────────────────────────── */
console.log("\n2. A VISITOR'S PRESS OPENS THE EXISTING SIGN-IN DIALOG");
for (const width of [390, 1440]) {
  const { ctx, page } = await open(width, 900);
  await page.goto(`${BASE}/start`, { waitUntil: "networkidle" });

  // An open rail tile — the generator — asks to sign in and remembers where.
  await page.locator('section[aria-label] a[href="/prompts"]').first().click();
  await page.waitForTimeout(250);
  let u = new URL(page.url());
  check(`${width}px: a rail tile opens the login dialog in place, with the tool as next`,
    u.pathname === "/start" && u.searchParams.get("auth") === "login" && u.searchParams.get("next") === "/prompts", page.url());
  await page.goto(`${BASE}/start`, { waitUntil: "networkidle" });

  // "Wypróbuj za darmo" opens the SAME dialog on its registration side.
  await page.locator("#home-effects").locator("xpath=../..").locator("a[data-gated]").first().click();
  await page.waitForTimeout(250);
  u = new URL(page.url());
  check(`${width}px: "Wypróbuj za darmo" opens the dialog on registration`,
    u.searchParams.get("auth") === "register", page.url());
  await page.goto(`${BASE}/start`, { waitUntil: "networkidle" });

  // A press on the upload box (not on its button) is the same door.
  const boxRect = await page.locator("#home-start-title").boundingBox();
  await page.mouse.click(boxRect.x + 4, boxRect.y - 30);
  await page.waitForTimeout(250);
  u = new URL(page.url());
  check(`${width}px: a press on the upload box opens the dialog for the generator`,
    u.searchParams.get("auth") === "login" && u.searchParams.get("next") === "/prompts", page.url());
  await page.goto(`${BASE}/start`, { waitUntil: "networkidle" });

  // A file dropped on the box is caught: the browser does not open it in the
  // tab, and the drop opens the same door as the button.
  const dropped = await page.evaluate(() => {
    const box = document.querySelector("#home-start-title").closest("div").parentElement;
    const dt = new DataTransfer();
    dt.items.add(new File(["x"], "p.png", { type: "image/png" }));
    const over = new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true });
    box.dispatchEvent(over);
    const effect = dt.dropEffect;
    const drop = new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true });
    box.dispatchEvent(drop);
    return { overPrevented: over.defaultPrevented, effect, dropPrevented: drop.defaultPrevented };
  });
  await page.waitForTimeout(250);
  u = new URL(page.url());
  check(`${width}px: a dropped file never opens in the tab — it opens the sign-in dialog for the generator`,
    dropped.overPrevented && dropped.dropPrevented
    && u.pathname === "/start" && u.searchParams.get("auth") === "login" && u.searchParams.get("next") === "/prompts",
    JSON.stringify({ dropped, url: page.url() }));
  await page.goto(`${BASE}/start`, { waitUntil: "networkidle" });

  // The signed-out bar's mega-menu: a tool entry asks in place too (desktop,
  // where the menu exists), and the visitor stays on the Home.
  if (width >= 1024) {
    await page.locator("header button[aria-haspopup='menu']").first().click();
    await page.waitForTimeout(200);
    const entry = page.locator("[role='menu'] a[href^='/']").first();
    const target = await entry.getAttribute("href");
    await entry.click();
    await page.waitForTimeout(300);
    u = new URL(page.url());
    check(`${width}px: a visitor's mega-menu entry opens the dialog in place, with the tool as next`,
      u.pathname === "/start" && u.searchParams.get("auth") === "login" && u.searchParams.get("next") === target,
      `${target} → ${page.url()}`);
    await page.goto(`${BASE}/start`, { waitUntil: "networkidle" });
  }

  // An inert card is not a link at all.
  const inert = await page.evaluate(() => [...document.querySelectorAll("main [aria-disabled]")].every((el) => !el.closest("a")));
  check(`${width}px: every "Wkrótce" card is inert, never a link`, inert);

  // "Zobacz przykłady" exists only once Packshoty holds an example…
  check(`${width}px: no "Zobacz przykłady" while the gallery is empty`,
    (await page.locator('a[href="#packshoty"]').count()) === 0);
  // …and then lands on Packshoty, clear of the sticky bar, no sign-in.
  await page.goto(`${BASE}/start?filled=1`, { waitUntil: "networkidle" });
  await page.locator('a[href="#packshoty"]').click();
  await page.waitForTimeout(900);
  const land = await page.evaluate(() => {
    const h = document.querySelector("#home-packshots").getBoundingClientRect().top;
    const bar = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
    return { h: Math.round(h), bar: Math.round(bar), auth: new URL(location.href).searchParams.get("auth") };
  });
  check(`${width}px: "Zobacz przykłady" scrolls to Packshoty below the bar, no dialog`,
    land.h >= land.bar - 1 && land.h < 400 && land.auth === null, JSON.stringify(land));
  await ctx.close();
}

/* ── 3. THE LIGHT THEME ─────────────────────────────────────────────────── */
console.log("\n3. THE LIGHT THEME");
for (const width of [390, 1440]) {
  // next-themes defaults to dark (app/layout.tsx); light is what a person
  // picks, and the pick lives in localStorage.
  const { ctx, page } = await open(width, 900, { colorScheme: "light" });
  await page.addInitScript(() => localStorage.setItem("theme", "light"));
  await page.goto(`${BASE}/start`, { waitUntil: "networkidle" });
  check(`${width}px light: the light theme is what rendered`,
    await page.evaluate(() => !document.documentElement.classList.contains("dark")));
  const m = await measure(page);
  check(`${width}px light: no overflow`, m.sw <= m.vw && m.escapeCount === 0, m.escapees.join(" | "));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/home-light-${width}.png`, fullPage: true });
  await ctx.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL HOME CHECKS PASS" : `\n${failures} HOME CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
