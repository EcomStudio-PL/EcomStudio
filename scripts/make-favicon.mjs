/**
 * THE TAB ICON, CUT FROM THE OFFICIAL MASTER — NEVER REDRAWN.
 *
 * `public/brand/app-icon.png` is the square gradient app icon the designer
 * supplied, and `components/layout/brand.tsx` already names it as the source
 * for the favicon and the PWA. This script is the only thing that turns it
 * into the sizes a browser tab asks for, so the provenance of every icon in
 * the product is one file and one downscale — no hand-drawn substitute, no
 * recolouring, no stretched logo.
 *
 * WHY AN .ICO AT ALL, in 2026: a browser asks for `/favicon.ico` by itself,
 * before it has parsed a single `<link>`, and so do bookmark managers, feed
 * readers and link unfurlers. Ours answered 404 — measured, not assumed. The
 * `.ico` carries 16, 32 and 48 so the browser picks the one it needs rather
 * than downscaling a 512px PNG into mush.
 *
 * The ICO container holds PNG frames, which every browser released this
 * century reads, and which keeps the file at a few kilobytes instead of the
 * ~229KB the 512px master weighs.
 *
 *   node scripts/make-favicon.mjs
 */
import fs from "node:fs";
import sharp from "sharp";

const MASTER = "public/brand/app-icon.png";
const ICO_SIZES = [16, 32, 48];

/** ICO = a 6-byte header, one 16-byte directory entry per frame, then the
 *  frames themselves. A size of 256 is written as 0 by the format's own
 *  convention; nothing here is that big, but the rule is cheap to honour. */
function ico(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);            // reserved
  header.writeUInt16LE(1, 2);            // 1 = icon
  header.writeUInt16LE(frames.length, 4);

  const dir = Buffer.alloc(16 * frames.length);
  let offset = header.length + dir.length;
  frames.forEach((f, i) => {
    const at = i * 16;
    dir.writeUInt8(f.size >= 256 ? 0 : f.size, at);
    dir.writeUInt8(f.size >= 256 ? 0 : f.size, at + 1);
    dir.writeUInt8(0, at + 2);           // palette size — none, it is PNG
    dir.writeUInt8(0, at + 3);           // reserved
    dir.writeUInt16LE(1, at + 4);        // colour planes
    dir.writeUInt16LE(32, at + 6);       // bits per pixel
    dir.writeUInt32LE(f.data.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += f.data.length;
  });

  return Buffer.concat([header, dir, ...frames.map((f) => f.data)]);
}

const png = (size) => sharp(MASTER)
  // The master is square and so is every target, so this only ever resamples —
  // it never crops and never stretches the mark.
  .resize(size, size, { fit: "cover" })
  .png({ compressionLevel: 9 })
  .toBuffer();

const meta = await sharp(MASTER).metadata();
if (meta.width !== meta.height) {
  throw new Error(`${MASTER} is ${meta.width}x${meta.height} — the favicon master must be square`);
}

fs.writeFileSync("public/icons/icon-16.png", await png(16));
fs.writeFileSync("public/icons/icon-32.png", await png(32));
fs.writeFileSync(
  "public/favicon.ico",
  ico(await Promise.all(ICO_SIZES.map(async (size) => ({ size, data: await png(size) })))),
);

for (const f of ["public/icons/icon-16.png", "public/icons/icon-32.png", "public/favicon.ico"]) {
  console.log(`${f.padEnd(28)} ${fs.statSync(f).size} B`);
}
