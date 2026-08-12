import "server-only";
import { createHash } from "crypto";
import type { Client } from "@/lib/services/workspace";
import { decryptSecret, encryptionAvailable } from "@/lib/server/crypto";
import { ProviderError, type ReferenceImage } from "@/lib/ai/types";
import { analyzeReferences } from "@/lib/ai/engine/analysis";
import { proposeScenes } from "@/lib/ai/engine/scenes";
import { buildProductLock, chooseLockStrength } from "@/lib/ai/engine/lock";
import { assembleMasterPrompt, assembleNegativePrompt, referenceRationale, referenceRoleLabel } from "@/lib/ai/engine/master-prompt";
import { VISION_MODEL, type VisionCredential } from "@/lib/ai/engine/vision";
import type { FeatureManifest, ImageAnalysis, SceneConcept, SessionInput } from "@/lib/ai/engine/types";
import { startUsage, completeUsage, failUsage } from "@/lib/services/usage";

export type PromptSessionInput = {
  productId?: string;
  productName: string;
  description?: string;
  extraInfo?: string;
  style?: string;
  aspectRatio: string;
  /** Storage paths in product-images already uploaded by the client. */
  referencePaths: string[];
};

export type PromptSessionOutput =
  | { ok: true; sessionId: string; productId: string; promptCount: number }
  | { ok: false; error: string; sessionId?: string };

/** Bump when the analysis schema or lock semantics change — cached analyses
 *  from older engines are then ignored rather than silently reused. */
export const ENGINE_VERSION = 2;

/** Stable identity of a reference SET: same photos in any order = same hash. */
function hashReferences(paths: string[]): string {
  return createHash("sha256").update([...paths].sort().join("\n")).digest("hex").slice(0, 40);
}

const RATIOS = new Set(["1:1", "4:5", "16:9", "9:16"]);
const MAX_REFS = 8;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_BYTES = 18 * 1024 * 1024;

/** Analysis model id, admin-configurable without a deploy:
 *  app_settings("generation").analysis_model. Falls back to the engine
 *  default (which itself falls back across model ids on 404). */
async function getAnalysisModel(supabase: Client): Promise<string> {
  const { data } = await supabase
    .from("app_settings").select("value").eq("key", "generation").maybeSingle();
  const configured = (data?.value as { analysis_model?: string } | null)?.analysis_model;
  return typeof configured === "string" && configured.trim() ? configured.trim() : VISION_MODEL;
}

/** The vision credential is the active Google credential from the admin
 *  store — ciphertext via definer RPC, decrypted only server-side. */
async function getVisionCredential(supabase: Client): Promise<VisionCredential | null> {
  if (!encryptionAvailable()) return null;
  const { data: provider } = await supabase
    .from("ai_providers").select("id").eq("slug", "google").eq("active", true).maybeSingle();
  if (!provider) return null;
  const { data: credRows } = await supabase.rpc("get_active_provider_credential", { p_provider_id: provider.id });
  const cred = credRows?.[0];
  if (!cred) return null;
  try {
    return { apiKey: decryptSecret(cred.encrypted_value, cred.iv, cred.auth_tag), baseUrl: cred.base_url };
  } catch { return null; }
}

async function downloadReferences(supabase: Client, paths: string[]): Promise<ReferenceImage[]> {
  const refs: ReferenceImage[] = [];
  let total = 0;
  for (const path of paths.slice(0, MAX_REFS)) {
    const { data: blob } = await supabase.storage.from("product-images").download(path);
    if (!blob) continue;
    const buf = Buffer.from(await blob.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES || total + buf.length > MAX_TOTAL_BYTES) continue;
    total += buf.length;
    const ext = path.split(".").pop()?.toLowerCase();
    refs.push({
      base64: buf.toString("base64"),
      mime: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "avif" ? "image/avif" : "image/jpeg",
    });
  }
  return refs;
}

