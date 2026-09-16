/**
 * IMAGE-DETAILS PROBE — measures the rebuilt preview modal against the brief.
 *
 * Run against a PRODUCTION build (`next start`), never `next dev`: the app's
 * CSP forbids `unsafe-eval`, which dev mode needs, so nothing hydrates there.
 *
 *   node scripts/details-probe.mjs --harness
 *   npm run build && npx next start -p 3100 &
 *   node scripts/details-probe.mjs http://127.0.0.1:3100
 *   node scripts/details-probe.mjs --clean
 *
 * The reference sources endpoint is fulfilled by the probe itself rather than
 * stubbed in the app: the component runs its real fetch, its real cache and
 * its real render path, and only the bytes on the wire are the probe's.
 */
import fs from "node:fs";
import { chromium } from "playwright";

const DIR = "app/probe-tmp/details";
const FILES = {
  "page.tsx": "/**\n * TEMPORARY PROBE ROUTE \u2014 written by scripts/details-probe.mjs --harness.\n *\n * Mounts the REAL ImageDetails with one synthetic item so its layout can be\n * measured at every width the brief names. Only the row is invented; the\n * component, its styles and its DOM are exactly what ships.\n */\nimport { I18nProvider } from \"@/lib/i18n/provider\";\nimport pl from \"@/lib/i18n/dictionaries/pl.json\";\nimport { DetailsProbe } from \"@/app/probe-tmp/details/client\";\n\nexport const dynamic = \"force-static\";\n\nexport default function Page() {\n  return (\n    <I18nProvider locale=\"pl\" dict={pl as Record<string, unknown>}>\n      <DetailsProbe />\n    </I18nProvider>\n  );\n}\n",
  "client.tsx": "\"use client\";\nimport { useState } from \"react\";\nimport { ImageDetails } from \"@/components/genv3/image-details\";\nimport type { GalleryItem } from \"@/components/genv3/types\";\n\n/** A 3:2 photo, so a squashed or cropped render is measurable. */\nconst PHOTO = \"data:image/svg+xml;utf8,\" + encodeURIComponent(\n  '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1500\" height=\"1000\">'\n  + '<rect width=\"1500\" height=\"1000\" fill=\"#8a7f9c\"/>'\n  + '<rect x=\"200\" y=\"300\" width=\"1100\" height=\"500\" rx=\"40\" fill=\"#c9c2d4\"/></svg>',\n);\n\nconst ITEM: GalleryItem = {\n  generationId: \"11111111-1111-1111-1111-111111111111\",\n  assetId: \"22222222-2222-2222-2222-222222222222\",\n  path: \"ws/gen/0.png\",\n  url: PHOTO,\n  thumbUrl: PHOTO,\n  width: 1500,\n  height: 1000,\n  ratio: \"3:2\",\n  resolution: \"1K\",\n  quality: \"high\",\n  quantity: 2,\n  credits: 4,\n  latencyMs: 12400,\n  referenceCount: 3,\n  inspirationCount: 1,\n  operation: null,\n  model: \"GPT Image 2\",\n  modelId: \"m1\",\n  product: \"Sofa\",\n  sessionType: \"advertising\",\n  origin: \"custom\",\n  prompt: \"Nowoczesna sofa w stylu skandynawskim, szara tkanina, minimalistyczne wn\u0119trze, naturalne \u015bwiat\u0142o, wysoka jako\u015b\u0107 fotografii produktowej.\",\n  favorite: false,\n  note: null,\n  createdAt: \"2026-08-17T21:05:00.000Z\",\n};\n\nexport function DetailsProbe() {\n  const [open, setOpen] = useState(true);\n  return (\n    <div data-probe=\"details-root\">\n      {open && (\n        <ImageDetails\n          items={[ITEM]}\n          index={0}\n          onIndex={() => undefined}\n          onClose={() => setOpen(false)}\n          canRegenerate\n          onRegenerate={() => undefined}\n          onFavorite={() => undefined}\n          onDelete={() => undefined}\n          onNote={() => undefined}\n        />\n      )}\n    </div>\n  );\n}\n",
};

