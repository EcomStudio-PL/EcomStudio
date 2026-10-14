"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { dispatchToken } from "@/lib/server/server-token";
import { readPublishedPrompt, readThumbnailConfig } from "@/lib/server/thumbnail/settings";
import {
  THUMBNAIL_PATH, THUMBNAIL_TOOL_KEY, serializeThumbnailConfig, validateSettingsInput, type ThumbnailConfig,
} from "@/lib/thumbnail/config";

/**
 * MINIATURKA — the operator's writes: the settings row and the approval of a
 * published prompt version. Admin only, audited (keys and numbers, never a
 * prompt). The row is private (migration 0139): before that migration is in,
 * nothing is saved — a save would land in a row anyone could read.
 */

type Result = { ok: boolean; error?: string; field?: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return null;
  return { supabase, adminId: user.id };
}

const refresh = () => {
  revalidatePath(`/admin/ai/${THUMBNAIL_TOOL_KEY}`);
  revalidatePath("/admin/ai");
  revalidatePath(THUMBNAIL_PATH);
};

async function write(supabase: Awaited<ReturnType<typeof createClient>>, next: ThumbnailConfig): Promise<boolean> {
  const { error } = await supabase.from("app_settings").upsert(
    { key: "thumbnail", value: serializeThumbnailConfig(next) as never },
    { onConflict: "key" },
  );
  return !error;
}

/** Save the settings form (model, request quality/size, photo limit, local
 *  finish, token rates). Validated strictly: one bad field, nothing saved. */
export async function saveThumbnailSettingsAction(input: unknown): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "forbidden" };
  const v = validateSettingsInput(input);
  if (!v.ok) return { ok: false, error: "invalid", field: v.field };
  const current = await readThumbnailConfig(admin.supabase);
  if (!current || !dispatchToken()) return { ok: false, error: "migration_pending" };
  const next: ThumbnailConfig = { ...v.value, approvedPrompt: current.approvedPrompt };
  if (!(await write(admin.supabase, next))) return { ok: false, error: "generic" };
  const { approvedPrompt: _a, ...before } = current;
  void _a;
  await logAudit(admin.supabase, {
    actorId: admin.adminId, action: "admin.thumbnail_settings_saved", entityType: "app_settings", entityId: "thumbnail",
    before: before as unknown as Record<string, unknown>, after: v.value as unknown as Record<string, unknown>,
  });
  refresh();
  return { ok: true };
}

/**
 * APPROVE the version published now. Needed only when its text differs from
 * the release reference (THUMBNAIL_REFERENCE_PROMPT_SHA256): Miniaturka runs
 * only on a text that is the reference or that an operator approved, so a
 * prompt can never change silently. Stores a keyed digest, never the text.
 */
export async function approveThumbnailPromptAction(expected: { version: number | null; sha256: string }): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "forbidden" };
  const current = await readThumbnailConfig(admin.supabase);
  if (!current) return { ok: false, error: "migration_pending" };
  const { prompt } = await readPublishedPrompt(admin.supabase, current);
  if (!prompt) return { ok: false, error: "prompt_unconfigured" };
  // Exactly the version the operator was looking at: if another version was
  // published meanwhile, nothing is approved.
  if (!expected || prompt.version !== expected.version || prompt.sha256 !== expected.sha256) {
    return { ok: false, error: "prompt_changed" };
  }
  const next: ThumbnailConfig = {
    ...current,
    approvedPrompt: { digest: prompt.digest, version: prompt.version, approvedAt: new Date().toISOString(), approvedBy: admin.adminId },
  };
  if (!(await write(admin.supabase, next))) return { ok: false, error: "generic" };
  await logAudit(admin.supabase, {
    actorId: admin.adminId, action: "admin.thumbnail_prompt_approved", entityType: "ai_tool_prompts", entityId: THUMBNAIL_TOOL_KEY,
    after: { version: prompt.version, sha256: prompt.sha256 },
  });
  refresh();
  return { ok: true };
}

/** Withdraw an operator approval (the reference text keeps running). */
export async function revokeThumbnailPromptApprovalAction(): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "forbidden" };
  const current = await readThumbnailConfig(admin.supabase);
  if (!current) return { ok: false, error: "migration_pending" };
  if (!(await write(admin.supabase, { ...current, approvedPrompt: null }))) return { ok: false, error: "generic" };
  await logAudit(admin.supabase, {
    actorId: admin.adminId, action: "admin.thumbnail_prompt_approval_revoked", entityType: "ai_tool_prompts", entityId: THUMBNAIL_TOOL_KEY,
    before: { version: current.approvedPrompt?.version ?? null },
  });
  refresh();
  return { ok: true };
}
