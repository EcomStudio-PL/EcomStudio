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
 * The ORDERED model chain the concept engine generates with.
 *
 * Priority comes from admin configuration, not from an accident of
 * sort_order: app_settings("generation").provider_priority is a list of
 * "provider:model_identifier" entries (e.g. "openai:gpt-image-2"), tried in
 * order; concept_model_id can additionally pin the primary. Only models that
 * accept reference images qualify — a concept generated without its
 * references would break the Product Lock. Providers sitting in a health
 * cooldown (dead quota, bad key) sink to the end of the chain rather than
 * being retried first on every click.
 */
export async function resolveConceptModels(supabase: Client): Promise<UsableModel[]> {
  const [models, { data: settings }, { data: healthRows }] = await Promise.all([
    getUsableModels(supabase),
    supabase.from("app_settings").select("value").eq("key", "generation").maybeSingle(),
    supabase.from("provider_health").select("provider_slug, state, cooldown_until"),
  ]);
  const usable = models.filter((m) => m.capabilities_ui.supportsReferenceImages);
  if (usable.length === 0) return [];

  const cfg = (settings?.value ?? {}) as { concept_model_id?: string; provider_priority?: string[] };
  const chain: UsableModel[] = [];
  const push = (m: UsableModel | undefined) => {
    if (m && !chain.some((x) => x.id === m.id)) chain.push(m);
  };

  push(usable.find((m) => m.id === cfg.concept_model_id));
  for (const entry of cfg.provider_priority ?? []) {
    const [provider, identifier] = String(entry).split(":");
    push(usable.find((m) => m.provider_slug === provider && m.model_identifier === identifier));
  }
  for (const m of usable) push(m);

  // Providers inside a cooldown are demoted, never removed — if everything
  // is unhealthy, the chain still tries them all.
  const blocked = new Set(
    (healthRows ?? [])
      .filter((h) => h.state !== "healthy" && (!h.cooldown_until || new Date(h.cooldown_until).getTime() > Date.now()))
      .map((h) => h.provider_slug)
  );
  return [...chain.filter((m) => !blocked.has(m.provider_slug)), ...chain.filter((m) => blocked.has(m.provider_slug))];
}

/** The primary of the chain — what the price preview is quoted from. */
export async function resolveConceptModel(supabase: Client): Promise<UsableModel | null> {
  return (await resolveConceptModels(supabase))[0] ?? null;
}

/** Credits one concept image costs at the current default model. */
export function conceptUnitCost(model: UsableModel): number {
  const res = (model.supported_resolutions?.[0] ?? "1K") as Resolution;
  return priceForResolution(model, res);
}

/** One image-model choice as the customer sees it: display identity plus BOTH
 *  prices — own prompt (base credits) and EcomStudio prompt (base + engine
 *  surcharge). Ordered like the routing chain, default first. */
export type ConceptModelOption = {
  id: string;
  name: string;
  badge: string | null;
  costCustom: number;
  costEcom: number;
  /** Base credits per output size, straight from the admin price table. */
  pricing: Record<string, number>;
  /** Sizes this engine actually renders — the toolbar shows nothing else. */
  resolutions: string[];
  /** Framings this engine actually accepts. */
  ratios: string[];
  /** Credits added on top of the base price when EcomStudio writes the
   *  prompt; zero for the customer's own prompt. */
  ecomSurcharge: number;
};

export async function conceptModelOptions(supabase: Client): Promise<ConceptModelOption[]> {
  const chain = await resolveConceptModels(supabase);
  return chain.map((m) => {
    const base = conceptUnitCost(m);
    const surcharge = (m as { ecom_surcharge_credits?: number }).ecom_surcharge_credits ?? 0;
    const pricing: Record<string, number> = {};
    for (const r of m.supported_resolutions ?? []) pricing[r] = priceForResolution(m, r);
    return {
      id: m.id,
      name: m.display_name || m.name,
      badge: m.badge,
      costCustom: base,
      costEcom: base + Math.max(0, surcharge),
      pricing,
      resolutions: m.supported_resolutions ?? [],
      ratios: m.supported_aspect_ratios ?? [],
      ecomSurcharge: Math.max(0, surcharge),
    };
  });
}

/** Price of one generation for a given origin and output size. An unknown or
 *  unsupported size falls back to the model's default, exactly like the
 *  generation path itself — the quote can never promise a cheaper render than
 *  the one that will actually run. */
export function originCost(
  model: UsableModel, origin: "ecomstudio" | "custom", resolution?: string | null,
): number {
  const supported = model.supported_resolutions ?? [];
  const res = resolution && supported.includes(resolution) ? resolution : supported[0] ?? "1K";
  const base = priceForResolution(model, res);
  if (origin === "custom") return base;
  const surcharge = (model as { ecom_surcharge_credits?: number }).ecom_surcharge_credits ?? 0;
  return base + Math.max(0, surcharge);
}

/**
 * Regeneration keeps the concept and varies only what a photographer would
 * vary between two takes of the same shot. The variation index rotates so
 * consecutive retries do not all ask for the same change.
 */
