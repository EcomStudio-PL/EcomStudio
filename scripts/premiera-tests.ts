/**
 * PREMIERA — the rules this release added, held without a browser or a paid call.
 *
 *   A  prompt privacy: what a customer may read of a generation's prompt
 *      (customerPrompt / promptOrigin) and that every server projection uses it
 *   B  Miniaturka: retouched photos used again — the merge rule (same position,
 *      unrelated photos kept, the rest appended, no duplicates, the limit) and
 *      the hand-over (taken once, stale or forged offers refused)
 *   C  …and the server: a `retouched:<job>` reference is resolved by the server
 *      against the workspace's own Retusz job, never trusted from the browser
 *   D  the image preview: one switch hides the smart actions, on the server too
 *   E  Packshot: the 301, the separate old tool, the Miniaturka wording
 *
 * Run: npm run test:premiera
 */
import fs from "node:fs";
import { customerPrompt, promptOrigin } from "@/lib/generation-prompt";
import {
  RETOUCHED_EVENT, mergeRetouched, offerRetouched, retouchedJobId, retouchedRef, takeRetouched,
  type FormPhoto, type RetouchedPhoto,
} from "@/lib/thumbnail/reuse";
import pl from "@/lib/i18n/dictionaries/pl.json";
import en from "@/lib/i18n/dictionaries/en.json";
import de from "@/lib/i18n/dictionaries/de.json";
import { makeT } from "@/lib/i18n/t";

