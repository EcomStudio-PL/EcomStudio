/**
 * THE SIGNED-IN START (/home) — ITS LAYOUT, AS DATA.
 *
 * What an admin arranges in „Edytuj stronę”: the order and visibility of the
 * page's sections, and the items of its lists — the tool carousel, the
 * before/after pairs, the Moda tools, the upload tile's pills and the photo
 * grids (Miniaturki, Sesje produktowe, the showcase's results).
 *
 * ONE DOCUMENT, stored in public.home_layout (0170) and written only through
 * home_layout_write() — with a version in public.content_versions (target
 * "layout"), the editor's one history. NO ROW = defaultHomeLayout(): the page
 * exactly as lib/seller-home-config.ts drew it before this existed, item for
 * item, slot for slot, text key for text key.
 *
 * WHAT IS NOT IN IT. Pictures stay media_slots rows (an item names its slot
 * by number; a grid tile's product photo is `<slot>.ref`), texts the page
 * already had stay i18n keys with their content_overrides, availability stays
 * the switchboard's (a tool hidden there hides every item bound to it — see
 * lib/server/seller-home.ts). Only what an admin added is text here: an
 * item's own name, line and link override.
 *
 * Pure and client-safe: the server reads and validates it, the editor edits it
 * with the same functions, the tests hold both.
 */
import {
  BEFORE_AFTER, BEFORE_AFTER_SIZE, CAROUSEL, FEATURED, INDUSTRIES, SESSIONS, SHOWCASE, THUMBNAILS, THUMBNAIL_SQUARE, UPLOAD_TOOLS,
  type Industry, type MediaPair, type MediaSrc, type UploadToolKey,
} from "@/lib/seller-home-config";
import { CATALOG_ITEMS } from "@/lib/tool-cards";
import { CATEGORIES } from "@/lib/categories";

/* ── sections ─────────────────────────────────────────────────────────────── */

/** Every section of /home, in the order the page has always drawn them. */
export const HOME_SECTION_IDS = [
  "carousel", "upload", "beforeAfter", "campaign", "promo1", "showcase", "promo2",
  "thumbnails", "sessions", "featured", "promo3", "soon",
] as const;
export type HomeSectionId = (typeof HOME_SECTION_IDS)[number];
export const isHomeSectionId = (v: unknown): v is HomeSectionId =>
  typeof v === "string" && (HOME_SECTION_IDS as readonly string[]).includes(v);

/** Sections whose button opens a tool — the tool can be changed ("link przycisku"). */
export const SECTION_TOOL: Readonly<Partial<Record<HomeSectionId, string>>> = {
  promo1: "generator", promo2: "custom", promo3: "ecommerce.set",
  showcase: SHOWCASE.item, thumbnails: THUMBNAILS.item,
};

/* ── lists ────────────────────────────────────────────────────────────────── */

export type HomeLocale = "pl" | "en" | "de";
export const HOME_LOCALES: readonly HomeLocale[] = ["pl", "en", "de"];
/** An admin's own text, per language; a language not written falls back. */
export type HomeText = Partial<Record<HomeLocale, string>>;

type Entry = { id: string; hidden?: boolean };
/** A tool tile (carousel, Moda tools). `from` = the config tile it began as:
 *  its i18n keys and its picture's config key. */
export type HomeToolEntry = Entry & { item: string; name?: HomeText; sub?: HomeText; href?: string; from?: string };
/** A before/after pair: slots `homeMedia.beforeAfter.<n>.before/.after`. */
export type HomePairEntry = Entry & { item: string; industry: Industry; n: number; name?: HomeText; from?: string };
/** A photo of a grid: slot `<prefix>.<n>`, its product photo `<prefix>.<n>.ref`. */
export type HomeTileEntry = Entry & { n: number };
/** A pill of the upload tile — one of the tools it can hand a photo to. */
export type HomePillEntry = Entry & { id: UploadToolKey };
export type HomeSectionEntry = { id: HomeSectionId; hidden?: boolean; item?: string };

export const TOOL_LISTS = ["carousel", "featured"] as const;
export type ToolListKey = (typeof TOOL_LISTS)[number];
export const GRID_LISTS = ["thumbnails", "sessions", "showcase"] as const;
export type GridListKey = (typeof GRID_LISTS)[number];
export type HomeListKey = ToolListKey | GridListKey | "beforeAfter" | "pills";
export const HOME_LISTS: readonly HomeListKey[] = ["carousel", "beforeAfter", "pills", "thumbnails", "sessions", "showcase", "featured"];

