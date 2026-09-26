import "server-only";
import type { Client } from "@/lib/services/workspace";
import { decryptSecret, encryptSecret, encryptionAvailable } from "@/lib/server/crypto";
import { dispatchToken } from "@/lib/server/integrations";
import type { EngineMode } from "@/lib/services/ai-tools";

/**
 * THE ENGINE, AT RUNTIME.
 *
 * A tool's hidden prompt is GrovBase IP, so it is stored encrypted and read
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
    if (row.prompt_encrypted && row.prompt_iv && row.prompt_tag && encryptionAvailable()) {
      try {
        systemPrompt = decryptSecret(row.prompt_encrypted, row.prompt_iv, row.prompt_tag);
      } catch {
        // A prompt that cannot be opened is treated as absent. Running the
        // tool on its built-in behaviour beats failing the customer's request.
        systemPrompt = null;
      }
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
    };
  } catch {
    return null;
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

/** Seal a prompt body for storage. Used by the admin publish action only. */
export function sealPrompt(body: string): { ciphertext: string; iv: string; authTag: string } {
  return encryptSecret(body);
}

/** Open a stored body for the admin editor. Admin-authorised callers only. */
export function openPrompt(row: { body_encrypted: string; body_iv: string; body_tag: string }): string | null {
  if (!encryptionAvailable()) return null;
  try {
    return decryptSecret(row.body_encrypted, row.body_iv, row.body_tag);
  } catch {
    return null;
  }
}

/* ── workflows ────────────────────────────────────────────────────────────*/

export type WorkflowStep = {
  position: number;
  name: string;
  enabled: boolean;
  operation: "analyze" | "generate_image";
  outputKind: "text" | "analysis" | "image";
  useImages: boolean;
  /** Image-model override; null = the tool's own model. */
  modelId: string | null;
  /** Text-provider override; null = the configured planner order. */
  textProvider: "openai" | "google" | null;
  timeoutMs: number;
  maxAttempts: number;
  condition: "always" | "if_hint" | "if_previous_nonempty";
  /** Decrypted step prompt. Server memory only. */
  prompt: string;
};

export type RuntimeWorkflow = { id: string; version: number; steps: WorkflowStep[] };

/**
 * The PUBLISHED workflow of a tool, read once, decrypted server-side.
 *
 * Returns null — never throws — when there is none, the token is missing or a
 * step cannot be opened. A workflow with an unreadable step is not "mostly
 * there": the caller fails safe before any charge.
 */
export async function loadPublishedWorkflow(supabase: Client, toolKey: string): Promise<RuntimeWorkflow | null> {
  const token = dispatchToken();
  if (!token || !encryptionAvailable()) return null;
  try {
    const { data, error } = await supabase.rpc("ai_tool_workflow_runtime", { p_tool_key: toolKey, p_token: token });
    if (error || !data?.length) return null;
    const steps: WorkflowStep[] = [];
    for (const r of data) {
      let prompt: string;
      try { prompt = decryptSecret(r.prompt_encrypted, r.prompt_iv, r.prompt_tag); }
      catch { return null; }
      steps.push({
        position: r.position,
        name: r.name,
        enabled: r.enabled,
        operation: r.operation === "generate_image" ? "generate_image" : "analyze",
        outputKind: r.output_kind === "image" ? "image" : r.output_kind === "analysis" ? "analysis" : "text",
        useImages: r.use_images,
        modelId: r.model_id,
        textProvider: r.text_provider === "openai" || r.text_provider === "google" ? r.text_provider : null,
        timeoutMs: r.timeout_ms,
        maxAttempts: r.max_attempts,
        condition: r.condition === "if_hint" || r.condition === "if_previous_nonempty" ? r.condition : "always",
        prompt,
      });
    }
    steps.sort((a, b) => a.position - b.position);
    return { id: data[0].workflow_id, version: data[0].version, steps };
  } catch {
    return null;
  }
}