let failed = 0;
function check(name: string, ok: boolean, detail: unknown = "") {
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok || detail === "" ? "" : `\n       ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}
const read = (f: string) => fs.readFileSync(f, "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ── A ─────────────────────────────────────────────────────────────────── */
console.log("A. prompt privacy");
{
  check("„Stwórz zdjęcie” (origin custom): the customer's own text, exactly",
    customerPrompt({ prompt_origin: "custom", prompt_text: "Kubek na drewnianym stole" }) === "Kubek na drewnianym stole");
  check("…without the AVOID line the app appends from the negative field",
    customerPrompt({ prompt_origin: "custom", prompt_text: "Kubek\nAVOID: tekst, logo", settings: { negative: "tekst, logo" } }) === "Kubek");
  check("…a line that merely looks like it stays (it is not the app's suffix)",
    customerPrompt({ prompt_origin: "custom", prompt_text: "Kubek\nAVOID: coś innego", settings: { negative: "tekst" } }) === "Kubek\nAVOID: coś innego");
  check("GrovShot / Miniaturka / Packshot (origin ecomstudio): nothing",
    customerPrompt({ prompt_origin: "ecomstudio", prompt_text: "Professional studio packshot of …" }) === null);
  check("an old row with no origin (engine text stored before origins existed): nothing",
    customerPrompt({ prompt_origin: null, prompt_text: "Professional studio packshot of …" }) === null);
  check("an empty custom prompt is no prompt", customerPrompt({ prompt_origin: "custom", prompt_text: "   " }) === null);
  check("origin: custom → custom, engine or a concept → engine, unknown → null",
    promptOrigin({ prompt_origin: "custom" }) === "custom" && promptOrigin({ prompt_origin: "ecomstudio" }) === "engine"
    && promptOrigin({ prompt_origin: null, prompt_id: "x" }) === "engine" && promptOrigin({ prompt_origin: null }) === null);
  check("the preview's text for an engine shot is „Ujęcie zaprojektowane przez GrovBase.”",
    (pl as { genv3: { noPrompt: string } }).genv3.noPrompt === "Ujęcie zaprojektowane przez GrovBase.");

  const gallery = code("lib/server/gallery.ts");
  check("the gallery/library projection sends customerPrompt(), never prompt_text, and never the concept description",
    /const prompt = customerPrompt\(job\)/.test(gallery) && !/customer_description/.test(gallery)
    && !/prompt:\s*(j|job|row)\.prompt_text/.test(gallery));
  const search = code("app/api/search/route.ts");
  check("the global search reads only the customer's own prompts", /\.eq\("prompt_origin",\s*"custom"\)/.test(search) && /customerPrompt\(/.test(search));
  check("a concept page shows its description only for the customer's own prompt",
    /origin === "custom" \? p\.customer_description : null/.test(read("app/(app)/prompts/[id]/page.tsx")));
  check("the generator no longer reads generated_prompts from the browser (the route returns the ids)",
    !/from\("generated_prompts"\)/.test(code("components/genv3/workspace.tsx")) && /conceptIds/.test(read("app/api/prompts/generate/route.ts")));
  const sql = read("supabase/migrations/0171_engine_prompt_privacy.sql");
  check("0171: the three tables answer to the server's token for members; admins keep direct read",
    (sql.match(/server_request_ok\(\)/g) ?? []).length >= 11 && /or \(select public\.is_admin\(\)\)/.test(sql)
    && !/\b(delete from|update public\.|truncate)\b/i.test(sql.replace(/--[^\n]*/g, "")));
  check("the server's own client carries that token", /x-grovbase-server/.test(read("lib/supabase/server.ts")));
}

/* ── B ─────────────────────────────────────────────────────────────────── */
console.log("\nB. Miniaturka: retouched photos used again");
{
  const J = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const photo = (p: string): FormPhoto => ({ key: p, path: p, url: `https://x/${p}` });
  const r = (n: number, original: string | null): RetouchedPhoto => ({ ref: retouchedRef(J(n)), original, url: `https://x/r${n}` });
  check("a reference is `retouched:<uuid>`, nothing else", retouchedJobId(retouchedRef(J(1))) === J(1)
    && retouchedJobId("retouched:../../etc") === null && retouchedJobId("ws/p/1.png") === null && retouchedJobId(null) === null);

  const form = [photo("ws/a.png"), photo("ws/b.png"), photo("ws/c.png")];
  const m = mergeRetouched(form, [r(1, "ws/b.png"), r(2, "ws/zzz.png")], 10);
  check("the retouched photo takes its original's place, at the same position",
    m.photos[1].path === retouchedRef(J(1)) && m.replaced === 1);
  check("unrelated photos stay where they were", m.photos[0].path === "ws/a.png" && m.photos[2].path === "ws/c.png");
  check("one whose original is not in the form is appended", m.photos[3]?.path === retouchedRef(J(2)) && m.added === 1 && m.photos.length === 4);
  const again = mergeRetouched(m.photos, [r(1, "ws/b.png"), r(2, null)], 10);
  check("a second click adds nothing twice", again.photos.length === 4 && again.duplicates === 2 && again.added + again.replaced === 0);
  const full = Array.from({ length: 9 }, (_, i) => photo(`ws/${i}.png`));
  const capped = mergeRetouched(full, [r(3, null), r(4, null), r(5, null)], 10);
  check("the limit (10) holds: one appended, two counted as skipped, never forced in",
    capped.photos.length === 10 && capped.added === 1 && capped.skipped === 2);
  const swapAtLimit = mergeRetouched(Array.from({ length: 10 }, (_, i) => photo(`ws/${i}.png`)), [r(6, "ws/4.png")], 10);
  check("…but replacing an original at the limit is always possible", swapAtLimit.replaced === 1 && swapAtLimit.photos.length === 10);
  check("a forged reference is ignored", mergeRetouched(form, [{ ref: "retouched:nope", original: null, url: "x" }], 10).photos.length === 3);

  let events = 0;
  (globalThis as { window?: unknown }).window = { dispatchEvent: (e: Event) => { if (e.type === RETOUCHED_EVENT) events++; return true; } };
  offerRetouched([r(7, "ws/a.png"), { ref: "retouched:forged", original: null, url: "x" }]);
  const taken = takeRetouched();
  check("the hand-over: offered once, taken once (a forged entry dropped), the form is told",
    taken?.length === 1 && taken[0].ref === retouchedRef(J(7)) && takeRetouched() === null && events === 1);

  const ws = code("components/thumbnail/workspace.tsx");
  check("the form: merges, switches Packshot AI OFF and says so — and starts nothing",
    /mergeRetouched\(/.test(ws) && /setRetouch\(false\)/.test(ws) && /thumb\.reuse\.done/.test(ws)
    && !/absorbRetouched[\s\S]{0,700}(generate|submit|start)\(/.test(ws));
  check("…the price counts carried photos as paid only while Packshot AI is on", /reused:\s*retouchOn \? carried : 0/.test(ws));
  check("the toast reads exactly as specified (PL), and exists in EN/DE",
    (pl as { thumb: { reuse: { done: string } } }).thumb.reuse.done === "Zdjęcia są już po retuszu – nie zapłacisz za retusz ponownie."
    && [en, de].every((d) => typeof (d as { thumb: { reuse: { done?: string } } }).thumb.reuse.done === "string"));
  const det = code("components/genv3/image-details.tsx");
  check("the preview's „Użyj do nowej miniaturki”: offers, closes the preview, navigates without a reload",
    /offerRetouched\(/.test(det) && /onClose\(\)/.test(det) && /router\.push\(THUMBNAIL_PATH\)/.test(det) && !/location\.(href|assign|reload)/.test(det));
}

/* ── C ─────────────────────────────────────────────────────────────────── */
console.log("\nC. …resolved by the server");
{
  const run = code("lib/server/thumbnail/run.ts");
  check("a carried reference is looked up as this workspace's own Retusz job before anything is charged",
    /carriedRetouches\(supabase, workspaceId,/.test(run) && /retouchAssetPath\(\{ supabase, workspaceId \}, id\)/.test(run)
    && /"retouch_reuse_missing"/.test(run));
  const src = code("app/api/generations/sources/route.ts");
  check("the preview's list of retouched photos is the workspace's own Retusz jobs, signed by the server",
    /image_retouch/.test(src) && /workspace_id/.test(src) && /createSignedUrl/.test(src));
}

/* ── D ─────────────────────────────────────────────────────────────────── */
console.log("\nD. the image preview's smart actions");
{
  const det = code("components/genv3/image-details.tsx");
  check("the whole section renders only when the switch says yes (hidden by default)",
    /useState\(false\)/.test(det) && /\{actionsOn && \(?\s*<div data-preview-actions/.test(det));
  const flag = code("app/api/preview/actions/route.ts");
  check("the switch is answered by the server (signed-in only)", /featureBlockedForApi\(supabase, "preview_actions"\)/.test(flag) && /status: 401/.test(flag));
  check("a run or a save started from the preview is refused on the server when it is off",
    ["app/api/tools/run/route.ts", "app/api/tools/save/route.ts"].every((f) => /"preview"/.test(read(f)) && /"preview_actions"/.test(read(f))));
}

/* ── E ─────────────────────────────────────────────────────────────────── */
console.log("\nE. Packshot");
{
  const next = read("next.config.mjs");
  check("/retusz → /narzedzia/packshot is a permanent 301 (direct entry included: next.config redirects)",
    /source:\s*"\/retusz",\s*destination:\s*"\/narzedzia\/packshot",\s*statusCode:\s*301/.test(next));
  check("…and nothing redirects /narzedzia/packshot anywhere (no loop)", !/source:\s*"\/narzedzia\/packshot"/.test(next));
  check("the page lives at the new address, the old directory is gone",
    fs.existsSync("app/(app)/narzedzia/packshot/page.tsx") && !fs.existsSync("app/(app)/retusz"));
  for (const [lang, dict] of [["pl", pl], ["en", en], ["de", de]] as const) {
    const t = makeT(dict as never);
    check(`${lang}: the tool is „Packshot”; the old one is named apart`, t("tools.retouch.name") === "Packshot"
      && t("wf.ecommerce.packshot.name") !== t("tools.retouch.name"));
  }
  check("Miniaturka's switch reads „Popraw zdjęcia przed utworzeniem miniaturki (Packshot AI)”",
    (pl as { thumb: { retouchTitle: string } }).thumb.retouchTitle === "Popraw zdjęcia przed utworzeniem miniaturki (Packshot AI)");
  check("the canonical SEO path of the page is the new address",
    /PACKSHOT_PATH/.test(read("lib/public-tools.ts")) && /publicToolMetadata\(TOOL\)/.test(read("app/(app)/narzedzia/packshot/page.tsx")));
}

console.log(failed ? `\n${failed} PREMIERA TEST(S) FAILED` : "\nAll premiera tests passed.");
process.exit(failed ? 1 : 0);
