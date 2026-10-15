/**
 * THE INLINE CONTENT EDITOR — npm run test:ice
 *
 *   A  the registry: every editable key exists in pl/en/de and is not denied,
 *      the /home slots match the page config, card slots are the ones
 *      Admin → Media declares, selectors parse, the CMS field lists hold no
 *      links / styles / code / prices
 *   B  stega markers: round trip, strip, survival, the invisible-character
 *      list and its parity with the SQL content_text_ok() in 0141
 *   C  dictionary overrides: no copy when idle, never mutating, flat keys,
 *      placeholders kept, applicableOverrides' filter
 *   D  validate: every TextProblem code, normalise, soft limit, alt text
 *   E  sniff: the six formats from their bytes, the limits, safeName
 *   F  the CMS layer: field numbering, marking only what the renderer shows,
 *      markPublishedPage's session rules
 *   G  the dictionary layer: overrides, markers for exactly the edited page,
 *      never in a server action, the shipped copy on any failure
 *   H  edit sessions: cookie names, parsing, specificity, admin only; gate
 *   I  the server actions over a fake Supabase: who may call, what is
 *      refused before any write, the exact RPC payloads, conflicts, audit
 *      rows and the one cache tag each write makes stale
 *   J  boundaries: the "use server" file only delegates, server-only
 *      everywhere in lib/server/ice, the client never imports the registry
 *
 * Mocks only — no network, no database (scripts/stubs/ice-*.ts).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import pl from "@/lib/i18n/dictionaries/pl.json";
import en from "@/lib/i18n/dictionaries/en.json";
import de from "@/lib/i18n/dictionaries/de.json";
import { lookup } from "@/lib/i18n/t";
import { lt, type LocaleText } from "@/lib/cms";
import { applyOverrides, rewriteKeys } from "@/lib/i18n/overrides";
import {
  CMS_FIELDS, CMS_MULTILINE, ICE_PAGES, ICE_TEXT_KEYS, ICE_UNSUPPORTED, LAUNCH_TEXT_FIELDS, allElements, cardSlotKey,
  icePageByKey, icePageFor, isDeniedKey, pageTextKeys, pagesOfText, slotSpec, textSpec,
} from "@/lib/ice/registry";
import { MARK_END, MARK_START, hasInvisible, stegaLocate, stegaMark, stegaRead, stegaStrip } from "@/lib/ice/stega";
import { altProblem, normaliseText, softLimit, textProblem } from "@/lib/ice/validate";
import {
  ICE_IMAGE_MIMES, ICE_MAX_IMAGE_BYTES, ICE_MAX_SAMPLE_BYTES, ICE_MAX_VIDEO_BYTES, ICE_VIDEO_MIMES, isIceMime, kindOf,
  maxBytesFor, safeName, sniff,
} from "@/lib/ice/sniff";
import type { IceCmsField, IceLocale, IcePage, IceSlotSpec, IceSlotWrite, IceTextState } from "@/lib/ice/types";
import {
  BANNER_FRAME, BEFORE_AFTER, BEFORE_AFTER_SIZE, CAROUSEL, FEATURED, PROMO_BANNERS, SESSIONS, SHOWCASE, THUMBNAILS, TOOL_TILE,
  UPLOAD_TOOLS, assetList, ratioOf,
} from "@/lib/seller-home-config";
import { categorySlotKey, isKnownSlot, slotDef, toolSlotKey, workflowSlotKey } from "@/lib/media-slots";
import { findCategory } from "@/lib/categories";
import { CONTENT_TAG, applicableOverrides } from "@/lib/server/ice/overrides";
import { layerDictionary } from "@/lib/server/ice/dictionary";
import {
  ICE_EDIT_PREFIX, ICE_HINT_COOKIE, editCookieName, editCookieValue, iceCookies, iceEditSession, iceEditSessions,
  iceViewerIsAdmin, newNonce, parseEditCookie,
} from "@/lib/server/ice/session";
import { blockFields, isUuid, markBlocks, markPublishedPage, markText, valueAt, type CmsBlockLike } from "@/lib/server/ice/cms";
import * as actions from "@/lib/server/ice/actions";
import * as wrappers from "@/app/actions/ice";
import { iceGateData } from "@/lib/server/ice/gate";
import { CMS_TAG } from "@/lib/server/public-site";
import { MEDIA_SLOT_TAG } from "@/lib/server/media-slots";
import { iceState, resetIceState } from "./stubs/ice-state";
import { FakeDb, STORAGE_PUBLIC, type Row } from "./stubs/ice-fake-db";

let failures = 0;
let passed = 0;
const failedNames: string[] = [];
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failures++; failedNames.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const notes: string[] = [];
function note(s: string) { notes.push(s); console.log(`  · ${s}`); }

type Dict = Record<string, unknown>;
const LOCALES: IceLocale[] = ["pl", "en", "de"];
const DICTS: Record<IceLocale, Dict> = { pl: pl as Dict, en: en as Dict, de: de as Dict };
const SHIPPED_JSON = LOCALES.map((l) => JSON.stringify(DICTS[l]));
const short = (xs: string[], n = 10) => (xs.length > n ? `${xs.slice(0, n).join(", ")} … (+${xs.length - n})` : xs.join(", "));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

/** Every string leaf of a dictionary, with its dotted path. */
function leaves(d: unknown, path: string[] = [], out: [string, string][] = []): [string, string][] {
  if (typeof d === "string") out.push([path.join("."), d]);
  else if (d && typeof d === "object") for (const [k, v] of Object.entries(d)) leaves(v, [...path, k], out);
  return out;
}

const HOME = icePageFor("/home") as IcePage;
const PLANS = icePageFor("/plany") as IcePage;
const sectionSlots = (page: IcePage, key: string): IceSlotSpec[] =>
  page.sections.find((s) => s.key === key)?.elements.flatMap((e) => e.slots ?? []) ?? [];
const ratioValue = (r: string) => { const [a, b] = r.split("/").map(Number); return a / b; };

// console noise from the code under test (its own warn/error lines) is
// captured, not printed — a refusal path is expected to log.
const captured: string[] = [];
const realWarn = console.warn;
const realError = console.error;
function quiet() {
  console.warn = (...a: unknown[]) => { captured.push(a.map(String).join(" ")); };
  console.error = (...a: unknown[]) => { captured.push(a.map(String).join(" ")); };
}
function loud() { console.warn = realWarn; console.error = realError; }

/* ══ A. REGISTRY ═══════════════════════════════════════════════════════════ */

