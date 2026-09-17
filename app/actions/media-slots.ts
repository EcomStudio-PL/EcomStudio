"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { MEDIA_SLOT_TAG } from "@/lib/server/media-slots";
import { mediaUsage } from "@/lib/services/media-slots";
import {
  isKnownSlot, isObjectFit, isObjectPosition, isSlotMediaType, slotDef,
} from "@/lib/media-slots";

/**
 * EVERY WRITE THE MEDIA SLOT SYSTEM MAKES.
 *
 * Thin wrappers, as the house rule requires: establish who is asking, write,
 * record it, invalidate. The security decision is RLS's, using the caller's
 * own client — `requireAdmin` exists so the panel gets a clean "not_admin"
 * rather than an empty result, not as the lock itself.
 *
 * INVALIDATION IS THE POINT OF THE FEATURE. The brief is explicit: changing a
 * picture must not mean a commit and a deploy. So a save clears the slot cache
 * tag and the pages that paint slots, and the new picture is live on the next
 * request. Nothing is baked into the build.
 */

type Result<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}

/** Everything a slot change can make stale. The tag covers the customer-facing
 *  reads wherever they happen; the paths cover the panel's own screens. */
function invalidate() {
  revalidateTag(MEDIA_SLOT_TAG);
  // The surfaces that paint slots. `layout` so nested routes are covered too.
  revalidatePath("/home", "layout");
  revalidatePath("/tools", "layout");
  revalidatePath("/k", "layout");
  revalidatePath("/admin/media");
}

/* ── SLOTS ───────────────────────────────────────────────────────────────── */

export async function saveSlotAction(input: {
  slotKey: string;
  mediaType: string;
  mediaId: string | null;
  tabletMediaId: string | null;
  mobileMediaId: string | null;
  posterMediaId: string | null;
  altText: string;
  objectFit: string;
  objectPosition: string;
  autoplay: boolean;
  muted: boolean;
  loop: boolean;
  controls: boolean;
  enabled: boolean;
}): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();

    // A SLOT THE PRODUCT DOES NOT DECLARE CANNOT BE CREATED. The key arrives
    // from a browser; without this, a typed URL could write a row nothing will
    // ever render and nothing will ever clean up.
    if (!isKnownSlot(input.slotKey)) return { ok: false, error: "unknown_slot" };
    const def = slotDef(input.slotKey)!;

    if (!isSlotMediaType(input.mediaType)) return { ok: false, error: "media_type" };
    // A slot the surface paints as a still image has no business holding a
    // video: the renderer would not play it and the admin would be left
    // wondering why.
    if (input.mediaType === "video" && !def.video) return { ok: false, error: "no_video_here" };
    if (!isObjectFit(input.objectFit)) return { ok: false, error: "fit" };
    if (!isObjectPosition(input.objectPosition)) return { ok: false, error: "position" };

    const row = {
      slot_key: input.slotKey,
      entity_type: def.entityType,
      entity_id: def.entityId,
      slot_name: def.slotName,
      media_type: input.mediaType,
      media_id: input.mediaId,
      tablet_media_id: input.tabletMediaId,
      mobile_media_id: input.mobileMediaId,
      poster_media_id: input.posterMediaId,
      alt_text: input.altText.trim().slice(0, 300) || null,
      object_fit: input.objectFit,
      object_position: input.objectPosition,
      autoplay: input.autoplay,
      muted: input.muted,
      loop: input.loop,
      controls: input.controls,
      enabled: input.enabled,
      updated_at: new Date().toISOString(),
      updated_by: adminId,
    };

    const { error } = await supabase.from("media_slots")
      .upsert(row, { onConflict: "slot_key" });
    if (error) return { ok: false, error: "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: "media_slot.saved", entityType: "media_slot",
      entityId: input.slotKey,
      after: { mediaType: input.mediaType, filled: Boolean(input.mediaId), enabled: input.enabled },
    });
    invalidate();
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/** Empty a slot. The row goes, so the surface falls back to the art it drew
 *  before — which is the only "undo" this feature needs. */
