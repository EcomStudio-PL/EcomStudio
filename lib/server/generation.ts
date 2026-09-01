import "server-only";
import type { Client } from "@/lib/services/workspace";
import { decryptSecret, encryptionAvailable } from "@/lib/server/crypto";
import { getAdapter } from "@/lib/ai/registry";
import {
  ProviderError, priceForResolution,
  type AspectRatio, type ImageProviderAdapter, type Resolution, type ReferenceImage,
} from "@/lib/ai/types";
import { buildFidelityInstructions } from "@/lib/ai/product-lock";
import { startUsage, completeUsage, failUsage } from "@/lib/services/usage";
import {
  MAX_ATTEMPTS_PER_PROVIDER, getProviderHealth, providerBlocked,
  recordProviderFailure, recordProviderSuccess, retryDelayMs, sleep, withProviderLimit,
} from "@/lib/server/provider-router";

export type GenerateInput = {
  modelId: string;
  /** Ordered fallback models tried when the primary fails for a
   *  provider-side reason. Same prompt, same references, same single credit
   *  reservation — a fallback is GrovBase's infrastructure problem, never a
   *  second charge. */
  fallbackModelIds?: string[];
  prompt: string;
  negative?: string;
  aspectRatio: AspectRatio;
  resolution?: Resolution;
  quantity: number;
  productId?: string;
  newProduct?: {
    name: string; sku?: string; category?: string; description?: string;
    extraInfo?: string; sourceUrl?: string; marketplace?: string;
  };
  /** Storage paths in product-images already uploaded by the client. */
  referencePaths: string[];
  referenceImageIds: string[];
  /** Style/scene INSPIRATION images (custom mode): they steer mood, light,
   *  framing and environment but must never redefine the product itself —
   *  the instruction block below makes that contract explicit per call. */
  inspirationPaths?: string[];
  /** Regeneration guidance: a copy of the image being corrected with the
   *  customer's hand-drawn annotations flattened onto it. Attached as the
   *  FINAL reference with a contract that the marks locate the requested
   *  changes and must never be rendered in the output. */
  markedImagePath?: string;
  /** Prompt-engine handoff: link the job to its prompt + session. */
  promptId?: string;
  promptSessionId?: string;
  /** Concept engine: the prompt is GrovBase IP — the job row must not
   *  mirror it in clear (the encrypted copy lives on the concept). */
  hidePromptText?: boolean;
  /** Concept regeneration lineage, recorded on the job row. */
  parentJobId?: string;
  conceptId?: string;
  /** Where the prompt came from — prices differ: "custom" charges the model's
   *  base credits, "ecomstudio" adds the admin-configured engine surcharge. */
  promptOrigin?: "ecomstudio" | "custom";
  /** Full credit price decided by the caller (base + surcharge). The server
   *  still verifies balance and reserves exactly this amount. */
  costOverride?: number;
  /** Set by routes serving customer model choices: a model the admin hid
   *  from the custom generator cannot be requested by id. */
  requireCustomVisible?: boolean;
};

export type GenerateOutput =
  | { ok: true; jobId: string; productId: string; images: { url: string; path: string }[]; credits: number }
  | { ok: false; error: string; missingCredits?: number };

const RATIOS = new Set(["1:1", "3:4", "4:5", "16:9", "9:16"]);

/** Longest edge of the gallery thumbnail derivative. Originals stay the
 *  source of truth; the thumb only spares the grid from full-size loads. */
const THUMB_EDGE = 640;

/**
 * The full real generation path: resolve model + decrypted credential →
 * ensure product (ad-hoc creation supported) → charge credits through the
 * usage ledger (snapshotted, idempotent) → call the provider → store
 * outputs → record generation + assets → complete or refund. The SERVER is
 * the authority for cost; the client only previews it.
 */
