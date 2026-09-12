"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { readProviderKey, vaultPlaceholderColumns, writeProviderKey } from "@/lib/server/provider-credentials";
import { testProviderConnection } from "@/lib/server/provider-test";
import { dispatchToken } from "@/lib/server/integrations";
import { getAdapter } from "@/lib/ai/registry";
import { ProviderError } from "@/lib/ai/types";

type Result = { ok: boolean; error?: string; status?: string; message?: string };

/**
 * "sandbox" or "live" when the key itself says so, null when the vendor gives
 * no such signal and the question does not apply.
 *
 * Only the shape of the key is inspected — never its value beyond the prefix,
 * and nothing is logged.
 */
function keyEnvironment(apiKey: string): "sandbox" | "live" {
  // Anything without the sandbox prefix is a live key — including every key
  // from a vendor that has no sandbox at all, which is exactly what those keys
  // are. Returning null for "unknown" would have been the subtler bug: an
  // operator swapping a sandbox key for a live one would have left the stored
  // verdict reading "sandbox" for ever, and the panel would have gone on
  // promising free, watermarked runs against a key that bills.
  return apiKey.trim().toLowerCase().startsWith("sandbox_") ? "sandbox" : "live";
}

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}

/**
 * Store a provider credential.
 *
 * The key goes to Supabase Vault and the row keeps only the metadata around it
 * — see lib/server/provider-credentials.ts. It used to be refused outright
 * unless the server held APP_ENCRYPTION_KEY, which is precisely the dependency
 * an operator is no longer expected to maintain: adding a Photoroom or OpenAI
 * key is now a thing you do in this panel and nowhere else.
 *
 * The vault write comes FIRST. If it fails, the metadata row is left alone
 * rather than updated to advertise a key that was never stored.
 */
export async function saveProviderCredentialAction(
  providerId: string, apiKey: string, baseUrl?: string
): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const key = apiKey.trim();
    if (key.length < 8) return { ok: false, error: "invalid" };
    const sealed = await writeProviderKey(supabase, providerId, key);
    if (!sealed.ok) {
      return { ok: false, error: sealed.error === "forbidden" ? "forbidden" : "secret_write_failed" };
    }
    const row = {
      provider_id: providerId,
      credential_name: "api_key",
      ...vaultPlaceholderColumns(),
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

    // WHICH ENVIRONMENT THIS KEY BELONGS TO, recorded at the moment it is
    // known. Some vendors distinguish a test key by a prefix rather than a
    // separate host — Photoroom's sandbox keys start with `sandbox_`, run
    // against the same endpoints, cost nothing and stamp a watermark on every
    // result. The panel has to be able to SAY that, or watermarked output
    // looks like a defect and free calls look like a billing bug.
    //
    // It is derived here, from the plaintext, and only the VERDICT is stored —
    // never the prefix itself, and never anything an operator has to keep in
    // step by hand. A key swap re-derives it.
    const { data: provider } = await supabase
      .from("ai_providers").select("metadata").eq("id", providerId).maybeSingle();
    await supabase.from("ai_providers").update({
      metadata: {
        ...(provider?.metadata as Record<string, unknown> | null ?? {}),
        environment: keyEnvironment(key),
      },
    }).eq("id", providerId);

    await supabase.rpc("log_activity", {
      p_workspace_id: null as unknown as string, p_action: "admin.provider_credential_saved",
      p_entity_type: "ai_provider", p_entity_id: providerId,
    });
    revalidatePath("/admin/ai/modele");
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
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
    revalidatePath("/admin/ai/modele");
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

    const apiKey = await readProviderKey(supabase, providerId, cred);
    if (!apiKey) return { ok: false, error: "no_credential" };

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
      await supabase.rpc("provider_health_set", { p_token: dispatchToken(), p_slug: provider.slug, p_state: "healthy", p_cooldown_seconds: 0 });
    }
    revalidatePath("/admin/ai/modele");
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
    const apiKey = await readProviderKey(supabase, providerId, cred);
    if (!apiKey) return { ok: false, error: "no_credential" };
    const result = await testProviderConnection(provider.slug, apiKey, cred.base_url);
    await supabase.from("ai_provider_credentials").update({
      last_tested_at: new Date().toISOString(),
      last_test_status: result.status,
      last_test_error_safe: result.status === "connected" ? null : result.message,
    }).eq("provider_id", providerId);
    // A passing test lifts any stored cooldown so the router tries the
    // provider again immediately instead of waiting it out.
    if (result.status === "connected") {
      await supabase.rpc("provider_health_set", { p_token: dispatchToken(), p_slug: provider.slug, p_state: "healthy", p_cooldown_seconds: 0 });
    }
    revalidatePath("/admin/ai/modele");
    return { ok: true, status: result.status, message: result.message };
  } catch {
    return { ok: false, error: "generic" };
  }
}