const VARIATIONS = [
  "Przesuń kamerę o kilka stopni i delikatnie zmień kadr; zachowaj tę samą scenę, otoczenie i nastrój.",
  "Delikatnie przestaw drugoplanowe elementy sceny i minimalnie zmień pozycję produktu w kadrze; ta sama scena.",
  "Subtelnie zmień kierunek światła (ten sam charakter światła), a osobie w kadrze nadaj nieco inną naturalną pozę; ta sama scena.",
  "Wybierz odrobinę inny kadr — nieco bliżej lub szerzej — zachowując tę samą scenę i zamysł kompozycji.",
];

export function variationInstruction(generationCount: number): string {
  return `Kolejne podejście:\nTo jest kolejne podejście do tego samego zatwierdzonego ujęcia. ${VARIATIONS[Math.max(0, generationCount - 1) % VARIATIONS.length]} Nie zmieniaj koncepcji sceny, typu otoczenia ani produktu.`;
}

export async function generateFromConcept(
  supabase: Client, userId: string, workspaceId: string, conceptId: string,
  opts?: { modelId?: string },
): Promise<ConceptGenerateOutput & { modelName?: string }> {
  // The concept row is readable by the member (title, refs, status) — the
  // EcomStudio prompt within it is ciphertext until this exact point; a
  // custom card carries the customer's own prompt in clear instead.
  const { data: concept } = await supabase
    .from("generated_prompts")
    .select("id, session_id, workspace_id, product_id, prompt_encrypted, prompt_iv, prompt_tag, reference_indices, generation_count, last_job_id, prompt_origin, prompt_text, negative_prompt, model_id")
    .eq("id", conceptId).eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!concept || !concept.session_id) return { ok: false, error: "not_found" };

  // ONE final prompt per card — no negative prompt channel, ever. The
  // customer's own text or the decrypted master-template prompt goes to the
  // image model verbatim (plus the deterministic retake note on retakes).
  const origin: "ecomstudio" | "custom" = concept.prompt_origin === "custom" ? "custom" : "ecomstudio";
  let basePrompt: string;
  if (origin === "custom") {
    basePrompt = (concept.prompt_text ?? "").trim();
    if (!basePrompt) return { ok: false, error: "invalid_input" };
  } else {
    const payload = decryptConceptPayload(concept);
    if (!payload) return { ok: false, error: "concept_locked" };
    basePrompt = payload.prompt;
  }

  const { data: session } = await supabase
    .from("prompt_sessions")
    .select("id, workspace_id, product_id, aspect_ratio, resolution, reference_paths, status")
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

  const chain = await resolveConceptModels(supabase);
  if (chain.length === 0) return { ok: false, error: "model_unavailable" };

  // MODEL CHOICE — request > card override > default chain. An EXPLICIT
  // choice is honoured exactly: no silent cross-provider fallback onto an
  // engine the customer did not pick (retries within the provider still run).
  const requestedId = opts?.modelId ?? concept.model_id ?? null;
  const explicit = requestedId ? chain.find((m) => m.id === requestedId) : undefined;
  if (requestedId && !explicit) return { ok: false, error: "model_unavailable" };
  const model = explicit ?? chain[0];
  const fallbackModelIds = explicit ? [] : chain.slice(1).map((m) => m.id);

  // The exact reference set the planner routed to this concept, in its order
  // (primary first). 1-based indices into the session's reference paths.
  const paths = session.reference_paths ?? [];
  const referencePaths = (concept.reference_indices ?? [])
    .map((n) => paths[n - 1])
    .filter((p): p is string => typeof p === "string" && p.length > 0);
  if (referencePaths.length === 0) return { ok: false, error: "references_required" };

  const isRetake = (concept.generation_count ?? 0) > 0;
  const prompt = isRetake
    ? `${basePrompt}\n\n${variationInstruction(concept.generation_count ?? 1)}`
    : basePrompt;

  // The size the seller picked in the toolbar, if this engine renders it.
  const resolution = (session.resolution && (model.supported_resolutions ?? []).includes(session.resolution)
    ? session.resolution
    : undefined) as Resolution | undefined;
  const credits = originCost(model, origin, resolution);
  const result = await runGeneration(supabase, userId, workspaceId, {
    modelId: model.id,
    fallbackModelIds,
    prompt,
    aspectRatio: (session.aspect_ratio || "16:9") as AspectRatio,
    resolution,
    quantity: 1,
    productId: session.product_id ?? concept.product_id ?? undefined,
    referencePaths,
    referenceImageIds: [],
    promptId: concept.id,
    promptSessionId: session.id,
    hidePromptText: origin === "ecomstudio",
    conceptId: concept.id,
    parentJobId: isRetake ? concept.last_job_id ?? undefined : undefined,
    promptOrigin: origin,
    costOverride: credits,
  });
  if (!result.ok) return result;

  await supabase.from("generated_prompts").update({
    generation_count: (concept.generation_count ?? 0) + 1,
    last_job_id: result.jobId,
    status: "used",
    ...(opts?.modelId ? { model_id: opts.modelId } : {}),
  }).eq("id", concept.id);

  return { ok: true, jobId: result.jobId, images: result.images, credits, modelName: model.display_name || model.name };
}

