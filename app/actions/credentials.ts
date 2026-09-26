"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  providerSecretName, readProviderKey, vaultPlaceholderColumns, writeProviderKey,
  type LegacyCredential,
} from "@/lib/server/provider-credentials";
import { clearSecret } from "@/lib/server/secret-store";
import { testProviderConnection, type TestStatus } from "@/lib/server/provider-test";
import { dispatchToken, ensureDispatchHash } from "@/lib/server/integrations";
import { recordProviderCalls } from "@/lib/server/ai-usage";
import { imageCost } from "@/lib/ai/usage-cost";
import { getAdapter } from "@/lib/ai/registry";
import { ProviderError } from "@/lib/ai/types";

/**
 * `status` is a verdict code and `detail` a short code (http_401, sandbox…);
 * the panel translates both. No provider message and no key ever travels in
 * this result.
 */
type Result = { ok: boolean; error?: string; status?: string; detail?: string | null; latencyMs?: number | null };

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
      last_test_latency_ms: null,
      // A new key has proven nothing yet: the verdicts of the key it replaces
      // must not keep reading "generates" / "last error" against it.
      last_image_test_at: null,
      last_image_test_status: null,
      last_image_test_error_safe: null,
      last_success_at: null,
      last_error_at: null,
      last_error_code: null,
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

    // THE RUNTIME READS THIS KEY WITH THE SERVER TOKEN (provider_credential_read
    // → server_call_ok). That token is only accepted once its hash has been
    // published, and until now only the mail/telegram/captcha saves published
    // it — so a fresh install could save a key, pass the admin-side test, and
    // still have every customer generation refused. Publishing it here makes
    // "saved" mean "usable".
    await ensureDispatchHash(supabase);

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
    // The secret itself first: deleting only the metadata row used to leave
    // the key sitting in the vault, where readProviderKey would still find it.
    const cleared = await clearSecret(supabase, providerSecretName(providerId));
    const { error } = await supabase.from("ai_provider_credentials").delete().eq("provider_id", providerId);
    if (error) return { ok: false, error: "generic" };
    if (!cleared) {
      // The row is gone, so the panel shows "not configured"; the vault copy
      // (if one existed) could not be removed and is reported, not hidden.
      console.error("credentials.delete", "vault_clear_failed");
    }
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
 * The key exactly as a CUSTOMER RUN would get it.
 *
 * Generation, vision and GrovNews read a provider key through
 * provider_credential_read with the server token, then open the vault (or the
 * legacy ciphertext). The panel used to test with the admin's own session,
 * which can read a vault secret without any token and never touched the
 * runtime door — so a key could pass the test while every customer call
 * failed. Both tests now go through the same door, step by step, and stop at
 * the first step that fails with a code that names it.
 *
 * An INACTIVE provider is still testable (activate after a green test is the
 * documented flow): the runtime door only serves active providers, so for an
 * inactive one the metadata row is read with the admin session instead, and
 * everything after that is identical.
 */
async function runtimeKey(
  supabase: Awaited<ReturnType<typeof createClient>>, providerId: string,
): Promise<{ ok: true; apiKey: string; baseUrl: string | null; slug: string } | { ok: false; status: TestStatus }> {
  const { data: provider } = await supabase.from("ai_providers").select("slug, active").eq("id", providerId).maybeSingle();
  if (!provider) return { ok: false, status: "no_credential" };
  const token = dispatchToken();
  if (!token) return { ok: false, status: "server_unconfigured" };

  let cred: (LegacyCredential & { base_url: string | null }) | null = null;
  if (provider.active) {
    const read = () => supabase.rpc("provider_credential_read", { p_token: token, p_provider_id: providerId });
    let { data, error } = await read();
    if (error) {
      // The hash may simply never have been published on this install.
      await ensureDispatchHash(supabase);
      ({ data, error } = await read());
    }
    if (error) return { ok: false, status: "server_unconfigured" };
    cred = data?.[0] ?? null;
  } else {
    const { data } = await supabase.from("ai_provider_credentials")
      .select("encrypted_value, iv, auth_tag, base_url").eq("provider_id", providerId).maybeSingle();
    cred = data ?? null;
  }
  if (!cred) return { ok: false, status: "no_credential" };
  const apiKey = await readProviderKey(supabase, providerId, cred);
  // A row exists but no key can be opened from it: typically a key saved
  // before the vault, whose decryption key is not on this server. Saving the
  // key again moves it into the vault.
  if (!apiKey) return { ok: false, status: "key_unreadable" };
  return { ok: true, apiKey, baseUrl: cred.base_url, slug: provider.slug };
}

