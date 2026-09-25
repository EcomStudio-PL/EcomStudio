/**
 * ADMIN → NARZĘDZIA I SILNIKI, DRIVEN IN A REAL BROWSER AT EVERY WIDTH THE BRIEF NAMES.
 *
 * `npm run test:toolspanel` proves the lists, the groups, the readout and the
 * write paths. This proves what only a browser can: that no width scrolls
 * sideways (collapsed, with a tool's four sections open, and with the bulk bar
 * up), that the configuration is one column on a phone and two from `lg`, that
 * the admin dock never sits on the last setting or on the bulk bar, that the
 * quick filter and the search narrow the list, that a deep link opens its row,
 * and that the "where a customer sees it" readout follows a switch before
 * anything is saved.
 *
 * THE HARNESS. /admin/ai needs an admin session and Supabase, which this probe
 * runs without. So the harness mounts the REAL ToolRegistry inside the REAL
 * admin chrome (sidebar, mobile bar, dock, the admin <main> and its padding),
 * fed by the registries and production-like values (the ones read from PROD for
 * this change, plus one hidden tool and one disabled category so every state is
 * on screen), at /probe-tmp/tools-panel. Nothing here ships: --clean removes it.
 *
 *   node scripts/tools-panel-probe.mjs --harness
 *   npm run build && npx next start -p 3121 &
 *   node scripts/tools-panel-probe.mjs http://127.0.0.1:3121
 *   node scripts/tools-panel-probe.mjs --clean
 */
import fs from "node:fs";
import { chromium } from "playwright";

const DIR = "app/probe-tmp/tools-panel";

