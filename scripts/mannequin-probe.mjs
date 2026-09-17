/**
 * NIEWIDZIALNY MANEKIN PROBE — measures the Moda tool workspace against the
 * reference layout (the /retusz panel in the brief's screenshot).
 *
 * Run against a PRODUCTION build (`next start`), never `next dev`: the app's
 * CSP forbids `unsafe-eval`, which dev mode needs, so nothing hydrates there.
 *
 *   node scripts/mannequin-probe.mjs --harness
 *   npm run build && npx next start -p 3100 &
 *   node scripts/mannequin-probe.mjs http://127.0.0.1:3100
 *   node scripts/mannequin-probe.mjs --clean
 *
 * The harness mounts the REAL FashionToolWorkspace with the REAL ghostMannequin
 * config, so what is measured is the shipping component and its own styles.
 */
import fs from "node:fs";
import { chromium } from "playwright";

const DIR = "app/probe-tmp/manekin";
const PAGE_SRC = `import { I18nProvider } from "@/lib/i18n/provider";
import pl from "@/lib/i18n/dictionaries/pl.json";
import { ManekinProbe } from "@/app/probe-tmp/manekin/client";

export const dynamic = "force-static";

export default function Page() {
  return (
    <I18nProvider locale="pl" dict={pl as Record<string, unknown>}>
      <div className="workspace workspace-page gen-shell">
        <ManekinProbe />
      </div>
    </I18nProvider>
  );
}
`;

const CLIENT_SRC = `"use client";
import { FashionToolWorkspace } from "@/components/fashion/tool-workspace";
import { FASHION_TOOL_BY_KEY } from "@/lib/fashion-tools";

const CONFIG = FASHION_TOOL_BY_KEY.get("ghostMannequin")!;

export function ManekinProbe() {
  return (
    <div data-probe="manekin-root">
      <FashionToolWorkspace
        config={CONFIG}
        workspaceId="00000000-0000-4000-8000-000000000000"
        credits={124}
        available
        resolutions={["1K", "2K", "4K"]}
        ratios={["auto", "1:1", "4:5", "16:9"]}
        pricing={{ "1K": 5, "2K": 7, "4K": 12 }}
        initialItems={[]}
        initialCursor={null}
      />
    </div>
  );
}
`;

if (process.argv.includes("--clean")) {
  fs.rmSync("app/probe-tmp", { recursive: true, force: true });
  console.log("removed app/probe-tmp");
  process.exit(0);
}
if (process.argv.includes("--harness")) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(`${DIR}/page.tsx`, PAGE_SRC);
  fs.writeFileSync(`${DIR}/client.tsx`, CLIENT_SRC);
  console.log(`wrote ${DIR}/{page,client}.tsx — build, start, then probe`);
  process.exit(0);
}

const BASE = process.argv[2] ?? "http://127.0.0.1:3100";
const URL_ = `${BASE}/probe-tmp/manekin`;

const DESKTOP = [1280, 1366, 1440, 1536, 1600, 1920, 2560];
const TABLET = [768, 820, 1024, 1180];
const PHONE = [360, 390, 430];

let pass = 0, fail = 0;
const failures = [];
const ok = (c, label) => { if (c) pass++; else { fail++; failures.push(label); } };