async function sectionA() {
  console.log("\nA. REGISTRY — keys, slots, selectors, CMS field lists");

  const missing: string[] = [];
  for (const k of ICE_TEXT_KEYS) for (const l of LOCALES) {
    const v = lookup(DICTS[l], k);
    if (typeof v !== "string" || !v.trim()) missing.push(`${l}:${k}`);
  }
  check("A1 every registered text key resolves to a non-empty string in pl, en AND de", missing.length === 0, short(missing));

  const denied: string[] = [];
  for (const k of ICE_TEXT_KEYS) for (const l of LOCALES) {
    const v = lookup(DICTS[l], k);
    if (isDeniedKey(k, typeof v === "string" ? v : undefined)) denied.push(`${l}:${k}`);
  }
  check("A2 no registered key is isDeniedKey(key, its shipped value) in any locale", denied.length === 0, short(denied));

  const FORBIDDEN: [string, RegExp][] = [
    ["a prices/status/statuses segment", /(^|\.)(prices|status|statuses)(\.|$)/],
    ["the credits./creditsPanel. namespace", /^credits(Panel)?\./],
    ["plans./packs./checkout./auth./legal./retouch./thumb.", /^(plans|packs|checkout|auth|auth2|legal|retouch|thumb)\./],
    ["a *Style segment", /Style(\.|$)/],
    ["a .style segment", /(^|\.)style(\.|$)/],
    ["a .suffix segment", /(^|\.)suffix(\.|$)/],
  ];
  for (const [what, re] of FORBIDDEN) {
    const hits = [...ICE_TEXT_KEYS].filter((k) => re.test(k));
    check(`A3 no registered key has ${what}`, hits.length === 0, short(hits));
  }
  const creditWords = [...ICE_TEXT_KEYS].filter((k) => /(^|\.)credits(\.|$)/.test(k));
  check("A3b the only keys with a `credits` segment are the FAQ question/answer about credits (copy, not a value)",
    creditWords.every((k) => k === "pricing.faq.credits.q" || k === "pricing.faq.credits.a"), short(creditWords));

  const union = new Set(ICE_PAGES.flatMap((p) => pageTextKeys(p)));
  check(`A4 ICE_TEXT_KEYS is exactly the union of the pages' text keys (size ${ICE_TEXT_KEYS.size})`,
    union.size === ICE_TEXT_KEYS.size && [...union].every((k) => ICE_TEXT_KEYS.has(k)) && ICE_TEXT_KEYS.size > 100,
    `union ${union.size} vs ${ICE_TEXT_KEYS.size}`);
  note(`ICE_TEXT_KEYS.size = ${ICE_TEXT_KEYS.size} over ${ICE_PAGES.length} pages`);
  const badSpec = [...ICE_TEXT_KEYS].filter((k) => {
    const e = textSpec(k);
    return !e || e.id !== k || e.kind !== "text" || ![60, 120, 240, 900].includes(e.text?.maxLength ?? -1);
  });
  check("A4b every text element: id = its key, a maxLength from the four caps", badSpec.length === 0, short(badSpec));

  const dupPages: string[] = [];
  const unstable: string[] = [];
  for (const p of ICE_PAGES) {
    const a = pageTextKeys(p);
    if (new Set(a).size !== a.length) dupPages.push(p.path);
    if (!same(a, pageTextKeys(p)) || !same(a, pageTextKeys(structuredClone(p)))) unstable.push(p.path);
  }
  check("A5 each page's pageTextKeys is duplicate-free", dupPages.length === 0, short(dupPages));
  check("A5b pageTextKeys is deterministic (two calls, and a structural clone, give the same order)", unstable.length === 0, short(unstable));
  const paths = ICE_PAGES.map((p) => p.path);
  check("A5c page paths and keys are unique, absolute, with no trailing slash",
    new Set(paths).size === paths.length && new Set(ICE_PAGES.map((p) => p.key)).size === ICE_PAGES.length
    && paths.every((p) => /^\/[a-z0-9_/-]*[a-z0-9_-]$/.test(p)));

  const badDefaults: string[] = [];
  for (const k of ICE_TEXT_KEYS) for (const l of LOCALES) {
    const v = lookup(DICTS[l], k);
    const max = textSpec(k)?.text?.maxLength ?? 0;
    if (typeof v === "string") {
      const p = textProblem(k, v, v, max);
      if (p) badDefaults.push(`${l}:${k}=${p}${p === "too_long" ? `(${v.length}>${max})` : ""}`);
    }
  }
  check("A6 every shipped default passes its own element's rules (an admin can always type it back)", badDefaults.length === 0, short(badDefaults));

  // /home slots of entity 'global'
  const homeGlobals = allElements(HOME).flatMap((e) => e.slots ?? []).filter((s) => s.entityType === "global");
  const globalKeys = homeGlobals.map((s) => s.key);
  check("A7 /home global slots: unique keys, all homeMedia.*, entity global/sellerHome, slotName = key minus homeMedia.",
    new Set(globalKeys).size === globalKeys.length
    && homeGlobals.every((s) => s.key.startsWith("homeMedia.") && s.entityId === "sellerHome" && s.slotName === s.key.slice("homeMedia.".length)),
    short(homeGlobals.filter((s) => s.slotName !== s.key.slice(10)).map((s) => s.key)));
  check("A7b every slot's ratio is its own width/height", allElements(HOME).flatMap((e) => e.slots ?? [])
    .every((s) => Math.abs(ratioValue(s.ratio) - s.width / s.height) < 1e-9));

  const thumbs = sectionSlots(HOME, "thumbnails");
  check("A7c thumbnails: 20 global image slots, 1:1, 1200×1200",
    thumbs.length === 20 && thumbs.every((s) => s.entityType === "global" && !s.video && ratioValue(s.ratio) === 1 && s.width === 1200 && s.height === 1200)
    && same(thumbs.map((s) => s.key), THUMBNAILS.tiles.map((t) => t.media.configKey)),
    `${thumbs.length} slots, ratio ${thumbs[0]?.ratio}`);
  note(`thumbnail ratio string is "${thumbs[0]?.ratio}" (= 1/1 as a CSS aspect-ratio)`);
  const sessions = sectionSlots(HOME, "sessions");
  check("A7d sessions: 16 global image slots, sized like SESSIONS.tiles",
    sessions.length === 16 && sessions.every((s, i) => !s.video && s.width === SESSIONS.tiles[i].media.width && s.height === SESSIONS.tiles[i].media.height));
  const showcase = sectionSlots(HOME, "showcase");
  const gallery = showcase.filter((s) => s.key.startsWith("homeMedia.showcase.gallery."));
  const visual = showcase.filter((s) => s.key === SHOWCASE.visual.configKey);
  check("A7e showcase: 12 gallery image slots + 1 visual that takes a video (phone/tablet frames)",
    gallery.length === 12 && gallery.every((s) => !s.video) && visual.length === 1 && visual[0].video
    && same(visual[0].frames?.map((f) => f.label), ["phone", "tablet"]) && showcase.length === 13);
  const promos = ICE_PAGES[0].sections.filter((s) => /^promo\d$/.test(s.key)).flatMap((s) => s.elements.flatMap((e) => e.slots ?? []));
  check("A7f promo: 3 banner slots, video + mobile, wide/tablet/phone frames = BANNER_FRAME",
    promos.length === 3 && promos.every((s) => s.video && s.mobile && same(s.frames, [
      { label: "wide", ratio: ratioOf(BANNER_FRAME.wide) }, { label: "tablet", ratio: ratioOf(BANNER_FRAME.tablet) }, { label: "phone", ratio: ratioOf(BANNER_FRAME.phone) },
    ])) && same(promos.map((s) => s.key), Object.values(PROMO_BANNERS).map((b) => b.media.configKey)));
  const sampleEls = allElements(HOME).filter((e) => e.kind === "samples");
  const samples = sampleEls.flatMap((e) => e.slots ?? []);
  check("A7g samples: 15 slots (3 tools × 5), sample:true, video:false",
    sampleEls.length === 3 && samples.length === 15 && samples.every((s) => s.sample === true && s.video === false && s.entityType === "global"));
  const pairs = allElements(HOME).filter((e) => e.kind === "pair");
  const baSlots = pairs.flatMap((e) => e.slots ?? []);
  check("A7h beforeAfter: 6 pairs = 12 slots, each framed ratioOf(BEFORE_AFTER_SIZE) at its width × height",
    pairs.length === BEFORE_AFTER.length && baSlots.length === 12 && pairs.every((p) => p.slots?.length === 2)
    && baSlots.every((s) => s.ratio === ratioOf(BEFORE_AFTER_SIZE) && s.width === BEFORE_AFTER_SIZE.width && s.height === BEFORE_AFTER_SIZE.height),
    `ratio ${baSlots[0]?.ratio} vs ${ratioOf(BEFORE_AFTER_SIZE)}`);
  note(`BEFORE_AFTER_SIZE is currently ${BEFORE_AFTER_SIZE.width}×${BEFORE_AFTER_SIZE.height} (ratio "${ratioOf(BEFORE_AFTER_SIZE)}")`);
  check("A7i the /home global slots are exactly thumbnails 20 + sessions 16 + showcase 13 + promo 3 + samples 15 + pairs 12",
    homeGlobals.length === 20 + 16 + 13 + 3 + 15 + 12, `got ${homeGlobals.length}`);

  const cardSlots = allElements(HOME).flatMap((e) => e.slots ?? []).filter((s) => s.entityType !== "global");
  const cardKeys = new Set(cardSlots.map((s) => s.key));
  const sql = readFileSync("supabase/migrations/0141_inline_content_editor.sql", "utf8");
  const bound = Number(/array_length\(p_keys, 1\) <= (\d+)/.exec(sql)?.[1] ?? NaN);
  check(`A7j global slots + card slots on /home ≤ media_slots_resolve's bound (${new Set(globalKeys).size} + ${cardKeys.size} ≤ ${bound})`,
    Number.isFinite(bound) && new Set(globalKeys).size + cardKeys.size <= bound);

  const configKeys = new Set(assetList().map((r) => r.media.configKey));
  const tileKeys = new Set([...CAROUSEL, ...FEATURED].map((t) => t.media.configKey));
  // assetList also lists a slot's variants: `<slot>.mobile` (a banner's phone
  // file → the slot must allow `mobile`) and `<slot>.poster` (a clip's still →
  // the slot must take a video). Those are columns of the same row, not slots.
  const covered = (k: string): boolean => {
    if (globalKeys.includes(k) || tileKeys.has(k)) return true;
    const v = /^(.*)\.(mobile|poster)$/.exec(k);
    const spec = v ? homeGlobals.find((s) => s.key === v[1]) : undefined;
    return Boolean(spec && (v![2] === "mobile" ? spec.mobile : spec.video));
  };
  const unregistered = [...configKeys].filter((k) => !covered(k));
  const stray = globalKeys.filter((k) => !configKeys.has(k));
  check("A7k every /home asset (seller-home-config assetList) is a registered slot (its .mobile/.poster a column of it), or a tool tile that uses its card slot",
    unregistered.length === 0 && stray.length === 0, `unregistered: ${short(unregistered)}; not in config: ${short(stray)}`);

  // carousel / featured tiles: the tool-card slot
  let adminSlotKey: ((item: string) => string | null) | null = null;
  try {
    adminSlotKey = (await import("@/lib/server/seller-home")).adminSlotKey;
  } catch (e) {
    note(`lib/server/seller-home.ts could not be loaded in the bundle (${e instanceof Error ? e.message : String(e)}) — compared with lib/media-slots key builders instead`);
  }
  const independent = (item: string): string => {
    if (item.startsWith("cat:")) return categorySlotKey(item.slice(4));
    const [cat, wf] = item.split(".");
    return wf && findCategory(cat) ? workflowSlotKey(cat, wf) : toolSlotKey(item);
  };
  const tiles = [...CAROUSEL.map((t, i) => ({ t, i, section: "carousel" })), ...FEATURED.map((t, i) => ({ t, i, section: "featured" }))];
  const tileBad: string[] = [];
  for (const { t, section } of tiles) {
    const el = HOME.sections.find((s) => s.key === section)?.elements.find((e) => e.kind === "media" && e.dom === `[data-config-key="${t.media.configKey}"]`);
    const slot = el?.slots?.[0];
    const want = adminSlotKey ? adminSlotKey(t.item) : independent(t.item);
    if (!slot || slot.key !== want || slot.key !== cardSlotKey(t.item) || !slot.positionOnly || slot.sharedWith !== "/tools"
      || slot.video || slot.ratio !== ratioOf(TOOL_TILE) || !same(slot.frames, [{ label: "tools", ratio: ratioOf(TOOL_TILE) }])) {
      tileBad.push(`${section}:${t.item}→${slot?.key}≠${want}`);
    }
  }
  check(`A8 every CAROUSEL/FEATURED tile uses the tool-card slot (positionOnly, sharedWith /tools) whose key = ${adminSlotKey ? "seller-home adminSlotKey" : "the lib/media-slots builders"}(item)`,
    tileBad.length === 0 && tiles.length === CAROUSEL.length + FEATURED.length, short(tileBad));
  if (adminSlotKey) {
    const fn = adminSlotKey;
    const differ = [...CAROUSEL, ...FEATURED].map((t) => t.item).filter((it) => cardSlotKey(it) !== fn(it));
    check("A8b cardSlotKey(item) === adminSlotKey(item) for every CAROUSEL and FEATURED item", differ.length === 0, short(differ));
  }
  const allCards = ICE_PAGES.flatMap((p) => allElements(p).flatMap((e) => e.slots ?? [])).filter((s) => s.entityType !== "global");
  // lib/media-slots declares cards only for OFFERED workflows; the catalogue
  // (CATALOG_ITEMS) keeps the hidden Moda presets, and the /tools layout may
  // place one (moda.street is on the default layout) — /tools then paints its
  // card under exactly this key. So an undeclared card slot is acceptable
  // only for a hidden workflow the catalogue keeps; anything else is a typo.
  const undeclared = [...new Set(allCards.filter((s) => !isKnownSlot(s.key)).map((s) => s.key))];
  const unexplained = undeclared.filter((k) => {
    const m = /^category\.([^.]+)\.workflow\.([^.]+)\.card$/.exec(k);
    return !(m && findCategory(m[1])?.workflows.some((w) => w.key === m[2] && w.hidden));
  });
  check("A8c every card slot the editor writes is declared in lib/media-slots, or is a hidden workflow's card the catalogue keeps",
    unexplained.length === 0, short(unexplained));
  if (undeclared.length) note(`card slots the editor can fill but Admin → Media does not declare (hidden workflows kept by CATALOG_ITEMS): ${undeclared.join(", ")}`);
  const drifted = [...new Map(allCards.map((s) => [s.key, s])).values()].flatMap((s) => {
    const d = slotDef(s.key);
    return d && (d.entityType !== s.entityType || d.entityId !== s.entityId || d.slotName !== s.slotName) ? [{ s, d }] : [];
  });
  const driftKinds = [...new Set(drifted.map(({ s, d }) => `${s.entityType}: editor entity_id "${s.entityId}" vs Admin → Media "${d.entityId}"`))];
  check("A8d a card slot's entity columns (first write by the editor) equal Admin → Media's declaration (slotDef)", drifted.length === 0,
    `${drifted.length} slots, e.g. ${short(drifted.map(({ s, d }) => `${s.key}: ${s.entityType}/${s.entityId} vs ${d.entityType}/${d.entityId}`), 2)}; kinds: ${short(driftKinds.map((k) => k.replace(/"[^"]*"/g, "…")).filter((k, i, a) => a.indexOf(k) === i))}`);
  const specDrift: string[] = [];
  const firstSpec = new Map<string, IceSlotSpec>();
  for (const s of ICE_PAGES.flatMap((p) => allElements(p).flatMap((e) => e.slots ?? []))) {
    const f = firstSpec.get(s.key);
    if (!f) { firstSpec.set(s.key, s); continue; }
    const pick = (x: IceSlotSpec) => [x.ratio, x.width, x.height, x.video, x.sample, x.positionOnly, x.mobile, x.entityType, x.entityId, x.slotName];
    if (!same(pick(f), pick(s))) specDrift.push(s.key);
  }
  check("A8e a slot key registered on two pages has one spec (only sharedWith differs)", specDrift.length === 0, short(specDrift));
  check("A8f slotSpec resolves every registered slot key, and nothing else",
    [...firstSpec.keys()].every((k) => slotSpec(k)?.key === k) && slotSpec("homeMedia.nope") === undefined && slotSpec("sellerHome.ba.title") === undefined);

  // selectors
  const ATTR = String.raw`\[[a-zA-Z_][a-zA-Z0-9_-]*(?:[~|^$*]?="[^"\\]*")?\]`;
  const COMPOUND = String.raw`(?:[a-zA-Z][a-zA-Z0-9-]*)?(?:${ATTR}|\.[a-zA-Z_-][\w-]*|#[\w-]+)+`;
  const PART = new RegExp(String.raw`^\s*${COMPOUND}(?:\s*[>+~]?\s*${COMPOUND})*\s*$`);
  const balanced = (sel: string): boolean => {
    let depth = 0; let quote: string | null = null;
    for (const ch of sel) {
      if (quote) { if (ch === quote) quote = null; continue; }
      if (ch === "\"" || ch === "'") quote = ch;
      else if (ch === "[") { if (depth) return false; depth++; } else if (ch === "]") { if (!depth) return false; depth--; }
    }
    return depth === 0 && quote === null;
  };
  const splitTop = (sel: string): string[] => {
    const out: string[] = []; let cur = ""; let depth = 0; let quote: string | null = null;
    for (const ch of sel) {
      if (quote) { if (ch === quote) quote = null; cur += ch; continue; }
      if (ch === "\"" || ch === "'") quote = ch;
      if (ch === "[") depth++; if (ch === "]") depth--;
      if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const badSel: string[] = [];
  let selCount = 0;
  for (const p of ICE_PAGES) for (const e of allElements(p)) {
    if (e.kind === "text") continue;
    selCount++;
    if (typeof e.dom !== "string" || !e.dom || !balanced(e.dom) || !splitTop(e.dom).every((part) => PART.test(part))) badSel.push(`${p.path}:${e.id}`);
  }
  check(`A9 every media/pair/samples element has a well-formed CSS selector (${selCount} checked)`, badSel.length === 0 && selCount > 0, short(badSel));

  const sampleSel: string[] = [];
  for (const u of UPLOAD_TOOLS) {
    const el = allElements(HOME).find((e) => e.id === `samples:${u.key}`);
    const named = [...(el?.dom ?? "").matchAll(/\[data-sample(-empty)?="([^"]+)"\]/g)];
    const full = named.filter((m) => !m[1]).map((m) => m[2]);
    const empty = named.filter((m) => m[1]).map((m) => m[2]);
    const want = u.samples.map((s) => s.configKey);
    if (!same([...full].sort(), [...want].sort()) || !same([...empty].sort(), [...want].sort()) || want.length !== 5
      || !same(el?.slots?.map((s) => s.key), want)) sampleSel.push(u.key);
  }
  check("A10 each samples element's selector names exactly that tool's 5 configKeys (filled + empty), and its slots are those 5", sampleSel.length === 0, short(sampleSel));

  check("A11 icePageFor: /plan is an alias of /plany", icePageFor("/plan") === PLANS && PLANS?.key === "plans");
  check("A11b icePageFor: a trailing slash (or several) is ignored", icePageFor("/plany/") === PLANS && icePageFor("/home//") === HOME && icePageFor("/plan/") === PLANS);
  check("A11c icePageFor: unknown path, '/', '' and other casing → null",
    icePageFor("/nope") === null && icePageFor("/") === null && icePageFor("") === null && icePageFor("/HOME") === null && icePageFor("/home/x") === null);
  check("A11d icePageByKey finds the same objects", icePageByKey("home") === HOME && icePageByKey("plans") === PLANS && icePageByKey("nope") === null);

  const unsupportedTokens = ICE_UNSUPPORTED.flatMap((u) => u.path.split(/,\s*/)).map((t) => t.trim()).filter((t) => /^\/[a-z0-9/_-]*$/i.test(t));
  const reachable = unsupportedTokens.filter((t) => icePageFor(t) !== null);
  check("A12 ICE_UNSUPPORTED is non-empty, every entry has a path and a reason, and none of its paths opens in the editor",
    ICE_UNSUPPORTED.length > 0 && ICE_UNSUPPORTED.every((u) => u.path && u.reason) && reachable.length === 0, short(reachable));

  const NEVER = new Set(["ctaUrl", "cta2Url", "html", "code", "value", "icon", "href", "link", "url", "style", "price", "prices", "embed", "action", "consent"]);
  const badFields: string[] = [];
  for (const [type, spec] of Object.entries(CMS_FIELDS)) {
    for (const f of [...spec.text, ...spec.media]) {
      const last = f.split(".").pop() ?? "";
      if (NEVER.has(last) || /url$/i.test(last) && last !== "mediaUrl" && last !== "media2Url" || /style|price|link|code|html/i.test(last)) badFields.push(`${type}.${f}`);
    }
    for (const f of spec.media) if (!/(^|\.)media2?Url$/.test(f)) badFields.push(`${type}.${f} (media not a mediaUrl)`);
    for (const f of spec.text) if (/Url$/.test(f)) badFields.push(`${type}.${f} (text field ending in Url)`);
  }
  check("A13 CMS_FIELDS lists no url/link/style/code/price field (Url only as mediaUrl/media2Url, no ctaUrl/cta2Url/html/code/value/icon)", badFields.length === 0, short(badFields));
  check("A13b CMS_MULTILINE is only `description`", same([...CMS_MULTILINE], ["description"]));
  const launchBad = LAUNCH_TEXT_FIELDS.filter((f) => /consent|safety|placeholder|seo/i.test(f) || /^hero\.image/.test(f));
  check("A14 LAUNCH_TEXT_FIELDS exclude consent/safety/placeholder/seo/hero.image", launchBad.length === 0 && LAUNCH_TEXT_FIELDS.length > 0, short(launchBad));
  check("A14b LAUNCH_TEXT_FIELDS are unique", new Set(LAUNCH_TEXT_FIELDS).size === LAUNCH_TEXT_FIELDS.length);
  check("A15 pagesOfText lists every page a key renders on (a /home key → [/home])",
    same(pagesOfText(pageTextKeys(HOME)[0]), ["/home"]) && pagesOfText("nope.key").length === 0);
}

/* ══ B. STEGA ══════════════════════════════════════════════════════════════ */

function sectionB() {
  console.log("\nB. STEGA — markers, strip, survival, invisible characters, SQL parity");

  const payloads = ["ab12cd34.t0", "ab12cd34.c0a1b2c3d.12", "x", "~ !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}", "z".repeat(64)];
  const rt = payloads.filter((p) => {
    const base = "Zażółć gęślą jaźń";
    const s = base + stegaMark(p);
    const hits = stegaLocate(s);
    return !(same(stegaRead(s), [p]) && hits.length === 1 && hits[0].at === base.length && hits[0].end === s.length && stegaStrip(s) === base);
  });
  check("B1 mark → read/locate/strip round-trips (incl. 64-char and punctuation payloads)", rt.length === 0, short(rt));
  const two = `A${stegaMark("n0nce123.t1")} B${stegaMark("n0nce123.t2")}`;
  check("B1b two markers in one string are read in order", same(stegaRead(two), ["n0nce123.t1", "n0nce123.t2"]) && stegaStrip(two) === "A B");
  check("B2 payload > 64 chars, empty, non-ASCII or control → \"\"",
    stegaMark("z".repeat(65)) === "" && stegaMark("") === "" && stegaMark("zażółć") === "" && stegaMark("a\u0007") === "" && stegaMark("a\nb") === "");
  check("B2b a marker is invisible-only: just U+2060, U+200C, U+200D", /^[\u2060\u200C\u200D]+$/.test(stegaMark("ab12cd34.t0")));

  const lone = "a\u2060b\u200Cc\u200Dd\u2060";
  check("B3 stegaStrip keeps lone U+2060/U+200C/U+200D that are not a marker", stegaStrip(lone) === lone && stegaStrip(lone + stegaMark("p.t1")) === lone);
  check("B3b stegaStrip keeps an unterminated MARK_START", stegaStrip(`x${MARK_START}y`) === `x${MARK_START}y`);
  check("B3c stegaStrip removes every marker and nothing else",
    stegaStrip(`Zażółć${stegaMark("a.t1")} i ${stegaMark("a.t2")}Ä🎉–`) === "Zażółć i Ä🎉–");
  const stray = `${MARK_START}x Widoczny tekst${stegaMark("ab12cd34.t3")}`;
  check("B3d a stray MARK_START earlier in the string does not hide a later well-formed marker",
    same(stegaRead(stray), ["ab12cd34.t3"]), `stegaRead → ${JSON.stringify(stegaRead(stray))}`);
  const marked = ` Tekst${stegaMark("ab12cd34.t5")} `;
  check("B4 a marker survives toUpperCase()", same(stegaRead(marked.toUpperCase()), ["ab12cd34.t5"]));
  check("B4b a marker survives String.trim()", same(stegaRead(marked.trim()), ["ab12cd34.t5"]) && marked.trim().endsWith(MARK_END));

  const INV: [string, string][] = [
    ["U+200B", "\u200B"], ["U+200C", "\u200C"], ["U+200D", "\u200D"], ["U+2060", "\u2060"], ["U+FEFF", "\uFEFF"],
    ["U+202E", "\u202E"], ["U+2066", "\u2066"], ["U+00AD", "\u00AD"], ["U+061C", "\u061C"], ["U+2028", "\u2028"],
    ["U+2029", "\u2029"], ["U+E0041", "\u{E0041}"], ["\\u0007", "\u0007"], ["\\r", "\r"], ["\\t", "\t"], ["U+0085", "\u0085"],
  ];
  const missed = INV.filter(([, c]) => !hasInvisible(`ab${c}cd`)).map(([n]) => n);
  check("B5 hasInvisible flags zero-width, joiners, bidi, isolates, ALM, LS/PS, soft hyphen, TAG, C0/C1 (incl. \\r and tab)", missed.length === 0, short(missed));
  const VISIBLE: [string, string][] = [
    ["Polish", "Zażółć gęślą jaźń ĄĘŁŃÓŚŹŻ"], ["German", "Äpfel Öl Übung Straße äöü"], ["emoji", "🎉👍🏽👨‍👩‍👧"],
    ["en dash / em dash / quotes", "a – b — „c” «d»"], ["newline", "a\nb"], ["NBSP U+00A0", "100\u00A0zł"],
  ];
  // NB: a ZWJ emoji sequence (👨‍👩‍👧) contains U+200D, so it IS refused — kept out of the "visible" list on purpose.
  VISIBLE[2] = ["emoji", "🎉👍🏽"];
  const falsePos = VISIBLE.filter(([, v]) => hasInvisible(v)).map(([n]) => n);
  check("B5b hasInvisible is false for Polish/German letters, emoji, dashes, quotes, a newline and NBSP", falsePos.length === 0, short(falsePos));
  note("NBSP (U+00A0) is NOT in the invisible list (allowed, as in the SQL); a ZWJ emoji sequence is refused (contains U+200D)");
  check("B5c (documented) a ZWJ emoji sequence like 👨‍👩‍👧 is refused because it contains U+200D", hasInvisible("👨‍👩‍👧"));

  // parity with SQL content_text_ok
  const sql = readFileSync("supabase/migrations/0141_inline_content_editor.sql", "utf8");
  const body = /create or replace function public\.content_text_ok[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(sql)?.[1] ?? "";
  const classes = [...body.matchAll(/!~\s*'\[([^']*)\]'/g)].map((m) => m[1]);
  const ranges: [number, number][] = [];
  for (const cls of classes) {
    let i = 0;
    const token = (): number => {
      if (cls[i] === "\\" && cls[i + 1] === "u") { const v = parseInt(cls.slice(i + 2, i + 6), 16); i += 6; return v; }
      if (cls[i] === "\\" && cls[i + 1] === "U") { const v = parseInt(cls.slice(i + 2, i + 10), 16); i += 10; return v; }
      const v = cls.codePointAt(i) ?? 0; i += String.fromCodePoint(v).length; return v;
    };
    while (i < cls.length) {
      const lo = token();
      if (cls[i] === "-" && i + 1 < cls.length) { i++; ranges.push([lo, token()]); } else ranges.push([lo, lo]);
    }
  }
  check(`B6 the SQL content_text_ok bracket expressions parse (${classes.length} classes, ${ranges.length} ranges)`, classes.length === 2 && ranges.length >= 10);
  const MARKUP = new Set(["<".codePointAt(0), ">".codePointAt(0)]);
  const sampleMiss: string[] = [];
  for (const [lo, hi] of ranges) {
    for (const cp of [...new Set([lo, hi, lo + Math.floor((hi - lo) / 2), Math.min(hi, lo + 1), Math.max(lo, hi - 1)])]) {
      const ch = String.fromCodePoint(cp);
      const refused = MARKUP.has(cp) ? textProblem("sellerHome.x", `a${ch}b`, "ab", 100) === "markup" : hasInvisible(`a${ch}b`);
      if (!refused) sampleMiss.push(`U+${cp.toString(16).toUpperCase().padStart(4, "0")}`);
    }
  }
  check("B6b every sampled code point the SQL rejects is rejected by hasInvisible (or as markup, for < >)", sampleMiss.length === 0, short(sampleMiss));
  const inSql = (cp: number) => ranges.some(([lo, hi]) => cp >= lo && cp <= hi) && !MARKUP.has(cp);
  const jsOnly: string[] = []; const sqlOnly: string[] = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const js = hasInvisible(String.fromCodePoint(cp));
    const s = inSql(cp);
    if (js && !s) jsOnly.push(cp.toString(16)); else if (s && !js) sqlOnly.push(cp.toString(16));
  }
  check("B6c exhaustively, hasInvisible and the SQL class reject the very same code points (U+0000…U+10FFFF)",
    jsOnly.length === 0 && sqlOnly.length === 0, `js-only ${short(jsOnly)}; sql-only ${short(sqlOnly)}`);
}

/* ══ C. OVERRIDES ══════════════════════════════════════════════════════════ */

function sectionC() {
  console.log("\nC. OVERRIDES — the copy layer");

  const dict = deepFreeze({
    a: { b: { c: "Hello {name}", d: "Untouched" }, e: "Sibling" },
    x: { y: "Other namespace" },
    launch: { "hero.badge": "Flat badge", hero: { badge: "Nested badge (shadowed)" } },
    flat: { "only.flat": "Only flat" },
  });
  const before = JSON.stringify(dict);
  check("C1 applyOverrides(dict, {}) and (dict, undefined) return the very same object",
    applyOverrides(dict, {}) === dict && applyOverrides(dict, undefined) === dict);
  check("C1b an override for a key the dictionary does not have returns the same object", applyOverrides(dict, { "nope.key": "x" }) === dict);

  const out = applyOverrides(dict, { "a.b.c": "Cześć {name}" }) as typeof dict;
  check("C2 the override lands where lookup() reads it", lookup(out, "a.b.c") === "Cześć {name}" && lookup(dict, "a.b.c") === "Hello {name}");
  check("C2b the (deep-frozen) input is never mutated", JSON.stringify(dict) === before);
  check("C2c only the edited path is copied; untouched subtrees are shared",
    out !== dict && out.a !== dict.a && out.a.b !== dict.a.b && out.x === dict.x && out.launch === dict.launch && out.a.e === dict.a.e);

  const flat = applyOverrides(dict, { "launch.hero.badge": "Nowa odznaka", "flat.only.flat": "Tylko płasko" }) as typeof dict;
  check("C3 a flat dotted key resolves exactly as lookup() resolves it (flat first)",
    lookup(dict, "launch.hero.badge") === "Flat badge" && lookup(flat, "launch.hero.badge") === "Nowa odznaka"
    && flat.launch["hero.badge"] === "Nowa odznaka" && flat.launch.hero === dict.launch.hero && lookup(flat, "flat.only.flat") === "Tylko płasko");
  check("C3b the flat edit created no nested path", !Object.hasOwn((flat as Dict).flat as object, "only"));

  const ph = (v: string) => lookup(applyOverrides(dict, { "a.b.c": v }), "a.b.c");
  check("C4 a value whose {placeholders} differ from the default is skipped",
    ph("Cześć") === "Hello {name}" && ph("Cześć {imie}") === "Hello {name}" && ph("{name} {price}") === "Hello {name}" && ph("Hej {name}, {name}!") === "Hej {name}, {name}!");
  check("C4b an empty string override is skipped", ph("") === "Hello {name}");
  check("C4c a path through a string does not throw and changes nothing", lookup(applyOverrides(dict, { "a.e.z": "x" }), "a.e") === "Sibling");
  check("C2d input still untouched after every call", JSON.stringify(dict) === before);

  const rw = rewriteKeys(dict, ["a.b.d", "x.y"], (k, cur) => (k === "x.y" ? undefined : `${cur}!`)) as typeof dict;
  check("C5 rewriteKeys: `undefined` leaves a key as it is", rw.a.b.d === "Untouched!" && rw.x.y === "Other namespace");

  // applicableOverrides over the real Polish dictionary
  const K = "sellerHome.ba.title";
  const max = textSpec(K)?.text?.maxLength ?? 0;
  const entries: Record<string, string> = {
    [K]: "Przed i po",
    "sellerHome.ba.sub": "<b>bold</b>",
    "sellerHome.featured.title": "Zero\u200Bwidth",
    "sellerHome.featured.sub": "Linia\ndruga",
    "sellerHome.soon.title": "x".repeat((textSpec("sellerHome.soon.title")?.text?.maxLength ?? 0) + 1),
    "pricing.title": "Faktura VAT do każdego planu",
    "nope.unknown": "Unregistered",
    "pricing.notice.x": "Denied namespace",
    "credits.balance": "Denied namespace",
  };
  const ok = applicableOverrides(entries, pl as Dict);
  check("C6 applicableOverrides keeps a valid override", ok[K] === "Przed i po" && max > 0);
  check("C6b … and drops unknown keys, denied keys, markup, invisible, newline, too long and pricing claims",
    same(Object.keys(ok), [K]), JSON.stringify(Object.keys(ok)));
  check("C6c … and an undefined bag yields {}", same(applicableOverrides(undefined, pl as Dict), {}));
  const amountDict = { sellerHome: { ba: { title: "Od {price} zł" } } };
  check("C6d a registered key whose shipped default carries an amount placeholder is denied at apply time",
    same(applicableOverrides({ [K]: "Już od {price} zł" }, amountDict), {}));
  const keepPh = { sellerHome: { ba: { title: "Witaj {name}" } } };
  check("C6e an override that drops the default's placeholder is not applied",
    same(applicableOverrides({ [K]: "Witaj" }, keepPh), {}) && same(applicableOverrides({ [K]: "Hej {name}" }, keepPh), { [K]: "Hej {name}" }));
}

/* ══ D. VALIDATE ═══════════════════════════════════════════════════════════ */

function sectionD() {
  console.log("\nD. VALIDATE — textProblem, normaliseText, softLimit, altProblem");
  const k = "sellerHome.ba.title";
  check("D1 empty / whitespace → empty", textProblem(k, "", "x", 60) === "empty" && textProblem(k, " \t ", "x", 60) === "empty");
  check("D2 over maxLength → too_long (and 2000 is the hard ceiling)",
    textProblem(k, "x".repeat(61), "x", 60) === "too_long" && textProblem(k, "x".repeat(60), "x", 60) === null
    && textProblem(k, "x".repeat(2001), "x", 5000) === "too_long" && textProblem(k, "x".repeat(2000), "x", 5000) === null);
  check("D3 invisible → invisible", textProblem(k, "a\u200Bb", "x", 60) === "invisible" && textProblem(k, "a\u202Eb", "x", 60) === "invisible");
  check("D4 < or > → markup", textProblem(k, "a<b", "x", 60) === "markup" && textProblem(k, "a>b", "x", 60) === "markup");
  check("D5 \\n → newline (\\r is already invisible)", textProblem(k, "a\nb", "x", 60) === "newline" && textProblem(k, "a\rb", "x", 60) === "invisible");
  check("D6 placeholders must match the default's set",
    textProblem(k, "Hej", "Hi {name}", 60) === "placeholders" && textProblem(k, "Hej {name} {name}", "Hi {name}", 60) === null
    && textProblem(k, "{b} {a}", "{a} {b}", 60) === null && textProblem(k, "{a}", "{a} {b}", 60) === "placeholders");
  const claims = ["Faktura VAT", "Wystawimy fakturę", "invoice included", "Rechnung inklusive", "e-mailem potwierdzającym", "confirmation email",
    "Bestätigungs-E-Mail", "potwierdzenie zakupu", "Przelewy24", "płać przez p24", "w panelu płatności", "billing portal", "Zahlungsportal"];
  const missedClaims = claims.filter((c) => textProblem("pricing.title", c, "x", 120) !== "claim");
  check("D7 pricing.* refuses every claim the pricing page may not make", missedClaims.length === 0, short(missedClaims));
  check("D7b the same claims on packs.* / plans.* keys are refused too",
    textProblem("packs.x", "Faktura VAT", "x", 120) === "claim" && textProblem("plans.x", "Faktura VAT", "x", 120) === "claim");
  check("D7c … but NOT on a sellerHome.* key", claims.every((c) => textProblem("sellerHome.ba.title", c, "x", 120) === null));
  check("D7d a plain pricing sentence passes", textProblem("pricing.title", "Wybierz plan dla siebie", "x", 120) === null);
  check("D8 normaliseText trims and collapses runs of spaces/tabs (newlines untouched)",
    normaliseText("  a \t  b  ") === "a b" && normaliseText("a\n  b") === "a\n b" && normaliseText("\t") === "");
  check("D9 softLimit = max(24, ceil(1.5 × default length))", softLimit("") === 24 && softLimit("x".repeat(16)) === 24 && softLimit("x".repeat(17)) === 26 && softLimit("x".repeat(100)) === 150);
  check("D10 altProblem: ≤300 plain is fine, empty is fine",
    altProblem("x".repeat(300)) === null && altProblem("") === null && altProblem("Zdjęcie produktu – biały kubek") === null);
  check("D10b altProblem: 301 → too_long, invisible, < → markup, newline",
    altProblem("x".repeat(301)) === "too_long" && altProblem("a\u200Db") === "invisible" && altProblem("a<b") === "markup" && altProblem("a\nb") === "newline");
}

/* ══ E. SNIFF ══════════════════════════════════════════════════════════════ */

const asBytes = (...parts: (number[] | string)[]): Uint8Array => {
  const out: number[] = [];
  for (const p of parts) if (typeof p === "string") for (const c of p) out.push(c.charCodeAt(0)); else out.push(...p);
  while (out.length < 32) out.push(0);
  return new Uint8Array(out);
};
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ftyp = (major: string, compat: string[], size?: number, tail = "") =>
  asBytes(be32(size ?? 16 + compat.length * 4), "ftyp", major, [0, 0, 0, 0], ...compat, tail);
const PNG = asBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 13], "IHDR");
const JPEG = asBytes([0xff, 0xd8, 0xff, 0xe0], [0, 16], "JFIF");
const GIF = asBytes("GIF89a", [1, 0, 1, 0]);
const MP4 = ftyp("isom", ["isom", "iso2", "mp41"]);