/** The section each list is drawn in. */
export const LIST_SECTION: Readonly<Record<HomeListKey, HomeSectionId>> = {
  carousel: "carousel", featured: "featured", beforeAfter: "beforeAfter", pills: "upload",
  thumbnails: "thumbnails", sessions: "sessions", showcase: "showcase",
};

export type HomeLayout = {
  v: 1;
  sections: HomeSectionEntry[];
  carousel: HomeToolEntry[];
  featured: HomeToolEntry[];
  beforeAfter: HomePairEntry[];
  pills: HomePillEntry[];
  thumbnails: HomeTileEntry[];
  sessions: HomeTileEntry[];
  showcase: HomeTileEntry[];
  /** The last slot number handed out per numbered list — never reused, so a
   *  new item never inherits a removed one's picture. */
  seq: { beforeAfter: number; thumbnails: number; sessions: number; showcase: number };
};

/** How many items a list may hold, and the highest slot number it may use. */
export const LIST_LIMITS: Readonly<Record<HomeListKey, number>> = {
  carousel: 30, featured: 12, beforeAfter: 30, pills: UPLOAD_TOOLS.length, thumbnails: 60, sessions: 60, showcase: 60,
};
export const SLOT_MAX: Readonly<Record<"beforeAfter" | GridListKey, number>> = {
  beforeAfter: 60, thumbnails: 120, sessions: 120, showcase: 120,
};

/** The slot keys of numbered items — one rule for the page, the editor and the server. */
export const GRID_PREFIX: Readonly<Record<GridListKey, string>> = {
  thumbnails: "homeMedia.thumbnails", sessions: "homeMedia.sessions", showcase: "homeMedia.showcase.gallery",
};
export const gridSlotKey = (list: GridListKey, n: number) => `${GRID_PREFIX[list]}.${n}`;
export const refSlotKey = (slot: string) => `${slot}.ref`;
export const pairSlotKeys = (n: number) => [`homeMedia.beforeAfter.${n}.before`, `homeMedia.beforeAfter.${n}.after`] as const;

/** The frame of a grid's n-th photo: Miniaturki square, Sesje in the session
 *  rhythm (repeating past the 16 it was drawn for), the showcase 4:3 — the
 *  same sizes the config gives its own tiles, so a new tile looks like one. */
export function gridMedia(k: GridListKey, n: number): MediaSrc {
  const key = gridSlotKey(k, n);
  const size = k === "thumbnails" ? THUMBNAIL_SQUARE
    : k === "sessions" ? SESSIONS.tiles[(n - 1) % SESSIONS.tiles.length].media
      : SHOWCASE.gallery[(n - 1) % SHOWCASE.gallery.length];
  return { configKey: key, kind: "image", src: null, width: size.width, height: size.height };
}
/** The product photo of a grid tile: the same frame as the tile it explains. */
export function refMedia(k: GridListKey, n: number): MediaSrc {
  const m = gridMedia(k, n);
  return { ...m, configKey: refSlotKey(m.configKey) };
}
/** The n-th before/after pair's two halves (1:1, like every pair). */
export function pairMedia(n: number): MediaPair {
  const [before, after] = pairSlotKeys(n);
  const half = (configKey: string): MediaSrc => ({ configKey, kind: "image", src: null, ...BEFORE_AFTER_SIZE });
  return { before: half(before), after: half(after) };
}

/**
 * A /home section slot of a numbered family — what the editor may write
 * beyond the registry's fixed list: a pair's half up to SLOT_MAX, a grid photo
 * and its `.ref`. Anything else → null.
 */
export function familySlot(key: string): { list: "beforeAfter" | GridListKey; n: number; ref: boolean; media: MediaSrc } | null {
  let m = /^homeMedia\.beforeAfter\.(\d{1,3})\.(before|after)$/.exec(key);
  if (m) {
    const n = Number(m[1]);
    if (n < 1 || n > SLOT_MAX.beforeAfter) return null;
    const pair = pairMedia(n);
    return { list: "beforeAfter", n, ref: false, media: m[2] === "before" ? pair.before : pair.after };
  }
  m = /^homeMedia\.(thumbnails|sessions|showcase\.gallery)\.(\d{1,3})(\.ref)?$/.exec(key);
  if (!m) return null;
  const list: GridListKey = m[1] === "showcase.gallery" ? "showcase" : m[1] as GridListKey;
  const n = Number(m[2]);
  if (n < 1 || n > SLOT_MAX[list]) return null;
  return { list, n, ref: Boolean(m[3]), media: m[3] ? refMedia(list, n) : gridMedia(list, n) };
}

