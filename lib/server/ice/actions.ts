import "server-only";
import { cookies } from "next/headers";
import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { enforceLoginSecurity } from "@/lib/server/login-security";
import { logAudit } from "@/lib/services/audit";
import { usageCounts, mediaUsage } from "@/lib/services/media-slots";
import { MEDIA_SLOT_TAG } from "@/lib/server/media-slots";
import { CMS_TAG, toBlocks } from "@/lib/server/public-site";
import { isObjectFit, isObjectPosition } from "@/lib/media-slots";
import { lookup } from "@/lib/i18n/t";
import pl from "@/lib/i18n/dictionaries/pl.json";
import en from "@/lib/i18n/dictionaries/en.json";
import de from "@/lib/i18n/dictionaries/de.json";
import {
  ICE_PAGES, ICE_TEXT_KEYS, allElements, icePageFor, isDeniedKey, pageTextKeys, pagesOfText, slotSpec, textSpec,
} from "@/lib/ice/registry";
import { altProblem, normaliseText, textProblem } from "@/lib/ice/validate";
import { hasInvisible } from "@/lib/ice/stega";
import {
  ICE_IMAGE_MIMES, ICE_MAX_SAMPLE_BYTES, ICE_VIDEO_MIMES, isIceMime, kindOf, maxBytesFor, safeName, sniff,
} from "@/lib/ice/sniff";
import {
  ICE_LOCALES,
  type IceAsset, type IceCmsPage, type IceCrop, type IceLocale, type IcePageInfo, type IceResult,
  type IceSlotState, type IceSlotWrite, type IceTextInfo, type IceTextState, type IceUsage, type IceVersion,
} from "@/lib/ice/types";
import { CONTENT_TAG } from "./overrides";
import { blockFields, isUuid, valueAt } from "./cms";
import { ICE_HINT_COOKIE, editCookieName, editCookieValue, newNonce } from "./session";

/**
 * EVERY WRITE (AND ADMIN READ) THE VISUAL EDITOR MAKES.
 *
 * Each function: who is asking (an admin, on a verified device), what exactly
 * may be changed (the registry, the CMS field list — never a key or a path the
 * browser made up), the write itself through one database function that
 * re-checks the role and compares-and-sets, an audit row, and the one cache
 * tag the change makes stale. No redeploy, no global invalidation.
 *
 * Wrapped by app/actions/ice.ts ("use server"); kept here so the wrappers
 * hold no logic and no keys.
 */

type Client = Awaited<ReturnType<typeof createClient>>;
type Dict = Record<string, unknown>;
const SHIPPED: Record<IceLocale, Dict> = { pl: pl as Dict, en: en as Dict, de: de as Dict };

class IceRefusal extends Error {
  constructor(code: string, readonly current?: unknown) {
    super(code);
  }
}

async function requireIceAdmin(): Promise<{ supabase: Client; adminId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new IceRefusal("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new IceRefusal("not_admin");
  // The same gate the admin panel's layout applies: a session on a device the
  // step-up has not verified edits nothing.
  if (await enforceLoginSecurity(supabase)) throw new IceRefusal("step_up_required");
  return { supabase, adminId: user.id };
}

async function run<T>(fn: () => Promise<T>): Promise<IceResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof IceRefusal) return { ok: false, error: e.message, ...(e.current !== undefined ? { current: e.current } : {}) };
    console.error("ice action failed", e instanceof Error ? e.message : e);
    return { ok: false, error: "generic" };
  }
}

const isLocale = (v: unknown): v is IceLocale => v === "pl" || v === "en" || v === "de";

/** What a database function raised, as one of our codes. */
function dbCode(message: string | undefined): string {
  const m = message ?? "";
  for (const code of ["not_admin", "conflict", "noop", "invalid_text", "draft_diverged", "not_published",
    "not_in_snapshot", "block_missing", "bad_path", "bad_action", "bad_writes"]) {
    if (m.includes(code)) return code;
  }
  if (/violates check constraint/.test(m)) return "invalid";
  return "generic";
}

/* ── pages ───────────────────────────────────────────────────────────────── */

const PATH = /^\/[a-z0-9_\-/]{0,120}$/i;