const PAGE_SRC = `import { getScopedDictionary } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { I18nScope } from "@/lib/i18n/provider";
import { AdminShell } from "@/components/layout/admin-mobile";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { PageHeader } from "@/components/ui/page-header";
import { ToolRegistry, type PanelEntry } from "@/components/admin/tool-registry";
import { ToolsViewTabs } from "@/components/admin/tools-layout";
import { DEFAULT_LAYOUT } from "@/lib/tool-layout";
import {
  FEATURE_REGISTRY, allDefaults, isFeatureKey, type FeatureKey, type FeatureStatus,
} from "@/lib/features";
import { isAiToolKey, type EngineMode, type ToolRow, type ToolCategory } from "@/lib/services/ai-tools";

export const dynamic = "force-dynamic";

/** What production stores today (read for this change), plus two states the
 *  panel must also draw: a hidden live tool and a disabled category. */
const STORED: Partial<Record<FeatureKey, { status?: FeatureStatus; hidden?: boolean }>> = {
  image_social: { status: "COMING_SOON" }, image_mailing: { status: "COMING_SOON" },
  image_inne: { status: "COMING_SOON" }, video: { status: "COMING_SOON" },
  tool_watermark: { hidden: true }, image_matching: { status: "DISABLED" },
};

const TOOLS: Record<string, [ToolCategory, EngineMode, string | null, number | null]> = {
  prompts: ["generation", "grovbase", "prompt_generation", 0],
  generator: ["generation", "hybrid", "image_generation", 4],
  retouch: ["editing", "grovbase", "image_edit", 3],
  editor: ["local", "off", "tool_editor", 0],
  resize: ["local", "off", "tool_format", 0],
  compress: ["local", "off", "tool_compress", 0],
  tool_upscale: ["editing", "off", "tool_upscale", 1],
  tool_expand: ["editing", "off", "tool_expand", 1],
  tool_watermark: ["local", "off", "tool_watermark", 0],
  video: ["video", "off", "video_generation", 75],
  fashion_ghost_mannequin: ["generation", "grovbase", "image_edit", 3],
  fashion_flat_lay: ["generation", "grovbase", "image_edit", 3],
  fashion_iron: ["generation", "grovbase", "image_edit", 3],
  fashion_change_person: ["generation", "grovbase", "image_edit", 3],
  fashion_change_face: ["generation", "grovbase", "image_edit", 3],
};

export default async function Probe({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const { dict, locale } = await getDictionary();
  const { dict: adminDict } = await getScopedDictionary("admin");
  const t = makeT(dict);

  const availability = allDefaults();
  for (const [k, v] of Object.entries(STORED) as [FeatureKey, { status?: FeatureStatus; hidden?: boolean }][]) {
    availability[k] = { ...availability[k], status: v.status ?? availability[k].status, hiddenFromMenu: Boolean(v.hidden) };
  }

  const entries: PanelEntry[] = FEATURE_REGISTRY.map((f) => {
    const s = availability[f.key];
    const admin = {
      key: f.key, nameKey: f.nameKey, path: f.path, group: f.group,
      status: s.status, hiddenFromMenu: s.hiddenFromMenu,
      startsAt: null, endsAt: null, autoReenable: true, customTitle: "", customMessage: "",
      updatedAt: STORED[f.key] ? "2026-09-20T10:00:00.000Z" : null,
    };
    if (!isAiToolKey(f.key)) return { admin, tool: null };
    const [category, engineMode, serviceSlug, credits] = TOOLS[f.key];
    const tool: ToolRow = {
      key: f.key, nameKey: f.nameKey, path: f.path, category, status: s.status, hiddenFromMenu: s.hiddenFromMenu,
      engineMode, promptVersion: engineMode === "grovbase" && f.key === "retouch" ? 3 : null,
      serviceSlug, credits, serviceEnabled: true, serviceMaintenance: false,
      models: f.key === "retouch"
        ? [{ id: "m1", name: "Nano Banana Pro", role: "primary", providerName: "Google", active: true }]
        : f.key === "generator"
          ? [{ id: "m1", name: "Nano Banana Pro", role: "primary", providerName: "Google", active: true },
             { id: "m2", name: "GPT Image 1", role: "fallback", providerName: "OpenAI", active: true }]
          : [],
      allowModelChoice: f.key === "generator", fallbackEnabled: f.key === "generator",
      timeoutMs: 120000, maxAttempts: 1, notes: null, knowledgeSets: 0,
      lastRunAt: f.key === "retouch" ? "2026-09-24T08:00:00.000Z" : null,
      runs30d: f.key === "retouch" ? 42 : 0, failures30d: f.key === "retouch" ? 2 : 0, unconfigured: false,
    };
    return { admin, tool };
  });

  const models = [
    { id: "m1", name: "Nano Banana Pro", providerName: "Google", active: true, credits: 3 },
    { id: "m2", name: "GPT Image 1", providerName: "OpenAI", active: true, credits: 4 },
  ];
  const services = [
    { slug: "image_edit", name: "Edycja obrazu", credits: 3 },
    { slug: "image_generation", name: "Generowanie obrazu", credits: 4 },
    { slug: "prompt_generation", name: "Generowanie promptów", credits: 0 },
    { slug: "tool_compress", name: "Kompresja", credits: 0 },
    { slug: "tool_upscale", name: "Upscale", credits: 1 },
    { slug: "video_generation", name: "Wideo", credits: 75 },
  ];
  const stats = { users: 12, usersToday: 1, revenueTodayCents: 0, revenue30dCents: 0 };
  const open = q.tool && isFeatureKey(q.tool) ? q.tool : null;

  return (
    <I18nScope dict={adminDict}>
      <div className="flex min-h-dvh w-full min-w-0">
        <AdminSidebar name="Probe Admin" email="probe@grovbase.test" role="admin" stats={stats} />
        <div className="flex min-w-0 flex-1 flex-col">
          <AdminShell name="Probe Admin" email="probe@grovbase.test" role="admin" stats={stats} />
          <main className="mx-auto w-full min-w-0 max-w-[var(--content-max)] flex-1 px-4 pb-[calc(var(--dock-h)+2rem+env(safe-area-inset-bottom))] pt-5 sm:px-5 lg:px-6 lg:pb-12 lg:pt-6 xl:px-7">
            <PageHeader overline={t("admin.navGroups.ai")} title={t("aicc.tools.title")} sub={t("aicc.tools.sub")} />
            <ToolsViewTabs />
            <ToolRegistry entries={entries} availability={availability} toolsLayout={DEFAULT_LAYOUT} models={models} services={services}
              previewing={false} locale={locale} openKey={open} />
          </main>
        </div>
      </div>
    </I18nScope>
  );
}
`;

