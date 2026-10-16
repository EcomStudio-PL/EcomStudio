"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { enforceLoginSecurity } from "@/lib/server/login-security";
import { MEDIA_SLOT_TAG } from "@/lib/server/media-slots";
import { TOOL_GUIDES_TAG } from "@/lib/server/tool-guides-published";
import { readGuideRow, readGuideSlots } from "@/lib/services/tool-guides";
import {
  DEFAULT_STEP_ARTS, GUIDE_MAX_STEPS, guideSlotKey, isGuideTool, normalizeGuideContent, type GuideToolKey,
} from "@/lib/tool-guides";
import type { Json } from "@/lib/database.types";

/**
 * TOOL GUIDES — the admin's save (the customer's one write, "I have seen this
 * tutorial", is app/actions/tool-guide-seen.ts). Thin wrappers: who is asking → validate → one write path
 * (an RPC or RLS-guarded rows) → audit → the one cache tag the change makes
 * stale. Nothing here reaches a model, a provider, a price or the ledger.
 */

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/* ── ADMIN ─────────────────────────────────────────────────────────────── */

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("id, role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  // The admin panel's own gate: a session on a device the step-up has not
  // verified changes nothing a customer sees.
  if (await enforceLoginSecurity(supabase)) throw new Error("step_up_required");
  return { supabase, adminId: user.id };
}

export type SaveToolGuideInput = {
  tool: string;
  tutorialEnabled: boolean;
  starterEnabled: boolean;
  /** The admin's copy, or null to go back to the shipped default. */
  content: unknown;
  /** Library asset per tutorial step (by position) and for the starter;
   *  null = the built-in illustration / the tool's catalogue picture. */
  images: { steps: (string | null)[]; starter: string | null };
  /** updated_at of the row the form was opened on; null = there was none. */
  base: string | null;
  /** Raise the version so everyone sees the tutorial once more. */
  showAgain: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Save and publish one tool's guide. Compare-and-set on updated_at, so two
 * admins editing the same tool cannot overwrite each other silently; the
 * pictures go through media_slots_write (admin check, all-or-nothing,
 * compare-and-set per slot) like every other slot in the product.
 */
export async function saveToolGuideAction(input: SaveToolGuideInput): Promise<Result<{ updatedAt: string; version: number }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isGuideTool(input.tool)) return { ok: false, error: "unknown_tool" };
    const tool: GuideToolKey = input.tool;

    let content: Json | null = null;
    // The shipped tutorial has one step per default illustration.
    let stepCount = DEFAULT_STEP_ARTS[tool].length;
    if (input.content !== null) {
      const n = normalizeGuideContent(input.content);
      if (!n.ok) return { ok: false, error: `invalid_${n.problem}` };
      content = n.content as unknown as Json;
      stepCount = n.content.tutorial.steps.length;
    }

    // Pictures: library images only, one per position that exists.
    const wanted = new Map<string, string | null>();
    const stepImages = Array.isArray(input.images?.steps) ? input.images.steps : [];
    for (let i = 0; i < GUIDE_MAX_STEPS; i++) {
      const id = i < stepCount ? stepImages[i] ?? null : null;
      wanted.set(guideSlotKey(tool, "tutorial", i + 1), id);
    }
    wanted.set(guideSlotKey(tool, "starter", 1), input.images?.starter ?? null);
    const ids = [...new Set([...wanted.values()].filter((v): v is string => v !== null))];
    if (ids.some((id) => !UUID.test(id))) return { ok: false, error: "invalid_image" };
    if (ids.length > 0) {
      const { data: assets, error } = await supabase.from("media_assets").select("id, kind, storage_path, external_url").in("id", ids);
      if (error) return { ok: false, error: "generic" };
      const ok = new Set((assets ?? []).filter((a) => a.kind === "image" && (a.storage_path || a.external_url)).map((a) => a.id));
      if (ids.some((id) => !ok.has(id))) return { ok: false, error: "invalid_image" };
    }

    // The pictures as they are now — read BEFORE anything is written, so a
    // failed read stops the save instead of turning removals into no-ops.
    const slots = await readGuideSlots(supabase, [...wanted.keys()]);
    if (!slots) return { ok: false, error: "images_failed" };

    // The row, compare-and-set.
    const current = await readGuideRow(supabase, tool);
    if (current === "unavailable") return { ok: false, error: "migration_pending" };
    // Instants, not spellings: Postgres and JavaScript write the same moment
    // differently, and the form may hand back either.
    const instant = (v: string | null | undefined) => (v ? Date.parse(v) : null);
    if (instant(current?.updated_at) !== instant(input.base)) return { ok: false, error: "conflict" };
    const now = new Date().toISOString();
    const version = (current?.tutorial_version ?? 1) + (input.showAgain ? 1 : 0);
    const values = {
      tutorial_enabled: Boolean(input.tutorialEnabled),
      starter_enabled: Boolean(input.starterEnabled),
      tutorial_version: Math.min(version, 1000000),
      content,
      updated_at: now,
      updated_by: adminId,
    };
    let savedAt = now;
    if (current) {
      const { data, error } = await supabase.from("tool_guides").update(values)
        .eq("tool_key", tool).eq("updated_at", current.updated_at).select("updated_at");
      if (error) return { ok: false, error: "generic" };
      if ((data ?? []).length === 0) return { ok: false, error: "conflict" };
      savedAt = data![0].updated_at;
    } else {
      const { data, error } = await supabase.from("tool_guides").insert({ tool_key: tool, ...values }).select("updated_at");
      if (error) return { ok: false, error: error.code === "23505" ? "conflict" : "generic" };
      savedAt = data?.[0]?.updated_at ?? now;
    }

    // The pictures that changed, in one all-or-nothing call.
    const writes = [...wanted.entries()].flatMap(([key, mediaId]) => {
      const cur = slots.get(key);
      if ((cur?.mediaId ?? null) === mediaId) return [];
      if (!cur && mediaId === null) return [];
      return [{
        key, entity_type: "tool", entity_id: tool, slot_name: key.split(".").slice(2).join("."),
        media_type: "image", media_id: mediaId ?? "", tablet_media_id: "", mobile_media_id: "", poster_media_id: "",
        alt_text: "", object_fit: "cover", object_position: "center center", base: cur?.updatedAt ?? "",
      }];
    });
    let imageError: "conflict_images" | "images_failed" | null = null;
    if (writes.length > 0) {
      const { error } = await supabase.rpc("media_slots_write", { p_writes: writes as unknown as Json, p_action: "save" });
      if (error) imageError = /conflict/.test(error.message) ? "conflict_images" : "images_failed";
      else revalidateTag(MEDIA_SLOT_TAG);
    }

    // The row IS written even when its pictures failed: audit it and let
    // customers see it either way. The form keeps the pictures to retry.
    await logAudit(supabase, {
      actorId: adminId,
      action: "ai_tool.guide_saved",
      entityType: "tool_guide",
      entityId: tool,
      after: {
        tutorialEnabled: values.tutorial_enabled, starterEnabled: values.starter_enabled,
        version: values.tutorial_version, customContent: content !== null,
        images: imageError ? 0 : writes.length, ...(imageError ? { imageError } : {}),
      },
    });
    revalidateTag(TOOL_GUIDES_TAG);
    revalidatePath(`/admin/ai/${tool}`);
    if (imageError) return { ok: false, error: imageError };
    return { ok: true, data: { updatedAt: savedAt, version: values.tutorial_version } };
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    return { ok: false, error: ["unauthenticated", "not_admin", "step_up_required"].includes(code) ? code : "generic" };
  }
}