function cleanPath(path: unknown): string | null {
  if (typeof path !== "string" || !PATH.test(path)) return null;
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

type CmsPageRow = { id: string; slug: string; title: string; kind: string; status: string; is_homepage: boolean; published_snapshot: unknown };

/** The published CMS page a path shows ("/" = the homepage), or null. */
async function cmsPageAt(supabase: Client, path: string): Promise<CmsPageRow | null> {
  const query = supabase.from("cms_pages").select("id, slug, title, kind, status, is_homepage, published_snapshot");
  let row: CmsPageRow | null = null;
  if (path === "/") {
    const { data } = await query.eq("is_homepage", true).maybeSingle();
    row = data as CmsPageRow | null;
  } else {
    const slug = path.slice(1);
    if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(slug)) return null;
    const { data } = await query.eq("slug", slug).maybeSingle();
    row = data as CmsPageRow | null;
    // The homepage is edited at "/", where visitors see it.
    if (row?.is_homepage) return null;
  }
  if (!row || row.status !== "published" || row.kind === "app") return null;
  return row;
}

/** Every path the editor can open: the registry's pages and the published
 *  CMS pages. For the launcher, so the button shows only where it works. */
export async function iceSupportedPaths(supabase: Client): Promise<string[]> {
  const out = new Set<string>(ICE_PAGES.map((p) => p.path));
  out.add("/plan");
  const { data } = await supabase.from("cms_pages").select("slug, kind, status, is_homepage").eq("status", "published");
  for (const p of data ?? []) {
    if (p.kind === "app") continue;
    out.add(p.is_homepage ? "/" : `/${p.slug}`);
  }
  return [...out].sort();
}

async function cmsPageInfo(supabase: Client, row: CmsPageRow, path: string): Promise<IceCmsPage> {
  const blocks = toBlocks(row.published_snapshot);
  const { data: drafts } = await supabase.from("cms_blocks").select("id, updated_at").eq("page_id", row.id);
  const base = new Map((drafts ?? []).map((b) => [b.id as string, b.updated_at as string]));
  return {
    pageId: row.id,
    slug: row.slug,
    path,
    title: row.title,
    launch: row.kind === "launch",
    fields: blocks.flatMap((b) => blockFields(b, b.id ? base.get(b.id) ?? null : null)),
  };
}

