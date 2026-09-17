/**
 * REGENERATE-MODAL PROBE — measures the rebuilt "Regeneruj obraz" window.
 *
 * Run against a PRODUCTION build (`next start`), never `next dev`: the app's
 * CSP forbids `unsafe-eval`, which dev mode needs, so nothing hydrates there.
 *
 *   node scripts/regen-probe.mjs --harness
 *   npm run build && npx next start -p 3100 &
 *   node scripts/regen-probe.mjs http://127.0.0.1:3100
 *   node scripts/regen-probe.mjs --clean
 *
 * The harness mounts the REAL RegenerateModal with two synthetic engines —
 * one standing in for the model that made the image, one badged
 * `recommended` — because that pairing is the whole point of the redesign.
 */
import fs from "node:fs";
import { chromium } from "playwright";

const DIR = "app/probe-tmp/regen";
const PAGE_SRC = `import { I18nProvider } from "@/lib/i18n/provider";
import pl from "@/lib/i18n/dictionaries/pl.json";
import { RegenProbe } from "@/app/probe-tmp/regen/client";

export const dynamic = "force-static";

export default function Page() {
  return (
    <I18nProvider locale="pl" dict={pl as Record<string, unknown>}>
      <RegenProbe />
    </I18nProvider>
  );
}
`;

