/**
 * Batch-tool probe — real bytes, no mocks.
 *
 * Bundled the same way as the other suites (esbuild + the server-only stub),
 * so it exercises the exact functions /api/tools/run calls: compress() and
 * resizeConvert() from lib/images/local.ts and createZip() from lib/images/zip.ts.
 * Everything it prints is measured from a Buffer, never assumed.
 */
import sharp from "sharp";
import { compress, resizeConvert } from "@/lib/images/local";
import { createZip, outputName } from "@/lib/images/zip";

const svg = (w: number, h: number) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`
  + `<rect width="${w}" height="${h}" fill="#e8e0f0"/>`
  + `<circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 3}" fill="#f800f8"/>`
  + `<rect x="20" y="20" width="${w / 5}" height="${h / 5}" fill="#1b1030"/></svg>`,
);

let failed = 0;
function check(name: string, cond: boolean, note = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${note ? " — " + note : ""}`);
  if (!cond) failed++;
}

(async () => {
  console.log("\nBATCH TOOLS — measured on real buffers");

  const jpg = await sharp(svg(1600, 1200)).jpeg({ quality: 95 }).toBuffer();
  const png = await sharp(svg(1600, 1200)).png().toBuffer();
  const webp = await sharp(svg(1600, 1200)).webp({ quality: 95 }).toBuffer();
  // Already-tiny, already-optimal: re-encoding cannot help.
  const tiny = await sharp(svg(24, 24)).png({ compressionLevel: 9 }).toBuffer();

  console.log("\nA. COMPRESS");
  for (const level of ["light", "balanced", "strong", "auto"] as const) {
    const { output, quality } = await compress(jpg, { level });
    const saved = ((1 - output.length / jpg.length) * 100).toFixed(1);
    check(`jpeg / ${level} never grows the file`, output.length <= jpg.length,
      `${jpg.length} → ${output.length} B (q${quality}, ${saved}% saved)`);
  }
  for (const [name, buf] of [["png", png], ["webp", webp]] as const) {
    const { output } = await compress(buf, { level: "balanced" });
    const meta = await sharp(output).metadata();
    check(`${name} keeps its own format`, meta.format === (name === "png" ? "png" : "webp"),
      `${buf.length} → ${output.length} B, format ${meta.format}`);
  }
  {
    // Already squeezed at q40: asking for "light" (q88) can only make it
    // bigger, which is the case that must return the input untouched.
    const squeezed = await sharp(svg(1600, 1200)).jpeg({ quality: 40 }).toBuffer();
    const { output } = await compress(squeezed, { level: "light" });
    check("a file that cannot shrink is returned untouched",
      output.length === squeezed.length && output.equals(squeezed),
      `${squeezed.length} → ${output.length} B`);
    void tiny;
  }
  {
    const { output } = await compress(png, { level: "balanced", format: "jpeg" });
    const meta = await sharp(output).metadata();
    check("an explicit target format is honoured", meta.format === "jpeg",
      `png ${png.length} B → jpeg ${output.length} B`);
  }

  console.log("\nB. RESIZE");
  {
    const out = await resizeConvert(jpg, { width: 800, height: null, format: "jpeg", quality: 82 });
    const meta = await sharp(out).metadata();
    check("width-only keeps the aspect ratio", meta.width === 800 && meta.height === 600,
      `${meta.width}×${meta.height}`);
  }
  {
    const out = await resizeConvert(jpg, { width: 5000, height: null, format: "jpeg", quality: 82 });
    const meta = await sharp(out).metadata();
    check("never enlarges past the source", (meta.width ?? 0) <= 1600, `${meta.width}×${meta.height}`);
  }
  {
    const out = await resizeConvert(png, { width: 400, height: 400, format: "webp", quality: 80 });
    const meta = await sharp(out).metadata();
    check("an explicit box converts and fits", meta.format === "webp" && meta.width === 400,
      `${meta.width}×${meta.height} ${meta.format}`);
  }

  console.log("\nC. ZIP");
  {
    // Two DIFFERENT photos that happen to share a filename — the collision case.
    const files = [
      { name: outputName("Zdjęcie A.jpg", "grovbase", "image/jpeg", 0), data: new Uint8Array(jpg) },
      { name: outputName("Zdjęcie A.jpg", "grovbase", "image/jpeg", 1), data: new Uint8Array(png) },
      { name: outputName("produkt.png", "grovbase", "image/webp", 2), data: new Uint8Array(webp) },
    ] as Parameters<typeof createZip>[0];
    const blob = createZip(files);
    const zip = Buffer.from(await blob.arrayBuffer());
    // Read the local file headers back out of the archive we just built.
    const names: string[] = [];
    for (let i = 0; i + 30 <= zip.length; i++) {
      if (zip.readUInt32LE(i) !== 0x04034b50) continue;
      const n = zip.readUInt16LE(i + 26);
      names.push(zip.subarray(i + 30, i + 30 + n).toString("utf8"));
    }
    check("every file is in the archive", names.length === 3, JSON.stringify(names));
    check("a duplicate name does not silently overwrite",
      new Set(names).size === names.length, JSON.stringify(names));
    check("the extension follows the produced mime, not the source",
      names.filter((n) => n.endsWith(".webp")).length === 1
      && names.filter((n) => n.endsWith(".jpg")).length === 2, JSON.stringify(names));
    check("the archive carries every byte", zip.length > jpg.length + png.length + webp.length,
      `${zip.length} B for ${jpg.length + png.length + webp.length} B of images`);
    check("it is a real ZIP (end-of-central-directory present)",
      zip.readUInt32LE(zip.length - 22) === 0x06054b50, "");
  }

  console.log(failed === 0 ? "\nAll batch probes passed.\n" : `\n${failed} batch probe(s) FAILED.\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