export function setEdit(on: boolean, rawPath: string): Promise<IceResult<{ nonce: string | null }>> {
  return run(async () => {
    const { supabase } = await requireIceAdmin();
    const path = cleanPath(rawPath);
    if (!path) throw new IceRefusal("unsupported");
    const store = await cookies();
    const name = editCookieName(path);
    if (!on) {
      store.set(name, "", { path, maxAge: 0, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
      return { nonce: null };
    }
    if (!icePageFor(path) && !(await cmsPageAt(supabase, path))) throw new IceRefusal("unsupported");
    const nonce = newNonce();
    // No Max-Age: a session cookie, gone when the browser closes. Path-scoped:
    // sent only with this page, so edit mode cannot leak into other routes.
    store.set(name, editCookieValue({ nonce, path }), {
      path, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    });
    setHint(store);
    return { nonce };
  });
}

type CookieStore = Awaited<ReturnType<typeof cookies>>;
function setHint(store: CookieStore) {
  store.set(ICE_HINT_COOKIE, "1", {
    path: "/", maxAge: 60 * 60 * 24 * 30, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
  });
}

/** Called once by the admin panel: "this browser belongs to an admin". */
export function rememberAdmin(): Promise<IceResult<undefined>> {
  return run(async () => {
    await requireIceAdmin();
    setHint(await cookies());
    return undefined;
  });
}

export function pageInfo(rawPath: string): Promise<IceResult<IcePageInfo>> {
  return run(async () => {
    const { supabase } = await requireIceAdmin();
    const path = cleanPath(rawPath);
    if (!path) throw new IceRefusal("unsupported");
    const page = icePageFor(path);
    if (page) return { kind: "registry", page, textKeys: pageTextKeys(page) };
    const row = await cmsPageAt(supabase, path);
    if (!row) throw new IceRefusal("unsupported");
    return { kind: "cms", cms: await cmsPageInfo(supabase, row, path) };
  });
}

export function cmsMap(rawPath: string): Promise<IceResult<IceCmsPage>> {
  return run(async () => {
    const { supabase } = await requireIceAdmin();
    const path = cleanPath(rawPath);
    const row = path ? await cmsPageAt(supabase, path) : null;
    if (!path || !row) throw new IceRefusal("unsupported");
    return cmsPageInfo(supabase, row, path);
  });
}

/* ── texts ───────────────────────────────────────────────────────────────── */

function shippedText(key: string, locale: IceLocale): string | null {
  const v = lookup(SHIPPED[locale], key);
  return typeof v === "string" ? v : null;
}

/** The key, if the editor may touch it at all. */
function editableKey(key: unknown): { key: string; maxLength: number } {
  if (typeof key !== "string" || !ICE_TEXT_KEYS.has(key)) throw new IceRefusal("unknown_key");
  const spec = textSpec(key)?.text;
  const pl = shippedText(key, "pl");
  if (!spec || pl === null || isDeniedKey(key, pl)) throw new IceRefusal("denied");
  return { key, maxLength: spec.maxLength };
}

async function readTextStates(supabase: Client, key: string): Promise<IceTextState[]> {
  const { data, error } = await supabase.from("content_overrides").select("locale, value, updated_at").eq("key", key);
  if (error) throw new Error(error.message);
  const rows = new Map((data ?? []).map((r) => [r.locale, r]));
  return ICE_LOCALES.map((locale) => {
    const row = rows.get(locale);
    return {
      key, locale,
      defaultValue: shippedText(key, locale) ?? "",
      override: row?.value ?? null,
      updatedAt: row?.updated_at ?? null,
    };
  });
}

export function textState(rawKey: string): Promise<IceResult<IceTextInfo>> {
  return run(async () => {
    const { supabase } = await requireIceAdmin();
    const { key, maxLength } = editableKey(rawKey);
    return { states: await readTextStates(supabase, key), pages: pagesOfText(key), maxLength };
  });
}

export function textSave(input: {
  key: string; locale: IceLocale; value: string | null; base: string | null; action?: "save" | "reset" | "restore";
}): Promise<IceResult<{ updatedAt: string | null }>> {
  return run(async () => {
    const { supabase, adminId } = await requireIceAdmin();
    const { key, maxLength } = editableKey(input?.key);
    if (!isLocale(input.locale)) throw new IceRefusal("locale");
    const action = input.action ?? "save";
    if (!["save", "reset", "restore"].includes(action)) throw new IceRefusal("bad_action");
    const fallback = shippedText(key, input.locale);
    if (fallback === null || isDeniedKey(key, fallback)) throw new IceRefusal("denied");
    const base = typeof input.base === "string" && input.base ? input.base : null;

    let value: string | null = null;
    if (input.value !== null) {
      if (typeof input.value !== "string") throw new IceRefusal("text_invalid");
      const v = normaliseText(input.value);
      // Only what differs from the shipped text is stored: typing the default
      // back is the same as restoring it.
      if (v !== fallback) {
        const problem = textProblem(key, v, fallback, maxLength);
        if (problem) throw new IceRefusal(`text_${problem}`);
        value = v;
      }
    }
    const before = (await readTextStates(supabase, key)).find((s) => s.locale === input.locale)!;
    if (value === null && before.override === null) return { updatedAt: null };

    const { data, error } = await supabase.rpc("content_override_write", {
      p_key: key, p_locale: input.locale, p_value: value, p_base: base,
      p_action: value === null && action === "save" ? "reset" : action,
    });
    if (error) {
      const code = dbCode(error.message);
      if (code === "noop") return { updatedAt: before.updatedAt };
      if (code === "conflict") throw new IceRefusal("conflict", await readTextStates(supabase, key));
      throw new IceRefusal(code === "generic" ? "generic" : code);
    }
    await logAudit(supabase, {
      actorId: adminId, action: "ice.text.saved", entityType: "content_override", entityId: `${key}:${input.locale}`,
      before: { value: before.override }, after: { value, action },
    });
    revalidateTag(CONTENT_TAG);
    return { updatedAt: (data as string | null) ?? null };
  });
}

/* ── media ───────────────────────────────────────────────────────────────── */

const ASSET_COLUMNS = "id, kind, storage_path, external_url, poster_url, title, alt, mime, size_bytes, width, height, variants, created_at";
type AssetRow = {
  id: string; kind: string; storage_path: string | null; external_url: string | null; poster_url: string | null;
  title: string | null; alt: string | null; mime: string | null; size_bytes: number | null;
  width: number | null; height: number | null; variants: unknown; created_at: string;
};

function toAsset(supabase: Client, a: AssetRow, usage = 0): IceAsset {
  const url = a.storage_path ? supabase.storage.from("media").getPublicUrl(a.storage_path).data.publicUrl : (a.external_url ?? "");
  const variants: Record<string, string> = {};
  if (a.variants && typeof a.variants === "object" && !Array.isArray(a.variants)) {
    for (const [k, v] of Object.entries(a.variants as Record<string, unknown>)) {
      if (/^\d{2,5}$/.test(k) && typeof v === "string" && /^https:\/\//.test(v)) variants[k] = v;
    }
  }
  return {
    id: a.id,
    kind: a.kind === "video" ? "video" : a.kind === "image" ? "image" : "file",
    url,
    posterUrl: a.poster_url,
    title: a.title ?? (a.storage_path ? a.storage_path.split("/").pop() ?? null : null),
    alt: a.alt,
    mime: a.mime,
    sizeBytes: a.size_bytes,
    width: a.width,
    height: a.height,
    variants,
    createdAt: a.created_at,
    usage,
  };
}

async function readAssets(supabase: Client, ids: string[]): Promise<Map<string, AssetRow>> {
  const unique = [...new Set(ids.filter(isUuid))];
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase.from("media_assets").select(ASSET_COLUMNS).in("id", unique);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((a) => [a.id, a as AssetRow]));
}

function readCrop(v: unknown): (IceCrop & { m?: IceCrop }) | null {
  const one = (c: unknown): IceCrop | null => {
    if (!c || typeof c !== "object") return null;
    const { x, y, zoom } = c as Record<string, unknown>;
    if (typeof x !== "number" || typeof y !== "number" || typeof zoom !== "number") return null;
    if (x < 0 || x > 100 || y < 0 || y > 100 || zoom < 1 || zoom > 2.5) return null;
    return { x, y, zoom };
  };
  const main = one(v);
  if (!main) return null;
  const m = one((v as Record<string, unknown>).m);
  return m ? { ...main, m } : main;
}

function readAltI18n(v: unknown): Partial<Record<IceLocale, string>> {
  const out: Partial<Record<IceLocale, string>> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const l of ICE_LOCALES) {
    const s = (v as Record<string, unknown>)[l];
    if (typeof s === "string") out[l] = s;
  }
  return out;
}

const SLOT_COLUMNS = "slot_key, media_type, media_id, tablet_media_id, mobile_media_id, poster_media_id, alt_text, alt_i18n, object_fit, object_position, crop, enabled, updated_at";
type SlotRowRaw = {
  slot_key: string; media_type: string; media_id: string | null; tablet_media_id: string | null;
  mobile_media_id: string | null; poster_media_id: string | null; alt_text: string | null; alt_i18n: unknown;
  object_fit: string; object_position: string; crop: unknown; enabled: boolean; updated_at: string;
};

async function readSlotRows(supabase: Client, keys: string[]): Promise<Map<string, SlotRowRaw>> {
  const { data, error } = await supabase.from("media_slots").select(SLOT_COLUMNS).in("slot_key", keys);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((r) => [r.slot_key, r as SlotRowRaw]));
}

