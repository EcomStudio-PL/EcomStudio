/**
 * TOOL GUIDES (per-tool tutorial + starter gallery) — npm run test:guides
 *
 *   A  the registry: which tools have a guide (and which deliberately not),
 *      the shipped step illustrations, the starter's catalogue fallbacks, the
 *      operation / route → tool mapping, surfaces, picture slot keys
 *   B  content validation: normalizeGuideContent — every refusal code, the
 *      tidying, what is ignored, and parity with the database CHECK (0142)
 *   C  the shipped defaults: every tool × locale complete, within the limits,
 *      clean, provider-neutral, accepted by the admin validator and the CHECK
 *   D  resolveGuide: switches, versions, language fallback, the admin's own
 *      steps, pictures (srcset, alt, video ignored, the starter's fallbacks)
 *   E  the two client decisions, shouldAutoOpen and starterVisible, as truth
 *      tables: every single condition flipped, then exhaustively
 *   F  the read path over stubs: publishedGuide, toolIsLive, hasToolResults,
 *      readSeenVersion and GET /api/tool-guides
 *   G  the writes: markToolTutorialSeenAction and saveToolGuideAction — who
 *      may call, what is refused before any write, the exact rows and RPC
 *      payloads, compare-and-set, cache tags, audit, tables touched
 *   H  scope: frozen modules untouched, the gallery's ratio grid kept, the
 *      starter gallery has no actions, the dialog's accessibility contract,
 *      i18n scopes, the migration is additive, module boundaries
 *
 * Mocks only — no network, no database. Stubs: scripts/stubs/guide-*.ts plus
 * the ice suite's stubs (used read-only). A check that exposes a real defect
 * of the implementation is printed "! DEFECT" and listed at the end; it does
 * not fail the run unless GUIDE_STRICT=1 (the defects are reported, not fixed
 * here — this suite changes no implementation file).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import pl from "@/lib/i18n/dictionaries/pl.json";
import en from "@/lib/i18n/dictionaries/en.json";
import de from "@/lib/i18n/dictionaries/de.json";
import { lookup } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/config";
import { SCOPES } from "@/lib/i18n/scopes";
import { I18nProvider } from "@/lib/i18n/provider";
import {
  DEFAULT_STEP_ARTS, GUIDE_ARTS, GUIDE_LIMITS, GUIDE_MAX_STEPS, GUIDE_TOOL_KEYS,
  guideSlotKey, guideSurface, guideToolForOperation, guideToolForPath, isGuideArt, isGuideSlotKey,
  isGuideTool, normalizeGuideContent, photoSlugOf, shouldAutoOpen, starterVisible,
  type GuideResponse, type GuideToolKey, type ResolvedGuide,
} from "@/lib/tool-guides";
import { STARTER_FALLBACK_SLOTS, guideImageKeys } from "@/lib/tool-guide-slots";
import { TOOL_GUIDES_TAG, publishedGuide, type PublishedGuide } from "@/lib/server/tool-guides-published";
import { defaultGuideContent, loadGuide, resolveGuide, toolIsLive } from "@/lib/server/tool-guides";
import { hasToolResults, markSeen, readGuideRow, readGuideSlots, readSeenVersion } from "@/lib/services/tool-guides";
import { GET } from "@/app/api/tool-guides/route";
import { markToolTutorialSeenAction } from "@/app/actions/tool-guide-seen";
import { saveToolGuideAction, type SaveToolGuideInput } from "@/app/actions/tool-guides";
import { MEDIA_SLOT_TAG, type ResolvedSlot, type SlotMap } from "@/lib/server/media-slots";
import { MEDIA_SLOTS, isKnownSlot, slotDef } from "@/lib/media-slots";
import { AI_TOOL_KEYS } from "@/lib/services/ai-tools";
import { FEATURE_REGISTRY, isFeatureKey } from "@/lib/features";
import { FASHION_TOOLS } from "@/lib/fashion-tools";
import { THUMBNAIL_OPERATION } from "@/lib/thumbnail/config";
import { PHOTO_TOOLS } from "@/lib/images/tools";
import { normaliseText } from "@/lib/ice/validate";
import { hasInvisible } from "@/lib/ice/stega";
import { StarterGallery } from "@/components/tool-guide/starter-gallery";
import { TutorialModal } from "@/components/tool-guide/tutorial-modal";
import { GuideArtwork } from "@/components/tool-guide/guide-art";
import { iceState, resetIceState } from "./stubs/ice-state";
import { guideState, resetGuideState } from "./stubs/guide-state";
import { FakeDb, pgTimestamp, type Row } from "./stubs/guide-fake-db";

/* ══ harness ═══════════════════════════════════════════════════════════════ */

let failures = 0;
let passed = 0;
const failedNames: string[] = [];
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failures++; failedNames.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
/** A check that exposes a REAL defect of the implementation: reported (and
 *  counted as a pass once fixed), never a failure unless GUIDE_STRICT=1. */
const STRICT = process.env.GUIDE_STRICT === "1";
const defects: string[] = [];
function defect(name: string, ok: boolean, detail: string) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); return; }
  defects.push(`${name} — ${detail}`);
  if (STRICT) { failures++; failedNames.push(name); console.log(`  ✗ ${name} — ${detail}`); }
  else console.log(`  ! DEFECT ${name} — ${detail}`);
}
const notes: string[] = [];
function note(s: string) { notes.push(s); console.log(`  · ${s}`); }

type Dict = Record<string, unknown>;
const LOCALES: Locale[] = ["pl", "en", "de"];
const DICTS: Record<Locale, Dict> = { pl: pl as Dict, en: en as Dict, de: de as Dict };
const SHIPPED_JSON = LOCALES.map((l) => JSON.stringify(DICTS[l]));
const TOOLS: GuideToolKey[] = [...GUIDE_TOOL_KEYS];
const short = (xs: string[], n = 8) => (xs.length > n ? `${xs.slice(0, n).join(", ")} … (+${xs.length - n})` : xs.join(", "));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const read = (p: string) => readFileSync(p, "utf8");

/** Every string leaf of a value, with its dotted path. */
function leaves(d: unknown, path: string[] = [], out: [string, string][] = []): [string, string][] {
  if (typeof d === "string") out.push([path.join("."), d]);
  else if (d && typeof d === "object") for (const [k, v] of Object.entries(d)) leaves(v, [...path, k], out);
  return out;
}

/** Source without comments (block, JSX-block and line comments), so a check
 *  about what a file DOES is not fooled by what its comments SAY. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[\s;{}(),])\/\/[^\n]*/g, "$1");
}

// console noise from the code under test (its own warn/error lines) is
// captured, not printed — a refusal path is expected to log.
const captured: string[] = [];
const realWarn = console.warn;
const realError = console.error;
function quiet() {
  captured.length = 0;
  console.warn = (...a: unknown[]) => { captured.push(a.map(String).join(" ")); };
  console.error = (...a: unknown[]) => { captured.push(a.map(String).join(" ")); };
}
function loud() { console.warn = realWarn; console.error = realError; }

/* ── the database CHECK of 0142, emulated from the SQL itself ─────────────── */

const SQL_0141 = read("supabase/migrations/0141_inline_content_editor.sql");
const SQL_0142 = read("supabase/migrations/0142_tool_guides.sql");

/** public.content_text_ok (0141), its two character classes lifted from the
 *  migration text and run as JS regular expressions. */
const sqlTextOk: ((s: string) => boolean) | null = (() => {
  const body = /create or replace function public\.content_text_ok\([\s\S]*?\$\$([\s\S]*?)\$\$/.exec(SQL_0141)?.[1];
  if (!body) return null;
  const classes = [...body.matchAll(/p !~ '(\[[^']+\])'/g)].map((m) => m[1]);
  if (classes.length !== 2) return null;
  const res = classes.map((c) => new RegExp(c.replace(/\\U([0-9A-Fa-f]{8})/g, (_, h: string) => `\\u{${parseInt(h, 16).toString(16)}}`), "u"));
  return (s: string) => res.every((re) => !re.test(s));
})();

/** jsonb::text — `{"k": v, "k2": [a, b]}` — for the 64 KiB bound. */
function pgJsonText(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(pgJsonText).join(", ")}]`;
  if (v && typeof v === "object") return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${pgJsonText(x)}`).join(", ")}}`;
  return JSON.stringify(v) ?? "null";
}

/** public.tool_guide_content_ok (0142): null, or an object ≤ 64 KiB whose
 *  every string is ≤ 2000 characters and passes content_text_ok. */
function contentOk(c: unknown): boolean {
  if (c === null || c === undefined) return true;
  if (typeof c !== "object" || Array.isArray(c)) return false;
  if (Buffer.byteLength(pgJsonText(c), "utf8") > 65536) return false;
  const textOk = sqlTextOk ?? (() => false);
  return leaves(c).every(([, s]) => [...s].length <= 2000 && textOk(s));
}

/* ── fixtures ───────────────────────────────────────────────────────────── */

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const CUSTOMER = "aaaaaaaa-0000-4000-8000-000000000002";
const WS = "cccccccc-0000-4000-8000-000000000001";
const OTHER_WS = "cccccccc-0000-4000-8000-000000000002";
const IMG1 = "11111111-0000-4000-8000-000000000001";
const IMG2 = "11111111-0000-4000-8000-000000000002";
const IMG3 = "11111111-0000-4000-8000-000000000003";
const IMG4 = "11111111-0000-4000-8000-000000000004";
const IMG7 = "11111111-0000-4000-8000-000000000007";
const EXT = "11111111-0000-4000-8000-00000000000e";
const VID = "11111111-0000-4000-8000-0000000000aa";
const NOFILE = "11111111-0000-4000-8000-0000000000bb";
const MISSING = "11111111-0000-4000-8000-0000000000cc";
const T_A = "2026-10-01T08:00:00.000Z";
const T_B = "2026-10-02T08:00:00.000Z";
const T_C = "2026-10-03T08:00:00.000Z";
const T_D = "2026-10-04T08:00:00.000Z";
const ROW_TS = "2026-10-10T10:00:00.5+00:00";
const NOW_TS = "2026-10-16T12:00:00+00:00";

type Txt = { pl?: unknown; en?: unknown; de?: unknown; [k: string]: unknown };
type RawStep = { title: Txt; body: Txt; art: unknown; [k: string]: unknown };
type Raw = {
  tutorial: { title: Txt; body: Txt; steps: RawStep[]; [k: string]: unknown };
  starter: { title: Txt; body: Txt; [k: string]: unknown };
  [k: string]: unknown;
};

/** A complete, already-tidy admin guide with `n` steps. */
function validContent(n = 3): Raw {
  return {
    tutorial: {
      title: { pl: "Jak to działa", en: "How it works", de: "So funktioniert es" },
      body: { pl: "Krótki wstęp.", en: "A short intro.", de: "Eine kurze Einführung." },
      steps: Array.from({ length: n }, (_, i) => ({
        title: { pl: `Krok ${i + 1}`, en: `Step ${i + 1}`, de: `Schritt ${i + 1}` },
        body: { pl: `Opis ${i + 1}.`, en: `Body ${i + 1}.`, de: `Text ${i + 1}.` },
        art: GUIDE_ARTS[i % GUIDE_ARTS.length],
      })),
    },
    starter: {
      title: { pl: "Przykłady", en: "Examples", de: "Beispiele" },
      body: { pl: "Tak to wygląda.", en: "This is how it looks.", de: "So sieht es aus." },
    },
  };
}
const mut = (f: (c: Raw) => void, n = 3): Raw => { const c = validContent(n); f(c); return c; };
const problemSeen = new Set<string>();
function problem(x: unknown): string {
  const r = normalizeGuideContent(x);
  if (!r.ok) problemSeen.add(r.problem);
  return r.ok ? "ok" : r.problem;
}

function rslot(key: string, o: Partial<ResolvedSlot> = {}): ResolvedSlot {
  return {
    key, mediaType: "image", alt: "", fit: "cover", position: "center center",
    autoplay: true, muted: true, loop: true, controls: false, desktop: `https://cdn.test/${key}.png`, ...o,
  };
}
const slotMap = (...s: ResolvedSlot[]): SlotMap => new Map(s.map((x) => [x.key, x]));
const pub = (o: Partial<PublishedGuide> = {}): PublishedGuide =>
  ({ tutorialEnabled: true, starterEnabled: true, version: 1, tutorial: null, starter: null, ...o });

/** A row as media_slots_resolve_v2 returns it. */
const resolveRow = (key: string, o: Row = {}): Row => ({
  slot_key: key, media_type: "image", alt_text: null, object_fit: "cover", object_position: "center center",
  autoplay: true, muted: true, loop: true, controls: false, desktop_path: null, desktop_url: `https://cdn.test/${key}.png`,
  desktop_width: 1600, desktop_height: 1000, desktop_variants: null, tablet_path: null, tablet_url: null,
  mobile_path: null, mobile_url: null, poster_path: null, poster_url: null, ...o,
});
/** A row as tool_guides_published() returns it. */
const pubRow = (tool: string, o: Row = {}): Row => ({
  tool_key: tool, tutorial_enabled: true, starter_enabled: true, tutorial_version: 1, tutorial: null, starter: null, ...o,
});

type AnonError = { code?: string; message: string };
const anonKeys: string[][] = [];
/** What the ANONYMOUS client (the shared cache's reader) answers. */
function setAnon(o: { published?: Row[] | AnonError; slots?: Row[] | AnonError } = {}) {
  anonKeys.length = 0;
  iceState.anonRpc = async (name: string, args?: unknown) => {
    if (name === "tool_guides_published") {
      const p = o.published ?? [];
      return Array.isArray(p) ? { data: p, error: null } : { data: null, error: p };
    }
    if (name === "media_slots_resolve_v2") {
      const keys = ((args as { p_keys?: string[] } | undefined)?.p_keys) ?? [];
      anonKeys.push(keys);
      const s = o.slots ?? [];
      return Array.isArray(s) ? { data: s.filter((r) => keys.includes(r.slot_key as string)), error: null } : { data: null, error: s };
    }
    return { data: null, error: { code: "PGRST202", message: `function ${name} not found` } };
  };
}

const ALL_ACTIVE = (): Record<string, { status: string }> =>
  Object.fromEntries(TOOLS.map((t) => [t, { status: "ACTIVE" }]));

/** A fresh request: a signed-in user, empty tables, nothing recorded. */
function baseDb(userId: string | null = CUSTOMER): FakeDb {
  resetIceState();
  resetGuideState();
  const db = new FakeDb();
  db.user = userId ? { id: userId } : null;
  db.tables.profiles = [{ id: ADMIN, role: "admin" }, { id: CUSTOMER, role: "user" }];
  db.tables.workspace_members = [{
    user_id: CUSTOMER, workspace_id: WS, role: "owner", created_at: "2026-01-01T00:00:00Z",
    workspaces: { id: WS, name: "Sklep", owner_id: CUSTOMER, logo_url: null, brand_color: null, company_name: null },
  }];
  iceState.client = db.client();
  setAnon();
  return db;
}

/** An admin's request with a media library and the 0142 CHECK in force. */
function adminDb(): FakeDb {
  const db = baseDb(ADMIN);
  iceState.viewerAdmin = true;
  const asset = (id: string, kind: string, path: string | null, external: string | null = null): Row =>
    ({ id, kind, storage_path: path, external_url: external, mime: kind === "image" ? "image/png" : "video/mp4" });
  db.tables.media_assets = [
    asset(IMG1, "image", "lib/1.png"), asset(IMG2, "image", "lib/2.png"), asset(IMG3, "image", "lib/3.png"),
    asset(IMG4, "image", "lib/4.png"), asset(IMG7, "image", "lib/7.png"), asset(EXT, "image", null, "https://img.example/x.png"),
    asset(VID, "video", "lib/v.mp4"), asset(NOFILE, "image", null),
  ];
  db.rpcs.media_slots_write = (args) =>
    ({ data: Object.fromEntries((args.p_writes as Row[]).map((w) => [w.key as string, NOW_TS])), error: null });
  db.checks.tool_guides = (row) => (contentOk(row.content) ? null : "new row violates check constraint \"tool_guides_content_check\"");
  return db;
}

type Client = Parameters<typeof toolIsLive>[0];
type SvcClient = Parameters<typeof hasToolResults>[0];
const asClient = (db: FakeDb) => db.client() as unknown as Client;
const asSvc = (db: FakeDb) => db.client() as unknown as SvcClient;

