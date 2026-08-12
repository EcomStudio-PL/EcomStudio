"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { encryptSecret, decryptSecret, encryptionAvailable } from "@/lib/server/crypto";
import { testProviderConnection } from "@/lib/server/provider-test";

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
    const { error } = await supabase
      .from("ai_provider_credentials")
      .upsert(row, { onConflict: "provider_id" });
    if (error) return { ok: false, error: "generic" };
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
    revalidatePath("/admin/providers");
    return { ok: true, status: result.status, message: result.message };
  } catch {
    return { ok: false, error: "generic" };
  }
}