/** Text limits of an admin's own item text (the i18n texts keep theirs). */
export const NAME_MAX = 80;
export const SUB_MAX = 200;

/* ── the default: the page as it has always been ──────────────────────────── */

const nameOf = (key: string, prefix: string) => key.slice(prefix.length).split(".")[0];

export function defaultHomeLayout(): HomeLayout {
  return {
    v: 1,
    sections: HOME_SECTION_IDS.map((id) => ({ id })),
    carousel: CAROUSEL.map((c) => {
      const from = nameOf(c.nameKey, "sellerHome.tool.");
      return { id: `c-${from}`, item: c.item, from };
    }),
    featured: FEATURED.map((f) => {
      const from = nameOf(f.nameKey, "sellerHome.featured.");
      return { id: `f-${from}`, item: f.item, from };
    }),
    beforeAfter: BEFORE_AFTER.map((b, i) => ({
      id: `ba-${i + 1}`, item: b.item, industry: b.industry, n: i + 1, from: nameOf(b.nameKey, "sellerHome.tool."),
    })),
    pills: UPLOAD_TOOLS.map((u) => ({ id: u.key })),
    thumbnails: THUMBNAILS.tiles.map((_, i) => ({ id: `t-${i + 1}`, n: i + 1 })),
    sessions: SESSIONS.tiles.map((_, i) => ({ id: `s-${i + 1}`, n: i + 1 })),
    showcase: SHOWCASE.gallery.map((_, i) => ({ id: `g-${i + 1}`, n: i + 1 })),
    seq: { beforeAfter: BEFORE_AFTER.length, thumbnails: THUMBNAILS.tiles.length, sessions: SESSIONS.tiles.length, showcase: SHOWCASE.gallery.length },
  };
}

/* ── validation: what is stored is always this shape ──────────────────────── */

const ITEM_KEYS = new Set<string>([
  ...CATALOG_ITEMS.map((i) => i.key),
  ...CATEGORIES.map((c) => `cat:${c.key}`),
]);
/** A tool an item may be bound to: a catalogue item or `cat:<category>`. */
export const isHomeItemKey = (v: unknown): v is string => typeof v === "string" && ITEM_KEYS.has(v);

