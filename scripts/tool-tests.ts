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
  composeEditor, compress, dropShadow, flattenToColor, inspect, resizeConvert, watermark,
} from "../lib/images/local";
import {
  applyPatch, clampEditorState, describePatch, isPristine, pushHistory,
  EDITOR_DEFAULTS, type EditorState, type HistoryEntry,
} from "../lib/images/editor-state";
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

  console.log("\nH. EDITOR STATE — the panel and the server share one contract");
  const base = clampEditorState({});
  check("an empty object falls back to the defaults", isPristine(base) && base.transform.scale === 100);
  check("anything that is not an object is not an editor state",
    isPristine(clampEditorState(null)) && isPristine(clampEditorState("nonsense"))
    && isPristine(clampEditorState([1, 2, 3])) && isPristine(clampEditorState(42)));

  // Everything a hand-rolled request could send: the wrong type, the wrong
  // spelling, a value a thousand times past the slider, and NaN.
  const hostile = clampEditorState({
    background: { mode: "dropTable", color: "red" },
    shadow: { preset: 42, opacity: NaN, blur: 1e9, offsetX: "-999999", offsetY: Infinity, color: "#GGGGGG" },
    format: { ratio: "7:3", width: 99999, height: -5, lockRatio: "yes" },
    adjust: { brightness: 5000, contrast: -5000, saturation: "x", temperature: null, sharpness: NaN },
    transform: { rotate: 720, flipH: 1, flipV: "true", scale: 1e6, offsetX: -1e6, offsetY: {} },
  });
  check("a bad enum falls back instead of reaching sharp",
    hostile.background.mode === "keep" && hostile.shadow.preset === "none" && hostile.format.ratio === "original");
  check("a colour that is not a colour falls back",
    hostile.background.color === "#FFFFFF" && hostile.shadow.color === "#000000");
  check("NaN and Infinity never survive",
    hostile.shadow.opacity === 30 && hostile.shadow.offsetY === 18
    && hostile.adjust.temperature === 0 && hostile.adjust.sharpness === 0 && hostile.adjust.saturation === 0);
  check("huge numbers are clamped to the slider, not rejected",
    hostile.shadow.blur === 200 && hostile.shadow.offsetX === -300
    && hostile.format.width === 8000 && hostile.format.height === 16
    && hostile.adjust.brightness === 100 && hostile.adjust.contrast === -100
    && hostile.transform.rotate === 180 && hostile.transform.scale === 400 && hostile.transform.offsetX === -100);
  check("a non-boolean is not a truthy boolean",
    hostile.transform.flipH === false && hostile.transform.flipV === false && hostile.format.lockRatio === true);
  check("a background URL that is not https is dropped",
    clampEditorState({ background: { imageUrl: "javascript:alert(1)" } }).background.imageUrl === undefined);

  const patched = applyPatch(base, "adjust", { brightness: 250 });
  check("applyPatch clamps an out-of-range dial", patched.adjust.brightness === 100);
  check("applyPatch never touches the state it was handed",
    base.adjust.brightness === 0 && base.adjust !== patched.adjust && base !== patched);
  const preset = applyPatch(base, "shadow", { preset: "strong" });
  check("a shadow preset brings its own numbers", preset.shadow.opacity === 55 && preset.shadow.blur === 12);
  const tuned = applyPatch(preset, "shadow", { preset: "wall", opacity: 12 });
  check("a value set in the same patch beats the preset", tuned.shadow.opacity === 12 && tuned.shadow.offsetX === 34);

  check("the untouched state is pristine", isPristine(EDITOR_DEFAULTS));
  check("one moved dial is not", !isPristine(applyPatch(base, "transform", { rotate: 2 })));
  // Switching a shadow back off restores the original photo whatever the
  // sliders were left at, so pristine has to mean "renders the same", not
  // "every field equals the default".
  const shadowOff = applyPatch(preset, "shadow", { preset: "none" });
  check("a shadow switched back off is pristine again", isPristine(shadowOff) && shadowOff.shadow.opacity === 55);

  let history: HistoryEntry[] = pushHistory([], EDITOR_DEFAULTS, "editor.h.opened");
  const original = history[0];
  let walked: EditorState = EDITOR_DEFAULTS;
  for (let step = 1; step <= 80; step++) {
    walked = applyPatch(walked, "adjust", { brightness: step });
    history = pushHistory(history, walked, describePatch("adjust", { brightness: step }, walked), 50);
  }
  check("history is capped", history.length === 50, `80 steps → ${history.length} entries`);
  check("the original is never the entry that falls off", history[0] === original);
  check("a step that changes nothing is not a step",
    pushHistory(history, history[history.length - 1].state, "editor.h.noChange", 50).length === history.length);
  const stepBytes = JSON.stringify(history[0].state).length;
  check("a step is parameters, never a bitmap", stepBytes < 1024, `${stepBytes} bytes per step`);

  const labels = [
    describePatch("background", { mode: "transparent" }, base),
    describePatch("shadow", { preset: "floating" }, base),
    describePatch("format", { ratio: "1:1" }, base),
    describePatch("adjust", { contrast: 10 }, base),
    describePatch("adjust", { brightness: 4, contrast: 4 }, base),
    describePatch("transform", { flipH: true }, base),
    describePatch("transform", { scale: 100 }, base),
  ];
  check("every step is named with an i18n key, never a sentence",
    labels.every((key) => /^editor\.h\.[A-Za-z]+$/.test(key)) && labels[6] === "editor.h.noChange");

  console.log("\nI. EDITOR BAKE — one pass over real pixels");
  const jpeg = { format: "jpeg", quality: 92 } as const;
  const baked = await composeEditor(photo, EDITOR_DEFAULTS, jpeg);
  const bakedFacts = await inspect(baked);
  check("a pristine state re-encodes without moving the frame",
    bakedFacts.width === 1400 && bakedFacts.height === 900);

  const state = (patch: Partial<EditorState>): EditorState => ({ ...EDITOR_DEFAULTS, ...patch });
  const square = await inspect(await composeEditor(photo,
    state({ format: { ratio: "1:1", width: null, height: null, lockRatio: true } }), jpeg));
  check("a ratio only ever adds canvas", square.width === 1400 && square.height === 1400,
    `1400×900 → ${square.width}×${square.height}`);
  const boxed = await inspect(await composeEditor(photo,
    state({ format: { ratio: "1:1", width: 2000, height: null, lockRatio: true } }), jpeg));
  check("an explicit box is exact, and pads rather than inventing detail",
    boxed.width === 2000 && boxed.height === 2000, `${boxed.width}×${boxed.height}`);

  const turned = await inspect(await composeEditor(photo, state({
    transform: { ...EDITOR_DEFAULTS.transform, rotate: 15 },
  }), { format: "png", quality: 92 }));
  check("a free rotation grows the canvas instead of clipping the corners",
    turned.width > 1400 && turned.height > 900, `${turned.width}×${turned.height}`);
  const zoomed = await composeEditor(photo, state({
    transform: { ...EDITOR_DEFAULTS.transform, scale: 160, offsetX: 12 },
  }), jpeg);
  const zoomedFacts = await inspect(zoomed);
  check("zoom and pan stay inside the frame they started with",
    zoomedFacts.width === 1400 && zoomedFacts.height === 900 && !zoomed.equals(baked));
  const mirrored = await composeEditor(photo, state({
    transform: { ...EDITOR_DEFAULTS.transform, flipH: true },
  }), jpeg);
  check("mirroring really mirrors", !mirrored.equals(baked) && (await inspect(mirrored)).width === 1400);

  const mean = async (buffer: Buffer) => {
    const { channels } = await sharp(buffer).stats();
    return channels.slice(0, 3).reduce((sum, c) => sum + c.mean, 0) / 3;
  };
  const rgb = async (buffer: Buffer) => (await sharp(buffer).stats()).channels.map((c) => c.mean);
  const spread = async (buffer: Buffer) => {
    const { channels } = await sharp(buffer).stats();
    return channels.slice(0, 3).reduce((sum, c) => sum + c.stdev, 0) / 3;
  };
  const withAdjust = (patch: Partial<EditorState["adjust"]>) =>
    composeEditor(photo, state({ adjust: { ...EDITOR_DEFAULTS.adjust, ...patch } }), jpeg);

  const [neutral, brighter, darker] = [await mean(baked), await mean(await withAdjust({ brightness: 40 })), await mean(await withAdjust({ brightness: -40 }))];
  check("brightness moves the whole image both ways", brighter > neutral && darker < neutral,
    `${darker.toFixed(1)} < ${neutral.toFixed(1)} < ${brighter.toFixed(1)}`);
  const [flat, punchy] = [await spread(await withAdjust({ contrast: -60 })), await spread(await withAdjust({ contrast: 60 }))];
  check("contrast really spreads the histogram", punchy > (await spread(baked)) && flat < (await spread(baked)),
    `σ ${flat.toFixed(1)} → ${punchy.toFixed(1)}`);
  const [warmR, , warmB] = await rgb(await withAdjust({ temperature: 80 }));
  const [coolR, , coolB] = await rgb(await withAdjust({ temperature: -80 }));
  check("temperature is a genuine red/blue balance shift", warmR > coolR && warmB < coolB,
    `warm R${warmR.toFixed(0)}/B${warmB.toFixed(0)} · cool R${coolR.toFixed(0)}/B${coolB.toFixed(0)}`);
  const [greyR, greyG, greyB] = await rgb(await withAdjust({ saturation: -100 }));
  check("saturation at zero is actually grey", Math.abs(greyR - greyG) < 2 && Math.abs(greyG - greyB) < 2,
    `${greyR.toFixed(0)}/${greyG.toFixed(0)}/${greyB.toFixed(0)}`);
  check("sharpness works in both directions",
    !(await withAdjust({ sharpness: 80 })).equals(await withAdjust({ sharpness: -80 })));

  const grounded = await inspect(await composeEditor(cutout, state({
    background: { mode: "color", color: "#FFFFFF" },
    shadow: { preset: "soft", opacity: 35, blur: 24, offsetX: 0, offsetY: 18, color: "#000000" },
  }), jpeg));
  check("the shadow gets room and lands on the backdrop, not through it",
    grounded.width > 800 && !grounded.hasAlpha, `${grounded.width}×${grounded.height}`);
  const transparent = await inspect(await composeEditor(cutout, EDITOR_DEFAULTS, { format: "png", quality: 92 }));
  check("a cutout keeps its transparency", transparent.hasAlpha);
  const filled = await inspect(await composeEditor(cutout,
    state({ background: { mode: "color", color: "#F5F5F7" } }), jpeg));
  check("a colour background flattens it", !filled.hasAlpha);

  let refusedShadow = false;
  try { await composeEditor(photo, state({ shadow: { ...EDITOR_DEFAULTS.shadow, preset: "soft" } }), jpeg); }
  catch (e) { refusedShadow = (e as Error).message === "needs_transparency"; }
  check("refuses to invent a silhouette for an opaque photo", refusedShadow);
  let refusedBackground = false;
  try { await composeEditor(photo, state({ background: { mode: "image", color: "#FFFFFF" } }), jpeg); }
  catch (e) { refusedBackground = (e as Error).message === "background_unavailable"; }
  check("says no to a background it has no way to generate", refusedBackground);

  console.log(failures === 0 ? "\nAll image tool tests passed.\n" : `\n${failures} test(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
