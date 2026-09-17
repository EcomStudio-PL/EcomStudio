/**
 * PAGE BUILDER PROBE — does the rebuilt builder actually fit on a phone?
 *
 * Run against a PRODUCTION build (`next start`), never `next dev`: the app's
 * CSP forbids `unsafe-eval`, which dev mode needs, so nothing hydrates there.
 *
 *   node scripts/builder-probe.mjs --harness
 *   npm run build && npx next start -p 3100 &
 *   node scripts/builder-probe.mjs http://127.0.0.1:3100
 *   node scripts/builder-probe.mjs --clean
 *
 * The harness mounts the REAL Builder with a landing-page's worth of sections,
 * because the claims worth checking are all about a builder with something in
 * it: an empty editor fits anywhere.
 *
 * WHAT IT MEASURES, and why each one is a fact rather than an opinion:
 *
 *   NO SIDEWAYS SCROLL, at eleven widths from 360 to 1920. A builder that
 *   scrolls horizontally on a phone is one where half the controls are past
 *   the edge of the screen.
 *
 *   ONE PANE AT A TIME below the three-column breakpoint, three above it —
 *   and the pane switch has to be on screen when it is the only way to reach
 *   the other two.
 *
 *   NOTHING COVERS THE BUTTONS. Every control the builder offers is compared
 *   against every FIXED-position element on the page: if a sticky bar sits on
 *   top of "Publikuj", the button is unclickable no matter how good it looks
 *   in a screenshot. This is the specific failure the brief names.
 *
 *   TAP TARGETS on a phone, measured, not assumed.
 *
 *   THE PICKER OPENS AND FITS at 360px, including its search and its
 *   category rail — it is the one screen in the builder that is a grid.
 */
import fs from "node:fs";
import { chromium } from "playwright";

const DIR = "app/probe-tmp/builder";

const PAGE_SRC = `import { I18nProvider } from "@/lib/i18n/provider";
import pl from "@/lib/i18n/dictionaries/pl.json";
import { BuilderProbe } from "@/app/probe-tmp/builder/client";

export const dynamic = "force-static";

export default function Page() {
  return (
    <I18nProvider locale="pl" dict={pl as Record<string, unknown>}>
      <BuilderProbe />
    </I18nProvider>
  );
}
`;

const CLIENT_SRC = `"use client";
import { Builder } from "@/components/admin/cms/builder";
import type { BlockRow, PageRow } from "@/lib/services/cms";

/** A campaign landing as it looks mid-build: eight sections, a couple of them
 *  hidden, one with an anchor, and content in Polish only. */
const TYPES = [
  "promo_bar", "hero", "offer", "countdown", "benefits",
  "testimonials", "faq", "urgency_cta",
];

const BLOCKS: BlockRow[] = TYPES.map((type, i) => ({
  id: \`b\${i}\`,
  type,
  sort_order: i,
  visible: type !== "testimonials",
  content: {
    title: { pl: \`Sekcja \${i + 1}\` },
    description: { pl: "Opis, który w liście sekcji skraca się do jednej linii." },
    ctaLabel: { pl: "Kup teraz" },
    ctaUrl: "#oferta",
  },
  style: {},
  code: {},
  analytics_id: null,
  anchor: type === "offer" ? "oferta" : null,
  show_from: null,
  show_until: null,
  audience: "everyone",
}));

const PAGE: PageRow = {
  id: "p1",
  slug: "2x-kredyty-test",
  title: "2× kredyty — test",
  status: "draft",
  kind: "standard",
  sortOrder: 100,
  navGroup: null,
  navOrder: 100,
  seo: {},
  publishedAt: null,
  updatedAt: "2026-09-17T09:00:00.000Z",
  updatedBy: null,
  scheduledAt: null,
  headerMode: "minimal",
  footerMode: "minimal",
  promo: {},
  template: "promo",
};

const PAGES = [
  { slug: "home", title: "Start", status: "published", kind: "standard" },
  { slug: "cennik", title: "Cennik", status: "published", kind: "standard" },
];

export function BuilderProbe() {
  return (
    <div data-probe="builder-root" className="p-3">
      {/* The preview iframe points at a page that needs no session: the probe
          measures the builder's chrome, not what the draft renders. */}
      <Builder page={PAGE} blocks={BLOCKS} pages={PAGES} previewPath="/probe-tmp/builder/frame" />
    </div>
  );
}
`;

const FRAME_SRC = `export const dynamic = "force-static";

export default function Frame() {
  return <div style={{ height: 2000 }}>podgląd</div>;
}
`;

if (process.argv.includes("--clean")) {
  fs.rmSync("app/probe-tmp", { recursive: true, force: true });
  console.log("removed app/probe-tmp");
  process.exit(0);
}
if (process.argv.includes("--harness")) {
  fs.mkdirSync(`${DIR}/frame`, { recursive: true });
  fs.writeFileSync(`${DIR}/page.tsx`, PAGE_SRC);
  fs.writeFileSync(`${DIR}/client.tsx`, CLIENT_SRC);
  fs.writeFileSync(`${DIR}/frame/page.tsx`, FRAME_SRC);
  console.log(`wrote ${DIR} — build, start, then probe`);
  process.exit(0);
}

const BASE = process.argv[2] ?? "http://127.0.0.1:3100";
const URL_ = `${BASE}/probe-tmp/builder`;

/** The widths the brief names, plus the two the layout actually switches at. */
const PHONE = [360, 390, 414, 430];
const TABLET = [768, 820, 834, 1024];
const DESKTOP = [1280, 1440, 1920];

/** Tailwind's `xl`: below it the builder is one pane at a time. */
const THREE_COLUMN = 1280;

let pass = 0, fail = 0;
const failures = [];
const ok = (c, label) => { if (c) pass++; else { fail++; failures.push(label); } };