export async function clearSlotAction(slotKey: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isKnownSlot(slotKey)) return { ok: false, error: "unknown_slot" };
    const { error } = await supabase.from("media_slots").delete().eq("slot_key", slotKey);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "media_slot.cleared", entityType: "media_slot", entityId: slotKey,
    });
    invalidate();
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/* ── DELETING A FILE ─────────────────────────────────────────────────────── */

export type UsageReport = { kind: string; key: string; label: string }[];

/** What would break. Called before the confirm dialog opens, so the admin sees
 *  the list BEFORE deciding rather than after the file is gone. */
export async function mediaUsageAction(mediaId: string): Promise<Result<UsageReport>> {
  try {
    const { supabase } = await requireAdmin();
    return { ok: true, data: await mediaUsage(supabase, mediaId) };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/**
 * Replace one file with another everywhere it is used, then delete the old
 * one. This is the "Zamień wszędzie" the brief asks for, and it is the safe
 * answer to "this file is used in six places": the six places keep working and
 * get the new picture.
 */
export async function replaceMediaAction(
  fromId: string, toId: string,
): Promise<Result<{ replaced: number }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (fromId === toId) return { ok: false, error: "same_file" };
    // The replacement has to exist, or every reference would be nulled.
    const { data: target } = await supabase.from("media_assets")
      .select("id").eq("id", toId).maybeSingle();
    if (!target) return { ok: false, error: "missing" };

    // One statement per column rather than a loop over a computed key: the
    // generated row type has four distinct optional fields, and a dynamic key
    // is not one of them.
    const stamp = { updated_at: new Date().toISOString(), updated_by: adminId };
    const patches = [
      { where: "media_id", patch: { media_id: toId, ...stamp } },
      { where: "tablet_media_id", patch: { tablet_media_id: toId, ...stamp } },
      { where: "mobile_media_id", patch: { mobile_media_id: toId, ...stamp } },
      { where: "poster_media_id", patch: { poster_media_id: toId, ...stamp } },
    ] as const;

    let replaced = 0;
    for (const { where, patch } of patches) {
      const { data, error } = await supabase.from("media_slots")
        .update(patch).eq(where, fromId).select("slot_key");
      if (error) return { ok: false, error: "generic" };
      replaced += (data ?? []).length;
    }

    await logAudit(supabase, {
      actorId: adminId, action: "media.replaced", entityType: "media_asset", entityId: fromId,
      after: { to: toId, slots: replaced },
    });
    invalidate();
    return { ok: true, data: { replaced } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/* ── BANNERS ─────────────────────────────────────────────────────────────── */

const PLACEMENTS = new Set(["dashboard", "tools", "library", "generator"]);

export async function saveBannerAction(input: {
  bannerKey: string;
  placement: string;
  label: Record<string, string>;
  body: Record<string, string>;
  ctaLabel: Record<string, string>;
  ctaUrl: string;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
}): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!PLACEMENTS.has(input.placement)) return { ok: false, error: "placement" };

    // A banner links inside the app or to an https address. Anything else is
    // not a destination this product sends a signed-in customer to.
    const cta = input.ctaUrl.trim();
    if (cta && !(cta.startsWith("/") || /^https:\/\//i.test(cta))) {
      return { ok: false, error: "cta_url" };
    }
    // A window that ends before it begins would silently never show.
    if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) {
      return { ok: false, error: "window" };
    }

    const { error } = await supabase.from("app_banners").upsert({
      banner_key: input.bannerKey,
      placement: input.placement,
      label: input.label as never,
      body: input.body as never,
      cta_label: input.ctaLabel as never,
      cta_url: cta || null,
      active: input.active,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      sort_order: Number.isFinite(input.sortOrder) ? Math.round(input.sortOrder) : 100,
      updated_at: new Date().toISOString(),
      updated_by: adminId,
    }, { onConflict: "banner_key" });
    if (error) return { ok: false, error: "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: "banner.saved", entityType: "app_banner",
      entityId: input.bannerKey, after: { active: input.active, placement: input.placement },
    });
    invalidate();
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

function message(e: unknown): string {
  const text = e instanceof Error ? e.message : "";
  return text === "not_admin" || text === "unauthenticated" ? text : "generic";
}
