import "server-only";
import { createHash } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { logAudit } from "@/lib/services/audit";
import { publishPage } from "@/lib/services/cms";
import { CMS_TAG, toBlocks } from "@/lib/server/public-site";
import { SUPABASE_URL } from "@/lib/supabase/config";
import { canonicalJson, type CmsBlock } from "@/lib/cms";
import {
  GALLERY_BLOCK_TYPE, GALLERY_KEYS, GALLERY_SORT, incompletePairs, isGalleryKey, mediaPublicPrefix,
  readGalleryContent, validateGalleryItems, type GalleryItem, type GalleryKey,
} from "@/lib/launch/gallery";
import { dedupeVersions, galleryIdentity } from "@/lib/ice/gallery";
import type { IceAsset, IceGallery, IceGallerySaveInput, IceGalleryState, IceGalleryVersion, IceResult } from "@/lib/ice/types";
import { isUuid } from "./cms";
import {
  ASSET_COLUMNS, IceRefusal, authorNames, checkAsset, cleanPath, cmsPageAt, requireIceAdmin, run, toAsset,
  type AssetRow, type Client, type CmsPageRow,
} from "./core";

/**
 * THE LAUNCH PAGE'S PRZED/PO GALLERIES, EDITED INLINE.
 *
 * Everything else the visual editor writes is live at once. A gallery is not:
 * its pairs are a `launch_gallery` block of the launch page (one per gallery
 * key, lib/launch/gallery.ts), so a save writes the block's DRAFT and only
 * "Opublikuj" makes it public — through the CMS's own publish
 * (lib/services/cms.ts publishPage), which writes a numbered version first.
 * That is what makes a half-finished gallery safe to leave overnight, and what
 * gives it a history to go back to.
 *
 * The rules, each enforced here and not in the panel:
 *   · admins on a verified device only (the editor's one gate, core.ts);
 *   · only the page "/" serves when it is the launch page;
 *   · a pair is valid by lib/launch/gallery.ts (one definition for the save,
 *     the renderer and the panel) and every picture is an image file of THIS
 *     project's media library;
 *   · a save is compare-and-set on the block's updated_at — two tabs never
 *     silently overwrite each other — and its audit row keeps the draft it
 *     replaced (drafts are not versioned; the audit log is their history);
 *   · publishing refuses while a gallery that is switched on holds an
 *     incomplete pair, and asks for an explicit yes when the launch page's own
 *     copy has an unpublished builder draft (publishing is the whole page);
 *   · history and "discard" find a gallery by its KEY, never by block id: a
 *     rollback in Strony WWW re-creates every block with a new id.
 */

const SCAN_VERSIONS = 60;
const MAX_VERSIONS = 20;
/** Thumbnails a history row shows; their pictures' metadata is sent along. */
const VERSION_THUMBS = 4;

type DraftRow = { id: string; type: string; sort_order: number; visible: boolean; content: unknown; updated_at: string };

const prefix = () => mediaPublicPrefix(SUPABASE_URL);
const fingerprint = (visible: boolean, items: readonly GalleryItem[]) =>
  createHash("sha256").update(galleryIdentity(visible, items)).digest("hex");

/** The launch page answering "/", or a refusal. */
async function launchHome(supabase: Client): Promise<CmsPageRow> {
  const row = await cmsPageAt(supabase, "/");
  if (!row || row.kind !== "launch") throw new IceRefusal("unsupported");
  return row;
}

async function draftBlocks(supabase: Client, pageId: string): Promise<DraftRow[]> {
  const { data, error } = await supabase.from("cms_blocks")
    .select("id, type, sort_order, visible, content, updated_at").eq("page_id", pageId).order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as DraftRow[];
}

const keyOf = (content: unknown): unknown =>
  content && typeof content === "object" ? (content as { gallery?: unknown }).gallery : undefined;

/** A gallery's block by KEY: the lowest sort order, then the id (the unique
 *  index of 0144 allows one; this is the tie-break if a copy ever slips in). */
