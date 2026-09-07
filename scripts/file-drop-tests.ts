/**
 * GLOBAL FILE DROP — the invariants.
 *
 * Half of these are behavioural (the gate sorts files the way each tool needs)
 * and half are structural (every image tool actually mounts the shared system,
 * and nobody kept a private copy of the drag handlers). Both matter: the bug
 * this feature fixes was not "drag is broken", it was "drag works in one place
 * and silently does nothing in five others".
 */
import { readFileSync, existsSync } from "node:fs";
import { acceptFiles, dragCarriesFiles, type IntakeLimits } from "@/lib/images/file-intake";
import { ACCEPTED_MIME, MAX_UPLOAD_BYTES, MAX_BATCH_FILES } from "@/lib/images/tools";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { console.log(`  ok   ${name}`); return; }
  failures += 1;
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

const read = (p: string) => readFileSync(p, "utf8");

/** A File stand-in — Node has no DOM, and the gate only reads three fields. */
const file = (name: string, type: string, size: number) =>
  ({ name, type, size }) as unknown as File;

const BATCH: IntakeLimits = { mime: ACCEPTED_MIME, ext: null, maxBytes: MAX_UPLOAD_BYTES, maxFiles: MAX_BATCH_FILES };
const EDITOR: IntakeLimits = { mime: ["image/png", "image/jpeg", "image/webp"], ext: null, maxBytes: MAX_UPLOAD_BYTES, maxFiles: 1 };
const STRICT: IntakeLimits = { mime: ACCEPTED_MIME, ext: ["jpg", "jpeg", "png", "webp", "avif"], maxBytes: MAX_UPLOAD_BYTES, maxFiles: 200 };

console.log("A. the gate sorts by reason, not just pass/fail");
{
  const r = acceptFiles([
    file("a.jpg", "image/jpeg", 1000),
    file("b.pdf", "application/pdf", 1000),
    file("c.png", "image/png", MAX_UPLOAD_BYTES + 1),
    file("d.webp", "image/webp", 0),
  ], BATCH);
  check("keeps the good one", r.accepted.length === 1 && r.accepted[0].name === "a.jpg");
  check("counts the wrong type", r.badType === 1);
  check("counts oversize AND empty as tooLarge", r.tooLarge === 2, String(r.tooLarge));
  check("nothing overflowed", r.overflow === 0);
}

console.log("B. a folder dragged in is refused, not crashed on");
{
  // A directory arrives as a zero-typed, zero-sized entry.
  const r = acceptFiles([file("Photos", "", 0)], BATCH);
  check("refused as a bad type", r.accepted.length === 0 && r.badType === 1);
}

console.log("C. room is respected, and overflow is its own answer");
{
  const many = Array.from({ length: 10 }, (_, i) => file(`p${i}.jpg`, "image/jpeg", 500));
  const r = acceptFiles(many, BATCH, 4);
  check("takes only what fits", r.accepted.length === 4);
  check("reports the rest as overflow", r.overflow === 6, String(r.overflow));
  check("does not misreport them as rejected", r.badType === 0 && r.tooLarge === 0);
}

console.log("D. a full batch takes nothing");
{
  const r = acceptFiles([file("p.jpg", "image/jpeg", 500)], BATCH, 0);
  check("no room, no files", r.accepted.length === 0 && r.overflow === 1);
}

console.log("E. per-tool limits genuinely differ");
{
  const avif = [file("x.avif", "image/avif", 1000)];
  check("batch tools take AVIF", acceptFiles(avif, BATCH).accepted.length === 1);
  check("the editor does not", acceptFiles(avif, EDITOR).accepted.length === 0);
  check("the editor takes one file only", acceptFiles(
    [file("a.jpg", "image/jpeg", 10), file("b.jpg", "image/jpeg", 10)], EDITOR).accepted.length === 1);
}

console.log("F. extension is checked only where the tool asks for it");
{
  // An image MIME with a mismatched extension — refused by the strict tools.
  const sneaky = [file("photo.jpg.txt", "image/jpeg", 1000)];
  check("strict tool refuses", acceptFiles(sneaky, STRICT).accepted.length === 0);
  check("lenient tool accepts", acceptFiles(sneaky, BATCH).accepted.length === 1);
  check("uppercase extension still passes", acceptFiles(
    [file("PHOTO.JPG", "image/jpeg", 1000)], STRICT).accepted.length === 1);
}