function sectionE() {
  console.log("\nE. SNIFF — formats from bytes, limits, safe names");
  check("E1 JPEG FFD8FF → image/jpeg", sniff(JPEG) === "image/jpeg");
  check("E2 PNG signature → image/png", sniff(PNG) === "image/png");
  check("E3 RIFF....WEBP → image/webp; RIFF....WAVE → null", sniff(asBytes("RIFF", [0, 0, 0, 0], "WEBPVP8 ")) === "image/webp" && sniff(asBytes("RIFF", [0, 0, 0, 0], "WAVEfmt ")) === null);
  check("E4 ftyp avif / avis → image/avif", sniff(ftyp("avif", ["mif1", "avif"])) === "image/avif" && sniff(ftyp("avis", ["msf1"])) === "image/avif");
  check("E5 ftyp mif1 with avif among compatible brands → image/avif", sniff(ftyp("mif1", ["mif1", "miaf", "avif"])) === "image/avif");
  check("E6 ftyp mif1 without avif (HEIF) → null", sniff(ftyp("mif1", ["mif1", "heic"])) === null);
  check("E6b a compatible 'avif' AFTER the ftyp box's end does not count", sniff(ftyp("mif1", ["mif1"], 20, "avif")) === null);
  check("E7 ftyp isom / mp42 / dash → video/mp4",
    sniff(MP4) === "video/mp4" && sniff(ftyp("mp42", ["mp42", "isom"])) === "video/mp4" && sniff(ftyp("dash", ["iso6"])) === "video/mp4");
  check("E8 ftyp 'qt  ' (QuickTime) → null", sniff(ftyp("qt  ", ["qt  "])) === null);
  check("E9 ftyp heic / heix → null", sniff(ftyp("heic", ["mif1", "heic"])) === null && sniff(ftyp("heix", ["mif1"])) === null);
  check("E10 EBML with DocType webm → video/webm", sniff(asBytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84], "webm")) === "video/webm");
  check("E11 EBML matroska → null", sniff(asBytes([0x1a, 0x45, 0xdf, 0xa3, 0xa3, 0x42, 0x82, 0x88], "matroska")) === null);
  check("E12 GIF89a / GIF87a → null", sniff(GIF) === null && sniff(asBytes("GIF87a")) === null);
  check("E13 '<svg' and '<?xml' → null", sniff(asBytes("<svg xmlns=\"http://www.w3.org/2000/svg\">")) === null && sniff(asBytes("<?xml version=\"1.0\"?><svg")) === null);
  check("E14 a buffer shorter than 12 bytes → null (even a JPEG start)", sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0])) === null && sniff(new Uint8Array(0)) === null);
  check("E15 limits: image 15 MiB, video 50 MiB, sample 10 MiB",
    ICE_MAX_IMAGE_BYTES === 15 * 1024 * 1024 && ICE_MAX_VIDEO_BYTES === 50 * 1024 * 1024 && ICE_MAX_SAMPLE_BYTES === 10 * 1024 * 1024
    && maxBytesFor("image/avif") === ICE_MAX_IMAGE_BYTES && maxBytesFor("video/webm") === ICE_MAX_VIDEO_BYTES);
  check("E16 exactly six mimes; isIceMime / kindOf agree",
    ICE_IMAGE_MIMES.length === 4 && ICE_VIDEO_MIMES.length === 2 && [...ICE_IMAGE_MIMES, ...ICE_VIDEO_MIMES].every(isIceMime)
    && !isIceMime("image/gif") && !isIceMime("image/svg+xml") && !isIceMime("video/quicktime") && !isIceMime(42)
    && ICE_IMAGE_MIMES.every((m) => kindOf(m) === "image") && ICE_VIDEO_MIMES.every((m) => kindOf(m) === "video"));

  const SAFE = /^[a-zA-Z0-9._-]{1,80}$/;
  check("E17 safeName strips path separators", !/[/\\]/.test(safeName("../../etc/passwd")) && !/[/\\]/.test(safeName("C:\\Users\\x\\y.png")) && SAFE.test(safeName("../../etc/passwd")));
  check("E17b safeName drops non-ASCII (diacritics decomposed)", safeName("Zdjęcie ąę.jpg") === "Zdjecie_ae.jpg" && safeName("łódź.png") === "odz.png" && safeName("写真.png") === "png");
  check("E17c safeName strips leading dots/underscores; empty → plik", safeName("..hidden.png") === "hidden.png" && safeName("...") === "plik" && safeName("") === "plik" && safeName("___a") === "a");
  check("E17d safeName caps the length at 80, keeping the end (extension)", safeName(`${"a".repeat(120)}.jpg`).length === 80 && safeName(`${"a".repeat(120)}.jpg`).endsWith(".jpg"));
  const cutDot = safeName(`${"a".repeat(30)}.${"b".repeat(79)}`);
  const cutSpace = safeName(`${"A".repeat(20)} ${"b".repeat(75)}.jpg`);
  check("E17e safeName never returns a name starting with '.' or '_' — also when the 80-char cut lands on one",
    !/^[._]/.test(cutDot) && !/^[._]/.test(cutSpace), `safeName("a"×30 + "." + "b"×79) = "${cutDot.slice(0, 8)}…"; safeName("A"×20 + " " + "b"×75 + ".jpg") = "${cutSpace.slice(0, 8)}…"`);
}

