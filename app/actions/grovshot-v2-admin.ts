"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { sealPrompt } from "@/lib/server/ai-engine";
import { PromptKeyError } from "@/lib/server/prompt-vault";
import { adminPromptKeyring } from "@/lib/server/prompt-vault-admin";
import { GROVSHOT_V2_KEYS } from "@/lib/grovshot-v2/stages";
import { specDraft } from "@/lib/server/grovshot-v2/seed";

/**
 * GROVBASE SHOT V2 — the admin's actions on its tab (/admin/ai/prompts →
 * Silnik V2). Admin only, checked on every call; every write is audited.
 *
 *   · „Wczytaj szkice ze specyfikacji” — saves the spec's texts as DRAFTS of
 *     the six stage keys (never published by code; the admin reviews,
 *     edits and publishes each one through the ordinary versioned editor);
 * („Test silnika” is the admin-only route app/api/admin/grovshot-v2/test —
 * a route, so the engine is not compiled a second time for these actions.)
 */

type Result = { ok: boolean; error?: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("id, role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}

function failure(e: unknown): string {
  if (e instanceof PromptKeyError) return "prompt_key_unavailable";
  if (e instanceof Error && (e.message === "unauthenticated" || e.message === "not_admin")) return "forbidden";
  return "generic";
}

export async function seedSpecDraftsAction(reason: string): Promise<Result & { saved?: number }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const why = reason.trim();
    if (!why) return { ok: false, error: "reason_required" };
    const ring = await adminPromptKeyring(supabase);
    let saved = 0;
    const versions: Record<string, number> = {};
    for (const key of GROVSHOT_V2_KEYS) {
      const sealed = sealPrompt(ring, specDraft(key));
      const { data, error } = await supabase.rpc("ai_save_tool_prompt", {
        p_tool_key: key, p_body_encrypted: sealed.ciphertext, p_iv: sealed.iv, p_tag: sealed.authTag,
        p_summary: "Szkic ze specyfikacji (GrovShot V2)", p_reason: why, p_source: "manual", p_publish: false,
      });
      const result = (error ? null : data) as { ok?: boolean; version?: number } | null;
      if (!result?.ok) return { ok: false, error: "generic", saved };
      saved++;
      if (typeof result.version === "number") versions[key] = result.version;
    }
    await logAudit(supabase, {
      actorId: adminId, action: "grovshot_v2.drafts_seeded", entityType: "ai_tool", entityId: "prompts",
      after: { reason: why, versions },
    });
    // The GrovShot page is the dynamic tool route.
    revalidatePath("/admin/ai/[tool]", "page");
    return { ok: true, saved };
  } catch (e) { return { ok: false, error: failure(e) }; }
}
