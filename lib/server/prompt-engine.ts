import "server-only";
import { createHash } from "crypto";
import type { Client } from "@/lib/services/workspace";
import { decryptSecret, encryptSecret, encryptionAvailable } from "@/lib/server/crypto";
import { ProviderError, type ReferenceImage } from "@/lib/ai/types";
import { analyzeReferences } from "@/lib/ai/engine/analysis";
import { proposeScenes, synthesizeConcepts } from "@/lib/ai/engine/scenes";
import { buildProductLock, chooseLockStrength } from "@/lib/ai/engine/lock";
import { assembleNegativePrompt, referenceRationale, referenceRoleLabel } from "@/lib/ai/engine/master-prompt";
import {
  composeTemplatePrompt, normalizeSceneryCategory, sceneTextFallback,
  validateTemplatePrompt, PROMPT_TEMPLATE_VERSION,
} from "@/lib/ai/engine/template-prompt";
import { VISION_MODEL, type VisionBackend, type VisionOutcome, type VisionProvider } from "@/lib/ai/engine/vision";
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
  /** How many shot concepts to design (5-10; the server clamps). */
  shots?: number;
  /** Locale for the customer-facing card copy (pl / en / de). */
  locale?: string;
};

export const MIN_SHOTS = 5;
export const MAX_SHOTS = 10;
export function clampShots(raw: unknown): number {
  const n = typeof raw === "number" ? Math.trunc(raw) : Number(raw);
  return Number.isFinite(n) ? Math.min(MAX_SHOTS, Math.max(MIN_SHOTS, n)) : MIN_SHOTS;
}

const CUSTOMER_LANGUAGE: Record<string, string> = { pl: "Polish", en: "English", de: "German" };

/**
 * The seller-facing concept payload that IS allowed to leave the server.
 * There is deliberately no field for the prompt: everything internal travels
 * only as AES-256-GCM ciphertext in the encrypted columns.
 */
export type ConceptPayloadMeta = {
  /** prompt_template_version */
  tv?: number;
  /** scene_goal — what this shot is meant to sell */
  goal?: string;
  /** composition_type — camera distance / framing family */
  comp?: string;
  /** scenery category the template used */
  cat?: string;
};

export function encryptConceptPayload(
  prompt: string, negative: string, meta?: ConceptPayloadMeta,
): { ciphertext: string; iv: string; authTag: string } {
  return encryptSecret(JSON.stringify({ p: prompt, n: negative, ...(meta ?? {}) }));
}

export function decryptConceptPayload(row: {
  prompt_encrypted: string | null; prompt_iv: string | null; prompt_tag: string | null;
}): { prompt: string; negative: string; meta: ConceptPayloadMeta } | null {
  if (!row.prompt_encrypted || !row.prompt_iv || !row.prompt_tag) return null;
  try {
    const parsed = JSON.parse(decryptSecret(row.prompt_encrypted, row.prompt_iv, row.prompt_tag)) as
      { p?: string; n?: string } & ConceptPayloadMeta;
    if (typeof parsed.p !== "string" || !parsed.p) return null;
    return {
      prompt: parsed.p, negative: parsed.n ?? "",
      meta: { tv: parsed.tv, goal: parsed.goal, comp: parsed.comp, cat: parsed.cat },
    };
  } catch {
    return null;
  }
}

export type PromptSessionOutput =
  | { ok: true; sessionId: string; productId: string; promptCount: number }
  | { ok: false; error: string; sessionId?: string };

/** Bump when the analysis schema or lock semantics change — cached analyses
 *  from older engines are then ignored rather than silently reused. */
export const ENGINE_VERSION = 3;

/** Stable fingerprint of the ANALYSIS INPUT: the reference set (order-free)
 *  plus the product name and description, because both feed the manifest.
 *  Same fingerprint ⇒ the cached analysis and Product Lock are still true. */
function hashAnalysisInput(paths: string[], name: string, description: string | null): string {
  return createHash("sha256")
    .update([...paths].sort().join("\n"))
    .update("\x00" + name.trim().toLowerCase())
    .update("\x00" + (description ?? "").trim().toLowerCase())
    .digest("hex").slice(0, 40);
}

