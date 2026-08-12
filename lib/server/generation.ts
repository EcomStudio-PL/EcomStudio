import "server-only";
import type { Client } from "@/lib/services/workspace";
import { decryptSecret, encryptionAvailable } from "@/lib/server/crypto";
import { getAdapter } from "@/lib/ai/registry";
import { ProviderError, type AspectRatio, type Resolution, type ReferenceImage } from "@/lib/ai/types";
import { buildFidelityInstructions } from "@/lib/ai/product-lock";
import { startUsage, completeUsage, failUsage } from "@/lib/services/usage";

export type GenerateInput = {
  modelId: string;
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
};

export type GenerateOutput =
  | { ok: true; jobId: string; productId: string; images: { url: string; path: string }[] }
  | { ok: false; error: string; missingCredits?: number };

const RATIOS = new Set(["1:1", "4:5", "16:9", "9:16"]);

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

  const { data: cred } = await supabase
    .from("ai_provider_credentials")
    .select("encrypted_value, iv, auth_tag, base_url")
    .eq("provider_id", provider.id).eq("active", true).maybeSingle();
  if (!cred) return { ok: false, error: "model_unavailable" };
  let apiKey: string;
  try { apiKey = decryptSecret(cred.encrypted_value, cred.iv, cred.auth_tag); }
  catch { return { ok: false, error: "credential_error" }; }

  // Wallet + server-side cost
  const cost = model.credit_cost * quantity;
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
    prompt_text: promptText, aspect_ratio: input.aspectRatio, quantity,
    resolution: input.resolution ?? null, provider_slug: provider.slug,
    status: "processing", started_at: new Date().toISOString(),
    reference_image_ids: input.referenceImageIds.slice(0, 8),
    settings: { resolution: input.resolution ?? null, negative: input.negative ?? null } as never,
  }).select("id").single();
  if (jobError || !job) return { ok: false, error: "job_create_failed" };

  // Charge through the usage ledger (idempotent on job id)
  const usage = await startUsage(supabase, {
    userId, workspaceId, walletId: wallet.id, serviceSlug: "image_generation",
    providerSlug: provider.slug, modelSlug: model.model_identifier,
    generationJobId: job.id, idempotencyKey: `job:${job.id}`,
    metadata: { quantity, model: model.model_identifier },
  });
  if (!usage.ok) {
    await supabase.from("generation_jobs").update({ status: "failed", error_message: usage.error }).eq("id", job.id);
    return { ok: false, error: usage.error };
  }
  // The catalog charge covers one unit; charge the remaining units directly
  // against the same event so cost == model credit_cost × quantity.
  const { data: service } = await supabase.from("service_catalog")
    .select("credits_cost").eq("slug", "image_generation").maybeSingle();
  const remainder = cost - (service?.credits_cost ?? 0);
  if (remainder !== 0) {
    const { error: adjustError } = await supabase.rpc("apply_credit_transaction", {
      p_wallet_id: wallet.id, p_amount: -remainder, p_type: "generation",
      p_description: `${model.name} ×${quantity}`, p_reference_id: usage.eventId,
      p_metadata: { adjustment: "quantity_and_model" } as never, p_created_by: userId,
    });
    if (adjustError) {
      await failUsage(supabase, { eventId: usage.eventId, walletId: wallet.id, error: "insufficient_credits" });
      await supabase.from("generation_jobs").update({ status: "failed", error_message: "insufficient_credits" }).eq("id", job.id);
      return { ok: false, error: "insufficient_credits" };
    }
    await supabase.from("usage_events").update({ credits_charged: cost }).eq("id", usage.eventId);
  }

  // Reference images -> base64 (only when the adapter supports them)
  const refs: ReferenceImage[] = [];
  if (adapter.capabilities.supportsReferenceImages && model.supports_reference_images) {
    for (const path of input.referencePaths.slice(0, model.max_reference_images || 4)) {
      const { data: blob } = await supabase.storage.from("product-images").download(path);
      if (!blob) continue;
      const buf = Buffer.from(await blob.arrayBuffer());
      const ext = path.split(".").pop()?.toLowerCase();
      refs.push({ base64: buf.toString("base64"), mime: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg" });
    }
  }

  const fidelity = `${buildFidelityInstructions(productInstructions)}${productContext}`;

  // Provider call
  let result;
  try {
    result = await adapter.generate(model, {
      prompt: promptText, aspectRatio: input.aspectRatio, resolution: input.resolution,
      quantity, referenceImages: refs, productLock: { fidelityInstructions: fidelity },
    }, { apiKey, baseUrl: cred.base_url });
  } catch (e) {
    const safe = e instanceof ProviderError ? e.safeMessage : "provider_error";
    await failUsage(supabase, { eventId: usage.eventId, walletId: wallet.id, error: safe });
    // failUsage refunds the base charge; refund the remainder adjustment too.
    if (remainder > 0) {
      await supabase.rpc("apply_credit_transaction", {
        p_wallet_id: wallet.id, p_amount: remainder, p_type: "refund",
        p_description: "Refund: image_generation", p_reference_id: usage.eventId,
        p_metadata: { reason: "generation_failed", part: "quantity_adjustment" } as never,
      });
    }
    await supabase.from("generation_jobs").update({
      status: "failed", error_message: safe, completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    await supabase.from("notifications").insert({
      user_id: userId, type: "generation_failed", title: "generation_failed",
      body: safe, href: "/history",
    });
    return { ok: false, error: safe };
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
      await supabase.from("generation_assets").insert({
        generation_id: generation.id, asset_type: "image", storage_path: path,
        width: img.width ?? null, height: img.height ?? null,
        metadata: { provider: provider.slug, model: model.model_identifier } as never,
      });
      const { data: signed } = await supabase.storage.from("generation-assets").createSignedUrl(path, 3600);
      if (signed) stored.push({ url: signed.signedUrl, path });
    }
    idx++;
  }

  if (stored.length === 0) {
    await failUsage(supabase, { eventId: usage.eventId, walletId: wallet.id, error: "storage_failed" });
    if (remainder > 0) {
      await supabase.rpc("apply_credit_transaction", {
        p_wallet_id: wallet.id, p_amount: remainder, p_type: "refund",
        p_description: "Refund: image_generation", p_reference_id: usage.eventId,
        p_metadata: { reason: "storage_failed" } as never,
      });
    }
    await supabase.from("generation_jobs").update({ status: "failed", error_message: "storage_failed", completed_at: new Date().toISOString() }).eq("id", job.id);
    return { ok: false, error: "storage_failed" };
  }

  await completeUsage(supabase, usage.eventId, stored.length);
  await supabase.from("generation_jobs").update({
    status: "completed", credits_charged: cost, completed_at: new Date().toISOString(),
  }).eq("id", job.id);
  await supabase.from("notifications").insert({
    user_id: userId, type: "generation_done", title: "generation_done",
    body: `${model.name} ×${stored.length}`, href: "/library",
  });
  await supabase.rpc("log_activity", {
    p_workspace_id: workspaceId, p_action: "generation.completed",
    p_entity_type: "generation_job", p_entity_id: job.id,
    p_metadata: { model: model.model_identifier, count: stored.length, credits: cost },
  });

  return { ok: true, jobId: job.id, productId: productId!, images: stored };
}

function buildProductContext(name: string, description: string | null, extraInfo: string | null): string {
  const parts = [`\nPRODUCT CONTEXT:\nProduct: ${name}`];
  if (description) parts.push(`Description: ${description.slice(0, 1200)}`);
  if (extraInfo) parts.push(`Additional information: ${extraInfo.slice(0, 2500)}`);
  return parts.join("\n");
}