function pick<B extends { type: string; sort_order: number; id?: string; content: unknown }>(blocks: readonly B[], key: GalleryKey): B | null {
  return blocks
    .filter((b) => b.type === GALLERY_BLOCK_TYPE && keyOf(b.content) === key)
    .sort((a, b) => a.sort_order - b.sort_order || String(a.id ?? "").localeCompare(String(b.id ?? "")))[0] ?? null;
}

function galleryOf(key: GalleryKey, draft: DraftRow | null, live: CmsBlock | null): IceGallery {
  const draftItems = draft ? readGalleryContent(draft.content)?.items ?? [] : [];
  const publishedItems = live ? readGalleryContent(live.content)?.items ?? [] : [];
  const visible = draft ? draft.visible : true;
  // With a block on only ONE side, it differs only if that side has pairs: an
  // empty gallery is hidden from visitors whether its block exists or not, so
  // the empty draft "Odrzuć szkic" leaves on a never-published gallery is not
  // a difference.
  const diverged = draft && live
    ? galleryIdentity(visible, draftItems) !== galleryIdentity(live.visible, publishedItems)
    : (draft ? draftItems.length > 0 : false) !== (live ? publishedItems.length > 0 : false);
  return {
    key,
    blockId: draft?.id ?? null,
    visible,
    draft: draftItems,
    published: publishedItems,
    publishedVisible: live ? live.visible : null,
    diverged,
    updatedAt: draft?.updated_at ?? null,
  };
}

/** Whether the launch block (the page's copy) holds a builder draft that is
 *  not published: a gallery publish would publish it too. */
function launchDraftPending(drafts: readonly DraftRow[], live: readonly CmsBlock[]): boolean {
  const draft = drafts.find((b) => b.type === "launch") ?? null;
  const published = (draft && live.find((b) => b.type === "launch" && b.id === draft.id)) || live.find((b) => b.type === "launch") || null;
  if (!draft) return Boolean(published);
  if (!published) return true;
  return draft.visible !== published.visible || canonicalJson(draft.content ?? {}) !== canonicalJson(published.content ?? {});
}

/* ── the library behind the pairs ────────────────────────────────────────── */

function storagePath(url: string, base: string): string | null {
  if (!url.startsWith(base) || url.length === base.length) return null;
  try {
    return decodeURIComponent(url.slice(base.length));
  } catch {
    return null;
  }
}

/** Library rows by the URL a pair stores (this project's public media URLs
 *  only — anything else is simply not found). */
async function rowsByUrl(supabase: Client, urls: readonly string[]): Promise<Map<string, AssetRow>> {
  const base = prefix();
  const urlsOf = new Map<string, string[]>();
  for (const url of new Set(urls)) {
    const path = storagePath(url, base);
    if (path) urlsOf.set(path, [...(urlsOf.get(path) ?? []), url]);
  }
  const paths = [...urlsOf.keys()];
  const out = new Map<string, AssetRow>();
  // In slices: a long `in` list is a long URL to PostgREST.
  for (let i = 0; i < paths.length; i += 100) {
    const { data, error } = await supabase.from("media_assets").select(ASSET_COLUMNS).in("storage_path", paths.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const a of (data ?? []) as AssetRow[]) for (const url of urlsOf.get(a.storage_path ?? "") ?? []) out.set(url, a);
  }
  return out;
}

const urlsIn = (items: readonly GalleryItem[]) =>
  items.flatMap((i) => [i.before?.url, i.after?.url]).filter((u): u is string => Boolean(u));

async function assetMap(supabase: Client, urls: readonly string[]): Promise<Record<string, IceAsset>> {
  const rows = await rowsByUrl(supabase, urls);
  return Object.fromEntries([...rows].map(([url, row]) => [url, toAsset(supabase, row)]));
}

/** Every picture of every pair is an image the library knows, in a format
 *  and a size the editor accepts — the same check a single picture gets. */
async function checkPictures(supabase: Client, items: readonly GalleryItem[]): Promise<void> {
  const rows = await rowsByUrl(supabase, urlsIn(items));
  items.forEach((item, i) => {
    for (const half of [item.before, item.after]) {
      if (!half) continue;
      try {
        checkAsset(rows.get(half.url), "image", false);
      } catch (e) {
        if (e instanceof IceRefusal) throw new IceRefusal(e.message, { index: i + 1 });
        throw e;
      }
    }
  });
}

