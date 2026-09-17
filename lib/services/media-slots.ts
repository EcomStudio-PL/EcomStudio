import type { Client } from "@/lib/services/workspace";
import {
  MEDIA_SLOTS, bannerSlotKey, slotsFor, type SlotDef, type SlotEntity,
} from "@/lib/media-slots";
import type { ObjectFit, ObjectPosition, SlotMediaType } from "@/lib/media-slots";

/**
 * THE ADMIN'S VIEW OF THE SLOTS.
 *
 * Reads the tables directly with the caller's client, so the admin-only
 * policies from 0090 decide what comes back. The customer-facing read is a
 * different thing entirely and lives in lib/server/media-slots.ts — it goes
 * through a definer function because a customer has no business reading either
 * table.
 *
 * Transport-agnostic, per the house rule: everything takes a SupabaseClient
 * and returns data. No caching, no cookies, no React.
 */

export type SlotRow = {
  slotKey: string;
  mediaType: SlotMediaType;
  mediaId: string | null;
  tabletMediaId: string | null;
  mobileMediaId: string | null;
  posterMediaId: string | null;
  altText: string;
  objectFit: ObjectFit;
  objectPosition: ObjectPosition;
  autoplay: boolean;
  muted: boolean;
  loop: boolean;
  controls: boolean;
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};

// ONE STRING LITERAL, DELIBERATELY. The generated Supabase types parse this
// text to work out the row's shape; a value built with `+` is typed `string`
// and the whole query degrades to an error type.
const SELECT = "slot_key, media_type, media_id, tablet_media_id, mobile_media_id, poster_media_id, alt_text, object_fit, object_position, autoplay, muted, loop, controls, enabled, updated_at, updated_by";

type Raw = {
  slot_key: string; media_type: string;
  media_id: string | null; tablet_media_id: string | null;
  mobile_media_id: string | null; poster_media_id: string | null;
  alt_text: string | null; object_fit: string; object_position: string;
  autoplay: boolean; muted: boolean; loop: boolean; controls: boolean;
  enabled: boolean; updated_at: string | null; updated_by: string | null;
};

const toRow = (r: Raw): SlotRow => ({
  slotKey: r.slot_key,
  mediaType: r.media_type === "video" ? "video" : "image",
  mediaId: r.media_id,
  tabletMediaId: r.tablet_media_id,
  mobileMediaId: r.mobile_media_id,
  posterMediaId: r.poster_media_id,
  altText: r.alt_text ?? "",
  objectFit: r.object_fit === "contain" ? "contain" : "cover",
  objectPosition: r.object_position as ObjectPosition,
  autoplay: r.autoplay,
  muted: r.muted,
  loop: r.loop,
  controls: r.controls,
  enabled: r.enabled,
  updatedAt: r.updated_at,
  updatedBy: r.updated_by,
});

/** Every slot that has been configured, keyed by slot_key. A key that is
 *  absent has never been filled — which is not a gap, it is the default. */
export async function listConfiguredSlots(supabase: Client): Promise<Map<string, SlotRow>> {
  const { data } = await supabase.from("media_slots").select(SELECT);
  return new Map((data ?? []).map((r) => [r.slot_key, toRow(r as Raw)]));
}

/** The configured rows for one entity, merged with the DECLARED slots so the
 *  admin screen lists every position that exists, filled or not. */
export async function slotsForEntity(
  supabase: Client, entityType: SlotEntity, entityId: string,
): Promise<{ def: SlotDef; row: SlotRow | null }[]> {
  const defs = slotsFor(entityType, entityId);
  if (defs.length === 0) return [];
  const { data } = await supabase.from("media_slots").select(SELECT)
    .in("slot_key", defs.map((d) => d.key));
  const rows = new Map((data ?? []).map((r) => [r.slot_key, toRow(r as Raw)]));
  return defs.map((def) => ({ def, row: rows.get(def.key) ?? null }));
}

/** How many of an entity's slots are filled — the count the list screens show
 *  so an operator can see at a glance what still uses the built-in art. */
export function filledCount(rows: { row: SlotRow | null }[]): number {
  return rows.filter((r) => r.row && r.row.mediaId && r.row.enabled).length;
}

/* ── MEDIA LIBRARY, FOR THE PICKER ───────────────────────────────────────── */

