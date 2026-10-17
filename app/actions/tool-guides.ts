"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { enforceLoginSecurity } from "@/lib/server/login-security";
import { MEDIA_SLOT_TAG } from "@/lib/server/media-slots";
import { TOOL_GUIDES_TAG } from "@/lib/server/tool-guides-published";
import { readGuideRow, readGuideSlots } from "@/lib/services/tool-guides";
import {
  DEFAULT_STEP_ARTS, GUIDE_MAX_STEPS, guideHasStarter, guideSlotKey, isGuideTool, normalizeGuideContent, type GuideToolKey,
} from "@/lib/tool-guides";
import type { Json } from "@/lib/database.types";

/**
 * TOOL GUIDES — the admin's save and "show again" (the customer's one write,
 * "I have seen this tutorial", is app/actions/tool-guide-seen.ts). Thin wrappers: who is asking → validate → one write path
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
  /** Per picture slot, the updated_at the form was opened on (null = no
   *  slot yet) — a picture changed elsewhere since then (e.g. Media →
   *  "Zamień wszędzie") is a conflict, not something to write back over. */
  imageBases?: Record<string, string | null>;
  /** Raise the version so everyone sees the tutorial once more. Still
   *  honoured for older callers; the admin editor always sends false and uses
   *  showToolGuideAgainAction instead, which publishes nothing else. */
  showAgain: boolean;
};

type Saved = { updatedAt: string; version: number; imageBases: Record<string, string | null> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Save and publish one tool's guide — all or nothing. Compare-and-set on the
 * row and on every picture against what the form was opened on, so neither
 * another admin nor a library-wide replace is overwritten silently. The
 * pictures (media_slots_write: admin check, all-or-nothing, compare-and-set
 * per slot, like every other slot in the product) go first, the row second;
 * if the row then loses a race, the pictures are put back, so customers never
 * see new pictures beside old steps.
 */
export async function saveToolGuideAction(input: SaveToolGuideInput): Promise<Result<Saved>> {
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

    // The pictures as they are now — read BEFORE anything is written. A
    // failed read stops the save with nothing written (it must not turn a
    // removal into a no-op).
    const slots = await readGuideSlots(supabase, [...wanted.keys()]);
    if (!slots) return { ok: false, error: "generic" };
    const instant = (v: string | null | undefined) => (v ? Date.parse(v) : null);
    if (input.imageBases) {
      for (const key of wanted.keys()) {
        if (instant(slots.get(key)?.updatedAt) !== instant(input.imageBases[key] ?? null)) {
          return { ok: false, error: "conflict_images" };
        }
      }
    }

    // The row, compare-and-set — checked before anything is written.
    const current = await readGuideRow(supabase, tool);
    if (current === "unavailable") return { ok: false, error: "migration_pending" };
    // Instants, not spellings: Postgres and JavaScript write the same moment
    // differently, and the form may hand back either.
    if (instant(current?.updated_at) !== instant(input.base)) return { ok: false, error: "conflict" };

    // 1. The pictures that changed, in one all-or-nothing call.
    const writes = [...wanted.entries()].flatMap(([key, mediaId]) => {
      const cur = slots.get(key);
      if ((cur?.mediaId ?? null) === mediaId) return [];
      if (!cur && mediaId === null) return [];
      return [slotWrite(tool, key, mediaId, cur?.updatedAt ?? "")];
    });
    let written: Record<string, string> = {};
    if (writes.length > 0) {
      const { data, error } = await supabase.rpc("media_slots_write", { p_writes: writes as unknown as Json, p_action: "save" });
      if (error) return { ok: false, error: /conflict/.test(error.message) ? "conflict_images" : "images_failed" };
      written = (data ?? {}) as Record<string, string>;
      revalidateTag(MEDIA_SLOT_TAG);
    }

    // 2. The row.
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
    let savedAt: string | null = null;
    let rowError = "generic";
    if (current) {
      const { data, error } = await supabase.from("tool_guides").update(values)
        .eq("tool_key", tool).eq("updated_at", current.updated_at).select("updated_at");
      if (!error && (data ?? []).length > 0) savedAt = data![0].updated_at;
      else if (!error) rowError = "conflict";
    } else {
      const { data, error } = await supabase.from("tool_guides").insert({ tool_key: tool, ...values }).select("updated_at");
      if (!error) savedAt = data?.[0]?.updated_at ?? now;
      else if (error.code === "23505") rowError = "conflict";
    }
    if (savedAt === null) {
      // The row lost a race after the pictures went in: put them back, so
      // nothing of this save stays visible. Best effort — a failure here
      // leaves pictures the next save shows as changed.
      const undo = writes.filter((w) => written[w.key]).map((w) =>
        slotWrite(tool, w.key, slots.get(w.key)?.mediaId ?? null, written[w.key]));
      if (undo.length > 0) {
        await supabase.rpc("media_slots_write", { p_writes: undo as unknown as Json, p_action: "restore" });
      }
      return { ok: false, error: rowError };
    }

    await logAudit(supabase, {
      actorId: adminId,
      action: "ai_tool.guide_saved",
      entityType: "tool_guide",
      entityId: tool,
      after: {
        tutorialEnabled: values.tutorial_enabled, starterEnabled: values.starter_enabled,
        version: values.tutorial_version, customContent: content !== null, images: writes.length,
      },
    });
    revalidateTag(TOOL_GUIDES_TAG);
    revalidatePath(`/admin/ai/${tool}`);
    const imageBases = Object.fromEntries([...wanted.keys()].map((key) =>
      [key, written[key] ?? slots.get(key)?.updatedAt ?? null]));
    return { ok: true, data: { updatedAt: savedAt, version: values.tutorial_version, imageBases } };
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    return { ok: false, error: ["unauthenticated", "not_admin", "step_up_required"].includes(code) ? code : "generic" };
  }
}

