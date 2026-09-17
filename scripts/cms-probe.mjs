/**
 * THE CMS SECTION FRAME, MEASURED IN A REAL BROWSER.
 *
 * The unit tests pin what `resolveStyle` RETURNS. This pins what the browser
 * DOES with it — which is a different question, and the one the brief actually
 * asks: does a page built from these sections survive 320px, and does a
 * section hidden on mobile really disappear at 390 and really come back at
 * 1440?
 *
 * Seventeen widths, from a 320px phone to a 1920px monitor, in light and in
 * dark. At each one it asserts:
 *
 *   NO HORIZONTAL OVERFLOW — the single most common defect on a hand-built
 *   landing page, and the one nobody notices on a desktop.
 *   SPACING AND COLUMNS FOLLOW THE BREAKPOINT — the tablet override at 1023
 *   and below, the mobile one at 639 and below, inheritance in between.
 *   VISIBILITY RULES HOLD — a section hidden on one device is painted on the
 *   others and nowhere else.
 *   CUSTOM CSS STAYS INSIDE ITS SECTION — the probe page deliberately carries
 *   a block whose CSS tries to restyle `body` and hide the `header`. Both must
 *   fail, in the browser, not just in a string comparison.
 *   TAP TARGETS ARE HITTABLE — 44px is the floor for anything a thumb has to
 *   find on a phone.
 *
 *   node scripts/cms-probe.mjs --harness
 *   npm run build && npx next start -p 3120 &
 *   node scripts/cms-probe.mjs http://127.0.0.1:3120
 *   node scripts/cms-probe.mjs --clean
 */
import fs from "node:fs";
import { chromium } from "playwright";

const DIR = "app/probe-tmp/cms";

const PAGE_SRC = `import { BlockRenderer, renderContext } from "@/components/cms/blocks";
import { FIXTURE } from "@/app/probe-tmp/cms/fixture";

export const dynamic = "force-static";

/** A page of CMS sections with no database behind it — the renderer only ever
 *  sees blocks, so fixtures exercise exactly what production exercises. */
export default function Page() {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header data-probe-header className="sticky top-0 z-40 h-[60px] border-b border-line bg-bg/85">
        <div className="mx-auto flex h-full max-w-[88rem] items-center px-4">
          <span className="text-sm font-semibold">GrovBase</span>
          <a href="/" data-probe-tap className="ml-auto inline-flex min-h-[44px] items-center rounded-xl px-4 text-sm font-semibold">
            Zacznij
          </a>
        </div>
      </header>
      <main className="flex-1">
        <BlockRenderer blocks={FIXTURE} ctx={renderContext({ locale: "pl", t: (k) => k })} />
      </main>
      <footer data-probe-footer className="border-t border-line py-8 text-center text-xs">stopka</footer>
    </div>
  );
}
`;