function registeredSlots(keys: unknown, max = 60): string[] {
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > max) throw new IceRefusal("bad_keys");
  const out = [...new Set(keys)];
  for (const k of out) if (typeof k !== "string" || !slotSpec(k)) throw new IceRefusal("unknown_slot");
  return out as string[];
}

async function slotStates(supabase: Client, keys: string[]): Promise<IceSlotState[]> {
  const rows = await readSlotRows(supabase, keys);
  const assets = await readAssets(supabase, [...rows.values()].flatMap((r) => [r.media_id, r.mobile_media_id, r.poster_media_id].filter((x): x is string => Boolean(x))));
  const asset = (id: string | null) => (id && assets.has(id) ? toAsset(supabase, assets.get(id)!) : null);
  return keys.map((key) => {
    const r = rows.get(key);
    return {
      key,
      exists: Boolean(r),
      enabled: r?.enabled ?? true,
      mediaType: r?.media_type === "video" ? "video" : "image",
      media: asset(r?.media_id ?? null),
      mobile: asset(r?.mobile_media_id ?? null),
      poster: asset(r?.poster_media_id ?? null),
      alt: r?.alt_text ?? null,
      altI18n: readAltI18n(r?.alt_i18n),
      fit: r?.object_fit === "contain" ? "contain" : "cover",
      position: r?.object_position ?? "center center",
      crop: readCrop(r?.crop),
      updatedAt: r?.updated_at ?? null,
    };
  });
}

export function slotState(rawKeys: string[]): Promise<IceResult<IceSlotState[]>> {
  return run(async () => {
    const { supabase } = await requireIceAdmin();
    return slotStates(supabase, registeredSlots(rawKeys));
  });
}

function checkCrop(c: unknown, allowMobile: boolean): (IceCrop & { m?: IceCrop }) | null {
  if (c === null || c === undefined) return null;
  const crop = readCrop(c);
  if (!crop) throw new IceRefusal("crop");
  const keys = Object.keys(c as object);
  if (keys.some((k) => !["x", "y", "zoom", "m"].includes(k))) throw new IceRefusal("crop");
  if ((c as Record<string, unknown>).m !== undefined && (!crop.m || !allowMobile)) throw new IceRefusal("crop");
  const round = (o: IceCrop): IceCrop => ({ x: Math.round(o.x * 100) / 100, y: Math.round(o.y * 100) / 100, zoom: Math.round(o.zoom * 1000) / 1000 });
  return crop.m ? { ...round(crop), m: round(crop.m) } : round(crop);
}

type AssetFacts = Pick<AssetRow, "kind" | "mime" | "size_bytes" | "storage_path" | "external_url">;