/* ══ fixtures for F / G / H / I ════════════════════════════════════════════ */

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const CUSTOMER = "aaaaaaaa-0000-4000-8000-000000000002";
const PAGE_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const HOMEPAGE_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const DRAFT_ID = "bbbbbbbb-0000-4000-8000-000000000003";
const APP_ID = "bbbbbbbb-0000-4000-8000-000000000004";
const B_HERO = "cccccccc-0000-4000-8000-000000000001";
const B_FAQ = "dddddddd-0000-4000-8000-000000000002";
const B_ORPHAN = "eeeeeeee-0000-4000-8000-000000000003";
const B_DRAFT = "ffffffff-0000-4000-8000-000000000004";
const B_HOME = "abababab-0000-4000-8000-000000000005";
const B_LAUNCH = "cdcdcdcd-0000-4000-8000-000000000006";
const HERO_URL = `${STORAGE_PUBLIC}/media/lib/hero.png`;
const NONCE = "n0nce123";

const heroBlock = () => ({
  id: B_HERO, type: "hero", visible: true,
  content: { title: { pl: "Stary tytuł", en: "Old title" }, subtitle: { pl: "Podtytuł" }, ctaUrl: "https://example.com/x", mediaUrl: HERO_URL },
});
const faqBlock = () => ({
  id: B_FAQ, type: "faq", visible: true,
  content: {
    title: { pl: "Pytania" },
    items: [{ title: { pl: "P1" }, description: { pl: "O1" } }, { title: { pl: "P2" }, description: { pl: "O2\n\nO2b" } }],
  },
});

/** A fresh admin request: profiles, CMS pages/blocks, library assets. */
function freshDb(): FakeDb {
  resetIceState();
  const db = new FakeDb();
  db.user = { id: ADMIN };
  db.tables.profiles = [{ id: ADMIN, role: "admin", full_name: "Ada Admin", email: "ada@example.com" }, { id: CUSTOMER, role: "user" }];
  db.tables.cms_pages = [
    { id: PAGE_ID, slug: "oferta", title: "Oferta", kind: "page", status: "published", is_homepage: false, published_snapshot: [heroBlock(), faqBlock()] },
    { id: HOMEPAGE_ID, slug: "start-strona", title: "Start", kind: "launch", status: "published", is_homepage: true, published_snapshot: [{ id: B_HOME, type: "text", content: { title: { pl: "Witaj" } } }] },
    { id: DRAFT_ID, slug: "szkic", title: "Szkic", kind: "page", status: "draft", is_homepage: false, published_snapshot: [{ id: B_DRAFT, type: "text", content: { title: { pl: "X" } } }] },
    { id: APP_ID, slug: "aplikacja", title: "App", kind: "app", status: "published", is_homepage: false, published_snapshot: [] },
  ];
  db.tables.cms_blocks = [
    { id: B_HERO, page_id: PAGE_ID, updated_at: "2026-10-01T10:00:00.000Z" },
    { id: B_FAQ, page_id: PAGE_ID, updated_at: "2026-10-01T10:00:01.000Z" },
    { id: B_ORPHAN, page_id: PAGE_ID, updated_at: "2026-10-01T10:00:02.000Z" },
    { id: B_DRAFT, page_id: DRAFT_ID, updated_at: "2026-10-01T10:00:03.000Z" },
    { id: B_HOME, page_id: HOMEPAGE_ID, updated_at: "2026-10-01T10:00:04.000Z" },
  ];
  iceState.client = db.client();
  iceState.viewerAdmin = true;
  return db;
}

function setSession(path: string, nonce = NONCE) {
  iceState.cookies.set(editCookieName(path), editCookieValue({ nonce, path }));
}

/* ══ F. CMS LAYER ══════════════════════════════════════════════════════════ */

async function sectionF() {
  console.log("\nF. CMS LAYER — field numbering, markers, markPublishedPage");

  const faq = faqBlock();
  const f = blockFields(faq, "base-1");
  check("F1 faq block: title, items.*.title, items.*.description — numbered in registry order",
    same(f.map((x) => [x.n, x.path.join(".")]), [[0, "title"], [1, "items.0.title"], [2, "items.1.title"], [3, "items.0.description"], [4, "items.1.description"]])
    && f.every((x) => x.kind === "text" && x.base === "base-1" && x.blockType === "faq" && x.id === `${B_FAQ}|${x.path.join("|")}`));
  check("F1b multiline only for description; values per locale", f.every((x) => x.multiline === (x.path[x.path.length - 1] === "description")) && same(f[4].values, { pl: "O2\n\nO2b" }));
  const three = { ...faq, content: { ...faq.content, items: [...faq.content.items, { title: { pl: "P3" } }] } };
  check("F1c items.* expansion follows the item count (3 items → 7 fields)", blockFields(three, null).length === 7 && blockFields({ ...faq, content: { title: { pl: "x" } } }, null).length === 1);
  const emptyTitle = { ...faq, content: { ...faq.content, title: undefined } };
  check("F1d numbering does not depend on what is filled (empty title keeps n=0..4)", same(blockFields(emptyTitle, null).map((x) => x.path), f.map((x) => x.path)));
  check("F1e stable: two calls give the same list", same(blockFields(faq, "b"), blockFields(faq, "b")));
  const gal = blockFields({ id: B_HERO, type: "gallery", content: { title: { pl: "G" }, items: [{ mediaUrl: "u1" }, { mediaUrl: "u2", title: { pl: "t" } }] } }, null);
  check("F1f media fields come after text fields and carry the URL",
    same(gal.map((x) => `${x.kind}:${x.path.join(".")}`), ["text:title", "text:description", "text:items.0.title", "text:items.1.title", "media:items.0.mediaUrl", "media:items.1.mediaUrl"])
    && gal[4].url === "u1" && gal[5].url === "u2");
  const launch = blockFields({ id: B_LAUNCH, type: "launch", content: { fields: { "hero.h1": { pl: "H1" } } } }, null);
  check("F2 a launch block lists LAUNCH_TEXT_FIELDS under [\"fields\", f]",
    same(launch.map((x) => x.path), LAUNCH_TEXT_FIELDS.map((x) => ["fields", x])) && launch.every((x, i) => x.n === i && x.kind === "text") && same(launch[1].values, { pl: "H1" }));
  check("F3 unknown block type → []; non-uuid id → []; no id → []",
    blockFields({ id: B_HERO, type: "custom_html", content: {} }, null).length === 0
    && blockFields({ id: "hero-1", type: "hero", content: {} }, null).length === 0 && blockFields({ type: "hero", content: {} }, null).length === 0);
  check("F3b valueAt walks arrays and objects and refuses out-of-range / inherited keys",
    valueAt(faq.content, ["items", "1", "title", "pl"]) === "P2" && valueAt(faq.content, ["items", "2"]) === undefined
    && valueAt(faq.content, ["items", "-1"]) === undefined && valueAt(faq.content, ["toString"]) === undefined && valueAt(faq.content, ["title", "pl", "x"]) === undefined);
  check("F3c isUuid", isUuid(B_HERO) && !isUuid("x") && !isUuid(42));

  // markBlocks: only the shown language, like lt()
  const hero = deepFreeze(heroBlock());
  const unknownBlock = deepFreeze({ id: B_ORPHAN, type: "custom_html", content: { html: "<b>x</b>" } });
  const blocks = deepFreeze([hero, unknownBlock, deepFreeze(faqBlock())]) as CmsBlockLike[];
  const heroJson = JSON.stringify(hero);
  const nOf = (b: CmsBlockLike, path: string) => blockFields(b, null).find((x) => x.path.join(".") === path)?.n ?? -1;
  const nTitle = nOf(hero, "title");
  const nSub = nOf(hero, "subtitle");
  check("F3d hero numbering follows CMS_FIELDS.hero (badge, title, subtitle, ctaLabel, cta2Label, then mediaUrl)",
    nTitle === 1 && nSub === 2 && same(blockFields(hero, null).map((x) => x.path.join(".")), [...CMS_FIELDS.hero.text, ...CMS_FIELDS.hero.media]));
  const markedEn = markBlocks(blocks, "en", NONCE);
  const mh = markedEn[0].content as { title: Record<string, string>; subtitle: Record<string, string>; ctaUrl: string; mediaUrl: string };
  check("F4 markBlocks marks the visitor's language only (en shown → en marked, pl untouched)",
    same(stegaRead(mh.title.en), [`${NONCE}.c${B_HERO.slice(0, 8)}.${nTitle}`]) && mh.title.pl === "Stary tytuł");
  check("F4b … a field with no en falls back to pl, and pl is what gets marked", same(stegaRead(mh.subtitle.pl), [`${NONCE}.c${B_HERO.slice(0, 8)}.${nSub}`]));
  check("F4c … urls and media are never touched", mh.ctaUrl === "https://example.com/x" && mh.mediaUrl === HERO_URL);
  check("F4d the input blocks (deep-frozen) are unchanged; untouched blocks are returned as the same object",
    JSON.stringify(hero) === heroJson && markedEn[1] === unknownBlock && markedEn[0] !== hero);

  const shapes: (string | null | undefined)[] = [undefined, null, "", "  ", "T"];
  const parity: string[] = [];
  for (const a of shapes) for (const b of shapes) for (const c of shapes) for (const loc of LOCALES) {
    const lts: Record<string, string | null> = {};
    if (a !== undefined) lts.pl = a === "T" ? "T-pl" : a;
    if (b !== undefined) lts.en = b === "T" ? "T-en" : b;
    if (c !== undefined) lts.de = c === "T" ? "T-de" : c;
    const block = deepFreeze({ id: B_HERO, type: "hero", content: { title: lts } });
    const out = markBlocks([block], loc, NONCE)[0];
    const shown = lt(lts as unknown as LocaleText, loc);
    const shownAfter = lt((out.content as { title: LocaleText }).title, loc);
    const wantMark = typeof shown === "string" && shown.trim().length > 0;
    const marks = Object.values((out.content as { title: Record<string, unknown> }).title).filter((v) => typeof v === "string" && stegaRead(v).length > 0).length;
    if (stegaStrip(String(shownAfter ?? "")) !== String(shown ?? "") || (stegaRead(String(shownAfter ?? "")).length > 0) !== wantMark || marks !== (wantMark ? 1 : 0)) {
      parity.push(`${loc}:${JSON.stringify(lts)}`);
    }
  }
  check("F5 over every pl/en/de shape (absent/null/\"\"/blank/text) × locale, the text lt() shows is the one marked — and only it", parity.length === 0, short(parity, 4));

  const multi = deepFreeze({ id: B_HERO, type: "text", content: { title: { pl: "  " }, description: { pl: "Akapit 1\n\nAkapit 2  \n \n\nAkapit 3\n" } } });
  const md = (markBlocks([multi], "pl", NONCE)[0].content as { description: { pl: string } }).description.pl;
  check("F6 a description marks every paragraph (blank-line separated), and stegaStrip(marked) === original",
    stegaRead(md).length === 3 && stegaRead(md).every((p) => p === `${NONCE}.c${B_HERO.slice(0, 8)}.1`) && stegaStrip(md) === "Akapit 1\n\nAkapit 2  \n \n\nAkapit 3\n");
  // components/cms/blocks.tsx paragraphs(): split(/\n\s*\n/), trim, drop blanks
  const paragraphs = (t: string) => t.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  const paraTexts = ["Jeden", "A\n\nB", "A  \n \n\n  B\n", "\n\nA\nciąg dalszy\n\n\nB  ", "A\r\n\r\nB", "  \n\n  "];
  const paraBad = paraTexts.filter((t) => {
    const painted = paragraphs(markText(t, "p.c1", true));
    return painted.length !== paragraphs(t).length || !painted.every((x, i) => same(stegaRead(x), ["p.c1"]) && stegaStrip(x) === paragraphs(t)[i]);
  });
  check("F6c every paragraph the CMS renderer paints (blocks.tsx paragraphs()) carries exactly one marker and strips to the original",
    paraBad.length === 0, short(paraBad.map((x) => JSON.stringify(x))));
  check("F6b a blank title is skipped (no marker)", (markBlocks([multi], "pl", NONCE)[0].content as { title: { pl: string } }).title.pl === "  ");
  const m = stegaMark("p.c1");
  check("F7 markText keeps trailing whitespace after the marker", markText("abc  \n", "p.c1", false) === `abc${m}  \n`);
  check("F7b markText replaces an existing marker instead of stacking", stegaRead(markText(`abc${stegaMark("old.c9")}`, "p.c1", false)).join() === "p.c1");

  // markPublishedPage
  const page = deepFreeze({ slug: "oferta", title: "Oferta", blocks: [heroBlock(), faqBlock()] as CmsBlockLike[] });
  let asked = 0;
  const ask = { locale: async (): Promise<IceLocale> => { asked++; return "pl"; }, homeSlug: async () => { asked++; return "start-strona"; } };
  freshDb();
  check("F8 no edit session → the very same page; locale/homeSlug never asked", (await markPublishedPage(page, ask)) === page && asked === 0);
  freshDb(); setSession("/oferta");
  const mp = await markPublishedPage(page, ask);
  check("F8b an admin's edit session for /<slug> → the page comes back marked (a copy)",
    mp !== page && same(stegaRead((mp.blocks[0].content as { title: { pl: string } }).title.pl), [`${NONCE}.c${B_HERO.slice(0, 8)}.${nTitle}`])
    && JSON.stringify(page.blocks[0]) === JSON.stringify(heroBlock()));
  freshDb(); setSession("/oferta"); iceState.headers.set("next-action", "abc123");
  check("F8c … but NOT in a server action (next-action header)", (await markPublishedPage(page, ask)) === page);
  freshDb(); setSession("/oferta"); iceState.headersThrow = true;
  check("F8d … and not when the headers cannot be read (fails closed)", (await markPublishedPage(page, ask)) === page);
  freshDb(); setSession("/oferta"); iceState.viewerAdmin = false;
  check("F8e a non-admin with the cookie → the same page", (await markPublishedPage(page, ask)) === page);
  freshDb(); setSession("/inna");
  check("F8f a session for another slug → the same page", (await markPublishedPage(page, ask)) === page);
  freshDb(); setSession("/");
  check("F8g a \"/\" session does not apply to a page that is not the homepage", (await markPublishedPage(page, ask)) === page);
  const homePage = deepFreeze({ slug: "start-strona", blocks: [heroBlock()] as CmsBlockLike[] });
  freshDb(); setSession("/");
  const hm = await markPublishedPage(homePage, ask);
  check("F8h … and does apply to the homepage slug", hm !== homePage && stegaRead((hm.blocks[0].content as { title: { pl: string } }).title.pl).length === 1);
  freshDb(); iceState.cookies.set(editCookieName("/oferta"), editCookieValue({ nonce: NONCE, path: "/inna" }));
  check("F8i a cookie whose name does not hash its path is ignored", (await markPublishedPage(page, ask)) === page);
}

