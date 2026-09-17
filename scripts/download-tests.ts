/**
 * "POBIERZ" — one implementation, and never a trip to the storage host.
 *
 * The bug this guards: some buttons were `<a href={signedStorageUrl} download>`.
 * Desktop browsers honour `download` and save the file; Safari on iOS ignores
 * it for a cross-origin URL and NAVIGATES — so the customer left GrovBase and
 * landed on `…supabase.co` looking at their own photo. The screenshot that
 * reported it showed exactly that.
 *
 * These checks are about SHAPE, not pixels: that every save goes through
 * `lib/save-image`, and that no component reintroduces an anchor, a
 * `window.open` or a `location.href` pointed at a storage URL.
 *
 * Run: npm run test:download
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

/** Comments quote the code they replaced; they are documentation, not code. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const helper = readFileSync("lib/save-image.ts", "utf8");
const componentFiles = walk("components");
const sources = new Map(componentFiles.map((f) => [f, stripComments(readFileSync(f, "utf8"))]));

console.log("A. THE HELPER DOES WHAT THE BRIEF ASKS");
check("it prefers the native share sheet on a touch device",
  /navigator\.share\(/.test(helper) && /canShare/.test(helper));
check("it shares a real File with a name and a type",
  /new File\(\[blob\], filename, \{ type: blob\.type/.test(helper));
check("it falls back to an object-URL anchor",
  /createObjectURL/.test(helper) && /a\.download = filename/.test(helper));
check("the anchor is attached before it is clicked (Firefox ignores detached ones)",
  /document\.body\.appendChild\(a\)/.test(helper));
check("the object URL is revoked, but not in the same tick",
  /setTimeout\(\(\) => URL\.revokeObjectURL/.test(helper));
check("a dismissed share sheet is reported as cancelled, not as an error",
  /AbortError/.test(helper) && /return "cancelled"/.test(helper));
check("a lapsed user gesture still saves rather than failing",
  /NotAllowedError/.test(helper));
check("iPadOS is treated as a touch device despite its desktop user agent",
  /maxTouchPoints/.test(helper));
check("the helper itself never opens a URL",
  !/window\.open/.test(helper) && !/location\.href\s*=/.test(helper));
check("filenames are readable, not storage ids",
  /grovbase/.test(helper) && /fileNameFor/.test(helper));
check("the extension follows the real MIME type", /export function extOf/.test(helper));

console.log("\nB. NO COMPONENT SENDS ANYONE TO THE STORAGE HOST");
const offenders: string[] = [];
for (const [file, src] of sources) {
  // An anchor whose href is a URL-bearing expression AND carries `download`
  // is the exact pattern that navigates on iOS.
  if (/<a[^>]*href=\{[^}]*\b(url|item\.url|signedUrl)\b[^}]*\}[^>]*download/.test(src)) offenders.push(`${file}: download anchor`);
  if (/window\.open\(/.test(src)) offenders.push(`${file}: window.open`);
  if (/location\.href\s*=\s*[^;]*url/i.test(src)) offenders.push(`${file}: location.href`);
}
check("no download anchor, window.open or location.href on a storage URL",
  offenders.length === 0, offenders.join("; "));

// The old escape hatch: "if the fetch failed, at least open the image".
check("no component falls back to opening the image",
  ![...sources.values()].some((s) => /catch[\s\S]{0,120}window\.open/.test(s)));

console.log("\nC. EVERY SAVE GOES THROUGH THE ONE HELPER");
// Any component that builds its own anchor download is a second implementation.
const rogue = [...sources.entries()]
  .filter(([, s]) => /\.download\s*=/.test(s))
  .map(([f]) => f);
check("no component builds its own download anchor", rogue.length === 0, rogue.join(", "));

const expected = [
  "components/genv3/gallery.tsx",
  "components/genv3/image-details.tsx",
  "components/library/library-browser.tsx",
  "components/prompts/concept-board.tsx",
  "components/editor/image-editor.tsx",
  "components/tools/workbench.tsx",
  "components/tools/resize-workbench.tsx",
  "components/tools/compress-workbench.tsx",
  "components/admin/waitlist-manager.tsx",
];
for (const file of expected) {
  check(`${file.replace("components/", "")} uses the helper`,
    (sources.get(file) ?? "").includes("@/lib/save-image"));
}

console.log("\nD. A FAILURE SAYS SO, IN EVERY LANGUAGE");
for (const loc of ["pl", "en", "de"]) {
  const dict = JSON.parse(readFileSync(`lib/i18n/dictionaries/${loc}.json`, "utf8")) as
    { genv3?: Record<string, string> };
  check(`${loc}: the download failure message exists`, !!dict.genv3?.downloadFailed);
}

console.log(failures === 0 ? "\nAll download tests passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