export type ShowToolGuideAgainInput = {
  tool: string;
  /** updated_at of the row the editor was opened on (or last saved to);
   *  null = there was none. */
  base: string | null;
};

type Shown = { updatedAt: string; version: number };

/**
 * "Pokaż ponownie wszystkim": raise ONE tool's tutorial version, so every
 * user sees it once more on their next visit (seen-state is "highest version
 * seen", so nothing anyone stored is deleted). Only the version and the stamp
 * change — copy, switches and pictures stay exactly as published, and nothing
 * the admin has not saved yet goes out with it. Compare-and-set on updated_at
 * like the save, so an increment never lands on a row someone else just wrote.
 * No row yet = the shipped default, both parts as they ship → kept, at v2.
 */
export async function showToolGuideAgainAction(input: ShowToolGuideAgainInput): Promise<Result<Shown>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!input || !isGuideTool(input.tool)) return { ok: false, error: "unknown_tool" };
    const tool: GuideToolKey = input.tool;

    const current = await readGuideRow(supabase, tool);
    if (current === "unavailable") return { ok: false, error: "migration_pending" };
    const instant = (v: string | null | undefined) => (v ? Date.parse(v) : null);
    if (instant(current?.updated_at) !== instant(input.base ?? null)) return { ok: false, error: "conflict" };

    const before = current?.tutorial_version ?? 1;
    const version = before + 1;
    const now = new Date().toISOString();
    const values = { tutorial_version: Math.min(version, 1000000), updated_at: now, updated_by: adminId };
    let savedAt: string;
    if (current) {
      const { data, error } = await supabase.from("tool_guides").update(values)
        .eq("tool_key", tool).eq("updated_at", current.updated_at).select("updated_at");
      if (error) return { ok: false, error: "generic" };
      if (!data || data.length === 0) return { ok: false, error: "conflict" };
      savedAt = data[0].updated_at;
    } else {
      const { data, error } = await supabase.from("tool_guides").insert({
        tool_key: tool, tutorial_enabled: true, starter_enabled: guideHasStarter(tool), content: null, ...values,
      }).select("updated_at");
      if (error) return { ok: false, error: error.code === "23505" ? "conflict" : "generic" };
      savedAt = data?.[0]?.updated_at ?? now;
    }

    await logAudit(supabase, {
      actorId: adminId,
      action: "ai_tool.guide_show_again",
      entityType: "tool_guide",
      entityId: tool,
      before: { version: before },
      after: { version: values.tutorial_version },
    });
    revalidateTag(TOOL_GUIDES_TAG);
    revalidatePath(`/admin/ai/${tool}`);
    return { ok: true, data: { updatedAt: savedAt, version: values.tutorial_version } };
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    return { ok: false, error: ["unauthenticated", "not_admin", "step_up_required"].includes(code) ? code : "generic" };
  }
}

/** One media_slots_write entry for a guide picture (null = no picture). */
function slotWrite(tool: GuideToolKey, key: string, mediaId: string | null, base: string) {
  return {
    key, entity_type: "tool", entity_id: tool, slot_name: key.split(".").slice(2).join("."),
    media_type: "image", media_id: mediaId ?? "", tablet_media_id: "", mobile_media_id: "", poster_media_id: "",
    alt_text: "", object_fit: "cover", object_position: "center center", base,
  };
}
