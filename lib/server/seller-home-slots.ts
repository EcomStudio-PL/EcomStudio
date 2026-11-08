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
 * The keys of /home's slot reads: the tool cards and the campaign banners it
 * always read FIRST, then its own section slots (the registry's and the
 * layout's), cut into calls of at most SLOT_READ_CAP keys.
 *
 * One call past the cap would return nothing at all — every tool card and
 * banner picture would vanish with it — so no call ever passes it; a layout
 * that grows only adds a call. Duplicates are read once.
 */
export function slotReadBatches(always: readonly string[], section: readonly string[]): string[][] {
  const keys = [...new Set([...always, ...section])];
  const batches: string[][] = [];
  for (let i = 0; i < keys.length; i += SLOT_READ_CAP) batches.push(keys.slice(i, i + SLOT_READ_CAP));
  return batches;
}

/** The /home section slots an admin filled — only those. */
export type HomeSlotMap = Readonly<Record<string, ResolvedSlot>>;

/** The filled section slots out of the screen's read; none → undefined,
 *  so nothing new travels with the page while the editor has not been used.
 *  `keys`: the section slots the page paints (the layout's — its pairs, grid
 *  photos and their product photos); the registry's default list without one. */
export function filledHomeSlots(slots: SlotMap, keys: readonly string[] = HOME_SECTION_SLOT_KEYS): HomeSlotMap | undefined {
  const out: Record<string, ResolvedSlot> = {};
  for (const key of keys) {
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