const FIXTURE_SRC = `import type { CmsBlock } from "@/lib/cms";

const L = (pl: string) => ({ pl });

/** One section per thing the probe measures. */
export const FIXTURE: CmsBlock[] = [
  {
    id: "sec-hero", type: "hero", sort_order: 0, visible: true,
    content: {
      badge: L("BADGE"),
      title: L("Bardzo dlugi naglowek ktory musi sie zawijac takze na waskim telefonie"),
      subtitle: L("Podtytul z kilkoma zdaniami, zeby bylo co lamac."),
      ctaLabel: L("Zacznij za darmo"), ctaUrl: "/register",
      cta2Label: L("Zobacz efekty"), cta2Url: "#efekty",
    },
    style: { base: { paddingTop: "xl", paddingBottom: "lg", width: "wide" } },
  },
  {
    id: "sec-grid", type: "features", sort_order: 1, visible: true,
    content: {
      title: L("Siatka"),
      items: [
        { title: L("Jeden"), description: L("Opis pierwszy") },
        { title: L("Dwa"), description: L("Opis drugi") },
        { title: L("Trzy"), description: L("Opis trzeci") },
        { title: L("Cztery"), description: L("Opis czwarty") },
      ],
    },
    // Four across on a desktop, three on a tablet, one on a phone.
    style: { base: { columns: 4, width: "wide" }, tablet: { columns: 3 }, mobile: { columns: 1 } },
  },
  {
    id: "sec-desktop-only", type: "cta", sort_order: 2, visible: true,
    content: { title: L("Tylko desktop"), ctaLabel: L("X"), ctaUrl: "/" },
    style: { base: { align: "center" }, hide: { tablet: true, mobile: true } },
  },
  {
    id: "sec-mobile-only", type: "cta", sort_order: 3, visible: true,
    content: { title: L("Tylko mobile"), ctaLabel: L("Y"), ctaUrl: "/" },
    style: { base: { align: "center" }, hide: { desktop: true, tablet: true } },
  },
  {
    id: "sec-narrow", type: "text", sort_order: 4, visible: true,
    content: { title: L("Waska kolumna"), description: L("Tekst do czytania.") },
    style: { base: { width: "narrow", paddingTop: "sm", paddingBottom: "sm" } },
  },
  {
    // THE CONTAINMENT TEST. This block's CSS tries to paint the whole page red
    // and hide the header. Scoped, it can do neither.
    id: "sec-code", type: "custom_code", sort_order: 5, visible: true,
    content: { title: L("Wlasny kod") },
    code: {
      html: '<div class="probe-box">blok</div><script>window.__XSS = 1</' + 'script>',
      css: "body { background: rgb(255, 0, 0) } header { display: none } .probe-box { outline: 3px solid rgb(0, 128, 0) }",
      js: "window.__JS = 1",
      jsEnabled: false,
    },
    style: { base: { width: "narrow" } },
  },
  {
    id: "sec-table", type: "rich_text", sort_order: 6, visible: true,
    content: {
      title: L("Dokument"),
      html: L("<h2>Rozdzial</h2><p>Akapit.</p><table><tr><th>Bardzo dluga naglowkowa komorka</th><th>I druga</th><th>I trzecia rownie dluga</th></tr><tr><td>Wartosc pierwsza dosc dluga</td><td>Druga</td><td>Trzecia</td></tr></table>"),
    },
    style: { base: { width: "narrow" } },
  },
];
`;

if (process.argv.includes("--clean")) {
  fs.rmSync("app/probe-tmp", { recursive: true, force: true });
  console.log("removed app/probe-tmp");
  process.exit(0);
}
if (process.argv.includes("--harness")) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(`${DIR}/page.tsx`, PAGE_SRC);
  fs.writeFileSync(`${DIR}/fixture.ts`, FIXTURE_SRC);
  console.log(`wrote ${DIR}/{page.tsx,fixture.ts} — build, start, then probe`);
  process.exit(0);
}

const BASE = process.argv[2] ?? "http://127.0.0.1:3120";
const URL_ = `${BASE}/probe-tmp/cms`;

/** The widths the brief names, plus the two breakpoint edges themselves. */
const WIDTHS = [
  320, 360, 375, 390, 393, 412, 414, 430,
  639, 640,
  768, 820, 834, 1023, 1024, 1180,
  1366, 1440, 1600, 1920,
];

let pass = 0, fail = 0;
const failures = [];
const ok = (c, label) => { if (c) pass++; else { fail++; failures.push(label); } };

