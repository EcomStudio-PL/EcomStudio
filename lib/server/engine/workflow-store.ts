import "server-only";
import type { Json } from "@/lib/database.types";
import type { Client } from "@/lib/services/workspace";
import { dispatchToken } from "@/lib/server/integrations";
import { promptKeyring } from "@/lib/server/prompt-vault";
import {
  STEP_TIMEOUT_DEFAULT_MS, TOOL_STEP_SLUGS, fromV1,
  type OutputKind, type StepOperation, type ToolStepSlug, type WorkflowStepDef,
} from "@/lib/ai/workflow-def";

/**
 * WORKFLOW PERSISTENCE — the only door between the runtime and the database.
 *
 * Every call is a token-gated SECURITY DEFINER function (migration 0129):
 * runs, step runs and step outputs are admin-read under RLS, and the runtime
 * works inside the CUSTOMER's session (the ledger needs it), so it can only
 * reach them through the server token — which a browser can never produce.
 *
 * Decrypted step prompts exist in server memory only: never logged, never
 * written to a run, never returned to a client.
 */

export type LoadedWorkflow = {
  id: string;
  version: number;
  status: string;
  maxOutputs: number;
  concurrency: number;
  /** v1 rows run through the same runtime, with their v1 variable names. */
  legacy: boolean;
  steps: WorkflowStepDef[];
};

type ReadRow = {
  workflow_id: string; version: number; status: string; max_outputs: number | null; concurrency: number;
  position: number; name: string; enabled: boolean; operation: string; output_kind: string; use_images: boolean;
  model_id: string | null; fallback_model_id: string | null; text_provider: string | null; text_model: string | null;
  timeout_ms: number; max_attempts: number; condition: string; output_name: string | null; input_image: string | null;
  for_each: string | null; item_name: string | null; max_items: number | null; tool_slug: string | null;
  on_error: string; on_item_error: string; prompt_encrypted: string; prompt_iv: string; prompt_tag: string;
};

const cond = (c: string): WorkflowStepDef["condition"] =>
  c === "if_hint" || c === "if_previous_nonempty" ? c : "always";
const provider = (p: string | null) => (p === "openai" || p === "google" ? p : null);

/**
 * Load ONE version: the tool's published one (`workflowId` null) or a pinned
 * one. Null — never a partial definition — when there is none, the token is
 * missing or any step cannot be opened.
 */
export async function loadWorkflow(supabase: Client, toolKey: string, workflowId: string | null): Promise<LoadedWorkflow | null> {
  const token = dispatchToken();
  if (!token) return null;
  try {
    const { data, error } = await supabase.rpc("ai_tool_workflow_read", {
      p_token: token, p_tool_key: toolKey, p_workflow_id: workflowId,
    });
    const rows = (data ?? []) as ReadRow[];
    if (error || rows.length === 0) return null;
    rows.sort((a, b) => a.position - b.position);
    // Step prompts open with the Vault-held prompt key (legacy env-key rows
    // too, while that key exists) — fetched once for the whole version.
    const ring = await promptKeyring(supabase);
    const open = (r: ReadRow): string | null =>
      ring.open({ ciphertext: r.prompt_encrypted, iv: r.prompt_iv, authTag: r.prompt_tag })?.text ?? null;
    const legacy = rows.some((r) => r.operation === "analyze" || r.operation === "generate_image");
    let steps: WorkflowStepDef[];
    if (legacy) {
      const opened = rows.map((r) => ({ r, prompt: open(r) }));
      if (opened.some((o) => o.prompt === null)) return null;
      steps = fromV1(opened.map(({ r, prompt }) => ({
        operation: r.operation, outputKind: r.output_kind, name: r.name, enabled: r.enabled,
        useImages: r.use_images, modelId: r.model_id, textProvider: provider(r.text_provider),
        timeoutMs: r.timeout_ms, maxAttempts: r.max_attempts, condition: cond(r.condition), prompt: prompt ?? "",
      })));
    } else {
      steps = [];
      for (const r of rows) {
        const prompt = open(r);
        if (prompt === null) return null;
        steps.push({
          name: r.name, enabled: r.enabled,
          operation: r.operation as StepOperation,
          outputKind: (r.output_kind === "analysis" ? "text" : r.output_kind) as OutputKind,
          outputName: r.output_name ?? `step${r.position}`,
          inputImage: r.input_image ?? "customer",
          forEach: r.for_each, itemName: r.item_name, maxItems: r.max_items,
          modelId: r.model_id, fallbackModelId: r.fallback_model_id,
          textProvider: provider(r.text_provider), textModel: r.text_model,
          toolSlug: (TOOL_STEP_SLUGS as readonly string[]).includes(r.tool_slug ?? "") ? r.tool_slug as ToolStepSlug : null,
          timeoutMs: r.timeout_ms || STEP_TIMEOUT_DEFAULT_MS, maxAttempts: r.max_attempts,
          onError: r.on_error === "continue" ? "continue" : "stop",
          onItemError: r.on_item_error === "fail_run" ? "fail_run" : "continue",
          condition: cond(r.condition), prompt,
        });
      }
    }
    return {
      id: rows[0].workflow_id, version: rows[0].version, status: rows[0].status,
      maxOutputs: rows[0].max_outputs ?? 1, concurrency: rows[0].concurrency || 3,
      legacy, steps,
    };
  } catch {
    return null;
  }
}

