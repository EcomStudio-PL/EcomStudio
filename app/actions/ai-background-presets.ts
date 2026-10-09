"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { dispatchToken } from "@/lib/server/server-token";
import { PRESET_LIMIT, parsePresets, presetsDocument } from "@/lib/images/ai-background-presets";

/** The tool's registry key — its admin page is /admin/ai/[tool]. */
const TOOL_KEY = "tool_ai_background";

/**
 * "DODAJ TŁO AI" — save the operator's scene presets.
 *
 * Admin only. The list is validated with the same rules the server reads it
 * with (`parsePresets`), and refused whole if any entry would be dropped — a
 * save that silently loses a preset is worse than one that says why. The row
 * is private (migration 0138): customers never read it, and the log records
 * keys only, never a prompt. Before 0138 is applied nothing is saved at all.
 */
export async function saveAiBackgroundPresetsAction(list: unknown): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "forbidden" };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return { ok: false, error: "forbidden" };

  if (!Array.isArray(list) || list.length > PRESET_LIMIT) return { ok: false, error: "invalid" };
  const presets = parsePresets(list);
  if (presets.length !== list.length) return { ok: false, error: "invalid" };

  // FAIL CLOSED until migration 0138 is in: it is what makes this row private
  // (app_setting_is_private) and adds the server-only reader probed here. A
  // save before it would write GrovBase's scene wording into a row anyone
  // could read, so without the reader nothing is written.
  const token = dispatchToken();
  const probe = token ? await supabase.rpc("ai_background_presets_read", { p_token: token }) : null;
  if (!probe || probe.error) return { ok: false, error: "migration_pending" };

  const { data: before } = await supabase.from("app_settings")
    .select("value").eq("key", "ai_background_presets").maybeSingle();
  const { error } = await supabase.from("app_settings").upsert(
    { key: "ai_background_presets", value: presetsDocument(presets) as never },
    { onConflict: "key" },
  );
  if (error) return { ok: false, error: "generic" };

  const keys = (raw: unknown) => parsePresets(raw).map((p) => `${p.key}${p.enabled ? "" : " (off)"}`);
  await logAudit(supabase, {
    actorId: user.id,
    action: "admin.ai_background_presets_saved",
    entityType: "app_settings",
    entityId: "ai_background_presets",
    before: { presets: keys(before?.value) },
    after: { presets: keys(presets) },
  });
  revalidatePath(`/admin/ai/${TOOL_KEY}`);
  revalidatePath("/tools/ai_background");
  return { ok: true };
}
