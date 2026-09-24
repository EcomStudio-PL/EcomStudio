/**
 * A TILE MUST NEVER DOWNLOAD THE ORIGINAL.
 *
 * WHAT THIS EXISTS TO CATCH, in the exact shape it happened.
 *
 * On 2026-09-20 the home page pulled 12 MB to paint six ~100px pictures and a
 * category page pulled 22 MB to paint twelve. The derivatives existed the whole
 * time — a 640px WebP averaging 22 kB sits next to every 2040 kB original — and
 * lib/server/gallery.ts had been using them correctly for the Library grid.
 *
 * The defect was ONE MISSING COLUMN. lib/services/generator.ts::listAssets
 * selected `generation_assets(id, storage_path)` under a comment asserting that
 * per-asset metadata is "never read by any gallery". True when written, false
 * once `metadata.thumb` became where the thumbnail path lives. With the column
 * absent, both callers had nothing but the original to sign — so they signed it.
 *
 * Measured on production, admin workspace:
 *   /home       6 tiles   12 MB -> 159 kB   (-98.7%)
 *   /k/[cat]   12 tiles   22 MB -> 273 kB   (-98.8%)
 *   worst single tile     1932 kB PNG -> 9312 B WebP   (212x)
 *
 * Nothing would have failed. Typecheck passed, the build passed, every test
 * passed, the page rendered correctly — just two orders of magnitude too slowly.
 * A select list is not the kind of thing a type checker has an opinion about.
 *
 * SO THIS GUARD IS ABOUT DATA FLOW, NOT TYPES: for every surface that paints a
 * small tile from a private Storage object, the thumbnail path must be able to
 * REACH the call that signs it. Two things have to hold, and one without the
 * other is useless:
 *
 *   1. the projection that feeds the surface must SELECT metadata, and
 *   2. the surface must PREFER metadata.thumb over storage_path.
 *
 * Deleting either one reproduces the outage, so both are asserted per surface.
 *
 * Run: npm run test:tilebytes
 */
import { readFileSync } from "fs";
import { THUMB_EDGE, THUMB_QUALITY, thumbPathFor, previewPathFor } from "../lib/thumbs";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const read = (p: string) => readFileSync(p, "utf8");

/*
  COMMENTS ARE NOT CODE, AND THIS GUARD LEARNED THAT THE HARD WAY.

  Section B first asked whether the file "mentions .thumb". Mutation-testing it
  — replacing the real `metadata.thumb ?? storage_path` in home/page.tsx with a
  bare `storage_path` — left that assertion GREEN, because the explanatory
  comment above the code still contained the words `metadata.thumb`. The guard
  would have passed while the page shipped 12 MB again.

  So every source check below runs against the file with comments stripped. A
  guard that can be satisfied by prose is not a guard.
*/
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")   // block comments, including JSDoc
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1"); // line comments, not :// in URLs
}

/*
  THE REGISTRY IS THE POINT.

  Every surface that signs a generation-assets path and renders it as a tile is
  named here explicitly. A new gallery that forgets thumbnails does not silently
  inherit a pass — it is simply absent, and section D fails because the file it
  lives in calls createSignedUrls without being listed.

  `feeds` is the projection the surface reads through. It must carry metadata,
  or the surface cannot know a derivative exists no matter how it is written.
*/
type Surface = {
  label: string;
  file: string;
  /** Where the rows come from; must select metadata. */
  feeds: string;
  /** Roughly how wide the painted tile is, for the ratio note. */
  cssPx: number;
};

const SURFACES: readonly Surface[] = [
  {
    label: "/home — recent work tiles",
    file: "app/(app)/home/page.tsx",
    feeds: "lib/services/generator.ts",
    cssPx: 100,
  },
  // "/k/[cat] — workflow card previews" was the third surface. That page now
  // forwards to the category's section of /tools, whose cards draw the tool's
  // motif or an admin's picture — nothing of the account's own work — so it
  // no longer signs anything and is not a tile surface any more.
  {
    label: "Library grid",
    file: "lib/server/gallery.ts",
    feeds: "lib/server/gallery.ts",
    cssPx: 320,
  },
];