/* ══ G. DICTIONARY LAYER ═══════════════════════════════════════════════════ */

async function sectionG() {
  console.log("\nG. DICTIONARY LAYER — overrides and markers as a page renders them");
  const base = pl as Dict;
  const bag = (rows: { key: string; locale: string; value: string }[]) => { iceState.anonRpc = async () => ({ data: rows, error: null }); };

  freshDb(); bag([]);
  check("G1 no overrides, no session → the shipped object itself", (await layerDictionary("pl", base)) === base);
  check("G1b the overrides are read through content_overrides_published (anon)", same(iceState.anonCalls, ["content_overrides_published"]));
  freshDb(); bag([{ key: "sellerHome.ba.title", locale: "pl", value: "Nowy tytuł" }, { key: "sellerHome.ba.title", locale: "en", value: "New title" }]);
  const withOv = await layerDictionary("pl", base);
  check("G2 a valid override is applied (and the shipped copy is not changed)",
    lookup(withOv, "sellerHome.ba.title") === "Nowy tytuł" && lookup(base, "sellerHome.ba.title") === "Przed / po" && withOv !== base);
  check("G2b … only for its own locale", lookup(await layerDictionary("de", DICTS.de), "sellerHome.ba.title") === lookup(DICTS.de, "sellerHome.ba.title"));
  freshDb(); bag([{ key: "sellerHome.ba.title", locale: "pl", value: "<i>x</i>" }, { key: "credits.balance", locale: "pl", value: "999" }]);
  check("G2c an invalid or unregistered override is not applied", (await layerDictionary("pl", base)) === base);

  const keys = pageTextKeys(HOME);
  for (const loc of LOCALES) {
    freshDb(); bag([]); setSession("/home");
    const d = await layerDictionary(loc, DICTS[loc]);
    const wrong: string[] = [];
    keys.forEach((k, i) => {
      const v = lookup(d, k);
      const orig = lookup(DICTS[loc], k) ?? "";
      if (typeof v !== "string" || !same(stegaRead(v), [`${NONCE}.t${i}`]) || stegaStrip(v) !== orig) wrong.push(k);
    });
    const markedLeaves = leaves(d).filter(([, v]) => v.includes(MARK_START)).map(([p]) => p);
    const extra = markedLeaves.filter((p) => !keys.includes(p));
    check(`G3 /home edit session (${loc}): every /home key carries <nonce>.t<index> (pageTextKeys order) and strips to the shipped value`,
      wrong.length === 0, short(wrong));
    check(`G3b /home edit session (${loc}): exactly the /home keys are marked — nothing else in the dictionary (${markedLeaves.length} leaves)`,
      extra.length === 0 && markedLeaves.length === keys.length, `extra: ${short(extra)}`);
  }
  freshDb(); bag([{ key: "sellerHome.ba.title", locale: "pl", value: "Nowy tytuł" }]); setSession("/home");
  const both = await layerDictionary("pl", base);
  check("G3c an override and a marker together: stegaStrip gives the override", stegaStrip(lookup(both, "sellerHome.ba.title") ?? "") === "Nowy tytuł");
  check("G3d a key of another page is not marked in a /home session", lookup(both, "pricing.title") === lookup(base, "pricing.title"));
  freshDb(); bag([]); setSession("/home"); iceState.headers.set("next-action", "7f00aa");
  check("G4 NOT marked when the request is a server action (next-action header)", (await layerDictionary("pl", base)) === base);
  freshDb(); bag([]); setSession("/home"); iceState.headersThrow = true;
  check("G4b NOT marked when headers() cannot be read", (await layerDictionary("pl", base)) === base);
  freshDb(); bag([]); setSession("/");
  check("G5 a \"/\" session marks nothing", (await layerDictionary("pl", base)) === base);
  freshDb(); bag([]); setSession("/home"); iceState.viewerAdmin = false;
  check("G5b a non-admin with an edit cookie gets no markers", (await layerDictionary("pl", base)) === base);
  freshDb(); bag([]); setSession("/plan");
  const plan = await layerDictionary("pl", base);
  check("G5c the /plan alias marks the /plany keys", same(stegaRead(lookup(plan, "pricing.title") ?? ""), [`${NONCE}.t${pageTextKeys(PLANS).indexOf("pricing.title")}`]));
  quiet();
  freshDb(); iceState.anonRpc = async () => { throw new Error("network down"); };
  const thrown = await layerDictionary("pl", base);
  freshDb(); iceState.anonRpc = async () => ({ data: null, error: { code: "57014", message: "statement timeout" } });
  const errored = await layerDictionary("pl", base);
  freshDb(); iceState.anonRpc = async () => ({ data: null, error: { code: "PGRST202", message: "function not found" } });
  const missingFn = await layerDictionary("pl", base);
  freshDb(); iceState.anonRpc = async () => ({ data: { not: "a list" }, error: null });
  const notList = await layerDictionary("pl", base);
  loud();
  check("G6 a broken override read (throw / db error / missing function / not a list) renders the shipped copy",
    thrown === base && errored === base && missingFn === base && notList === base);
  freshDb(); iceState.anonRpc = async () => { throw new Error("network down"); }; setSession("/home");
  quiet(); const failMarked = await layerDictionary("pl", base); loud();
  check("G6b … and an edit session still gets its markers when the override read fails", stegaRead(lookup(failMarked, "sellerHome.ba.title") ?? "").length === 1);
  check("G7 the shipped dictionaries were never mutated by the layer", LOCALES.every((l, i) => JSON.stringify(DICTS[l]) === SHIPPED_JSON[i]));
}

/* ══ H. SESSION ════════════════════════════════════════════════════════════ */

async function sectionH() {
  console.log("\nH. SESSION — edit cookies, specificity, admin only; the gate");
  check("H1 editCookieName is deterministic, prefixed, 8 hex", editCookieName("/home") === editCookieName("/home") && /^gb_ice_e_[0-9a-f]{8}$/.test(editCookieName("/home")) && editCookieName("/home").startsWith(ICE_EDIT_PREFIX));
  const names = ["/", "/home", "/plany", "/plan", "/tools", "/tools/remove_bg", "/oferta"].map(editCookieName);
  check("H1b … and differs per path", new Set(names).size === names.length);
  check("H2 parseEditCookie accepts <8 lower-alnum nonce>~<path>", same(parseEditCookie("abcd1234~/home"), { nonce: "abcd1234", path: "/home" }) && same(parseEditCookie(editCookieValue({ nonce: "z9z9z9z9", path: "/tools/remove_bg" })), { nonce: "z9z9z9z9", path: "/tools/remove_bg" }));
  const bad = ["ABCD1234~/home", "abc~/home", "abcd12345~/home", "abcd-234~/home", "abcd1234~home", "abcd1234~/ho me", "abcd1234~/a~b", "abcd1234", "", `abcd1234~/${"a".repeat(201)}`, "abcd1234~/<x>"];
  const accepted = bad.filter((v) => parseEditCookie(v) !== null);
  check("H2b parseEditCookie rejects bad nonces and paths", accepted.length === 0 && parseEditCookie(undefined) === null, short(accepted));
  const nonces = Array.from({ length: 50 }, newNonce);
  check("H2c newNonce always yields a nonce the parser accepts", nonces.every((n) => parseEditCookie(`${n}~/home`) !== null) && new Set(nonces).size === 50);

  freshDb();
  iceState.cookies.set(editCookieName("/plany"), editCookieValue({ nonce: NONCE, path: "/home" }));
  check("H3 a cookie whose name doesn't match its path's hash is ignored", (await iceCookies()).edits.length === 0 && (await iceEditSession()) === null);
  freshDb(); setSession("/tools", "aaaaaaaa"); setSession("/tools/remove_bg", "bbbbbbbb"); setSession("/", "cccccccc");
  const c = await iceCookies();
  check("H4 most specific session first", same(c.edits.map((e) => e.path), ["/tools/remove_bg", "/tools", "/"]) && (await iceEditSession())?.nonce === "bbbbbbbb");
  check("H4b iceEditSessions returns them all for an admin", (await iceEditSessions()).length === 3);
  iceState.viewerAdmin = false;
  check("H5 non-admin → no session at all", (await iceEditSession()) === null && (await iceEditSessions()).length === 0);
  iceState.viewerAdmin = true; iceState.viewerAdminThrow = true;
  check("H5b a failing role lookup counts as non-admin", (await iceViewerIsAdmin()) === false && (await iceEditSession()) === null);
  freshDb(); iceState.clientThrow = true;
  check("H5c a failing client counts as non-admin", (await iceViewerIsAdmin()) === false);
  freshDb(); iceState.cookies.set(ICE_HINT_COOKIE, "1");
  check("H6 the hint cookie is seen; no edits", (await iceCookies()).hint && (await iceCookies()).edits.length === 0);
  freshDb(); iceState.cookiesThrow = true;
  check("H6b unreadable cookies → no hint, no sessions", same(await iceCookies(), { hint: false, edits: [] }));

  // gate
  freshDb();
  check("H7 gate: a visitor without cookies → null, and no role lookup", (await iceGateData()) === null && iceState.stepUpCalls === 0);
  freshDb(); iceState.cookies.set(ICE_HINT_COOKIE, "1");
  const g = await iceGateData();
  check("H7b gate: an admin with the hint → the supported paths (registry + /plan + published CMS pages, never app/draft)",
    g !== null && g.supported.includes("/home") && g.supported.includes("/plan") && g.supported.includes("/plany") && g.supported.includes("/oferta")
    && g.supported.includes("/") && !g.supported.includes("/szkic") && !g.supported.includes("/aplikacja") && !g.supported.includes("/start-strona"));
  freshDb(); iceState.cookies.set(ICE_HINT_COOKIE, "1"); iceState.stepUp = "/auth/security-check";
  check("H7c gate: an admin on an unverified device → null", (await iceGateData()) === null);
  freshDb(); iceState.cookies.set(ICE_HINT_COOKIE, "1"); iceState.viewerAdmin = false;
  check("H7d gate: a non-admin with the hint → null", (await iceGateData()) === null);
}

/* ══ I. ACTIONS ════════════════════════════════════════════════════════════ */

const IMG = "11111111-0000-4000-8000-000000000001";
const IMG12 = "11111111-0000-4000-8000-000000000002";
const IMG16 = "11111111-0000-4000-8000-000000000003";
const GIFA = "11111111-0000-4000-8000-000000000004";
const VID = "11111111-0000-4000-8000-000000000005";
const VIDM = "11111111-0000-4000-8000-000000000006";
const POSTER = "11111111-0000-4000-8000-000000000007";
const NOFILE = "11111111-0000-4000-8000-000000000008";
const TABLET = "11111111-0000-4000-8000-000000000009";
const NEWIMG = "11111111-0000-4000-8000-00000000000a";
const MiB = 1024 * 1024;
const T1 = "homeMedia.thumbnails.1";
const S1 = "homeMedia.upload.retouch.sample.1";
const P1 = "homeMedia.promo.1";
const VIS = "homeMedia.showcase.visual";
const BASE_TS = "2026-10-02T08:00:00.000Z";
const NOW_TS = "2026-10-15T12:00:00.000Z";

function withLibrary(db: FakeDb) {
  const a = (id: string, kind: string, mime: string, size: number, path: string | null = `lib/${id}.bin`) =>
    ({ id, kind, mime, size_bytes: size, storage_path: path, external_url: null, poster_url: null, title: null, alt: null, width: null, height: null, variants: null, created_at: "2026-01-01T00:00:00Z" });
  db.tables.media_assets = [
    a(IMG, "image", "image/png", 1 * MiB), a(IMG12, "image", "image/jpeg", 12 * MiB), a(IMG16, "image", "image/webp", 16 * MiB),
    a(GIFA, "image", "image/gif", 1 * MiB), a(VID, "video", "video/mp4", 20 * MiB), a(VIDM, "video", "video/webm", 5 * MiB),
    a(POSTER, "image", "image/jpeg", 1 * MiB), a(NOFILE, "image", "image/png", 1 * MiB, null),
    a(NEWIMG, "image", "image/avif", 2 * MiB, "lib/new picture.avif"),
  ];
  db.tables.media_slots = [
    { slot_key: P1, media_type: "image", media_id: IMG, tablet_media_id: TABLET, mobile_media_id: null, poster_media_id: null, alt_text: null, alt_i18n: null, object_fit: "cover", object_position: "center center", crop: null, enabled: true, updated_at: BASE_TS },
  ];
  db.rpcs.media_slots_write = (args) => ({ data: Object.fromEntries((args.p_writes as Row[]).map((w) => [w.key as string, NOW_TS])), error: null });
}

const write = (key: string, o: Partial<IceSlotWrite> = {}): IceSlotWrite => ({
  key, mediaType: "image", mediaId: IMG, mobileMediaId: null, posterMediaId: null, alt: null, altI18n: {}, fit: "cover",
  position: "center center", crop: null, base: null, ...o,
});

type AnyResult = { ok: boolean; error?: string; current?: unknown; data?: unknown };
const uploadPath = (u = "0f8fad5b-d9cb-469f-a165-70867728950e", name = "photo.png") => `ice/${u}/${name}`;
// registerUpload's own pattern (lib/server/ice/actions.ts UPLOAD_PATH)
const UPLOAD_PATH = /^ice\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;

let fetchCalls: { url: string; init?: RequestInit }[] = [];
function fakeFetch(respond: () => Response) {
  fetchCalls = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    return respond();
  }) as typeof fetch;
}
const ranged = (head: Uint8Array, total: number | null, status = 206) => () => new Response(head.slice(0, 64), {
  status, headers: total === null ? {} : status === 206 ? { "content-range": `bytes 0-63/${total}` } : { "content-length": String(total) },
});

