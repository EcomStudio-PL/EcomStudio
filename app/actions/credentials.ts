"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { encryptSecret, decryptSecret, encryptionAvailable } from "@/lib/server/crypto";
import { testProviderConnection } from "@/lib/server/provider-test";
import { getAdapter } from "@/lib/ai/registry";
import { ProviderError } from "@/lib/ai/types";

type Result = { ok: boolean; error?: string; status?: string; message?: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}

/** Encrypt and store a provider credential. Plaintext is used only in-memory. */
export async function saveProviderCredentialAction(
  providerId: string, apiKey: string, baseUrl?: string
): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!encryptionAvailable()) return { ok: false, error: "encryption_unavailable" };
    const key = apiKey.trim();
    if (key.length < 8) return { ok: false, error: "invalid" };
    const { ciphertext, iv, authTag } = encryptSecret(key);
    const row = {
      provider_id: providerId,
      credential_name: "api_key",
      encrypted_value: ciphertext,
      iv,
      auth_tag: authTag,
      last_four: key.slice(-4),
      base_url: baseUrl?.trim() || null,
      active: true,
      last_tested_at: null,
      last_test_status: null,
      last_test_error_safe: null,
      updated_at: new Date().toISOString(),
      updated_by: adminId,
    };
    // Explicit replace-or-insert: an UPDATE on the existing row (a key swap
    // must really overwrite the previous secret) or a fresh INSERT — and on
    // failure the REAL database error code comes back instead of "generic",
    // so the admin sees why a save was refused.
    const { data: existing, error: readError } = await supabase
      .from("ai_provider_credentials").select("id").eq("provider_id", providerId).maybeSingle();
    if (readError) return { ok: false, error: `db:${readError.code || readError.message}` };
    const write = existing
      ? await supabase.from("ai_provider_credentials").update(row).eq("provider_id", providerId).select("id").maybeSingle()
      : await supabase.from("ai_provider_credentials").insert(row).select("id").maybeSingle();
    if (write.error) return { ok: false, error: `db:${write.error.code || write.error.message}` };
    // RLS can silently swallow a write (0 rows) without an error object —
    // report that honestly instead of pretending the key was replaced.
    if (!write.data) return { ok: false, error: "db:rls_denied" };
    await supabase.rpc("log_activity", {
      p_workspace_id: null as unknown as string, p_action: "admin.provider_credential_saved",
      p_entity_type: "ai_provider", p_entity_id: providerId,
    });
    revalidatePath("/admin/providers");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message === "encryption_key_missing" ? "encryption_unavailable" : "generic" };
  }
}

export async function deleteProviderCredentialAction(providerId: string): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("ai_provider_credentials").delete().eq("provider_id", providerId);
    if (error) return { ok: false, error: "generic" };
    await supabase.rpc("log_activity", {
      p_workspace_id: null as unknown as string, p_action: "admin.provider_credential_deleted",
      p_entity_type: "ai_provider", p_entity_id: providerId,
    });
    revalidatePath("/admin/providers");
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}

/**
 * REAL image-generation test. A key can list models and still fail to
 * generate (dead quota, model access, billing) — the production incident
 * proved it. This runs one minimal, cheapest-possible generation through the
 * SAME adapter and model the customers use and stores the verdict separately
 * from the connection test. It costs a fraction of a cent; that is the price
 * of certainty.
 */
export async function testProviderImageAction(providerId: string): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const { data: provider } = await supabase.from("ai_providers").select("slug").eq("id", providerId).maybeSingle();
    const { data: cred } = await supabase
      .from("ai_provider_credentials")
      .select("encrypted_value, iv, auth_tag, base_url")
      .eq("provider_id", providerId).maybeSingle();
    if (!provider || !cred) return { ok: false, error: "no_credential" };
    const adapter = getAdapter(provider.slug);
    if (!adapter) return { ok: false, error: "no_adapter" };
    const { data: model } = await supabase
      .from("ai_models").select("*")
      .eq("provider_id", providerId).eq("active", true)
      .order("sort_order", { ascending: true }).limit(1).maybeSingle();
    if (!model) return { ok: false, error: "no_model" };

    let apiKey: string;
    try { apiKey = decryptSecret(cred.encrypted_value, cred.iv, cred.auth_tag); }
    catch { return { ok: false, error: "decrypt_failed" }; }

    let status = "image_ok";
    let message: string | null = null;
    try {
      const result = await adapter.generate(model, {
        prompt: "A plain matte gray cube on a clean white studio background",
        aspectRatio: "1:1", resolution: "1K", quantity: 1, referenceImages: [],
        productLock: { fidelityInstructions: "" },
      }, { apiKey, baseUrl: cred.base_url });
      if (!result.images.length) { status = "image_failed"; message = "empty_result"; }
    } catch (e) {
      status = "image_failed";
      message = e instanceof ProviderError
        ? [e.safeMessage, e.providerCode, e.upstream?.status ? `http=${e.upstream.status}` : null].filter(Boolean).join(" · ")
        : "unknown_error";
    }

    await supabase.from("ai_provider_credentials").update({
      last_image_test_at: new Date().toISOString(),
      last_image_test_status: status,
      last_image_test_error_safe: message,
    }).eq("provider_id", providerId);
    // A positive proof of real generation clears any stored cooldown; a
    // failed one records the honest state so the router routes around it.
    if (status === "image_ok") {
      await supabase.rpc("set_provider_health", { p_slug: provider.slug, p_state: "healthy", p_cooldown_seconds: 0 });
    }
    revalidatePath("/admin/providers");
    return { ok: status === "image_ok", status, message: message ?? undefined };
  } catch {
    return { ok: false, error: "generic" };
  }
}

/** Decrypts server-side only, probes the provider, stores a safe test result. */
export async function testProviderConnectionAction(providerId: string): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const { data: provider } = await supabase.from("ai_providers").select("slug").eq("id", providerId).maybeSingle();
    const { data: cred } = await supabase
      .from("ai_provider_credentials")
      .select("encrypted_value, iv, auth_tag, base_url")
      .eq("provider_id", providerId)
      .maybeSingle();
    if (!provider || !cred) return { ok: false, error: "no_credential" };
    let apiKey: string;
    try {
      apiKey = decryptSecret(cred.encrypted_value, cred.iv, cred.auth_tag);
    } catch {
      return { ok: false, error: "decrypt_failed" };
    }
    const result = await testProviderConnection(provider.slug, apiKey, cred.base_url);
    await supabase.from("ai_provider_credentials").update({
      last_tested_at: new Date().toISOString(),
      last_test_status: result.status,
      last_test_error_safe: result.status === "connected" ? null : result.message,
    }).eq("provider_id", providerId);
    // A passing test lifts any stored cooldown so the router tries the
    // provider again immediately instead of waiting it out.
    if (result.status === "connected") {
      await supabase.rpc("set_provider_health", { p_slug: provider.slug, p_state: "healthy", p_cooldown_seconds: 0 });
    }
    revalidatePath("/admin/providers");
    return { ok: true, status: result.status, message: result.message };
  } catch {
    return { ok: false, error: "generic" };
  }
}