export async function runGeneration(supabase: Client, userId: string, workspaceId: string, input: GenerateInput): Promise<GenerateOutput> {
  if (!input.prompt.trim() || !RATIOS.has(input.aspectRatio)) return { ok: false, error: "invalid_input" };
  const quantity = Math.min(Math.max(Math.trunc(input.quantity) || 1, 1), 4);
  if (!encryptionAvailable()) return { ok: false, error: "encryption_unavailable" };

  // Model + provider + credential
  const { data: model } = await supabase
    .from("ai_models")
    .select("*, ai_providers!inner(id, slug, active)")
    .eq("id", input.modelId).eq("active", true).eq("ai_providers.active", true)
    .maybeSingle();
  const provider = (model as unknown as { ai_providers: { id: string; slug: string } } | null)?.ai_providers;
  const adapter = provider ? getAdapter(provider.slug) : undefined;
  if (!model || !provider || !adapter) return { ok: false, error: "model_unavailable" };
  if (input.requireCustomVisible && (model as { visible_custom?: boolean }).visible_custom === false) {
    return { ok: false, error: "model_unavailable" };
  }

  // Definer RPC: RLS keeps the credentials table admin-only; this returns
  // ciphertext usable only with the server-side APP_ENCRYPTION_KEY.
  const { data: credRows } = await supabase.rpc("get_active_provider_credential", { p_provider_id: provider.id });
  const cred = credRows?.[0];
  if (!cred) return { ok: false, error: "model_unavailable" };
  let apiKey: string;
  try { apiKey = decryptSecret(cred.encrypted_value, cred.iv, cred.auth_tag); }
  catch { return { ok: false, error: "credential_error" }; }

  // Resolution must be one the model actually supports (capability-driven
  // UI can never request an impossible variant; the server enforces it too).
  const supportedRes = model.supported_resolutions ?? ["1K"];
  const resolution = (input.resolution && supportedRes.includes(input.resolution)
    ? input.resolution
    : supportedRes[0]) as Resolution | undefined;

  // Same contract for the framing: a ratio outside what this model + adapter
  // genuinely render snaps to the first supported one instead of silently
  // producing a mislabeled crop (3:4 exists only on engines that draw it).
  const adapterRatios = adapter.capabilities.ratios ?? ["1:1", "4:5", "16:9", "9:16"];
  const modelRatios = (model.supported_aspect_ratios?.length ? model.supported_aspect_ratios : adapterRatios)
    .filter((r) => (adapterRatios as string[]).includes(r));
  const aspectRatio = (modelRatios.includes(input.aspectRatio)
    ? input.aspectRatio
    : modelRatios[0] ?? "1:1") as AspectRatio;

  // Wallet + server-side cost (per-resolution price from the model config)
  const baseCost = priceForResolution(model, resolution ?? "1K") * quantity;
  const cost = typeof input.costOverride === "number" && input.costOverride >= baseCost
    ? Math.trunc(input.costOverride) : baseCost;
  const { data: wallet } = await supabase
    .from("credit_wallets").select("id, balance").eq("workspace_id", workspaceId).maybeSingle();
  if (!wallet) return { ok: false, error: "no_wallet" };
  if (wallet.balance < cost) return { ok: false, error: "insufficient_credits", missingCredits: cost - wallet.balance };

  // Product: use existing or create ad-hoc from studio context
  let productId = input.productId ?? null;
  let productInstructions: string | null = null;
  let productContext = "";
  if (productId) {
    const { data: product } = await supabase
      .from("products").select("id, name, description, instructions, extra_info")
      .eq("id", productId).eq("workspace_id", workspaceId).maybeSingle();
    if (!product) return { ok: false, error: "product_not_found" };
    productInstructions = product.instructions;
    productContext = buildProductContext(product.name, product.description, product.extra_info);
  } else if (input.newProduct?.name?.trim()) {
    const np = input.newProduct;
    const { data: created, error: createError } = await supabase.from("products").insert({
      workspace_id: workspaceId, owner_id: userId, name: np.name.trim(),
      sku: np.sku?.trim() || null, category: np.category?.trim() || null,
      description: np.description?.trim() || null, extra_info: np.extraInfo?.trim() || null,
      source_url: np.sourceUrl?.trim() || null, marketplace: np.marketplace?.trim() || null,
      status: "ready",
    }).select("id").single();
    if (createError || !created) return { ok: false, error: "product_create_failed" };
    productId = created.id;
    productContext = buildProductContext(np.name, np.description ?? null, np.extraInfo ?? null);
    if (input.referencePaths.length > 0) {
      await supabase.from("product_images").insert(
        input.referencePaths.slice(0, 8).map((path, i) => ({
          product_id: created.id, storage_path: path, sort_order: i, is_primary: i === 0,
        }))
      );
    }
  } else {
    return { ok: false, error: "product_required" };
  }

  // Job (queued -> processing)
  const promptText = [input.prompt.trim(), input.negative?.trim() ? `AVOID: ${input.negative.trim()}` : ""]
    .filter(Boolean).join("\n");
  const { data: job, error: jobError } = await supabase.from("generation_jobs").insert({
    workspace_id: workspaceId, product_id: productId, user_id: userId, model_id: model.id,
    prompt_text: input.hidePromptText ? null : promptText, aspect_ratio: aspectRatio, quantity,
    resolution: resolution ?? null, provider_slug: provider.slug,
    negative_prompt: input.hidePromptText ? null : input.negative?.trim() || null,
    prompt_id: input.promptId ?? null,
    prompt_session_id: input.promptSessionId ?? null,
    prompt_origin: input.promptOrigin ?? null,
    parent_job_id: input.parentJobId ?? null,
    status: "processing", started_at: new Date().toISOString(),
    reference_image_ids: input.referenceImageIds.slice(0, 8),
    settings: {
      resolution: resolution ?? null,
      negative: input.hidePromptText ? null : input.negative ?? null,
      concept_id: input.conceptId ?? null,
      parent_job_id: input.parentJobId ?? null,
      inspiration_count: input.inspirationPaths?.length || undefined,
    } as never,
  }).select("id").single();
  if (jobError || !job) return { ok: false, error: "job_create_failed" };

  // Charge through the usage ledger (idempotent on job id)
  const usage = await startUsage(supabase, {
    userId, workspaceId, walletId: wallet.id, serviceSlug: "image_generation",
    providerSlug: provider.slug, modelSlug: model.model_identifier,
    generationJobId: job.id, idempotencyKey: `job:${job.id}`,
    metadata: { quantity, model: model.model_identifier, prompt_origin: input.promptOrigin ?? null },
    creditsCharged: cost,
  });
  if (!usage.ok) {
    await supabase.from("generation_jobs").update({ status: "failed", error_message: usage.error }).eq("id", job.id);
    return { ok: false, error: usage.error };
  }

  // Reference images -> base64 (only when the adapter supports them)
  const refs: ReferenceImage[] = [];
  let inspirationCount = 0;
  let productRefCount = 0;
  let markedAttached = false;
  if (adapter.capabilities.supportsReferenceImages && model.supports_reference_images) {
    const maxRefs = model.max_reference_images || 6;
    // Product identity comes first: inspiration may take at most two slots,
    // the marked guidance image one, and only the slots the product
    // references leave free.
    const inspWanted = (input.inspirationPaths ?? []).slice(0, 5);
    const wantMarked = !!input.markedImagePath;
    const reserved = (inspWanted.length > 0 ? Math.min(2, inspWanted.length) : 0) + (wantMarked ? 1 : 0);
    const productBudget = reserved > 0 ? Math.max(1, maxRefs - reserved) : maxRefs;
    const download = async (path: string) => {
      const { data: blob } = await supabase.storage.from("product-images").download(path);
      if (!blob) return null;
      const buf = Buffer.from(await blob.arrayBuffer());
      const ext = path.split(".").pop()?.toLowerCase();
      return { base64: buf.toString("base64"), mime: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg" };
    };
    // The prompt engine hands over 3-6 role-assigned references; the cap comes
    // from the model config so the extra verified angles actually reach the
    // provider instead of being silently dropped.
    for (const path of input.referencePaths.slice(0, productBudget)) {
      const ref = await download(path);
      if (ref) refs.push(ref);
    }
    productRefCount = refs.length;
    for (const path of inspWanted) {
      if (refs.length >= maxRefs - (wantMarked ? 1 : 0)) break;
      const ref = await download(path);
      if (ref) { refs.push(ref); inspirationCount++; }
    }
    // The marked guidance image rides LAST, so "the final attached image"
    // in its contract below is unambiguous.
    if (wantMarked && refs.length < maxRefs) {
      const ref = await download(input.markedImagePath!);
      if (ref) { refs.push(ref); markedAttached = true; }
    }
  }

  // Inspiration steers the scene, never the product: the contract rides in
  // the same protected block as the Product Lock, in the model's language.
  const inspirationContract = inspirationCount > 0
    ? (markedAttached
      ? `\n\nINSPIRATION IMAGES: attached image(s) ${productRefCount + 1}–${productRefCount + inspirationCount} are style and scene inspiration ONLY. Take mood, lighting, environment, framing and atmosphere from them. The PRODUCT itself must match ONLY the first ${productRefCount} product reference image(s) exactly — never copy products, shapes, colors, labels or branding from the inspiration images.`
      : `\n\nINSPIRATION IMAGES: the final ${inspirationCount} attached image(s) are style and scene inspiration ONLY. Take mood, lighting, environment, framing and atmosphere from them. The PRODUCT itself must match ONLY the first ${refs.length - inspirationCount} product reference image(s) exactly — never copy products, shapes, colors, labels or branding from the inspiration images.`)
    : "";
  // The customer's drawn annotations LOCATE corrections; they are guidance,
  // never content — the contract forbids rendering the marks themselves.
  const markedContract = markedAttached
    ? `\n\nMARKED GUIDANCE IMAGE: the FINAL attached image is a copy of the previously generated photo with the customer's hand-drawn annotations on it (strokes, boxes, circles, lines, arrows, highlighted regions). The annotations only indicate WHERE the requested corrections apply. The drawn marks themselves are NOT part of the product or the scene — never render them, their colors or their shapes in the output. Apply the customer's corrections in the marked regions and keep the product and the rest of the scene unchanged.`
    : "";
  const fidelity = `${buildFidelityInstructions(productInstructions)}${productContext}${inspirationContract}${markedContract}`;

  /**
   * PROVIDER LOOP — one credit reservation, many chances to deliver.
   *
   * The primary model goes first; every retryable error gets backoff (with
   * the provider's Retry-After when sent), a quota/auth failure marks the
   * provider's health and moves straight to the next candidate. Whatever
   * finally serves the image is written back onto the job, and every attempt
   * is logged for the admin — provider, model, HTTP status, upstream code —
   * never the prompt, never a key.
   */
  const startedAt = Date.now();
  const health = await getProviderHealth(supabase);
  const candidateIds = [input.modelId, ...(input.fallbackModelIds ?? [])]
    .filter((id, i, arr) => arr.indexOf(id) === i);

  type Attempt = {
    provider: string; model: string; attempt: number;
    error: string; code?: string; status?: number; message?: string;
  };
  const attempts: Attempt[] = [];
  let result: Awaited<ReturnType<ImageProviderAdapter["generate"]>> | null = null;
  let served: { model: typeof model; providerSlug: string } | null = null;
  let lastError: ProviderError | null = null;

  for (const candidateId of candidateIds) {
    // The primary is already resolved; fallbacks resolve on demand.
    let cModel = model, cProviderSlug = provider.slug, cAdapter = adapter;
    let cApiKey = apiKey, cBaseUrl: string | null = cred.base_url;
    if (candidateId !== input.modelId) {
      const resolved = await resolveModelCandidate(supabase, candidateId);
      if (!resolved) { attempts.push({ provider: "?", model: candidateId, attempt: 0, error: "model_unavailable" }); continue; }
      cModel = resolved.model; cProviderSlug = resolved.providerSlug;
      cAdapter = resolved.adapter; cApiKey = resolved.apiKey; cBaseUrl = resolved.baseUrl;
    }

    // A fallback that cannot carry the concept's references would break the
    // Product Lock — skip it rather than render a lookalike.
    const supportsRefs = cAdapter.capabilities.supportsReferenceImages && cModel.supports_reference_images;
    if (refs.length > 0 && !supportsRefs && candidateId !== input.modelId) {
      attempts.push({ provider: cProviderSlug, model: cModel.model_identifier, attempt: 0, error: "references_unsupported" });
      continue;
    }

    // A fallback that cannot render the paid framing would deliver a
    // mislabeled crop (a 3:4 session must not silently become 1:1).
    const cAdapterRatios = cAdapter.capabilities.ratios ?? ["1:1", "4:5", "16:9", "9:16"];
    const cModelRatios = (cModel.supported_aspect_ratios?.length ? cModel.supported_aspect_ratios : cAdapterRatios)
      .filter((r) => (cAdapterRatios as string[]).includes(r));
    if (candidateId !== input.modelId && !cModelRatios.includes(aspectRatio)) {
      attempts.push({ provider: cProviderSlug, model: cModel.model_identifier, attempt: 0, error: "ratio_unsupported" });
      continue;
    }

    // Respect health cooldowns while an alternative remains.
    const isLastCandidate = candidateId === candidateIds[candidateIds.length - 1];
    if (providerBlocked(health, cProviderSlug) && !isLastCandidate) {
      attempts.push({
        provider: cProviderSlug, model: cModel.model_identifier, attempt: 0,
        error: "skipped_unhealthy", code: health.get(cProviderSlug)?.state,
      });
      continue;
    }

    const cResolution = (input.resolution && (cModel.supported_resolutions ?? []).includes(input.resolution)
      ? input.resolution
      : (cModel.supported_resolutions ?? ["1K"])[0]) as Resolution | undefined;
    const cRefs = supportsRefs ? refs.slice(0, cModel.max_reference_images || 6) : [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PROVIDER; attempt++) {
      try {
        result = await withProviderLimit(cProviderSlug, () => cAdapter.generate(cModel, {
          prompt: promptText, aspectRatio, resolution: cResolution,
          quantity, referenceImages: cRefs, productLock: { fidelityInstructions: fidelity },
        }, { apiKey: cApiKey, baseUrl: cBaseUrl }));
        served = { model: cModel, providerSlug: cProviderSlug };
        if (health.get(cProviderSlug) && health.get(cProviderSlug)!.state !== "healthy") {
          await recordProviderSuccess(supabase, cProviderSlug);
        }
        break;
      } catch (e) {
        const pe = e instanceof ProviderError ? e : new ProviderError("provider_error");
        lastError = pe;
        attempts.push({
          provider: cProviderSlug, model: cModel.model_identifier, attempt,
          error: pe.safeMessage, code: pe.providerCode,
          status: pe.upstream?.status, message: pe.upstream?.message,
        });
        await recordProviderFailure(supabase, cProviderSlug, pe);
        if (!pe.retriable || attempt === MAX_ATTEMPTS_PER_PROVIDER) break; // next candidate
        await sleep(retryDelayMs(attempt, pe.upstream?.retryAfterMs));
      }
    }
    if (result) break;
  }

  if (!result || !served) {
    const safe = lastError?.safeMessage ?? "provider_error";
    await failUsage(supabase, { eventId: usage.eventId, walletId: wallet.id, error: safe });
    await supabase.from("generation_jobs").update({
      status: "failed", error_message: safe, error_class: safe,
      latency_ms: Date.now() - startedAt, completed_at: new Date().toISOString(),
      settings: {
        resolution: resolution ?? null,
        concept_id: input.conceptId ?? null,
        parent_job_id: input.parentJobId ?? null,
        attempts,
      } as never,
    }).eq("id", job.id);
    await supabase.from("notifications").insert({
      user_id: userId, type: "generation_failed", title: "generation_failed",
      body: safe, href: "/history",
    });
    return { ok: false, error: safe };
  }

  // The job records whoever actually delivered, plus the attempt trail.
  const model2 = served.model;
  if (served.model.id !== model.id || attempts.length > 0) {
    await supabase.from("generation_jobs").update({
      model_id: served.model.id, provider_slug: served.providerSlug,
      settings: {
        resolution: resolution ?? null,
        concept_id: input.conceptId ?? null,
        parent_job_id: input.parentJobId ?? null,
        attempts,
      } as never,
    }).eq("id", job.id);
  }

  // Store outputs + records
  const { data: generation } = await supabase.from("generations").insert({
    job_id: job.id, product_id: productId, workspace_id: workspaceId, quality_status: "skipped",
  }).select("id").single();

  const stored: { url: string; path: string }[] = [];
  let idx = 0;
  for (const img of result.images) {
    let bytes: Buffer | null = null;
    let mime = img.mime || "image/png";
    if (img.base64) bytes = Buffer.from(img.base64, "base64");
    else if (img.url) {
      const dl = await fetch(img.url, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
      if (dl?.ok) {
        bytes = Buffer.from(await dl.arrayBuffer());
        mime = dl.headers.get("content-type")?.split(";")[0] || mime;
      }
    }
    if (!bytes) continue;
    const ext = mime.includes("webp") ? "webp" : mime.includes("jpeg") ? "jpg" : "png";
    const path = `${workspaceId}/${job.id}/${idx}.${ext}`;
    const { error: upErr } = await supabase.storage.from("generation-assets")
      .upload(path, bytes, { contentType: mime, upsert: true });
    if (!upErr && generation) {
      // Gallery thumbnail derivative: grids load ~40KB instead of a full
      // render. Best-effort — a failed thumb never fails the generation,
      // the gallery just falls back to the original.
      let thumbPath: string | null = null;
      let dims: { width?: number; height?: number } = { width: img.width, height: img.height };
      try {
        const { default: sharp } = await import("sharp");
        const pipeline = sharp(bytes, { failOn: "none" });
        const meta = await pipeline.metadata();
        if (meta.width && meta.height) dims = { width: meta.width, height: meta.height };
        const thumb = await pipeline
          .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 72 })
          .toBuffer();
        const tPath = `${workspaceId}/${job.id}/${idx}_t.webp`;
        const { error: tErr } = await supabase.storage.from("generation-assets")
          .upload(tPath, thumb, { contentType: "image/webp", upsert: true });
        if (!tErr) thumbPath = tPath;
      } catch { /* originals remain the source of truth */ }
      await supabase.from("generation_assets").insert({
        generation_id: generation.id, asset_type: "image", storage_path: path,
        width: dims.width ?? null, height: dims.height ?? null,
        metadata: { provider: served.providerSlug, model: model2.model_identifier, thumb: thumbPath } as never,
      });
      stored.push({ url: "", path });
    }
    idx++;
  }
  // One batched signing call for the whole set instead of one per image.
  if (stored.length > 0) {
    const { data: signed } = await supabase.storage.from("generation-assets")
      .createSignedUrls(stored.map((s) => s.path), 3600);
    signed?.forEach((entry) => {
      const hit = stored.find((s) => s.path === entry.path);
      if (hit && entry.signedUrl) hit.url = entry.signedUrl;
    });
  }

  if (stored.length === 0) {
    await failUsage(supabase, { eventId: usage.eventId, walletId: wallet.id, error: "storage_failed" });
    await supabase.from("generation_jobs").update({
      status: "failed", error_message: "storage_failed", error_class: "storage_failed",
      latency_ms: Date.now() - startedAt, completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    return { ok: false, error: "storage_failed" };
  }

  // PARTIAL DELIVERY: a batch that stored fewer images than were paid for
  // hands the undelivered share back before the event closes. Definer RPC,
  // once per event, never below zero — see 0041_partial_refund.sql.
  const perImage = quantity > 0 ? Math.floor(cost / quantity) : 0;
  const shortfall = quantity - stored.length;
  let refunded = 0;
  if (shortfall > 0 && perImage > 0) {
    const { data: refundTx } = await supabase.rpc("refund_usage_partial", {
      p_event_id: usage.eventId, p_amount: shortfall * perImage,
    });
    if (refundTx) refunded = shortfall * perImage;
  }
  const charged = cost - refunded;

  // REAL provider cost of this call: the admin-maintained per-image cost of
  // this exact model multiplied by the images the provider actually
  // delivered. Recorded on the event so admin margin reporting is built from
  // facts rather than from the catalog estimate.
  const requestId = (result.providerMetadata?.requestId as string | undefined) ?? null;
  await completeUsage(supabase, usage.eventId, stored.length, {
    apiCostUsdMicros: (model2.internal_cost_usd_micros ?? 0) * stored.length,
    providerRequestId: requestId,
  });
  await supabase.from("generation_jobs").update({
    status: "completed", credits_charged: charged, latency_ms: Date.now() - startedAt,
    request_id: requestId,
    completed_at: new Date().toISOString(),
  }).eq("id", job.id);
  await supabase.from("notifications").insert({
    user_id: userId, type: "generation_done", title: "generation_done",
    body: `${model2.name} ×${stored.length}`, href: "/library",
  });
  await supabase.rpc("log_activity", {
    p_workspace_id: workspaceId, p_action: "generation.completed",
    p_entity_type: "generation_job", p_entity_id: job.id,
    p_metadata: { model: model2.model_identifier, provider: served.providerSlug, count: stored.length, credits: charged, fallback_attempts: attempts.length },
  });

  // Only entries that actually got a signed URL go back to the caller — an
  // asset whose signing failed still exists in the library and will sign on
  // the next page load.
  return { ok: true, jobId: job.id, productId: productId!, images: stored.filter((s) => s.url), credits: charged };
}

/** Resolve one fallback candidate: active model + active provider + adapter
 *  + decrypted credential. A candidate missing any of those is skipped. */
async function resolveModelCandidate(supabase: Client, modelId: string) {
  const { data: model } = await supabase
    .from("ai_models")
    .select("*, ai_providers!inner(id, slug, active)")
    .eq("id", modelId).eq("active", true).eq("ai_providers.active", true)
    .maybeSingle();
  const provider = (model as unknown as { ai_providers: { id: string; slug: string } } | null)?.ai_providers;
  const adapter = provider ? getAdapter(provider.slug) : undefined;
  if (!model || !provider || !adapter) return null;
  const { data: credRows } = await supabase.rpc("get_active_provider_credential", { p_provider_id: provider.id });
  const cred = credRows?.[0];
  if (!cred) return null;
  try {
    return {
      model, providerSlug: provider.slug, adapter,
      apiKey: decryptSecret(cred.encrypted_value, cred.iv, cred.auth_tag),
      baseUrl: cred.base_url,
    };
  } catch { return null; }
}

function buildProductContext(name: string, description: string | null, extraInfo: string | null): string {
  const parts = [`\nPRODUCT CONTEXT:\nProduct: ${name}`];
  if (description) parts.push(`Description: ${description.slice(0, 1200)}`);
  if (extraInfo) parts.push(`Additional information: ${extraInfo.slice(0, 2500)}`);
  return parts.join("\n");
}
