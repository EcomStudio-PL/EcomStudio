import "server-only";
import { headers } from "next/headers";
import { CMS_FIELDS, CMS_MULTILINE, LAUNCH_TEXT_FIELDS } from "@/lib/ice/registry";
import { stegaMark, stegaStrip } from "@/lib/ice/stega";
import { isLegalSlug } from "@/lib/legal/docs";
import type { IceCmsField, IceLocale } from "@/lib/ice/types";
import { iceEditSessions } from "./session";

/**
 * THE VISUAL EDITOR ON A PUBLIC CMS PAGE.
 *
 * A CMS page's copy lives in its published snapshot, so that is where it is
 * marked: after the cached read (the cache entry stays clean), on a per-request
 * copy, and only for an admin whose edit session names this very page. Every
 * editable field of a block gets a number — the same enumeration here and in
 * the editor's field map, so a marker and the field it names cannot drift.
 *
 * Which fields: CMS_FIELDS in the registry, per block type, plus the launch
 * page's copy. Never links, styles, code, forms, prices or live data.
 */

export type CmsBlockLike = { id?: string; type: string; content: unknown; visible?: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

type Bag = Record<string, unknown>;
const isBag = (v: unknown): v is Bag => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** The value at `path` inside a block's content. */
export function valueAt(content: unknown, path: readonly string[]): unknown {
  let cur: unknown = content;
  for (const seg of path) {
    if (Array.isArray(cur)) {
      const i = Number(seg);
      if (!Number.isInteger(i) || i < 0 || i >= cur.length) return undefined;
      cur = cur[i];
    } else if (isBag(cur)) {
      cur = Object.hasOwn(cur, seg) ? cur[seg] : undefined;
    } else {
      return undefined;
    }
  }
  return cur;
}

/** "items.*.title" → every item's title path. */
function expand(spec: string, content: unknown): string[][] {
  const parts = spec.split(".");
  const star = parts.indexOf("*");
  if (star < 0) return [parts];
  const list = valueAt(content, parts.slice(0, star));
  if (!Array.isArray(list)) return [];
  return list.map((_, i) => [...parts.slice(0, star), String(i), ...parts.slice(star + 1)]);
}

function localeValues(v: unknown): Partial<Record<IceLocale, string>> {
  const out: Partial<Record<IceLocale, string>> = {};
  if (!isBag(v)) return out;
  for (const l of ["pl", "en", "de"] as const) if (typeof v[l] === "string") out[l] = v[l] as string;
  return out;
}

/**
 * Every editable field of one block, in a fixed order (text in the
 * registry's order, items expanded, then media). Fields that are empty today
 * are listed too — the numbering must not depend on what happens to be
 * filled.
 */
export function blockFields(block: CmsBlockLike, base: string | null): IceCmsField[] {
  if (!isUuid(block.id)) return [];
  const id = block.id;
  const out: IceCmsField[] = [];
  const push = (path: string[], kind: "text" | "media") => {
    const raw = valueAt(block.content, path);
    out.push({
      id: `${id}|${path.join("|")}`,
      blockId: id,
      blockType: block.type,
      n: out.length,
      path,
      kind,
      multiline: kind === "text" && CMS_MULTILINE.has(path[path.length - 1]),
      values: kind === "text" ? localeValues(raw) : {},
      ...(kind === "media" ? { url: typeof raw === "string" ? raw : "" } : {}),
      base,
    });
  };
  if (block.type === "launch") {
    for (const f of LAUNCH_TEXT_FIELDS) push(["fields", f], "text");
    return out;
  }
  const spec = CMS_FIELDS[block.type];
  if (!spec) return [];
  for (const s of spec.text) for (const p of expand(s, block.content)) push(p, "text");
  for (const s of spec.media) for (const p of expand(s, block.content)) push(p, "media");
  return out;
}

/** The language a renderer shows for a LocaleText (lib/cms.ts lt(): the
 *  visitor's, else Polish, else English). */
function shownLocale(text: Bag, locale: IceLocale): IceLocale | null {
  if (text[locale] != null) return locale;
  if (text.pl != null) return "pl";
  if (text.en != null) return "en";
  return null;
}

/** Marker after the text (before any trailing whitespace); for a paragraph
 *  field, after every paragraph, so each painted <p> carries it. */
export function markText(value: string, payload: string, multiline: boolean): string {
  const m = stegaMark(payload);
  const one = (s: string) => s.replace(/\s*$/, (ws) => m + ws);
  const clean = stegaStrip(value);
  if (!multiline) return one(clean);
  return clean.split(/(\n\s*\n)/).map((part, i) => (i % 2 === 1 || !part.trim() ? part : one(part))).join("");
}

/** The blocks with every shown, non-empty text field marked. Untouched
 *  blocks are returned as they are; touched ones get a copied content. */
export function markBlocks<B extends CmsBlockLike>(blocks: B[], locale: IceLocale, nonce: string): B[] {
  return blocks.map((b) => {
    const fields = blockFields(b, null).filter((f) => f.kind === "text");
    if (fields.length === 0) return b;
    const content = structuredClone(b.content);
    let touched = false;
    for (const f of fields) {
      const holder = valueAt(content, f.path);
      if (!isBag(holder)) continue;
      const shown = shownLocale(holder, locale);
      const value = shown ? holder[shown] : undefined;
      if (!shown || typeof value !== "string" || !value.trim()) continue;
      holder[shown] = markText(value, `${nonce}.c${b.id!.slice(0, 8)}.${f.n}`, f.multiline);
      touched = true;
    }
    return touched ? { ...b, content } : b;
  });
}

async function isServerAction(): Promise<boolean> {
  try {
    return (await headers()).has("next-action");
  } catch {
    return true;
  }
}

/**
 * The published page as this request should paint it: marked when an admin
 * is editing exactly this page, the page itself otherwise. The locale and the
 * slug "/" serves are asked for only once an edit session exists — a
 * visitor's request reads one cookie list and returns.
 */
export async function markPublishedPage<P extends { slug: string; blocks: CmsBlockLike[] }>(
  page: P,
  ask: { locale: () => Promise<IceLocale>; homeSlug: () => Promise<string | null> },
): Promise<P> {
  // A legal document is never marked: no edit session can be opened on one
  // (core.ts iceRefusesPath), and a stale cookie must not put invisible
  // characters into a text that has to stay byte for byte as published.
  if (isLegalSlug(page.slug)) return page;
  try {
    const sessions = await iceEditSessions();
    if (sessions.length === 0) return page;
    if (await isServerAction()) return page;
    let session = sessions.find((s) => s.path === `/${page.slug}`);
    if (!session) {
      const root = sessions.find((s) => s.path === "/");
      if (root && (await ask.homeSlug()) === page.slug) session = root;
    }
    if (!session) return page;
    return { ...page, blocks: markBlocks(page.blocks, await ask.locale(), session.nonce) };
  } catch (e) {
    console.warn("ice cms layer failed, rendering the published copy", e instanceof Error ? e.message : e);
    return page;
  }
}
