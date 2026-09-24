/**
 * /tools AND ITS CATEGORY DEEP LINK, DRIVEN IN A REAL BROWSER.
 *
 * `npm run test:toolshub` proves the registry, the gates and the source. This
 * proves the parts only a browser can: that `?category=` really scrolls the
 * section into view on a fresh load and on a refresh, that Back/Forward really
 * moves the view, that the mobile drawer really closes, navigates and lands on
 * the section, that the desktop panel closes behind its own click, that a
 * click on the section you are already on brings it back, and that no width
 * overflows.
 *
 * THE HARNESS. /tools sits behind sign-in, and this probe runs against a local
 * production build with no account. So the harness mounts the REAL pieces —
 * MegaTopbar, CustomerDrawer, CustomerBottomNav, ToolsCatalogue, ToolsDeepLink,
 * fed by `hubSectionsFor` and the real dictionary — at /probe-tmp/tools, in the
 * same <main> the app layout uses. The browser is then told that /tools IS
 * that page (a Playwright route that fetches /probe-tmp/tools for any request
 * to /tools, document and RSC alike), so every link the menus render —
 * `/tools?category=moda` — is followed exactly as in production, through the
 * Next router, and the address bar says /tools.
 *
 *   node scripts/tools-hub-probe.mjs --harness
 *   npm run build && npx next start -p 3121 &
 *   node scripts/tools-hub-probe.mjs http://127.0.0.1:3121
 *   node scripts/tools-hub-probe.mjs --clean
 */
import fs from "node:fs";
import { chromium } from "playwright";

const DIR = "app/probe-tmp/tools";

const PAGE_SRC = `import { Suspense } from "react";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { allDefaults } from "@/lib/features";
import { CATEGORY_PARAM } from "@/lib/categories";
import { hubSectionsFor, type HubCardDef } from "@/lib/tool-cards";
import { toolSlotKey, workflowSlotKey } from "@/lib/media-slots";
import { ToolsCatalogue } from "@/components/tools/tools-catalogue";
import { ToolsDeepLink } from "@/components/tools/tools-deep-link";
import { ProbeShell } from "./shell";

export const dynamic = "force-dynamic";

/** What app/(app)/tools/page.tsx renders, minus the account: the registry
 *  defaults stand in for the switchboard (Social/Mailing/Inne/Matching and the
 *  Moda tools are "Wkrótce" there, exactly as they ship). */
export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = await searchParams;
  const wanted = typeof q[CATEGORY_PARAM] === "string" ? q[CATEGORY_PARAM] : null;
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const avail = allDefaults();
  const visible = hubSectionsFor(avail, false);
  const slotKeyOf = (c: HubCardDef) =>
    c.workflow ? workflowSlotKey(c.workflow.category, c.workflow.key) : toolSlotKey(c.key);
  return (
    <ProbeShell dict={dict} avail={avail}>
      <ToolsCatalogue t={t} avail={avail} isAdmin={false} slots={new Map()}
        sections={visible.map((s) => ({
          key: s.key, icon: s.icon, title: t(s.titleKey), seeAll: s.seeAll,
          active: s.key === wanted,
          cards: s.cards.map((c) => ({
            key: c.key, href: c.href, icon: c.icon, motif: c.motif,
            title: t(c.titleKey), body: t(c.bodyKey), soon: c.soon,
            slotKey: slotKeyOf(c), gates: c.gates, state: null,
          })),
        }))} />
      <Suspense fallback={null}>
        <ToolsDeepLink sections={visible.map((s) => s.key)} />
      </Suspense>
    </ProbeShell>
  );
}
`;