/* ══ A. REGISTRY ═══════════════════════════════════════════════════════════ */

const EXCLUDED = ["editor", "tool_upscale", "tool_expand", "tool_watermark", "video"];

function sectionA() {
  console.log("\nA. REGISTRY — guide tools, illustrations, fallbacks, mapping, slot keys");

  check(`A1 GUIDE_TOOL_KEYS lists 15 distinct tools (${TOOLS.length})`, TOOLS.length === 15 && new Set(TOOLS).size === 15);
  const aiKeys: readonly string[] = AI_TOOL_KEYS;
  const notAi = TOOLS.filter((k) => !aiKeys.includes(k));
  check("A2 every guide tool is an admin tool key (GUIDE_TOOL_KEYS ⊂ AI_TOOL_KEYS)", notAi.length === 0, short(notAi));
  const rest = aiKeys.filter((k) => !isGuideTool(k)).sort();
  check(`A3 the admin tools WITHOUT a guide are exactly the gallery-less ones (${EXCLUDED.join(", ")})`,
    same(rest, [...EXCLUDED].sort()), rest.join(", "));
  for (const k of EXCLUDED) check(`A4 isGuideTool("${k}") is false`, !isGuideTool(k));
  const junk: unknown[] = [undefined, null, "", "Prompts", " prompts", "prompts ", "image_retouch", "__proto__", "toString", 42, {}, ["prompts"]];
  check("A5 isGuideTool refuses non-strings, case/space variants, operations and prototype names", junk.every((v) => !isGuideTool(v)));
  const notFeature = TOOLS.filter((k) => !isFeatureKey(k));
  check("A6 every guide tool is a key of the availability switchboard (toolIsLive reads availability[tool])", notFeature.length === 0, short(notFeature));
  const migs = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).map((f) => read(join("supabase/migrations", f)));
  const seeders = migs.filter((sql) => /insert\s+into\s+public\.ai_tools\b/i.test(sql));
  const unseeded = TOOLS.filter((k) => !seeders.some((sql) => sql.includes(`'${k}'`)));
  check("A7 every guide tool is seeded into ai_tools by a migration (tool_guides.tool_key references ai_tools)", unseeded.length === 0, short(unseeded));
  const keyPattern = /p_tool_key !~ '([^']+)'/.exec(SQL_0142)?.[1];
  const keyRe = keyPattern ? new RegExp(keyPattern) : null;
  check("A8 every guide tool passes mark_tool_tutorial_seen's key pattern in 0142", !!keyRe && TOOLS.every((k) => keyRe.test(k)), keyPattern);

  check("A9 DEFAULT_STEP_ARTS has exactly the guide tools as keys", same(Object.keys(DEFAULT_STEP_ARTS).sort(), [...TOOLS].sort()));
  const badArts = TOOLS.filter((k) => {
    const a = DEFAULT_STEP_ARTS[k];
    return !(a.length >= 1 && a.length <= GUIDE_MAX_STEPS && a.every((x) => isGuideArt(x)));
  });
  check(`A10 every tool ships 1..${GUIDE_MAX_STEPS} steps, each a known illustration`, badArts.length === 0, short(badArts));
  check("A11 GUIDE_ARTS has no duplicates and GUIDE_MAX_STEPS is 6",
    new Set(GUIDE_ARTS).size === GUIDE_ARTS.length && GUIDE_MAX_STEPS === 6);
  const used = new Set(TOOLS.flatMap((k) => DEFAULT_STEP_ARTS[k]));
  const unused = GUIDE_ARTS.filter((a) => !used.has(a));
  check("A11b every illustration is used by at least one shipped tutorial (no dead drawing)", unused.length === 0, short(unused));
  const artSrc = read("components/tool-guide/guide-art.tsx");
  const scenesBlock = /const SCENES: Record<GuideArt, \(\) => ReactNode> = \{([\s\S]*?)\n\};/.exec(artSrc)?.[1] ?? "";
  const sceneKeys = [...scenesBlock.matchAll(/^ {2}([a-z]+): \(\) =>/gm)].map((m) => m[1]);
  check(`A12 guide-art.tsx draws exactly the GUIDE_ARTS (${sceneKeys.length} scenes)`, same([...sceneKeys].sort(), [...GUIDE_ARTS].sort()),
    `missing ${short(GUIDE_ARTS.filter((a) => !sceneKeys.includes(a)))}; extra ${short(sceneKeys.filter((a) => !isGuideArt(a)))}`);

  check("A13 STARTER_FALLBACK_SLOTS has exactly the guide tools as keys, each with ≥ 1 slot",
    same(Object.keys(STARTER_FALLBACK_SLOTS).sort(), [...TOOLS].sort()) && TOOLS.every((k) => STARTER_FALLBACK_SLOTS[k].length >= 1));
  const unknownSlots = TOOLS.flatMap((k) => STARTER_FALLBACK_SLOTS[k].filter((s) => !isKnownSlot(s)).map((s) => `${k}:${s}`));
  check("A14 every starter fallback slot is a declared MEDIA_SLOTS key (isKnownSlot)", unknownSlots.length === 0, `not in MEDIA_SLOTS: ${short(unknownSlots)}`);
  const notCard = TOOLS.flatMap((k) => STARTER_FALLBACK_SLOTS[k].filter((s) => {
    const d = slotDef(s);
    return !d || d.slotName !== "card" || (d.entityType !== "tool" && d.entityType !== "workflow");
  }).map((s) => `${k}:${s}`));
  check("A14b every fallback is a catalogue CARD picture (tool or workflow), never a hero or a home section", notCard.length === 0, short(notCard));

  const retouchOp = /export const RETOUCH_OPERATION = "([^"]+)"/.exec(read("lib/server/retouch.ts"))?.[1];
  check(`A15 Retusz's RETOUCH_OPERATION ("${retouchOp}") maps to the retouch guide`, !!retouchOp && guideToolForOperation(retouchOp) === "retouch");
  check(`A16 THUMBNAIL_OPERATION ("${THUMBNAIL_OPERATION}") maps to the ecommerce_thumbnail guide`, guideToolForOperation(THUMBNAIL_OPERATION) === "ecommerce_thumbnail");
  const fashionBad = FASHION_TOOLS.filter((t) => t.operation !== t.toolKey || guideToolForOperation(t.operation) !== t.toolKey || !isGuideTool(t.toolKey)).map((t) => t.toolKey);
  check(`A17 every Moda tool's operation (= its admin toolKey) maps to its own guide (${FASHION_TOOLS.length} tools)`, FASHION_TOOLS.length === 5 && fashionBad.length === 0, short(fashionBad));
  const noOp: (string | undefined)[] = [undefined, "", "none", "foo", "tool_upscale", "editor", "video", "IMAGE_RETOUCH", "image_retouch "];
  const leaked = noOp.filter((o) => guideToolForOperation(o) !== null).map(String);
  check("A18 an unknown, empty, 'none' or gallery-less operation maps to no guide", leaked.length === 0, short(leaked));

  const paths: [string | null | undefined, GuideToolKey | null][] = [
    ["/generator", "generator"], ["/generator/", "generator"], ["/generator//", "generator"],
    ["/prompts", "prompts"], ["/prompts/", "prompts"],
    ["/k/ecommerce/packshot", "prompts"], ["/k/moda/street", "prompts"], ["/k/moda/street/", "prompts"],
    ["/prompts/abc", null], ["/retusz", null], ["/k/moda", null], ["/k/moda/", null], ["/k/moda/street/extra", null],
    ["/k//x", null], ["/generatorx", null], ["/GENERATOR", null], ["/", null], ["", null], [null, null], [undefined, null],
  ];
  for (const [p, want] of paths) {
    const got = guideToolForPath(p);
    check(`A19 guideToolForPath(${JSON.stringify(p) ?? "undefined"}) → ${want ?? "null"}`, got === want, `got ${got}`);
  }
  const genPaths = FEATURE_REGISTRY.filter((f) => f.key === "prompts" || f.key === "generator");
  check("A20 the generators' own feature routes resolve to their own guide (/prompts → prompts, /generator → generator)",
    genPaths.length === 2 && genPaths.every((f) => guideToolForPath(f.path) === f.key));

  const surf = (s: string) => TOOLS.filter((t) => guideSurface(t) === s).sort();
  check("A21 guideSurface: resize/compress are the browser-side batch", same(surf("batch"), ["compress", "resize"]));
  check("A21b guideSurface: the four tool_* photo tools are 'photo'", same(surf("photo"), ["tool_ai_background", "tool_ai_shadow", "tool_remove_bg", "tool_white_bg"]));
  check("A21c guideSurface: every other guide tool lists generations (9)", surf("generations").length === 9 && surf("generations").every((t) => !t.startsWith("tool_")));
  const photoBad = PHOTO_TOOLS.filter((s) => {
    const key = `tool_${s}`;
    return !isGuideTool(key) || photoSlugOf(key) !== s;
  });
  check(`A22 every photo tool slug (${PHOTO_TOOLS.join(", ")}) is a guide tool tool_<slug> whose photoSlugOf is the slug`, photoBad.length === 0, short([...photoBad]));
  check("A22b photoSlugOf is null for every non-photo guide tool", TOOLS.filter((t) => guideSurface(t) !== "photo").every((t) => photoSlugOf(t) === null));
  const photoRoutes = TOOLS.filter((t) => guideSurface(t) === "photo").filter((t) => FEATURE_REGISTRY.find((f) => f.key === t)?.path !== `/tools/${photoSlugOf(t)}`);
  check("A23 each photo tool's feature route is /tools/<photoSlugOf> (what photo-tool.tsx turns back into tool_<slug>)", photoRoutes.length === 0, short(photoRoutes));

  const all = TOOLS.flatMap((k) => [...Array.from({ length: GUIDE_MAX_STEPS }, (_, i) => guideSlotKey(k, "tutorial", i + 1)), guideSlotKey(k, "starter", 1)]);
  check("A24 guideSlotKey is guide.<tool>.<kind>.<n>",
    guideSlotKey("retouch", "tutorial", 3) === "guide.retouch.tutorial.3" && guideSlotKey("tool_white_bg", "starter", 1) === "guide.tool_white_bg.starter.1");
  check(`A25 isGuideSlotKey accepts tutorial.1..6 and starter.1 of every guide tool (${all.length} keys)`, all.every(isGuideSlotKey), short(all.filter((k) => !isGuideSlotKey(k))));
  const rejects = [
    "guide.retouch.tutorial.0", "guide.retouch.tutorial.7", "guide.retouch.tutorial.10", "guide.retouch.starter.0", "guide.retouch.starter.2",
    "guide.editor.tutorial.1", "guide.video.starter.1", "guide.tool_upscale.tutorial.1", "guide.retouch.hero.1", "guide.retouch.tutorial",
    "guide.retouch.tutorial.1.x", "guide..tutorial.1", "tools.retouch.card", "Guide.retouch.tutorial.1", "guide.retouch.tutorial.-1",
    "guide.retouch.tutorial.1 ", " guide.retouch.tutorial.1", "guide.retouch.tutorial.1.5", "guide.Retouch.tutorial.1", "",
  ];
  check("A26 isGuideSlotKey refuses other tools, kinds, out-of-range numbers and malformed keys", rejects.every((k) => !isGuideSlotKey(k)), short(rejects.filter(isGuideSlotKey)));
  defect("A27 isGuideSlotKey refuses non-canonical numbers (tutorial.01, starter.01) that guideSlotKey never produces",
    !isGuideSlotKey("guide.retouch.tutorial.01") && !isGuideSlotKey("guide.retouch.starter.01") && !isGuideSlotKey("guide.retouch.tutorial.006"),
    "lib/tool-guides.ts:167 /(\\d+)$/ + Number() accepts \"guide.retouch.tutorial.01\" — a key nothing reads; fix: match (?:[1-9]\\d*) or compare key === guideSlotKey(tool, kind, n)");
  check("A28 no guide key is a MEDIA_SLOTS key, and no MEDIA_SLOTS key reads as a guide key (Admin → Media never lists them)",
    all.every((k) => !isKnownSlot(k)) && MEDIA_SLOTS.every((s) => !isGuideSlotKey(s.key)));
  const keyIssues = TOOLS.filter((t) => {
    const ks = guideImageKeys(t);
    const own = [...Array.from({ length: GUIDE_MAX_STEPS }, (_, i) => guideSlotKey(t, "tutorial", i + 1)), guideSlotKey(t, "starter", 1)];
    return new Set(ks).size !== ks.length || ks.length > 200 || !own.every((k) => ks.includes(k))
      || !STARTER_FALLBACK_SLOTS[t].every((k) => ks.includes(k)) || ks.length !== own.length + STARTER_FALLBACK_SLOTS[t].length;
  });
  check("A29 guideImageKeys(tool): unique, ≤ 200, the 7 guide slots + the starter fallbacks and nothing else", keyIssues.length === 0, short(keyIssues));
  const union = TOOLS.flatMap((t) => guideImageKeys(t));
  check(`A30 even every tool's picture keys together stay under the resolver's 200-key bound (${new Set(union).size})`, new Set(union).size <= 200);
}

/* ══ B. CONTENT VALIDATION ═════════════════════════════════════════════════ */

