/**
 * GENERATOR UX V3 — the rules, checked without a browser (the browser side:
 * the report's Playwright run on a local build with mocked generation).
 *
 *   A. Plan ujęć: rows by stable photo key, kept past the count, sent by path
 *   B. the server's door: a shot's photo must be one of THIS request's photos
 *   C. how many product photos Stwórz really sends (mirrors the server)
 *   D. the draft: read back defensively, the previous release's flat shape
 *   E. the Generate bar's one line: a single fixed order
 *   F. the wiring: one bar, no cost card, the frame's state owned by the panel
 *   G. the copy: every new key in PL/EN/DE
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EMPTY_ROW, PLAN_TEXT_MAX, SHOTS_MAX, customPhotoBudget, dropPhoto, parseTab, patchRow, planToBriefs,
  plannedCount, readStudioDraft, remapPhotos, type PlanRow, type StudioDraft,
} from "../lib/generator/studio";
import { resolveShotBriefs } from "../lib/server/shot-plan";
import { barPriority } from "../components/generate/bar-priority";
import pl from "../lib/i18n/dictionaries/pl.json";
import en from "../lib/i18n/dictionaries/en.json";
import de from "../lib/i18n/dictionaries/de.json";

let failed = 0;
let passed = 0;
function section(title: string) { console.log(`\n${title}`); }
function check(name: string, ok: boolean, detail: unknown = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail !== "" ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`); }
}
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/* ── A ─────────────────────────────────────────────────────────────────── */
section("A. Plan ujęć");
{
  const refs = [{ key: "k1", path: "ws/p/1.png" }, { key: "k2", path: "ws/p/2.png" }, { key: "k3", path: "ws/p/3.png" }];
  let plan: PlanRow[] = [];
  plan = patchRow(plan, 0, { text: "  Zbliżenie na podstawę  " });
  plan = patchRow(plan, 1, { photo: "k3", keepFraming: true });
  plan = patchRow(plan, 6, { text: "Siódme ujęcie" });
  check("A1 a row far down grows the list (rows in between are empty)", plan.length === 7 && same(plan[3], EMPTY_ROW));
  check("A2 \"Zaplanowane: 2 z 5\" counts only rows inside the count", plannedCount(plan, 5) === 2 && plannedCount(plan, 7) === 3);
  const five = planToBriefs(plan, 5, refs);
  check("A3 one brief per shot, the words trimmed, the photo BY PATH",
    five.length === 5 && five[0]!.text === "Zbliżenie na podstawę" && five[1]!.refPath === "ws/p/3.png" && five[1]!.keepFraming === true
    && !("refPath" in five[0]!) && !("text" in five[2]!), five);
  const one = planToBriefs(plan, 1, refs);
  check("A4 count lowered to 1: one brief — but the rows stay", one.length === 1 && plan.length === 7 && plan[6]!.text === "Siódme ujęcie");
  check("A5 count raised again: the earlier rows come back unchanged", same(planToBriefs(plan, 7, refs).slice(0, 5), five));
  const reordered = [refs[2]!, refs[0]!, refs[1]!];
  check("A6 reordering the photos never re-aims a shot", planToBriefs(plan, 5, reordered)[1]!.refPath === "ws/p/3.png");
  const dropped = dropPhoto(plan, "k3");
  check("A7 removing the photo sends its rows back to \"Dowolne\" (and drops \"keep framing\")",
    dropped[1]!.photo === null && dropped[1]!.keepFraming === false && dropped[0]!.text.trim() === "Zbliżenie na podstawę");
  check("A8 clearing a row's photo clears \"keep framing\" too", patchRow(plan, 1, { photo: null })[1]!.keepFraming === false);
  check("A9 a photo that is not in the pool any more is not sent (no stale path)",
    !("refPath" in planToBriefs(plan, 5, refs.slice(0, 2))[1]!) && planToBriefs(plan, 5, refs.slice(0, 2))[1]!.keepFraming === false);
  const remapped = remapPhotos(plan, new Map([["k3", "n3"]]));
  check("A10 a restore that renames the photos re-aims the rows; an unknown one goes to Dowolne",
    remapped[1]!.photo === "n3" && remapPhotos(plan, new Map())[1]!.photo === null);
  check("A11 a long text is cut to the planner's limit", planToBriefs(patchRow([], 0, { text: "x".repeat(900) }), 1, refs)[0]!.text!.length === PLAN_TEXT_MAX);
  check("A12 never more rows than shots exist", patchRow(Array.from({ length: 14 }, () => ({ ...EMPTY_ROW })), 0, { text: "a" }).length === SHOTS_MAX);
}