const CLIENT_SRC = `"use client";
import { RegenerateModal } from "@/components/genv3/regenerate";
import type { GalleryItem, GenModel } from "@/components/genv3/types";

const PHOTO = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1000">'
  + '<rect width="1500" height="1000" fill="#8a7f9c"/></svg>',
);

function model(id: string, name: string, badge: string | null): GenModel {
  return {
    id, name, badge, badgeTone: null, description: null,
    pricing: { "1K": 48 }, resolutions: ["1K"], ratios: ["1:1", "3:2"], exactRatios: ["1:1"],
    maxOutputs: 4, supportsRefs: true, surcharge: 5, qualities: ["medium", "high"],
    qualityPricing: { high: { "1K": 53 } },
  };
}

const MODELS: GenModel[] = [
  model("m-origin", "GPT Image 2", "Zalecany"),
  model("m-reco", "Nano Banana Pro", "recommended"),
  model("m-other", "Nano Banana 2", null),
];

const ITEM: GalleryItem = {
  generationId: "11111111-1111-1111-1111-111111111111",
  assetId: "22222222-2222-2222-2222-222222222222",
  path: "ws/gen/0.png", url: PHOTO, thumbUrl: PHOTO,
  width: 1500, height: 1000, ratio: "3:2", resolution: "1K", quality: "high",
  quantity: 2, credits: 4, latencyMs: 12400, referenceCount: 3, inspirationCount: 1,
  operation: null, model: "GPT Image 2", modelId: "m-origin", product: "Sofa",
  sessionType: "advertising", origin: "custom", prompt: null,
  favorite: false, note: null, createdAt: "2026-08-17T21:05:00.000Z",
};

export function RegenProbe() {
  return (
    <div data-probe="regen-root">
      <RegenerateModal
        item={ITEM}
        models={MODELS}
        balance={5000}
        onClose={() => undefined}
        onDone={() => undefined}
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
const URL_ = `${BASE}/probe-tmp/regen`;

const LAPTOP = [1280, 1366, 1440, 1600];
const DESKTOP = [1920, 2560];
const TABLET_P = [768, 820, 834];
const TABLET_L = [1024, 1112, 1180, 1194];

let pass = 0, fail = 0;
const failures = [];
const ok = (c, label) => { if (c) pass++; else { fail++; failures.push(label); } };

async function layout(page, width, height, band) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(160);
  const tag = `${band} ${width}×${height}`;

  const doc = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
  }));
  ok(doc.sw <= doc.cw + 1, `${tag}: horizontal overflow (${doc.sw} > ${doc.cw})`);

  const m = await page.evaluate(() => {
    const modal = document.querySelector("[data-regen-modal]");
    if (!modal) return null;
    const r = modal.getBoundingClientRect();
    const cols = getComputedStyle(modal).gridTemplateColumns.split(" ").filter(Boolean);
    const img = modal.querySelector("[data-regen-image]");
    const ir = img?.getBoundingClientRect();
    const q = (s) => modal.querySelector(s);
    const panel = q("[data-regen-tools]")?.parentElement;
    const order = [];
    for (const [name, sel] of [
      ["instruction", "[data-regen-instruction]"], ["undo", "[data-regen-undo]"],
      ["tools", "[data-regen-tools]"], ["size", "input[type='range']"],
      ["models", "[data-regen-models]"], ["run", "[data-regen-run]"],
      ["cancel", "[data-regen-cancel]"],
    ]) {
      const el = q(sel);
      if (el) order.push([name, el.getBoundingClientRect().top]);
    }
    const run = q("[data-regen-run]")?.getBoundingClientRect();
    const cancel = q("[data-regen-cancel]")?.getBoundingClientRect();
    return {
      w: r.width, cols: cols.length,
      colWidths: cols.map((c) => parseFloat(c)),
      panelW: panel?.getBoundingClientRect().width ?? 0,
      imgW: ir?.width ?? 0, imgH: ir?.height ?? 0,
      imgNatW: img?.naturalWidth ?? 0, imgNatH: img?.naturalHeight ?? 0,
      toolCount: modal.querySelectorAll("[data-regen-tool]").length,
      toolCols: getComputedStyle(q("[data-regen-tools]")).gridTemplateColumns.split(" ").filter(Boolean).length,
      modelCount: modal.querySelectorAll("[data-regen-model]").length,
      selected: [...modal.querySelectorAll("[data-regen-model]")]
        .filter((b) => b.getAttribute("aria-pressed") === "true")
        .map((b) => b.getAttribute("data-regen-model")),
      runW: run?.width ?? 0, cancelW: cancel?.width ?? 0,
      runBelowCancel: run && cancel ? run.top < cancel.top : null,
      order: order.sort((a, b) => a[1] - b[1]).map(([nm]) => nm),
      // Things the brief explicitly bans from this window.
      filmstrip: modal.querySelectorAll("[data-regen-strip]").length,
      ratioBadge: [...modal.querySelectorAll("span")]
        .filter((s) => /^\\d+:\\d+$/.test(s.textContent.trim())).length,
      headings: [...modal.querySelectorAll("p")]
        .map((e) => e.textContent.trim())
        .filter((s) => ["Model AI", "Zaznacz element", "Opisz, co chcesz poprawić",
          "Wybierz model do regeneracji obrazu."].includes(s)),
    };
  });
  ok(m !== null, `${tag}: no modal`);
  if (!m) return null;

  const expect = Math.min(width - 48, 1920);
  ok(Math.abs(m.w - expect) <= 3, `${tag}: modal ${m.w.toFixed(0)}px, expected ~${expect}`);

  if (width >= 1024) {
    ok(m.cols === 2, `${tag}: ${m.cols} column(s), expected 2`);
    if (m.cols === 2) {
      ok(m.colWidths[0] > m.colWidths[1],
        `${tag}: image column ${m.colWidths[0].toFixed(0)} not wider than panel ${m.colWidths[1].toFixed(0)}`);
      ok(m.panelW >= 360 && m.panelW <= 450, `${tag}: panel ${m.panelW.toFixed(0)}px outside 360–450`);
    }
  } else {
    ok(m.cols === 1, `${tag}: ${m.cols} columns below lg, expected one stack`);
  }

  // The picture, whole and large.
  if (m.imgNatW && m.imgH) {
    const want = m.imgNatW / m.imgNatH, got = m.imgW / m.imgH;
    ok(Math.abs(want - got) / want < 0.02, `${tag}: image distorted (${got.toFixed(3)} vs ${want.toFixed(3)})`);
    ok(m.imgW > 300, `${tag}: image only ${m.imgW.toFixed(0)}px wide`);
  }

  // The eight marking tools, in a tidy grid.
  ok(m.toolCount === 8, `${tag}: ${m.toolCount} tools, expected 8`);
  ok(m.toolCols === 4, `${tag}: tool grid has ${m.toolCols} columns, expected 4`);

  // EXACTLY TWO ENGINES, and the one that made the image is preselected.
  ok(m.modelCount === 2, `${tag}: ${m.modelCount} engines offered, expected 2`);
  ok(m.selected.length === 1 && m.selected[0] === "m-origin",
    `${tag}: preselected engine is ${m.selected.join(",") || "none"}, expected m-origin`);

  // Both buttons full width, generate above cancel.
  ok(Math.abs(m.runW - m.cancelW) <= 1, `${tag}: run ${m.runW.toFixed(0)} vs cancel ${m.cancelW.toFixed(0)}`);
  ok(m.runW > m.panelW * 0.85, `${tag}: buttons not full panel width (${m.runW.toFixed(0)}/${m.panelW.toFixed(0)})`);
  ok(m.runBelowCancel === true, `${tag}: cancel is not below generate`);

  // Banned furniture.
  ok(m.filmstrip === 0, `${tag}: filmstrip still present`);
  ok(m.ratioBadge === 0, `${tag}: a format badge is still rendered`);
  ok(m.headings.length === 0, `${tag}: section headings still present: ${m.headings.join(", ")}`);

  const want = ["instruction", "undo", "tools", "size", "models", "run", "cancel"];
  ok(m.order.join(">") === want.join(">"), `${tag}: panel order ${m.order.join(" > ")}`);
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
  for (const w of LAPTOP) rows.push([`laptop ${w}`, await layout(page, w, 900, "LAPTOP")]);
  for (const w of DESKTOP) rows.push([`desktop ${w}`, await layout(page, w, 1080, "DESKTOP")]);
  for (const w of TABLET_P) rows.push([`tablet-p ${w}`, await layout(page, w, 1180, "TABLET-P")]);
  for (const w of TABLET_L) rows.push([`tablet-l ${w}`, await layout(page, w, 834, "TABLET-L")]);

  // Choosing the recommended engine really switches the selection and price.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.click("[data-regen-model='m-reco']");
  await page.waitForTimeout(220);
  const after = await page.evaluate(() => [...document.querySelectorAll("[data-regen-model]")]
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.getAttribute("data-regen-model")));
  ok(after.length === 1 && after[0] === "m-reco", `switching: selected ${after.join(",") || "none"}`);

  // The recommended engine is visibly badged as such.
  const badge = await page.$eval("[data-regen-model='m-reco']", (b) => b.textContent);
  ok(/Rekomendowany/.test(badge), `recommended badge missing: ${badge.slice(0, 80)}`);

  // Both tiles quote a price.
  const prices = await page.$$eval("[data-regen-model]", (bs) =>
    bs.map((b) => /\d+\s*kr\./.test(b.textContent)));
  ok(prices.every(Boolean), "an engine tile shows no credit cost");

  await browser.close();

  console.log("\nMODAL GEOMETRY");
  for (const [label, m] of rows) {
    if (m) console.log(`  ${label.padEnd(14)} ${m.w.toFixed(0).padStart(4)}px  image ${m.imgW.toFixed(0).padStart(4)}px  panel ${m.panelW.toFixed(0).padStart(3)}px  ${m.cols} col`);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log("\nFAILURES");
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
})();