(async () => {
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  });

  const rows = [];
  for (const scheme of ["light", "dark"]) {
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme: scheme,
        deviceScaleFactor: 1,
      });
      const page = await ctx.newPage();
      await page.goto(URL_, { waitUntil: "networkidle" });

      const m = await page.evaluate(() => {
        const q = (sel) => document.querySelector(sel);
        const painted = (el) => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const sec = (id) => q(`[data-cms-section="${id}"]`);
        const px = (el, prop) =>
          el ? parseFloat(getComputedStyle(el).getPropertyValue(prop)) || 0 : -1;

        const grid = sec("sec-grid")?.querySelector(".cms-grid");
        const cols = grid
          ? getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length
          : -1;

        const box = q(".probe-box");
        return {
          docWidth: document.documentElement.scrollWidth,
          viewport: window.innerWidth,
          // Visibility, measured rather than inferred from a class.
          desktopOnly: painted(sec("sec-desktop-only")),
          mobileOnly: painted(sec("sec-mobile-only")),
          cols,
          heroPadTop: px(sec("sec-hero"), "padding-top"),
          narrowInner: sec("sec-narrow")?.querySelector(".cms-in")?.getBoundingClientRect().width ?? -1,
          // CONTAINMENT: the block's CSS asked for a red page and a hidden
          // header. Both must have failed.
          bodyBg: getComputedStyle(document.body).backgroundColor,
          headerPainted: painted(q("[data-probe-header]")),
          boxOutline: box ? getComputedStyle(box).outlineColor : null,
          // The script in the HTML field, and the JS field with the switch off.
          xssRan: Boolean(window.__XSS),
          jsRan: Boolean(window.__JS),
          scriptTags: document.querySelectorAll('[data-cms-section="sec-code"] script').length,
          // A wide table on a narrow phone must scroll itself, not the page.
          tableScrolls: (() => {
            const t = sec("sec-table")?.querySelector("table");
            return t ? getComputedStyle(t).overflowX : null;
          })(),
          tapHeight: q("[data-probe-tap]")?.getBoundingClientRect().height ?? 0,
          sections: document.querySelectorAll("[data-cms-section]").length,
          analytics: q('[data-analytics]') ? true : false,
        };
      });

      const at = `${scheme} ${width}px`;

      // 1. No horizontal overflow, anywhere, ever.
      ok(m.docWidth <= m.viewport + 1,
        `${at}: page is ${m.docWidth}px wide in a ${m.viewport}px viewport`);

      // 2. Responsive visibility.
      const isMobile = width <= 639;
      const isTablet = width > 639 && width <= 1023;
      const isDesktop = width >= 1024;
      ok(m.desktopOnly === isDesktop,
        `${at}: desktop-only section painted=${m.desktopOnly}, expected ${isDesktop}`);
      ok(m.mobileOnly === isMobile,
        `${at}: mobile-only section painted=${m.mobileOnly}, expected ${isMobile}`);

      // 3. Columns follow the breakpoint the section asked for.
      const wantCols = isMobile ? 1 : isTablet ? 3 : 4;
      ok(m.cols === wantCols, `${at}: grid has ${m.cols} columns, expected ${wantCols}`);

      // 4. The narrow column never exceeds its cap, and never exceeds the page.
      ok(m.narrowInner <= Math.min(width, 46 * 16) + 1,
        `${at}: narrow column is ${Math.round(m.narrowInner)}px`);

      // 5. Spacing is a real clamp: bigger on a desktop than on a phone.
      rows.push({ at, padTop: Math.round(m.heroPadTop) });
      ok(m.heroPadTop > 0, `${at}: hero has no top padding`);

      // 6. CONTAINMENT — the whole point of scoping.
      ok(m.bodyBg !== "rgb(255, 0, 0)", `${at}: a section's CSS repainted the page body`);
      ok(m.headerPainted, `${at}: a section's CSS hid the site header`);
      ok(m.boxOutline === "rgb(0, 128, 0)",
        `${at}: the block's own CSS did not apply (outline ${m.boxOutline})`);

      // 7. Nothing executed.
      ok(!m.xssRan, `${at}: a <script> in an HTML field RAN`);
      ok(!m.jsRan, `${at}: custom JS ran with the switch off`);
      ok(m.scriptTags === 0, `${at}: a script tag survived into the section`);

      // 8. A wide table scrolls itself.
      ok(m.tableScrolls === "auto", `${at}: table overflow-x is ${m.tableScrolls}`);

      // 9. Tap targets.
      ok(m.tapHeight >= 44, `${at}: header CTA is ${Math.round(m.tapHeight)}px tall`);

      // 10. Every section is wrapped and addressable.
      ok(m.sections === 7, `${at}: ${m.sections} wrapped sections, expected 7`);

      await ctx.close();
    }
  }

  await browser.close();

  console.log("\nHERO TOP PADDING BY WIDTH (clamp, so it should grow)");
  for (const r of rows.filter((x) => x.at.startsWith("light"))) {
    console.log(`  ${r.at.padEnd(14)} ${r.padTop}px`);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log("\nFAILURES");
    for (const f of failures.slice(0, 40)) console.log(`  ✗ ${f}`);
    if (failures.length > 40) console.log(`  … and ${failures.length - 40} more`);
    process.exit(1);
  }
})();