export type LibraryItem = {
  id: string;
  kind: string;
  url: string | null;
  posterUrl: string | null;
  title: string | null;
  alt: string | null;
  folder: string | null;
  tags: string[];
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  mime: string | null;
  createdAt: string;
};

/**
 * The library, as the picker shows it. Admin-only by RLS.
 *
 * Deliberately capped: a picker that loads two thousand rows to show twenty is
 * a picker that is slow forever. The cap is generous now and the search
 * narrows it — if the library ever outgrows it, that is the moment to page it,
 * not before.
 */
export async function listLibrary(
  supabase: Client, opts: { kind?: "image" | "video"; limit?: number } = {},
): Promise<LibraryItem[]> {
  let query = supabase.from("media_assets")
    .select("id, kind, storage_path, external_url, poster_url, title, alt, folder, tags, width, height, size_bytes, mime, created_at")
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 300);
  if (opts.kind) query = query.eq("kind", opts.kind);
  const { data } = await query;

  const publicUrl = (path: string | null) =>
    path ? supabase.storage.from("media").getPublicUrl(path).data.publicUrl : null;

  return (data ?? []).map((a) => ({
    id: a.id,
    kind: a.kind,
    url: publicUrl(a.storage_path) ?? a.external_url,
    posterUrl: a.poster_url,
    title: a.title,
    alt: a.alt,
    folder: a.folder,
    tags: a.tags ?? [],
    width: a.width,
    height: a.height,
    sizeBytes: a.size_bytes,
    mime: a.mime,
    createdAt: a.created_at,
  }));
}

/* ── WHERE IS IT USED ────────────────────────────────────────────────────── */

export type Usage = { kind: string; key: string; label: string };

/**
 * Every place one file is referenced. Asked before a delete and shown next to
 * each file in the library, because "used in 6 places" is the difference
 * between deleting confidently and deleting blind.
 */
export async function mediaUsage(supabase: Client, mediaId: string): Promise<Usage[]> {
  const { data } = await supabase.rpc("media_usage", { p_media_id: mediaId });
  return (data ?? []).map((u) => ({
    kind: u.usage_kind,
    key: u.usage_key,
    label: u.usage_label,
  }));
}

/** Usage counts for a whole page of the library, in ONE query rather than one
 *  per tile — the library grid shows the number on every card. */
export async function usageCounts(
  supabase: Client, mediaIds: readonly string[],
): Promise<Map<string, number>> {
  if (mediaIds.length === 0) return new Map();
  const counts = new Map<string, number>();
  // Slots are the common case and answerable in one round trip; a CMS page
  // reference is rarer and is resolved per file only when somebody opens the
  // detail or tries to delete.
  const { data } = await supabase.from("media_slots")
    .select("media_id, tablet_media_id, mobile_media_id, poster_media_id");
  for (const row of data ?? []) {
    for (const id of [row.media_id, row.tablet_media_id, row.mobile_media_id, row.poster_media_id]) {
      if (id && mediaIds.includes(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

/* ── BANNERS ─────────────────────────────────────────────────────────────── */

export type BannerRow = {
  bannerKey: string;
  placement: string;
  label: Record<string, string>;
  body: Record<string, string>;
  ctaLabel: Record<string, string>;
  ctaUrl: string | null;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
  slotKey: string;
};

export async function listBanners(supabase: Client): Promise<BannerRow[]> {
  const { data } = await supabase.from("app_banners")
    .select("banner_key, placement, label, body, cta_label, cta_url, active, starts_at, ends_at, sort_order")
    .order("placement").order("sort_order");
  const bag = (v: unknown): Record<string, string> =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  return (data ?? []).map((b) => ({
    bannerKey: b.banner_key,
    placement: b.placement,
    label: bag(b.label),
    body: bag(b.body),
    ctaLabel: bag(b.cta_label),
    ctaUrl: b.cta_url,
    active: b.active,
    startsAt: b.starts_at,
    endsAt: b.ends_at,
    sortOrder: b.sort_order ?? 100,
    slotKey: bannerSlotKey(b.banner_key),
  }));
}

/** How many slots the product declares in total, for the admin's overview. */
export const DECLARED_SLOT_COUNT = MEDIA_SLOTS.length;
