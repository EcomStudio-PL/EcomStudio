import "server-only";
import type { Client } from "@/lib/services/workspace";
import { dispatchToken } from "@/lib/server/integrations";
import { promptKeyring, type PromptKeyring, type Sealed } from "@/lib/server/prompt-vault";
import type { EngineMode } from "@/lib/services/ai-tools";

/**
 * THE ENGINE, AT RUNTIME.
 *
 * A tool's hidden prompt is GrovBase IP, so it is stored encrypted — under the
 * Vault-held prompt key (lib/server/prompt-vault.ts, migration 0130) — and read
 * through a token-guarded SECURITY DEFINER function — the same pattern the
 * notification dispatch already uses. A customer's session, holding the anon
 * key every browser has, cannot call it: the database compares sha256(token)
 * against a hash only the server can reproduce.
 *
 * `import "server-only"` is the second lock. This module cannot be imported
 * from a client component at all, so a decrypted prompt has no path into a
 * bundle, a props payload or a devtools panel.
 *
 * NOTHING BREAKS WHEN A TOOL HAS NO PUBLISHED PROMPT. `resolveEngine` returns
 * null and the caller keeps whatever it does today. Publishing a version in
 * the admin panel is what makes the database win — doing nothing changes
 * nothing, which is the only safe way to migrate a working generator.
 */

export type EngineConfig = {
  toolKey: string;
  mode: EngineMode;
  serviceSlug: string | null;
  allowModelChoice: boolean;
  fallbackEnabled: boolean;
  timeoutMs: number;
  maxAttempts: number;
  primaryModelId: string | null;
  fallbackModelId: string | null;
  /** The decrypted system prompt, or null when the tool has none published. */
  systemPrompt: string | null;
  promptVersion: number | null;
  /** How knowledge retrieval balances proven examples against variety. */
  knowledgeStrategy: "proven" | "diverse";
  /** Workflow ON: the published workflow runs instead of the single call.
   *  OFF: the tool behaves exactly as it does without workflows. */
  workflowEnabled: boolean;
};

/**
 * Read one tool's live configuration.
 *
 * Returns null — never throws — when the token is unavailable, the row does
 * not exist, or the ciphertext cannot be opened. Every caller treats that as
 * "no override" rather than as an error, because an engine-configuration
 * outage must not take image generation down with it.
 */
export async function resolveEngine(supabase: Client, toolKey: string): Promise<EngineConfig | null> {
  const token = dispatchToken();
  if (!token) return null;
  try {
    const { data, error } = await supabase.rpc("ai_tool_runtime", {
      p_tool_key: toolKey,
      p_token: token,
    });
    const row = data?.[0];
    if (error || !row) return null;

    let systemPrompt: string | null = null;
    if (row.prompt_encrypted && row.prompt_iv && row.prompt_tag) {
      // The keyring never throws: a key that cannot be fetched, like a body
      // that cannot be opened, leaves the prompt absent while the rest of the
      // configuration (models, mode, workflow switch) still applies. Running
      // the tool on its built-in behaviour beats failing the customer's request.
      const ring = await promptKeyring(supabase);
      systemPrompt = ring.open({ ciphertext: row.prompt_encrypted, iv: row.prompt_iv, authTag: row.prompt_tag })?.text ?? null;
    }

    return {
      toolKey: row.tool_key,
      mode: row.engine_mode as EngineMode,
      serviceSlug: row.service_slug,
      allowModelChoice: row.allow_model_choice,
      fallbackEnabled: row.fallback_enabled,
      timeoutMs: row.timeout_ms,
      maxAttempts: row.max_attempts,
      primaryModelId: row.primary_model_id,
      fallbackModelId: row.fallback_model_id,
      systemPrompt,
      promptVersion: row.prompt_version,
      knowledgeStrategy: row.knowledge_strategy === "diverse" ? "diverse" : "proven",
      workflowEnabled: row.workflow_enabled === true,
    };
  } catch {
    return null;
  }
}

/**
 * The admin's "Próby na modelu głównym" for a tool — how many paid requests
 * one image may cost on each model. Read WITHOUT opening the tool's prompt
 * (the attempt count is all these callers need). Undefined when the
 * configuration cannot be read; the runner then keeps its own default.
 */
export async function toolMaxAttempts(supabase: Client, toolKey: string): Promise<number | undefined> {
  const token = dispatchToken();
  if (!token) return undefined;
  try {
    const { data, error } = await supabase.rpc("ai_tool_runtime", { p_tool_key: toolKey, p_token: token });
    const n = data?.[0]?.max_attempts;
    return !error && typeof n === "number" && Number.isFinite(n) && n >= 1 ? Math.trunc(n) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The system prompt a tool should run with, or null to keep the built-in one.
 *
 * Modes decide whether a hidden prompt applies at all: 'user' means the
 * customer's words are the whole instruction, and 'off' means there is no
 * engine — in both cases a stored body is ignored rather than quietly
 * injected into a tool the operator marked as prompt-free.
 */
export async function resolveSystemPrompt(supabase: Client, toolKey: string): Promise<string | null> {
  const engine = await resolveEngine(supabase, toolKey);
  if (!engine) return null;
  if (engine.mode === "off" || engine.mode === "user") return null;
  return engine.systemPrompt;
}

/** Seal a prompt body for storage, under the Vault prompt key. Admin write
 *  paths only; throws PromptKeyError when the key cannot be obtained. */
export function sealPrompt(ring: PromptKeyring, body: string): Sealed {
  return ring.seal(body);
}

/** Open a stored body for the admin editor. Admin-authorised callers only.
 *  Null when no available key opens it (a legacy row whose key is gone). */
export function openPrompt(
  ring: PromptKeyring,
  row: { body_encrypted: string; body_iv: string; body_tag: string },
): { text: string; source: "vault" | "legacy" } | null {
  return ring.open({ ciphertext: row.body_encrypted, iv: row.body_iv, authTag: row.body_tag });
}