/* ── input ───────────────────────────────────────────────────────────────── */

function galleryKey(v: unknown): GalleryKey {
  if (!isGalleryKey(v)) throw new IceRefusal("bad_key");
  return v;
}

function baseOf(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || v.length > 64) throw new IceRefusal("bad_input");
  return v;
}

function validItems(items: unknown): GalleryItem[] {
  const v = validateGalleryItems(items, prefix());
  if (!v.ok) throw new IceRefusal(v.error, v.index !== undefined ? { index: v.index + 1 } : undefined);
  return v.items;
}

/* ── the draft write ─────────────────────────────────────────────────────── */

async function conflict(supabase: Client, page: CmsPageRow, key: GalleryKey): Promise<never> {
  const drafts = await draftBlocks(supabase, page.id);
  throw new IceRefusal("conflict", galleryOf(key, pick(drafts, key), pick(toBlocks(page.published_snapshot), key)));
}

/**
 * Write a gallery's draft: update its block (compare-and-set on updated_at),
 * or create it — at its fixed place after the launch block — when there is
 * none yet. Never publishes.
 */
async function writeDraft(
  supabase: Client, adminId: string, page: CmsPageRow, key: GalleryKey,
  items: GalleryItem[], visible: boolean, base: string | null, existing: DraftRow | null,
): Promise<{ blockId: string; updatedAt: string }> {
  const content = { gallery: key, items };
  const now = new Date().toISOString();
  let out: { blockId: string; updatedAt: string };
  if (existing) {
    if (base !== existing.updated_at) return conflict(supabase, page, key);
    const { data, error } = await supabase.from("cms_blocks")
      .update({ content: content as never, visible, updated_at: now, updated_by: adminId })
      .eq("id", existing.id).eq("updated_at", existing.updated_at).select("id, updated_at");
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0] as { id: string; updated_at: string | null } | undefined;
    if (!row) return conflict(supabase, page, key);
    out = { blockId: row.id, updatedAt: row.updated_at ?? now };
  } else {
    // The panel saw a block that is gone (deleted, rolled back): look again.
    if (base !== null) return conflict(supabase, page, key);
    const { data, error } = await supabase.from("cms_blocks").insert({
      page_id: page.id, type: GALLERY_BLOCK_TYPE, sort_order: GALLERY_SORT[key], visible,
      content: content as never, updated_at: now, updated_by: adminId,
    }).select("id, updated_at").single();
    // 23505: the one-gallery-per-key index — another tab created it first.
    if (error?.code === "23505") return conflict(supabase, page, key);
    if (error || !data) throw new Error(error?.message ?? "insert failed");
    out = { blockId: data.id as string, updatedAt: (data.updated_at as string | null) ?? now };
  }
  // The page's "last changed" follows its sections, as in Strony WWW.
  await supabase.from("cms_pages").update({ updated_at: now, updated_by: adminId }).eq("id", page.id);
  return out;
}

const draftOf = (b: DraftRow | null) => (b ? { visible: b.visible, items: readGalleryContent(b.content)?.items ?? [] } : null);

/* ── the actions ─────────────────────────────────────────────────────────── */

export function galleryState(rawPath: string): Promise<IceResult<IceGalleryState>> {
  return run(async () => {
    const { supabase } = await requireIceAdmin();
    if (cleanPath(rawPath) !== "/") throw new IceRefusal("unsupported");
    const page = await launchHome(supabase);
    const drafts = await draftBlocks(supabase, page.id);
    const live = toBlocks(page.published_snapshot);
    const galleries = GALLERY_KEYS.map((key) => galleryOf(key, pick(drafts, key), pick(live, key)));
    return {
      pageId: page.id,
      galleries,
      unpublishedLaunchDraft: launchDraftPending(drafts, live),
      assets: await assetMap(supabase, galleries.flatMap((g) => [...urlsIn(g.draft), ...urlsIn(g.published)])),
    };
  });
}