/** A library file may fill a slot of this kind: same kind, one of the six
 *  formats, within the size limit (a sample: ≤ 10 MiB, what a tool takes). */
function checkAsset(a: AssetFacts | undefined | null, kind: "image" | "video", sample: boolean): void {
  if (!a) throw new IceRefusal("asset_missing");
  if (a.kind !== kind) throw new IceRefusal("asset_kind");
  if (!a.storage_path && !a.external_url) throw new IceRefusal("asset_missing");
  const allowed = kind === "image" ? ICE_IMAGE_MIMES : ICE_VIDEO_MIMES;
  if (!a.mime || !(allowed as readonly string[]).includes(a.mime)) throw new IceRefusal("asset_format");
  const cap = sample ? ICE_MAX_SAMPLE_BYTES : kind === "image" ? maxBytesFor("image/jpeg") : maxBytesFor("video/mp4");
  if (a.size_bytes !== null && a.size_bytes > cap) throw new IceRefusal("asset_too_large");
}

export function slotSave(input: { writes: IceSlotWrite[]; action: "save" | "restore" | "clear" | "bulk" }): Promise<IceResult<{ updatedAt: Record<string, string> }>> {
  return run(async () => {
    const { supabase, adminId } = await requireIceAdmin();
    if (!input || !["save", "restore", "clear", "bulk"].includes(input.action)) throw new IceRefusal("bad_action");
    const writes = Array.isArray(input.writes) ? input.writes : [];
    const keys = registeredSlots(writes.map((w) => w?.key));
    if (keys.length !== writes.length) throw new IceRefusal("bad_keys");

    const current = await readSlotRows(supabase, keys);
    const assets = await readAssets(supabase, writes.flatMap((w) => [w.mediaId, w.mobileMediaId, w.posterMediaId].filter((x): x is string => typeof x === "string")));

    const payload = writes.map((w) => {
      const spec = slotSpec(w.key)!;
      const mediaType = w.mediaType === "video" ? "video" : "image";
      if (w.mediaType !== "image" && w.mediaType !== "video") throw new IceRefusal("media_type");
      if (mediaType === "video" && (!spec.video || spec.sample)) throw new IceRefusal("no_video_here");
      if (!isObjectFit(w.fit)) throw new IceRefusal("fit");
      if (!isObjectPosition(w.position)) throw new IceRefusal("position");
      const clear = input.action === "clear" || w.mediaId === null;
      const mediaId = clear ? null : w.mediaId;
      // A slot the editor frames without a phone file (a shared tool card)
      // may still have one from Admin → Media: kept, like the tablet file.
      const mobileId = clear ? null : spec.mobile ? w.mobileMediaId ?? null : current.get(w.key)?.mobile_media_id ?? null;
      const posterId = clear ? null : w.posterMediaId ?? null;
      if (mediaId !== null) checkAsset(assets.get(mediaId), mediaType, Boolean(spec.sample));
      if (mobileId !== null && spec.mobile) checkAsset(assets.get(mobileId), mediaType, false);
      if (posterId !== null) {
        if (mediaType !== "video") throw new IceRefusal("poster");
        checkAsset(assets.get(posterId), "image", false);
      }
      const crop = clear || spec.positionOnly ? null : checkCrop(w.crop, Boolean(spec.mobile) && mobileId !== null);
      const altI18n: Partial<Record<IceLocale, string>> = {};
      for (const [l, v] of Object.entries(w.altI18n ?? {})) {
        if (!isLocale(l) || typeof v !== "string") throw new IceRefusal("alt");
        const t = normaliseText(v);
        if (altProblem(t)) throw new IceRefusal(`alt_${altProblem(t)}`);
        if (t) altI18n[l] = t;
      }
      const base = typeof w.base === "string" && w.base ? w.base : null;
      return {
        key: w.key,
        entity_type: spec.entityType,
        entity_id: spec.entityId,
        slot_name: spec.slotName,
        media_type: mediaType,
        media_id: mediaId,
        // The tablet file is managed in Admin → Media; the editor keeps it.
        tablet_media_id: clear ? null : current.get(w.key)?.tablet_media_id ?? null,
        mobile_media_id: mobileId,
        poster_media_id: posterId,
        // The single alt the shared renderers read: the Polish one.
        alt_text: altI18n.pl ?? null,
        alt_i18n: Object.keys(altI18n).length ? altI18n : null,
        object_fit: w.fit,
        object_position: w.position,
        crop,
        base,
      };
    });

    const { data, error } = await supabase.rpc("media_slots_write", { p_writes: payload, p_action: input.action });
    if (error) {
      const code = dbCode(error.message);
      if (code === "conflict") {
        const key = /conflict:(\S+)/.exec(error.message)?.[1] ?? null;
        throw new IceRefusal("conflict", { key, states: await slotStates(supabase, keys) });
      }
      throw new IceRefusal(code);
    }
    await logAudit(supabase, {
      actorId: adminId, action: "ice.slot.saved", entityType: "media_slot", entityId: keys.join(",").slice(0, 300),
      after: { action: input.action, slots: payload.map((p) => ({ key: p.key, media: p.media_id, mobile: p.mobile_media_id, poster: p.poster_media_id, crop: p.crop })) },
    });
    revalidateTag(MEDIA_SLOT_TAG);
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries((data ?? {}) as Record<string, unknown>)) if (typeof v === "string") out[k] = v;
    return { updatedAt: out };
  });
}