console.log("G. the overlay only reacts to real files");
{
  const drag = (types: string[]) =>
    ({ dataTransfer: { types } }) as unknown as DragEvent;
  check("external file drag", dragCarriesFiles(drag(["Files"])) === true);
  check("internal element drag", dragCarriesFiles(drag(["text/plain"])) === false);
  check("text selection drag", dragCarriesFiles(drag(["text/html", "text/plain"])) === false);
  check("a drag with no dataTransfer", dragCarriesFiles({} as DragEvent) === false);
}

console.log("H. every image tool mounts the shared system");
const TOOLS = [
  "components/editor/image-editor.tsx",
  "components/tools/resize-workbench.tsx",
  "components/tools/compress-workbench.tsx",
  "components/tools/workbench.tsx",
  "components/retouch/workspace.tsx",
  "components/genv3/workspace.tsx",
];
for (const path of TOOLS) {
  const src = read(path);
  const mounts = /use(Shared)?FileDrop|useImageDrop|useFileDrop/.test(src);
  const shows = /FileDropOverlay|DropOverlay/.test(src);
  check(`${path} mounts a drop hook`, mounts);
  check(`${path} shows an overlay`, shows);
}

console.log("I. nobody kept a private copy of the drag handlers");
{
  // The whole point of the shared module: an element-scoped onDrop that calls
  // preventDefault by hand is how the five tools drifted apart the first time.
  const offenders: string[] = [];
  for (const path of TOOLS) {
    const src = read(path);
    if (/onDrop=\{\(e[^)]*\) => \{[^}]*dataTransfer/.test(src)) offenders.push(path);
    if (/setDragging\(/.test(src)) offenders.push(`${path} (local dragging state)`);
  }
  check("no hand-rolled element drop handlers", offenders.length === 0, offenders.join(", "));
}

console.log("J. one implementation, not six");
{
  check("the shared hook exists", existsSync("components/ui/file-drop.tsx"));
  check("the shared gate exists", existsSync("lib/images/file-intake.ts"));
  const shared = read("components/ui/file-drop.tsx");
  check("dragover is prevented (or there is no drop at all)",
    /const onOver[\s\S]*?event\.preventDefault\(\)/.test(shared));
  check("enter/leave are counted, not toggled",
    /depth\.current \+= 1/.test(shared) && /depth\.current = Math\.max\(0, depth\.current - 1\)/.test(shared));
  check("drop is prevented so the browser cannot navigate",
    /const onDrop[\s\S]*?event\.preventDefault\(\)/.test(shared));
  check("a drag ending elsewhere clears the overlay",
    /addEventListener\("dragend", reset\)/.test(shared) && /addEventListener\("blur", reset\)/.test(shared));
  // The generator's uploader must be an adapter now, not a second copy.
  const gen = read("components/genv3/uploader.tsx");
  check("the generator delegates to the shared hook", /useSharedFileDrop/.test(gen));
  check("the generator no longer owns a window listener",
    !/window\.addEventListener\("dragenter"/.test(gen));
}

console.log("K. click and drop cannot drift apart");
{
  // Each tool's picker `accept` must come from the same object its drop
  // validates against — a hardcoded accept string is how they separate.
  const editor = read("components/editor/image-editor.tsx");
  check("editor picker reads its limits object",
    /accept=\{EDITOR_LIMITS\.mime\.join\(","\)\}/.test(editor));
  check("editor validates through the shared gate", /acceptFiles\(files, EDITOR_LIMITS/.test(editor));
  for (const path of ["components/tools/resize-workbench.tsx", "components/tools/compress-workbench.tsx"]) {
    const src = read(path);
    check(`${path} validates through the shared gate`, /acceptFiles\(files, [A-Z_]+_LIMITS/.test(src));
  }
  check("workbench validates through the shared gate",
    /acceptFiles\(files, BATCH_LIMITS/.test(read("components/tools/workbench.tsx")));
}

console.log("L. the copy each tool shows is its own");
{
  const pl = JSON.parse(read("lib/i18n/dictionaries/pl.json")) as { tools: Record<string, string> };
  check("batch tools have their own title", typeof pl.tools.dropManyTitle === "string");
  check("compression has its own title", typeof pl.tools.dropCompressTitle === "string");
  check("compression copy names compression",
    /kompres/i.test(pl.tools.dropCompressTitle ?? ""), pl.tools.dropCompressTitle);
  for (const lang of ["en", "de"]) {
    const d = JSON.parse(read(`lib/i18n/dictionaries/${lang}.json`)) as { tools: Record<string, string> };
    check(`${lang} has both titles`,
      typeof d.tools.dropManyTitle === "string" && typeof d.tools.dropCompressTitle === "string");
  }
}

console.log(failures === 0 ? "\nAll file-drop tests passed." : `\n${failures} file-drop test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
