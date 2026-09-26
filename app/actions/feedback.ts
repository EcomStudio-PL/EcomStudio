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

export type ResultVote = { verdict: "like" | "dislike" | null; reasons: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 👍 / 👎 ON ONE RESULT. The database does the real work in one definer
 * function (migration 0126): it checks the caller owns the result, keeps one
 * vote per user per result (a double click cannot duplicate it), and moves
 * the ranking counters of the knowledge examples that result was built from.
 * It never touches a prompt. `verdict: null` withdraws the vote.
 */
export async function voteResultAction(input: {
  generationId: string;
  verdict: "like" | "dislike" | null;
  reasons?: string[];
}): Promise<{ ok: boolean; vote?: ResultVote; error?: string }> {
  if (!UUID.test(input.generationId)) return { ok: false, error: "invalid_input" };
  if (input.verdict !== null && input.verdict !== "like" && input.verdict !== "dislike") {
    return { ok: false, error: "invalid_input" };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  const { data, error } = await supabase.rpc("generation_feedback_submit", {
    p_generation_id: input.generationId,
    p_verdict: input.verdict,
    p_reasons: (input.reasons ?? []).filter((r) => typeof r === "string").slice(0, 6),
  });
  if (error) return { ok: false, error: "generic" };
  const result = data as { ok?: boolean; error?: string; verdict?: string | null; reasons?: string[] } | null;
  if (!result?.ok) return { ok: false, error: result?.error ?? "generic" };
  return {
    ok: true,
    vote: {
      verdict: result.verdict === "like" || result.verdict === "dislike" ? result.verdict : null,
      reasons: Array.isArray(result.reasons) ? result.reasons : [],
    },
  };
}

/** The caller's vote on one of their OWN results; null when the result is
 *  not theirs to rate (enforced in SQL). */
export async function readResultVoteAction(generationId: string): Promise<ResultVote | null> {
  if (!UUID.test(generationId)) return null;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.rpc("generation_feedback_mine", { p_generation_ids: [generationId] });
  const row = data?.[0];
  // No row: not the caller's own completed result (a teammate's, say) —
  // there is nothing for them to rate, so the widget stays hidden.
  if (!row) return null;
  return {
    verdict: row.verdict === "like" || row.verdict === "dislike" ? row.verdict : null,
    reasons: row.reasons ?? [],
  };
}