/**
 * REAL image-generation test. A key can list models and still fail to
 * generate (dead quota, model access, billing). This runs one minimal
 * generation through the SAME adapter and model the customers use and stores
 * the verdict separately from the connection test. It costs a fraction of a
 * cent — which is recorded in the provider trace as an admin call, so the
 * spend is visible and never mistaken for customer revenue.
 */
export async function testProviderImageAction(providerId: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const key = await runtimeKey(supabase, providerId);
    if (!key.ok) return { ok: false, error: key.status, status: key.status };
    const adapter = getAdapter(key.slug);
    if (!adapter) return { ok: false, error: "no_adapter" };
    const { data: model } = await supabase
      .from("ai_models").select("*")
      .eq("provider_id", providerId).eq("active", true).eq("type", "image")
      .order("sort_order", { ascending: true }).limit(1).maybeSingle();
    if (!model) return { ok: false, error: "no_model" };

    let status = "image_ok";
    let detail: string | null = null;
    let images = 0;
    const started = Date.now();
    try {
      const result = await adapter.generate(model, {
        prompt: "A plain matte gray cube on a clean white studio background",
        aspectRatio: "1:1", resolution: "1K", quantity: 1, referenceImages: [],
        productLock: { fidelityInstructions: "" },
      }, { apiKey: key.apiKey, baseUrl: key.baseUrl });
      images = result.images.length;
      if (!images) { status = "image_failed"; detail = "empty_result"; }
    } catch (e) {
      status = "image_failed";
      images = e instanceof ProviderError ? e.partial?.length ?? 0 : 0;
      detail = e instanceof ProviderError
        ? [e.safeMessage, e.upstream?.status ? `http_${e.upstream.status}` : null].filter(Boolean).join(" · ")
        : "unknown_error";
    }
    await recordProviderCalls(supabase, [{
      actorKind: "admin", consumer: "provider_test", userId: adminId,
      providerSlug: key.slug, model: model.model_identifier,
      status: status === "image_ok" ? "succeeded" : "failed",
      errorCode: status === "image_ok" ? null : "image_test_failed",
      units: images, unitKind: "image",
      cost: imageCost(model.internal_cost_usd_micros, images),
      durationMs: Date.now() - started,
    }]);

    await supabase.from("ai_provider_credentials").update({
      last_image_test_at: new Date().toISOString(),
      last_image_test_status: status,
      last_image_test_error_safe: detail,
    }).eq("provider_id", providerId);
    // A positive proof of real generation clears any stored cooldown.
    if (status === "image_ok") {
      await supabase.rpc("provider_health_set", { p_token: dispatchToken(), p_slug: key.slug, p_state: "healthy", p_cooldown_seconds: 0 });
    }
    revalidatePath("/admin/ai/modele");
    return { ok: status === "image_ok", status, detail };
  } catch {
    return { ok: false, error: "generic" };
  }
}

/**
 * CONNECTION TEST — "connected" means the key was read through the runtime
 * door AND the provider accepted it on its cheapest real endpoint. Nothing is
 * marked connected because a string exists in the database.
 */
export async function testProviderConnectionAction(providerId: string): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const key = await runtimeKey(supabase, providerId);
    const result = key.ok
      ? await testProviderConnection(key.slug, key.apiKey, key.baseUrl)
      : { status: key.status, detail: null, latencyMs: null };
    // A key that cannot be opened is a failed test of THIS key — recorded as
    // such so the card stops showing an old green verdict.
    const { data: exists } = await supabase.from("ai_provider_credentials")
      .select("id").eq("provider_id", providerId).maybeSingle();
    if (exists) {
      await supabase.from("ai_provider_credentials").update({
        last_tested_at: new Date().toISOString(),
        last_test_status: result.status,
        last_test_error_safe: result.status === "connected" ? result.detail : result.detail ?? result.status,
        last_test_latency_ms: result.latencyMs,
      }).eq("provider_id", providerId);
    }
    // A passing test lifts any stored cooldown so the router tries the
    // provider again immediately instead of waiting it out.
    if (key.ok && result.status === "connected") {
      await supabase.rpc("provider_health_set", { p_token: dispatchToken(), p_slug: key.slug, p_state: "healthy", p_cooldown_seconds: 0 });
    }
    revalidatePath("/admin/ai/modele");
    return { ok: result.status === "connected", status: result.status, detail: result.detail, latencyMs: result.latencyMs };
  } catch {
    return { ok: false, error: "generic" };
  }
}