/** An item's id: the defaults are "c-<config key>" (camelCase: "c-aiBackground"), new ones "c" + random. */
const ID = /^[a-zA-Z][a-zA-Z0-9-]{0,39}$/;
const FROM = /^[a-zA-Z][a-zA-Z0-9]{0,39}$/;
/** An internal address only: one path, no scheme, no host, no "//". */
const HREF = /^\/(?!\/)[a-zA-Z0-9/_\-.?=&%#]{0,199}$/;
/** What an admin's text may not hold: markup, controls, invisible marks. */
// eslint-disable-next-line no-control-regex
const BAD_TEXT = /[<>\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/;

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null);

export function cleanText(v: unknown, max: number): HomeText | undefined {
  const o = obj(v);
  if (!o) return undefined;
  const out: HomeText = {};
  for (const l of HOME_LOCALES) {
    const s = typeof o[l] === "string" ? (o[l] as string).replace(/\s+/g, " ").trim() : "";
    if (s && s.length <= max && !BAD_TEXT.test(s)) out[l] = s;
  }
  return Object.keys(out).length ? out : undefined;
}

export const cleanHref = (v: unknown): string | undefined =>
  typeof v === "string" && HREF.test(v.trim()) && !v.includes("..") ? v.trim() : undefined;

function base(o: Record<string, unknown>, ids: Set<string>): Entry | null {
  const id = typeof o.id === "string" && ID.test(o.id) ? o.id : null;
  if (!id || ids.has(id)) return null;
  ids.add(id);
  return { id, ...(o.hidden === true ? { hidden: true } : {}) };
}

function list<T>(raw: unknown, max: number, one: (o: Record<string, unknown>, ids: Set<string>) => T | null): T[] {
  const out: T[] = [];
  const ids = new Set<string>();
  for (const x of Array.isArray(raw) ? raw : []) {
    const o = obj(x);
    const e = o ? one(o, ids) : null;
    if (e) out.push(e);
    if (out.length >= max) break;
  }
  return out;
}

function toolEntry(o: Record<string, unknown>, ids: Set<string>): HomeToolEntry | null {
  const b = base(o, ids);
  if (!b || !isHomeItemKey(o.item)) return null;
  const name = cleanText(o.name, NAME_MAX);
  const sub = cleanText(o.sub, SUB_MAX);
  const href = cleanHref(o.href);
  const from = typeof o.from === "string" && FROM.test(o.from) ? o.from : undefined;
  return { ...b, item: o.item, ...(name ? { name } : {}), ...(sub ? { sub } : {}), ...(href ? { href } : {}), ...(from ? { from } : {}) };
}

/** A tool list: each tool once (its tile is the tool's own card picture — a
 *  second tile of the same tool would only repeat it). */
function toolList(raw: unknown, max: number): HomeToolEntry[] {
  const items = new Set<string>();
  return list(raw, max, (o, ids) => {
    const e = toolEntry(o, ids);
    if (!e || items.has(e.item)) return null;
    items.add(e.item);
    return e;
  });
}

function numbered(o: Record<string, unknown>, max: number, used: Set<number>): number | null {
  const n = typeof o.n === "number" && Number.isInteger(o.n) && o.n >= 1 && o.n <= max ? o.n : null;
  if (n === null || used.has(n)) return null;
  used.add(n);
  return n;
}

/**
 * Anything read from the database or sent by the editor → a valid layout.
 * Unknown sections are dropped and missing ones put back where the default
 * has them (a section added to the code appears); unknown fields, bad ids,
 * tools that do not exist, duplicate slots and over-long or unsafe text are
 * dropped item by item. A list that was stored stays as stored — an item the
 * admin removed does not come back. `null`/garbage → the default.
 */
export function normalizeHomeLayout(raw: unknown): HomeLayout {
  const d = defaultHomeLayout();
  const o = obj(raw);
  if (!o || o.v !== 1) return d;

  // Sections: the stored order, then any section the code has and it lacks,
  // inserted after its default predecessor.
  const seen = new Set<string>();
  const sections: HomeSectionEntry[] = [];
  for (const x of Array.isArray(o.sections) ? o.sections : []) {
    const s = obj(x);
    if (!s || !isHomeSectionId(s.id) || seen.has(s.id)) continue;
    seen.add(s.id);
    sections.push({ id: s.id, ...(s.hidden === true ? { hidden: true } : {}), ...(SECTION_TOOL[s.id] && isHomeItemKey(s.item) ? { item: s.item as string } : {}) });
  }
  HOME_SECTION_IDS.forEach((id, i) => {
    if (seen.has(id)) return;
    const prev = HOME_SECTION_IDS.slice(0, i).reverse().find((p) => seen.has(p));
    const at = prev ? sections.findIndex((s) => s.id === prev) + 1 : 0;
    sections.splice(at, 0, { id });
    seen.add(id);
  });

  const has = (k: HomeListKey) => Array.isArray(o[k]);
  const pick = <T,>(k: HomeListKey, fallback: T[], parse: () => T[]): T[] => (has(k) ? parse() : fallback);

  const usedBa = new Set<number>();
  const beforeAfter = pick("beforeAfter", d.beforeAfter, () => list(o.beforeAfter, LIST_LIMITS.beforeAfter, (e, ids) => {
    const b = base(e, ids);
    if (!b || !isHomeItemKey(e.item)) return null;
    const n = numbered(e, SLOT_MAX.beforeAfter, usedBa);
    if (n === null) return null;
    const industry = (INDUSTRIES as readonly string[]).includes(e.industry as string) ? e.industry as Industry : "home_garden";
    const name = cleanText(e.name, NAME_MAX);
    const from = typeof e.from === "string" && FROM.test(e.from) ? e.from : undefined;
    return { ...b, item: e.item, industry, n, ...(name ? { name } : {}), ...(from ? { from } : {}) };
  }));
  const grid = (k: GridListKey) => {
    const used = new Set<number>();
    return pick(k, d[k], () => list(o[k], LIST_LIMITS[k], (e, ids) => {
      const b = base(e, ids);
      const n = b ? numbered(e, SLOT_MAX[k], used) : null;
      return b && n !== null ? { ...b, n } : null;
    }));
  };
  const pillIds = new Set(UPLOAD_TOOLS.map((u) => u.key));
  const pills = pick("pills", d.pills, () => list(o.pills, LIST_LIMITS.pills, (e, ids) => {
    if (typeof e.id !== "string" || !pillIds.has(e.id as UploadToolKey) || ids.has(e.id)) return null;
    ids.add(e.id);
    return { id: e.id as UploadToolKey, ...(e.hidden === true ? { hidden: true } : {}) };
  }));

  const layout: HomeLayout = {
    v: 1,
    sections,
    carousel: pick("carousel", d.carousel, () => toolList(o.carousel, LIST_LIMITS.carousel)),
    featured: pick("featured", d.featured, () => toolList(o.featured, LIST_LIMITS.featured)),
    beforeAfter,
    pills,
    thumbnails: grid("thumbnails"),
    sessions: grid("sessions"),
    showcase: grid("showcase"),
    seq: { ...d.seq },
  };
  // The counters never go back, and never below a number in use.
  const seq = obj(o.seq) ?? {};
  for (const k of ["beforeAfter", "thumbnails", "sessions", "showcase"] as const) {
    const stored = typeof seq[k] === "number" && Number.isInteger(seq[k]) ? Math.min(seq[k] as number, SLOT_MAX[k]) : 0;
    const inUse = Math.max(0, ...layout[k].map((e) => e.n));
    layout.seq[k] = Math.max(d.seq[k], stored, inUse);
  }
  return layout;
}

/**
 * A save never lowers a slot counter below what was stored before it — not
 * even a restore of an older version — so a number a removed photo had is
 * never handed to a new one (its pictures stay its own, and come back with an
 * undo). The server applies this to every write.
 */
export function keepCounters(next: HomeLayout, prev: HomeLayout): HomeLayout {
  const seq = { ...next.seq };
  for (const k of ["beforeAfter", "thumbnails", "sessions", "showcase"] as const) seq[k] = Math.min(SLOT_MAX[k], Math.max(next.seq[k], prev.seq[k]));
  return { ...next, seq };
}

/* ── edits: the editor's operations, pure ─────────────────────────────────── */

const newId = (prefix: string, taken: (id: string) => boolean): string => {
  for (let i = 0; i < 50; i++) {
    const id = `${prefix}${Math.random().toString(36).slice(2, 8)}`;
    if (ID.test(id) && !taken(id)) return id;
  }
  return `${prefix}${Date.now().toString(36)}`;
};
const clone = (l: HomeLayout): HomeLayout => JSON.parse(JSON.stringify(l)) as HomeLayout;

export type ListEntry = HomeToolEntry | HomePairEntry | HomeTileEntry | HomePillEntry;
export const entriesOf = (l: HomeLayout, k: HomeListKey): ListEntry[] => l[k] as ListEntry[];

export function setSectionHidden(l: HomeLayout, id: HomeSectionId, hidden: boolean): HomeLayout {
  const next = clone(l);
  next.sections = next.sections.map((s) => {
    if (s.id !== id) return s;
    const { hidden: _h, ...rest } = s;
    return hidden ? { ...rest, hidden: true } : rest;
  });
  return next;
}

export function setSectionItem(l: HomeLayout, id: HomeSectionId, item: string | null): HomeLayout {
  const next = clone(l);
  next.sections = next.sections.map((s) => {
    if (s.id !== id) return s;
    const { item: _i, ...rest } = s;
    return item && SECTION_TOOL[id] && isHomeItemKey(item) && item !== SECTION_TOOL[id] ? { ...rest, item } : rest;
  });
  return next;
}

/** Move a section (or an item) by `delta` places; out of range = unchanged. */
function moved<T>(arr: T[], from: number, to: number): T[] {
  if (from < 0 || from >= arr.length || to < 0 || to >= arr.length || from === to) return arr;
  const out = arr.slice();
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

export function moveSection(l: HomeLayout, id: HomeSectionId, to: number): HomeLayout {
  const next = clone(l);
  next.sections = moved(next.sections, next.sections.findIndex((s) => s.id === id), to);
  return next;
}

export function moveEntry(l: HomeLayout, k: HomeListKey, id: string, to: number): HomeLayout {
  const next = clone(l);
  const arr = entriesOf(next, k);
  (next[k] as ListEntry[]) = moved(arr, arr.findIndex((e) => e.id === id), to);
  return next;
}

export function setEntryHidden(l: HomeLayout, k: HomeListKey, id: string, hidden: boolean): HomeLayout {
  const next = clone(l);
  (next[k] as ListEntry[]) = entriesOf(next, k).map((e) => {
    if (e.id !== id) return e;
    const { hidden: _h, ...rest } = e;
    return hidden ? { ...rest, hidden: true } : rest;
  });
  return next;
}

export function removeEntry(l: HomeLayout, k: HomeListKey, id: string): HomeLayout {
  const next = clone(l);
  (next[k] as ListEntry[]) = entriesOf(next, k).filter((e) => e.id !== id);
  return next;
}

/** Replace one entry with an edited copy (same id); validated by the caller's normalize. */
export function updateEntry(l: HomeLayout, k: HomeListKey, entry: ListEntry): HomeLayout {
  const next = clone(l);
  (next[k] as ListEntry[]) = entriesOf(next, k).map((e) => (e.id === entry.id ? entry : e));
  return next;
}

export type AddResult = { layout: HomeLayout; id: string } | { error: "limit" | "slots" | "exists" };

/** A new item at the end of a list. Numbered lists take the next slot number. */
export function addEntry(l: HomeLayout, k: HomeListKey, init: { item?: string; pill?: UploadToolKey } = {}): AddResult {
  const next = clone(l);
  const arr = entriesOf(next, k);
  if (arr.length >= LIST_LIMITS[k]) return { error: "limit" };
  const taken = (id: string) => arr.some((e) => e.id === id);
  if (k === "pills") {
    const pill = init.pill ?? UPLOAD_TOOLS.find((u) => !arr.some((e) => e.id === u.key))?.key;
    if (!pill || taken(pill)) return { error: "exists" };
    next.pills.push({ id: pill });
    return { layout: next, id: pill };
  }
  if (k === "carousel" || k === "featured") {
    const inList = new Set(next[k].map((e) => e.item));
    const item = init.item && isHomeItemKey(init.item) ? init.item
      : [...ITEM_KEYS].find((x) => !x.startsWith("cat:") && !inList.has(x));
    if (!item) return { error: "exists" };
    if (inList.has(item)) return { error: "exists" };
    const id = newId(k === "carousel" ? "c" : "f", taken);
    next[k].push({ id, item });
    return { layout: next, id };
  }
  const max = SLOT_MAX[k];
  const n = next.seq[k] + 1;
  if (n > max) return { error: "slots" };
  next.seq[k] = n;
  if (k === "beforeAfter") {
    const item = init.item && isHomeItemKey(init.item) ? init.item : "generator";
    const id = newId("p", taken);
    next.beforeAfter.push({ id, item, industry: "home_garden", n });
    return { layout: next, id };
  }
  const id = newId(k === "thumbnails" ? "t" : k === "sessions" ? "s" : "g", taken);
  next[k].push({ id, n });
  return { layout: next, id };
}

/* ── reading it for the page ───────────────────────────────────────────────── */

/** The admin's own text in THIS language, else none — the tool's own
 *  (translated) name or line is used, never another language's override. */
export function ownText(t: HomeText | undefined, locale: string): string | null {
  return t?.[locale as HomeLocale] ?? null;
}

/** Every tool the layout binds anything to (the page reads their states). */
export function layoutItems(l: HomeLayout): string[] {
  const keys = new Set<string>();
  l.carousel.forEach((e) => keys.add(e.item));
  l.featured.forEach((e) => keys.add(e.item));
  l.beforeAfter.forEach((e) => keys.add(e.item));
  l.sections.forEach((s) => { if (s.item) keys.add(s.item); });
  return [...keys];
}

/** Every /home section slot the layout paints, with the grids' product photos. */
export function layoutSlotKeys(l: HomeLayout): string[] {
  const keys: string[] = [];
  l.beforeAfter.forEach((e) => keys.push(...pairSlotKeys(e.n)));
  for (const k of GRID_LISTS) l[k].forEach((e) => { const s = gridSlotKey(k, e.n); keys.push(s, refSlotKey(s)); });
  return keys;
}

/** The tool a section's button opens: the admin's choice, else the default. */
export function sectionItem(l: HomeLayout, id: HomeSectionId): string | null {
  return l.sections.find((s) => s.id === id)?.item ?? SECTION_TOOL[id] ?? null;
}

/**
 * THE ONE VISIBILITY RULE. An element shows to a customer only when its
 * section shows, it is not hidden itself, and — when bound to a tool — the
 * tool is offered to this viewer (`toolShown`, the switchboard's answer).
 * An element bound to no tool is never hidden by a tool.
 */
export function elementVisible(input: { sectionHidden: boolean; hidden?: boolean; tool?: string | null; toolShown: (tool: string) => boolean }): boolean {
  if (input.sectionHidden || input.hidden) return false;
  return input.tool ? input.toolShown(input.tool) : true;
}

/** A stable fingerprint of a layout (what the editor compares before saving). */
export function layoutKey(l: HomeLayout): string {
  return JSON.stringify(l);
}