/** "Układ dla klientów", in the same admin chrome, fed the shipped layout. */
const LAYOUT_SRC = `import { getScopedDictionary, getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { I18nScope } from "@/lib/i18n/provider";
import { AdminShell } from "@/components/layout/admin-mobile";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { PageHeader } from "@/components/ui/page-header";
import { ToolsLayoutEditor, ToolsViewTabs } from "@/components/admin/tools-layout";
import { allDefaults } from "@/lib/features";
import { DEFAULT_LAYOUT } from "@/lib/tool-layout";

export const dynamic = "force-dynamic";

export default async function Probe() {
  const { dict } = await getDictionary();
  const { dict: adminDict } = await getScopedDictionary("admin");
  const t = makeT(dict);
  const stats = { users: 12, usersToday: 1, revenueTodayCents: 0, revenue30dCents: 0 };
  return (
    <I18nScope dict={adminDict}>
      <div className="flex min-h-dvh w-full min-w-0">
        <AdminSidebar name="Probe Admin" email="probe@grovbase.test" role="admin" stats={stats} />
        <div className="flex min-w-0 flex-1 flex-col">
          <AdminShell name="Probe Admin" email="probe@grovbase.test" role="admin" stats={stats} />
          <main className="mx-auto w-full min-w-0 max-w-[var(--content-max)] flex-1 px-4 pb-[calc(var(--dock-h)+2rem+env(safe-area-inset-bottom))] pt-5 sm:px-5 lg:px-6 lg:pb-12 lg:pt-6 xl:px-7">
            <PageHeader overline={t("admin.navGroups.ai")} title={t("aicc.tools.title")} sub={t("aicc.layout.sub")} />
            <ToolsViewTabs />
            <h2 className="mb-3 text-[15px] font-semibold text-ink">{t("aicc.layout.title")}</h2>
            <ToolsLayoutEditor initial={DEFAULT_LAYOUT} updatedAt={null} availability={allDefaults()} />
          </main>
        </div>
      </div>
    </I18nScope>
  );
}
`;

if (process.argv.includes("--harness")) {
  fs.mkdirSync(`${DIR}/uklad`, { recursive: true });
  fs.writeFileSync(`${DIR}/page.tsx`, PAGE_SRC);
  fs.writeFileSync(`${DIR}/uklad/page.tsx`, LAYOUT_SRC);
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
const URL = `${BASE}/probe-tmp/tools-panel`;
const SHOTS = process.env.SHOTS ?? "";
const WIDTHS = [320, 360, 375, 390, 414, 430, 768, 810, 820, 834, 1024, 1280, 1440, 1920];
const LG = 1024;

let failed = 0;
let passed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
});