export function gallerySave(input: IceGallerySaveInput): Promise<IceResult<{ blockId: string; updatedAt: string }>> {
  return run(async () => {
    const { supabase, adminId } = await requireIceAdmin();
    const key = galleryKey(input?.key);
    if (typeof input.visible !== "boolean") throw new IceRefusal("bad_input");
    const base = baseOf(input.base);
    const items = validItems(input.items);
    await checkPictures(supabase, items);
    const page = await launchHome(supabase);
    const existing = pick(await draftBlocks(supabase, page.id), key);
    const saved = await writeDraft(supabase, adminId, page, key, items, input.visible, base, existing);
    await logAudit(supabase, {
      actorId: adminId, action: "ice.gallery.saved", entityType: "cms_block", entityId: saved.blockId,
      // The draft this replaced, whole: drafts are not versioned, so the
      // audit log is where an overwritten one can still be found.
      before: { gallery: key, draft: draftOf(existing) },
      after: { gallery: key, visible: input.visible, pairs: items.length },
    });
    return saved;
  });
}

export function galleryPublish(input: { confirmLaunchDraft?: boolean }): Promise<IceResult<{ version: number; publishedAt: string }>> {
  return run(async () => {
    const { supabase, adminId } = await requireIceAdmin();
    const page = await launchHome(supabase);
    const drafts = await draftBlocks(supabase, page.id);

    // A gallery that is switched on may not go out with a half-chosen pair:
    // visitors never see one (the renderer skips it), and a publish that
    // silently drops pairs is a publish nobody can reason about.
    const incomplete: Partial<Record<GalleryKey, number[]>> = {};
    for (const key of GALLERY_KEYS) {
      const block = pick(drafts, key);
      if (!block || !block.visible) continue;
      const missing = incompletePairs(readGalleryContent(block.content)?.items ?? []);
      if (missing.length > 0) incomplete[key] = missing;
    }
    if (Object.keys(incomplete).length > 0) throw new IceRefusal("incomplete_pairs", { incomplete });

    // Publishing is the whole page. If the page's own copy has a builder
    // draft that is not live yet, it goes out too — only on an explicit yes.
    const launchDraft = launchDraftPending(drafts, toBlocks(page.published_snapshot));
    if (launchDraft && input?.confirmLaunchDraft !== true) throw new IceRefusal("launch_draft");

    const published = await publishPage(supabase, adminId, page.id);
    if (!published.ok) throw new IceRefusal(published.error === "missing" ? "unsupported" : "generic");

    await logAudit(supabase, {
      actorId: adminId, action: "ice.gallery.published", entityType: "cms_page", entityId: published.slug,
      after: {
        version: published.version,
        launchDraft,
        galleries: Object.fromEntries(GALLERY_KEYS.map((key) => {
          const block = pick(drafts, key);
          return [key, block ? { visible: block.visible, pairs: readGalleryContent(block.content)?.items.length ?? 0 } : null];
        })),
      },
    });
    revalidateTag(CMS_TAG);
    revalidatePath("/");
    return { version: published.version, publishedAt: published.publishedAt };
  });
}

export function galleryDiscard(input: { key: GalleryKey; base: string | null }): Promise<IceResult<{ updatedAt: string }>> {
  return run(async () => {
    const { supabase, adminId } = await requireIceAdmin();
    const key = galleryKey(input?.key);
    const base = baseOf(input.base);
    const page = await launchHome(supabase);
    const existing = pick(await draftBlocks(supabase, page.id), key);
    // Only a draft that exists can be put back; nothing is created here.
    if (!existing) throw new IceRefusal("block_missing");
    if (base !== null && base !== existing.updated_at) return conflict(supabase, page, key);
    // What visitors see now — found by KEY in the snapshot. A gallery never
    // published goes back to empty.
    const live = pick(toBlocks(page.published_snapshot), key);
    const items = live ? readGalleryContent(live.content)?.items ?? [] : [];
    const visible = live ? live.visible : existing.visible;
    const saved = await writeDraft(supabase, adminId, page, key, items, visible, existing.updated_at, existing);
    await logAudit(supabase, {
      actorId: adminId, action: "ice.gallery.discarded", entityType: "cms_block", entityId: saved.blockId,
      before: { gallery: key, draft: draftOf(existing) },
      after: { gallery: key, visible, pairs: items.length },
    });
    return { updatedAt: saved.updatedAt };
  });
}

