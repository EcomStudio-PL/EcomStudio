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
 *
 * IT ALSO MEASURES THE SIZE PREVIEW AND THE TAB ICON, because both are facts
 * a browser can be asked about rather than claims to be made in a report:
 *
 *   THE PREVIEW — while the size is being changed, a ring of the real nib
 *   appears over the middle of the picture. "Real" is not taken on trust: the
 *   probe measures the ring, then taps the brush once and measures the dot
 *   the canvas actually paints. It must also leave the drawing untouched —
 *   every canvas pixel stays transparent while the slider moves — and it must
 *   go away by itself.
 *
 *   THE FAVICON — the page must declare icons, every declared file must
 *   exist, be the size it claims, and be a downscale of the official master
 *   rather than something redrawn. The dead /icon.png route must be gone.
 */
import fs from "node:fs";
import sharp from "sharp";
import { chromium } from "playwright";

const DIR = "app/probe-tmp/regen";
const MASTER = "public/brand/app-icon.png";

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
const near = (a, b, tol) => Math.abs(a - b) <= tol;

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

// ── The size preview ───────────────────────────────────────────────────────

/** The ring, the image box, the modal box and the slider's own value. */
const readRing = (page) => page.evaluate(() => {
  const img = document.querySelector("[data-regen-image]");
  const box = img?.parentElement;
  const ring = document.querySelector("[data-brush-preview]");
  const slider = document.querySelector("[data-regen-size]");
  const b = box?.getBoundingClientRect();
  const r = ring?.getBoundingClientRect();
  const modal = document.querySelector("[data-regen-modal]")?.getBoundingClientRect();
  return {
    value: slider ? Number(slider.value) : null,
    box: b ? { cx: b.left + b.width / 2, cy: b.top + b.height / 2, w: b.width, h: b.height } : null,
    modal: modal ? { cx: modal.left + modal.width / 2, cy: modal.top + modal.height / 2 } : null,
    ring: r ? {
      cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height,
      pointer: getComputedStyle(ring).pointerEvents,
      z: getComputedStyle(ring).zIndex,
      hidden: ring.getAttribute("aria-hidden"),
      nib: Number(ring.getAttribute("data-nib")),
    } : null,
  };
});

/** Everything the canvas is carrying: the bounding box of anything that is
 *  not fully transparent, in CSS px. */
