/**
 * IMAGE TOOLS — deterministic tests.
 *
 * Covers the two layers that must never be wrong and can be checked without
 * a provider: the local processor (all five free tools, on real pixels) and
 * the cost engine (every paid tool clears the margin floor, expand geometry
 * never crops). Provider calls themselves are not exercised here — they need
 * live keys, and a mocked HTTP round trip would prove nothing.
 *
 * Run: npm run test:tools
 */
import sharp from "sharp";
import {
  compress, dropShadow, flattenToColor, inspect, resizeConvert, watermark,
} from "../lib/images/local";
import { billingFrom, creditsForCost, quote } from "../lib/images/pricing";
import { planExpand } from "../lib/server/image-tools";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function main() {
  /* Fixtures: an opaque "product photo", a real cut-out with alpha, a logo,
     and a noisy photo — flat synthetic blocks compress unrealistically. */
  const photo = await sharp({ create: { width: 1400, height: 900, channels: 3, background: "#2b6cb0" } })
    .composite([{
      input: Buffer.from('<svg width="1400" height="900"><rect x="420" y="200" width="560" height="500" rx="40" fill="#e53e3e"/><circle cx="700" cy="450" r="90" fill="#fff"/></svg>'),
      top: 0, left: 0,
    }]).jpeg({ quality: 95 }).toBuffer();
  const cutout = await sharp({ create: { width: 800, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{
      input: Buffer.from('<svg width="800" height="800"><rect x="180" y="140" width="440" height="520" rx="48" fill="#e53e3e"/></svg>'),
      top: 0, left: 0,
    }]).png().toBuffer();
  const logo = await sharp({ create: { width: 400, height: 120, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{
      input: Buffer.from('<svg width="400" height="120"><rect width="400" height="120" rx="16" fill="#ffffff"/></svg>'),
      top: 0, left: 0,
    }]).png().toBuffer();
  const noisy = await sharp({
    create: {
      width: 1600, height: 1200, channels: 3, background: "#808080",
      noise: { type: "gaussian", mean: 128, sigma: 40 },
    },
  }).jpeg({ quality: 95 }).toBuffer();

  console.log("\nA. FORMAT AND SIZE");
  for (const format of ["jpeg", "png", "webp"] as const) {
    const f = await inspect(await resizeConvert(photo, { format, width: 800, quality: 88 }));
    check(`converts to ${format}`, f.format === format && f.width === 800, `${f.width}×${f.height}`);
  }
  const cover = await inspect(await resizeConvert(photo, { format: "jpeg", width: 600, height: 600, fit: "cover" }));
  check("fill crops to the exact box", cover.width === 600 && cover.height === 600);
  const inside = await inspect(await resizeConvert(photo, { format: "jpeg", width: 600, height: 600, fit: "inside" }));
  check("fit never crops", inside.width === 600 && inside.height < 600, `${inside.width}×${inside.height}`);
  const noUp = await inspect(await resizeConvert(photo, { format: "jpeg", width: 5000 }));
  check("never upscales (that is the paid tool's job)", noUp.width === 1400);

  console.log("\nB. COMPRESSION");
  for (const level of ["light", "balanced", "strong", "auto"] as const) {
    const { output, quality } = await compress(noisy, { level });
    const saved = Math.round((1 - output.length / noisy.length) * 100);
    check(`${level} shrinks the file`, output.length < noisy.length, `${saved}% smaller at q${quality}`);
  }
  const tiny = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#fff" } }).jpeg({ quality: 30 }).toBuffer();
  const guarded = await compress(tiny, { level: "light" });
  check("never returns a bigger file than it was given", guarded.output.length <= tiny.length);
  const asWebp = await compress(noisy, { level: "balanced", format: "webp" });
  check("can change format while compressing", (await inspect(asWebp.output)).format === "webp");

  console.log("\nC. WATERMARK");
  const positions = [
    "top-left", "top-center", "top-right", "center-left", "center",
    "center-right", "bottom-left", "bottom-center", "bottom-right", "pattern",
  ] as const;
  for (const position of positions) {
    const out = await watermark(photo, logo, { position, scale: 0.2, opacity: 0.6, margin: 40, rotation: -30, spacing: 40 });
    const f = await inspect(out);
    check(`places the mark: ${position}`, f.width === 1400 && f.height === 900 && out.length > 1000);
  }
  const topLeft = await watermark(photo, logo, { position: "top-left", scale: 0.2, opacity: 1, margin: 20 });
  const bottomRight = await watermark(photo, logo, { position: "bottom-right", scale: 0.2, opacity: 1, margin: 20 });
  check("opposite anchors really differ", !topLeft.equals(bottomRight));
  const flush = await watermark(photo, logo, { position: "top-left", scale: 0.2, opacity: 1, margin: 0 });
  check("the margin actually moves the mark", !topLeft.equals(flush));
  const faint = await watermark(photo, logo, { position: "center", scale: 0.2, opacity: 0.15 });
  const solid = await watermark(photo, logo, { position: "center", scale: 0.2, opacity: 1 });
  check("opacity changes the result", !faint.equals(solid));

  console.log("\nD. WHITE BACKGROUND");
  const white = await inspect(await flattenToColor(cutout, { color: "#FFFFFF", format: "jpeg", quality: 92 }));
  check("flattens transparency onto the colour", !white.hasAlpha && white.format === "jpeg");
  const padded = await inspect(await flattenToColor(cutout, { color: "#FFFFFF", format: "jpeg", padding: 0.1 }));
  check("padding grows the frame around the product", padded.width > 800, `${padded.width}px`);

  console.log("\nE. PRODUCT SHADOW");
  for (const style of ["soft", "contact", "floating"] as const) {
    const f = await inspect(await dropShadow(cutout, { style, opacity: 0.35, blur: 24, offsetY: 18, background: "#FFFFFF" }));
    check(`casts a ${style} shadow without clipping it`, f.width > 800 && f.height > 800, `${f.width}×${f.height}`);
  }
  let refused = false;
  try { await dropShadow(photo, { style: "soft" }); }
  catch (e) { refused = (e as Error).message === "needs_transparency"; }
  check("refuses an opaque photo instead of faking a shadow", refused);

  console.log("\nF. COST ENGINE — every paid operation clears the margin floor");
  const billing = billingFrom({ price_per_100_credits: 19, usd_to_pln: 4.0, min_margin_percent: 50, buffer_percent: 12 });
  const priced: [string, number][] = [
    ["remove_bg · fal BiRefNet", 0.004], ["remove_bg · Photoroom", 0.02],
    ["remove_bg · Stability", 0.05], ["remove_bg · Clipdrop", 0.02],
    ["remove_bg · remove.bg", 0.20], ["upscale · fal ESRGAN", 0.006],
    ["upscale · Stability fast", 0.02], ["upscale · Clipdrop", 0.04],
    ["expand · Stability outpaint", 0.04], ["expand · fal Bria", 0.04],
  ];
  for (const [label, cost] of priced) {
    const q = quote(cost, 1, billing);
    check(label, q.marginPercent >= billing.minMarginPercent && !q.belowFloor,
      `$${cost.toFixed(3)} → ${q.credits} kr = ${q.pricePln.toFixed(2)} zł, margin ${q.marginPercent.toFixed(1)}%`);
  }
  // Margin, not markup: 0.10 zł of cost has to sell for at least 0.20 zł.
  const credits = creditsForCost(0.10 / billing.usdToPln, billing);
  check("0.10 zł cost prices at 0.20 zł or more", credits * billing.plnPerCredit >= 0.20,
    `${(credits * billing.plnPerCredit).toFixed(2)} zł`);

  console.log("\nG. EXPAND GEOMETRY — the original is never cropped");
  for (const ratio of ["1:1", "4:5", "9:16", "16:9"] as const) {
    const plan = planExpand({ width: 1400, height: 900 }, ratio);
    if (!plan) { check(`${ratio}`, false, "no plan"); continue; }
    const [rw, rh] = ratio.split(":").map(Number);
    const grew = plan.target.width >= plan.source.width && plan.target.height >= plan.source.height;
    const exact = Math.abs(plan.target.width / plan.target.height - rw / rh) < 0.01;
    const keepsShape = Math.abs(plan.source.width / plan.source.height - 1400 / 900) < 0.01;
    check(`${ratio} only adds canvas`, grew && exact && keepsShape,
      `${plan.source.width}×${plan.source.height} → ${plan.target.width}×${plan.target.height}`);
  }
  check("refuses a no-op so nobody pays for nothing", planExpand({ width: 1000, height: 1000 }, "1:1") === null);
  const clamped = planExpand({ width: 6000, height: 4000 }, "9:16");
  check("clamps the canvas to provider limits", !!clamped && Math.max(clamped.target.width, clamped.target.height) <= 2400,
    `${clamped?.target.width}×${clamped?.target.height}`);

  console.log(failures === 0 ? "\nAll image tool tests passed.\n" : `\n${failures} test(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