export function galleryVersions(input: { key: GalleryKey }): Promise<IceResult<{ versions: IceGalleryVersion[]; assets: Record<string, IceAsset> }>> {
  return run(async () => {
    const { supabase } = await requireIceAdmin();
    const key = galleryKey(input?.key);
    const page = await launchHome(supabase);
    const drafts = await draftBlocks(supabase, page.id);
    const draft = draftOf(pick(drafts, key));
    const liveBlock = pick(toBlocks(page.published_snapshot), key);
    const draftPrint = draft ? fingerprint(draft.visible, draft.items) : null;
    const livePrint = liveBlock ? fingerprint(liveBlock.visible, readGalleryContent(liveBlock.content)?.items ?? []) : null;

    const { data, error } = await supabase.from("cms_page_versions")
      .select("id, version, reason, label, created_at, created_by, snapshot")
      .eq("page_id", page.id).order("version", { ascending: false }).limit(SCAN_VERSIONS);
    if (error) throw new Error(error.message);
    type Row = { id: string; version: number; reason: string; label: string | null; created_at: string; created_by: string | null; snapshot: unknown };
    const found = ((data ?? []) as Row[]).flatMap((v) => {
      const block = pick(toBlocks(v.snapshot), key);
      if (!block) return [];
      const items = readGalleryContent(block.content)?.items ?? [];
      return [{ v, visible: block.visible, items, fingerprint: fingerprint(block.visible, items) }];
    });
    const distinct = dedupeVersions(found, MAX_VERSIONS);
    const names = await authorNames(supabase, distinct.map((x) => x.v.created_by));
    const versions: IceGalleryVersion[] = distinct.map((x) => ({
      id: x.v.id,
      version: x.v.version,
      reason: x.v.reason,
      label: x.v.label,
      createdAt: x.v.created_at,
      author: x.v.created_by ? names.get(x.v.created_by) ?? null : null,
      visible: x.visible,
      items: x.items,
      fingerprint: x.fingerprint,
      isDraft: x.fingerprint === draftPrint,
      isPublished: x.fingerprint === livePrint,
    }));
    const thumbs = versions.flatMap((v) => urlsIn(v.items.slice(0, VERSION_THUMBS)));
    return { versions, assets: await assetMap(supabase, thumbs) };
  });
}

export function galleryRestore(input: { key: GalleryKey; version: string; base: string | null }): Promise<IceResult<{ blockId: string; updatedAt: string }>> {
  return run(async () => {
    const { supabase, adminId } = await requireIceAdmin();
    const key = galleryKey(input?.key);
    if (!isUuid(input.version)) throw new IceRefusal("version_missing");
    const base = baseOf(input.base);
    const page = await launchHome(supabase);
    const { data: version } = await supabase.from("cms_page_versions")
      .select("id, version, snapshot").eq("id", input.version).eq("page_id", page.id).maybeSingle();
    const block = version ? pick(toBlocks(version.snapshot), key) : null;
    if (!version || !block) throw new IceRefusal("version_missing");
    // Into the DRAFT, and only what is still valid today: the same rules as a
    // save, so an old version cannot bring back a picture the library lost.
    const items = validItems(readGalleryContent(block.content)?.items ?? []);
    await checkPictures(supabase, items);
    const existing = pick(await draftBlocks(supabase, page.id), key);
    const saved = await writeDraft(supabase, adminId, page, key, items, block.visible, base, existing);
    await logAudit(supabase, {
      actorId: adminId, action: "ice.gallery.restored", entityType: "cms_block", entityId: saved.blockId,
      before: { gallery: key, draft: draftOf(existing) },
      after: { gallery: key, version: version.version, visible: block.visible, pairs: items.length },
    });
    return saved;
  });
}