const SHELL_SRC = `"use client";
import { I18nScope } from "@/lib/i18n/provider";
import { DrawerProvider } from "@/components/layout/shell-context";
import { MegaTopbar } from "@/components/layout/mega-topbar";
import { CustomerDrawer } from "@/components/layout/customer-drawer";
import { CustomerBottomNav } from "@/components/layout/customer-bottom-nav";
import type { AvailabilityMap } from "@/lib/features";

/** The (app) layout's shell, with a made-up account. */
export function ProbeShell({ dict, avail, children }: {
  dict: Parameters<typeof I18nScope>[0]["dict"]; avail: AvailabilityMap; children: React.ReactNode;
}) {
  return (
    <I18nScope dict={dict}>
      <DrawerProvider>
        <div className="app-shell flex min-h-dvh w-full min-w-0 flex-col">
          <MegaTopbar name="Probe" email="probe@example.com" credits={120} plan="Pro"
            isAdmin={false} navAdmin={false} availability={avail} popularTools={[]} />
          <main className="mx-auto w-full min-w-0 max-w-[var(--content-max)] flex-1 px-[var(--page-x)] pt-4 pb-[var(--page-bottom)] sm:px-6 sm:pt-5 lg:px-8 lg:pb-14 lg:pt-6 xl:px-10">
            {children}
          </main>
          <CustomerBottomNav availability={avail} isAdmin={false} />
          <CustomerDrawer name="Probe" email="probe@example.com" credits={120} creditsTotal={500}
            plan="Pro" isAdmin={false} navAdmin={false} availability={avail} />
        </div>
      </DrawerProvider>
    </I18nScope>
  );
}
`;