async function main() {
  console.log("A. THE DERIVATIVE CONTRACT ITSELF");
  {
    // If these ever drift, every ratio below is measuring something else.
    check(`grid thumbnails are ${THUMB_EDGE}px`, THUMB_EDGE === 640, String(THUMB_EDGE));
    check("and encoded well below lossless", THUMB_QUALITY <= 80, String(THUMB_QUALITY));
    check("a thumbnail path is derived, not guessed at random",
      thumbPathFor("ws/job/0.png") === "ws/job/0_t.webp", thumbPathFor("ws/job/0.png"));
    check("and the preview is a different object",
      previewPathFor("ws/job/0.png") !== thumbPathFor("ws/job/0.png"));
    // A tile is at most ~320 CSS px; 640 covers 2x. More than that and we are
    // shipping pixels no screen asks for.
    const widest = Math.max(...SURFACES.map((s) => s.cssPx));
    check(`${THUMB_EDGE}px still covers the widest tile (${widest} CSS px) at 2x`,
      THUMB_EDGE >= widest * 2 && THUMB_EDGE <= widest * 4,
      `widest=${widest} thumb=${THUMB_EDGE}`);
  }

  console.log("\nB. EVERY TILE SURFACE CAN SEE THE DERIVATIVE");
  console.log("   (this is the assertion the 2026-09-20 regression failed)");
  for (const s of SURFACES) {
    const src = codeOnly(read(s.file));
    const feed = codeOnly(read(s.feeds));

    // 1 — the projection must carry metadata to the surface.
    const selects = feed.match(/generation_assets\s*\(([^)]*)\)/);
    check(`${s.label}: its projection selects metadata`,
      Boolean(selects && /\bmetadata\b/.test(selects[1]!)),
      selects ? `generation_assets(${selects[1]!.trim()})` : "no generation_assets(...) projection found");

    // 2 — and the surface must actually prefer it.
    check(`${s.label}: prefers metadata.thumb over storage_path`,
      /\.thumb\b/.test(src),
      "the file never mentions .thumb, so it can only be signing the original");

    // 3 — and must still fall back, or assets without a derivative 404.
    check(`${s.label}: falls back to the original when there is no thumb`,
      /\?\?\s*\w*\.?storage_path|\|\|\s*url\b|\bthumb\s*&&/.test(src),
      "a missing derivative must degrade to the original, not to a broken image");
  }

  console.log("\nC. THE ORIGINAL IS STILL REACHABLE WHERE IT SHOULD BE");
  {
    // Optimising delivery must not cost anyone their file. The Library still
    // hands over the full-resolution object for download and for the lightbox.
    const gallery = codeOnly(read("lib/server/gallery.ts"));
    check("the gallery still exposes the untouched original",
      /url:\s*url\b/.test(gallery) || /\burl,\s*$/m.test(gallery),
      "GalleryItem.url must remain the original signed URL");
    check("and a separate preview for the lightbox",
      /previewUrl/.test(gallery));
    const zip = codeOnly(read("app/api/library/zip/route.ts"));
    check("download/zip serves originals, never derivatives",
      !/thumbPathFor|_t\.webp/.test(zip),
      "a download that hands over a 22 kB thumbnail is a bug in the other direction");
  }

  console.log("\nD. NO UNREGISTERED SURFACE SIGNS TILES BEHIND OUR BACK");
  {
    /*
      The registry above is only as good as its completeness. This walks every
      file that signs generation-assets paths and requires it to be either a
      listed tile surface or an explicitly acknowledged non-tile use. A brand
      new gallery lands here as a failure, which is the intent: it is a
      five-second edit to add it to SURFACES, and the edit forces whoever makes
      it to answer the thumbnail question.
    */
    const NON_TILE = new Set<string>([
      // Single full image by design, no grid.
      "app/(app)/tools/editor/page.tsx",
      // Hands over originals on purpose.
      "app/api/library/zip/route.ts",
      // Writes derivatives; signs what it just made.
      "app/api/library/thumb/route.ts",
      // The generator's own result strip signs what it just produced.
      "lib/server/generation.ts",
      // Prompt detail shows result images at full width.
      "app/(app)/prompts/[id]/page.tsx",
      // Library tool-results shelf: separate table (tool_results), tracked
      // separately. 1 row and 20 kB on production today; the writer does not
      // yet produce a derivative because tool_results has no UPDATE policy,
      // so the path must be known at INSERT time.
      "app/(app)/library/page.tsx",
      // Generic helper, not a surface.
      "lib/services/images.ts",
    ]);
    const listed = new Set(SURFACES.map((s) => s.file));

    const { execSync } = await import("child_process");
    const out = execSync(
      "grep -rl 'createSignedUrls\\|createSignedUrl' app lib --include=*.ts --include=*.tsx || true",
      { encoding: "utf8" },
    );
    const signers = out.split("\n").map((l) => l.trim()).filter(Boolean);
    check("something in the repo signs storage URLs at all", signers.length > 0,
      "if this is 0 the grep is broken and every check below is vacuous");

    const unaccounted = signers.filter((f) => !listed.has(f) && !NON_TILE.has(f));
    check("every signing site is either a registered tile surface or a declared non-tile use",
      unaccounted.length === 0,
      unaccounted.length
        ? `unregistered: ${unaccounted.join(", ")} — add to SURFACES (and use metadata.thumb) or to NON_TILE with a reason`
        : undefined);

    // And the registry may not rot the other way either.
    const stale = [...listed].filter((f) => !signers.includes(f));
    check("no registered surface has stopped signing (stale registry)",
      stale.length === 0, stale.join(", "));
  }

  console.log(failures === 0
    ? "\nAll tile byte tests passed."
    : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("tile byte tests crashed:", e); process.exit(1); });