/* ── history ─────────────────────────────────────────────────────────────── */

type VersionRow = { id: string; target: string; key: string; action: string; locale: string | null; before: unknown; after: unknown; created_at: string; created_by: string | null };

async function withAuthors(supabase: Client, rows: VersionRow[]): Promise<(IceVersion & { target: string; key: string })[]> {
  const ids = [...new Set(rows.map((r) => r.created_by).filter((x): x is string => Boolean(x)))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
    for (const p of data ?? []) names.set(p.id, p.full_name?.trim() || p.email);
  }
  return rows.map((r) => ({
    id: r.id,
    target: r.target,
    key: r.key,
    action: r.action,
    locale: isLocale(r.locale) ? r.locale : null,
    before: r.before,
    after: r.after,
    createdAt: r.created_at,
    author: r.created_by ? names.get(r.created_by) ?? null : null,
  }));
}

const CMS_KEY = /^[0-9a-f-]{36}:[0-9a-f-]{36}:[a-zA-Z0-9_.]{1,200}$/;

export function history(input: { target: "text" | "slot" | "cms"; key: string; locale?: IceLocale | null; limit?: number }): Promise<IceResult<IceVersion[]>> {
  return run(async () => {
    const { supabase } = await requireIceAdmin();
    if (input?.target === "text") editableKey(input.key);
    else if (input?.target === "slot") registeredSlots([input.key]);
    else if (input?.target !== "cms" || typeof input.key !== "string" || !CMS_KEY.test(input.key)) throw new IceRefusal("unknown_key");
    let q = supabase.from("content_versions").select("id, target, key, action, locale, before, after, created_at, created_by")
      .eq("target", input.target).eq("key", input.key)
      .order("created_at", { ascending: false }).limit(Math.min(Math.max(input.limit ?? 20, 1), 50));
    if (input.locale && isLocale(input.locale)) q = q.eq("locale", input.locale);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return withAuthors(supabase, (data ?? []) as VersionRow[]);
  });
}