/**
 * Every FIXED element that covers a given control. This is the honest version
 * of "the bottom nav does not cover anything": not "is there a bottom bar",
 * but "is any pinned element painted over this particular button".
 */
async function coveredBy(page, selector) {
  return page.evaluate((sel) => {
    const target = document.querySelector(sel);
    if (!target) return null;
    const r = target.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return [];
    const hits = [];
    for (const el of document.querySelectorAll("body *")) {
      const style = getComputedStyle(el);
      if (style.position !== "fixed" && style.position !== "sticky") continue;
      if (style.visibility === "hidden" || style.display === "none") continue;
      if (style.pointerEvents === "none") continue;
      if (el.contains(target) || target.contains(el)) continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      const overlap = Math.max(0, Math.min(r.right, b.right) - Math.max(r.left, b.left))
        * Math.max(0, Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top));
      // A fixed element BEHIND the control is fine; only one painted on top
      // of it takes the click. Compare stacking the way the browser does.
      if (overlap > r.width * r.height * 0.2 && Number(style.zIndex || 0) >= 0) {
        const mid = document.elementFromPoint(
          Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
        if (mid && !target.contains(mid) && mid !== target) {
          hits.push(el.getAttribute("data-cms-nav") !== null ? "cms-nav"
            : el.className?.toString?.().slice(0, 40) || el.tagName);
        }
      }
    }
    return hits;
  }, selector);
}

async function atWidth(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(180);
  const tag = `${width}px`;

  const doc = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  ok(doc.sw <= doc.cw + 1, `${tag}: horizontal overflow (${doc.sw} > ${doc.cw})`);

  // ── PANES ────────────────────────────────────────────────────────────
  const switchVisible = await page.locator("[data-pane-switch]").isVisible();
  if (width >= THREE_COLUMN) {
    ok(!switchVisible, `${tag}: the pane switch is still shown at three columns`);
  } else {
    ok(switchVisible, `${tag}: no pane switch, and no room for three columns`);
    const buttons = await page.locator("[data-pane-switch] button").count();
    ok(buttons === 3, `${tag}: pane switch has ${buttons} buttons, expected 3`);
  }

  // ── NOTHING COVERS THE CONTROLS ──────────────────────────────────────
  for (const sel of ["[data-page-publish]", "[data-page-settings]", "[data-page-preview]"]) {
    const hits = await coveredBy(page, sel);
    ok(hits !== null, `${tag}: ${sel} is not on the page at all`);
    if (hits) ok(hits.length === 0, `${tag}: ${sel} is covered by ${hits.join(", ")}`);
  }

  // ── TAP TARGETS ──────────────────────────────────────────────────────
  if (width <= 430) {
    const small = await page.evaluate(() => {
      const out = [];
      const bar = document.querySelector("[data-builder-toolbar]");
      for (const el of bar?.querySelectorAll("button, a") ?? []) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.height < 34) out.push(`${el.textContent?.trim().slice(0, 14) || el.tagName}:${Math.round(r.height)}`);
      }
      return out;
    });
    ok(small.length === 0, `${tag}: toolbar targets under 34px — ${small.join(", ")}`);
  }
}

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => { fail++; failures.push(`page error: ${e.message}`); });

await page.goto(URL_, { waitUntil: "networkidle" });
ok(await page.locator("[data-cms-builder]").count() === 1, "the builder rendered at all");

for (const width of [...PHONE, ...TABLET, ...DESKTOP]) await atWidth(page, width);

/* ── THE PICKER, ON THE SMALLEST PHONE ───────────────────────────────── */
await page.setViewportSize({ width: 360, height: 780 });
await page.waitForTimeout(150);
// The section list lives in the "tree" pane; it is the default one.
const addBtn = page.locator("[data-add-section]").first();
if (await addBtn.count() === 0) {
  fail++; failures.push("360px: no [data-add-section] button to open the picker");
} else {
  await addBtn.click();
  await page.waitForTimeout(250);
  const picker = page.locator("[data-section-picker]");
  ok(await picker.count() === 1, "360px: the picker did not open");
  const doc = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  ok(doc.sw <= doc.cw + 1, `360px picker: horizontal overflow (${doc.sw} > ${doc.cw})`);
  const spill = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("[data-section-picker] button")) {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 1 || r.left < -1) {
        out.push(`${el.textContent?.trim().slice(0, 16)}@${Math.round(r.left)}..${Math.round(r.right)}`);
      }
    }
    return out;
  });
  ok(spill.length === 0, `360px picker: options off screen — ${spill.join(", ")}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
}

/* ── QUICK EDIT ──────────────────────────────────────────────────────── */
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(200);
ok(await page.locator("[data-more-settings]").count() === 1,
  "the advanced fields are folded behind one toggle");
const quickBefore = await page.locator("[data-quick-fields] > *").count();
if (await page.locator("[data-more-settings]").count() === 1) {
  await page.locator("[data-more-settings]").click();
  await page.waitForTimeout(150);
  const after = await page.locator("[data-advanced-fields] > *").count();
  ok(after > 0, "opening «Więcej ustawień» reveals the rest of the fields");
}
ok(quickBefore > 0, "a section offers something to edit immediately");

/* ── LINK TARGETS ────────────────────────────────────────────────────── */
const options = await page.evaluate(() =>
  [...document.querySelectorAll("[data-link-targets] option")].map((o) => o.value));
ok(options.includes("/cennik"), `the CTA picker offers other pages — ${options.join(" ")}`);
ok(options.includes("#oferta"), `the CTA picker offers this page's anchors — ${options.join(" ")}`);

await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
for (const f of failures) console.log(`  ✗ ${f}`);
process.exit(fail === 0 ? 0 : 1);