async function measure(page, width, height, band) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(170);
  const tag = `${band} ${width}×${height}`;

  const doc = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
  }));
  ok(doc.sw <= doc.cw + 1, `${tag}: horizontal overflow (${doc.sw} > ${doc.cw})`);

  const m = await page.evaluate(() => {
    const root = document.querySelector("[data-probe='manekin-root']");
    const body = root?.querySelector(".gen-shell-body");
    if (!body) return null;
    const cs = getComputedStyle(body);
    const cols = cs.gridTemplateColumns.split(" ").filter(Boolean).map(parseFloat);
    const left = body.children[1] ?? body.children[0];
    const cost = root.querySelector("[data-cost-island]");
    const cta = root.querySelector("[data-fashion-cta]");
    const bar = root.querySelector("[data-gallery-toolbar]");
    const empty = root.querySelector("[data-gallery-empty]");
    const gal = root.querySelector("[data-gallery-panel]");
    // The column the gallery lives in — what the empty state should fill.
    const galCol = body.children[body.children.length - 1];
    const r = (el) => (el ? el.getBoundingClientRect() : null);
    const br = r(bar), er = r(empty), gr = r(gal);
    return {
      bodyW: body.getBoundingClientRect().width,
      cols,
      leftW: left ? left.getBoundingClientRect().width : 0,
      gap: parseFloat(cs.columnGap) || 0,
      costW: r(cost)?.width ?? 0,
      ctaW: r(cta)?.width ?? 0,
      // One compact line: the toolbar's height should be a single control row.
      barH: br?.height ?? 0,
      barRows: (() => {
        if (!bar) return 0;
        const boxes = [...bar.children].map((c) => c.getBoundingClientRect()).filter((b) => b.width > 0)
          .sort((a, b) => a.top - b.top);
        let rows = 0, bottom = -Infinity;
        for (const b of boxes) {
          if (b.top >= bottom - 1) { rows++; bottom = b.bottom; } else bottom = Math.max(bottom, b.bottom);
        }
        return rows;
      })(),
      // Empty state centred inside the gallery panel, not hugging its top.
      emptyH: er?.height ?? 0,
      galColH: galCol ? galCol.getBoundingClientRect().height : 0,
      // Is the text block centred inside the empty box?
      emptySkew: (() => {
        if (!empty || !er) return null;
        const kids = [...empty.children].map((c) => c.getBoundingClientRect()).filter((b) => b.height > 0);
        if (kids.length === 0) return null;
        const top = Math.min(...kids.map((b) => b.top)) - er.top;
        const bottom = er.bottom - Math.max(...kids.map((b) => b.bottom));
        return Math.abs(top - bottom);
      })(),
      galH: gr?.height ?? 0,
    };
  });
  ok(m !== null, `${tag}: workspace not found`);
  if (!m) return null;

  if (width >= 1200) {
    ok(m.cols.length === 2, `${tag}: ${m.cols.length} column(s), expected 2`);
    if (m.cols.length === 2) {
      // The brief's number: a settings column of 300–330, not a share of width.
      ok(m.cols[0] >= 296 && m.cols[0] <= 334,
        `${tag}: left column ${m.cols[0].toFixed(0)}px outside 300–330`);
      ok(m.cols[1] > m.cols[0] * 2, `${tag}: gallery ${m.cols[1].toFixed(0)}px too narrow`);
      // A wider monitor must grow the GALLERY, not the settings column.
      ok(m.gap >= 16 && m.gap <= 28, `${tag}: column gap ${m.gap.toFixed(0)}px`);
    }
    // The content really uses the monitor.
    ok(m.bodyW > width * 0.86, `${tag}: body ${m.bodyW.toFixed(0)}px of ${width} — too much dead margin`);
  } else if (width >= 1024) {
    // Tablet landscape: the brief allows either, as long as two columns are
    // not a squeeze. If it stays split, the settings column keeps its width
    // and the gallery must still be the larger half.
    if (m.cols.length === 2) {
      ok(m.cols[0] >= 296 && m.cols[0] <= 334, `${tag}: left column ${m.cols[0].toFixed(0)}px outside 300–330`);
      ok(m.cols[1] >= 360, `${tag}: gallery squeezed to ${m.cols[1].toFixed(0)}px`);
    }
    ok(m.cols.length <= 2, `${tag}: ${m.cols.length} columns`);
  } else {
    ok(m.cols.length === 1, `${tag}: ${m.cols.length} columns on a phone/portrait tablet, expected a stack`);
  }

  // The cost island and its CTA span the settings column.
  if (width >= 1200 && m.costW) {
    ok(Math.abs(m.costW - m.cols[0]) <= 2, `${tag}: cost box ${m.costW.toFixed(0)} vs column ${m.cols[0].toFixed(0)}`);
    ok(m.ctaW > m.costW * 0.8, `${tag}: CTA ${m.ctaW.toFixed(0)}px not full width`);
  }

  // Toolbar: one compact line.
  ok(m.barRows === 1, `${tag}: gallery toolbar wrapped into ${m.barRows} rows`);
  ok(m.barH > 0 && m.barH <= 56, `${tag}: toolbar ${m.barH.toFixed(0)}px tall — not compact`);

  // EMPTY STATE. On desktop it fills the column it is in rather than hugging
  // the toolbar, and its text sits in the middle of that box.
  if (width >= 1024 && m.galColH > 200) {
    ok(m.emptyH > m.galColH * 0.6,
      `${tag}: empty box ${m.emptyH.toFixed(0)}px in a ${m.galColH.toFixed(0)}px column — hugging the top`);
  }
  if (m.emptySkew !== null) {
    ok(m.emptySkew <= 4, `${tag}: empty text off-centre inside its box by ${m.emptySkew.toFixed(0)}px`);
  }
  return m;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  });
  const page = await browser.newPage();
  const res = await page.goto(URL_, { waitUntil: "networkidle" });
  if (!res || !res.ok()) { console.error(`probe route unreachable: ${res?.status()}`); process.exit(2); }
  await page.waitForTimeout(400);

  const rows = [];
  for (const w of DESKTOP) rows.push([`desktop ${w}`, await measure(page, w, w >= 1920 ? 1080 : 800, "DESKTOP")]);
  for (const w of TABLET) rows.push([`tablet ${w}`, await measure(page, w, 1024, "TABLET")]);
  for (const w of PHONE) rows.push([`phone ${w}`, await measure(page, w, 844, "PHONE")]);

  await browser.close();

  console.log("\nLAYOUT");
  for (const [label, m] of rows) {
    if (m) {
      const c = m.cols.length === 2
        ? `${m.cols[0].toFixed(0)} + ${m.cols[1].toFixed(0)}`
        : `${m.cols[0]?.toFixed(0) ?? "?"} (stack)`;
      console.log(`  ${label.padEnd(14)} body ${m.bodyW.toFixed(0).padStart(4)}  cols ${c.padEnd(14)}  bar ${m.barH.toFixed(0)}px/${m.barRows}row`);
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log("\nFAILURES");
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
})();