export function pageHistory(rawPath: string): Promise<IceResult<(IceVersion & { target: string; key: string })[]>> {
  return run(async () => {
    const { supabase } = await requireIceAdmin();
    const path = cleanPath(rawPath);
    if (!path) throw new IceRefusal("unsupported");
    const cols = "id, target, key, action, locale, before, after, created_at, created_by";
    const page = icePageFor(path);
    let rows: VersionRow[] = [];
    if (page) {
      const texts = pageTextKeys(page);
      const slots = [...new Set(allElements(page).flatMap((e) => (e.slots ?? []).map((s) => s.key)))];
      const [a, b] = await Promise.all([
        supabase.from("content_versions").select(cols).eq("target", "text").in("key", texts).order("created_at", { ascending: false }).limit(40),
        slots.length
          ? supabase.from("content_versions").select(cols).eq("target", "slot").in("key", slots).order("created_at", { ascending: false }).limit(40)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (a.error) throw new Error(a.error.message);
      if (b.error) throw new Error(b.error.message);
      rows = [...(a.data ?? []), ...(b.data ?? [])] as VersionRow[];
    } else {
      const row = await cmsPageAt(supabase, path);
      if (!row) throw new IceRefusal("unsupported");
      const { data, error } = await supabase.from("content_versions").select(cols).eq("target", "cms")
        .like("key", `${row.id}:%`).order("created_at", { ascending: false }).limit(40);
      if (error) throw new Error(error.message);
      rows = (data ?? []) as VersionRow[];
    }
    rows.sort((x, y) => (x.created_at < y.created_at ? 1 : -1));
    return withAuthors(supabase, rows.slice(0, 40));
  });
}

/* ── the library ─────────────────────────────────────────────────────────── */

export function library(input: { kind?: "image" | "video"; q?: string; offset?: number }): Promise<IceResult<IceAsset[]>> {
  return run(async () => {
    const { supabase } = await requireIceAdmin();
    const offset = Math.max(0, Math.min(Number(input?.offset ?? 0) || 0, 5000));
    let q = supabase.from("media_assets").select(ASSET_COLUMNS).in("kind", ["image", "video"])
      .order("created_at", { ascending: false }).range(offset, offset + 59);
    if (input?.kind === "image" || input?.kind === "video") q = q.eq("kind", input.kind);
    const term = typeof input?.q === "string" ? input.q.replace(/[^a-zA-Z0-9 _.-]/g, "").trim().slice(0, 60) : "";
    if (term) q = q.or(`title.ilike.%${term}%,storage_path.ilike.%${term}%`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as AssetRow[];
    const counts = await usageCounts(supabase, rows.map((r) => r.id));
    return rows.map((r) => toAsset(supabase, r, counts.get(r.id) ?? 0));
  });
}

export function assets(ids: string[]): Promise<IceResult<IceAsset[]>> {
  return run(async () => {
    const { supabase } = await requireIceAdmin();
    if (!Array.isArray(ids) || ids.length > 60) throw new IceRefusal("bad_keys");
    const rows = await readAssets(supabase, ids.filter((x): x is string => typeof x === "string"));
    return [...rows.values()].map((r) => toAsset(supabase, r));
  });
}

export function usage(mediaId: string): Promise<IceResult<IceUsage[]>> {
  return run(async () => {
    const { supabase } = await requireIceAdmin();
    if (!isUuid(mediaId)) throw new IceRefusal("asset_missing");
    return mediaUsage(supabase, mediaId);
  });
}

/* ── uploads ─────────────────────────────────────────────────────────────── */

const UPLOAD_PATH = /^ice\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;

/** Where the browser may put one file — checked again, from the bytes, when
 *  it is registered. */
export function uploadTicket(input: { name: string; size: number; type: string }): Promise<IceResult<{ path: string }>> {
  return run(async () => {
    await requireIceAdmin();
    if (!input || !isIceMime(input.type)) throw new IceRefusal("format");
    if (typeof input.size !== "number" || input.size <= 0 || input.size > maxBytesFor(input.type)) throw new IceRefusal("too_large");
    return { path: `ice/${crypto.randomUUID()}/${safeName(String(input.name ?? ""))}` };
  });
}

/**
 * A file the browser uploaded becomes a library asset — only after its first
 * bytes say it is one of the six formats and the stored size is within the
 * limit for that format. A file that fails is removed (it is ours, minutes
 * old, at a path nothing references) and refused.
 */
export function registerUpload(input: { path: string; name: string }): Promise<IceResult<IceAsset>> {
  return run(async () => {
    const { supabase, adminId } = await requireIceAdmin();
    if (!input || typeof input.path !== "string" || !UPLOAD_PATH.test(input.path)) throw new IceRefusal("bad_path");
    const path = input.path;
    const { data: existing } = await supabase.from("media_assets").select("id").eq("storage_path", path).maybeSingle();
    if (existing) throw new IceRefusal("already_registered");

    const url = supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
    const res = await fetch(url, { headers: { Range: "bytes=0-63" }, cache: "no-store" });
    if (!res.ok) throw new IceRefusal("upload_missing");
    const head = new Uint8Array(await res.arrayBuffer()).subarray(0, 64);
    // The stored size: a 206's Content-Range total, a 200's (Range ignored)
    // Content-Length, else Storage's own record of the object. Never a 206's
    // Content-Length — that is the length of the range.
    let total = res.status === 206
      ? Number(/\/(\d+)$/.exec(res.headers.get("content-range") ?? "")?.[1] ?? NaN)
      : Number(res.headers.get("content-length") ?? NaN);
    if (!Number.isFinite(total) || total <= 0) {
      try {
        const { data: info } = await supabase.storage.from("media").info(path);
        total = Number(info?.size ?? NaN);
      } catch {
        total = NaN;
      }
    }
    const mime = sniff(head);

    const refuse = async (code: string): Promise<never> => {
      await supabase.storage.from("media").remove([path]);
      throw new IceRefusal(code);
    };
    if (!mime) return refuse("format");
    if (!Number.isFinite(total) || total <= 0) return refuse("upload_missing");
    if (total > maxBytesFor(mime)) return refuse("too_large");

    const title = safeName(String(input.name ?? path.split("/").pop() ?? "")).slice(0, 120);
    const { data, error } = await supabase.from("media_assets").insert({
      kind: kindOf(mime), storage_path: path, title, mime, size_bytes: total, created_by: adminId, folder: "edytor-wizualny",
    }).select(ASSET_COLUMNS).single();
    if (error || !data) throw new Error(error?.message ?? "insert failed");
    await logAudit(supabase, {
      actorId: adminId, action: "ice.media.uploaded", entityType: "media_asset", entityId: data.id,
      after: { path, mime, size: total },
    });
    revalidatePath("/admin/media");
    return toAsset(supabase, data as AssetRow);
  });
}

/* ── CMS pages ───────────────────────────────────────────────────────────── */

const SEG = /^[a-zA-Z0-9_.]{1,60}$/;

export function cmsSave(input: {
  blockId: string; path: string[]; locale: IceLocale | null; value: string; expected: string | null; base: string | null;
  action?: "save" | "restore";
}): Promise<IceResult<{ updatedAt: string }>> {
  return run(async () => {
    const { supabase, adminId } = await requireIceAdmin();
    if (!input || !isUuid(input.blockId)) throw new IceRefusal("block_missing");
    if (!Array.isArray(input.path) || input.path.length === 0 || input.path.length > 5 || !input.path.every((s) => typeof s === "string" && SEG.test(s))) {
      throw new IceRefusal("bad_path");
    }
    const action = input.action ?? "save";
    if (action !== "save" && action !== "restore") throw new IceRefusal("bad_action");

    const { data: block } = await supabase.from("cms_blocks").select("id, page_id").eq("id", input.blockId).maybeSingle();
    if (!block) throw new IceRefusal("block_missing");
    const { data: page } = await supabase.from("cms_pages")
      .select("id, slug, title, kind, status, is_homepage, published_snapshot").eq("id", block.page_id).maybeSingle();
    if (!page || page.status !== "published" || page.kind === "app") throw new IceRefusal("not_published");
    const live = toBlocks(page.published_snapshot).find((b) => b.id === input.blockId);
    if (!live) throw new IceRefusal("not_in_snapshot");
    const field = blockFields(live, null).find((f) => f.path.join("|") === input.path.join("|"));
    if (!field) throw new IceRefusal("not_editable");

    let value: string;
    let fullPath: string[];
    if (field.kind === "text") {
      if (!isLocale(input.locale)) throw new IceRefusal("locale");
      fullPath = [...field.path, input.locale];
      if (typeof input.value !== "string") throw new IceRefusal("text_invalid");
      value = field.multiline
        ? input.value.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[\t ]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim()
        : normaliseText(input.value);
      if (!value) throw new IceRefusal("text_empty");
      if (value.length > 2000) throw new IceRefusal("text_too_long");
      if (hasInvisible(value)) throw new IceRefusal("text_invisible");
      if (/[<>]/.test(value)) throw new IceRefusal("text_markup");
      if (!field.multiline && /\n/.test(value)) throw new IceRefusal("text_newline");
    } else {
      fullPath = field.path;
      if (typeof input.value !== "string") throw new IceRefusal("asset_missing");
      value = input.value;
      // Only a picture from the library: its public URL, never an address
      // typed in a browser.
      const prefix = supabase.storage.from("media").getPublicUrl("").data.publicUrl;
      const stored = value.startsWith(prefix) ? decodeURIComponent(value.slice(prefix.length)) : null;
      const { data: asset } = stored
        ? await supabase.from("media_assets").select("id, kind, mime, size_bytes, storage_path, external_url").eq("storage_path", stored).maybeSingle()
        : await supabase.from("media_assets").select("id, kind, mime, size_bytes, storage_path, external_url").eq("external_url", value).maybeSingle();
      checkAsset(asset as AssetFacts | null, "image", false);
    }
    const expected = typeof input.expected === "string" ? input.expected : null;
    const shownNow = valueAt(live.content, fullPath);
    if ((typeof shownNow === "string" ? shownNow : null) !== expected) {
      throw new IceRefusal("conflict", { value: typeof shownNow === "string" ? shownNow : null });
    }

    const label = `Edytor wizualny · ${field.path.join(".")}${field.kind === "text" ? ` (${input.locale})` : ""}`;
    const { data, error } = await supabase.rpc("cms_inline_patch", {
      p_block_id: input.blockId, p_path: fullPath, p_value: value, p_expected: expected, p_label: label,
      p_base: typeof input.base === "string" && input.base ? input.base : null, p_action: action,
    });
    if (error) {
      const code = dbCode(error.message);
      if (code === "noop") return { updatedAt: input.base ?? "" };
      throw new IceRefusal(code);
    }
    await logAudit(supabase, {
      actorId: adminId, action: "ice.cms.saved", entityType: "cms_block", entityId: input.blockId,
      before: { path: fullPath, value: expected }, after: { path: fullPath, value, action },
    });
    revalidateTag(CMS_TAG);
    revalidatePath(page.is_homepage ? "/" : `/${page.slug}`);
    return { updatedAt: data as string };
  });
}