const readCanvas = (page) => page.evaluate(() => {
  const canvas = document.querySelector("[data-regen-image]")?.parentElement?.querySelector("canvas");
  if (!canvas) return null;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, n = 0;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (d[(y * canvas.width + x) * 4 + 3] > 8) {
        n++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  const dpr = canvas.width / canvas.getBoundingClientRect().width;
  return n === 0 ? { painted: 0, w: 0, h: 0 }
    : { painted: n, w: (maxX - minX + 1) / dpr, h: (maxY - minY + 1) / dpr };
});

/** Press and hold the slider at a fraction of its track; returns a release. */
async function holdSlider(page, frac) {
  const b = await page.locator("[data-regen-size]").boundingBox();
  const x = b.x + 9 + (b.width - 18) * frac;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(60);
  return { release: async () => { await page.mouse.up(); await page.waitForTimeout(40); }, y };
}

const pickTool = (page, key) => page.locator(`[data-regen-tool="${key}"]`).click();

/** How long until the ring leaves, in ms; 0 if it never did. */
async function waitGone(page) {
  const t0 = Date.now();
  for (let i = 0; i < 40; i++) {
    if (await page.locator("[data-brush-preview]").count() === 0) return Date.now() - t0;
    await page.waitForTimeout(40);
  }
  return 0;
}

// ── The icons, before any browser is involved ──────────────────────────────
/* Are the files that ship actually cut from the official master, or did
 * someone draw a replacement? A downscale of the master, compared against the
 * master downscaled the same way, differs by almost nothing. */
{
  const raw = (buf, size) => sharp(buf).resize(size, size, { fit: "cover" })
    .removeAlpha().raw().toBuffer();
  const meanDiff = async (buf, size) => {
    const [a, b] = await Promise.all([raw(buf, size), raw(fs.readFileSync(MASTER), size)]);
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
  };

  for (const [file, size] of [
    ["public/icons/icon-16.png", 16],
    ["public/icons/icon-32.png", 32],
    ["public/icons/apple-touch-icon.png", 180],
  ]) {
    const exists = fs.existsSync(file);
    ok(exists, `${file} is missing`);
    if (!exists) continue;
    const buf = fs.readFileSync(file);
    const meta = await sharp(buf).metadata();
    ok(meta.width === size && meta.height === size,
      `${file} is ${meta.width}x${meta.height}, expected ${size}x${size}`);
    const d = await meanDiff(buf, size);
    // 8/255 ≈ 3%: resampling and PNG quantisation noise, nothing like a
    // different drawing.
    ok(d < 8, `${file} differs from the official master by ${d.toFixed(1)}/255 per channel`);
    console.log(`  ${file.padEnd(34)} ${size}px, Δ vs master ${d.toFixed(2)}/255`);
  }

  const ico = fs.readFileSync("public/favicon.ico");
  ok(ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1, "favicon.ico is not an icon container");
  const frames = ico.readUInt16LE(4);
  ok(frames === 3, `favicon.ico carries ${frames} sizes, expected 16/32/48`);
  const sizes = [];
  for (let i = 0; i < frames; i++) {
    const at = 6 + i * 16;
    const w = ico.readUInt8(at) || 256;
    const off = ico.readUInt32LE(at + 12);
    const len = ico.readUInt32LE(at + 8);
    sizes.push(w);
    const frame = ico.subarray(off, off + len);
    const meta = await sharp(frame).metadata();
    ok(meta.width === w && meta.height === w, `favicon.ico frame claims ${w} but is ${meta.width}`);
    const d = await meanDiff(frame, w);
    ok(d < 8, `favicon.ico ${w}px frame differs from the master by ${d.toFixed(1)}/255`);
  }
  ok(sizes.join(",") === "16,32,48", `favicon.ico sizes are ${sizes.join(",")}`);
  console.log(`  favicon.ico${" ".repeat(23)} ${sizes.join("/")}px, ${ico.length} B`);

  // The 512px duplicate that emitted nothing must be gone — and the PWA copy
  // it duplicated must NOT have been taken with it.
  ok(!fs.existsSync("app/icon.png"), "app/icon.png is still there — the dead /icon.png route survives");
  ok(fs.existsSync("public/icons/icon-512.png"), "public/icons/icon-512.png was deleted — the manifest points at it");
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

  /* ── THE SIZE PREVIEW ─────────────────────────────────────────────────── */
  await page.waitForTimeout(200);
  ok(await page.locator("[data-regen-size]").count() === 1, "no size slider");
  ok(await page.locator("[data-brush-preview]").count() === 0,
    "the ring is on the picture before anyone touched the slider");

  const hold = await holdSlider(page, 0.5);
  const mid = await readRing(page);
  ok(mid.ring !== null, "holding the slider shows no ring");
  if (mid.ring) {
    // ON THE PICTURE — not on the modal, and not on the panel.
    ok(near(mid.ring.cx, mid.box.cx, 0.75) && near(mid.ring.cy, mid.box.cy, 0.75),
      `ring is ${(mid.ring.cx - mid.box.cx).toFixed(1)},${(mid.ring.cy - mid.box.cy).toFixed(1)}px off the picture's centre`);
    ok(Math.abs(mid.ring.cx - mid.modal.cx) > 40,
      "ring sits at the modal's centre rather than the picture's — with the panel included it cannot be both");
    // THE SIZE IS THE SLIDER'S OWN NUMBER.
    ok(near(mid.ring.w, mid.value, 0.6) && near(mid.ring.h, mid.value, 0.6),
      `slider says ${mid.value}px, ring is ${mid.ring.w.toFixed(1)}x${mid.ring.h.toFixed(1)}px`);
    ok(mid.ring.nib === mid.value, `ring declares ${mid.ring.nib}px for a ${mid.value}px brush`);
    ok(mid.ring.w === mid.ring.h, "the ring is not round");
    // IT CANNOT BE TOUCHED, AND IT CANNOT COVER THE WAY OUT.
    ok(mid.ring.pointer === "none",
      `ring has pointer-events: ${mid.ring.pointer} — it would steal the canvas's pointer capture`);
    ok(mid.ring.z === "auto",
      `ring has z-index ${mid.ring.z} — it escapes the picture and paints over the close button`);
    ok(mid.ring.hidden === "true", "the ring is announced to screen readers");
  }

  // IT FOLLOWS THE SLIDER, 1:1, ALL THE WAY ALONG.
  const seen = [];
  for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
    const b = await page.locator("[data-regen-size]").boundingBox();
    await page.mouse.move(b.x + 9 + (b.width - 18) * frac, hold.y);
    await page.waitForTimeout(60);
    const r = await readRing(page);
    ok(r.ring !== null && near(r.ring.w, r.value, 0.6),
      `at ${r.value}px the ring is ${r.ring ? r.ring.w.toFixed(1) : "absent"}px`);
    seen.push(`${r.value}→${r.ring ? r.ring.w.toFixed(0) : "–"}`);
  }
  ok(new Set(seen).size >= 4, `the ring did not change size across the track: ${seen.join(" ")}`);
  console.log(`  slider→ring  ${seen.join("  ")}`);

  // NOTHING OF THIS REACHES THE DRAWING.
  const during = await readCanvas(page);
  ok(during !== null, "no annotation canvas to check");
  ok(during && during.painted === 0,
    `${during && during.painted} canvas pixels were painted while the slider moved`);
  ok(await page.locator("[data-regen-undo]").isDisabled(), "moving the slider created an undo step");
  ok(await page.locator("[data-regen-reset]").isDisabled(), "moving the slider created something to reset");

  await hold.release();

  // AND IT LEAVES BY ITSELF.
  const gone = await waitGone(page);
  ok(gone > 0, "the ring is still on the picture 1.6s after the slider was released");
  ok(gone >= 200, `the ring vanished after ${gone}ms — too fast to read the size that was set`);
  ok(gone <= 1200, `the ring lingered ${gone}ms`);
  console.log(`  linger       ${gone}ms after release`);

  /* THE RING IS THE NIB — measured against the paint it promises. */
  const hold2 = await holdSlider(page, 0.8);
  const big = await readRing(page);
  await hold2.release();
  await page.waitForTimeout(700);

  const imgBox = await page.locator("[data-regen-image]").boundingBox();
  await page.mouse.click(imgBox.x + imgBox.width / 2, imgBox.y + imgBox.height / 2);
  await page.waitForTimeout(200);
  const dot = await readCanvas(page);
  ok(dot && dot.painted > 0, "a single tap of the brush painted nothing — the comparison is void");
  ok(dot && near(dot.w, big.value, 2.5) && near(dot.h, big.value, 2.5),
    `at ${big.value}px the brush paints ${dot && dot.w.toFixed(1)}x${dot && dot.h.toFixed(1)}px`);
  ok(dot && big.ring && near(dot.w, big.ring.w, 2.5),
    `the ring promised ${big.ring && big.ring.w.toFixed(1)}px and the canvas painted ${dot && dot.w.toFixed(1)}px`);
  console.log(`  real size    slider ${big.value}px → ring ${big.ring.w.toFixed(1)}px → painted ${dot.w.toFixed(1)}x${dot.h.toFixed(1)}px`);

  // Put the picture back the way it was found.
  await page.locator("[data-regen-undo]").click();
  await page.waitForTimeout(150);
  const cleared = await readCanvas(page);
  ok(cleared && cleared.painted === 0, "undo did not clear the test mark");

  /* THE KEYBOARD CHANGES THE SIZE TOO. */
  await page.locator("[data-regen-size]").focus();
  const before = await page.locator("[data-regen-size]").inputValue();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  const kb = await readRing(page);
  ok(kb.value === Number(before) + 2, `two ArrowRights moved ${before} → ${kb.value}`);
  ok(kb.ring !== null, "the arrow keys change the size but show no ring");
  ok(kb.ring && near(kb.ring.w, kb.value, 0.6),
    `after the keyboard the ring is ${kb.ring && kb.ring.w.toFixed(1)}px for ${kb.value}px`);
  ok((await waitGone(page)) > 0, "the ring raised by the keyboard never goes away");

  /* ONLY THE TOOLS THE SIZE IS REAL FOR. */
  for (const tool of ["brush", "rect", "circle", "line", "arrow"]) {
    await pickTool(page, tool);
    const h = await holdSlider(page, 0.6);
    ok(await page.locator("[data-brush-preview]").count() === 1,
      `${tool}: no ring, though the size is this tool's stroke width`);
    await h.release();
    await waitGone(page);
  }
  for (const tool of ["eraser", "hand", "magic"]) {
    await pickTool(page, tool);
    const h = await holdSlider(page, 0.6);
    ok(await page.locator("[data-brush-preview]").count() === 0,
      `${tool}: a ring is shown, but this tool never reads the size — that is a number with nothing behind it`);
    await h.release();
    await waitGone(page);
  }
  // A POSITIVE CONTROL for the three absence checks above: the same selector,
  // the same helper, on a tool that must show one. Without this, a typo in the
  // selector would make those three pass for the wrong reason.
  await pickTool(page, "brush");
  const control = await holdSlider(page, 0.6);
  ok(await page.locator("[data-brush-preview]").count() === 1,
    "the absence checks are meaningless: the selector finds nothing even for the brush");
  await control.release();
  await waitGone(page);

  // A RIGHT-CLICK MUST NOT STRAND IT. The context menu can swallow the
  // release that would take the ring down, so the press is ignored outright.
  const sBox = await page.locator("[data-regen-size]").boundingBox();
  await page.mouse.click(sBox.x + sBox.width * 0.5, sBox.y + sBox.height / 2, { button: "right" });
  await page.waitForTimeout(250);
  ok(await page.locator("[data-brush-preview]").count() === 0,
    "a right-click on the slider raised the ring, and the context menu can eat the release that lowers it");

  /* ── THE ICONS, AS THE BROWSER SEES THEM ─────────────────────────────── */
  const head = await page.evaluate(() => ({
    icons: [...document.querySelectorAll('link[rel="icon"]')].map((l) => ({
      href: l.getAttribute("href"), sizes: l.getAttribute("sizes"), type: l.getAttribute("type"),
    })),
    apple: [...document.querySelectorAll('link[rel="apple-touch-icon"]')].map((l) => l.getAttribute("href")),
  }));
  const declares = (p) => head.icons.some((i) => (i.href ?? "").split("?")[0] === p);
  ok(head.icons.length >= 2, `the page declares ${head.icons.length} icons`);
  ok(declares("/favicon.ico"), "no /favicon.ico is declared");
  ok(declares("/icons/icon-32.png"), "no 32px png icon is declared");
  ok(declares("/icons/icon-16.png"), "no 16px png icon is declared");
  ok(head.apple.some((h) => (h ?? "").startsWith("/icons/apple-touch-icon.png")),
    `apple-touch-icon is ${head.apple.join(",") || "absent"}`);
  ok(!head.icons.some((i) => (i.href ?? "").includes("/icon.png")),
    "the page still points at the removed /icon.png");

  const files = await page.evaluate(async (base) => {
    const probe = async (path) => {
      const r = await fetch(base + path, { cache: "no-store" });
      const b = r.ok ? await r.blob() : null;
      return { path, status: r.status, type: r.headers.get("content-type"), size: b ? b.size : 0 };
    };
    const pixels = async (path) => await new Promise((done) => {
      const img = new Image();
      img.onload = () => done({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => done(null);
      img.src = base + path;
    });
    return {
      // Both the declared URL and the bare one a browser asks for by itself.
      ico: await probe("/favicon.ico?v=5"),
      icoBare: await probe("/favicon.ico"),
      png32: await probe("/icons/icon-32.png?v=5"),
      png16: await probe("/icons/icon-16.png?v=5"),
      apple: await probe("/icons/apple-touch-icon.png?v=5"),
      // The PWA still needs its own, larger copies.
      pwa192: await probe("/icons/icon-192.png?v=5"),
      pwa512: await probe("/icons/icon-512.png?v=5"),
      manifest: await probe("/manifest.webmanifest"),
      stale: await probe("/icon.png"),
      shape32: await pixels("/icons/icon-32.png?v=5"),
      shapeApple: await pixels("/icons/apple-touch-icon.png?v=5"),
      // A 200 only proves the bytes are served. This proves a browser can
      // actually DECODE the hand-built ICO container.
      shapeIco: await pixels("/favicon.ico"),
    };
  }, BASE);
  ok(files.ico.status === 200, `/favicon.ico?v=5 answers ${files.ico.status}`);
  ok(files.icoBare.status === 200,
    `the bare /favicon.ico a browser asks for by itself answers ${files.icoBare.status}`);
  ok(/icon/.test(files.ico.type ?? ""), `/favicon.ico is served as ${files.ico.type}`);
  ok(files.ico.size > 2000, `/favicon.ico is ${files.ico.size} B`);
  ok(files.png32.status === 200 && files.png16.status === 200, "a declared png icon does not exist");
  ok(files.apple.status === 200, `the apple icon answers ${files.apple.status}`);
  ok(files.pwa192.status === 200 && files.pwa512.status === 200, "a manifest icon stopped resolving");
  ok(files.manifest.status === 200, `the web manifest answers ${files.manifest.status}`);
  ok(files.stale.status === 404, `/icon.png still answers ${files.stale.status} — the dead duplicate still ships`);
  ok(files.shape32 && files.shape32.w === 32 && files.shape32.h === 32,
    `the 32px icon decodes as ${files.shape32 && files.shape32.w}x${files.shape32 && files.shape32.h}`);
  ok(files.shapeApple && files.shapeApple.w === 180, "the apple icon is not 180px");
  ok(files.shapeIco !== null,
    "the browser could not decode /favicon.ico — the icon container is malformed");
  ok(files.shapeIco && files.shapeIco.w >= 16 && files.shapeIco.w <= 48,
    `/favicon.ico decodes at ${files.shapeIco && files.shapeIco.w}px, outside the 16–48 it carries`);
  console.log(`  icons        favicon.ico ${files.ico.status} (${files.ico.size} B) · png 32/16 ${files.png32.status}/${files.png16.status} · apple ${files.apple.status} · pwa ${files.pwa192.status}/${files.pwa512.status} · stale /icon.png ${files.stale.status}`);

  /* ── THE MODAL STILL DRAWS ────────────────────────────────────────────
     The ring sits above the canvas. If it ever became hit-testable, the
     canvas would take the pointer capture on the WRONG element and every
     stroke would freeze after its first point. Draw a real line straight
     through the middle — over the very place the ring appears. */
  const line = await page.locator("[data-regen-image]").boundingBox();
  const cy = line.y + line.height / 2;
  await page.mouse.move(line.x + line.width * 0.3, cy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(line.x + line.width * (0.3 + 0.05 * i), cy);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const drawn = await readCanvas(page);
  ok(drawn && drawn.painted > 0, "the stroke never reached the canvas");
  ok(drawn && drawn.w > line.width * 0.3,
    `the stroke is ${drawn && drawn.w.toFixed(0)}px wide — it froze instead of following the pointer`);
  ok(!(await page.locator("[data-regen-undo]").isDisabled()), "a finished stroke left nothing to undo");
  console.log(`  drawing      stroke ${drawn.w.toFixed(0)}x${drawn.h.toFixed(0)}px across a ${line.width.toFixed(0)}px picture`);

  /* ── A FINGER, ON A PHONE ─────────────────────────────────────────────── */
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await phone.goto(URL_, { waitUntil: "networkidle" });
  await phone.waitForTimeout(400);
  await phone.locator("[data-regen-size]").scrollIntoViewIfNeeded();
  await phone.waitForTimeout(150);
  const sb = await phone.locator("[data-regen-size]").boundingBox();
  const sy = sb.y + sb.height / 2;
  const cdp = await phone.context().newCDPSession(phone);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart", touchPoints: [{ x: sb.x + sb.width * 0.25, y: sy }],
  });
  await phone.waitForTimeout(80);
  const early = await readRing(phone);
  ok(early.ring !== null, "touch: a finger on the slider shows no ring");
  ok(early.ring && near(early.ring.w, early.value, 0.6),
    `touch: ${early.value}px reads as ${early.ring && early.ring.w.toFixed(1)}px`);
  for (let i = 1; i <= 5; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove", touchPoints: [{ x: sb.x + sb.width * (0.25 + 0.14 * i), y: sy }],
    });
    await phone.waitForTimeout(40);
  }
  const late = await readRing(phone);
  ok(late.value > early.value, `touch: dragging right moved the size ${early.value} → ${late.value}`);
  ok(late.ring && near(late.ring.w, late.value, 0.6),
    `touch: after the drag the ring is ${late.ring && late.ring.w.toFixed(1)}px for ${late.value}px`);
  ok(late.ring && near(late.ring.cx, late.box.cx, 0.75), "touch: the ring is not centred on the picture");
  const phoneCanvas = await readCanvas(phone);
  ok(phoneCanvas && phoneCanvas.painted === 0, "touch: the slider painted on the canvas");
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const goneT = await waitGone(phone);
  ok(goneT > 0, "touch: the ring never goes away");
  console.log(`  touch        ${early.value}px → ${late.value}px, ring ${late.ring ? late.ring.w.toFixed(0) : "–"}px, gone ${goneT}ms after the finger lifted`);
  await phone.close();

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