/**
 * CANDIDATE POOL SIZE. Asking the planner for a couple of concepts MORE than
 * ordered means the diversity and supported-view filters can reject their
 * duds without forcing a second sequential AI call — the overwhelming
 * majority of sessions now finish the scene stage in exactly one request.
 * Capped so a 10-shot order cannot push the response past token limits.
 */
export function candidatePoolSize(shots: number): number {
  return Math.min(shots + 2, 12);
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

/**
 * PLANNER PROVIDER CHAIN — its own admin configuration, fully independent of
 * the image models: app_settings("generation").planner_provider is the
 * primary, planner_fallback is OPTIONAL and used only when the admin set it.
 * Credentials come back as ciphertext through the definer RPC and are
 * decrypted only here, server-side. A provider without a usable key is simply
 * absent from the chain — a broken key can never take the others down.
 */
const PLANNER_CAPABLE: VisionProvider[] = ["openai", "google"];

async function plannerProviderOrder(supabase: Client): Promise<VisionProvider[]> {
  const { data } = await supabase
    .from("app_settings").select("value").eq("key", "generation").maybeSingle();
  const cfg = (data?.value ?? {}) as { planner_provider?: string; planner_fallback?: string };
  const primary = PLANNER_CAPABLE.includes(cfg.planner_provider as VisionProvider)
    ? (cfg.planner_provider as VisionProvider) : "openai";
  const fallback = PLANNER_CAPABLE.includes(cfg.planner_fallback as VisionProvider)
    && cfg.planner_fallback !== primary
    ? (cfg.planner_fallback as VisionProvider) : null;
  return fallback ? [primary, fallback] : [primary];
}

async function getVisionBackends(supabase: Client, primaryModel: string): Promise<VisionBackend[]> {
  if (!encryptionAvailable()) return [];
  const order = await plannerProviderOrder(supabase);
  const { data: providers } = await supabase
    .from("ai_providers").select("id, slug").eq("active", true).in("slug", order);
  if (!providers?.length) return [];

  const backends: VisionBackend[] = [];
  for (const slug of order) {
    const provider = providers.find((p) => p.slug === slug);
    if (!provider) continue;
    const { data: credRows } = await supabase.rpc("get_active_provider_credential", { p_provider_id: provider.id });
    const cred = credRows?.[0];
    if (!cred) continue;
    try {
      backends.push({
        provider: slug,
        cred: { apiKey: decryptSecret(cred.encrypted_value, cred.iv, cred.auth_tag), baseUrl: cred.base_url },
        model: slug === "google" ? primaryModel : undefined,
      });
    } catch { /* undecryptable key: skip this provider, keep the rest */ }
  }
  return backends;
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

/** Follow an adopted in-flight session until it settles. Returns the same
 *  shape the original request will produce, or null when the run failed or
 *  the wait window closed (the caller then proceeds as a normal request). */
async function waitForSession(supabase: Client, sessionId: string): Promise<PromptSessionOutput | null> {
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const { data: s } = await supabase
      .from("prompt_sessions").select("id, status, product_id").eq("id", sessionId).maybeSingle();
    if (!s) return null;
    if (s.status === "ready") {
      const { count } = await supabase
        .from("generated_prompts").select("id", { count: "exact", head: true }).eq("session_id", sessionId);
      return { ok: true, sessionId, productId: s.product_id ?? "", promptCount: count ?? 0 };
    }
    if (s.status === "failed") return null;
  }
  return null;
}

/**
 * "PRZYGOTUJ N UJĘĆ" (N = 5-10, the seller's choice): analyse every reference
 * once, build the Product Feature Manifest and Product Lock once, design
 * exactly N diverse product-appropriate scenes with per-scene reference
 * selection, and store N encrypted master prompts. Tracked through the
 * universal usage ledger (service `prompt_generation` — 0 credits: preparing
 * the plan never spends the seller's image budget).
 */
export async function runPromptSession(
  supabase: Client, userId: string, workspaceId: string, input: PromptSessionInput
): Promise<PromptSessionOutput> {
  if (!input.productName?.trim() || input.productName.trim().length < 2) return { ok: false, error: "invalid_input" };
  if (!RATIOS.has(input.aspectRatio)) return { ok: false, error: "invalid_input" };
  if (!input.referencePaths?.length) return { ok: false, error: "references_required" };

  const analysisModel = await getAnalysisModel(supabase);
  const backends = await getVisionBackends(supabase, analysisModel);
  if (backends.length === 0) return { ok: false, error: "analysis_unavailable" };

  const referenceHash = hashAnalysisInput(
    input.referencePaths.slice(0, MAX_REFS), input.productName, input.description ?? null,
  );

  // A NETWORK REPLAY MUST NOT START A SECOND PIPELINE. A preparation can
  // outlive a proxy's response window; the HTTP stack then re-sends the same
  // POST while the first one is still working. A request whose input matches
  // a session that is being analysed right now adopts that session and waits
  // for its result instead of duplicating the product, the session and the
  // whole analysis.
  const { data: inflight } = await supabase
    .from("prompt_sessions")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("status", "analyzing")
    .eq("reference_hash", referenceHash)
    .gte("created_at", new Date(Date.now() - 6 * 60_000).toISOString())
    .order("created_at", { ascending: true })
    .limit(1).maybeSingle();
  if (inflight) {
    const adopted = await waitForSession(supabase, inflight.id);
    if (adopted) return adopted;
    // The in-flight run failed or timed out — continue normally; a failed
    // session is picked up and reused by the retry block below.
  }

  // Product: reuse the selected one or create the draft automatically —
  // the user never has to visit "Products" first.
  let productId = input.productId ?? null;
  if (productId) {
    const { data: product } = await supabase
      .from("products").select("id, name, description, extra_info").eq("id", productId).eq("workspace_id", workspaceId).maybeSingle();
    if (!product) return { ok: false, error: "product_not_found" };
    // The session snapshots its own copy, but the PRODUCT stays the living
    // record: edits made in the form update it so the next visit is prefilled
    // with what the seller last wrote.
    const nextName = input.productName.trim();
    const nextDesc = input.description?.trim() || null;
    const nextExtra = input.extraInfo?.trim() || null;
    if (nextName !== product.name || nextDesc !== (product.description ?? null) || nextExtra !== (product.extra_info ?? null)) {
      await supabase.from("products")
        .update({ name: nextName, description: nextDesc, extra_info: nextExtra })
        .eq("id", productId).eq("workspace_id", workspaceId);
    }
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

  // RETRY REUSES THE FAILED SESSION. A click → error → click again must not
  // litter "Ostatnie sesje" with one dead row per attempt: when the exact
  // same input recently failed, that session is reset and reused instead.
  let sessionId: string | null = null;
  const { data: retryable } = await supabase
    .from("prompt_sessions")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("status", "failed")
    .eq("reference_hash", referenceHash)
    .gte("created_at", new Date(Date.now() - 2 * 3600_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle();
  if (retryable) {
    const { error: reuseError } = await supabase.from("prompt_sessions").update({
      status: "analyzing", error: null, error_stage: null,
      product_id: productId, aspect_ratio: input.aspectRatio,
      style: input.style?.trim() || null,
      extra_info: input.extraInfo?.trim() || null,
    }).eq("id", retryable.id);
    if (!reuseError) sessionId = retryable.id;
  }
  if (!sessionId) {
    const { data: session, error: sessionError } = await supabase.from("prompt_sessions").insert({
      workspace_id: workspaceId, user_id: userId, product_id: productId,
      product_name: input.productName.trim(),
      description: input.description?.trim() || null,
      extra_info: input.extraInfo?.trim() || null,
      aspect_ratio: input.aspectRatio, style: input.style?.trim() || null,
      reference_paths: input.referencePaths.slice(0, MAX_REFS),
      reference_hash: referenceHash,
      status: "analyzing",
      mode: "engine",
    }).select("id").single();
    if (sessionError || !session) return { ok: false, error: "session_create_failed" };
    sessionId = session.id;
  }
  const session = { id: sessionId };

  const { data: wallet } = await supabase
    .from("credit_wallets").select("id").eq("workspace_id", workspaceId).maybeSingle();
  if (!wallet) return { ok: false, error: "no_wallet" };

  const usage = await startUsage(supabase, {
    userId, workspaceId, walletId: wallet.id, serviceSlug: "prompt_generation",
    providerSlug: "google", modelSlug: analysisModel,
    // A reused (retried) session gets a fresh ledger event — the previous one
    // is already closed as failed and must not be resurrected.
    idempotencyKey: retryable ? `psession:${session.id}:retry:${Date.now()}` : `psession:${session.id}`,
    metadata: { session_id: session.id, images: input.referencePaths.length, shots: clampShots(input.shots) },
  });
  if (!usage.ok) {
    await supabase.from("prompt_sessions").update({ status: "failed", error: usage.error }).eq("id", session.id);
    return { ok: false, error: usage.error, sessionId: session.id };
  }

  const sessionInfo: SessionInput = {
    productName: input.productName.trim(),
    description: input.description?.trim() || null,
    extraInfo: input.extraInfo?.trim() || null,
    style: input.style?.trim() || null,
    aspectRatio: input.aspectRatio,
  };

  // Stage is tracked so a failed session tells admins WHERE it broke, and the
  // vision outcome records which provider actually served the session.
  let stage: "references" | "analysis" | "scenes" | "prompts" = "references";
  let usedOutcome: VisionOutcome | null = null;
  const startedAt = Date.now();
  // Per-stage wall clock for the admin log — the only way "too slow" ever
  // becomes an actionable statement. Durations only, never prompt content.
  const timings: Record<string, number> = {};
  let mark = Date.now();
  const lap = (name: string) => { timings[name] = Date.now() - mark; mark = Date.now(); };
  try {
    const images = await downloadReferences(supabase, input.referencePaths);
    if (images.length === 0) throw new ProviderError("references_required");
    lap("referencesMs");

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
      await supabase.from("product_analysis_cache")
        .update({ hits: (cached.hits ?? 0) + 1 }).eq("id", cached.id);
    } else {
      const fresh = await analyzeReferences(backends, images, sessionInfo);
      analyses = fresh.images;
      manifest = fresh.manifest;
      usedOutcome = fresh.outcome;
    }

    lap("analysisMs");

    // 2) PRODUCT LOCK
    const lock = buildProductLock(manifest, analyses);
    await supabase.from("prompt_sessions").update({
      image_analysis: analyses as never, feature_manifest: manifest as never,
      product_lock: lock as never,
      analysis_model: usedOutcome?.model ?? analysisModel,
      analysis_provider: usedOutcome?.provider ?? null,
      fallback_from: usedOutcome?.fallbackFrom ?? null,
      fallback_reason: usedOutcome?.fallbackReason ?? null,
      reference_hash: referenceHash, cache_hit: cacheHit,
    }).eq("id", session.id);
    if (!cacheHit) {
      // Awaited deliberately: a serverless function can freeze the moment the
      // response is sent, and a fire-and-forget insert would never land — the
      // cache would then never hit and every run would pay for analysis again.
      await supabase.from("product_analysis_cache").insert({
        workspace_id: workspaceId, product_id: productId,
        reference_hash: referenceHash, engine_version: ENGINE_VERSION,
        image_analysis: analyses as never, feature_manifest: manifest as never,
        product_lock: lock as never, analysis_model: analysisModel,
      });
    }

    // 3) SCENE STRATEGY + DIVERSITY
    // EXACT COUNT GUARANTEE, cheapest first: the single planner call asks for
    // a POOL of shots+2 candidates so the diversity/supported-view filters
    // can discard duds without a second sequential AI request. Only when the
    // trimmed pool is still short does one refill call run; whatever remains
    // missing after that is synthesized from always-renderable patterns. The
    // seller ordered N and receives exactly N.
    stage = "scenes";
    const shots = clampShots(input.shots);
    const customerLanguage = CUSTOMER_LANGUAGE[input.locale ?? "pl"] ?? "Polish";
    // When analysis already fell back, later calls in this run start directly
    // at the backend that answered — re-trying the throttled provider would
    // re-pay its whole model-id churn on every call.
    const liveBackends = usedOutcome?.fallbackFrom
      ? backends.filter((b) => b.provider === usedOutcome?.provider)
      : backends;
    const scened = await proposeScenes(liveBackends.length ? liveBackends : backends, images, analyses, manifest, sessionInfo, {
      count: candidatePoolSize(shots), customerLanguage,
    });
    let concepts = scened.concepts.slice(0, shots);
    usedOutcome = scened.outcome;
    const sceneryCategory = normalizeSceneryCategory(scened.sceneryCategory);
    const brandDomainPl = scened.brandDomainPl;
    if (concepts.length < shots) {
      const missing = shots - concepts.length;
      try {
        const extra = await proposeScenes(liveBackends.length ? liveBackends : backends, images, analyses, manifest, sessionInfo, {
          count: missing + 1, avoidSceneTypes: concepts.map((c) => c.scene_type), customerLanguage,
        });
        concepts = [...concepts, ...extra.concepts.filter((e) => !concepts.some((c) => c.scene_type === e.scene_type))].slice(0, shots);
      } catch { /* AI refill unavailable — synthesis below still guarantees the count */ }
    }
    if (concepts.length === 0) throw new ProviderError("analysis_empty", true);
    if (concepts.length < shots) {
      concepts = [...concepts, ...synthesizeConcepts(
        concepts, shots - concepts.length, manifest.identity, analyses, input.locale ?? "pl",
      )].slice(0, shots);
    }
    lap("scenesMs");

    // 4) FULL TEMPLATE PROMPTS — the PDF playbook composed server-side and
    // stored ONLY as ciphertext: fixed intro + scenery + quality signature,
    // product fidelity from verified facts, the concrete Polish shot
    // description, constraints. Each stored full_prompt goes 1:1 to the image
    // model later; the negative prompt is only a technical helper. QA rejects
    // a too-generic shot description and repairs it deterministically so the
    // ordered count never drops.
    stage = "prompts";
    let qaRepaired = 0;
    const rows = concepts.map((concept, idx) => {
      const strength = chooseLockStrength(concept, manifest, lock.conflicts);
      const compose = (c: typeof concept) => composeTemplatePrompt({
        concept: c, manifest, lock, aspectRatio: input.aspectRatio,
        category: sceneryCategory, brandDomainPl,
      });
      let prompt = compose(concept);
      if (!validateTemplatePrompt(prompt).ok) {
        qaRepaired++;
        concept = { ...concept, scene_text_pl: sceneTextFallback(concept, manifest.identity) };
        prompt = compose(concept);
      }
      const negative = assembleNegativePrompt(concept, manifest, lock);
      const sealed = encryptConceptPayload(prompt, negative, {
        tv: PROMPT_TEMPLATE_VERSION, goal: concept.marketing_purpose,
        comp: concept.camera_distance, cat: sceneryCategory,
      });
      const rationale = referenceRationale(concept, analyses)
        .map((r) => `${r.image} — ${r.label}`).join("; ");
      return {
        product_id: productId!, workspace_id: workspaceId, session_id: session.id,
        concept_name: concept.title, shot_type: concept.scene_type, scene_type: concept.scene_type,
        customer_title: concept.customer_title?.trim() || concept.title,
        customer_description: concept.customer_description?.trim() || null,
        prompt_text: "", negative_prompt: null,
        prompt_encrypted: sealed.ciphertext, prompt_iv: sealed.iv, prompt_tag: sealed.authTag,
        primary_reference: concept.primary_reference,
        supporting_references: concept.supporting_references as never,
        reference_indices: [concept.primary_reference, ...concept.supporting_references.map((s) => s.image)],
        reference_image_ids: [], reference_rationale: rationale,
        format: input.aspectRatio, style: input.style?.trim() || null,
        priority: idx + 1, status: "ready" as const, lock_strength: strength,
      };
    });
    lap("promptsMs");
    // A reused (retried) session may carry rows from a partially failed run.
    if (retryable) await supabase.from("generated_prompts").delete().eq("session_id", session.id);
    const { error: insertError } = await supabase.from("generated_prompts").insert(rows);
    if (insertError) throw new ProviderError("session_create_failed");
    lap("saveMs");

    await completeUsage(supabase, usage.eventId, rows.length);
    await supabase.from("prompt_sessions")
      .update({ status: "ready", latency_ms: Date.now() - startedAt })
      .eq("id", session.id);
    // Internal record of what served this session: primary attempted, why we
    // left it, which provider/model succeeded and how long it took.
    await supabase.rpc("log_activity", {
      p_workspace_id: workspaceId, p_action: "prompts.generated",
      p_entity_type: "prompt_session", p_entity_id: session.id,
      p_metadata: {
        prompts: rows.length, requested: shots, images: images.length, cache_hit: cacheHit,
        primary_provider: backends[0]?.provider ?? null, primary_model: analysisModel,
        used_provider: usedOutcome?.provider ?? null, used_model: usedOutcome?.model ?? null,
        fallback_from: usedOutcome?.fallbackFrom ?? null,
        fallback_reason: usedOutcome?.fallbackReason ?? null,
        vision_latency_ms: usedOutcome?.latencyMs ?? null,
        prompt_template_version: PROMPT_TEMPLATE_VERSION,
        scenery_category: sceneryCategory,
        qa_repaired: qaRepaired,
        timings,
        retried_session: Boolean(retryable),
        total_latency_ms: Date.now() - startedAt,
      },
    });
    return { ok: true, sessionId: session.id, productId: productId!, promptCount: rows.length };
  } catch (e) {
    const safe = e instanceof ProviderError ? e.safeMessage : "analysis_error";
    const providerCode = e instanceof ProviderError ? e.providerCode : undefined;
    await failUsage(supabase, { eventId: usage.eventId, walletId: wallet.id, error: safe });
    await supabase.from("prompt_sessions").update({
      status: "failed", error: safe, error_stage: stage, latency_ms: Date.now() - startedAt,
    }).eq("id", session.id);
    await supabase.rpc("log_activity", {
      p_workspace_id: workspaceId, p_action: "prompts.failed",
      p_entity_type: "prompt_session", p_entity_id: session.id,
      p_metadata: {
        stage, error: safe, provider_code: providerCode ?? null, model: analysisModel,
        providers_tried: backends.map((b) => b.provider),
        images: input.referencePaths.length, product_id: productId,
        requested: clampShots(input.shots), timings,
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

  const analysisModel = await getAnalysisModel(supabase);
  const backends = await getVisionBackends(supabase, analysisModel);
  if (backends.length === 0) return { ok: false, error: "analysis_unavailable" };

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
    const scened = await proposeScenes(backends, images, analyses, manifest, sessionInfo, {
      count: 1, avoidSceneTypes: avoid,
    });
    let [concept]: SceneConcept[] = scened.concepts;
    if (!concept) return { ok: false, error: "analysis_empty" };
    const strength = chooseLockStrength(concept, manifest, lock.conflicts);
    const category = normalizeSceneryCategory(scened.sceneryCategory);
    let prompt = composeTemplatePrompt({
      concept, manifest, lock, aspectRatio: session.aspect_ratio,
      category, brandDomainPl: scened.brandDomainPl,
    });
    if (!validateTemplatePrompt(prompt).ok) {
      concept = { ...concept, scene_text_pl: sceneTextFallback(concept, manifest.identity) };
      prompt = composeTemplatePrompt({
        concept, manifest, lock, aspectRatio: session.aspect_ratio,
        category, brandDomainPl: scened.brandDomainPl,
      });
    }
    const sealed = encryptConceptPayload(
      prompt,
      assembleNegativePrompt(concept, manifest, lock),
      { tv: PROMPT_TEMPLATE_VERSION, goal: concept.marketing_purpose, comp: concept.camera_distance, cat: category },
    );
    const rationale = referenceRationale(concept, analyses).map((r) => `${r.image} — ${r.label}`).join("; ");
    await supabase.from("generated_prompts").update({
      concept_name: concept.title, shot_type: concept.scene_type, scene_type: concept.scene_type,
      customer_title: concept.customer_title?.trim() || concept.title,
      customer_description: concept.customer_description?.trim() || null,
      prompt_text: "", negative_prompt: null,
      prompt_encrypted: sealed.ciphertext, prompt_iv: sealed.iv, prompt_tag: sealed.authTag,
      primary_reference: concept.primary_reference,
      supporting_references: concept.supporting_references as never,
      reference_indices: [concept.primary_reference, ...concept.supporting_references.map((s) => s.image)],
      reference_rationale: rationale, lock_strength: strength,
      generation_count: 0, last_job_id: null,
    }).eq("id", promptId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof ProviderError ? e.safeMessage : "analysis_error" };
  }
}

export { referenceRoleLabel };