async function sectionI() {
  console.log("\nI. ACTIONS — who may call, what is refused, what is written");
  const K = "sellerHome.ba.title";

  // ── the gate on every action ────────────────────────────────────────────
  const CALLS: [string, () => Promise<AnyResult>][] = [
    ["setEdit", () => actions.setEdit(true, "/home")],
    ["setEdit(off)", () => actions.setEdit(false, "/home")],
    ["rememberAdmin", () => actions.rememberAdmin()],
    ["pageInfo", () => actions.pageInfo("/home")],
    ["cmsMap", () => actions.cmsMap("/oferta")],
    ["textState", () => actions.textState(K)],
    ["textSave", () => actions.textSave({ key: K, locale: "pl", value: "Nowe", base: null })],
    ["slotState", () => actions.slotState([T1])],
    ["slotSave", () => actions.slotSave({ writes: [write(T1)], action: "save" })],
    ["history", () => actions.history({ target: "text", key: K })],
    ["pageHistory", () => actions.pageHistory("/home")],
    ["library", () => actions.library({})],
    ["assets", () => actions.assets([IMG])],
    ["usage", () => actions.usage(IMG)],
    ["uploadTicket", () => actions.uploadTicket({ name: "a.png", size: 100, type: "image/png" })],
    ["registerUpload", () => actions.registerUpload({ path: uploadPath(), name: "a.png" })],
    ["cmsSave", () => actions.cmsSave({ blockId: B_HERO, path: ["title"], locale: "pl", value: "Nowy", expected: "Stary tytuł", base: null })],
  ];
  const exported = Object.entries(actions).filter(([, v]) => typeof v === "function").map(([k]) => k).filter((k) => k !== "iceSupportedPaths");
  const covered = new Set(CALLS.map(([n]) => n.replace(/\(.*\)$/, "")));
  check(`I0 the gate table covers every exported action (${exported.length})`, exported.every((n) => covered.has(n)), short(exported.filter((n) => !covered.has(n))));
  const MODES: [string, (db: FakeDb) => void, string][] = [
    ["unauthenticated", (db) => { db.user = null; }, "unauthenticated"],
    ["a customer", (db) => { db.user = { id: CUSTOMER }; }, "not_admin"],
    ["an admin on an unverified device", () => { iceState.stepUp = "/auth/security-check"; }, "step_up_required"],
  ];
  for (const [who, setup, code] of MODES) {
    const bad: string[] = [];
    for (const [name, call] of CALLS) {
      const db = freshDb(); withLibrary(db); setup(db);
      fakeFetch(() => new Response("no", { status: 500 }));
      quiet(); const r = await call(); loud();
      const beyond = db.calls.filter((c) => !(c.kind === "auth" || (c.kind === "from" && c.table === "profiles" && c.op === "select")));
      const profiles = db.calls.some((c) => c.kind === "from" && c.table === "profiles");
      const reason = r.ok ? "ok" : r.error !== code ? `error ${r.error}`
        : beyond.length ? `touched ${beyond.map((c) => c.kind === "from" ? c.table : c.kind === "rpc" ? `rpc:${c.name}` : c.kind).join(",")}`
          : iceState.cookieWrites.length ? "set a cookie" : iceState.revalidated.length ? "revalidated" : iceState.audits.length ? "audited"
            : fetchCalls.length ? "fetched" : code === "unauthenticated" && profiles ? "read profiles"
              : code === "not_admin" && iceState.stepUpCalls ? "asked step-up before the role" : "";
      if (reason) bad.push(`${name}: ${reason}`);
    }
    check(`I1 every action refuses ${who} with "${code}" before any table/RPC/storage/fetch/cookie/cache/audit`, bad.length === 0, short(bad, 6));
  }
  {
    const db = freshDb(); db.user = null;
    const wrapperCalls: [string, () => Promise<AnyResult>][] = [
      ["iceSetEditAction", () => wrappers.iceSetEditAction(true, "/home")], ["iceRememberAdminAction", () => wrappers.iceRememberAdminAction()],
      ["icePageAction", () => wrappers.icePageAction("/home")], ["iceTextStateAction", () => wrappers.iceTextStateAction(K)],
      ["iceTextSaveAction", () => wrappers.iceTextSaveAction({ key: K, locale: "pl", value: "x", base: null })],
      ["iceSlotStateAction", () => wrappers.iceSlotStateAction([T1])], ["iceSlotSaveAction", () => wrappers.iceSlotSaveAction({ writes: [write(T1)], action: "save" })],
      ["iceHistoryAction", () => wrappers.iceHistoryAction({ target: "text", key: K })], ["icePageHistoryAction", () => wrappers.icePageHistoryAction("/home")],
      ["iceLibraryAction", () => wrappers.iceLibraryAction({})], ["iceUsageAction", () => wrappers.iceUsageAction(IMG)], ["iceAssetsAction", () => wrappers.iceAssetsAction([IMG])],
      ["iceUploadTicketAction", () => wrappers.iceUploadTicketAction({ name: "a", size: 1, type: "image/png" })],
      ["iceRegisterUploadAction", () => wrappers.iceRegisterUploadAction({ path: uploadPath(), name: "a" })], ["iceCmsMapAction", () => wrappers.iceCmsMapAction("/oferta")],
      ["iceCmsSaveAction", () => wrappers.iceCmsSaveAction({ blockId: B_HERO, path: ["title"], locale: "pl", value: "x", expected: null, base: null })],
    ];
    const names = Object.keys(wrappers);
    const results = await Promise.all(wrapperCalls.map(([, f]) => f()));
    check(`I1b every "use server" wrapper (${names.length}) delegates: unauthenticated → "unauthenticated"`,
      names.length === wrapperCalls.length && names.every((n) => wrapperCalls.some(([w]) => w === n)) && results.every((r) => !r.ok && r.error === "unauthenticated"));
  }

  // ── textSave ────────────────────────────────────────────────────────────
  const textDb = (override?: { value: string; updated_at: string }) => {
    const db = freshDb();
    db.tables.content_overrides = override ? [{ key: K, locale: "pl", ...override }] : [];
    db.rpcs.content_override_write = () => ({ data: NOW_TS, error: null });
    return db;
  };
  const save = (input: Partial<Parameters<typeof actions.textSave>[0]>) =>
    actions.textSave({ key: K, locale: "pl", value: "Nowy tytuł", base: null, ...input } as Parameters<typeof actions.textSave>[0]);
  {
    const db = textDb();
    const r = await save({ key: "sellerHome.nope" });
    check("I2 textSave: an unregistered key → unknown_key, nothing read or written", !r.ok && r.error === "unknown_key" && db.rpcCalls().length === 0 && !db.tablesTouched().includes("content_overrides"));
    const deniedKeys = ["pricing.notice.x", "credits.balance", "sellerHome.noCredits", "retouch.title", "pricing.plan.perMonth", "wf.ecommerce.thumbnail.prompt"];
    const rs = await Promise.all(deniedKeys.map((key) => save({ key })));
    check("I2b a denied key cannot even be reached (it is not registered → unknown_key)",
      rs.every((x) => !x.ok && x.error === "unknown_key") && deniedKeys.every((k) => isDeniedKey(k) && !ICE_TEXT_KEYS.has(k)) && db.rpcCalls().length === 0);
    const loc = await save({ locale: "fr" as IceLocale });
    check("I2c an invalid locale → locale", !loc.ok && loc.error === "locale");
    const act = await save({ action: "delete" as "save" });
    check("I2d an unknown action → bad_action", !act.ok && act.error === "bad_action");
  }
  const refusals: [string, Partial<Parameters<typeof actions.textSave>[0]>, string][] = [
    ["markup", { value: "Przed <b>po</b>" }, "text_markup"],
    ["invisible", { value: "Przed\u200B/ po" }, "text_invisible"],
    ["newline", { value: "Przed\npo" }, "text_newline"],
    ["placeholders", { value: "Przed {name}" }, "text_placeholders"],
    ["claim (pricing.title)", { key: "pricing.title", value: "Wybierz plan z fakturą VAT" }, "text_claim"],
    ["too long", { value: "x".repeat((textSpec(K)?.text?.maxLength ?? 0) + 1) }, "text_too_long"],
    ["empty", { value: "   " }, "text_empty"],
    ["not a string", { value: 42 as unknown as string }, "text_invalid"],
  ];
  for (const [what, input, code] of refusals) {
    const db = textDb();
    const r = await save(input);
    check(`I3 textSave refuses ${what} with ${code} and calls NO rpc`, !r.ok && r.error === code && db.rpcCalls().length === 0 && iceState.audits.length === 0 && iceState.revalidated.length === 0, JSON.stringify(r));
  }
  {
    const db = textDb();
    const r = await save({ value: "Ten sam tekst z fakturą VAT" });
    check("I3b the same 'claim' text on a sellerHome.* key is accepted", r.ok && db.rpcCalls("content_override_write").length === 1);
  }
  {
    const db = textDb({ value: "Stary override", updated_at: BASE_TS });
    const r = await save({ value: "  Przed   /  po ", base: BASE_TS });
    const call = db.rpcCalls("content_override_write")[0];
    check("I4 typing the shipped default back (after normalising) with an override present → RPC reset with p_value null",
      r.ok && db.rpcCalls().length === 1 && same(call?.args, { p_key: K, p_locale: "pl", p_value: null, p_base: BASE_TS, p_action: "reset" }), JSON.stringify(call?.args));
    check("I4b … audited once, content-overrides revalidated once", iceState.audits.length === 1 && same(iceState.revalidated, ["tag:content-overrides"]));
  }
  {
    const db = textDb();
    const r = await save({ value: "Przed / po" });
    check("I4c the shipped default with NO override → no RPC at all, ok with updatedAt null, nothing audited or revalidated",
      r.ok && same(r.data, { updatedAt: null }) && db.rpcCalls().length === 0 && iceState.audits.length === 0 && iceState.revalidated.length === 0);
    const r2 = await save({ value: null });
    check("I4d value null with no override → the same no-op", r2.ok && db.rpcCalls().length === 0);
  }
  {
    const db = textDb({ value: "Stary", updated_at: BASE_TS });
    db.rpcs.content_override_write = () => ({ data: null, error: { message: "conflict" } });
    const r = await save({ value: "Nowy", base: "2026-01-01T00:00:00Z" });
    const cur = (r.ok ? undefined : r.current) as IceTextState[] | undefined;
    check("I5 RPC 'conflict' → error conflict with the current states (3 locales, the override present)",
      !r.ok && r.error === "conflict" && Array.isArray(cur) && cur.length === 3 && cur[0].key === K && cur.find((s) => s.locale === "pl")?.override === "Stary"
      && cur.find((s) => s.locale === "en")?.defaultValue === lookup(DICTS.en, K) && iceState.audits.length === 0 && iceState.revalidated.length === 0);
  }
  {
    const db = textDb({ value: "Nowy", updated_at: BASE_TS });
    db.rpcs.content_override_write = () => ({ data: null, error: { message: "noop" } });
    const r = await save({ value: "Nowy", base: BASE_TS });
    check("I6 RPC 'noop' → ok (the loaded updatedAt), nothing audited or revalidated",
      r.ok && same(r.data, { updatedAt: BASE_TS }) && iceState.audits.length === 0 && iceState.revalidated.length === 0);
  }
  {
    const db = textDb();
    const r = await save({ value: "  Nowy \t tytuł  " });
    const call = db.rpcCalls("content_override_write")[0];
    check("I7 success: one RPC with the normalised value, p_base null, p_action save",
      r.ok && same(r.data, { updatedAt: NOW_TS }) && same(call?.args, { p_key: K, p_locale: "pl", p_value: "Nowy tytuł", p_base: null, p_action: "save" }), JSON.stringify(call?.args));
    check("I7b … logAudit once (ice.text.saved, key:locale), revalidateTag(content-overrides) once and nothing else",
      iceState.audits.length === 1 && iceState.audits[0].action === "ice.text.saved" && iceState.audits[0].entityId === `${K}:pl` && iceState.audits[0].actorId === ADMIN
      && same(iceState.revalidated, [`tag:${CONTENT_TAG}`]) && CONTENT_TAG === "content-overrides");
  }
  for (const [msg, code] of [["not_admin", "not_admin"], ["invalid_text", "invalid_text"], ["new row violates check constraint \"x\"", "invalid"], ["boom", "generic"]] as const) {
    const db = textDb();
    db.rpcs.content_override_write = () => ({ data: null, error: { message: msg } });
    quiet(); const r = await save({}); loud();
    check(`I8 RPC error "${msg.slice(0, 20)}" → ${code}`, !r.ok && r.error === code && iceState.audits.length === 0);
  }
  {
    const db = textDb();
    const r = await actions.textState(K);
    const d = r.ok ? r.data : null;
    check("I9 textState: 3 locale states with the shipped defaults, the pages it renders on, the cap",
      Boolean(d) && d!.states.length === 3 && d!.states.every((s) => s.defaultValue === lookup(DICTS[s.locale], K) && s.override === null) && same(d!.pages, ["/home"]) && d!.maxLength === textSpec(K)?.text?.maxLength && db.calls.length > 0);
    const u = await actions.textState("credits.balance");
    check("I9b textState: an unregistered key → unknown_key", !u.ok && u.error === "unknown_key");
  }

  // ── slotSave ────────────────────────────────────────────────────────────
  const slotRun = async (writes: IceSlotWrite[], action: "save" | "restore" | "clear" | "bulk" = "save", tweak?: (db: FakeDb) => void) => {
    const db = freshDb(); withLibrary(db); tweak?.(db);
    quiet(); const r = await actions.slotSave({ writes, action }); loud();
    const payload = (db.rpcCalls("media_slots_write")[0]?.args.p_writes ?? null) as Row[] | null;
    return { r, db, payload };
  };
  const refusedNoRpc = (x: { r: AnyResult; db: FakeDb }, code: string) => !x.r.ok && x.r.error === code && x.db.rpcCalls().length === 0 && iceState.audits.length === 0 && iceState.revalidated.length === 0;
  const SLOT_REFUSALS: [string, IceSlotWrite[], string][] = [
    ["an unknown slot", [write("homeMedia.nope")], "unknown_slot"],
    ["more than 60 writes", allElements(HOME).flatMap((e) => e.slots ?? []).filter((s) => s.entityType === "global").slice(0, 61).map((s) => write(s.key)), "bad_keys"],
    ["duplicate keys", [write(T1), write(T1)], "bad_keys"],
    ["no writes", [], "bad_keys"],
    ["a video into an image slot", [write(T1, { mediaType: "video", mediaId: VID })], "no_video_here"],
    ["a video into a sample slot", [write(S1, { mediaType: "video", mediaId: VID })], "no_video_here"],
    ["a gif", [write(T1, { mediaId: GIFA })], "asset_format"],
    ["an oversized (16 MiB) image", [write(T1, { mediaId: IMG16 })], "asset_too_large"],
    ["a wrong-kind asset (a video file as an image)", [write(T1, { mediaId: VID })], "asset_kind"],
    ["a 12 MiB image into a sample slot", [write(S1, { mediaId: IMG12 })], "asset_too_large"],
    ["an asset with no file", [write(T1, { mediaId: NOFILE })], "asset_missing"],
    ["an unknown asset id", [write(T1, { mediaId: "99999999-0000-4000-8000-000000000000" })], "asset_missing"],
    ["crop zoom 3", [write(T1, { crop: { x: 50, y: 50, zoom: 3 } })], "crop"],
    ["crop with an unknown field", [write(T1, { crop: { x: 50, y: 50, zoom: 1, z: 1 } as unknown as IceSlotWrite["crop"] })], "crop"],
    ["crop `m` without a mobile file", [write(P1, { mediaType: "video", mediaId: VID, crop: { x: 1, y: 2, zoom: 1, m: { x: 3, y: 4, zoom: 1.5 } }, base: BASE_TS })], "crop"],
    ["crop `m` on a slot with no mobile file allowed", [write(T1, { crop: { x: 1, y: 2, zoom: 1, m: { x: 3, y: 4, zoom: 1.5 } } })], "crop"],
    ["a poster on an image", [write(T1, { posterMediaId: POSTER })], "poster"],
    ["alt with '<'", [write(T1, { altI18n: { pl: "a<b" } })], "alt_markup"],
    ["alt with an invisible char", [write(T1, { altI18n: { en: "a\u200Bb" } })], "alt_invisible"],
    ["alt in an unknown locale", [write(T1, { altI18n: { fr: "x" } as unknown as IceSlotWrite["altI18n"] })], "alt"],
    ["a bad fit", [write(T1, { fit: "fill" as "cover" })], "fit"],
    ["a bad position", [write(T1, { position: "top" })], "position"],
    ["a bad media type", [write(T1, { mediaType: "audio" as "image" })], "media_type"],
  ];
  for (const [what, writes, code] of SLOT_REFUSALS) {
    const x = await slotRun(writes);
    check(`I10 slotSave refuses ${what} → ${code}, no RPC`, refusedNoRpc(x, code), JSON.stringify(x.r).slice(0, 120));
  }
  {
    // A slot the editor frames without a phone file keeps whatever phone file
    // Admin → Media gave it; a phone file sent by the client is ignored.
    const x = await slotRun([write(T1, { mobileMediaId: IMG, base: BASE_TS })], "save", (db) => {
      (db.tables.media_slots as Row[]).push({ slot_key: T1, media_type: "image", media_id: IMG, tablet_media_id: null, mobile_media_id: POSTER, poster_media_id: null,
        alt_text: null, alt_i18n: null, object_fit: "cover", object_position: "center center", crop: null, enabled: true, updated_at: BASE_TS });
    });
    const p = x.payload?.[0];
    check("I10a a phone file sent for a slot without one is ignored; the stored one (Admin → Media's) is kept", x.r.ok && p?.mobile_media_id === POSTER, JSON.stringify(p));
    const z = await slotRun([write(T1, { mediaId: NEWIMG, mobileMediaId: IMG, base: BASE_TS })], "save", (db) => {
      (db.tables.media_slots as Row[]).push({ slot_key: T1, media_type: "image", media_id: IMG, tablet_media_id: TABLET, mobile_media_id: POSTER, poster_media_id: null,
        alt_text: null, alt_i18n: null, object_fit: "cover", object_position: "center center", crop: null, enabled: true, updated_at: BASE_TS });
    });
    check("I10a2 a NEW main file drops the old phone and tablet files (made for the old picture)",
      z.r.ok && z.payload?.[0]?.mobile_media_id === null && z.payload?.[0]?.tablet_media_id === null, JSON.stringify(z.payload?.[0]));
    const rs = await slotRun([write(T1, { mobileMediaId: POSTER })], "restore");
    check("I10a3 a restore puts back the snapshot's own phone file, checked like any file", rs.r.ok && rs.payload?.[0]?.mobile_media_id === POSTER, JSON.stringify(rs.payload?.[0]));
    const rbad = await slotRun([write(T1, { mobileMediaId: VID })], "restore");
    check("I10a4 … and refuses a snapshot phone file of the wrong kind", !rbad.r.ok && rbad.r.error === "asset_kind", JSON.stringify(rbad.r));
    const y = await slotRun([write(T1, { mobileMediaId: IMG })]);
    check("I10a' … and with no stored row the slot gets none", y.r.ok && y.payload?.[0]?.mobile_media_id === null, JSON.stringify(y.payload?.[0]));
  }
  {
    const x = await slotRun([write(T1)], "delete" as "save");
    check("I10b slotSave: an unknown action → bad_action", refusedNoRpc(x, "bad_action"));
    const ok12 = await slotRun([write(T1, { mediaId: IMG12 })]);
    check("I10c a 12 MiB image is fine in an ordinary image slot (15 MiB cap)", ok12.r.ok);
  }
  {
    const evil = { ...write(P1, { mediaType: "video", mediaId: VID, mobileMediaId: VIDM, posterMediaId: POSTER, base: BASE_TS, fit: "contain", position: "left top",
      crop: { x: 10.123, y: 20, zoom: 1.23456, m: { x: 30, y: 40, zoom: 2 } }, altI18n: { pl: "  Opis   banera ", en: "Banner", de: "" }, alt: "ignored" }),
      entity_type: "tool", entity_id: "hack", slot_name: "x", tablet_media_id: "evil" } as IceSlotWrite;
    const x = await slotRun([evil]);
    const p = x.payload?.[0];
    check("I11 the media_slots_write payload: entity_type/entity_id/slot_name from the registry, never the client",
      x.r.ok && p?.entity_type === "global" && p?.entity_id === "sellerHome" && p?.slot_name === "promo.1" && p?.key === P1, JSON.stringify(p));
    check("I11b … a new main file drops the old tablet file (made for the old picture); alt_text = the Polish alt, alt_i18n without empties",
      p?.tablet_media_id === null && p?.alt_text === "Opis banera" && same(p?.alt_i18n, { pl: "Opis banera", en: "Banner" }));
    const keepT = await slotRun([write(P1, { mediaId: IMG, base: BASE_TS, crop: { x: 20, y: 20, zoom: 1 } })]);
    check("I11b' … the same main file (a frame edit) keeps the tablet file", keepT.r.ok && keepT.payload?.[0]?.tablet_media_id === TABLET, JSON.stringify(keepT.payload?.[0]));
    check("I11c … video + mobile + poster + rounded crop with m + fit/position + base, p_action save",
      p?.media_type === "video" && p?.media_id === VID && p?.mobile_media_id === VIDM && p?.poster_media_id === POSTER
      && same(p?.crop, { x: 10.12, y: 20, zoom: 1.235, m: { x: 30, y: 40, zoom: 2 } }) && p?.object_fit === "contain" && p?.object_position === "left top"
      && p?.base === BASE_TS && x.db.rpcCalls("media_slots_write")[0].args.p_action === "save");
    check("I11d success → revalidateTag(media-slots) only; one audit row (ice.slot.saved)",
      same(iceState.revalidated, [`tag:${MEDIA_SLOT_TAG}`]) && MEDIA_SLOT_TAG === "media-slots" && iceState.audits.length === 1 && iceState.audits[0].action === "ice.slot.saved"
      && x.r.ok && same(x.r.data.updatedAt, { [P1]: NOW_TS }));
  }
  {
    const card = cardSlotKey("retouch");
    const x = await slotRun([write(card, { crop: { x: 10, y: 10, zoom: 2 } })]);
    const p = x.payload?.[0];
    check("I12 a crop on a positionOnly (tool card) slot is forced to null; entity from the registry",
      x.r.ok && p?.crop === null && p?.entity_type === "tool" && p?.entity_id === "retouch" && p?.slot_name === "card");
    const cm = await slotRun([write(card, { crop: { x: 10, y: 10, zoom: 9 } })]);
    check("I12b … even an out-of-range crop is ignored there (forced null, not refused)", cm.r.ok && cm.payload?.[0]?.crop === null);
  }
  {
    const x = await slotRun([write(P1, { mediaType: "video", mediaId: VID, mobileMediaId: VIDM, base: BASE_TS, crop: { x: 1, y: 1, zoom: 1 } })], "clear");
    const p = x.payload?.[0];
    check("I13 action clear → media/mobile/poster/tablet null and crop null",
      x.r.ok && p?.media_id === null && p?.mobile_media_id === null && p?.poster_media_id === null && p?.tablet_media_id === null && p?.crop === null);
  }
  {
    const x = await slotRun([write(T1), write(VIS, { mediaType: "video", mediaId: VID })], "bulk", (db) => {
      db.rpcs.media_slots_write = () => ({ data: null, error: { message: `conflict:${T1}` } });
    });
    const cur = (x.r.ok ? undefined : x.r.current) as { key: string | null; states: { key: string }[] } | undefined;
    check("I14 RPC 'conflict:<key>' → conflict naming that key, with the current states of every slot written",
      !x.r.ok && x.r.error === "conflict" && cur?.key === T1 && same(cur?.states.map((s) => s.key), [T1, VIS]) && iceState.audits.length === 0 && iceState.revalidated.length === 0);
  }
  {
    const x = await slotRun([write(T1)], "save", (db) => { db.rpcs.media_slots_write = () => ({ data: null, error: { message: "not_admin" } }); });
    check("I14b RPC 'not_admin' → not_admin", !x.r.ok && x.r.error === "not_admin");
  }

  // ── uploadTicket ────────────────────────────────────────────────────────
  {
    freshDb();
    const t = async (input: { name: string; size: number; type: string }) => actions.uploadTicket(input);
    const gif = await t({ name: "a.gif", size: 100, type: "image/gif" });
    const big = await t({ name: "a.png", size: ICE_MAX_IMAGE_BYTES + 1, type: "image/png" });
    const edge = await t({ name: "a.png", size: ICE_MAX_IMAGE_BYTES, type: "image/png" });
    const vid = await t({ name: "a.mp4", size: ICE_MAX_VIDEO_BYTES, type: "video/mp4" });
    const vidBig = await t({ name: "a.mp4", size: ICE_MAX_VIDEO_BYTES + 1, type: "video/mp4" });
    const zero = await t({ name: "a.png", size: 0, type: "image/png" });
    const str = await t({ name: "a.png", size: "100" as unknown as number, type: "image/png" });
    check("I15 uploadTicket refuses a non-allowed type → format", !gif.ok && gif.error === "format");
    check("I15b uploadTicket refuses oversize / zero / non-numeric sizes → too_large (15 MiB image, 50 MiB video are the edges)",
      !big.ok && big.error === "too_large" && edge.ok && vid.ok && !vidBig.ok && vidBig.error === "too_large" && !zero.ok && !str.ok);
    const names = ["../../evil photo.png", "zdjęcie.jpg", "", "...", ".htaccess", "C:\\x\\y.webp", `${"a".repeat(120)}.jpg`];
    const outs = await Promise.all(names.map((name) => t({ name, size: 100, type: "image/png" })));
    const paths = outs.map((o) => (o.ok ? (o.data as { path: string }).path : ""));
    check("I15c uploadTicket returns ice/<uuid v4>/<safe name> that registerUpload's pattern accepts",
      paths.every((p) => UPLOAD_PATH.test(p)) && paths[0].endsWith("/evil_photo.png") && paths[1].endsWith("/zdjecie.jpg") && paths[2].endsWith("/plik") && paths[4].endsWith("/htaccess"), short(paths, 3));
    const longNames = [`${"A".repeat(20)} ${"b".repeat(75)}.jpg`, `${"a".repeat(30)}.${"b".repeat(79)}`, `${"a".repeat(30)}-${"b".repeat(75)}.png`];
    const longOuts = await Promise.all(longNames.map((name) => t({ name, size: 100, type: "image/png" })));
    const longPaths = longOuts.map((o) => (o.ok ? (o.data as { path: string }).path : ""));
    check("I15d … also for a long name whose 80-char cut lands on a separator (the ticket must be registrable)",
      longPaths.every((p) => UPLOAD_PATH.test(p)), longPaths.map((p) => `${p.split("/").pop()?.slice(0, 6)}…(${p.split("/").pop()?.length} chars)`).join(", "));
  }

  // ── registerUpload ──────────────────────────────────────────────────────
  {
    const badPaths = ["ice/../x.png", "ice/not-a-uuid/x.png", "other/0f8fad5b-d9cb-469f-a165-70867728950e/x.png",
      "ice/0f8fad5b-d9cb-169f-a165-70867728950e/x.png", "ice/0f8fad5b-d9cb-469f-a165-70867728950e/.hidden", "ice/0f8fad5b-d9cb-469f-a165-70867728950e/a/b.png",
      `ice/0f8fad5b-d9cb-469f-a165-70867728950e/${"a".repeat(81)}`];
    const bad: string[] = [];
    for (const p of badPaths) {
      const db = freshDb(); fakeFetch(ranged(PNG, 1000));
      const r = await actions.registerUpload({ path: p, name: "x.png" });
      if (r.ok || r.error !== "bad_path" || db.tablesTouched().some((t) => t !== "profiles") || fetchCalls.length) bad.push(p);
    }
    check("I16 registerUpload refuses a path outside ice/<uuid v4>/<safe name> → bad_path, before any read or fetch", bad.length === 0, short(bad, 3));
  }
  {
    const path = uploadPath(undefined, "photo.jpg");
    const db = freshDb(); fakeFetch(ranged(PNG, 123456));
    const r = await actions.registerUpload({ path, name: "Mój plik.jpg" });
    const row = db.tables.media_assets?.[0];
    check("I17 registerUpload sniffs the first bytes via a Range request on the public URL",
      fetchCalls.length === 1 && fetchCalls[0].url === `${STORAGE_PUBLIC}/media/${path}` && (fetchCalls[0].init?.headers as Record<string, string>)?.Range === "bytes=0-63");
    check("I17b … inserts media_assets with the SNIFFED mime (png, not the .jpg name) and the real size",
      r.ok && row?.mime === "image/png" && row?.kind === "image" && row?.size_bytes === 123456 && row?.storage_path === path && row?.created_by === ADMIN
      && row?.folder === "edytor-wizualny" && row?.title === "Moj_plik.jpg" && (r.data as { mime: string }).mime === "image/png", JSON.stringify(row));
    check("I17c … one audit row, revalidatePath(/admin/media), nothing removed", iceState.audits.length === 1 && iceState.audits[0].action === "ice.media.uploaded"
      && same(iceState.revalidated, ["path:/admin/media"]) && db.removed().length === 0);
  }
  {
    const path = uploadPath();
    const cases: [string, () => Response, string][] = [
      ["a GIF", ranged(GIF, 1000), "format"],
      ["an SVG", ranged(asBytes("<svg xmlns=\"x\"></svg>"), 1000), "format"],
      ["a 16 MiB PNG", ranged(PNG, 16 * MiB), "too_large"],
      ["a 51 MiB MP4", ranged(MP4, 51 * MiB), "too_large"],
      ["an unknown total size", ranged(PNG, null), "upload_missing"],
    ];
    for (const [what, resp, code] of cases) {
      const db = freshDb(); fakeFetch(resp);
      const r = await actions.registerUpload({ path, name: "x" });
      check(`I18 registerUpload: ${what} → the object is removed and refused (${code}), no row`,
        !r.ok && r.error === code && same(db.removed(), [[path]]) && !(db.tables.media_assets ?? []).length && iceState.audits.length === 0, JSON.stringify(r));
    }
    const db = freshDb(); fakeFetch(ranged(MP4, 40 * MiB));
    const v = await actions.registerUpload({ path, name: "clip.mp4" });
    check("I18b a 40 MiB MP4 is registered as a video", v.ok && db.tables.media_assets?.[0]?.mime === "video/mp4" && db.tables.media_assets?.[0]?.kind === "video");
    const db2 = freshDb(); fakeFetch(ranged(JPEG, 2048, 200));
    const j = await actions.registerUpload({ path, name: "x.jpg" });
    check("I18c a server that ignores Range (200 + content-length) still yields the real size", j.ok && db2.tables.media_assets?.[0]?.size_bytes === 2048);
    const db3 = freshDb(); fakeFetch(() => new Response("missing", { status: 404 }));
    const m = await actions.registerUpload({ path, name: "x" });
    check("I18d a missing object → upload_missing, no row", !m.ok && m.error === "upload_missing" && !(db3.tables.media_assets ?? []).length);
    const db5 = freshDb();
    fakeFetch(() => new Response(PNG.slice(0, 64), { status: 206, headers: { "content-range": "bytes 0-63/*", "content-length": "64" } }));
    const star = await actions.registerUpload({ path, name: "x.png" });
    check("I18f a 206 whose Content-Range hides the total (bytes 0-63/*) is not registered with the RANGE length as the file size",
      !(star.ok && db5.tables.media_assets?.[0]?.size_bytes === 64),
      star.ok ? `registered with size_bytes ${String(db5.tables.media_assets?.[0]?.size_bytes)} (the 64-byte range), so the 15/50 MiB cap was never applied` : `refused ${star.error}`);
    const db4 = freshDb(); db4.tables.media_assets = [{ id: IMG, storage_path: path }]; fakeFetch(ranged(PNG, 1000));
    const dup = await actions.registerUpload({ path, name: "x" });
    check("I18e an already registered path → already_registered, no fetch", !dup.ok && dup.error === "already_registered" && fetchCalls.length === 0);
  }

  // ── cmsSave ─────────────────────────────────────────────────────────────
  const cmsDb = () => {
    const db = freshDb(); withLibrary(db);
    db.tables.media_assets.push({ id: "22222222-0000-4000-8000-000000000001", kind: "image", mime: "image/png", size_bytes: 1000, storage_path: "lib/hero.png", external_url: null },
      { id: "22222222-0000-4000-8000-000000000002", kind: "video", mime: "video/mp4", size_bytes: 1000, storage_path: "lib/clip.mp4", external_url: null });
    db.rpcs.cms_inline_patch = () => ({ data: NOW_TS, error: null });
    return db;
  };
  const cms = (o: Partial<Parameters<typeof actions.cmsSave>[0]>) =>
    actions.cmsSave({ blockId: B_HERO, path: ["title"], locale: "pl", value: "Nowy tytuł", expected: "Stary tytuł", base: "2026-10-01T10:00:00.000Z", ...o });
  const CMS_REFUSALS: [string, Partial<Parameters<typeof actions.cmsSave>[0]>, string][] = [
    ["a path not in the block's fields (ctaUrl)", { path: ["ctaUrl"], value: "https://evil.example", expected: "https://example.com/x" }, "not_editable"],
    ["a path that includes the locale", { path: ["title", "pl"] }, "not_editable"],
    ["a block not in the published snapshot", { blockId: B_ORPHAN }, "not_in_snapshot"],
    ["a block of an unpublished page", { blockId: B_DRAFT, expected: "X" }, "not_published"],
    ["an unknown block", { blockId: "99999999-0000-4000-8000-000000000000" }, "block_missing"],
    ["a non-uuid block id", { blockId: "hero" }, "block_missing"],
    ["a bad path segment", { path: ["title;drop"] }, "bad_path"],
    ["text with markup", { value: "Nowy <script>x</script>" }, "text_markup"],
    ["text with an invisible char", { value: "Nowy\u2066tytuł" }, "text_invisible"],
    ["a newline in a one-line field", { value: "Nowy\ntytuł" }, "text_newline"],
    ["an empty text", { value: "  \t " }, "text_empty"],
    ["a text without a locale", { locale: null }, "locale"],
    ["a media URL that isn't a library asset", { path: ["mediaUrl"], locale: null, value: "https://evil.example/x.png", expected: HERO_URL }, "asset_missing"],
    ["a storage URL nobody registered", { path: ["mediaUrl"], locale: null, value: `${STORAGE_PUBLIC}/media/lib/unknown.png`, expected: HERO_URL }, "asset_missing"],
    ["a library VIDEO as a picture", { path: ["mediaUrl"], locale: null, value: `${STORAGE_PUBLIC}/media/lib/clip.mp4`, expected: HERO_URL }, "asset_kind"],
    ["a stale expected value", { expected: "Inny tytuł" }, "conflict"],
    ["an unknown action", { action: "publish" as "save" }, "bad_action"],
  ];
  for (const [what, input, code] of CMS_REFUSALS) {
    const db = cmsDb();
    const r = await cms(input);
    check(`I19 cmsSave refuses ${what} → ${code}, no RPC`, !r.ok && r.error === code && db.rpcCalls().length === 0 && iceState.audits.length === 0 && iceState.revalidated.length === 0, JSON.stringify(r).slice(0, 140));
  }
  {
    const db = cmsDb();
    const r = await cms({ expected: "Inny" });
    check("I19b a stale expected returns the value the page shows now", !r.ok && same(r.current, { value: "Stary tytuł" }));
    void db;
  }
  {
    const db = cmsDb();
    const r = await cms({ value: "  Nowy   tytuł " });
    const a = db.rpcCalls("cms_inline_patch")[0]?.args;
    check("I20 success: cms_inline_patch with p_path [...field.path, locale], the normalised value, expected, base, label, action",
      r.ok && same(a, { p_block_id: B_HERO, p_path: ["title", "pl"], p_value: "Nowy tytuł", p_expected: "Stary tytuł", p_label: "Edytor wizualny · title (pl)", p_base: "2026-10-01T10:00:00.000Z", p_action: "save" }), JSON.stringify(a));
    check("I20b … revalidates CMS_TAG plus exactly that page's path; one audit row",
      same(iceState.revalidated, [`tag:${CMS_TAG}`, "path:/oferta"]) && iceState.audits.length === 1 && iceState.audits[0].action === "ice.cms.saved");
  }
  {
    const db = cmsDb();
    const r = await cms({ path: ["title"], locale: "en", value: "New title", expected: "Old title" });
    const r2 = await cms({ path: ["subtitle"], locale: "de", value: "Untertitel", expected: null });
    const a = db.rpcCalls("cms_inline_patch");
    check("I20c another locale (incl. a not-yet-written one, expected null) patches [field, locale]",
      r.ok && r2.ok && same(a[0]?.args.p_path, ["title", "en"]) && same(a[1]?.args.p_path, ["subtitle", "de"]) && a[1]?.args.p_expected === null);
  }
  {
    const db = cmsDb();
    const r = await cms({ blockId: B_FAQ, path: ["items", "1", "description"], value: "Linia 1  \r\n\r\n\r\n  Linia 2 ", expected: "O2\n\nO2b" });
    const a = db.rpcCalls("cms_inline_patch")[0]?.args;
    check("I20d a multiline field: CRLF and extra blank lines normalised, paragraphs kept", r.ok && a?.p_value === "Linia 1\n\nLinia 2" && same(a?.p_path, ["items", "1", "description", "pl"]));
  }
  {
    const db = cmsDb();
    const url = `${STORAGE_PUBLIC}/media/lib/new%20picture.avif`;
    const r = await cms({ path: ["mediaUrl"], locale: null, value: url, expected: HERO_URL });
    const a = db.rpcCalls("cms_inline_patch")[0]?.args;
    check("I20e a library picture by its public URL: patched at [mediaUrl] (no locale)", r.ok && same(a?.p_path, ["mediaUrl"]) && a?.p_value === url && a?.p_label === "Edytor wizualny · mediaUrl", JSON.stringify(r));
  }
  {
    const db = cmsDb();
    db.tables.cms_pages[1].published_snapshot = [{ id: B_HOME, type: "text", content: { title: { pl: "Witaj" } } }];
    const r = await cms({ blockId: B_HOME, path: ["title"], value: "Cześć", expected: "Witaj" });
    check("I20f the homepage's block revalidates \"/\"", r.ok && same(iceState.revalidated, [`tag:${CMS_TAG}`, "path:/"]));
    void db;
  }
  {
    const db = cmsDb();
    db.rpcs.cms_inline_patch = () => ({ data: null, error: { message: "noop" } });
    const r = await cms({});
    const db2 = cmsDb();
    db2.rpcs.cms_inline_patch = () => ({ data: null, error: { message: "draft_diverged" } });
    const r2 = await cms({});
    check("I20g RPC noop → ok without audit/revalidate; draft_diverged → refused with that code",
      r.ok && iceState.audits.length === 0 && !r2.ok && r2.error === "draft_diverged");
    void db;
  }

  // ── setEdit / pageInfo / cmsMap / history ───────────────────────────────
  {
    freshDb();
    const r = await actions.setEdit(true, "/home");
    const nonce = r.ok ? (r.data as { nonce: string }).nonce : "";
    const edit = iceState.cookieWrites.find((w) => w.name.startsWith(ICE_EDIT_PREFIX));
    const hint = iceState.cookieWrites.find((w) => w.name === ICE_HINT_COOKIE);
    check("I21 setEdit(true, /home): a cookie named editCookieName(path) holding <nonce>~<path>",
      r.ok && /^[a-z0-9]{8}$/.test(nonce) && edit?.name === editCookieName("/home") && edit?.value === editCookieValue({ nonce, path: "/home" }));
    check("I21b … path-scoped, httpOnly, sameSite lax, a SESSION cookie (no maxAge, no expires)",
      edit?.opts.path === "/home" && edit?.opts.httpOnly === true && edit?.opts.sameSite === "lax" && edit?.opts.maxAge === undefined && edit?.opts.expires === undefined, JSON.stringify(edit?.opts));
    check("I21c … and the 30-day admin hint on /", hint?.opts.path === "/" && hint?.opts.maxAge === 60 * 60 * 24 * 30 && hint?.opts.httpOnly === true);
    freshDb();
    const off = await actions.setEdit(false, "/home/");
    const del = iceState.cookieWrites[0];
    check("I21d setEdit(false) deletes it (same name and path, maxAge 0), no hint", off.ok && same(off.data, { nonce: null }) && iceState.cookieWrites.length === 1
      && del.name === editCookieName("/home") && del.value === "" && del.opts.maxAge === 0 && del.opts.path === "/home");
    freshDb();
    const slash = await actions.setEdit(true, "/plany/");
    check("I21e a trailing slash is cleaned before the cookie is named and scoped", slash.ok && iceState.cookieWrites[0].name === editCookieName("/plany") && iceState.cookieWrites[0].opts.path === "/plany");
    const unsupported = ["/nope", "/tools/compress", "/retusz", "/tools/../admin", "home", "/szkic", "/aplikacja", "/start-strona", "/a b", "//evil.example"];
    const bad: string[] = [];
    for (const p of unsupported) {
      freshDb();
      const u = await actions.setEdit(true, p);
      if (u.ok || u.error !== "unsupported" || iceState.cookieWrites.length) bad.push(p);
    }
    check("I21f setEdit refuses unsupported paths (unknown, own-route tools, draft/app CMS pages, the homepage slug, malformed) → unsupported, no cookie", bad.length === 0, short(bad));
    freshDb();
    const c1 = await actions.setEdit(true, "/oferta");
    const c2Db = freshDb(); void c2Db;
    const c2 = await actions.setEdit(true, "/");
    check("I21g … and accepts a published CMS page and the CMS homepage at /", c1.ok && c2.ok && iceState.cookieWrites[0].opts.path === "/");
  }
  {
    freshDb();
    const h = await actions.pageInfo("/home");
    const d = h.ok ? h.data : null;
    check("I22 pageInfo(/home) → the registry page and its text keys", d?.kind === "registry" && d.page === HOME && same(d.textKeys, pageTextKeys(HOME)));
    const p = await actions.pageInfo("/plan");
    check("I22b pageInfo(/plan) → the /plany page", p.ok && p.data.kind === "registry" && p.data.page === PLANS);
    const c = await actions.pageInfo("/oferta");
    const cd = c.ok && c.data.kind === "cms" ? c.data.cms : null;
    const expectFields: IceCmsField[] = [...blockFields(heroBlock(), "2026-10-01T10:00:00.000Z"), ...blockFields(faqBlock(), "2026-10-01T10:00:01.000Z")];
    check("I22c pageInfo of a published CMS slug → its fields with each block's draft updated_at as the base",
      cd?.slug === "oferta" && cd.path === "/oferta" && cd.pageId === PAGE_ID && !cd.launch && same(cd.fields, expectFields));
    const home = await actions.pageInfo("/");
    check("I22d pageInfo(/) → the CMS homepage (launch)", home.ok && home.data.kind === "cms" && home.data.cms.launch && home.data.cms.path === "/");
    const bad = await Promise.all(["/szkic", "/aplikacja", "/start-strona", "/nope", "x"].map((p2) => actions.pageInfo(p2)));
    check("I22e pageInfo refuses draft, app, the homepage's own slug, unknown and malformed paths", bad.every((r) => !r.ok && r.error === "unsupported"));
    const m = await actions.cmsMap("/home");
    check("I22f cmsMap of a registry page → unsupported", !m.ok && m.error === "unsupported");
  }
  {
    const db = freshDb();
    db.tables.content_versions = [{ id: "v1", target: "text", key: "sellerHome.ba.title", action: "save", locale: "pl", before: null, after: { value: "x" }, created_at: NOW_TS, created_by: ADMIN }];
    const hs = await Promise.all([
      actions.history({ target: "text", key: "sellerHome.nope" }),
      actions.history({ target: "text", key: "credits.balance" }),
      actions.history({ target: "slot", key: "homeMedia.nope" }),
      actions.history({ target: "cms", key: "bad" }),
      actions.history({ target: "evil" as "text", key: "sellerHome.ba.title" }),
    ]);
    check("I23 history refuses unregistered keys (text → unknown_key, slot → unknown_slot, cms/other → unknown_key)",
      same(hs.map((r) => (r.ok ? "ok" : r.error)), ["unknown_key", "unknown_key", "unknown_slot", "unknown_key", "unknown_key"]) && !db.tablesTouched().includes("content_versions"));
    const ok = await actions.history({ target: "text", key: "sellerHome.ba.title", limit: 1000 });
    const q = db.calls.find((c) => c.kind === "from" && c.table === "content_versions");
    check("I23b history of a registered key reads content_versions (limit capped at 50) with the author's name",
      ok.ok && ok.data.length === 1 && ok.data[0].author === "Ada Admin" && q?.kind === "from" && q.ops.includes("limit(50)"));
  }
}

