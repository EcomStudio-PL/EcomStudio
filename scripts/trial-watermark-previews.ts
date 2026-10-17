/**
 * TRIAL WATERMARK PREVIEWS — the real mechanism on real files, nothing else.
 *
 *   npm run trialwm:previews -- <out-dir> <image> [<image> …]
 *
 * Every input goes through `applyTrialWatermark` with the DEFAULT config (the
 * same function the producers call, the same asset, the same adaptive colour
 * choice). For each input it writes `<name>.wm.<ext>` next to a JSON line of
 * the values used (variant, luminance, scale, opacity, glow), and then a
 * labelled board of all of them (`board.png`). No AI call, no network, no
 * database: a local tool for approving the look before anything is enabled.
 */
import sharp from "sharp";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { applyTrialWatermark } from "@/lib/server/trial-watermark/engine";
import { TRIAL_WATERMARK_DEFAULTS } from "@/lib/trial-watermark/config";

const [out, ...inputs] = process.argv.slice(2);
if (!out || inputs.length === 0) {
  console.error("usage: trialwm:previews -- <out-dir> <image> [<image> …]");
  process.exit(2);
}

const CELL = 900;
const LABEL = 120;

function label(lines: string[], width: number): Buffer {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const text = lines.map((l, i) =>
    `<text x="16" y="${34 + i * 28}" font-family="DejaVu Sans" font-size="${i === 0 ? 22 : 18}" font-weight="${i === 0 ? 700 : 400}" fill="#1b1b1b">${esc(l)}</text>`).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${LABEL}"><rect width="100%" height="100%" fill="#f4f4f4"/>${text}</svg>`);
}

(async () => {
  mkdirSync(out, { recursive: true });
  const cells: Buffer[] = [];
  const report: Record<string, unknown>[] = [];
  for (const file of inputs) {
    const src = readFileSync(file);
    const r = await applyTrialWatermark(src, TRIAL_WATERMARK_DEFAULTS);
    const ext = r.mime === "image/jpeg" ? "jpg" : r.mime === "image/webp" ? "webp" : "png";
    const name = path.basename(file).replace(/\.[^.]+$/, "");
    writeFileSync(path.join(out, `${name}.wm.${ext}`), r.bytes);
    const row = { file: path.basename(file), output: `${name}.wm.${ext}`, ...r.info };
    report.push(row);
    console.log(JSON.stringify(row));
    const pic = await sharp(r.bytes).resize(CELL, CELL, { fit: "contain", background: "#bdbdbd" }).png().toBuffer();
    const lab = label([
      `${path.basename(file)} — ${r.info.width}×${r.info.height}`,
      `wariant: ${r.info.variant === "dark" ? "ciemny #111111" : "jasny (biały)"} · jasność tła ${r.info.luminance} (próg ${r.info.threshold})`,
      `znak ${r.info.markWidth}×${r.info.markHeight} px (skala ${r.info.scale}) · krycie ${r.info.opacity} · poświata ${r.info.glowRadiusPx}px / ${r.info.glowOpacity}`,
    ], CELL);
    cells.push(await sharp({ create: { width: CELL, height: CELL + LABEL, channels: 3, background: "#ffffff" } })
      .composite([{ input: pic, left: 0, top: 0 }, { input: lab, left: 0, top: CELL }]).png().toBuffer());
  }
  const cols = cells.length >= 4 ? 2 : cells.length;
  const rows = Math.ceil(cells.length / cols);
  const gap = 12;
  await sharp({ create: { width: cols * CELL + (cols + 1) * gap, height: rows * (CELL + LABEL) + (rows + 1) * gap, channels: 3, background: "#7a7a7a" } })
    .composite(cells.map((c, i) => ({ input: c, left: gap + (i % cols) * (CELL + gap), top: gap + Math.floor(i / cols) * (CELL + LABEL + gap) })))
    .png().toFile(path.join(out, "board.png"));
  writeFileSync(path.join(out, "values.json"), JSON.stringify(report, null, 2));
})().catch((e) => {
  console.error("previews failed:", e);
  process.exit(1);
});
