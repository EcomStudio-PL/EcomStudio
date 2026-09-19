/**
 * NEXT'S IMAGE OPTIMISER MUST NOT DISARM OUR OWN IMAGE TOOLS.
 *
 * WHAT THIS GUARDS, AND WHY IT IS NOT OBVIOUS.
 *
 * Next 15.5.24 fixed a critical AVIF advisory (GHSA-2xp9-vwfh-vxw4) by calling
 * `sharp.block({ operation: ["VipsForeignLoad"] })` the first time it
 * optimises an image, then unblocking six loaders — JPEG, GIF, PNG, SVG, TIFF,
 * WebP. HEIF/AVIF is deliberately not among them.
 *
 * That block is PROCESS-GLOBAL state on the sharp MODULE, not something scoped
 * to Next's own use of it. Whether it reaches US therefore depends on whether
 * Next and this application hold the SAME copy of sharp — and that changed
 * underneath us, silently, in the same release:
 *
 *   15.5.23  next optionalDependencies.sharp = "^0.34.3"
 *            We depend on ^0.35.4. The ranges are disjoint, so npm nests a
 *            private node_modules/next/node_modules/sharp@0.34.5 for Next.
 *            Two copies, two libvips (8.17.3 vs our 8.18.6). Isolated.
 *   15.5.24  the range widens to "^0.34.3 || ^0.35.3" — our 0.35.4 now
 *            satisfies it, npm DE-NESTS, and Next starts using OUR sharp.
 *            The block lands on the instance this product uploads with, and
 *            15.5.24 has nothing that ever unblocks HEIF again.
 *   15.5.25  same shared copy, but it adds `isAvifDecodeSafe()` and
 *            re-unblocks VipsForeignLoadHeif when libheif is at least 1.23.2.
 *
 * All three were run, not reasoned about. Against a real 15.5.24 install this
 * file fails with "Input buffer contains unsupported image format" on AVIF
 * while PNG, JPEG and WebP stay green. AVIF *encoding* still works either way
 * — only loading is blocked, which is why a naive smoke test would miss it.
 *
 * THAT WOULD BE A REAL, USER-VISIBLE REGRESSION HERE. `image/avif` is an
 * accepted upload type across the product — lib/images/tools.ts ACCEPTED_MIME,
 * lib/services/images.ts ALLOWED_MIME, the generator uploader, Retusz, the
 * Moda tools, the media manager, the resize workbench and the zip importer.
 * A seller uploading an AVIF would be told their file is unsupported.
 *
 * AND IT WOULD BE INTERMITTENT, which is worse. The block only lands once
 * /_next/image has optimised something in that serverless instance, so a cold
 * smoke test passes and production fails later, for some users, on some
 * instances.
 *
 * 15.5.25 is the version that closes the advisory WITHOUT that cost: it adds
 * `isAvifDecodeSafe()` and re-unblocks `VipsForeignLoadHeif` when libheif is
 * at least 1.23.2 — the release that fixed the underlying libheif bug. This
 * deployment ships exactly 1.23.2, so the gate opens.
 *
 * Both halves of that are pinned below, because either one changing silently
 * breaks uploads: the libheif floor, and the actual end-to-end behaviour after
 * Next's own getSharp() has run.
 *
 * Run: npm run test:imagepipeline
 */
import sharp from "sharp";
import { ACCEPTED_MIME } from "../lib/images/tools";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

/** The same predicate Next uses, kept here so a libheif downgrade is caught
 *  as a libheif problem rather than as a mysterious upload failure. */
function isAvifDecodeSafe(heifVersion: string | null): boolean {
  if (!heifVersion) return false;
  const [major, minor, patch] = heifVersion.split(".").map((p) => Number.parseInt(p, 10));
  if ([major, minor, patch].some((n) => Number.isNaN(n))) return false;
  return major! > 1 || (major === 1 && minor! > 23) || (major === 1 && minor === 23 && patch! >= 2);
}

