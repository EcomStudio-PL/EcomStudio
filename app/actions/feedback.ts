"use server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";

const ISSUES = new Set([
  "wrong_product", "wrong_color", "wrong_quantity", "wrong_anatomy",
  "wrong_scale", "bad_scene", "bad_quality", "other",
]);

/** FEEDBACK LOOP: store accept/regenerate verdicts per generated image.
 *  Not used for training today — collected to improve the prompt engine. */
export async function submitGenerationFeedbackAction(input: {
  jobId: string;
  assetPath?: string;
  verdict: "accepted" | "regenerate";
  issues?: string[];
  comment?: string;
}): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return { ok: false };
  if (input.verdict !== "accepted" && input.verdict !== "regenerate") return { ok: false };

  const { error } = await supabase.from("generation_feedback").insert({
    workspace_id: workspace.id,
    user_id: user.id,
    generation_job_id: input.jobId,
    asset_path: input.assetPath?.slice(0, 500) ?? null,
    verdict: input.verdict,
    issues: (input.issues ?? []).filter((i) => ISSUES.has(i)).slice(0, 8),
    comment: input.comment?.trim().slice(0, 1000) || null,
  });
  return { ok: !error };
}