/* ══ J. BOUNDARIES ═════════════════════════════════════════════════════════ */

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? filesUnder(p) : /\.(ts|tsx|js|mjs)$/.test(n) ? [p] : [];
  });
}

/** The module specifiers a file imports (static, dynamic, re-export), as repo paths. */
function importsOf(file: string): { spec: string; resolved: string; typeOnly: boolean }[] {
  const src = readFileSync(file, "utf8");
  const out: { spec: string; resolved: string; typeOnly: boolean }[] = [];
  const re = /\b(import|export)\s+(type\s+)?(?:[^;"'`]*?\sfrom\s*)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|\brequire\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of src.matchAll(re)) {
    const spec = m[3] ?? m[4] ?? m[5];
    if (!spec) continue;
    let resolved = spec;
    if (spec.startsWith("@/")) resolved = spec.slice(2);
    else if (spec.startsWith(".")) resolved = relative(process.cwd(), resolve(dirname(file), spec));
    out.push({ spec, resolved: resolved.replace(/\.(ts|tsx|js)$/, "").replace(/\/index$/, ""), typeOnly: Boolean(m[2]) });
  }
  return out;
}

function sectionJ() {
  console.log("\nJ. BOUNDARIES — the use-server file, server-only, what the client imports");
  const src = readFileSync("app/actions/ice.ts", "utf8");
  check("J1 app/actions/ice.ts starts with \"use server\"", /^\s*["']use server["'];?\s*\n/.test(src));
  const keyLit = /["'`](sellerHome|pricing|tools|homeMedia|hub|photoTool)\./.exec(src);
  check("J2 … holds no string literal that looks like an i18n or slot key", !keyLit, keyLit?.[0]);
  const exportLines = [...src.matchAll(/^export\s+(.+)$/gm)].map((m) => m[1]);
  check(`J3 … every export statement is \`export async function\` (${exportLines.length})`, exportLines.length > 0 && exportLines.every((l) => /^async function \w+\(/.test(l)));
  const bodies: string[] = [];
  const bad: string[] = [];
  for (const m of src.matchAll(/export async function (\w+)\(/g)) {
    let i = (m.index ?? 0) + m[0].length; let depth = 1;
    const paramsStart = i;
    while (i < src.length && depth) { if (src[i] === "(") depth++; else if (src[i] === ")") depth--; i++; }
    const params = src.slice(paramsStart, i - 1);
    const open = src.indexOf("{", i);
    let j = open + 1; depth = 1;
    while (j < src.length && depth) { if (src[j] === "{") depth++; else if (src[j] === "}") depth--; j++; }
    const body = src.slice(open + 1, j - 1).trim();
    bodies.push(body);
    const call = /^return ice\.(\w+)\(([^()]*)\);?$/.exec(body);
    const paramNames = [...params.matchAll(/(?:^|,)\s*(\w+)\s*:/g)].map((p) => p[1]);
    const args = call ? call[2].split(",").map((s) => s.trim()).filter(Boolean) : null;
    if (!call || !(call[1] in actions) || !args || !same(args, paramNames)) bad.push(m[1]);
  }
  check(`J3b … each body is exactly \`return ice.<fn>(<its params>)\` (${bodies.length} wrappers)`, bad.length === 0 && bodies.length === exportLines.length, short(bad));
  const notAsync = Object.entries(wrappers).filter(([, v]) => typeof v !== "function" || v.constructor.name !== "AsyncFunction").map(([k]) => k);
  check("J3c … and at runtime every export is an AsyncFunction", notAsync.length === 0, short(notAsync));

  const serverFiles = filesUnder("lib/server/ice");
  const noGuard = serverFiles.filter((f) => !/^\s*import\s+["']server-only["'];?/m.test(readFileSync(f, "utf8")));
  check(`J4 every file in lib/server/ice imports "server-only" (${serverFiles.length} files)`, noGuard.length === 0 && serverFiles.length >= 7, short(noGuard));

  const launcher = importsOf("components/ice/launcher.tsx");
  const launcherBad = launcher.filter((x) => x.resolved === "lib/ice/registry" || x.resolved.startsWith("lib/server/") || x.spec === "server-only");
  check("J5 components/ice/launcher.tsx imports neither lib/ice/registry nor lib/server/**", launcher.length > 0 && launcherBad.length === 0, short(launcherBad.map((x) => x.spec)));
  const iceFiles = filesUnder("components/ice");
  const regImports = iceFiles.flatMap((f) => importsOf(f).filter((x) => x.resolved === "lib/ice/registry").map((x) => `${f}${x.typeOnly ? " (type)" : ""}`));
  check(`J6 no file under components/ice imports lib/ice/registry (${iceFiles.length} files scanned)`, regImports.length === 0 && iceFiles.length > 3, short(regImports));
  const clientServer = iceFiles.filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")))
    .flatMap((f) => importsOf(f).filter((x) => !x.typeOnly && (x.resolved.startsWith("lib/server/") || x.spec === "server-only")).map((x) => `${f} → ${x.spec}`));
  check("J6b no \"use client\" file under components/ice imports lib/server/** or server-only", clientServer.length === 0, short(clientServer));
  const directActions = iceFiles.flatMap((f) => importsOf(f).filter((x) => x.resolved === "lib/server/ice/actions").map(() => f));
  check("J6c the editor reaches the server only through app/actions/ice (never lib/server/ice/actions directly)", directActions.length === 0, short(directActions));
}

/* ══ main ══════════════════════════════════════════════════════════════════ */

async function main() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("network disabled in the ice suite"); }) as typeof fetch;
  await sectionA();
  sectionB();
  sectionC();
  sectionD();
  sectionE();
  await sectionF();
  await sectionG();
  await sectionH();
  await sectionI();
  sectionJ();
  check("Z the shipped dictionaries were never mutated by anything in this run", LOCALES.every((l, i) => JSON.stringify(DICTS[l]) === SHIPPED_JSON[i]));
  globalThis.fetch = realFetch;
  if (notes.length) console.log(`\nNotes:\n${notes.map((n) => `  · ${n}`).join("\n")}`);
  if (failures) console.log(`\nFailed:\n${failedNames.map((n) => `  ✗ ${n}`).join("\n")}`);
  console.log(`\n${failures === 0 ? `All inline-editor tests passed (${passed} checks).` : `${failures} INLINE-EDITOR TEST(S) FAILED (${passed} passed).`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { loud(); console.error(e); process.exit(1); });