async function main() {
  console.log("A. AVIF IS A FORMAT THIS PRODUCT PROMISES TO ACCEPT");
  check("avif is in the accepted upload types", ACCEPTED_MIME.includes("image/avif"),
    "if this ever stops being true, the rest of this file can be deleted");

  console.log("\nB. THE LIBHEIF FLOOR NEXT GATES ON");
  // The predicate first, or a copy that degenerated into `return true` would
  // keep this section green while the real gate below stayed shut.
  check("the floor predicate rejects the version that carries the bug (1.23.1)",
    !isAvifDecodeSafe("1.23.1"));
  check("and rejects everything older", !isAvifDecodeSafe("1.22.9") && !isAvifDecodeSafe("0.99.99"));
  check("and accepts 1.23.2 and later", isAvifDecodeSafe("1.23.2") && isAvifDecodeSafe("1.24.0") && isAvifDecodeSafe("2.0.0"));
  check("and refuses to guess when the version is absent or junk",
    !isAvifDecodeSafe(null) && !isAvifDecodeSafe("") && !isAvifDecodeSafe("not.a.version"));

  const heif = sharp.versions.heif ?? null;
  check("sharp reports a libheif version", Boolean(heif), String(heif));
  check(`libheif ${heif} is at or above the 1.23.2 Next requires to allow AVIF`,
    isAvifDecodeSafe(heif),
    "below this Next keeps AVIF blocked and every AVIF upload starts failing");

  console.log("\nC. AFTER NEXT'S OWN OPTIMISER HAS TOUCHED SHARP");
  const avif = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#f00" } })
    .avif().toBuffer();

  const beforeFormat = await sharp(avif).metadata().then((m) => m.format).catch((e) => `REFUSED: ${e.message}`);
  check("we can decode avif before Next is involved", beforeFormat === "heif", String(beforeFormat));

  // THE LOAD-BEARING LINE. This is Next's real getSharp(), not a simulation:
  // it applies the block/unblock pair to the shared module exactly as a live
  // /_next/image request would.
  const optimizer = await import("next/dist/server/image-optimizer.js") as unknown as {
    getSharp: (concurrency?: number) => typeof sharp;
    canDecodeAvif?: (concurrency?: number) => boolean;
  };
  const nextSharp = optimizer.getSharp(1);

  /*
    THIS HARNESS IS BUILT AS COMMONJS ON PURPOSE, and the assertion below is
    why. sharp 0.35.4 declares an exports map with two SEPARATE bundles —
    dist/index.cjs for `require` and dist/index.mjs for `import` — so a Node
    ESM harness holds a different JS copy of sharp than Next's optimiser
    (which requires it) and this check reports "not shared" even though
    production shares it perfectly well. Measured: under ESM the two function
    objects differ; under CJS they are identical, and that is what the Next
    server bundle actually does with serverExternalPackages: ["sharp"].

    So an ESM build of this file would fail for a reason that has nothing to
    do with the product. Keep it CJS — see test:imagepipeline in package.json.
  */
  check("Next and the application share ONE sharp module",
    (nextSharp as unknown) === (sharp as unknown),
    "if these ever differ the global block stops mattering — and so does this test");

  if (typeof optimizer.canDecodeAvif === "function") {
    check("Next itself decided AVIF decoding is safe here", optimizer.canDecodeAvif(1),
      "this is the isAvifDecodeSafe gate added in 15.5.25; on 15.5.24 it does not exist and AVIF stays blocked");
  } else {
    check("Next exposes the AVIF safety gate", false,
      "no canDecodeAvif export — this Next predates 15.5.25 and blocks AVIF decoding process-wide");
  }

  const afterFormat = await sharp(avif).metadata().then((m) => m.format).catch((e) => `REFUSED: ${e.message}`);
  check("AND WE CAN STILL DECODE AVIF AFTERWARDS", afterFormat === "heif", String(afterFormat));

  // The other five formats must be unaffected in both directions — a blanket
  // unblock would be a different way to pass this file and a worse one.
  for (const [label, buf] of [
    ["png", await sharp({ create: { width: 8, height: 8, channels: 3, background: "#0f0" } }).png().toBuffer()],
    ["jpeg", await sharp({ create: { width: 8, height: 8, channels: 3, background: "#00f" } }).jpeg().toBuffer()],
    ["webp", await sharp({ create: { width: 8, height: 8, channels: 3, background: "#ff0" } }).webp().toBuffer()],
  ] as const) {
    const fmt = await sharp(buf).metadata().then((m) => m.format).catch((e) => `REFUSED: ${e.message}`);
    check(`${label} still decodes`, fmt === label, String(fmt));
  }

  console.log(failures === 0 ? "\nAll image pipeline tests passed." : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("image pipeline tests crashed:", e); process.exit(1); });
