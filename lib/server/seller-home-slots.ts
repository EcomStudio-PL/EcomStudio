import "server-only";
import { allElements, icePageFor } from "@/lib/ice/registry";
import { SUPABASE_URL } from "@/lib/supabase/config";
import type { MediaSrc } from "@/lib/seller-home-config";
import type { UploadToolView } from "@/lib/seller-home-model";
import type { ResolvedSlot, SlotMap } from "@/lib/server/media-slots";

/**
 * /HOME'S OWN SECTION SLOTS — the pictures and clips an admin assigns in the
 * visual editor (media_slots rows of entity "global" / "sellerHome", keyed by
 * the config's `homeMedia.*` names).
 *
 * THE LIST IS THE EDITOR'S, NOT A SECOND ONE. It is read from the editor's
 * registry (lib/ice/registry.ts), so the keys /home reads and the keys the
 * editor may write cannot drift apart: a slot the registry drops stops being
 * read here, and one it adds is read here with no edit.
 *
 * NO ROW = NOTHING CHANGES. Every key the read returns nothing for is simply
 * absent from the map, and every section paints exactly what it painted
 * before (config file → admin card picture → shipped example → placeholder).
 * When not one of them is filled — today, everywhere — the sections are not
 * even handed a map.
 */

/** media_slots_resolve (0091) and media_slots_resolve_v2 (0141) answer at
 *  most this many keys per call: past it they return NO rows at all, for any
 *  key. */
export const SLOT_READ_CAP = 200;

/** Every /home section slot the editor lists (entity "global"), in registry
 *  order: upload samples, before/after pairs, banners, the showcase,
 *  Miniaturki, Sesje. The carousel and featured tiles are NOT here — they
 *  keep the tool-card slot they share with /tools. */
export const HOME_SECTION_SLOT_KEYS: readonly string[] = (() => {
  const page = icePageFor("/home");
  const keys = new Set<string>();
  for (const element of page ? allElements(page) : []) {
    for (const slot of element.slots ?? []) if (slot.entityType === "global") keys.add(slot.key);
  }
  return [...keys];
})();

/**
 * The keys of /home's ONE batched slot read: the tool cards and the campaign
 * banners it always read, plus its own section slots.
 *
 * Over the resolver's cap the read would return nothing at all — every tool
 * card and banner picture would vanish with it. So past the cap the section
 * slots are left out (they fall back to their placeholders) and the cards
 * and banners keep working; the tests hold the real count far below it.
 */
export function sellerHomeSlotKeys(cardSlots: readonly string[], bannerSlots: readonly string[]): string[] {
  const always = [...new Set([...cardSlots, ...bannerSlots])];
  const all = [...new Set([...always, ...HOME_SECTION_SLOT_KEYS])];
  if (all.length <= SLOT_READ_CAP) return all;
  console.error(`[seller-home] ${all.length} slot keys exceed the resolver's ${SLOT_READ_CAP}; the section slots are skipped`);
  return always;
}

/** The /home section slots an admin filled — only those. */
export type HomeSlotMap = Readonly<Record<string, ResolvedSlot>>;

/** The filled section slots out of the screen's one read; none → undefined,
 *  so nothing new travels with the page while the editor has not been used. */
export function filledHomeSlots(slots: SlotMap): HomeSlotMap | undefined {
  const out: Record<string, ResolvedSlot> = {};
  for (const key of HOME_SECTION_SLOT_KEYS) {
    const slot = slots.get(key);
    if (slot) out[key] = slot;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/* ── upload samples ─────────────────────────────────────────────────────── */

/** The widest sample the tile downloads: plenty for a tool's input, and no
 *  6000px original fetched into a seller's browser for a 44px circle. */
export const SAMPLE_MAX_WIDTH = 1600;

/**
 * The file the upload tile fetches for a filled sample slot: the largest WebP
 * derivative no wider than SAMPLE_MAX_WIDTH (Admin → Media's 640 / 1024 / 1600
 * copies), else the original. Images only — a clip is not a product photo.
 *
 * Null when the tile could not fetch it: the browser may only `fetch()` from
 * the Supabase project (the CSP's connect-src), so a sample on any other host
 * would look pickable and fail when picked. It stays a placeholder instead.
 */
export function sampleSource(slot: ResolvedSlot): string | null {
  if (slot.mediaType !== "image") return null;
  let best: { width: number; url: string } | null = null;
  for (const [key, url] of Object.entries(slot.variants ?? {})) {
    const width = Number(key);
    if (!Number.isFinite(width) || width <= 0 || width > SAMPLE_MAX_WIDTH) continue;
    if (!/\.webp$/i.test(url.split(/[?#]/)[0])) continue;
    if (!best || width > best.width) best = { width, url };
  }
  const url = best?.url ?? slot.desktop;
  try {
    return new URL(url).origin === new URL(SUPABASE_URL).origin ? url : null;
  } catch {
    return null;
  }
}

/**
 * The upload pills with their filled sample slots painted in — as COPIES.
 * `UploadToolView.samples` is the config's own array (a module singleton
 * shared by every request), so it is never written to: a filled sample
 * becomes a new MediaSrc with `src` set, in a new array, on a new pill
 * object. A sample the config already names keeps its file (config first).
 * Nothing filled → the very same pills, so the tile's props are unchanged.
 */
export function withSampleSlots(tools: UploadToolView[], home: HomeSlotMap | undefined): UploadToolView[] {
  if (!home) return tools;
  return tools.map((tool) => {
    let changed = false;
    const samples = tool.samples.map((media): MediaSrc => {
      const slot = media.src || !Object.prototype.hasOwnProperty.call(home, media.configKey) ? undefined : home[media.configKey];
      const src = slot ? sampleSource(slot) : null;
      if (!src) return media;
      changed = true;
      return { ...media, src };
    });
    return changed ? { ...tool, samples } : tool;
  });
}
