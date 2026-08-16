import "server-only";
import type { Client } from "@/lib/services/workspace";
import { getUsableModels, type UsableModel } from "@/lib/ai/router";
import { priceForResolution, type AspectRatio, type Resolution } from "@/lib/ai/types";
import { runGeneration } from "@/lib/server/generation";
import { decryptConceptPayload } from "@/lib/server/prompt-engine";

/**
 * CONCEPT → IMAGE.
 *
 * The customer clicks "Generuj" on a concept card; everything that matters
 * happens here, server-side: the hidden prompt is decrypted, the model is
 * chosen by EcomStudio (the seller never picks engines), the references the
 * planner assigned are resolved, credits move through the existing ledger and
 * the result lands in the same generations/assets pipeline as every other
 * image. The browser sends a concept id and gets back a picture.
 */

export type ConceptGenerateOutput =
  | { ok: true; jobId: string; images: { url: string; path: string }[]; credits: number }
  | { ok: false; error: string; missingCredits?: number };

/**
 * The model the concept engine generates with. The admin can pin one via
 * app_settings("generation").concept_model_id; otherwise the first usable
 * model that accepts reference images wins (a concept without its references
 * would break the Product Lock, so reference support is not negotiable
 * while any such model exists).
 */
export async function resolveConceptModel(supabase: Client): Promise<UsableModel | null> {
  const [models, { data: settings }] = await Promise.all([
    getUsableModels(supabase),
    supabase.from("app_settings").select("value").eq("key", "generation").maybeSingle(),
  ]);
  if (models.length === 0) return null;
  const pinned = (settings?.value as { concept_model_id?: string } | null)?.concept_model_id;
  if (pinned) {
    const match = models.find((m) => m.id === pinned);
    if (match) return match;
  }
  return models.find((m) => m.capabilities_ui.supportsReferenceImages) ?? models[0];
}

/** Credits one concept image costs at the current default model. */
export function conceptUnitCost(model: UsableModel): number {
  const res = (model.supported_resolutions?.[0] ?? "1K") as Resolution;
  return priceForResolution(model, res);
}

/**
 * Regeneration keeps the concept and varies only what a photographer would
 * vary between two takes of the same shot. The variation index rotates so
 * consecutive retries do not all ask for the same change.
 */
const VARIATIONS = [
  "Shift the camera a few degrees and adjust the framing slightly; keep the same scene idea, environment and mood.",
  "Rearrange the secondary scene elements slightly and vary the product's exact position in frame; same scene idea.",
  "Vary the light direction subtly (same character of light) and give any person present a slightly different natural pose; same scene idea.",
  "Choose a slightly different focal framing — a touch closer or wider — keeping the same scene idea and composition intent.",
];

export function variationInstruction(generationCount: number): string {
  return `TAKE VARIATION\nThis is another take of the same approved concept. ${VARIATIONS[Math.max(0, generationCount - 1) % VARIATIONS.length]} Do not change the scene concept, the environment type or the product.`;
}

export async function generateFromConcept(
  supabase: Client, userId: string, workspaceId: string, conceptId: string,
): Promise<ConceptGenerateOutput> {
  // The concept row is readable by the member (title, refs, status) — the
  // prompt within it is ciphertext until this exact point.
  const { data: concept } = await supabase
    .from("generated_prompts")
    .select("id, session_id, workspace_id, product_id, prompt_encrypted, prompt_iv, prompt_tag, reference_indices, generation_count, last_job_id")
    .eq("id", conceptId).eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!concept || !concept.session_id) return { ok: false, error: "not_found" };

  const payload = decryptConceptPayload(concept);
  if (!payload) return { ok: false, error: "concept_locked" };

  const { data: session } = await supabase
    .from("prompt_sessions")
    .select("id, workspace_id, product_id, aspect_ratio, reference_paths, status")
    .eq("id", concept.session_id).maybeSingle();
  if (!session || session.workspace_id !== workspaceId) return { ok: false, error: "not_found" };

  // DOUBLE-CLICK / REFRESH GUARD: one live job per concept. A repeat request
  // while the last job is still running returns that job instead of paying
  // for a second one.
  if (concept.last_job_id) {
    const { data: liveJob } = await supabase
      .from("generation_jobs").select("id, status, created_at")
      .eq("id", concept.last_job_id).maybeSingle();
    if (liveJob && (liveJob.status === "processing" || liveJob.status === "queued")) {
      const ageMs = Date.now() - new Date(liveJob.created_at).getTime();
      if (ageMs < 5 * 60_000) return { ok: false, error: "already_running" };
    }
  }

  const model = await resolveConceptModel(supabase);
  if (!model) return { ok: false, error: "model_unavailable" };

  // The exact reference set the planner routed to this concept, in its order
  // (primary first). 1-based indices into the session's reference paths.
  const paths = session.reference_paths ?? [];
  const referencePaths = (concept.reference_indices ?? [])
    .map((n) => paths[n - 1])
    .filter((p): p is string => typeof p === "string" && p.length > 0);
  if (referencePaths.length === 0) return { ok: false, error: "references_required" };

  const isRetake = (concept.generation_count ?? 0) > 0;
  const prompt = isRetake
    ? `${payload.prompt}\n\n${variationInstruction(concept.generation_count ?? 1)}`
    : payload.prompt;

  const result = await runGeneration(supabase, userId, workspaceId, {
    modelId: model.id,
    prompt,
    negative: payload.negative || undefined,
    aspectRatio: (session.aspect_ratio || "16:9") as AspectRatio,
    quantity: 1,
    productId: session.product_id ?? concept.product_id ?? undefined,
    referencePaths,
    referenceImageIds: [],
    promptId: concept.id,
    promptSessionId: session.id,
    hidePromptText: true,
    conceptId: concept.id,
    parentJobId: isRetake ? concept.last_job_id ?? undefined : undefined,
  });
  if (!result.ok) return result;

  await supabase.from("generated_prompts").update({
    generation_count: (concept.generation_count ?? 0) + 1,
    last_job_id: result.jobId,
    status: "used",
  }).eq("id", concept.id);

  const credits = conceptUnitCost(model);
  return { ok: true, jobId: result.jobId, images: result.images, credits };
}