/**
 * "GENERUJ 5 PROMPTÓW": analyse every reference for real, build the Product
 * Feature Manifest and Product Lock, pick 5 diverse product-appropriate
 * scenes with per-scene reference selection, and store 5 ready master
 * prompts + negative prompts. Tracked through the universal usage ledger
 * (service `prompt_generation` — priced by the admin, 0 cr today).
 */
export async function runPromptSession(
  supabase: Client, userId: string, workspaceId: string, input: PromptSessionInput
): Promise<PromptSessionOutput> {
  if (!input.productName?.trim() || input.productName.trim().length < 2) return { ok: false, error: "invalid_input" };
  if (!RATIOS.has(input.aspectRatio)) return { ok: false, error: "invalid_input" };
  if (!input.referencePaths?.length) return { ok: false, error: "references_required" };

  const [cred, analysisModel] = await Promise.all([
    getVisionCredential(supabase),
    getAnalysisModel(supabase),
  ]);
  if (!cred) return { ok: false, error: "analysis_unavailable" };

  // Product: reuse the selected one or create the draft automatically —
  // the user never has to visit "Products" first.
  let productId = input.productId ?? null;
  if (productId) {
    const { data: product } = await supabase
      .from("products").select("id").eq("id", productId).eq("workspace_id", workspaceId).maybeSingle();
    if (!product) return { ok: false, error: "product_not_found" };
  } else {
    const { data: created, error: createError } = await supabase.from("products").insert({
      workspace_id: workspaceId, owner_id: userId, name: input.productName.trim(),
      description: input.description?.trim() || null, extra_info: input.extraInfo?.trim() || null,
      status: "ready",
    }).select("id").single();
    if (createError || !created) return { ok: false, error: "product_create_failed" };
    productId = created.id;
    await supabase.from("product_images").insert(
      input.referencePaths.slice(0, MAX_REFS).map((path, i) => ({
        product_id: created.id, storage_path: path, sort_order: i, is_primary: i === 0,
      }))
    );
  }

  const { data: session, error: sessionError } = await supabase.from("prompt_sessions").insert({
    workspace_id: workspaceId, user_id: userId, product_id: productId,
    product_name: input.productName.trim(),
    description: input.description?.trim() || null,
    extra_info: input.extraInfo?.trim() || null,
    aspect_ratio: input.aspectRatio, style: input.style?.trim() || null,
    reference_paths: input.referencePaths.slice(0, MAX_REFS),
    status: "analyzing",
  }).select("id").single();
  if (sessionError || !session) return { ok: false, error: "session_create_failed" };

  const { data: wallet } = await supabase
    .from("credit_wallets").select("id").eq("workspace_id", workspaceId).maybeSingle();
  if (!wallet) return { ok: false, error: "no_wallet" };

  const usage = await startUsage(supabase, {
    userId, workspaceId, walletId: wallet.id, serviceSlug: "prompt_generation",
    providerSlug: "google", modelSlug: analysisModel,
    idempotencyKey: `psession:${session.id}`,
    metadata: { session_id: session.id, images: input.referencePaths.length },
  });
  if (!usage.ok) {
    await supabase.from("prompt_sessions").update({ status: "failed", error: usage.error }).eq("id", session.id);
    return { ok: false, error: usage.error, sessionId: session.id };
  }

  const referenceHash = hashReferences(input.referencePaths.slice(0, MAX_REFS));

  const sessionInfo: SessionInput = {
    productName: input.productName.trim(),
    description: input.description?.trim() || null,
    extraInfo: input.extraInfo?.trim() || null,
    style: input.style?.trim() || null,
    aspectRatio: input.aspectRatio,
  };

  // Stage is tracked so a failed session tells admins WHERE it broke.
  let stage: "references" | "analysis" | "scenes" | "prompts" = "references";
  const startedAt = Date.now();
  try {
    const images = await downloadReferences(supabase, input.referencePaths);
    if (images.length === 0) throw new ProviderError("references_required");

    // 1) IMAGE ANALYSIS + PRODUCT FEATURE MANIFEST
    // The same photographs always yield the same analysis, so a cached result
    // for this exact reference set (and engine version) is reused instead of
    // paying the latency and the provider call again. Fidelity is untouched:
    // a different photo set, or a newer engine, misses the cache and re-runs.
    stage = "analysis";
    let analyses: ImageAnalysis[];
    let manifest: FeatureManifest;
    let cacheHit = false;
    const { data: cached } = await supabase
      .from("product_analysis_cache")
      .select("id, image_analysis, feature_manifest, hits")
      .eq("workspace_id", workspaceId)
      .eq("reference_hash", referenceHash)
      .eq("engine_version", ENGINE_VERSION)
      .maybeSingle();
    if (cached) {
      analyses = cached.image_analysis as unknown as ImageAnalysis[];
      manifest = cached.feature_manifest as unknown as FeatureManifest;
      cacheHit = true;
      void supabase.from("product_analysis_cache")
        .update({ hits: (cached.hits ?? 0) + 1 }).eq("id", cached.id);
    } else {
      const fresh = await analyzeReferences(cred, images, sessionInfo, analysisModel);
      analyses = fresh.images;
      manifest = fresh.manifest;
    }

    // 2) PRODUCT LOCK
    const lock = buildProductLock(manifest, analyses);
    await supabase.from("prompt_sessions").update({
      image_analysis: analyses as never, feature_manifest: manifest as never,
      product_lock: lock as never, analysis_model: analysisModel,
      reference_hash: referenceHash, cache_hit: cacheHit,
    }).eq("id", session.id);
    if (!cacheHit) {
      void supabase.from("product_analysis_cache").insert({
        workspace_id: workspaceId, product_id: productId,
        reference_hash: referenceHash, engine_version: ENGINE_VERSION,
        image_analysis: analyses as never, feature_manifest: manifest as never,
        product_lock: lock as never, analysis_model: analysisModel,
      });
    }

    // 3) SCENE STRATEGY + DIVERSITY (retry once to refill filtered slots)
    stage = "scenes";
    let concepts = await proposeScenes(cred, images, analyses, manifest, sessionInfo, { model: analysisModel });
    if (concepts.length < 5) {
      const missing = 5 - concepts.length;
      try {
        const extra = await proposeScenes(cred, images, analyses, manifest, sessionInfo, {
          count: missing, avoidSceneTypes: concepts.map((c) => c.scene_type), model: analysisModel,
        });
        concepts = [...concepts, ...extra.filter((e) => !concepts.some((c) => c.scene_type === e.scene_type))].slice(0, 5);
      } catch { /* keep what we have — 3+ distinct concepts beat a hard fail */ }
    }
    if (concepts.length === 0) throw new ProviderError("analysis_empty", true);

    // 4) MASTER + NEGATIVE PROMPTS
    stage = "prompts";
    const rows = concepts.map((concept, idx) => {
      const strength = chooseLockStrength(concept, manifest, lock.conflicts);
      const prompt = assembleMasterPrompt({
        concept, manifest, lock, strength, session: sessionInfo, imageCount: images.length,
      });
      const negative = assembleNegativePrompt(concept, manifest, lock);
      const rationale = referenceRationale(concept, analyses)
        .map((r) => `${r.image} — ${r.label}`).join("; ");
      return {
        product_id: productId!, workspace_id: workspaceId, session_id: session.id,
        concept_name: concept.title, shot_type: concept.scene_type, scene_type: concept.scene_type,
        prompt_text: prompt, negative_prompt: negative,
        primary_reference: concept.primary_reference,
        supporting_references: concept.supporting_references as never,
        reference_indices: [concept.primary_reference, ...concept.supporting_references.map((s) => s.image)],
        reference_image_ids: [], reference_rationale: rationale,
        format: input.aspectRatio, style: input.style?.trim() || null,
        priority: idx + 1, status: "ready" as const, lock_strength: strength,
      };
    });
    const { error: insertError } = await supabase.from("generated_prompts").insert(rows);
    if (insertError) throw new ProviderError("session_create_failed");

    await completeUsage(supabase, usage.eventId, rows.length);
    await supabase.from("prompt_sessions")
      .update({ status: "ready", latency_ms: Date.now() - startedAt })
      .eq("id", session.id);
    await supabase.rpc("log_activity", {
      p_workspace_id: workspaceId, p_action: "prompts.generated",
      p_entity_type: "prompt_session", p_entity_id: session.id,
      p_metadata: { prompts: rows.length, images: images.length },
    });
    return { ok: true, sessionId: session.id, productId: productId!, promptCount: rows.length };
  } catch (e) {
    const safe = e instanceof ProviderError ? e.safeMessage : "analysis_error";
    await failUsage(supabase, { eventId: usage.eventId, walletId: wallet.id, error: safe });
    await supabase.from("prompt_sessions").update({
      status: "failed", error: safe, error_stage: stage, latency_ms: Date.now() - startedAt,
    }).eq("id", session.id);
    await supabase.rpc("log_activity", {
      p_workspace_id: workspaceId, p_action: "prompts.failed",
      p_entity_type: "prompt_session", p_entity_id: session.id,
      p_metadata: {
        stage, error: safe, model: analysisModel, provider: "google",
        images: input.referencePaths.length, product_id: productId,
        latency_ms: Date.now() - startedAt,
      },
    });
    return { ok: false, error: safe, sessionId: session.id };
  }
}

