// QA helper: bundle once, render a list of frames as PNG stills + a labelled contact sheet.
// Usage: node scripts/stills.mjs <outDir> <scale> <frame> [frame...]
import path from "node:path";
import fs from "node:fs";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";

const [outDir, scaleArg, ...frameArgs] = process.argv.slice(2);
const scale = Number(scaleArg || "0.5");
const frames = frameArgs.map(Number);
fs.mkdirSync(outDir, { recursive: true });
const browserExecutable = process.env.REMOTION_BROWSER || null;
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts"), publicDir: path.resolve("public") });
const browser = await openBrowser("chrome", { browserExecutable });
const composition = await selectComposition({ serveUrl, id: "GrovBaseRolka02", puppeteerInstance: browser, browserExecutable });
for (const frame of frames) {
  const t0 = Date.now();
  await renderStill({
    composition,
    serveUrl,
    output: path.join(outDir, `f${String(frame).padStart(4, "0")}.png`),
    frame,
    scale,
    puppeteerInstance: browser,
    browserExecutable,
  });
  console.log(`frame ${frame} (${(frame / 30).toFixed(2)}s) ${Date.now() - t0}ms`);
}
await browser.close({ silent: true });