if (process.argv.includes("--harness")) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(`${DIR}/page.tsx`, PAGE_SRC);
  fs.writeFileSync(`${DIR}/shell.tsx`, SHELL_SRC);
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
let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail !== undefined ? ` — ${detail}` : ""}`); }
};

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
});

/** A page on which /tools is the harness. */
async function open(width, height = 900, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, ...opts });
  await ctx.addCookies([{ name: "ecs_locale", value: "pl", url: BASE }]);
  const page = await ctx.newPage();
  await page.route((url) => url.pathname === "/tools", async (route) => {
    const url = new URL(route.request().url());
    url.pathname = "/probe-tmp/tools";
    const response = await route.fetch({ url: url.toString() });
    await route.fulfill({ response });
  });
  return { ctx, page };
}

/** Where a section's heading sits relative to the bottom of the sticky bar,
 *  and whether it is the active one. */
const where = (page, key) => page.evaluate((k) => {
  const s = document.getElementById(k);
  const bar = document.querySelector("header");
  if (!s) return null;
  const top = s.getBoundingClientRect().top;
  const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
  return {
    top: Math.round(top), barBottom: Math.round(barBottom),
    inView: top >= barBottom - 2 && top < window.innerHeight * 0.5,
    active: s.getAttribute("data-active") === "true",
    current: s.querySelector("h2")?.getAttribute("aria-current") === "true",
    activeCount: document.querySelectorAll('[data-tools-section][data-active="true"]').length,
    path: location.pathname + location.search,
    scrollY: Math.round(window.scrollY),
  };
}, key);

/** Wait until the view settles. A smooth scroll starts a few frames AFTER the
 *  click that asked for it, so "two equal readings" can be taken before it
 *  has begun; this waits until the position has been still for 300 ms (and
 *  gives up after 5 s). */
async function settle(page) {
  let last = -1, still = 0;
  for (let i = 0; i < 100 && still < 6; i++) {
    const y = await page.evaluate(() => window.scrollY);
    still = y === last ? still + 1 : 0;
    last = y;
    await page.waitForTimeout(50);
  }
}

/* ── 7. A PASTED / REFRESHED LINK OPENS THE SECTION ─────────────────────── */
console.log("\n7. DEEP LINK: FRESH LOAD AND REFRESH");
for (const width of [390, 1440]) {
  const { ctx, page } = await open(width);
  for (const key of ["moda", "ecommerce", "social", "prepare"]) {
    await page.goto(`${BASE}/tools?category=${key}`, { waitUntil: "networkidle" });
    await settle(page);
    let w = await where(page, key);
    check(`${width}px: /tools?category=${key} lands on its section, active`,
      w?.inView && w.active && w.current && w.activeCount === 1, JSON.stringify(w));
    await page.reload({ waitUntil: "networkidle" });
    await settle(page);
    w = await where(page, key);
    check(`${width}px: …and still does after a refresh`, w?.inView && w.active, JSON.stringify(w));
  }
  await page.goto(`${BASE}/tools?category=nope`, { waitUntil: "networkidle" });
  const top = await page.evaluate(() => ({ y: window.scrollY, active: document.querySelectorAll('[data-active="true"]').length }));
  check(`${width}px: an unknown ?category= opens nothing and stays at the top`, top.y === 0 && top.active === 0, JSON.stringify(top));
  await ctx.close();
}

/* ── 4–6 + 9. THE MOBILE DRAWER ─────────────────────────────────────────── */
console.log("\n4–6, 9. MOBILE DRAWER → SECTION");
for (const width of [320, 390, 768]) {
  const { ctx, page } = await open(width, 800);
  await page.goto(`${BASE}/tools`, { waitUntil: "networkidle" });
  for (const [key, label] of [["moda", "Moda"], ["ecommerce", "E-commerce"], ["social", "Social Media"]]) {
    await page.getByRole("button", { name: "Menu" }).first().click();
    const drawer = page.locator('[role="dialog"]');
    await drawer.getByRole("button", { name: /OBRAZY|Obraz/i }).click();
    const tile = drawer.getByRole("link", { name: new RegExp(`^${label}`) });
    const href = await tile.getAttribute("href");
    await tile.click();
    await page.waitForURL((u) => u.search === `?category=${key}`);
    await settle(page);
    const open = await page.locator('[role="dialog"]').count();
    const w = await where(page, key);
    check(`${width}px: drawer „${label}” → ${href}, drawer closed, section in view and active`,
      href === `/tools?category=${key}` && open === 0 && w?.inView && w.active && w.path === `/tools?category=${key}`,
      JSON.stringify({ href, open, ...w }));
  }
  await ctx.close();
}

/* ── 8. BACK / FORWARD ──────────────────────────────────────────────────── */
console.log("\n8. BACK / FORWARD");
{
  const { ctx, page } = await open(390, 800);
  await page.goto(`${BASE}/tools?category=moda`, { waitUntil: "networkidle" });
  await settle(page);
  for (const [key, label] of [["ecommerce", "E-commerce"], ["social", "Social Media"]]) {
    await page.getByRole("button", { name: "Menu" }).first().click();
    const drawer = page.locator('[role="dialog"]');
    await drawer.getByRole("button", { name: /OBRAZY|Obraz/i }).click();
    await drawer.getByRole("link", { name: new RegExp(`^${label}`) }).click();
    await page.waitForURL((u) => u.search === `?category=${key}`);
    await settle(page);
  }
  await page.goBack(); await page.waitForURL((u) => u.search === "?category=ecommerce"); await settle(page);
  let w = await where(page, "ecommerce");
  check("Back → ?category=ecommerce, its section in view", w?.inView && w.active, JSON.stringify(w));
  await page.goBack(); await page.waitForURL((u) => u.search === "?category=moda"); await settle(page);
  w = await where(page, "moda");
  check("Back again → ?category=moda, its section in view", w?.inView && w.active, JSON.stringify(w));
  await page.goForward(); await page.waitForURL((u) => u.search === "?category=ecommerce"); await settle(page);
  w = await where(page, "ecommerce");
  check("Forward → ?category=ecommerce again", w?.inView && w.active, JSON.stringify(w));
  await ctx.close();
}

/* ── ALREADY ON THE SECTION: THE SAME LINK BRINGS IT BACK ───────────────── */
console.log("\nSAME SECTION, CLICKED AGAIN");
{
  const { ctx, page } = await open(390, 800);
  await page.goto(`${BASE}/tools?category=moda`, { waitUntil: "networkidle" });
  await settle(page);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await settle(page);
  await page.getByRole("button", { name: "Menu" }).first().click();
  const drawer = page.locator('[role="dialog"]');
  await drawer.getByRole("button", { name: /OBRAZY|Obraz/i }).click();
  await drawer.getByRole("link", { name: /^Moda/ }).click();
  await settle(page);
  const w = await where(page, "moda");
  check("on /tools?category=moda, scrolled away, „Moda” brings the section back", w?.inView && w.active, JSON.stringify(w));
  await ctx.close();
}

/* ── 4–6. THE DESKTOP MEGA MENU ─────────────────────────────────────────── */
console.log("\n4–6. DESKTOP MENU → SECTION");
{
  const { ctx, page } = await open(1440, 900);
  await page.goto(`${BASE}/tools`, { waitUntil: "networkidle" });
  for (const [key, label] of [["moda", "Moda"], ["ecommerce", "E-commerce"], ["social", "Social Media"]]) {
    await page.locator("header").getByRole("button", { name: /Obraz/i }).first().hover();
    const item = page.locator('[role="menu"]').getByRole("menuitem", { name: new RegExp(`^${label}`) });
    const href = await item.getAttribute("href").catch(() => null);
    if (href) await item.click();
    else await page.locator('[role="menu"]').getByText(label, { exact: true }).first().click();
    await page.waitForURL((u) => u.search === `?category=${key}`);
    await settle(page);
    const menuOpen = await page.locator('[role="menu"]').count();
    const w = await where(page, key);
    check(`desktop „${label}” → /tools?category=${key}, panel closed, section in view and active`,
      menuOpen === 0 && w?.inView && w.active, JSON.stringify({ href, menuOpen, ...w }));
  }
  await ctx.close();
}

/* ── 10. „WKRÓTCE” ON THE CARDS ─────────────────────────────────────────── */
console.log("\n10. BADGES AND INERT CARDS");
{
  const { ctx, page } = await open(1440, 900);
  await page.goto(`${BASE}/tools?category=social`, { waitUntil: "networkidle" });
  const r = await page.evaluate(() => {
    const s = document.getElementById("social");
    const cards = [...s.querySelectorAll("[data-tool-card]")];
    return {
      cards: cards.length,
      blocked: cards.filter((c) => c.getAttribute("data-blocked") === "true").length,
      links: cards.filter((c) => c.tagName === "A").length,
      badged: cards.filter((c) => /Wkrótce/i.test(c.textContent ?? "")).length,
      ecomLinks: [...document.getElementById("ecommerce").querySelectorAll("a[data-tool-card]")].map((a) => a.getAttribute("href")),
    };
  });
  check("Social (Wkrótce by default): every card badged and inert, none a link",
    r.cards === 5 && r.blocked === 5 && r.links === 0 && r.badged === 5, JSON.stringify(r));
  check("E-commerce (live): every card opens its own workflow screen",
    r.ecomLinks.length === 5 && r.ecomLinks.every((h) => /^\/k\/ecommerce\/[a-zA-Z]+$/.test(h)), JSON.stringify(r.ecomLinks));
  await ctx.close();
}

/* ── 18. RESPONSIVE: NO HORIZONTAL OVERFLOW ─────────────────────────────── */
console.log("\nRESPONSIVE — ZERO HORIZONTAL OVERFLOW");
const WIDTHS = [320, 360, 375, 390, 414, 430, 768, 810, 834, 1024, 1280, 1366, 1440, 1536, 1920];
for (const width of WIDTHS) {
  const { ctx, page } = await open(width, 900);
  await page.goto(`${BASE}/tools?category=moda`, { waitUntil: "networkidle" });
  await settle(page);
  const r = await page.evaluate(() => {
    const cw = document.documentElement.clientWidth;
    const over = [...document.querySelectorAll("main *")].filter((el) => {
      const b = el.getBoundingClientRect();
      return b.width > 0 && (b.right > cw + 1 || b.left < -1);
    }).slice(0, 3).map((el) => `${el.tagName}.${String(el.className).slice(0, 50)}`);
    const sections = [...document.querySelectorAll("[data-tools-section]")];
    const grid = sections[0]?.querySelector(".grid");
    const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0;
    return {
      scrollW: document.documentElement.scrollWidth, cw, over, sections: sections.length,
      cards: document.querySelectorAll("[data-tool-card]").length, cols,
    };
  });
  const w = await where(page, "moda");
  check(`${width}px: no horizontal overflow, ${r.sections} sections / ${r.cards} cards, ${r.cols} columns, Moda in view`,
    r.scrollW <= r.cw + 1 && r.over.length === 0 && w?.inView,
    JSON.stringify({ ...r, w }));
  await ctx.close();
}

await browser.close();
console.log(failures === 0 ? "\nAll tools-hub probes passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