/** Regenerate ONE prompt card: a fresh scene concept that avoids the
 *  session's already-used scene types, written over the same row. */
export async function regeneratePrompt(
  supabase: Client, workspaceId: string, promptId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: prompt } = await supabase
    .from("generated_prompts").select("id, session_id, workspace_id").eq("id", promptId).maybeSingle();
  if (!prompt || prompt.workspace_id !== workspaceId || !prompt.session_id) return { ok: false, error: "not_found" };

  const { data: session } = await supabase
    .from("prompt_sessions").select("*").eq("id", prompt.session_id).maybeSingle();
  if (!session || session.status !== "ready") return { ok: false, error: "not_found" };

  const [cred, analysisModel] = await Promise.all([
    getVisionCredential(supabase),
    getAnalysisModel(supabase),
  ]);
  if (!cred) return { ok: false, error: "analysis_unavailable" };

  const { data: siblings } = await supabase
    .from("generated_prompts").select("id, scene_type").eq("session_id", session.id);
  const avoid = (siblings ?? []).filter((s) => s.id !== promptId).map((s) => s.scene_type).filter(Boolean) as string[];

  const sessionInfo: SessionInput = {
    productName: session.product_name, description: session.description,
    extraInfo: session.extra_info, style: session.style, aspectRatio: session.aspect_ratio,
  };
  const analyses = (session.image_analysis ?? []) as unknown as ImageAnalysis[];
  const manifest = session.feature_manifest as unknown as FeatureManifest;
  const lock = buildProductLock(manifest, analyses);

  try {
    const images = await downloadReferences(supabase, session.reference_paths ?? []);
    if (images.length === 0) return { ok: false, error: "references_required" };
    const [concept]: SceneConcept[] = await proposeScenes(cred, images, analyses, manifest, sessionInfo, {
      count: 1, avoidSceneTypes: avoid, model: analysisModel,
    });
    if (!concept) return { ok: false, error: "analysis_empty" };
    const strength = chooseLockStrength(concept, manifest, lock.conflicts);
    const rationale = referenceRationale(concept, analyses).map((r) => `${r.image} — ${r.label}`).join("; ");
    await supabase.from("generated_prompts").update({
      concept_name: concept.title, shot_type: concept.scene_type, scene_type: concept.scene_type,
      prompt_text: assembleMasterPrompt({ concept, manifest, lock, strength, session: sessionInfo, imageCount: images.length }),
      negative_prompt: assembleNegativePrompt(concept, manifest, lock),
      primary_reference: concept.primary_reference,
      supporting_references: concept.supporting_references as never,
      reference_indices: [concept.primary_reference, ...concept.supporting_references.map((s) => s.image)],
      reference_rationale: rationale, lock_strength: strength,
    }).eq("id", promptId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof ProviderError ? e.safeMessage : "analysis_error" };
  }
}

export { referenceRoleLabel };