function sectionB() {
  console.log("\nB. CONTENT — normalizeGuideContent, every refusal, tidying, DB CHECK parity");

  const v = validContent(3);
  const r = normalizeGuideContent(v);
  check("B1 a full, valid pl/en/de guide is accepted unchanged", r.ok && same(r.content, v), r.ok ? JSON.stringify(r.content).slice(0, 120) : r.problem);
  check("B1b … and what it returns passes the database CHECK (tool_guide_content_ok)", r.ok && contentOk(r.content));

  const ws = normalizeGuideContent(mut((c) => { c.tutorial.title.pl = "  Jak \t  to   działa  "; }));
  check("B2 spaces and tabs are collapsed and trimmed", ws.ok && ws.content.tutorial.title.pl === "Jak to działa", ws.ok ? JSON.stringify(ws.content.tutorial.title.pl) : ws.problem);
  const nl = normalizeGuideContent(mut((c) => { c.tutorial.steps[0].body.en = "Line 1\nLine 2\r\n\r\nLine 3\n  Line 4"; }));
  check("B3 line breaks (\\n, \\r\\n, runs of them) become ONE space — one paragraph per field",
    nl.ok && nl.content.tutorial.steps[0].body.en === "Line 1 Line 2 Line 3 Line 4", nl.ok ? JSON.stringify(nl.content.tutorial.steps[0].body.en) : nl.problem);

  const nonObjects: unknown[] = [null, undefined, "guide", 42, true, [], () => 1];
  check("B4 not an object (null, undefined, string, number, boolean, array, function) → shape",
    nonObjects.every((x) => problem(x) === "shape"), nonObjects.map((x) => problem(x)).join(","));
  check("B5 missing steps → shape", problem(mut((c) => { delete (c.tutorial as Record<string, unknown>).steps; })) === "shape");
  check("B5b steps not an array → shape", problem(mut((c) => { (c.tutorial as Record<string, unknown>).steps = { 0: c.tutorial.steps[0] }; })) === "shape");
  check("B5c no tutorial at all → shape", problem({ starter: validContent().starter }) === "shape");
  check("B6 0 steps → steps_min", problem(validContent(0)) === "steps_min");
  check("B6b 7 steps → steps_max", problem(validContent(7)) === "steps_max");
  check("B6c 1 step and 6 steps (the bounds) are accepted", problem(validContent(1)) === "ok" && problem(validContent(6)) === "ok");
  const badArts: unknown[] = ["nope", "", undefined, null, 3, "Upload", " upload"];
  check("B7 an unknown illustration → art (unknown name, empty, missing, number, wrong case, padded)",
    badArts.every((a) => problem(mut((c) => { c.tutorial.steps[1].art = a; })) === "art"));

  check("B8 tutorial title without Polish → required (English alone is not enough)", problem(mut((c) => { delete c.tutorial.title.pl; })) === "required");
  check("B8b step title without Polish → required", problem(mut((c) => { delete c.tutorial.steps[2].title.pl; })) === "required");
  check("B8c starter title without Polish → required", problem(mut((c) => { c.starter.title = { en: "Examples" }; })) === "required");
  check("B8d no starter at all → required (its title is mandatory)", problem(mut((c) => { delete (c as Record<string, unknown>).starter; })) === "required");
  check("B8e a Polish title that is only whitespace / line breaks → required",
    problem(mut((c) => { c.tutorial.title.pl = "  \t "; })) === "required" && problem(mut((c) => { c.tutorial.steps[0].title.pl = "\n\r\n"; })) === "required");
  check("B8f a Polish title that is null → required", problem(mut((c) => { c.starter.title.pl = null; })) === "required");

  type Setter = (c: Raw, v: string) => void;
  const FIELDS: [string, keyof typeof GUIDE_LIMITS, Setter][] = [
    ["tutorial title", "tutorialTitle", (c, s) => { c.tutorial.title.de = s; }],
    ["tutorial body", "tutorialBody", (c, s) => { c.tutorial.body.de = s; }],
    ["step title", "stepTitle", (c, s) => { c.tutorial.steps[1].title.de = s; }],
    ["step body", "stepBody", (c, s) => { c.tutorial.steps[1].body.de = s; }],
    ["starter title", "starterTitle", (c, s) => { c.starter.title.de = s; }],
    ["starter body", "starterBody", (c, s) => { c.starter.body.de = s; }],
  ];
  for (const [label, limit, set] of FIELDS) {
    const max = GUIDE_LIMITS[limit];
    const atMax = problem(mut((c) => set(c, "x".repeat(max))));
    const over = problem(mut((c) => set(c, "x".repeat(max + 1))));
    check(`B9 ${label}: ${max} characters accepted, ${max + 1} → too_long`, atMax === "ok" && over === "too_long", `${atMax}/${over}`);
  }
  const spaced = problem(mut((c) => { c.tutorial.title.en = `${"ab ".repeat(26)}   ${" ".repeat(10)}`; }));
  check("B9b the limit applies to the TIDIED text (runs of spaces collapse before counting)", spaced === "ok", spaced);
  for (const [label, , set] of FIELDS) {
    const lt = problem(mut((c) => set(c, "Przed <b>po</b>")));
    const gt = problem(mut((c) => set(c, "a > b")));
    check(`B10 ${label}: markup brackets < > → markup`, lt === "markup" && gt === "markup", `${lt}/${gt}`);
  }
  const INVIS: [string, string][] = [
    ["ZWSP U+200B", "​"], ["ZWJ U+200D", "‍"], ["BOM U+FEFF", "﻿"], ["RLO U+202E", "‮"], ["LRI U+2066", "⁦"],
    ["word joiner U+2060", "⁠"], ["soft hyphen U+00AD", "­"], ["line separator U+2028", " "], ["vertical tab U+000B", "\u000B"],
    ["NUL U+0000", "\u0000"], ["C1 U+0085", "\u0085"], ["tag char U+E0041", "\u{E0041}"], ["Hangul filler U+3164", "ㅤ"],
  ];
  const slipped = INVIS.filter(([, ch]) => problem(mut((c) => { c.tutorial.steps[0].body.en = `Przed${ch}po`; })) !== "invisible").map(([n]) => n);
  check(`B11 every invisible / direction / control character is refused → invisible (${INVIS.length} kinds)`, slipped.length === 0, short(slipped));
  const tab = normalizeGuideContent(mut((c) => { c.starter.body.pl = "A\tB"; }));
  check("B11b a TAB is ordinary whitespace (collapsed to a space), not an invisible-character refusal",
    tab.ok && tab.content.starter.body.pl === "A B");
  const dbRefuses = sqlTextOk ? INVIS.every(([, ch]) => !sqlTextOk(`a${ch}b`)) && !sqlTextOk("a<b") && !sqlTextOk("a>b") : false;
  check("B11c parity: the SQL content_text_ok (0141, read from the migration) refuses every one of those too, and < >", dbRefuses);
  const jsOnly = INVIS.filter(([, ch]) => hasInvisible(ch) !== true).map(([n]) => n);
  check("B11d parity: lib/ice/stega hasInvisible flags every one of them", jsOnly.length === 0, short(jsOnly));

  const noisy = mut((c) => {
    c.tutorial.title.fr = "Comment ça marche";
    c.tutorial.steps[0].image = "https://evil.example/x.png";
    c.tutorial.steps[0].id = "s1";
    c.tutorial.steps[0].title.es = "Paso";
    c.tutorial.extra = { x: 1 };
    c.starter.cta = "https://evil.example";
    c.evil = "<script>";
  });
  const nr = normalizeGuideContent(noisy);
  check("B12 unknown locales and keys are dropped — the structure is fixed by the validator, never by the browser",
    nr.ok && same(nr.content, validContent(3)), nr.ok ? JSON.stringify(nr.content).slice(0, 160) : nr.problem);
  const bodies = normalizeGuideContent(mut((c) => {
    delete (c.tutorial as Record<string, unknown>).body;
    c.tutorial.steps[0].body = { pl: "   ", en: "\n" };
    (c.tutorial.steps[1] as Record<string, unknown>).body = null;
    c.starter.body = {};
  }));
  check("B13 optional bodies (missing, null, blank) are accepted and kept EMPTY — no text is invented",
    bodies.ok && same(bodies.content.tutorial.body, {}) && same(bodies.content.tutorial.steps[0].body, {})
      && same(bodies.content.tutorial.steps[1].body, {}) && same(bodies.content.starter.body, {}));
  const shapes: [string, Raw | Record<string, unknown>][] = [
    ["title as a string", mut((c) => { (c.tutorial as Record<string, unknown>).title = "Tytuł"; })],
    ["title as an array", mut((c) => { (c.tutorial as Record<string, unknown>).title = ["Tytuł"]; })],
    ["title.pl as a number", mut((c) => { c.tutorial.title.pl = 7; })],
    ["a step that is null", mut((c) => { (c.tutorial.steps as unknown[])[1] = null; })],
    ["a step that is a string", mut((c) => { (c.tutorial.steps as unknown[])[0] = "krok"; })],
    ["tutorial as a string", { tutorial: "x", starter: validContent().starter }],
    ["starter as a string", mut((c) => { (c as Record<string, unknown>).starter = "x"; })],
    ["starter body as a number", mut((c) => { (c.starter as Record<string, unknown>).body = 5; })],
  ];
  const wrong = shapes.filter(([, x]) => problem(x) !== "shape").map(([n, x]) => `${n}:${problem(x)}`);
  check(`B14 wrong types anywhere → shape (${shapes.length} cases)`, wrong.length === 0, short(wrong));
  const once = normalizeGuideContent(mut((c) => { c.tutorial.title.pl = "  A   b \n c "; }));
  const twice = once.ok ? normalizeGuideContent(once.content) : once;
  check("B15 idempotent: validating the validator's own output changes nothing", once.ok && twice.ok && same(once.content, twice.content));
  const big = normalizeGuideContent(mut((c) => {
    for (const s of c.tutorial.steps) for (const l of ["pl", "en", "de"] as const) { s.title[l] = "T".repeat(80); s.body[l] = "B".repeat(400); }
  }, 6));
  check("B16 the largest content the validator allows (6 full steps × 3 languages) still fits the 64 KiB / 2000-char CHECK",
    big.ok && contentOk(big.content));
  const union = /export type GuideProblem =([\s\S]*?);/.exec(read("lib/tool-guides.ts"))?.[1] ?? "";
  const codes = [...union.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  check(`B17 every GuideProblem code (${codes.join(", ")}) was produced by a case above`,
    codes.length === 8 && codes.every((c) => problemSeen.has(c)) && [...problemSeen].every((c) => codes.includes(c)),
    `not reached: ${short(codes.filter((c) => !problemSeen.has(c)))}`);
}

/* ══ C. SHIPPED DEFAULTS ═══════════════════════════════════════════════════ */

const PROVIDERS = /gemini|openai|nano\s*banana|photoroom|\bgpt\b|gpt[-\s]?image|sunburst|imagen|dall[-\s·]?e|midjourney|stable\s*diffusion/i;

function sectionC() {
  console.log("\nC. DEFAULTS — toolGuideDefaults × pl/en/de, limits, cleanliness, validator + CHECK");

  const missing: string[] = [];
  const stepMismatch: string[] = [];
  const emptyStep: string[] = [];
  for (const tool of TOOLS) for (const l of LOCALES) {
    const base = `toolGuideDefaults.${tool}`;
    for (const k of ["tutorial.title", "tutorial.body", "starter.title", "starter.body"]) {
      const s = lookup(DICTS[l], `${base}.${k}`);
      if (typeof s !== "string" || !s.trim()) missing.push(`${l}:${tool}.${k}`);
    }
    const steps = (((DICTS[l].toolGuideDefaults as Dict | undefined)?.[tool] as Dict | undefined)?.tutorial as Dict | undefined)?.steps as Dict | undefined;
    const names = Object.keys(steps ?? {});
    const want = DEFAULT_STEP_ARTS[tool].map((_, i) => `s${i + 1}`);
    if (!same(names, want)) stepMismatch.push(`${l}:${tool} has ${names.join("/")} want ${want.join("/")}`);
    for (const s of want) {
      if (!(lookup(DICTS[l], `${base}.tutorial.steps.${s}.title`) ?? "").trim()) emptyStep.push(`${l}:${tool}.${s}.title`);
      if (!(lookup(DICTS[l], `${base}.tutorial.steps.${s}.body`) ?? "").trim()) emptyStep.push(`${l}:${tool}.${s}.body`);
    }
  }
  check("C1 every tool × locale has tutorial.title/body and starter.title/body (non-empty)", missing.length === 0, short(missing));
  check("C2 every tool × locale has exactly steps s1..sN, N = DEFAULT_STEP_ARTS length", stepMismatch.length === 0, short(stepMismatch, 4));
  check("C3 every shipped step has a non-empty title AND body in every locale", emptyStep.length === 0, short(emptyStep));
  const nsTools = LOCALES.map((l) => Object.keys((DICTS[l].toolGuideDefaults as Dict | undefined) ?? {}).sort());
  check("C4 toolGuideDefaults holds exactly the 15 guide tools in pl, en and de", nsTools.every((ks) => same(ks, [...TOOLS].sort())));

  const LIMIT_OF: [RegExp, number][] = [
    [/\.tutorial\.title$/, GUIDE_LIMITS.tutorialTitle], [/\.tutorial\.body$/, GUIDE_LIMITS.tutorialBody],
    [/\.steps\.s\d+\.title$/, GUIDE_LIMITS.stepTitle], [/\.steps\.s\d+\.body$/, GUIDE_LIMITS.stepBody],
    [/\.starter\.title$/, GUIDE_LIMITS.starterTitle], [/\.starter\.body$/, GUIDE_LIMITS.starterBody],
  ];
  const all = LOCALES.flatMap((l) => leaves(DICTS[l].toolGuideDefaults, [l, "toolGuideDefaults"]));
  const unlimited = all.filter(([p]) => !LIMIT_OF.some(([re]) => re.test(p))).map(([p]) => p);
  check(`C5 every default string is a known field (${all.length} strings)`, unlimited.length === 0, short(unlimited));
  const tooLong = all.filter(([p, s]) => s.length > (LIMIT_OF.find(([re]) => re.test(p))?.[1] ?? 0)).map(([p, s]) => `${p} (${s.length})`);
  check("C6 every default string is within its GUIDE_LIMITS bound (so an admin can save it unedited)", tooLong.length === 0, short(tooLong));
  const markup = all.filter(([, s]) => /[<>]/.test(s)).map(([p]) => p);
  check("C7 no default string contains markup brackets < >", markup.length === 0, short(markup));
  const invisible = all.filter(([, s]) => hasInvisible(s) || /[\r\n]/.test(s)).map(([p]) => p);
  check("C8 no default string contains invisible characters or line breaks", invisible.length === 0, short(invisible));
  const placeholders = all.filter(([, s]) => /[{}]/.test(s)).map(([p]) => p);
  check("C9 no default string contains a {placeholder} (guide copy is never interpolated)", placeholders.length === 0, short(placeholders));
  const untidy = all.filter(([, s]) => normaliseText(s) !== s).map(([p]) => p);
  check("C10 every default string is already tidy (no double spaces, no padding) — the editor would not change it", untidy.length === 0, short(untidy));
  const named = [...all, ...LOCALES.flatMap((l) => leaves(DICTS[l].toolGuide, [l, "toolGuide"]))].filter(([, s]) => PROVIDERS.test(s)).map(([p, s]) => `${p}: ${PROVIDERS.exec(s)?.[0]}`);
  check("C11 no default or UI string names a provider or model (Gemini, OpenAI, Nano Banana, Photoroom, GPT, …)", named.length === 0, short(named));
  const untranslated = TOOLS.filter((t) => ["en", "de"].some((l) => lookup(DICTS[l as Locale], `toolGuideDefaults.${t}.tutorial.title`) === lookup(DICTS.pl, `toolGuideDefaults.${t}.tutorial.title`)));
  check("C12 the English and German tutorial titles are really translated (differ from Polish)", untranslated.length === 0, short(untranslated));

  const dgBad: string[] = [];
  for (const tool of TOOLS) {
    const d = defaultGuideContent(tool);
    const ok = LOCALES.every((l) =>
      d.tutorial.title[l] === lookup(DICTS[l], `toolGuideDefaults.${tool}.tutorial.title`)
      && d.starter.body[l] === lookup(DICTS[l], `toolGuideDefaults.${tool}.starter.body`)
      && d.tutorial.steps.every((s, i) => s.title[l] === lookup(DICTS[l], `toolGuideDefaults.${tool}.tutorial.steps.s${i + 1}.title`)))
      && same(d.tutorial.steps.map((s) => s.art), DEFAULT_STEP_ARTS[tool]);
    if (!ok) dgBad.push(tool);
  }
  check("C13 defaultGuideContent(tool) carries all 3 locales straight from the dictionaries, with the shipped arts", dgBad.length === 0, short(dgBad));
  const refused = TOOLS.map((t) => [t, normalizeGuideContent(defaultGuideContent(t))] as const).filter(([, r]) => !r.ok).map(([t, r]) => `${t}:${r.ok ? "" : r.problem}`);
  check("C14 normalizeGuideContent(defaultGuideContent(tool)) is ok for every tool — the admin form can save the defaults as they are", refused.length === 0, short(refused));
  const changed = TOOLS.filter((t) => { const r = normalizeGuideContent(defaultGuideContent(t)); return !r.ok || !same(r.content, defaultGuideContent(t)); });
  check("C15 … and comes back byte-identical (nothing to tidy)", changed.length === 0, short(changed));
  const checkFails = TOOLS.filter((t) => !contentOk(defaultGuideContent(t)));
  check("C16 every tool's default content passes the database CHECK tool_guide_content_ok", sqlTextOk !== null && checkFails.length === 0, short(checkFails));

  const uiSrc = readdirSync("components/tool-guide").map((f) => read(join("components/tool-guide", f))).join("\n");
  const uiKeys = [...new Set([...uiSrc.matchAll(/t\("(toolGuide\.[A-Za-z.]+)"/g)].map((m) => m[1]))];
  const uiMissing = uiKeys.flatMap((k) => LOCALES.filter((l) => !(lookup(DICTS[l], k) ?? "").trim()).map((l) => `${l}:${k}`));
  check(`C17 every toolGuide.* key the components use exists in pl/en/de (${uiKeys.length} keys)`, uiKeys.length >= 12 && uiMissing.length === 0, short(uiMissing));
  const vars = (s: string | undefined) => [...(s ?? "").matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  const varBad = ["toolGuide.counter", "toolGuide.stepLabel"].filter((k) => !(vars(lookup(DICTS.pl, k)) && LOCALES.every((l) => vars(lookup(DICTS[l], k)) === vars(lookup(DICTS.pl, k)))));
  check("C18 counter {n}/{total} and stepLabel {n} keep their placeholders in every locale", varBad.length === 0, short(varBad));
}

/* ══ D. resolveGuide ═══════════════════════════════════════════════════════ */

function sectionD() {
  console.log("\nD. resolveGuide — switches, versions, language fallback, admin steps, pictures");
  const EMPTY: SlotMap = new Map();
  const dict = (l: Locale, k: string) => lookup(DICTS[l], k) ?? "";

  const none = resolveGuide("retouch", "pl", null, EMPTY);
  check("D1 no saved row → tutorial AND starter on, version 1", !!none.tutorial && !!none.starter && none.version === 1 && none.tool === "retouch");
  const shippedOk = (["pl", "en", "de"] as Locale[]).every((l) => {
    const g = resolveGuide("fashion_change_face", l, null, EMPTY);
    return g.tutorial?.title === dict(l, "toolGuideDefaults.fashion_change_face.tutorial.title")
      && g.tutorial.body === dict(l, "toolGuideDefaults.fashion_change_face.tutorial.body")
      && g.tutorial.steps.length === DEFAULT_STEP_ARTS.fashion_change_face.length
      && g.tutorial.steps.every((s, i) => s.title === dict(l, `toolGuideDefaults.fashion_change_face.tutorial.steps.s${i + 1}.title`)
        && s.body === dict(l, `toolGuideDefaults.fashion_change_face.tutorial.steps.s${i + 1}.body`) && s.art === DEFAULT_STEP_ARTS.fashion_change_face[i])
      && g.starter?.title === dict(l, "toolGuideDefaults.fashion_change_face.starter.title");
  });
  check("D2 … with the shipped texts and arts IN THE REQUESTED LOCALE (pl, en, de)", shippedOk);
  const everyTool = TOOLS.every((t) => resolveGuide(t, "de", null, EMPTY).tutorial?.steps.length === DEFAULT_STEP_ARTS[t].length);
  check("D2b every tool resolves its shipped tutorial with its own number of steps", everyTool);

  const off = resolveGuide("retouch", "pl", pub({ tutorialEnabled: false, version: 3 }), EMPTY);
  check("D3 tutorial switched off → tutorial null, starter still present", off.tutorial === null && !!off.starter && off.version === 3);
  const sOff = resolveGuide("retouch", "pl", pub({ starterEnabled: false }), EMPTY);
  check("D4 starter switched off → starter null, tutorial still present", sOff.starter === null && !!sOff.tutorial);
  const both = resolveGuide("retouch", "pl", pub({ tutorialEnabled: false, starterEnabled: false }), slotMap(rslot(guideSlotKey("retouch", "starter", 1))));
  check("D4b both off → both null (no picture leaks through either)", both.tutorial === null && both.starter === null);
  check("D5 the version is the published one", resolveGuide("retouch", "pl", pub({ version: 7 }), EMPTY).version === 7);
  const swOnly = resolveGuide("retouch", "en", pub({ version: 2 }), EMPTY);
  check("D6 a row with switches but no copy (content null) → the shipped copy in the requested locale",
    swOnly.tutorial?.title === dict("en", "toolGuideDefaults.retouch.tutorial.title") && swOnly.starter?.title === dict("en", "toolGuideDefaults.retouch.starter.title"));

  const plOnly = pub({
    tutorial: { title: { pl: "Mój samouczek" }, body: { pl: "Mój wstęp" }, steps: [
      { title: { pl: "Pierwszy" }, body: { pl: "Opis pierwszego" }, art: "upload" },
      { title: { pl: "Drugi" }, body: {}, art: "result" },
    ] },
    starter: { title: { pl: "Moje przykłady" }, body: { pl: "Mój opis przykładów" } },
  });
  const en1 = resolveGuide("retouch", "en", plOnly, EMPTY);
  check("D7 admin copy in Polish only → an English viewer gets the ADMIN'S Polish, not the shipped English",
    en1.tutorial?.title === "Mój samouczek" && en1.tutorial.body === "Mój wstęp" && en1.starter?.title === "Moje przykłady" && en1.starter.body === "Mój opis przykładów");
  check("D7b … the same for every step title and body", same(en1.tutorial?.steps.map((s) => [s.title, s.body]), [["Pierwszy", "Opis pierwszego"], ["Drugi", ""]]));
  const withEn = pub({ tutorial: { title: { pl: "Mój", en: "Mine" }, body: {}, steps: [{ title: { pl: "A", en: "B" }, body: {}, art: "upload" }] }, starter: { title: { pl: "P", de: "Q" }, body: {} } });
  const g8 = resolveGuide("retouch", "en", withEn, EMPTY);
  const g8de = resolveGuide("retouch", "de", withEn, EMPTY);
  check("D8 admin copy in the viewer's language wins (en → en, de → de, missing → admin pl)",
    g8.tutorial?.title === "Mine" && g8.tutorial.steps[0].title === "B" && g8.starter?.title === "P" && g8de.starter?.title === "Q" && g8de.tutorial?.title === "Mój");
  check("D8b whitespace-only admin text in a language counts as missing (falls to the admin's Polish)",
    resolveGuide("retouch", "en", pub({ tutorial: { title: { pl: "Tytuł", en: "   " }, body: {}, steps: [{ title: { pl: "K" }, body: {}, art: "upload" }] } }), EMPTY).tutorial?.title === "Tytuł");

  const reordered = pub({ tutorial: { title: { pl: "T" }, body: {}, steps: [
    { title: { pl: "Najpierw wynik" }, body: { pl: "Zobacz" }, art: "result" },
    { title: { pl: "Potem zdjęcie" }, body: { pl: "Dodaj" }, art: "upload" },
  ] } });
  const g9 = resolveGuide("prompts", "pl", reordered, EMPTY);
  check("D9 the admin's steps are their own: count, order, titles, bodies and arts as saved (2 of the shipped 5)",
    same(g9.tutorial?.steps.map((s) => [s.title, s.body, s.art]), [["Najpierw wynik", "Zobacz", "result"], ["Potem zdjęcie", "Dodaj", "upload"]]));
  const g10 = resolveGuide("prompts", "de", plOnly, EMPTY);
  check("D10 an empty admin STEP body stays empty — never the shipped body that sat at that position",
    g10.tutorial?.steps[1].body === "" && g10.tutorial.steps[1].body !== dict("de", "toolGuideDefaults.prompts.tutorial.steps.s2.body"));
  const blankTitle = pub({ tutorial: { title: { pl: "T" }, body: {}, steps: [
    { title: {}, body: {}, art: "upload" }, { title: { pl: "  " }, body: {}, art: "nope" as "upload" },
  ] } });
  const g11 = resolveGuide("retouch", "en", blankTitle, EMPTY);
  check("D11 a blank admin step title (only possible past the validator) falls back to the shipped title at that position, as a last resort",
    g11.tutorial?.steps[0].title === dict("en", "toolGuideDefaults.retouch.tutorial.steps.s1.title")
      && g11.tutorial.steps[1].title === dict("en", "toolGuideDefaults.retouch.tutorial.steps.s2.title"));
  check("D12 an unknown admin art falls back to the shipped art at that position", g11.tutorial?.steps[1].art === DEFAULT_STEP_ARTS.retouch[1]);
  const six = pub({ tutorial: { title: { pl: "T" }, body: {}, steps: Array.from({ length: 6 }, (_, i) => ({ title: i === 5 ? {} : { pl: `K${i}` }, body: {}, art: "upload" as const })) } });
  const g13 = resolveGuide("tool_remove_bg", "pl", six, EMPTY);
  check("D13 more admin steps than shipped (6 vs 4): a blank title beyond the shipped ones borrows the LAST shipped title, never undefined",
    g13.tutorial?.steps.length === 6 && g13.tutorial.steps[5].title === dict("pl", "toolGuideDefaults.tool_remove_bg.tutorial.steps.s4.title"));
  const emptyBodies = pub({
    tutorial: { title: { pl: "Mój" }, body: {}, steps: [{ title: { pl: "K" }, body: {}, art: "upload" }] },
    starter: { title: { pl: "Moje" }, body: {} },
  });
  const g14 = resolveGuide("retouch", "pl", emptyBodies, EMPTY);
  defect("D14 an empty admin TUTORIAL intro body stays empty (as the validator allows, and as step bodies do)",
    g14.tutorial?.body === "",
    `got the shipped intro "${(g14.tutorial?.body ?? "").slice(0, 40)}…" under the admin's own title — lib/server/tool-guides.ts:108 pick(tut?.body, def.tutorial.body) always falls back to shipped copy; fix: pick(tut?.body, tut ? {} : def.tutorial.body, locale)`);
  defect("D15 an empty admin STARTER body stays empty",
    g14.starter?.body === "",
    `got the shipped starter body "${(g14.starter?.body ?? "").slice(0, 40)}…" — lib/server/tool-guides.ts:126; fix: pick(saved?.starter?.body, saved?.starter ? {} : def.starter.body, locale)`);
  const frozen = JSON.parse(JSON.stringify(plOnly)) as PublishedGuide;
  resolveGuide("retouch", "en", plOnly, EMPTY);
  check("D16 resolveGuide never mutates the published guide it was given", same(plOnly, frozen));

  // pictures
  const T = (n: number) => guideSlotKey("retouch", "tutorial", n);
  const S = guideSlotKey("retouch", "starter", 1);
  const pics = slotMap(
    rslot(T(1), { desktop: "https://cdn.test/one.png", desktopWidth: 1600, desktopHeight: 900, alt: "Jeden", altI18n: { en: "One" },
      variants: { "1280": "https://cdn.test/one-1280.png", "320": "https://cdn.test/one-320.png", "640": "https://cdn.test/one-640.png", abc: "https://cdn.test/x.png", "0": "https://cdn.test/zero.png", "-5": "https://cdn.test/neg.png" } }),
    rslot(T(3), { desktop: "https://cdn.test/three.png", alt: "Trzy" }),
    rslot(T(2), { mediaType: "video", desktop: "https://cdn.test/two.mp4" }),
    rslot(T(4), { desktop: "" }),
    rslot(T(6), { desktop: "https://cdn.test/six.png" }),
  );
  const gp = resolveGuide("retouch", "en", null, pics);
  const st = gp.tutorial?.steps ?? [];
  check("D17 tutorial slot n → step n's picture; a step without a slot has none", st[0]?.image?.url === "https://cdn.test/one.png" && st[2]?.image?.url === "https://cdn.test/three.png");
  check("D18 srcSet is built from the variants sorted by width; non-numeric, zero and negative widths dropped",
    st[0]?.image?.srcSet === "https://cdn.test/one-320.png 320w, https://cdn.test/one-640.png 640w, https://cdn.test/one-1280.png 1280w", st[0]?.image?.srcSet);
  check("D18b no variants → no srcSet (undefined, not an empty string)", st[2]?.image !== null && st[2]?.image?.srcSet === undefined);
  check("D19 width/height come from the desktop file", st[0]?.image?.width === 1600 && st[0]?.image?.height === 900);
  check("D20 alt: the viewer's language first (en → \"One\")", st[0]?.image?.alt === "One");
  check("D20b alt: no text in that language → the slot's alt", resolveGuide("retouch", "de", null, pics).tutorial?.steps[0].image?.alt === "Jeden" && st[2]?.image?.alt === "Trzy");
  check("D20c alt: neither → \"\" (the component then uses the step title)", resolveGuide("retouch", "pl", null, slotMap(rslot(T(1)))).tutorial?.steps[0].image?.alt === "");
  check("D21 a VIDEO in a tutorial slot is ignored (the step keeps its drawn illustration)", st[1]?.image === null);
  check("D21b a slot whose file is gone (no desktop URL) is ignored", st[3]?.image === null);
  check("D21c a tutorial slot beyond the step count (tutorial.6 on a 4-step tutorial) is never shown", st.length === 4 && !JSON.stringify(gp).includes("six.png"));

  const W = (k: string) => rslot(k, { desktop: `https://cdn.test/${k}.jpg` });
  const [bgCard, whiteCard] = STARTER_FALLBACK_SLOTS.tool_white_bg;
  const own = resolveGuide("tool_white_bg", "pl", null, slotMap(W(guideSlotKey("tool_white_bg", "starter", 1)), W(bgCard), W(whiteCard)));
  check("D22 the starter's own guide picture wins over the catalogue fallback", own.starter?.image?.url === `https://cdn.test/${guideSlotKey("tool_white_bg", "starter", 1)}.jpg`);
  const firstFb = resolveGuide("tool_white_bg", "pl", null, slotMap(W(bgCard), W(whiteCard)));
  check("D23 no guide picture → the FIRST catalogue fallback that resolves", firstFb.starter?.image?.url === `https://cdn.test/${bgCard}.jpg`);
  const secondFb = resolveGuide("tool_white_bg", "pl", null, slotMap(rslot(bgCard, { mediaType: "video" }), W(whiteCard)));
  check("D23b … skipping a fallback that does not resolve to an image (a video card)", secondFb.starter?.image?.url === `https://cdn.test/${whiteCard}.jpg`);
  check("D24 nothing resolves → starter image null (the drawn showcase)", resolveGuide("tool_white_bg", "pl", null, slotMap(rslot(guideSlotKey("tool_white_bg", "starter", 1), { mediaType: "video" }))).starter?.image === null);
  const stOff = resolveGuide("retouch", "pl", pub({ tutorialEnabled: false }), slotMap(W(S)));
  check("D25 the starter keeps its picture when the tutorial is off", stOff.starter?.image?.url === `https://cdn.test/${S}.jpg`);
  const urls = leaves(resolveGuide("retouch", "en", null, pics)).filter(([p]) => /url|srcSet/.test(p)).map(([, u]) => u);
  check("D26 every picture URL handed to the screen is an https URL (never a storage path)", urls.length > 0 && urls.every((u) => u.split(", ").every((x) => /^https:\/\//.test(x))));
}

/* ══ E. DECISIONS ══════════════════════════════════════════════════════════ */

function guideFixture(o: { version?: number; steps?: number; tutorial?: boolean; starter?: boolean } = {}): ResolvedGuide {
  return {
    tool: "retouch",
    version: o.version ?? 2,
    tutorial: o.tutorial === false ? null : {
      title: "T", body: "",
      steps: Array.from({ length: o.steps ?? 3 }, (_, i) => ({ title: `S${i}`, body: "", art: "upload" as const, image: null })),
    },
    starter: o.starter === false ? null : { title: "P", body: "", image: null },
  };
}

function sectionE() {
  console.log("\nE. DECISIONS — shouldAutoOpen and starterVisible truth tables");
  const resp = (o: Partial<GuideResponse> = {}, g: Parameters<typeof guideFixture>[0] = {}): GuideResponse =>
    ({ guide: guideFixture(g), seen: 1, live: true, hasResults: false, ...o });

  check("E1 shouldAutoOpen: live, tutorial with steps, seen 1 < version 2, not blocked → true", shouldAutoOpen(resp(), false));
  check("E2 shouldAutoOpen: no response → false", !shouldAutoOpen(null, false));
  check("E3 shouldAutoOpen: tool not live → false", !shouldAutoOpen(resp({ live: false }), false));
  check("E4 shouldAutoOpen: no guide → false", !shouldAutoOpen(resp({ guide: null }), false));
  check("E5 shouldAutoOpen: tutorial switched off → false", !shouldAutoOpen(resp({}, { tutorial: false }), false));
  check("E6 shouldAutoOpen: a tutorial with 0 steps → false", !shouldAutoOpen(resp({}, { steps: 0 }), false));
  check("E7 shouldAutoOpen: this version already seen (seen == version) → false", !shouldAutoOpen(resp({ seen: 2 }), false));
  check("E8 shouldAutoOpen: a NEWER version seen (seen > version) → false", !shouldAutoOpen(resp({ seen: 5 }), false));
  check("E9 shouldAutoOpen: never seen (0) and version 1 → true", shouldAutoOpen(resp({ seen: 0 }, { version: 1 }), false));
  check("E10 shouldAutoOpen: blocked (another dialog / the visual editor) → false", !shouldAutoOpen(resp(), true));
  check("E11 shouldAutoOpen does not depend on hasResults or the starter (true / false / null; starter off)",
    [true, false, null].every((h) => shouldAutoOpen(resp({ hasResults: h }), false)) && shouldAutoOpen(resp({}, { starter: false }), false));
  let trueCount = 0; let wrong = 0;
  for (const live of [true, false]) for (const hasGuide of [true, false]) for (const tut of [true, false]) for (const steps of [0, 1])
    for (const seen of [0, 1, 2, 3]) for (const blocked of [true, false]) {
      const r: GuideResponse = { guide: hasGuide ? guideFixture({ tutorial: tut, steps, version: 2 }) : null, seen, live, hasResults: false };
      const want = live && hasGuide && tut && steps > 0 && seen < 2 && !blocked;
      const got = shouldAutoOpen(r, blocked);
      if (got) trueCount++;
      if (got !== want) wrong++;
    }
  check(`E12 shouldAutoOpen exhaustively (256 combinations) matches the specification — true only when every condition holds (${trueCount}×)`, wrong === 0 && trueCount === 2);

  const base: Parameters<typeof starterVisible>[0] = { response: resp(), itemCount: 0, pendingCount: 0, loading: false, filtered: false, moreToLoad: false, madeHere: false };
  check("E13 starterVisible: live, starter, server says no results, empty idle unfiltered gallery → true", starterVisible(base));
  const flips: [string, Partial<typeof base>][] = [
    ["a filter is on (could be hiding results)", { filtered: true }],
    ["another page is still to load", { moreToLoad: true }],
    ["the gallery is loading", { loading: true }],
    ["something is in flight (pending)", { pendingCount: 1 }],
    ["the gallery has an item", { itemCount: 1 }],
    ["a result was made on this screen", { madeHere: true }],
    ["the server says there ARE results", { response: resp({ hasResults: true }) }],
    ["the server could not tell (hasResults null)", { response: resp({ hasResults: null }) }],
    ["the tool is not live", { response: resp({ live: false }) }],
    ["the starter is switched off", { response: resp({}, { starter: false }) }],
    ["there is no guide", { response: resp({ guide: null }) }],
    ["there is no response (fetch failed / pending)", { response: null }],
  ];
  for (const [what, o] of flips) check(`E14 starterVisible → false when ${what}`, !starterVisible({ ...base, ...o }));
  let sv = 0; let svWrong = 0;
  for (const filtered of [false, true]) for (const moreToLoad of [false, true]) for (const loading of [false, true]) for (const madeHere of [false, true])
    for (const itemCount of [0, 2]) for (const pendingCount of [0, 1]) for (const hasResults of [false, true, null]) for (const live of [true, false])
      for (const starter of [true, false]) {
        const got = starterVisible({ response: resp({ hasResults, live }, { starter }), itemCount, pendingCount, loading, filtered, moreToLoad, madeHere });
        const want = !filtered && !moreToLoad && !loading && !madeHere && itemCount === 0 && pendingCount === 0 && hasResults === false && live && starter;
        if (got) sv++;
        if (got !== want) svWrong++;
      }
  check(`E15 starterVisible exhaustively (1536 combinations): true in exactly the one all-clear case (${sv}×)`, svWrong === 0 && sv === 1);
  check("E16 starterVisible ignores the tutorial switch and the seen version (they are the dialog's business)",
    starterVisible({ ...base, response: resp({ seen: 99 }, { tutorial: false }) }));
}

/* ══ F. READ PATH ══════════════════════════════════════════════════════════ */

async function sectionF() {
  console.log("\nF. READ PATH — publishedGuide, toolIsLive, hasToolResults, readSeenVersion, GET /api/tool-guides");

  // ── publishedGuide ─────────────────────────────────────────────────────
  baseDb();
  setAnon({ published: [pubRow("retouch", { tutorial_enabled: false, starter_enabled: true, tutorial_version: 4, tutorial: null, starter: { title: { pl: "P" }, body: {} } })] });
  const p1 = await publishedGuide("retouch");
  check("F1 publishedGuide maps the definer function's row (switches, version, copy)",
    !!p1 && p1.tutorialEnabled === false && p1.starterEnabled && p1.version === 4 && p1.tutorial === null && same(p1.starter, { title: { pl: "P" }, body: {} }));
  check("F1b … read with the ANONYMOUS client, the one shared-cache reader", iceState.anonCalls.includes("tool_guides_published"));
  check("F2 a tool with no saved row → null (the shipped default)", (await publishedGuide("compress")) === null);
  for (const code of ["PGRST202", "42883"]) {
    baseDb(); setAnon({ published: { code, message: "function public.tool_guides_published() does not exist" } });
    quiet(); const r = await publishedGuide("retouch"); loud();
    check(`F3 function missing (${code}, code before 0142) → null, quietly (the one stable answer worth caching)`, r === null && captured.length === 0);
  }
  baseDb(); setAnon({ published: { code: "XX000", message: "boom" } });
  quiet(); const pf = await publishedGuide("retouch"); loud();
  check("F4 any other read error → null (shipped guide for this request) and a warning, never a throw", pf === null && captured.some((c) => c.includes("tool-guides")));
  const ppSrc = read("lib/server/tool-guides-published.ts");
  check("F4b the published read is cached under the tool-guides tag and an error is THROWN inside the cache (never cached)",
    /unstable_cache\(/.test(ppSrc) && /tags:\s*\[TOOL_GUIDES_TAG\]/.test(ppSrc) && /throw new Error\(`tool_guides_published/.test(ppSrc) && TOOL_GUIDES_TAG === "tool-guides");

  // ── toolIsLive ─────────────────────────────────────────────────────────
  const live = async (tool: GuideToolKey, setup: (db: FakeDb) => void = () => {}, admin = false) => {
    const db = baseDb(); guideState.availability = ALL_ACTIVE(); setup(db);
    const r = await toolIsLive(asClient(db), tool, { admin });
    return { r, db };
  };
  for (const status of ["COMING_SOON", "MAINTENANCE", "DISABLED"]) {
    const { r } = await live("resize", () => { guideState.availability.resize = { status }; });
    check(`F5 availability ${status} → not live, and nothing else is asked`, r === false && same(guideState.liveCalls, ["availability"]));
  }
  check("F5b a tool missing from the availability map → not live", (await live("compress", () => { delete guideState.availability.compress; })).r === false);
  check("F5c the availability read throws → not live (the cautious answer)", (await live("generator", () => { guideState.availabilityThrow = true; })).r === false);
  const local = await Promise.all((["resize", "compress", "generator"] as GuideToolKey[]).map((t) => live(t)));
  check("F6 resize, compress and generator are live as soon as they are ACTIVE (nothing else to be unavailable)", local.every((x) => x.r === true));
  const planners = (db: FakeDb, keyed: string[]) => {
    db.tables.ai_providers = [{ id: "p-openai", slug: "openai", active: true }, { id: "p-google", slug: "google", active: false }, { id: "p-room", slug: "photoroom", active: true }];
    db.rpcs.providers_with_credentials = () => ({ data: keyed, error: null });
  };
  check("F7 prompts: live when an ACTIVE planner (openai/google) has a stored key", (await live("prompts", (db) => planners(db, ["p-openai"]))).r === true);
  check("F7b prompts: not live when only an inactive planner or a non-planner has a key", (await live("prompts", (db) => planners(db, ["p-google", "p-room"]))).r === false);
  check("F8 retouch: live only with a model AND the engine tool configured",
    (await live("retouch", () => { guideState.retouchModel = { id: "m" }; guideState.retouchConfigured = true; })).r === true
      && (await live("retouch", () => { guideState.retouchModel = null; guideState.retouchConfigured = true; })).r === false
      && (await live("retouch", () => { guideState.retouchModel = { id: "m" }; guideState.retouchConfigured = false; })).r === false);
  check("F8b retouch asks engineToolConfigured for \"retouch\"", guideState.liveCalls.includes("engineToolConfigured:retouch"));
  check("F9 ecommerce_thumbnail: live iff the thumbnail settings are ready; a throw reads as not live",
    (await live("ecommerce_thumbnail", () => { guideState.thumbnailReady = true; })).r === true
      && (await live("ecommerce_thumbnail", () => { guideState.thumbnailReady = false; })).r === false
      && (await live("ecommerce_thumbnail", () => { guideState.thumbnailReady = true; guideState.thumbnailThrow = true; })).r === false);
  const cat = () => { guideState.catalogue = [{ slug: "remove_bg", available: true }, { slug: "white_bg", available: false }]; };
  const rb = await live("tool_remove_bg", cat, true);
  check("F10 photo tools: live iff the catalogue entry for photoSlugOf(tool) is available (and the viewer's admin flag is passed on)",
    rb.r === true && same(guideState.catalogueAdmin, [true])
      && (await live("tool_white_bg", cat)).r === false && (await live("tool_ai_background", cat)).r === false);
  check("F11 Moda: live only with a fashion model AND the tool available",
    (await live("fashion_iron", () => { guideState.fashionModel = { id: "f" }; guideState.fashionAvailable = { fashion_iron: true }; })).r === true
      && (await live("fashion_iron", () => { guideState.fashionModel = null; guideState.fashionAvailable = { fashion_iron: true }; })).r === false
      && (await live("fashion_flat_lay", () => { guideState.fashionModel = { id: "f" }; guideState.fashionAvailable = { fashion_iron: true }; })).r === false);

  // ── hasToolResults ─────────────────────────────────────────────────────
  const resDb = () => {
    const db = baseDb();
    db.tables.tool_results = [{ id: "r1", workspace_id: WS, tool_slug: "remove_bg" }, { id: "r2", workspace_id: OTHER_WS, tool_slug: "white_bg" }];
    db.tables.generations = [
      { id: "g1", workspace_id: WS, generation_jobs: { status: "completed", settings: { operation: "image_retouch" } } },
      { id: "g2", workspace_id: WS, generation_jobs: { status: "failed", settings: { operation: "fashion_iron" } } },
      { id: "g3", workspace_id: OTHER_WS, generation_jobs: { status: "completed", settings: { operation: "ecommerce_thumbnail" } } },
    ];
    return db;
  };
  {
    const db = resDb();
    const r = await hasToolResults(asSvc(db), WS, "resize");
    check("F12 batch tools (queue lives in the browser) → false without asking the database", r === false && db.calls.length === 0);
  }
  {
    const db = resDb();
    const [a, b] = [await hasToolResults(asSvc(db), WS, "tool_remove_bg"), await hasToolResults(asSvc(db), WS, "tool_white_bg")];
    check("F13 photo tools: a stored tool_results row for photoSlugOf(tool) in THIS workspace → true; another workspace's → false",
      a === true && b === false && db.fromCalls("tool_results").every((c) => c.ops.includes(`eq(workspace_id,${WS})`)));
  }
  {
    const db = resDb();
    const got = Object.fromEntries(await Promise.all((["retouch", "fashion_iron", "ecommerce_thumbnail", "prompts", "generator", "fashion_flat_lay"] as GuideToolKey[])
      .map(async (t) => [t, await hasToolResults(asSvc(db), WS, t)] as const)));
    check("F14 generations: a COMPLETED job with the tool's operation in this workspace counts; failed jobs and other workspaces do not",
      got.retouch === true && got.fashion_iron === false && got.ecommerce_thumbnail === false && got.fashion_flat_lay === false, JSON.stringify(got));
    check("F14b the generators (prompts, generator) count any completed result in the workspace (their gallery lists it all)", got.prompts === true && got.generator === true);
    const retouchCall = db.fromCalls("generations")[0];
    check("F14c the query filters completed jobs and the operation (image_retouch for Retusz)",
      retouchCall.ops.includes("eq(generation_jobs.status,completed)") && retouchCall.ops.includes("eq(generation_jobs.settings->>operation,image_retouch)"));
    const promptsCall = db.fromCalls("generations")[3];
    check("F14d … and no operation filter at all for the generators", !promptsCall.ops.some((o) => o.includes("->>operation")));
  }
  {
    const db = resDb(); db.tableErrors.generations = { message: "permission denied" }; db.tableErrors.tool_results = { message: "timeout" };
    const r = [await hasToolResults(asSvc(db), WS, "retouch"), await hasToolResults(asSvc(db), WS, "tool_remove_bg")];
    check("F15 a failed read is UNKNOWN (null), never \"empty\"", same(r, [null, null]));
  }

  // ── readSeenVersion / markSeen / admin reads ───────────────────────────
  const seenOf = async (metadata: unknown, row = true) => {
    const db = baseDb();
    db.tables.user_preferences = row ? [{ user_id: CUSTOMER, metadata }, { user_id: ADMIN, metadata: { tool_tutorials: { retouch: 50 } } }] : [];
    return readSeenVersion(asSvc(db), CUSTOMER, "retouch");
  };
  check("F16 seen = user_preferences.metadata.tool_tutorials[tool] of the caller's own row", (await seenOf({ tool_tutorials: { retouch: 3, prompts: 9 } })) === 3);
  const odd = await Promise.all([seenOf({ tool_tutorials: { retouch: "3" } }), seenOf({ tool_tutorials: { retouch: null } }), seenOf({ tool_tutorials: { retouch: { v: 3 } } }),
    seenOf({ tool_tutorials: { retouch: true } }), seenOf({ tool_tutorials: { prompts: 4 } }), seenOf(null), seenOf({}), seenOf({ tool_tutorials: [] }), seenOf(null, false)]);
  check("F17 a non-number, another tool's mark, no metadata or no row → 0", odd.every((x) => x === 0), odd.join(","));
  {
    const db = baseDb();
    db.rpcs.mark_tool_tutorial_seen = () => ({ data: null, error: null });
    const ok = await markSeen(asSvc(db), "retouch", 3);
    db.rpcs.mark_tool_tutorial_seen = () => ({ data: null, error: { message: "bad_version" } });
    const bad = await markSeen(asSvc(db), "retouch", 3);
    check("F18 markSeen: one rpc mark_tool_tutorial_seen(p_tool_key, p_version); an error → false",
      ok && !bad && same(db.rpcCalls("mark_tool_tutorial_seen")[0].args, { p_tool_key: "retouch", p_version: 3 }));
  }
  {
    const db = baseDb(ADMIN);
    db.tables.tool_guides = [{ tool_key: "retouch", tutorial_version: 2, updated_at: ROW_TS }];
    db.tables.media_slots = [{ slot_key: guideSlotKey("retouch", "tutorial", 1), media_id: IMG1, updated_at: T_A }, { slot_key: "tools.retouch.card", media_id: IMG2, updated_at: T_B }];
    const row = await readGuideRow(asSvc(db), "retouch");
    const none = await readGuideRow(asSvc(db), "compress");
    const slots = await readGuideSlots(asSvc(db), [guideSlotKey("retouch", "tutorial", 1), guideSlotKey("retouch", "tutorial", 2)]);
    db.tableErrors.tool_guides = { message: "relation \"tool_guides\" does not exist", code: "42P01" };
    const gone = await readGuideRow(asSvc(db), "retouch");
    check("F19 readGuideRow: the row, null when never saved, \"unavailable\" when the read fails (0142 not applied)",
      (row as Row | null)?.tool_key === "retouch" && none === null && gone === "unavailable");
    check("F19b readGuideSlots: only the asked keys, as key → { mediaId, updatedAt }",
      slots !== null && slots.size === 1 && same(slots.get(guideSlotKey("retouch", "tutorial", 1)), { mediaId: IMG1, updatedAt: T_A }));
  }

  // ── loadGuide ──────────────────────────────────────────────────────────
  {
    const db = baseDb();
    setAnon({ published: [pubRow("retouch", { tutorial_version: 5 })], slots: [resolveRow(guideSlotKey("retouch", "tutorial", 2)), resolveRow("tools.retouch.card", { desktop_url: "https://cdn.test/card.png" })] });
    const g = await loadGuide(asClient(db), "retouch", "en");
    check("F20 loadGuide: published version + pictures resolved through media_slots_resolve_v2 in ONE call for all guideImageKeys",
      g.version === 5 && g.tutorial?.steps[1].image?.url === `https://cdn.test/${guideSlotKey("retouch", "tutorial", 2)}.png`
        && g.starter?.image?.url === "https://cdn.test/card.png" && anonKeys.length === 1 && same(anonKeys[0], [...guideImageKeys("retouch")].sort()));
  }

  // ── GET /api/tool-guides ───────────────────────────────────────────────
  const get = async (qs: string) => {
    quiet();
    try {
      const res = await GET(new Request(`https://app.test/api/tool-guides${qs}`));
      let body: Record<string, unknown> = {};
      try { body = (await res.json()) as Record<string, unknown>; } catch { /* not JSON */ }
      return { res, body };
    } finally { loud(); }
  };
  const routeDb = (o: { results?: boolean } = {}) => {
    const db = baseDb(CUSTOMER);
    guideState.availability = ALL_ACTIVE();
    guideState.retouchModel = { id: "m" }; guideState.retouchConfigured = true;
    db.tables.user_preferences = [{ user_id: CUSTOMER, metadata: { tool_tutorials: { retouch: 3, prompts: 9 } } }];
    db.tables.generations = o.results ? [{ id: "g1", workspace_id: WS, generation_jobs: { status: "completed", settings: { operation: "image_retouch" } } }] : [];
    return db;
  };
  for (const qs of ["?tool=editor", "?tool=", "", "?tool=__proto__", "?tool=image_retouch", "?tool=RETOUCH"]) {
    resetIceState(); iceState.clientThrow = true; setAnon();
    const { res, body } = await get(qs);
    check(`F21 GET ${qs || "(no tool)"} → 400 unknown_tool, before any client is even created`, res.status === 400 && body.error === "unknown_tool" && iceState.anonCalls.length === 0);
  }
  {
    const db = routeDb(); db.user = null;
    const { res, body } = await get("?tool=retouch");
    check("F22 signed out → 401, nothing read beyond the session (no table, no rpc, no anonymous read)",
      res.status === 401 && body.error === "unauthenticated" && db.calls.every((c) => c.kind === "auth") && iceState.anonCalls.length === 0);
  }
  {
    const db = routeDb();
    iceState.cookies.set("ecs_locale", "en");
    const { res, body } = await get("?tool=retouch");
    const guide = body.guide as ResolvedGuide | undefined;
    check("F23 signed in → 200 { ok, guide, seen, live, hasResults } and nothing else", res.status === 200 && same(Object.keys(body).sort(), ["guide", "hasResults", "live", "ok", "seen"]) && body.ok === true);
    check("F24 … with Cache-Control: no-store (a per-user answer)", res.headers.get("cache-control") === "no-store");
    check("F25 … the guide in the viewer's locale cookie (en)", guide?.tutorial?.title === lookup(DICTS.en, "toolGuideDefaults.retouch.tutorial.title") && guide?.tool === "retouch");
    check("F26 … seen = this user's mark for THIS tool (3, not prompts' 9); live true; hasResults false", body.seen === 3 && body.live === true && body.hasResults === false);
    const allowed = new Set(["workspace_members", "user_preferences", "generations", "tool_results", "ai_providers"]);
    const strays = db.tablesTouched().filter((t) => !allowed.has(t));
    check("F27 the route only READS: workspace, preferences and results tables; no write, no rpc beyond provider keys", strays.length === 0
      && db.writes().every((c) => c.kind === "rpc" && c.name === "providers_with_credentials"), `${short(strays)} ${short(db.writes().map((c) => c.kind === "rpc" ? c.name : c.kind))}`);
    check("F27b a GET never marks the tutorial seen (that is the dialog's own action)", db.rpcCalls("mark_tool_tutorial_seen").length === 0);
  }
  {
    routeDb({ results: true });
    const { body } = await get("?tool=retouch");
    check("F28 hasResults true when the workspace already has a Retusz result", body.hasResults === true);
  }
  {
    const db = routeDb(); db.tableErrors.workspace_members = { message: "boom", code: "XX000" };
    const { res, body } = await get("?tool=retouch");
    check("F29 the workspace read fails → hasResults null (unknown), still 200 with the guide", res.status === 200 && body.hasResults === null && !!body.guide);
  }
  {
    const db = routeDb(); db.tableErrors.generations = { message: "statement timeout" };
    const { body } = await get("?tool=retouch");
    check("F30 the results read fails → hasResults null", body.hasResults === null);
  }
  {
    const db = routeDb(); db.tables.user_preferences = [{ user_id: CUSTOMER, metadata: { tool_tutorials: { retouch: "7" } } }];
    const { body } = await get("?tool=retouch");
    check("F31 a non-number seen mark reads as 0", body.seen === 0);
  }
  {
    routeDb(); guideState.availability.retouch = { status: "MAINTENANCE" };
    const { body } = await get("?tool=retouch");
    check("F32 a tool in maintenance → live false, the guide is still returned (the button needs it; the decisions refuse)",
      body.live === false && !!(body.guide as ResolvedGuide | undefined)?.tutorial);
  }
  {
    routeDb();
    setAnon({ published: [pubRow("retouch", { tutorial_enabled: false, tutorial_version: 6, starter: { title: { pl: "Moje przykłady" }, body: {} } })] });
    const { body } = await get("?tool=retouch");
    const g = body.guide as ResolvedGuide;
    check("F33 the published row reaches the screen: version, tutorial switched off (null), the admin's starter copy",
      g.version === 6 && g.tutorial === null && g.starter?.title === "Moje przykłady");
  }
  {
    routeDb(); setAnon({ published: { code: "XX000", message: "down" } });
    const { res, body } = await get("?tool=retouch");
    check("F34 the published read fails → still 200 with the SHIPPED guide (version 1)", res.status === 200 && (body.guide as ResolvedGuide).version === 1);
  }
  {
    routeDb(); iceState.viewerAdmin = true; guideState.catalogue = [{ slug: "ai_shadow", available: true }];
    const { body } = await get("?tool=tool_ai_shadow");
    check("F35 photo tool via the route: live from the catalogue with the viewer's admin flag (a sandbox key runs for an operator)",
      body.live === true && same(guideState.catalogueAdmin, [true]));
  }
}

/* ══ G. WRITES ═════════════════════════════════════════════════════════════ */

const saveInput = (o: Partial<SaveToolGuideInput> = {}): SaveToolGuideInput => ({
  tool: "retouch", tutorialEnabled: true, starterEnabled: true, content: validContent(4),
  images: { steps: [], starter: null }, base: null, showAgain: false, ...o,
});
const save = async (input: SaveToolGuideInput) => { quiet(); try { return await saveToolGuideAction(input); } finally { loud(); } };
const ALLOWED_TABLES = new Set(["tool_guides", "media_slots", "media_assets", "profiles", "audit_logs"]);
const FORBIDDEN_TABLE = /credit|wallet|ledger|generation|transaction|usage|billing|payment|ai_provider_calls/;

async function sectionG() {
  console.log("\nG. WRITES — markToolTutorialSeenAction, saveToolGuideAction");

  // ── markToolTutorialSeenAction ─────────────────────────────────────────
  const seenDb = (published: Row[] | AnonError = [pubRow("retouch", { tutorial_version: 7 })]) => {
    const db = baseDb(CUSTOMER);
    setAnon({ published });
    db.rpcs.mark_tool_tutorial_seen = () => ({ data: null, error: null });
    return db;
  };
  {
    const db = seenDb();
    const r = await markToolTutorialSeenAction("editor");
    check("G1 seen: an unknown tool → unknown_tool, before the session is even read", !r.ok && r.error === "unknown_tool" && db.calls.length === 0);
  }
  {
    const db = seenDb(); db.user = null;
    const r = await markToolTutorialSeenAction("retouch");
    check("G2 seen: signed out → unauthenticated, nothing written, the published guide not even read",
      !r.ok && r.error === "unauthenticated" && db.writes().length === 0 && iceState.anonCalls.length === 0);
  }
  {
    const db = seenDb();
    const r = await markToolTutorialSeenAction("retouch");
    check("G3 seen: the version is the SERVER'S published one (7) → rpc mark_tool_tutorial_seen(retouch, 7)",
      r.ok && same(db.rpcCalls("mark_tool_tutorial_seen").map((c) => c.args), [{ p_tool_key: "retouch", p_version: 7 }]));
    check("G3b … one rpc on the user's own client and no table write (the merge is one statement in 0142)", db.writes().length === 1 && db.fromCalls().length === 0);
  }
  {
    const db = seenDb([]);
    await markToolTutorialSeenAction("compress");
    check("G4 seen: no published row → version 1 (the shipped default's)", db.rpcCalls("mark_tool_tutorial_seen")[0]?.args.p_version === 1);
  }
  {
    const db = seenDb({ code: "XX000", message: "down" });
    quiet(); await markToolTutorialSeenAction("retouch"); loud();
    check("G5 seen: the published read fails → version 1, still marked (the route showed the shipped v1 too)", db.rpcCalls("mark_tool_tutorial_seen")[0]?.args.p_version === 1);
  }
  {
    const db = seenDb();
    const asTwo = markToolTutorialSeenAction as unknown as (tool: string, version: number) => Promise<{ ok: boolean }>;
    await asTwo("retouch", 999);
    check("G6 seen: a browser cannot choose the version (takes ONE argument; a second one is ignored)",
      markToolTutorialSeenAction.length === 1 && db.rpcCalls("mark_tool_tutorial_seen")[0]?.args.p_version === 7);
  }
  {
    const db = seenDb(); db.rpcs.mark_tool_tutorial_seen = () => ({ data: null, error: { message: "bad_version" } });
    const r = await markToolTutorialSeenAction("retouch");
    check("G7 seen: an rpc error → { ok: false, error: \"generic\" } (never the database's message)", !r.ok && r.error === "generic");
  }

  // ── saveToolGuideAction: the gate ──────────────────────────────────────
  const nothingDone = (db: FakeDb) => db.writes().length === 0 && iceState.revalidated.length === 0 && iceState.audits.length === 0;
  {
    const db = adminDb(); db.user = null;
    const r = await save(saveInput());
    check("G8 save: signed out → unauthenticated, before ANY table, rpc, cache or audit (not even profiles, not step-up)",
      !r.ok && r.error === "unauthenticated" && db.fromCalls().length === 0 && nothingDone(db) && iceState.stepUpCalls === 0);
  }
  {
    const db = adminDb(); db.user = { id: CUSTOMER };
    const r = await save(saveInput());
    check("G9 save: a customer → not_admin; only their profile was read; step-up never asked",
      !r.ok && r.error === "not_admin" && same(db.tablesTouched(), ["profiles"]) && nothingDone(db) && iceState.stepUpCalls === 0);
  }
  {
    const db = adminDb(); db.tableErrors.profiles = { message: "boom" };
    const r = await save(saveInput());
    check("G9b save: the role cannot be read → not_admin (refused, not assumed)", !r.ok && r.error === "not_admin" && nothingDone(db));
  }
  {
    const db = adminDb(); iceState.stepUp = "/auth/security-check";
    const r = await save(saveInput());
    check("G10 save: an admin on an unverified device → step_up_required, before any write",
      !r.ok && r.error === "step_up_required" && same(db.tablesTouched(), ["profiles"]) && nothingDone(db) && iceState.stepUpCalls === 1);
  }
  {
    const db = adminDb();
    const r = await save(saveInput({ tool: "editor" }));
    check("G11 save: an unknown tool → unknown_tool, nothing beyond the profile", !r.ok && r.error === "unknown_tool" && same(db.tablesTouched(), ["profiles"]) && nothingDone(db));
  }
  const badContent: [string, unknown][] = [
    ["shape", "x"], ["steps_min", validContent(0)], ["steps_max", validContent(7)], ["art", mut((c) => { c.tutorial.steps[0].art = "x"; })],
    ["required", mut((c) => { delete c.starter.title.pl; })], ["markup", mut((c) => { c.tutorial.body.pl = "<i>x</i>"; })],
    ["invisible", mut((c) => { c.tutorial.body.pl = "a​b"; })], ["too_long", mut((c) => { c.tutorial.title.pl = "x".repeat(81); })],
    ["shape", undefined],
  ];
  for (const [code, content] of badContent) {
    const db = adminDb();
    const r = await save(saveInput({ content }));
    check(`G12 save: invalid content (${code}${content === undefined ? ", content undefined" : ""}) → invalid_${code}, before the library or the row is read`,
      !r.ok && r.error === `invalid_${code}` && same(db.tablesTouched(), ["profiles"]) && nothingDone(db), r.ok ? "ok" : r.error);
  }
  {
    const db = adminDb();
    const r = await save(saveInput({ images: { steps: [IMG1, "../../etc/passwd"], starter: null } }));
    const r2 = await save(saveInput({ images: { steps: [], starter: "" } }));
    check("G13 save: an image id that is not a UUID (or empty) → invalid_image, before the library is read",
      !r.ok && r.error === "invalid_image" && !r2.ok && r2.error === "invalid_image" && !db.tablesTouched().includes("media_assets") && nothingDone(db));
  }
  for (const [what, id] of [["a video asset", VID], ["an asset with no file", NOFILE], ["an asset that does not exist", MISSING]] as const) {
    const db = adminDb();
    const r = await save(saveInput({ images: { steps: [null, id], starter: null } }));
    check(`G14 save: ${what} as a picture → invalid_image, nothing written`, !r.ok && r.error === "invalid_image" && nothingDone(db) && !db.tablesTouched().includes("tool_guides"));
  }
  {
    const db = adminDb(); db.tableErrors.media_assets = { message: "boom" };
    const r = await save(saveInput({ images: { steps: [IMG1], starter: null } }));
    check("G15 save: the library cannot be read → generic, nothing written", !r.ok && r.error === "generic" && nothingDone(db));
  }
  {
    const db = adminDb();
    const r = await save(saveInput({ images: { steps: [IMG1, IMG1, null, IMG1], starter: IMG1 } }));
    const lib = db.fromCalls("media_assets")[0];
    check("G16 save: one picture used at several positions is checked ONCE (deduplicated ids)", r.ok && lib?.ops.includes("in(id,1)"));
  }
  {
    const db = adminDb();
    const r = await save(saveInput({ images: { steps: [EXT], starter: null } }));
    check("G16b save: an image with only an external URL is a valid picture", r.ok);
  }
  {
    const db = adminDb(); db.tableErrors.tool_guides = { message: "relation \"public.tool_guides\" does not exist", code: "42P01" };
    const r = await save(saveInput());
    check("G17 save: 0142 not applied (the row cannot be read) → migration_pending, nothing written", !r.ok && r.error === "migration_pending" && nothingDone(db));
  }

  // ── compare-and-set ────────────────────────────────────────────────────
  const existing = (db: FakeDb, o: Row = {}) => { db.tables.tool_guides = [{ tool_key: "retouch", tutorial_enabled: true, starter_enabled: true, tutorial_version: 3, content: null, updated_at: ROW_TS, updated_by: ADMIN, ...o }]; };
  for (const [what, setup, base] of [
    ["the row changed since the form opened", (db: FakeDb) => existing(db), "2026-10-09T00:00:00+00:00"],
    ["a row exists but the form had none (base null)", (db: FakeDb) => existing(db), null],
    ["the form had a row that is gone", () => {}, ROW_TS],
  ] as const) {
    const db = adminDb(); setup(db);
    const r = await save(saveInput({ base }));
    check(`G18 save: CAS conflict when ${what} → conflict, nothing written`, !r.ok && r.error === "conflict" && nothingDone(db));
  }
  {
    const db = adminDb();
    const before = Date.now();
    const r = await save(saveInput({ content: mut((c) => { c.tutorial.title.pl = "  Mój   tytuł \n "; }, 4) }));
    const ins = db.fromCalls("tool_guides", "insert")[0];
    const row = (ins?.payload as Row[] | undefined)?.[0] ?? {};
    const expected = normalizeGuideContent(mut((c) => { c.tutorial.title.pl = "Mój tytuł"; }, 4));
    check("G19 save: no row yet → INSERT { tool_key, switches, version 1, the VALIDATED content, updated_by: the admin }",
      r.ok && row.tool_key === "retouch" && row.tutorial_enabled === true && row.starter_enabled === true && row.tutorial_version === 1
        && row.updated_by === ADMIN && expected.ok && same(row.content, expected.content), JSON.stringify(row).slice(0, 200));
    check("G19b … updated_at is the time of the save, and is what the action returns",
      r.ok && typeof row.updated_at === "string" && Date.parse(row.updated_at) >= before && r.data?.updatedAt === row.updated_at && r.data?.version === 1);
  }
  {
    const db = adminDb(); db.opErrors["tool_guides:insert"] = { message: "duplicate key", code: "23505" };
    const r = await save(saveInput());
    db.opErrors["tool_guides:insert"] = { message: "violates foreign key", code: "23503" };
    const r2 = await save(saveInput());
    check("G20 save: a concurrent first insert (23505) → conflict; any other insert error → generic", !r.ok && r.error === "conflict" && !r2.ok && r2.error === "generic");
  }
  {
    const db = adminDb(); existing(db);
    const r = await save(saveInput({ base: ROW_TS, tutorialEnabled: false }));
    const upd = db.fromCalls("tool_guides", "update")[0];
    check("G21 save: an existing row → UPDATE … eq(tool_key) eq(updated_at, the row's own value) returning (select)",
      r.ok && !!upd && upd.ops.includes("eq(tool_key,retouch)") && upd.ops.includes(`eq(updated_at,${ROW_TS})`) && upd.ops.some((o) => o.startsWith("select("))
        && (upd.payload as Row).tutorial_enabled === false && db.tables.tool_guides[0].tutorial_enabled === false);
  }
  {
    const db = adminDb(); existing(db);
    db.beforeUpdate = (table, rows) => { if (table === "tool_guides") rows[0].updated_at = "2026-10-11T00:00:00+00:00"; };
    const r = await save(saveInput({ base: ROW_TS }));
    check("G22 save: another admin saved between the read and the update (0 rows matched) → conflict, no audit, no cache",
      !r.ok && r.error === "conflict" && iceState.audits.length === 0 && iceState.revalidated.length === 0);
  }
  {
    const results: number[] = [];
    for (const [v, again] of [[3, true], [3, false], [1000000, true]] as const) {
      const db = adminDb(); existing(db, { tutorial_version: v });
      const r = await save(saveInput({ base: ROW_TS, showAgain: again }));
      results.push(r.ok ? r.data?.version ?? -1 : -1);
    }
    check("G23 save: \"show again\" raises the version by one (3 → 4), without it stays (3), capped at 1 000 000", same(results, [4, 3, 1000000]), results.join(","));
  }
  {
    const db = adminDb();
    const r = await save(saveInput({ showAgain: true }));
    check("G23b save: \"show again\" on the first save → version 2 (everyone who saw the shipped v1 sees it once more)", r.ok && r.data?.version === 2);
  }
  {
    const db = adminDb(); existing(db, { content: validContent(2) });
    const r = await save(saveInput({ base: ROW_TS, content: null }));
    check("G24 save: content null → the row's copy is cleared (back to the shipped default)", r.ok && db.tables.tool_guides[0].content === null);
  }

  // ── pictures ───────────────────────────────────────────────────────────
  const K = (n: number) => guideSlotKey("retouch", "tutorial", n);
  const KS = guideSlotKey("retouch", "starter", 1);
  const withSlots = (db: FakeDb) => {
    db.tables.media_slots = [
      { slot_key: K(1), media_id: IMG1, updated_at: T_A }, { slot_key: K(2), media_id: IMG2, updated_at: T_B },
      { slot_key: K(5), media_id: IMG4, updated_at: T_C }, { slot_key: KS, media_id: IMG7, updated_at: T_D },
      { slot_key: K(6), media_id: null, updated_at: T_D },
    ];
  };
  {
    const db = adminDb(); withSlots(db);
    const r = await save(saveInput({ content: validContent(4), images: { steps: [IMG1, IMG3, null, null, IMG2, IMG2], starter: null } }));
    const calls = db.rpcCalls("media_slots_write");
    const writes = (calls[0]?.args.p_writes as Row[] | undefined) ?? [];
    const byKey = new Map(writes.map((w) => [w.key as string, w]));
    check("G25 pictures: ONE media_slots_write call with only the positions that CHANGED", r.ok && calls.length === 1 && same([...byKey.keys()].sort(), [K(2), K(5), KS].sort()),
      [...byKey.keys()].join(","));
    check("G25b … an unchanged picture (step 1) and a still-empty position (steps 3, 4, an already-cleared 6) are skipped",
      !byKey.has(K(1)) && !byKey.has(K(3)) && !byKey.has(K(4)) && !byKey.has(K(6)));
    check("G25c … a replaced picture carries the new media id and the slot's own updated_at as its compare-and-set base",
      byKey.get(K(2))?.media_id === IMG3 && byKey.get(K(2))?.base === T_B);
    check("G25d … positions beyond the step count are CLEARED (step 5 on a 4-step tutorial), whatever the form sent there",
      byKey.get(K(5))?.media_id === "" && byKey.get(K(5))?.base === T_C);
    check("G25e … the starter picture set to none is cleared", byKey.get(KS)?.media_id === "" && byKey.get(KS)?.base === T_D);
    const w = byKey.get(K(2)) ?? {};
    check("G26 … each write is entity_type 'tool', entity_id <tool>, slot_name tutorial.<n> / starter.1, an image, cover/center, p_action save",
      w.entity_type === "tool" && w.entity_id === "retouch" && w.slot_name === "tutorial.2" && byKey.get(KS)?.slot_name === "starter.1"
        && w.media_type === "image" && w.object_fit === "cover" && w.object_position === "center center" && calls[0]?.args.p_action === "save"
        && w.tablet_media_id === "" && w.mobile_media_id === "" && w.poster_media_id === "");
    check("G26b … the positions sent are checked against the library only where a step exists (step 6's id was never asked about)",
      db.fromCalls("media_assets")[0]?.ops.includes("in(id,2)"));
    check("G27 a changed picture makes the media-slots tag stale, and the guide tag, and the admin page",
      iceState.revalidated.includes(`tag:${MEDIA_SLOT_TAG}`) && iceState.revalidated.includes(`tag:${TOOL_GUIDES_TAG}`) && iceState.revalidated.includes("path:/admin/ai/retouch"));
    const a = iceState.audits;
    check("G28 one audit row: ai_tool.guide_saved on tool_guide/<tool> by the admin, with what changed",
      a.length === 1 && a[0].action === "ai_tool.guide_saved" && a[0].entityType === "tool_guide" && a[0].entityId === "retouch" && a[0].actorId === ADMIN
        && same(a[0].after, { tutorialEnabled: true, starterEnabled: true, version: 1, customContent: true, images: 3 }), JSON.stringify(a[0]?.after));
    const strays = db.tablesTouched().filter((t) => !ALLOWED_TABLES.has(t) || FORBIDDEN_TABLE.test(t));
    const rpcs = db.rpcCalls().map((c) => c.name).filter((n) => n !== "media_slots_write");
    check("G29 the save touches only tool_guides / media_slots / media_assets / profiles (audit via logAudit); no credit, wallet or generation table; no other rpc",
      strays.length === 0 && rpcs.length === 0, `${short(strays)} ${short(rpcs)}`);
  }
  {
    const db = adminDb(); withSlots(db);
    db.tables.media_slots = db.tables.media_slots.filter((s) => s.slot_key !== K(5));
    const r = await save(saveInput({ content: validContent(4), images: { steps: [IMG1, IMG2], starter: IMG7 } }));
    check("G30 nothing changed in the pictures → no media_slots_write, no media-slots tag; the guide tag still revalidated",
      r.ok && db.rpcCalls("media_slots_write").length === 0 && !iceState.revalidated.includes(`tag:${MEDIA_SLOT_TAG}`) && iceState.revalidated.includes(`tag:${TOOL_GUIDES_TAG}`)
        && iceState.audits[0]?.after !== undefined && (iceState.audits[0].after as Row).images === 0);
  }
  {
    const db = adminDb();
    const r = await save(saveInput({ content: validContent(2), images: { steps: [IMG1], starter: IMG3 } }));
    const writes = (db.rpcCalls("media_slots_write")[0]?.args.p_writes as Row[] | undefined) ?? [];
    check("G31 a brand-new slot is written with base \"\" (the rpc's 'must not exist yet')",
      r.ok && writes.length === 2 && writes.every((w) => w.base === "") && same(writes.map((w) => w.key).sort(), [K(1), KS].sort()));
  }
  {
    const db = adminDb(); withSlots(db);
    const r = await save(saveInput({ content: null, images: { steps: [IMG1, IMG2, null, null, IMG4, IMG3], starter: IMG7 } }));
    const keys = ((db.rpcCalls("media_slots_write")[0]?.args.p_writes as Row[] | undefined) ?? []).map((w) => w.key);
    check("G32 content null → the SHIPPED step count decides (retouch: 4): step 5 cleared, step 6 never written",
      r.ok && same(keys, [K(5)]), keys.join(","));
  }
  for (const [msg, code] of [[`conflict:${K(2)}`, "conflict_images"], ["not_admin", "images_failed"]] as const) {
    const db = adminDb(); withSlots(db);
    db.rpcs.media_slots_write = () => ({ data: null, error: { message: msg } });
    const r = await save(saveInput({ content: validContent(4), images: { steps: [IMG1, IMG3], starter: IMG7 } }));
    check(`G33 media_slots_write raises "${msg}" → ${code}`, !r.ok && r.error === code);
    if (code === "conflict_images") {
      const rowSaved = (db.tables.tool_guides ?? []).length === 1;
      defect("G34 a picture failure leaves NO half-published save (row unsaved) — or, if the row is kept, it is audited and the guide tag revalidated",
        !rowSaved || (iceState.audits.length === 1 && iceState.revalidated.includes(`tag:${TOOL_GUIDES_TAG}`)),
        "app/actions/tool-guides.ts:110-121 writes tool_guides FIRST, then :137 returns early on the media_slots_write error: the new copy/switches/version are in the database but logAudit and revalidateTag(TOOL_GUIDES_TAG) never run (customers keep the old guide for up to 300 s; an admin change goes unaudited; the error result carries no new updatedAt, so the form's base is stale → next save \"conflict\"). Fix: write the pictures before the row, or run logAudit + revalidateTag(TOOL_GUIDES_TAG) right after the row write (audit images: \"failed\") and return savedAt alongside the images error");
    }
  }
  {
    const db = adminDb(); withSlots(db); db.tableErrors.media_slots = { message: "permission denied for table media_slots", code: "42501" };
    // The admin removes every picture (all positions null) — nothing to add.
    const r = await save(saveInput({ content: validContent(4), images: { steps: [null, null, null, null], starter: null } }));
    defect("G35 a failed read of the current pictures is not taken as \"no pictures\" (a requested removal is never silently dropped)",
      !r.ok || db.rpcCalls("media_slots_write").length > 0,
      "lib/services/tool-guides.ts:77 readGuideSlots ignores `error` and returns an empty Map; saveToolGuideAction (app/actions/tool-guides.ts:124-128) then skips every null position (`!cur && mediaId === null`) and answers ok although the pictures the admin removed stay live. Fix: have readGuideSlots return null on error and the action answer { ok: false, error: \"images_failed\" } (the row write should then also be reconsidered, see G34)");
  }
  {
    const db = adminDb(); db.pgTimestamps = true;
    const first = await save(saveInput());
    const second = first.ok ? await save(saveInput({ base: first.data?.updatedAt ?? null })) : first;
    check("G36 the updatedAt a save returns is a valid base for the next save (PostgREST's '+00:00' spelling, no false conflict)",
      first.ok && second.ok, `${first.ok ? first.data?.updatedAt : first.error} → ${second.ok ? "ok" : second.error}`);
    check("G36b … it is the STORED value, as a re-read of the row spells it", first.ok && first.data?.updatedAt === pgTimestamp(first.data?.updatedAt ?? "")
      && Date.parse(first.data?.updatedAt ?? "") > 0);
    const db2 = adminDb(); db2.pgTimestamps = true; existing(db2, { updated_at: "2026-10-10T10:00:00.5+00:00" });
    const third = await save(saveInput({ base: "2026-10-10T10:00:00.500Z" }));
    check("G36c the compare-and-set compares INSTANTS: the same moment spelt the JavaScript way is not a conflict", third.ok, third.ok ? "" : third.error);
  }
  {
    const db = adminDb();
    const big = mut((c) => { for (const s of c.tutorial.steps) { s.title.pl = "T".repeat(80); s.body.pl = "B".repeat(400); } }, 6);
    const r = await save(saveInput({ content: big }));
    check("G37 the fullest content the validator allows is accepted by the emulated DB CHECK on insert (no 23514 surprise)", r.ok);
  }

  // ── the "use server" files ─────────────────────────────────────────────
  for (const file of ["app/actions/tool-guide-seen.ts", "app/actions/tool-guides.ts"]) {
    const src = read(file);
    const exportsList = [...src.matchAll(/^export\s+(.+)$/gm)].map((m) => m[1]);
    check(`G38 ${file} starts with "use server" and exports only async functions (and types)`,
      /^\s*["']use server["'];?\s*\n/.test(src) && exportsList.length > 0 && exportsList.every((l) => /^async function \w+\(/.test(l) || /^type \w+/.test(l)), short(exportsList));
  }
  check("G39 at runtime both actions are AsyncFunctions", [markToolTutorialSeenAction, saveToolGuideAction].every((f) => f.constructor.name === "AsyncFunction"));
}

/* ══ H. SCOPE ══════════════════════════════════════════════════════════════ */

const FROZEN = [
  "components/retouch/", "app/(app)/retusz/", "lib/server/retouch", "lib/server/engine/", "lib/ai/", "lib/server/thumbnail/",
  "components/thumbnail/", "app/api/thumbnail/", "lib/thumbnail/", "app/(app)/layout.tsx", "app/globals.css",
  "components/genv3/workspace.tsx", "lib/server/gallery.ts", "app/api/generations/",
];
const isFrozen = (p: string) => FROZEN.some((f) => (f.endsWith("/") ? p.startsWith(f) : p === f || p.startsWith(f)));

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? filesUnder(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}
function importsOf(file: string): { spec: string; typeOnly: boolean }[] {
  const src = read(file);
  const re = /\b(import|export)\s+(type\s+)?(?:[^;"'`]*?\sfrom\s*)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;
  return [...src.matchAll(re)].map((m) => ({ spec: m[3] ?? m[4] ?? "", typeOnly: Boolean(m[2]) })).filter((x) => x.spec);
}

function sectionH() {
  console.log("\nH. SCOPE — frozen modules, the gallery, the starter and the dialog, i18n scopes, the migration, boundaries");

  let porcelain: string[] = [];
  let diff: string[] = [];
  let gitOk = true;
  try {
    const raw = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { encoding: "utf8" });
    const parts = raw.split("\0").filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const e = parts[i];
      porcelain.push(e.slice(3));
      if (e[0] === "R" || e[0] === "C") porcelain.push(parts[++i]);
    }
    diff = execFileSync("git", ["diff", "--name-only", "HEAD"], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch { gitOk = false; }
  const touched = porcelain.filter(isFrozen);
  check(`H1 git status: no frozen file is modified, added or untracked (${porcelain.length} paths in the working tree)`, gitOk && touched.length === 0, short(touched));
  const dTouched = diff.filter(isFrozen);
  check("H2 git diff --name-only HEAD: no frozen file differs from HEAD (Retusz, engine, lib/ai, Miniaturka, layout, globals.css, genv3 workspace, gallery server, generations API)", gitOk && dTouched.length === 0, short(dTouched));

  const gallery = read("components/genv3/gallery.tsx");
  const galleryCode = code(gallery);
  check("H3 components/genv3/gallery.tsx has no \"aspect-square\" (results keep their real ratio)", !gallery.includes("aspect-square"));
  check("H4 … and still lays results out with useRatioGrid + assetAspect", /useRatioGrid\(/.test(galleryCode) && /grid\.itemStyle\(assetAspect\(item\)\)/.test(galleryCode));
  check("H5 … the guide tool is guideTool ?? (operation ? guideToolForOperation : guideToolForPath(pathname))",
    /guideTool \?\? \(operation \? guideToolForOperation\(operation\) : guideToolForPath\(pathname\)\)/.test(galleryCode));
  const sgIdx = galleryCode.indexOf("<StarterGallery"); const svIdx = galleryCode.indexOf("starterVisible({");
  check("H6 … the StarterGallery is rendered only in the empty branch, behind starterVisible(…) with the real filter/cursor/fresh state",
    sgIdx > svIdx && svIdx > galleryCode.indexOf("merged.length === 0 && pendingCount === 0 && !loading")
      && /filtered: filter\.session !== "all" \|\| filter\.fav \|\| filter\.q\.trim\(\) !== ""/.test(galleryCode)
      && /moreToLoad: cursor !== null, madeHere: freshItems\.length > 0/.test(galleryCode) && (galleryCode.match(/<StarterGallery/g) ?? []).length === 1);
  check("H6b … and renders the tutorial button and the dialog", galleryCode.includes("{guide.button}") && galleryCode.includes("{guide.dialog}"));

  const starterSrc = read("components/tool-guide/starter-gallery.tsx");
  const sc = code(starterSrc);
  const banned = [/download/i, /favou?rite/i, /\bdelete\b/i, /\bremove\b/i, /saveImageFrom/, /saveBlob/, /\.download/, /<button/, /<a[\s>]/, /\bhref=/, /onClick/, /<Link\b/];
  const hits = banned.filter((re) => re.test(sc)).map(String);
  check("H7 starter-gallery.tsx (code, not comments) has no action: no download/favourite/delete, no saveImageFrom/saveBlob/.download, no button, link or click handler",
    hits.length === 0, short(hits));
  check("H7b … it is labelled as an example twice (badge + note) and its picture is contained, never cropped",
    sc.includes('t("toolGuide.starterBadge")') && sc.includes('t("toolGuide.starterNote")') && sc.includes("object-contain") && !sc.includes("object-cover"));
  const render = (locale: Locale, el: ReactElement) => renderToStaticMarkup(createElement(I18nProvider, { locale, dict: DICTS[locale], children: el }));
  const withImg = render("pl", createElement(StarterGallery, { title: "Zobacz efekt", body: "Opis", image: { url: "https://cdn.test/s.png", srcSet: "https://cdn.test/s-640.png 640w", width: 1200, height: 1600, alt: "" } }));
  check("H8 rendered (pl): no <button>, no <a>, no download attribute; badge and note in Polish",
    !/<button|<a\s|download=/i.test(withImg) && withImg.includes(lookup(DICTS.pl, "toolGuide.starterBadge") ?? "@@") && withImg.includes(lookup(DICTS.pl, "toolGuide.starterNote") ?? "@@"));
  check("H8b rendered: the picture keeps its own ratio (aspect-ratio from width/height), alt falls back to the title, srcset kept, not draggable",
    withImg.includes("aspect-ratio:1200 / 1600") && withImg.includes('alt="Zobacz efekt"') && /srcset="https:\/\/cdn\.test\/s-640\.png 640w"/i.test(withImg) && withImg.includes('draggable="false"'));
  const noImg = render("en", createElement(StarterGallery, { title: "See it", body: "", image: null, fallbackArt: "compress" }));
  check("H8c rendered without a picture (en): the drawn showcase (aria-hidden svg), 16/10 frame, English labels, no empty body paragraph",
    /<svg[^>]*aria-hidden="true"/.test(noImg) && noImg.includes("aspect-ratio:16 / 10") && noImg.includes(lookup(DICTS.en, "toolGuide.starterBadge") ?? "@@") && !/<img/.test(noImg)
      && (noImg.match(/<p\b/g) ?? []).length === 0);
  const artsBad = GUIDE_ARTS.filter((a) => {
    const svg = renderToStaticMarkup(createElement(GuideArtwork, { art: a }));
    return !/^<svg[^>]*aria-hidden="true"/.test(svg) || svg.length < 400;
  });
  check(`H9 every illustration renders as a decorative (aria-hidden) svg drawing (${GUIDE_ARTS.length})`, artsBad.length === 0, short(artsBad));
  const artSrc = read("components/tool-guide/guide-art.tsx");
  const labels = [...artSrc.matchAll(/label="([^"]*)"/g), ...artSrc.matchAll(/>([^<>{}\n]*[A-Za-z0-9][^<>{}\n]*)<\/text>/g)].map((m) => m[1].trim());
  const wordy = labels.filter((l) => !/^(\d+:\d+|[1-9]K|PNG|WebP|JPG)$/.test(l));
  check(`H9b the drawings' only text is language-neutral (ratios, 2K/4K, formats: ${[...new Set(labels)].join(" ")}) — no hard-coded words`, labels.length > 0 && wordy.length === 0, short(wordy));

  const modal = read("components/tool-guide/tutorial-modal.tsx");
  const mc = code(modal);
  check("H10 tutorial modal: role=\"dialog\", aria-modal=\"true\", aria-labelledby = the h2's id",
    /role="dialog"/.test(mc) && /aria-modal="true"/.test(mc) && /aria-labelledby=\{titleId\}/.test(mc) && /<h2 id=\{titleId\}/.test(mc));
  check("H11 … Escape closes it (keydown listener while open, removed on close)",
    /e\.key === "Escape"\) \{ e\.preventDefault\(\); onClose\(\);/.test(mc) && /addEventListener\("keydown", onKey\)/.test(mc) && /removeEventListener\("keydown", onKey\)/.test(mc));
  check("H12 … Tab is trapped inside (focusable list, first ↔ last wrap with and without Shift, Shift+Tab from the dialog box itself)",
    /e\.key !== "Tab"/.test(mc) && /querySelectorAll<HTMLElement>\(FOCUSABLE\)/.test(mc)
      && /e\.shiftKey && \(active === first \|\| active === dialogRef\.current\)\) \{ e\.preventDefault\(\); end\.focus\(\)/.test(mc)
      && /!e\.shiftKey && active === end\) \{ e\.preventDefault\(\); first\.focus\(\)/.test(mc));
  check("H13 … focus goes to the primary button on open and BACK to the opener on close; page scroll is locked and restored",
    /primaryRef\.current\?\.focus\(\)/.test(mc) && /opener\.current = document\.activeElement/.test(mc) && /back\.focus\(\)/.test(mc) && /document\.body\.style\.overflow = prev/.test(mc)
      // <html> is locked too: globals.css clips it horizontally, so a lock on <body> alone never reaches the viewport.
      && /root\.style\.overflow = "hidden"/.test(mc) && /root\.style\.overflow = prev\.html/.test(mc));
  check("H14 … rendered in a portal on <body>, with a labelled progressbar and polite live regions",
    /createPortal\([\s\S]*document\.body,\s*\)/.test(mc) && /role="progressbar"/.test(mc) && /aria-live="polite"/.test(mc));
  const ssr = renderToStaticMarkup(createElement(TutorialModal, { open: true, onClose: () => {}, tutorial: { title: "T", body: "", steps: [{ title: "S", body: "", art: "upload", image: null }] } }));
  check("H14b … and renders nothing on the server (no document → no hydration of a portal)", ssr === "");

  const hook = code(read("components/tool-guide/use-tool-guide.tsx"));
  check("H15 use-tool-guide: asks /api/tool-guides?tool=<encoded> with cache no-store, same-origin",
    /fetch\(`\/api\/tool-guides\?tool=\$\{encodeURIComponent\(tool\)\}`, \{ cache: "no-store", credentials: "same-origin" \}\)/.test(hook));
  check("H16 … marks seen with the TOOL only (markToolTutorialSeenAction(tool), no version from the browser)",
    /markToolTutorialSeenAction\(tool\)/.test(hook) && !/markToolTutorialSeenAction\(tool,/.test(hook));
  check("H17 … opens by itself only through shouldAutoOpen, and waits while another modal dialog or the visual editor is open",
    /shouldAutoOpen\(response, false\)/.test(hook) && hook.includes(`'[role="dialog"][aria-modal="true"], [data-ice-ui]'`));
  check("H18 … no button unless the tool is live and the tutorial has steps",
    /const tutorial = response\?\.live \? response\.guide\?\.tutorial \?\? null : null;/.test(hook) && /tutorial && tutorial\.steps\.length > 0 \?/.test(hook));

  const photo = code(read("components/tools/photo-tool.tsx"));
  const resize = code(read("components/tools/resize-workbench.tsx"));
  const compress = code(read("components/tools/compress-workbench.tsx"));
  const batch = code(read("components/tools/batch-gallery.tsx"));
  check("H19 photo-tool: the guide is tool_<slug>, the starter needs the tool to be available, and the dialog is mounted",
    /useToolGuide\(`tool_\$\{tool\}` as GuideToolKey\)/.test(photo) && /\}\) && available && guide\.response\?\.guide\?\.starter \?/.test(photo) && photo.includes("{guide.dialog}"));
  check("H20 resize / compress workbenches: their own guide, the button in the batch toolbar's `extra`, starterVisible over an empty queue, the dialog mounted",
    /useToolGuide\("resize"\)/.test(resize) && /useToolGuide\("compress"\)/.test(compress)
      && [resize, compress].every((s) => s.includes("extra={guide.button}") && s.includes("starterVisible({") && s.includes("{guide.dialog}"))
      && /extra && <div className="ml-auto flex shrink-0 items-center">\{extra\}<\/div>/.test(batch));

  const appScope: readonly string[] = SCOPES.app;
  const rootScope: readonly string[] = SCOPES.root;
  const anyDefaults = Object.entries(SCOPES).filter(([, list]) => (list as readonly string[]).includes("toolGuideDefaults")).map(([k]) => k);
  check("H21 lib/i18n/scopes.ts: the app scope sends toolGuide to the browser", appScope.includes("toolGuide"));
  check("H22 … but NOT toolGuideDefaults (every tool's shipped tutorial copy stays off customer pages: neither app nor root scope)",
    !appScope.includes("toolGuideDefaults") && !rootScope.includes("toolGuideDefaults"), short(anyDefaults));
  if (anyDefaults.length) note(`toolGuideDefaults is serialised by the ${anyDefaults.join(", ")} scope(s) — admin-only surfaces (the guide editor), never a customer page`);

  const noComments = SQL_0142.replace(/--[^\n]*/g, "");
  const segments = noComments.split(";").map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
  const destructive = segments.filter((s) => /^(drop|delete|truncate)\b/i.test(s));
  const updNoWhere = segments.filter((s) => /^update\b/i.test(s) && !/\bwhere\b/i.test(s));
  check(`H23 0142 (Supabase's heuristic, ${segments.length} ';' segments incl. function bodies): no segment starts with DROP / DELETE / TRUNCATE`, destructive.length === 0, short(destructive.map((s) => s.slice(0, 40))));
  check("H24 … and no UPDATE without a WHERE (the one inside mark_tool_tutorial_seen is scoped to the caller's row)",
    updNoWhere.length === 0 && segments.some((s) => /^update public\.user_preferences .* where user_id = v_uid\b/i.test(s)), short(updNoWhere.map((s) => s.slice(0, 40))));
  check("H25 … nor a DROP/TRUNCATE/DELETE FROM/ALTER TABLE anywhere in its code (FK \"on delete\" clauses aside)",
    !/\b(drop|truncate)\b/i.test(noComments) && !/\bdelete\s+from\b/i.test(noComments) && !/\balter\s+table\s+(?!public\.tool_guides\b)/i.test(noComments));
  check("H26 0142: RLS on tool_guides, admin-only policy, anon revoked",
    /alter table public\.tool_guides enable row level security/.test(SQL_0142) && /using \(\(select public\.is_admin\(\)\)\)\s*with check \(\(select public\.is_admin\(\)\)\)/.test(SQL_0142)
      && /revoke all on public\.tool_guides from anon/.test(SQL_0142));
  check("H27 0142: tool_guides_published is SECURITY DEFINER with a pinned search_path, hands out a part's copy only when it is on, executable by anon (the cache reader)",
    /function public\.tool_guides_published\(\)[\s\S]*?security definer\s*\n\s*set search_path = public/.test(SQL_0142)
      && /case when g\.tutorial_enabled then g\.content -> 'tutorial' end/.test(SQL_0142) && /case when g\.starter_enabled then g\.content -> 'starter' end/.test(SQL_0142)
      && /grant execute on function public\.tool_guides_published\(\) to anon, authenticated/.test(SQL_0142));
  check("H28 0142: mark_tool_tutorial_seen is SECURITY INVOKER (the user's own row by RLS), keeps the highest version, not executable by anon",
    /function public\.mark_tool_tutorial_seen[\s\S]*?security invoker/.test(SQL_0142) && /greatest\(\s*p_version/.test(SQL_0142)
      && /revoke all on function public\.mark_tool_tutorial_seen\(text, integer\) from public, anon/.test(SQL_0142) && !/mark_tool_tutorial_seen\(text, integer\) to anon/.test(SQL_0142));
  const bounds = /tutorial_version integer not null default 1 check \(tutorial_version between 1 and (\d+)\)/.exec(SQL_0142)?.[1];
  const seenBounds = /p_version not between 1 and (\d+)/.exec(SQL_0142)?.[1];
  check("H29 0142's version bounds (row CHECK and mark function) equal the action's cap of 1 000 000",
    bounds === "1000000" && seenBounds === "1000000" && /Math\.min\(version, 1000000\)/.test(read("app/actions/tool-guides.ts")));
  check("H30 0142: the content CHECK uses content_text_ok and the 2000-char / 64 KiB bounds the emulation in this suite reads",
    /content jsonb check \(public\.tool_guide_content_ok\(content\)\)/.test(SQL_0142) && /octet_length\(c::text\) <= 65536/.test(SQL_0142)
      && /length\(leaf\.value #>> '\{\}'\) > 2000/.test(SQL_0142) && sqlTextOk !== null);

  const libImports = importsOf("lib/tool-guides.ts");
  const libBad = libImports.filter((x) => !x.typeOnly && (x.spec.startsWith("@/lib/server/") || x.spec.includes("dictionaries") || x.spec === "server-only"));
  check("H31 lib/tool-guides.ts is client-safe: no lib/server/**, no dictionary, no server-only", libImports.length > 0 && libBad.length === 0, short(libBad.map((x) => x.spec)));
  const comp = filesUnder("components/tool-guide");
  const compBad = comp.flatMap((f) => importsOf(f).filter((x) => !x.typeOnly && (x.spec.startsWith("@/lib/server/") || x.spec.includes("dictionaries") || x.spec === "server-only" || x.spec === "@/lib/services/tool-guides")).map((x) => `${f} → ${x.spec}`));
  check(`H32 components/tool-guide/* (${comp.length} files) import no lib/server/**, no service, no dictionary JSON`, comp.length >= 4 && compBad.length === 0, short(compBad));
  const clientNoDirective = comp.filter((f) => !/^\s*["']use client["']/.test(read(f)));
  check("H32b … and every one of them is a \"use client\" module", clientNoDirective.length === 0, short(clientNoDirective));
  if (existsSync("components/tool-guide/lazy.tsx")) {
    const lazy = code(read("components/tool-guide/lazy.tsx"));
    check("H32c lazy.tsx: the dialog and the starter gallery are client-only chunks (next/dynamic, ssr: false)",
      /dynamic\(\(\) => import\("\.\/tutorial-modal"\)[^;]*\{ ssr: false \}/.test(lazy) && /dynamic\(\(\) => import\("\.\/starter-gallery"\)[^;]*\{ ssr: false \}/.test(lazy));
  }
  const serverFiles = ["lib/server/tool-guides.ts", "lib/server/tool-guides-published.ts"];
  check("H33 lib/server/tool-guides*.ts both import \"server-only\"", serverFiles.every((f) => /^\s*import\s+["']server-only["'];?/m.test(read(f))));
  const seenImports = importsOf("app/actions/tool-guide-seen.ts").map((x) => x.spec);
  check("H34 the customer's seen action never imports lib/server/tool-guides (it would pull every tool's shipped copy into its graph)",
    !seenImports.includes("@/lib/server/tool-guides") && seenImports.includes("@/lib/server/tool-guides-published"));
  const implFiles = ["lib/tool-guides.ts", "lib/server/tool-guides.ts", "lib/server/tool-guides-published.ts", "lib/services/tool-guides.ts",
    "app/api/tool-guides/route.ts", "app/actions/tool-guide-seen.ts", "app/actions/tool-guides.ts", ...comp];
  const paid = implFiles.flatMap((f) => importsOf(f).filter((x) => /^@\/lib\/ai\/|credit|ledger|wallet|usage|billing|stripe|provider-credentials|@\/lib\/server\/generation|@\/lib\/server\/engine\/(?!tool-run$)/.test(x.spec)).map((x) => `${f} → ${x.spec}`));
  check("H35 presentation only: no guide file imports lib/ai, a credit/ledger/usage/billing module, provider credentials or the generation runner",
    paid.length === 0, short(paid));
  const routeSrc = code(read("app/api/tool-guides/route.ts"));
  check("H36 the route is force-dynamic, GET only, and answers with Cache-Control: no-store",
    /export const dynamic = "force-dynamic"/.test(routeSrc) && !/export async function (POST|PUT|PATCH|DELETE)/.test(routeSrc) && /"Cache-Control": "no-store"/.test(routeSrc));
}

/* ══ main ══════════════════════════════════════════════════════════════════ */

async function main() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("network disabled in the tool-guide suite"); }) as typeof fetch;
  sectionA();
  sectionB();
  sectionC();
  sectionD();
  sectionE();
  await sectionF();
  await sectionG();
  sectionH();
  check("Z the shipped dictionaries were never mutated by anything in this run", LOCALES.every((l, i) => JSON.stringify(DICTS[l]) === SHIPPED_JSON[i]));
  globalThis.fetch = realFetch;
  if (notes.length) console.log(`\nNotes:\n${notes.map((n) => `  · ${n}`).join("\n")}`);
  if (defects.length) {
    console.log(`\nDefects found (reported, not fixed — GUIDE_STRICT=1 makes them fail):\n${defects.map((d) => `  ! ${d}`).join("\n")}`);
  }
  if (failures) console.log(`\nFailed:\n${failedNames.map((n) => `  ✗ ${n}`).join("\n")}`);
  console.log(`\n${failures === 0 ? `All tool-guide tests passed (${passed} checks).` : `${failures} TOOL-GUIDE TEST(S) FAILED (${passed} passed).`}`
    + (defects.length && !STRICT ? ` ${defects.length} implementation defect(s) reported above.` : ""));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { loud(); console.error(e); process.exit(1); });