if (process.argv.includes("--clean")) {
  fs.rmSync("app/probe-tmp", { recursive: true, force: true });
  console.log("removed app/probe-tmp");
  process.exit(0);
}
if (process.argv.includes("--harness")) {
  fs.mkdirSync(DIR, { recursive: true });
  for (const [name, src] of Object.entries(FILES)) fs.writeFileSync(`${DIR}/${name}`, src);
  console.log(`wrote ${DIR}/{page,client}.tsx — build, start, then probe`);
  process.exit(0);
}

const BASE = process.argv[2] ?? "http://127.0.0.1:3100";
const URL_ = `${BASE}/probe-tmp/details`;

const LAPTOP = [1280, 1366, 1440, 1600];
const DESKTOP = [1920, 2560];
const TABLET_P = [768, 820, 834];
const TABLET_L = [1024, 1112, 1180, 1194];

let pass = 0, fail = 0;
const failures = [];
const ok = (c, label) => { if (c) pass++; else { fail++; failures.push(label); } };

/** A reference photo for the sources strip, served to the component's own fetch. */
const REF = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#6d6480"/></svg>');

async function layout(page, width, height, band) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(160);
  const tag = `${band} ${width}×${height}`;

  const doc = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
  }));
  ok(doc.sw <= doc.cw + 1, `${tag}: horizontal overflow (${doc.sw} > ${doc.cw})`);

  const m = await page.evaluate(() => {
    const modal = document.querySelector("[data-details-modal]");
    if (!modal) return null;
    const r = modal.getBoundingClientRect();
    const cols = getComputedStyle(modal).gridTemplateColumns.split(" ").filter(Boolean);
    const img = modal.querySelector("img");
    const ir = img?.getBoundingClientRect();
    const panel = modal.querySelector("[data-details-settings]")?.closest("div.thin-scroll");
    const pr = panel?.getBoundingClientRect();
    const q = (s) => modal.querySelector(s);
    const order = [];
    for (const [name, sel] of [
      ["sources", "[data-sources]"], ["prompt", "[data-details-prompt]"],
      ["info", "[data-details-settings]"], ["note", "textarea"],
      ["actions", "[data-copy-url]"], ["regen", "[data-regen-cta]"],
    ]) {
      const el = q(sel);
      if (el) order.push([name, el.getBoundingClientRect().top]);
    }
    return {
      w: r.width, h: r.height,
      cols: cols.length,
      colWidths: cols.map((c) => parseFloat(c)),
      imgW: ir?.width ?? 0, imgH: ir?.height ?? 0,
      imgNatW: img?.naturalWidth ?? 0, imgNatH: img?.naturalHeight ?? 0,
      imgFit: img ? getComputedStyle(img).objectFit : null,
      panelW: pr?.width ?? 0,
      infoCols: (() => {
        const g = q("[data-details-settings]");
        return g ? getComputedStyle(g).gridTemplateColumns.split(" ").filter(Boolean).length : 0;
      })(),
      editTiles: modal.querySelectorAll("[data-edit-tile]").length,
      actionRow: (() => {
        const a = q("[data-copy-url]");
        return a ? getComputedStyle(a.parentElement).gridTemplateColumns.split(" ").filter(Boolean).length : 0;
      })(),
      regenW: q("[data-regen-cta]")?.getBoundingClientRect().width ?? 0,
      order: order.sort((x, y) => x[1] - y[1]).map(([n]) => n),
      zoomBar: !!q("[data-zoom-bar]"),
      headings: [...modal.querySelectorAll("p,h1,h2,h3")]
        .map((e) => e.textContent.trim())
        .filter((s) => ["Informacje", "Edytuj obraz", "Notatka", "Akcje", "Prompt", "Zdjęcia referencyjne"].includes(s)),
    };
  });
  ok(m !== null, `${tag}: no modal`);
  if (!m) return null;

  // 1. WIDE. The modal takes the viewport minus a 24px frame, capped at 1920.
  const expect = Math.min(width - 48, 1920);
  ok(Math.abs(m.w - expect) <= 3, `${tag}: modal ${m.w.toFixed(0)}px, expected ~${expect}`);

  // 2. TWO COLUMNS from lg up, image column the larger one.
  if (width >= 1024) {
    ok(m.cols === 2, `${tag}: ${m.cols} column(s), expected 2`);
    if (m.cols === 2) {
      ok(m.colWidths[0] > m.colWidths[1],
        `${tag}: image column ${m.colWidths[0].toFixed(0)} not wider than panel ${m.colWidths[1].toFixed(0)}`);
      ok(m.panelW >= 370 && m.panelW <= 460, `${tag}: panel ${m.panelW.toFixed(0)}px outside 370–460`);
    }
  } else {
    ok(m.cols === 1, `${tag}: ${m.cols} columns below lg, expected a single stack`);
  }

  // 3. THE PHOTO IS WHOLE AND BIG.
  //
  // `object-fit: contain` is the actual guarantee the brief is asking for —
  // it is what makes the picture impossible to squash and impossible to crop.
  // The element's own box is NOT the picture (contain letterboxes inside it),
  // so the painted rectangle is derived and measured instead.
  if (m.imgNatW && m.imgH) {
    ok(m.imgFit === "contain", `${tag}: object-fit is ${m.imgFit}, expected contain (crop/squash risk)`);
    const scale = Math.min(m.imgW / m.imgNatW, m.imgH / m.imgNatH);
    const paintedW = m.imgNatW * scale, paintedH = m.imgNatH * scale;
    ok(paintedW > 300, `${tag}: painted image only ${paintedW.toFixed(0)}px wide`);
    // …and the container is not so oversized that the photo floats in a void.
    const fill = (paintedW * paintedH) / (m.imgW * m.imgH);
    ok(fill > 0.4, `${tag}: photo fills only ${(fill * 100).toFixed(0)}% of its container`);
  }

  // 4. THE PANEL, exactly as the brief orders it.
  ok(m.infoCols === 2, `${tag}: info grid has ${m.infoCols} columns, expected 2`);
  ok(m.editTiles === 4, `${tag}: ${m.editTiles} edit tiles, expected 4`);
  ok(m.actionRow === 3, `${tag}: action row has ${m.actionRow} columns, expected 3`);
  ok(m.regenW > 200, `${tag}: regenerate CTA only ${m.regenW.toFixed(0)}px wide`);
  ok(m.zoomBar, `${tag}: zoom bar missing`);

  // 5. NO SECTION HEADINGS — the brief removes every one of them.
  ok(m.headings.length === 0, `${tag}: section headings still present: ${m.headings.join(", ")}`);

  // 6. HIERARCHY, at every width.
  const want = ["sources", "prompt", "info", "note", "actions", "regen"];
  ok(m.order.join(">") === want.join(">"), `${tag}: panel order ${m.order.join(" > ")}`);
  return m;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  });
  const page = await browser.newPage();
  // The component's own fetch, answered by the probe.
  await page.route("**/api/generations/sources**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ ok: true, references: [REF, REF, REF], inspirations: [REF], marked: null, known: true }),
  }));

  const res = await page.goto(URL_, { waitUntil: "networkidle" });
  if (!res || !res.ok()) { console.error(`probe route unreachable: ${res?.status()}`); process.exit(2); }
  await page.waitForTimeout(500);

  const rows = [];
  for (const w of LAPTOP) rows.push([`laptop ${w}`, await layout(page, w, 900, "LAPTOP")]);
  for (const w of DESKTOP) rows.push([`desktop ${w}`, await layout(page, w, 1080, "DESKTOP")]);
  for (const w of TABLET_P) rows.push([`tablet-p ${w}`, await layout(page, w, 1180, "TABLET-P")]);
  for (const w of TABLET_L) rows.push([`tablet-l ${w}`, await layout(page, w, 834, "TABLET-L")]);

  // The reference thumbnails really did render, from the component's own path.
  const thumbs = await page.$$eval("[data-source-thumb]", (e) => e.length);
  ok(thumbs === 4, `reference thumbnails: ${thumbs}, expected 4`);

  // Closing works.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.click("[data-details-modal] [aria-label='Zamknij']").catch(() => null);
  await page.waitForTimeout(250);
  ok(await page.$("[data-details-modal]") === null, "close button did not dismiss the modal");

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