/* ── B ─────────────────────────────────────────────────────────────────── */
section("B. The server's door (lib/server/shot-plan.ts)");
{
  const paths = ["ws/p/a.png", "ws/p/b.png", "ws/p/c.png"];
  const r = resolveShotBriefs([{ text: "Na blacie" }, { refPath: "ws/p/c.png", keepFraming: true }, {}], paths);
  check("B1 a photo's path becomes the engine's 1-based position in THIS request",
    r.ok && r.briefs![1]!.refIndex === 3 && r.briefs![1]!.keepFraming === true && r.briefs![0]!.text === "Na blacie" && r.briefs![0]!.refIndex === undefined, r);
  check("B2 a path that is not one of the request's photos is refused (no paid call)", !resolveShotBriefs([{ refPath: "ws/p/zz.png" }], paths).ok);
  check("B3 another workspace's path is refused (the route kept only this workspace's)", !resolveShotBriefs([{ refPath: "other/p/a.png" }], paths).ok);
  check("B4 a non-string path is refused", !resolveShotBriefs([{ refPath: 3 }], paths).ok);
  check("B5 no plan → nothing passed on (the engine's own choice)", (() => { const x = resolveShotBriefs(undefined, paths); return x.ok && x.briefs === undefined; })());
  check("B6 the previous release's positional body still works", (() => { const x = resolveShotBriefs([{ refIndex: 2 }], paths); return x.ok && x.briefs![0]!.refIndex === 2; })());
  check("B7 at most 10 briefs, text at most 400", (() => {
    const x = resolveShotBriefs(Array.from({ length: 14 }, () => ({ text: "y".repeat(800) })), paths);
    return x.ok && x.briefs!.length === 10 && x.briefs![0]!.text!.length === 400;
  })());
  const route = read("app/api/prompts/generate/route.ts");
  check("B8 the route checks the plan against the SAME filtered paths it hands the engine",
    /const referencePaths = \(body\.referencePaths/.test(route) && /resolveShotBriefs\(body\.shotBriefs, referencePaths\)/.test(route)
    && /invalid_shot_plan/.test(route) && /shotBriefs: plan\.briefs/.test(route) && /referencePaths,\n/.test(route));
  check("B9 the engine's prompts are not touched by the plan's wiring", !/shot-plan/.test(read("lib/server/prompt-engine.ts")));
}

/* ── C ─────────────────────────────────────────────────────────────────── */
section("C. Product photos Stwórz really sends");
{
  check("C1 6 slots, no inspiration → 6", customPhotoBudget({ supportsRefs: true, maxRefs: 6 }, 0) === 6);
  check("C2 6 slots, 1 inspiration → 5", customPhotoBudget({ supportsRefs: true, maxRefs: 6 }, 1) === 5);
  check("C3 6 slots, 3 inspirations → 4 (two are reserved, no more)", customPhotoBudget({ supportsRefs: true, maxRefs: 6 }, 3) === 4);
  check("C4 no configured cap → the server's default 6", customPhotoBudget({ supportsRefs: true, maxRefs: null }, 0) === 6);
  check("C5 a model without reference photos uses none", customPhotoBudget({ supportsRefs: false, maxRefs: 6 }, 0) === 0);
  check("C6 never below one when inspiration takes the slots", customPhotoBudget({ supportsRefs: true, maxRefs: 2 }, 2) === 1);
  const gen = read("lib/server/generation.ts");
  check("C7 the server's own rule is the one mirrored (maxRefs || 6, min(2, insp), max(1, …))",
    gen.includes("const maxRefs = model.max_reference_images || 6;")
    && gen.includes("(inspWanted.length > 0 ? Math.min(2, inspWanted.length) : 0)")
    && gen.includes("const productBudget = reserved > 0 ? Math.max(1, maxRefs - reserved) : maxRefs;"));
  const ws = read("components/genv3/workspace.tsx");
  check("C8 Stwórz sends only the usable photos; GrovShot all of them",
    /referencePaths: refs\.map\(\(r\) => r\.path\)\.slice\(0, Math\.min\(usable, MAX_REFS\)\)/.test(ws)
    && /const usable = managed \? MAX_REFS : customPhotoBudget\(model, insp\.length\)/.test(ws));
}

/* ── D ─────────────────────────────────────────────────────────────────── */
section("D. The draft");
{
  const defaults: StudioDraft = {
    v: 3,
    grovshot: { sessionType: "advertising", choices: {}, modelId: "m1", ratio: "1:1", resolution: "1K", quality: "medium", count: 5, plan: [] },
    stworz: { prompt: "", modelId: "m2", ratio: "1:1", resolution: "1K", quality: "medium", count: 1 },
  };
  const v3 = readStudioDraft({
    v: 3, tab: "stworz",
    grovshot: { sessionType: "lifestyle", choices: { light: "warm", bad: 3 }, count: 7, plan: [{ text: "a", photo: "k1", keepFraming: true }, { text: "b", photo: 9 }] },
    stworz: { prompt: "Butelka", modelId: "m9", hack: "x" },
  }, defaults, "grovshot");
  check("D1 both modes come back, each with its own values",
    v3.grovshot.sessionType === "lifestyle" && v3.grovshot.count === 7 && v3.stworz.prompt === "Butelka" && v3.stworz.modelId === "m9");
  check("D2 unknown keys and wrong types are dropped", !("hack" in v3.stworz) && same(v3.grovshot.choices, { light: "warm" })
    && v3.grovshot.plan[1]!.photo === null && v3.grovshot.plan[0]!.keepFraming === true);
  check("D3 the mode on screen is NOT taken from the draft (the address decides)", !("tab" in v3));
  const flatGs = readStudioDraft({ prompt: "x", modelId: "m7", count: 6, sessionType: "lifestyle", briefs: [{ text: "t", refIndex: 2, keepFraming: true }] },
    defaults, "grovshot", ["k1", "k2"]);
  check("D4 the previous release's flat GrovShot draft: positions become photo keys",
    flatGs.grovshot.modelId === "m7" && flatGs.grovshot.count === 6 && flatGs.grovshot.plan[0]!.photo === "k2" && flatGs.stworz.prompt === "");
  const flatSt = readStudioDraft({ prompt: "Butelka", modelId: "m8" }, defaults, "stworz");
  check("D5 …and a flat Stwórz draft lands in Stwórz only", flatSt.stworz.prompt === "Butelka" && flatSt.grovshot.modelId === "m1");
  check("D6 garbage is the defaults", same(readStudioDraft(null, defaults, "grovshot"), defaults) && same(readStudioDraft("x", defaults, "stworz"), defaults));
  check("D7 ?tryb= reads only the two modes", parseTab("grovshot") === "grovshot" && parseTab("stworz") === "stworz" && parseTab("admin") === null && parseTab(null) === null);
  const session = read("components/public-tools/use-tool-session.ts");
  check("D8 a run drops only the visit's slot, never the member's working draft",
    /const ran = useCallback\(\(\) => \{[\s\S]{0,120}void deleteDraft\(tool\);\n {2}\}, \[tool\]\);/.test(session));
  check("D9 the member's draft is read back only by its owner", /mine\.draft\.owner !== memberOwner/.test(session));
  check("D10 \"Wyczyść\" removes both slots and does not re-save the reset", /deleteDraft\(memberSlot\)/.test(session) && /setClearTick/.test(session));
  check("D11 the member slot's name carries no account id (it is reported to analytics)",
    /draftKey = "studio:generator"|draftKey: "studio:generator"|"studio:generator"/.test(read("components/genv3/studio-page.tsx")));
}

/* ── E ─────────────────────────────────────────────────────────────────── */
section("E. The bar's one line");
{
  const all = { unavailable: true, invalid: true, limit: true };
  check("E1 the tool first", barPriority(all) === "unavailable");
  check("E2 then the form", barPriority({ ...all, unavailable: false }) === "invalid");
  check("E3 then the plan's limit", barPriority({ unavailable: false, invalid: false, limit: true }) === "limit");
  check("E4 then the account (address, survey, plan, credits)", barPriority({ unavailable: false, invalid: false, limit: false }) === "account");
}

/* ── F ─────────────────────────────────────────────────────────────────── */
section("F. The wiring");
{
  const panels = ["components/genv3/workspace.tsx", "components/thumbnail/workspace.tsx", "components/retouch/workspace.tsx",
    "components/fashion/tool-workspace.tsx", "components/tools/photo-tool.tsx", "components/tools/resize-workbench.tsx", "components/tools/compress-workbench.tsx"];
  for (const p of panels) {
    const s = read(p);
    check(`F1 ${p.split("/").slice(-2).join("/")}: the shared Generate bar, no cost card`, /<GenerateBar\b/.test(s) && !/CostIsland|CostSummary/.test(s));
  }
  check("F2 the old cost card is gone from the shared parts", !/export function (CostIsland|CostSummary)/.test(read("components/tools/panel-parts.tsx")));
  for (const p of panels.slice(0, 5)) {
    const s = read(p);
    check(`F3 ${p.split("/").slice(-2).join("/")}: the frame's state is the panel's own (accepted() reaches the phone's views)`,
      /useToolFrameController\(\)/.test(s) && /<ToolFrame frame=\{frame\}/.test(s) && !/useToolFrame\(\)/.test(s));
  }
  const thumb = read("components/thumbnail/workspace.tsx");
  check("F4 Miniaturka keeps its Podsumowanie", /data-thumbnail-summary/.test(thumb));
  const retouchBody = read("components/retouch/workspace.tsx");
  check("F5 Retusz still sends exactly its old body (the frozen pipeline's input)",
    retouchBody.includes("body: { sourcePath: p.path, resolution, format, expectedOutputs: outputsPerRun },")
    && !/aspect_ratio|image_size|response_format/.test(retouchBody));
  check("F6 the old mode switch (two pages) is gone", (() => { try { read("components/generator/mode-switch.tsx"); return false; } catch { return true; } })());
  const css = read("app/globals.css");
  check("F7 the phone's app dock steps aside for a tool's own bar", /\.app-shell:has\(\[data-tool-dock\]\) > nav\.fixed/.test(css));
}

/* ── G ─────────────────────────────────────────────────────────────────── */
section("G. The copy (PL/EN/DE)");
{
  const keys = [
    "bar.total", "bar.costAria", "bar.limit.other", "bar.shots", "bar.images", "bar.photos", "bar.thumb", "bar.retouch",
    "toolFrame.create", "toolFrame.results", "controls.range", "genv3.moreSettings", "genv3.photosUsed", "genv3.photosUsedOne",
    "genv3.restored", "genv3.clear", "genv3.inspOwn", "genv3.inspPick", "studio.err.invalid_shot_plan", "publicTools.line.missing",
    "fmtUse.1:1", "fmtUse.9:16",
  ];
  const get = (d: unknown, k: string) => k.split(".").reduce<unknown>((o, part) => (o && typeof o === "object" ? (o as Record<string, unknown>)[part] : undefined), d);
  for (const [name, d] of [["pl", pl], ["en", en], ["de", de]] as const) {
    const missing = keys.filter((k) => typeof get(d, k) !== "string" || !(get(d, k) as string).trim());
    check(`G1 ${name}: every new key is there`, missing.length === 0, missing);
  }
  check("G2 PL: \"Ten tryb użyje pierwszych {n} zdjęć\"", get(pl, "genv3.photosUsed") === "Ten tryb użyje pierwszych {n} zdjęć");
  check("G3 PL: the price's sum", get(pl, "bar.total") === "Razem: {n} kr.");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