/* ── runs ─────────────────────────────────────────────────────────────────*/

export type RunRow = {
  id: string; tool_key: string; workspace_id: string | null; user_id: string | null; job_id: string | null;
  status: string; run_kind: string; usage_event_id: string | null; workflow_id: string | null;
  workflow_version: number | null; input: Json; outputs: Json; progress: Json; expected_outputs: number | null;
  credits: number | null; error: string | null; created_at: string; finished_at: string | null;
  knowledge_example_ids: string[];
};

export async function createRun(supabase: Client, run: Record<string, Json | undefined>): Promise<{ id: string; created: boolean; status: string } | null> {
  const { data, error } = await supabase.rpc("ai_engine_run_create", { p_token: dispatchToken(), p_run: run as Json });
  const out = data as { id?: string; created?: boolean; status?: string } | null;
  if (error || !out?.id) return null;
  return { id: out.id, created: Boolean(out.created), status: out.status ?? "queued" };
}

export async function claimRun(supabase: Client, runId: string, owner: string, leaseSeconds: number):
  Promise<{ claimed: boolean; reason?: string; status?: string }> {
  const { data, error } = await supabase.rpc("ai_engine_run_claim", {
    p_token: dispatchToken(), p_run_id: runId, p_owner: owner, p_lease_seconds: leaseSeconds,
  });
  if (error || !data) return { claimed: false, reason: "error" };
  return data as { claimed: boolean; reason?: string; status?: string };
}

export async function patchRun(supabase: Client, runId: string, owner: string, patch: Record<string, Json | undefined>): Promise<boolean> {
  const { data, error } = await supabase.rpc("ai_engine_run_patch", {
    p_token: dispatchToken(), p_run_id: runId, p_owner: owner, p_patch: patch as Json,
  });
  return !error && data === true;
}

export async function readRun(supabase: Client, runId: string): Promise<RunRow | null> {
  const { data, error } = await supabase.rpc("ai_engine_run_read", { p_token: dispatchToken(), p_run_id: runId });
  if (error || !data?.length) return null;
  return data[0] as unknown as RunRow;
}

export type StepRunRow = {
  position: number; item_index: number; status: string; attempts: number; provider_slug: string | null;
  model: string | null; input_tokens: number | null; output_tokens: number | null; units: number | null;
  unit_kind: string | null; cost_usd_micros: number | null; cost_basis: string; error_code: string | null;
  output: Json | null; duration_ms: number | null; step_name: string | null; operation: string;
};

export async function readStepRuns(supabase: Client, runId: string): Promise<StepRunRow[]> {
  const { data, error } = await supabase.rpc("ai_engine_step_runs_read", { p_token: dispatchToken(), p_run_id: runId });
  if (error || !data) return [];
  return data as unknown as StepRunRow[];
}

export type StepBegin =
  | { state: "run"; attempts: number }
  | { state: "done"; output: Json | null; provider: string | null; model: string | null }
  | { state: "busy" | "not_owner" }
  | { state: "failed" | "skipped"; error: string | null };

export async function beginStep(supabase: Client, runId: string, owner: string, position: number, item: number,
  name: string, operation: string, leaseSeconds: number): Promise<StepBegin> {
  const { data, error } = await supabase.rpc("ai_engine_step_begin", {
    p_token: dispatchToken(), p_run_id: runId, p_owner: owner, p_position: position, p_item: item,
    p_name: name.slice(0, 80), p_operation: operation, p_lease_seconds: leaseSeconds,
  });
  if (error || !data) return { state: "busy" };
  return data as unknown as StepBegin;
}

export type StepResult = {
  status: "succeeded" | "failed" | "skipped";
  attempts: number;
  providerSlug?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  units?: number | null;
  unitKind?: "image" | "second" | "request" | "page" | null;
  cost: { basis: "actual" | "estimated"; usdMicros: number } | { basis: "unknown" };
  errorCode?: string | null;
  output?: Json | null;
  durationMs: number;
};

export async function finishStep(supabase: Client, runId: string, owner: string, position: number, item: number, r: StepResult): Promise<boolean> {
  const { data, error } = await supabase.rpc("ai_engine_step_finish", {
    p_token: dispatchToken(), p_run_id: runId, p_owner: owner, p_position: position, p_item: item,
    p_result: {
      status: r.status, attempts: r.attempts,
      provider_slug: r.providerSlug ?? null, model: r.model ?? null,
      input_tokens: r.inputTokens ?? null, output_tokens: r.outputTokens ?? null,
      units: r.units ?? null, unit_kind: r.units == null ? null : (r.unitKind ?? null),
      cost_basis: r.cost.basis, cost_usd_micros: r.cost.basis === "unknown" ? null : r.cost.usdMicros,
      error_code: r.errorCode ?? null, output: r.output ?? null, duration_ms: Math.max(0, Math.round(r.durationMs)),
    } as Json,
  });
  return !error && data === true;
}
