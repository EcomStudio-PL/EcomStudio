/**
 * GROVBASE SHOT — THE FORM AND ITS CONTRACT (P0 fix of 12.11.2026).
 *
 * The panel fell back to the earlier form (scenario selector with „Sesja
 * reklamowa”, „Plan ujęć”, no Allegro description) for every viewer the
 * lifestyle engine was not granted to: a visitor, an admin's guest preview, a
 * customer outside the `grovshot_engine_v2` flag, a trial workspace. These
 * checks hold the fix without a browser and without a paid call:
 *
 *   A  the order rules of the earlier path (/api/prompts/generate):
 *      lifestyle accepted, the advertising session refused while the settings
 *      keep it off, the description required, a manual plan admin-only
 *   B  the lifestyle engine's start route keeps the same rules (unchanged)
 *   C  the form: ONE form for everyone — photos, description, format, count,
 *      more settings; no scenario, no plan, no notes, no model for customers
 *   D  what the form sends on either path
 *   E  „Stwórz zdjęcie” is untouched; the gallery offers no session filter
 *
 * Run: npm run test:grovshot-form
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { checkV1ShotOrder } from "@/lib/grovshot-shot/v1-order";
import { DEFAULT_SHOT_SETTINGS } from "@/lib/grovshot-shot/settings";
import pl from "@/lib/i18n/dictionaries/pl.json";

let failed = 0;
function check(name: string, ok: boolean, detail: unknown = "") {
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok || detail === "" ? "" : `\n       ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}
const read = (f: string) => fs.readFileSync(f, "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const DESC = "Kubek termiczny 450 ml\n\nPodwójne ścianki, szczelna pokrywka.\nWymiary: 8 × 8 × 21 cm, stal nierdzewna 18/8, kolor grafitowy.";
const S = DEFAULT_SHOT_SETTINGS;

/* ── A ─────────────────────────────────────────────────────────────────── */
console.log("A. the earlier path's order rules (lib/grovshot-shot/v1-order.ts)");
{
  const okLife = checkV1ShotOrder({ sessionType: "lifestyle", description: DESC }, S, false);
  check("photos + description + lifestyle are accepted", okLife.ok && okLife.sessionType === "lifestyle" && okLife.description === DESC);
  const none = checkV1ShotOrder({ description: DESC }, S, false);
  check("no scenario given → lifestyle", none.ok && none.sessionType === "lifestyle");
  check("the advertising session is refused while the settings keep it off",
    !S.scenarios.reklamowa && JSON.stringify(checkV1ShotOrder({ sessionType: "advertising", description: DESC }, S, false)) === JSON.stringify({ ok: false, error: "scenario_unavailable" }));
  check("…for an admin too (no scenario outside the settings)", !checkV1ShotOrder({ sessionType: "advertising", description: DESC }, S, true).ok);
  check("…and accepted only if the settings switch it on (one source of truth)",
    checkV1ShotOrder({ sessionType: "advertising", description: DESC }, { ...S, scenarios: { lifestyle: true, reklamowa: true } }, false).ok);
  check("an unknown scenario is refused", !checkV1ShotOrder({ sessionType: "studio", description: DESC }, S, false).ok);
  check("a missing description is refused", JSON.stringify(checkV1ShotOrder({ sessionType: "lifestyle" }, S, false)) === JSON.stringify({ ok: false, error: "description_too_short" }));
  check(`a description under ${S.description_min_chars} characters is refused`, !checkV1ShotOrder({ description: "x".repeat(S.description_min_chars - 1) }, S, false).ok
    && checkV1ShotOrder({ description: "x".repeat(S.description_min_chars) }, S, false).ok);
  check("a description over 20 000 characters is refused", JSON.stringify(checkV1ShotOrder({ description: "x".repeat(20_001) }, S, false)) === JSON.stringify({ ok: false, error: "description_too_long" }));
  const crlf = checkV1ShotOrder({ description: "Linia 1\r\nLinia 2\r\n\r\nLinia 3" + "x".repeat(80) }, S, false);
  check("line breaks are kept (CRLF normalised, nothing else changed)", crlf.ok && crlf.description.startsWith("Linia 1\nLinia 2\n\nLinia 3"));
  check("a manual shot plan from a customer is refused", JSON.stringify(checkV1ShotOrder({ description: DESC, shotBriefs: [{ text: "x" }] }, S, false)) === JSON.stringify({ ok: false, error: "invalid_input" }));
  check("…an empty one is not a plan (no error for a removed field)", checkV1ShotOrder({ description: DESC, shotBriefs: [] }, S, false).ok);
  check("removed fields (notes, dimensions) do not cause errors", checkV1ShotOrder({ description: DESC, ...({ notes: "x", dimensions: null } as object) }, S, false).ok);
  const route = code("app/api/prompts/generate/route.ts");
  check("the route reads the GrovBase Shot settings, applies the rules and sends the checked values",
    /from\("app_settings"\)\.select\("value"\)\.eq\("key", "grovshot_shot"\)/.test(route) && /checkV1ShotOrder\(/.test(route)
    && /sessionType: order\.sessionType/.test(route) && /description: order\.description/.test(route)
    && /isAdminUserId\(supabase, user\.id\)/.test(route));
  check("every refusal has a customer-facing message", ["scenario_unavailable", "description_too_short", "description_too_long", "invalid_input"]
    .every((k) => typeof (pl as { studio: { err: Record<string, string> } }).studio.err[k] === "string"));
}

/* ── B ─────────────────────────────────────────────────────────────────── */
console.log("\nB. the lifestyle engine's start route (unchanged by this fix)");
{
  const start = code("lib/server/grovshot-v2/start-shot.ts");
  check("a non-lifestyle session never starts on it", /body\.sessionType !== undefined && body\.sessionType !== "lifestyle"\) return \{ ok: false, error: "engine_v1" \}/.test(start));
  check("the description minimum is the same setting", /description_min_chars\) return \{ ok: false, error: "description_too_short" \}/.test(start));
  check("a plan is an admin-only parameter there too", /!admin && \(body\.userPlan !== undefined \|\| \(Array\.isArray\(body\.shotBriefs\)/.test(start));
  let changed = "";
  try { changed = execFileSync("git", ["diff", "--name-only", "dfcd622", "--", "lib/server/grovshot-v2", "lib/grovshot-v2", "app/api/grovshot", "lib/server/prompt-engine.ts"], { encoding: "utf8" }).trim(); }
  catch (e) { changed = `git: ${String(e)}`; }
  // CENNIK V2 (13.11.2026) changed three of them ON PURPOSE — the GrovShot
  // quote (analysis 2 + 1 / 1.25 per image, in hundredths) — and nothing else
  // in them. Pinned, so any further change is a decision again.
  const CENNIK_V2: Record<string, string> = {
    "lib/server/grovshot-v2/run.ts": "cac4a128d009fc1ca2b7f950fa8164dd9d5b8ab96282b0c5ea90d21719bf7758",
    "lib/server/grovshot-v2/start-shot.ts": "0d911dadf6cfd6ca5f62366d2aa18d238f3bbf88edbbe8a98cee531482f59192",
    "lib/server/grovshot-v2/start.ts": "eabfc587b8cc77af09ae1a9f64ca1aa5e033be0d425f36def2090027e19de01f",
  };
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  changed = changed.split("\n").filter((f) => f && !(CENNIK_V2[f] && createHash("sha256").update(readFileSync(f)).digest("hex") === CENNIK_V2[f])).join("\n");
  check("no engine file changed (V2 stages, start, drive, knowledge, the V1 engine)", changed === "", changed);
}

/* ── C ─────────────────────────────────────────────────────────────────── */
console.log("\nC. the form — one for everyone");
{
  const ws = code("components/genv3/workspace.tsx");
  const managed = ws.slice(ws.indexOf(") : managed ? ("), ws.indexOf("<PromptSection"));
  check("no scenario selector, no session cards, no variant chips", !/ScenarioCards|VariantChips|genv3\.scenario/.test(ws));
  check("no „Plan ujęć” in the form", !/ShotPlan|planToBriefs|patchRow/.test(ws));
  check("the Allegro description is always in the GrovBase Shot form (not only on the engine)", /<V2Fields description=/.test(managed) && !/\{v2 && \(\s*<V2Fields/.test(managed));
  check("order: photos → description → format → count → more settings",
    (() => { const at = (s: string) => managed.indexOf(s); return at("{photos}") < at("<V2Fields") && at("<V2Fields") < at("{formatControl}") && at("{formatControl}") < at('data="count"') && at('data="count"') < at("<MoreSettings"); })());
  check("no model choice for a customer, no quality control in GrovBase Shot", /\{v2 && shotAdmin && modelControl\(\)\}/.test(managed) && !/qualityControl/.test(managed));
  check("the default scenario is lifestyle", /sessionType: "lifestyle",\s*\n\s*choices:/.test(ws));
  check("the description is required for every GrovBase Shot order", /const descOk = !managed \|\| \(grov\.description \?\? ""\)\.trim\(\)\.length >= descMin/.test(ws));
  check("five formats and 2K / 4K (2K recommended) on either path", /managed \? shotOffer\(V2_RATIOS, model\.ratios\)/.test(ws) && /managed \? shotOffer\(V2_RESOLUTIONS, model\.resolutions\)/.test(ws)
    && /managed && resolutionsOffered\.includes\("2K"\) \? "2K"/.test(ws));
  check("the format tiles stay on one row in GrovBase Shot only", /oneRow=\{managed\}/.test(ws) && /oneRow \? "sm:auto-cols-fr sm:grid-flow-col/.test(read("components/genv3/controls.tsx")));
  check("the minimum comes from the server's setting for every viewer (a visitor too)",
    /descriptionMin: managed\?\.descriptionMin \?\? DEFAULT_SHOT_SETTINGS\.description_min_chars/.test(read("components/genv3/studio-page.tsx"))
    && /const (descriptionMin|\[descriptionMin, shotPrices\]) = await (shotDescriptionMin\(supabase\)|Promise\.all\(\[shotDescriptionMin\(supabase\), grovshotPrices\(supabase\)\]\))/.test(read("components/genv3/studio-page.tsx")));
  const v2fields = read("components/genv3/grovshot-v2.tsx");
  check("the field: a required textarea, the spec's hint, the 20 000 cap", /<Textarea data-gsv2-description[^>]*required/.test(v2fields)
    && (pl as { gsv2: { descHint: string; descLabel: string } }).gsv2.descHint === "Wklej tytuł, opis i specyfikację z aukcji, razem z wymiarami. Silnik wykorzysta cechy, zastosowania i wymiary do zaplanowania zdjęć."
    && (pl as { gsv2: { descLabel: string } }).gsv2.descLabel === "Opis produktu z Allegro");
  const guide = JSON.stringify((pl as { toolGuideDefaults: { prompts: unknown } }).toolGuideDefaults.prompts);
  check("the tool's tutorial no longer offers a session type, a model or a shot plan", !/Sesja reklamowa|typ sesji|Model AI|Opisz ujęci/.test(guide) && /Opis produktu z Allegro/.test(guide));
}

/* ── D ─────────────────────────────────────────────────────────────────── */
console.log("\nD. what the form sends");
{
  const ws = code("components/genv3/workspace.tsx");
  const v1 = ws.slice(ws.indexOf('fetch("/api/prompts/generate"'), ws.indexOf("const prepJson"));
  check("earlier path: lifestyle, the description, the photos in panel order — no plan", /sessionType: "lifestyle"/.test(v1) && /description: \(grov\.description \?\? ""\)\.trim\(\)/.test(v1)
    && /referencePaths: refs\.map\(\(r\) => r\.path\)/.test(v1) && !/shotBriefs/.test(v1));
  const v2 = ws.slice(ws.indexOf('endpoint: "/api/grovshot/runs"'), ws.indexOf("tool: \"prompts\", operation: \"grovshot_v2\""));
  check("lifestyle engine: photos, count, format, size, lifestyle, description, quote — no notes, no plan", /photos: refs\.map\(\(r\) => r\.path\)/.test(v2) && /sessionType: "lifestyle"/.test(v2)
    && /description: \(grov\.description \?\? ""\)\.trim\(\)/.test(v2) && /shots: effCount/.test(v2) && /quotedTotal: total/.test(v2) && !/notes|shotBriefs|userPlan/.test(v2));
  check("an old draft's scenario or plan is never sent (neither is read when sending)", !/grov\.sessionType|grov\.plan/.test(ws));
  check("one Generate: the lifestyle engine when granted, else the earlier path — never both for one click",
    /const generate = \(\) => void session\.gate\(managed \? \(v2 \? \(\) => generateV2\(false\) : generateManaged\) : generateCustom\)/.test(ws)
    && /if \(submitting\.current\) return;/.test(ws));
}

/* ── E ─────────────────────────────────────────────────────────────────── */
console.log("\nE. „Stwórz zdjęcie” and the gallery");
{
  const now = code("components/genv3/workspace.tsx");
  let before = "";
  try { before = execFileSync("git", ["show", "dfcd622:components/genv3/workspace.tsx"], { encoding: "utf8" }).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, ""); } catch { /* no history */ }
  const fn = (src: string) => { const a = src.indexOf("async function generateCustom"); return a < 0 ? "" : src.slice(a, src.indexOf("\n  }\n", a)); };
  check("„Stwórz zdjęcie” sends exactly what it sent before", before === "" || (fn(now) !== "" && fn(now) === fn(before)));
  const custom = now.slice(now.indexOf("<PromptSection"), now.indexOf("</>", now.indexOf("<PromptSection")));
  check("…its form still has its prompt, inspirations, model and quality — and no Allegro description", /<InspirationSection/.test(custom) && /modelControl\(\)/.test(custom) && /qualityControl/.test(custom) && !/V2Fields/.test(custom));
  const gallery = code("components/genv3/gallery.tsx");
  check("the studio gallery offers no session filter (no „Sesja reklamowa” chip)", /!operation && sessionFilter \? \[/.test(gallery) && /sessionFilter = false/.test(gallery)
    && !/sessionFilter/.test(now));
}

console.log(failed ? `\n${failed} GROVSHOT FORM TEST(S) FAILED` : "\nAll GrovBase Shot form tests passed.");
process.exit(failed ? 1 : 0);