/** Anything inside <main> poking past the right edge, and the page's own width. */
const overflow = (page) => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const doc = document.documentElement.scrollWidth - vw;
  const bad = [];
  for (const el of document.querySelectorAll("main *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // Contents of a horizontally scrolling strip may run past the edge; the strip itself may not.
    let p = el.parentElement, inScroller = false;
    while (p && p.tagName !== "MAIN") {
      const cs = getComputedStyle(p);
      if (cs.overflowX === "auto" || cs.overflowX === "scroll" || cs.overflowX === "hidden") { inScroller = true; break; }
      p = p.parentElement;
    }
    if (!inScroller && r.right > vw + 0.5) bad.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} right=${Math.round(r.right)}`);
  }
  return { doc, bad: bad.slice(0, 4) };
});

const dockTop = (page) => page.evaluate(() => {
  const nav = [...document.querySelectorAll("nav")].find((n) => getComputedStyle(n).position === "fixed"
    && n.getBoundingClientRect().bottom >= window.innerHeight - 1 && n.offsetParent !== null);
  return nav ? nav.getBoundingClientRect().top : window.innerHeight;
});

const entryCount = (page) => page.locator("[data-entry]").count();

for (const width of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 768 ? 800 : 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { try { localStorage.setItem("theme", "dark"); } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(URL, { waitUntil: "networkidle" });
  const tag = `${width}px`;

  // Collapsed.
  check(`${tag}: all 28 entries listed`, (await entryCount(page)) === 28, String(await entryCount(page)));
  check(`${tag}: all 10 groups drawn`, (await page.locator("[data-group]").count()) === 10);
  let o = await overflow(page);
  check(`${tag}: no sideways scroll (collapsed)`, o.doc <= 0 && o.bad.length === 0, JSON.stringify(o));

  // A tool's four sections.
  await page.locator('[data-entry="prompts"] button[aria-expanded]').click();
  await page.locator("#cfg-prompts").waitFor();
  const sections = page.locator("#cfg-prompts section");
  check(`${tag}: a tool opens four sections`, (await sections.count()) === 4, String(await sections.count()));
  const [s1, s3] = [await sections.nth(0).boundingBox(), await sections.nth(2).boundingBox()];
  if (width >= LG) check(`${tag}: two columns from lg`, s3.x > s1.x + s1.width - 1, JSON.stringify({ s1, s3 }));
  else check(`${tag}: one column below lg`, Math.abs(s3.x - s1.x) < 1 && s3.y > s1.y, JSON.stringify({ s1, s3 }));
  o = await overflow(page);
  check(`${tag}: no sideways scroll (tool open)`, o.doc <= 0 && o.bad.length === 0, JSON.stringify(o));
  if (SHOTS && (width === 390 || width === 1440)) await page.screenshot({ path: `${SHOTS}/tools-${width}-open.png`, fullPage: false });

  // The readout follows the status before Save; the item's three switches sit under it.
  const toolsRow = page.locator('#cfg-prompts [data-surface="tools"]');
  check(`${tag}: active generator reads as visible on /tools`, (await toolsRow.getAttribute("data-state")) === "shown");
  const genFlags = page.locator('#cfg-prompts [data-placements] [data-item="generator"] [data-flag]');
  check(`${tag}: the generator's row carries its three switches, all on (Narzędzia · Menu · Start)`,
    (await genFlags.count()) === 3
    && (await genFlags.evaluateAll((els) => els.map((e) => e.getAttribute("data-flag") + e.getAttribute("data-on")).join())) === "tools1,menu1,start1");
  await page.locator('#cfg-prompts button[aria-pressed]', { hasText: /Wkrótce/ }).click();
  check(`${tag}: Wkrótce + visible reads as badged`, (await toolsRow.getAttribute("data-state")) === "badged");

  // A local tool without an engine, a Wkrótce tool, a hidden tool, categories.
  // Collapsing keeps the unsaved draft (the prompts row is now Wkrótce, unsaved).
  await page.locator('[data-entry="prompts"] button[aria-expanded]').click();
  check(`${tag}: a collapsed row hides its configuration`, await page.locator("#cfg-prompts").isHidden());
  await page.locator('[data-entry="prompts"] button[aria-expanded]').click();
  check(`${tag}: …and reopening it keeps the unsaved draft`,
    (await page.locator('#cfg-prompts button[aria-pressed="true"]', { hasText: /Wkrótce/ }).count()) === 1);
  check(`${tag}: a model-priced tool says its images follow the model's price list`,
    /cennik modelu/i.test(await page.locator("#cfg-prompts").innerText()));
  await page.locator('[data-entry="prompts"] button[aria-expanded]').click();
  await page.locator('[data-entry="compress"] button[aria-expanded]').click();
  const compressText = await page.locator("#cfg-compress").innerText();
  check(`${tag}: local tool says local processing, offers no model`, /Przetwarzanie lokalne/.test(compressText)
    && (await page.locator("#cfg-compress select").count()) === 1);
  check(`${tag}: local tool not on Start by default (its Start switch is off)`,
    (await page.locator('#cfg-compress [data-surface="home"]').getAttribute("data-state")) === "hidden"
    && (await page.locator('#cfg-compress [data-item="compress"] [data-flag="start"]').getAttribute("data-on")) === "0");
  const flagBoxes = await page.locator('#cfg-compress [data-item="compress"] [data-flag]').evaluateAll((els) =>
    els.map((e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width) }; }));
  check(`${tag}: the three switches never squeeze below a readable width`,
    flagBoxes.length === 3 && flagBoxes.every((b) => b.w >= 130), JSON.stringify(flagBoxes));

  await page.locator('[data-entry="fashion_ghost_mannequin"] button[aria-expanded]').click();
  check(`${tag}: Wkrótce tool listed with its badge`,
    (await page.locator('#cfg-fashion_ghost_mannequin [data-surface="tools"]').getAttribute("data-state")) === "badged");

  await page.locator('[data-entry="tool_watermark"] button[aria-expanded]').click();
  check(`${tag}: a tool hidden from navigation keeps its /tools card (its layout switch decides that)`,
    (await page.locator('#cfg-tool_watermark [data-surface="tools"]').getAttribute("data-state")) === "shown");
  check(`${tag}: its navigation switch is off`,
    (await page.locator('#cfg-tool_watermark [role="switch"]').first().getAttribute("aria-checked")) === "false");

  await page.locator('[data-entry="image_ecommerce"] button[aria-expanded]').click();
  check(`${tag}: a category opens status + visibility only`, (await page.locator("#cfg-image_ecommerce section").count()) === 2);
  check(`${tag}: active category visible on /tools`,
    (await page.locator('#cfg-image_ecommerce [data-surface="tools"]').getAttribute("data-state")) === "shown");
  check(`${tag}: its items are listed under it, each with its switches`,
    /Pozycje w katalogu \(\d+\)/i.test(await page.locator("#cfg-image_ecommerce").innerText())
    && (await page.locator('#cfg-image_ecommerce [data-placements] [data-item]').count()) >= 5);
  await page.locator('#cfg-image_ecommerce [role="switch"]').first().click();
  check(`${tag}: hiding the category from navigation (unsaved) takes it off the menu, not off /tools`,
    (await page.locator('#cfg-image_ecommerce [data-surface="menu"]').getAttribute("data-state")) === "hidden"
    && (await page.locator('#cfg-image_ecommerce [data-surface="tools"]').getAttribute("data-state")) === "shown");
  o = await overflow(page);
  check(`${tag}: no sideways scroll (category open)`, o.doc <= 0 && o.bad.length === 0, JSON.stringify(o));

  await page.locator('[data-entry="image_matching"] button[aria-expanded]').click();
  check(`${tag}: disabled category says it is gone`, /404/.test(await page.locator("#cfg-image_matching").innerText()));

  // The last setting on the page is never under the dock.
  await page.locator('[data-entry="support"] button[aria-expanded]').click();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(150);
  const save = await page.locator("#cfg-support button", { hasText: /Zapisz/ }).boundingBox();
  const dock = await dockTop(page);
  check(`${tag}: the last Save sits above the dock`, save && save.y + save.height <= dock + 0.5, JSON.stringify({ save, dock }));

  // Bulk bar above the dock, and no sideways scroll with it up.
  await page.locator('[data-entry="support"] input[type="checkbox"]').check();
  const bar = await page.locator(".overlay", { hasText: /Zaznaczono/ }).boundingBox();
  check(`${tag}: the bulk bar sits above the dock`, bar && bar.y + bar.height <= (await dockTop(page)) + 0.5, JSON.stringify({ bar }));
  o = await overflow(page);
  check(`${tag}: no sideways scroll (bulk bar up)`, o.doc <= 0 && o.bad.length === 0, JSON.stringify(o));
  if (SHOTS && (width === 390 || width === 1440)) await page.screenshot({ path: `${SHOTS}/tools-${width}-bottom.png` });
  await page.locator('[data-entry="support"] input[type="checkbox"]').uncheck();

  // Quick filter and search.
  await page.evaluate(() => window.scrollTo(0, 0));
  const quick = page.locator('[role="group"][aria-label="Szybki filtr"] button');
  await quick.filter({ hasText: /^Wkrótce/ }).click();
  const soon = await entryCount(page);
  // Five Moda tools, Social, Mailing, Inne, Wideo — Matching is disabled here.
  check(`${tag}: quick filter Wkrótce narrows to the Wkrótce entries`, soon === 9, String(soon));
  await quick.filter({ hasText: /^Ukryte/ }).click();
  const hiddenN = await entryCount(page);
  check(`${tag}: quick filter Ukryte = hidden + disabled`, hiddenN === 2, String(hiddenN));
  await quick.filter({ hasText: /^Wszystkie/ }).click();
  await page.locator("main input[placeholder]").first().fill("moda");
  const moda = await entryCount(page);
  check(`${tag}: search narrows`, moda >= 1 && moda < 28, String(moda));

  check(`${tag}: no runtime errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
  console.log(`  ${tag} done`);
}

// "Układ dla klientów".
const LAYOUT_URL = `${URL}/uklad`;
for (const width of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 768 ? 800 : 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(LAYOUT_URL, { waitUntil: "networkidle" });
  const tag = `${width}px układ`;
  const order = () => page.locator("[data-section]").evaluateAll((els) => els.map((e) => e.getAttribute("data-section")).join());
  check(`${tag}: eight sections in the brief's order`,
    (await order()) === "generate,ecommerce,moda,prepare,inne,social,mailing,video", await order());
  // (Which tab is current follows the real /admin/ai/uklad path, which the
  // harness does not live at; here the two doors themselves are checked.)
  check(`${tag}: the view tabs lead to Konfiguracja and Układ dla klientów`,
    (await page.locator('nav a[href="/admin/ai"]').filter({ hasText: /Konfiguracja/ }).count()) === 1
    && (await page.locator('nav a[href="/admin/ai/uklad"]').filter({ hasText: /Układ dla klientów/ }).count()) === 1);
  let o = await overflow(page);
  check(`${tag}: no sideways scroll (collapsed)`, o.doc <= 0 && o.bad.length === 0, JSON.stringify(o));

  await page.locator('[data-section="ecommerce"] button[aria-expanded]').click();
  const eco = page.locator('[data-section="ecommerce"] [data-item]');
  check(`${tag}: E-commerce holds its seven items`, (await eco.count()) === 7, String(await eco.count()));
  check(`${tag}: Matching says it is also in Moda`,
    /Także w: Moda/.test(await page.locator('[data-section="ecommerce"] [data-item="matching"]').innerText()));
  check(`${tag}: Matching carries its Wkrótce badge`,
    /Wkrótce/.test(await page.locator('[data-section="ecommerce"] [data-item="matching"]').innerText()));
  o = await overflow(page);
  check(`${tag}: no sideways scroll (section open)`, o.doc <= 0 && o.bad.length === 0, JSON.stringify(o));
  const boxes = await page.locator('[data-section="ecommerce"] [data-item="retouch"] [data-flag]').evaluateAll((els) =>
    els.map((e) => Math.round(e.getBoundingClientRect().width)));
  check(`${tag}: an item's three switches stay readable (never squeezed onto one cramped line)`,
    boxes.length === 3 && boxes.every((w) => w >= 130), JSON.stringify(boxes));

  // One switch moves only itself.
  const flag = (item, f) => page.locator(`[data-section="ecommerce"] [data-item="${item}"] [data-flag="${f}"]`);
  const before = await Promise.all(["tools", "menu", "start"].map((f) => flag("retouch", f).getAttribute("data-on")));
  await flag("retouch", "start").locator('[role="switch"]').click();
  const after = await Promise.all(["tools", "menu", "start"].map((f) => flag("retouch", f).getAttribute("data-on")));
  check(`${tag}: flipping „Start” changes Start only`,
    before[0] === after[0] && before[1] === after[1] && before[2] !== after[2], JSON.stringify({ before, after }));
  const bar = page.locator("[data-savebar]");
  check(`${tag}: an unsaved change raises the save bar`, (await bar.count()) === 1);
  const barBox = await bar.boundingBox();
  check(`${tag}: …above the admin dock`, barBox && barBox.y + barBox.height <= (await dockTop(page)) + 0.5, JSON.stringify(barBox));

  // Reorder a section, hide one, then discard.
  await page.locator('[data-section="moda"] button[aria-label^="Przesuń wyżej"]').click();
  check(`${tag}: „Przesuń wyżej” moves Moda above E-commerce`, (await order()).startsWith("generate,moda,ecommerce"), await order());
  await page.locator('[data-section="social"] [role="switch"]').first().click();
  check(`${tag}: hiding a section keeps it (and its items) in the editor`,
    (await page.locator('[data-section="social"]').getAttribute("data-visible")) === "0"
    && /Pozycje: 4/.test(await page.locator('[data-section="social"]').innerText()));
  o = await overflow(page);
  check(`${tag}: no sideways scroll (save bar up)`, o.doc <= 0 && o.bad.length === 0, JSON.stringify(o));
  await bar.getByRole("button", { name: /Odrzuć/ }).click();
  check(`${tag}: „Odrzuć zmiany” restores the stored layout`,
    (await order()) === "generate,ecommerce,moda,prepare,inne,social,mailing,video" && (await bar.count()) === 0);

  check(`${tag}: the items kept aside are listed, so none is lost`,
    /Poza układem \(18\)/.test(await page.locator("[data-unplaced]").innerText()));
  if (SHOTS && (width === 390 || width === 1440)) await page.screenshot({ path: `${SHOTS}/uklad-${width}.png`, fullPage: false });
  check(`${tag}: no runtime errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// Deep link.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${URL}?tool=retouch`, { waitUntil: "networkidle" });
  check("deep link ?tool=retouch opens that row", (await page.locator("#cfg-retouch").count()) === 1);
  const box = await page.locator('[data-entry="retouch"]').boundingBox();
  check("…scrolled into view", box && box.y < 800 && box.y > -5, JSON.stringify(box));
  check("…with its model and provider shown", /Nano Banana Pro/.test(await page.locator("#cfg-retouch").innerText())
    && /Google/.test(await page.locator("#cfg-retouch").innerText()));
  await ctx.close();
}

// Light theme renders too.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("theme", "light"); } catch {} });
  const page = await ctx.newPage();
  await page.goto(`${URL}?tool=generator`, { waitUntil: "networkidle" });
  check("light theme: html has no .dark", !(await page.evaluate(() => document.documentElement.classList.contains("dark"))));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tools-1440-light.png` });
  await ctx.close();
}

await browser.close();
console.log(failed ? `\n${failed} of ${passed + failed} probe checks failed.` : `\nAll ${passed} probe checks passed.`);
process.exit(failed ? 1 : 0);
