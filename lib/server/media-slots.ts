import "server-only";
import { unstable_cache } from "next/cache";
import { createClient as createAnonClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/config";
import type { Client } from "@/lib/services/workspace";
import {
  isObjectFit, isObjectPosition, isSlotMediaType,
  type ObjectFit, type ObjectPosition, type SlotMediaType,
} from "@/lib/media-slots";

/**
 * READING A SCREEN'S MEDIA SLOTS.
 *
 * One call per screen, never one per card. The dashboard paints six category
 * tiles and a hero; the tool catalogue paints a dozen cards. Asking for each
 * of those separately is the "20 requests for 20 cards" the brief refuses, and
 * it would put a round trip in front of every tile on the most-visited page in
 * the product.
 *
 * READ THROUGH media_slots_resolve(), NOT THE TABLES. `media_slots` is
 * admin-only and `media_assets` has been admin-only since 0089 — a customer
 * loading their dashboard is neither. The definer function takes the keys the
 * screen is about to paint and returns those rows joined to their files: no
 * listing, no enumeration, nothing that is not already on the page.
 *
 * CACHED, AND INVALIDATED ON SAVE. Slot configuration is identical for every
 * customer, so it is read once and served from the cache until an admin
 * changes something — which is what makes "zmieniam zdjęcie z admina i widać
 * je od razu, bez deployu" true. The cached client is anonymous on purpose:
 * nothing user-scoped may live inside a shared cache entry.
 */

export const MEDIA_SLOT_TAG = "media-slots";

/** What one configured slot resolves to. Absent from the map = use the
 *  fallback, which is how every surface keeps the art it draws today. */
export type ResolvedSlot = {
  key: string;
  mediaType: SlotMediaType;
  alt: string;
  fit: ObjectFit;
  position: ObjectPosition;
  autoplay: boolean;
  muted: boolean;
  loop: boolean;
  controls: boolean;
  /** The desktop file, and the only one that is required. */
  desktop: string;
  desktopWidth?: number;
  desktopHeight?: number;
  /** width → url, for an image's srcset. */
  variants?: Record<string, string>;
  /** Overrides. Absent means "use the desktop file at this width too". */
  tablet?: string;
  mobile?: string;
  poster?: string;
};

export type SlotMap = Map<string, ResolvedSlot>;

const EMPTY: SlotMap = new Map();

/** The public URL of a stored object, or an external one as given. A row with
 *  neither points at nothing and is treated as an unfilled slot. */
function publicUrl(path: string | null, external: string | null): string | null {
  if (external) return /^https:\/\//i.test(external) ? external : null;
  if (!path) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/media/${encodeURI(path)}`;
}

type Row = {
  slot_key: string;
  media_type: string;
  alt_text: string | null;
  object_fit: string;
  object_position: string;
  autoplay: boolean;
  muted: boolean;
  loop: boolean;
  controls: boolean;
  desktop_path: string | null;
  desktop_url: string | null;
  desktop_width: number | null;
  desktop_height: number | null;
  desktop_variants: unknown;
  tablet_path: string | null;
  tablet_url: string | null;
  mobile_path: string | null;
  mobile_url: string | null;
  poster_path: string | null;
  poster_url: string | null;
};

function toSlot(row: Row): ResolvedSlot | null {
  const desktop = publicUrl(row.desktop_path, row.desktop_url);
  // A slot whose file was deleted has no desktop URL. It is not an error and
  // it is not a broken image — it is an unfilled slot, and the surface draws
  // its fallback exactly as it did before anyone touched it.
  if (!desktop) return null;

  const variants = row.desktop_variants
    && typeof row.desktop_variants === "object"
    && !Array.isArray(row.desktop_variants)
    ? Object.fromEntries(
        Object.entries(row.desktop_variants as Record<string, unknown>)
          .filter(([, v]) => typeof v === "string" && /^https:\/\//i.test(v)) as [string, string][],
      )
    : undefined;

  return {
    key: row.slot_key,
    mediaType: isSlotMediaType(row.media_type) ? row.media_type : "image",
    alt: row.alt_text ?? "",
    // The database constrains both, but the value still becomes CSS, so it is
    // checked again here rather than trusted across the boundary.
    fit: isObjectFit(row.object_fit) ? row.object_fit : "cover",
    position: isObjectPosition(row.object_position) ? row.object_position : "center center",
    autoplay: row.autoplay,
    muted: row.muted,
    loop: row.loop,
    controls: row.controls,
    desktop,
    desktopWidth: row.desktop_width ?? undefined,
    desktopHeight: row.desktop_height ?? undefined,
    variants: variants && Object.keys(variants).length > 0 ? variants : undefined,
    tablet: publicUrl(row.tablet_path, row.tablet_url) ?? undefined,
    mobile: publicUrl(row.mobile_path, row.mobile_url) ?? undefined,
    poster: publicUrl(row.poster_path, row.poster_url) ?? undefined,
  };
}

/**
 * Resolve the given slot keys. Pass every key the screen will paint; the call
 * is one round trip whatever the count.
 *
 * The client argument is accepted and deliberately unused for the read: the
 * cache entry is shared by every visitor, so it must be built with an
 * anonymous client and can never carry one customer's session.
 */
export async function loadSlots(_supabase: Client, keys: readonly string[]): Promise<SlotMap> {
  if (keys.length === 0) return EMPTY;
  // THE MAP IS BUILT HERE, OUTSIDE THE CACHE, and that is the whole point of
  // the split below.
  return new Map(Object.entries(await readSlots([...new Set(keys)].sort())));
}

/**
 * WHAT THE CACHE HOLDS IS A PLAIN OBJECT, NOT A MAP — and this is not a
 * stylistic choice.
 *
 * `unstable_cache` persists what the function returns and hands back a
 * DESERIALIZED copy on every hit. A `Map` does not survive that: it comes back
 * as `{}`, so `slots.get(...)` and `slots.has(...)` throw
 * "get is not a function" — on /home, /tools, /prompts, /k/[cat]/[wf] and the
 * generator panel, all at once, and only once the entry has been written and
 * read back. The first request after a deploy computes the value in-process
 * and works, which is exactly what made this look like a random crash with no
 * deploy behind it.
 *
 * So the cached payload is a `Record<string, ResolvedSlot>` — JSON in, JSON
 * out, identical on both sides of the cache — and `loadSlots` turns it into
 * the `Map` the callers have always been given. Nothing outside this file
 * changes, and nothing outside this file can be broken by it again.
 */
const readSlots = unstable_cache(
  async (keys: string[]): Promise<Record<string, ResolvedSlot>> => {
    const anon = createAnonClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error } = await anon.rpc("media_slots_resolve", { p_keys: keys });
    // A screen whose slots cannot be read still renders — every surface has a
    // fallback, so the worst case is the interface it had before this feature.
    if (error || !data) return {};
    const out: Record<string, ResolvedSlot> = {};
    for (const row of data as Row[]) {
      const slot = toSlot(row);
      if (slot) out[slot.key] = slot;
    }
    return out;
  },
  ["media-slots"],
  { revalidate: 600, tags: [MEDIA_SLOT_TAG] },
);

/* ── BANNERS ─────────────────────────────────────────────────────────────── */

export type LiveBanner = {
  key: string;
  placement: string;
  label: Record<string, string>;
  body: Record<string, string>;
  ctaLabel: Record<string, string>;
  ctaUrl: string | null;
};

/**
 * The banners live on one surface right now. Read with the CALLER'S client so
 * the `active` + date-window policy decides — an expired campaign is not
 * something the application should have to remember to filter.
 */
export async function loadBanners(supabase: Client, placement: string): Promise<LiveBanner[]> {
  const { data } = await supabase.from("app_banners")
    .select("banner_key, placement, label, body, cta_label, cta_url, sort_order")
    .eq("placement", placement)
    .order("sort_order")
    .limit(3);
  const localized = (v: unknown): Record<string, string> =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  return (data ?? []).map((b) => ({
    key: b.banner_key,
    placement: b.placement,
    label: localized(b.label),
    body: localized(b.body),
    ctaLabel: localized(b.cta_label),
    // A banner links somewhere in the app or to an https address; anything
    // else is not a destination this product sends a customer to.
    ctaUrl: typeof b.cta_url === "string"
      && (b.cta_url.startsWith("/") || /^https:\/\//i.test(b.cta_url))
      ? b.cta_url : null,
  }));
}
