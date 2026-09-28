import "server-only";
import { createHash } from "node:crypto";
import type { Client } from "@/lib/services/workspace";
import { resolveEngine } from "@/lib/server/ai-engine";
import { TOOL_VARIABLES, parsePlaceholders, sampleValues } from "@/lib/ai/prompt-variables";
import { compileForTool } from "@/lib/server/engine/runtime";
import {
  LOW_SOURCE_MEGAPIXELS, describeProviderRequest, effectiveCallTimeout, promptLength, type LastRun, type RequestManifest,
} from "@/lib/ai/request-manifest";
import type { Resolution } from "@/lib/ai/types";
import { GENERATION_BUDGET_MS, MAX_ATTEMPTS_PER_PROVIDER } from "@/lib/server/provider-router";
import { RETOUCH_OPERATION } from "@/lib/server/retouch";
import { FASHION_TOOLS } from "@/lib/fashion-tools";
import { promptDigest } from "@/lib/server/prompt-digest";

/**
 * WHAT A REAL RUN OF THIS TOOL WOULD SEND — computed, not described.
 *
 * The admin's "Testuj konfigurację" shows it without calling any provider:
 * the model row the run resolves, the prompt the run would compile (length
 * and SHA-256 — the text itself stays in the compile preview), whether
 * anything is added around it, and the request settings the shared Gemini
 * builder produces for this model. Next to it: what the LAST real run of the
 * tool actually recorded (generation_jobs.settings.provider_request), so
 * "the panel says X" can be checked against "the provider was sent X".
 *
 * Admin-only by its caller. Holds no secret: no key, no prompt text, no
 * image bytes.
 */

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

type ModelRow = {
  id: string; name: string | null; display_name: string | null; model_identifier: string;
  supported_resolutions: string[] | null; supported_aspect_ratios: string[] | null;
  ai_providers: { slug: string } | { slug: string }[] | null;
};

function operationOf(toolKey: string): { op: string; hint: boolean; snaps: boolean } | null {
  if (toolKey === "retouch") return { op: RETOUCH_OPERATION, hint: false, snaps: false };
  const f = FASHION_TOOLS.find((x) => x.toolKey === toolKey);
  return f ? { op: f.operation, hint: f.showHint, snaps: true } : null;
}

export async function buildRequestManifest(
  supabase: Client, toolKey: string, tool: { modelId: string; fallbackId: string | null },
): Promise<RequestManifest> {
  const engine = await resolveEngine(supabase, toolKey);
  const meta = operationOf(toolKey);

  const ids = [tool.modelId, ...(tool.fallbackId ? [tool.fallbackId] : [])];
  const { data: rows } = await supabase.from("ai_models")
    .select("id, name, display_name, model_identifier, supported_resolutions, supported_aspect_ratios, ai_providers(slug)")
    .in("id", ids);
  const byId = new Map(((rows ?? []) as ModelRow[]).map((r) => [r.id, r]));
  const slugOf = (r: ModelRow) => (Array.isArray(r.ai_providers) ? r.ai_providers[0]?.slug : r.ai_providers?.slug) ?? "?";
  const nameOf = (r: ModelRow) => r.display_name || r.name || r.model_identifier;
  const primary = byId.get(tool.modelId) ?? null;
  const fb = tool.fallbackId ? byId.get(tool.fallbackId) ?? null : null;

  /* prompt — exactly the branch runEngineImageTool takes */
  const engineMode = engine?.mode === "grovbase" || engine?.mode === "hybrid";
  const published = engineMode && engine?.systemPrompt?.trim() ? engine.systemPrompt : null;
  const defs = TOOL_VARIABLES[toolKey] ?? [];
  let prompt: RequestManifest["prompt"];
  if (published) {
    const variables = [...new Set(parsePlaceholders(published).map((p) => p.name))];
    const compiled = compileForTool(published, defs, sampleValues(defs));
    const text = compiled.ok ? compiled.text : null;
    prompt = {
      source: "published", version: engine?.promptVersion ?? null, mode: engine?.mode ?? "?", policy: "exact",
      chars: text === null ? null : promptLength(text),
      sha256: text === null ? null : sha(text),
      identical: variables.length === 0 ? text === published : null,
      variables,
      knowledge: variables.filter((v) => defs.find((d) => d.key === v)?.source === "knowledge"),
      appended: [],
      strict: variables.length === 0,
      resolved: compiled.ok ? compiled.used : [],
    };
  } else {
    const unreadable = engineMode && engine?.promptVersion != null;
    prompt = {
      source: unreadable ? "unavailable" : "none",
      version: engine?.promptVersion ?? null, mode: engine?.mode ?? "?",
      policy: null, chars: null, sha256: null, identical: null, variables: [], knowledge: [],
      appended: [], strict: true, resolved: [],
    };
  }

  /* request settings — from the same builder the adapter sends */
  const probe = (resolution: Resolution | undefined) => primary
    ? describeProviderRequest(slugOf(primary), { supported_resolutions: primary.supported_resolutions ?? [] }, {
        prompt: "", aspectRatio: "auto", resolution,
        referenceImages: [{ base64: "", mime: "image/png" }],
      })
    : null;
  const resolutions = primary?.supported_resolutions?.length ? primary.supported_resolutions : ["1K"];
  const config: RequestManifest["config"] = {
    operation: probe(undefined)?.operation ?? "IMAGE_EDIT",
    ratioWhenOriginal: meta?.snaps ? "nearest_supported" : primary && slugOf(primary) === "google" ? "input_photo" : "provider_choice",
    // Retusz sends neither a ratio nor a size (Interactions body, no
    // generation_config): none is offered and none is sent.
    ratios: toolKey === "retouch" ? [] : primary?.supported_aspect_ratios ?? [],
    sizes: resolutions.map((r) => ({ resolution: r, sent: toolKey === "retouch" ? null : probe(r as Resolution)?.imageSize ?? null })),
    timeoutMs: effectiveCallTimeout(engine?.timeoutMs) ?? null,
    maxAttempts: Math.min(Math.max(engine?.maxAttempts ?? MAX_ATTEMPTS_PER_PROVIDER, 1), MAX_ATTEMPTS_PER_PROVIDER),
    budgetMs: GENERATION_BUDGET_MS,
  };

  return {
    workflowEnabled: engine?.workflowEnabled === true,
    model: primary ? { provider: slugOf(primary), name: nameOf(primary), identifier: primary.model_identifier } : null,
    fallback: fb ? nameOf(fb) : null,
    prompt,
    config,
    lastRun: meta ? await lastRunOf(supabase, meta.op, published && prompt.identical ? promptDigest(published) : null) : null,
  };
}

async function lastRunOf(supabase: Client, operation: string, publishedDigest: string | null): Promise<LastRun | null> {
  const { data: job } = await supabase.from("generation_jobs")
    .select("id, created_at, status, settings")
    .eq("settings->>operation", operation)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!job) return null;
  const settings = (job.settings ?? {}) as Record<string, unknown>;
  const r = (settings.provider_request ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const b = (v: unknown) => (typeof v === "boolean" ? v : null);
  const recorded = str(r.prompt_digest);
  const inputs = Array.isArray(r.inputs) ? r.inputs : [];
  // Admin-only engine-run row of this job (RLS: admins read ai_engine_runs).
  const { data: run } = r.sanitized_payload === undefined ? { data: null } : await supabase.from("ai_engine_runs")
    .select("network_boundary").eq("job_id", job.id).limit(1).maybeSingle();
  return {
    at: job.created_at, status: job.status,
    provider: str(r.provider), identifier: str(r.model_identifier), fallbackUsed: b(r.fallback_used),
    operation: str(r.operation), policy: str(r.prompt_policy), appended: b(r.fidelity_appended),
    chars: n(r.prompt_chars),
    digest: recorded,
    stateless: r.sanitized_payload === undefined ? null : {
      partsOrder: str(r.parts_order), historyCount: n(r.history_count), imageCount: n(r.image_count), textPartCount: n(r.text_part_count),
      knowledgeCount: n(r.knowledge_count), examplesCount: n(r.examples_count), feedbackCount: n(r.feedback_count),
      systemInstruction: b(r.system_instruction), stateless: b(r.stateless), contractOk: b(r.contract_ok), contractViolation: str(r.contract_violation),
      promptVersion: n(r.prompt_version),
      promptChainEqual: typeof r.resolved_prompt_digest === "string" ? r.resolved_prompt_digest === r.provider_prompt_digest : null,
      variables: Array.isArray(r.prompt_variables) ? r.prompt_variables.filter((v): v is string => typeof v === "string") : [],
      payload: r.sanitized_payload,
      boundary: (run as { network_boundary?: unknown } | null)?.network_boundary ?? null,
    },
    matchesPublished: recorded && publishedDigest ? recorded === publishedDigest : null,
    ratioRequested: str(r.aspect_ratio_requested), ratioSent: str(r.aspect_ratio_sent),
    sizeSent: str(r.image_size_sent), timeoutMs: n(r.call_timeout_ms), maxAttempts: n(r.max_attempts),
    aspectMode: str(r.aspect_ratio_mode), sourceAspect: n(r.source_aspect_ratio), resolvedAspect: str(r.resolved_aspect_ratio),
    failedAttempts: Array.isArray(settings.attempts) ? settings.attempts.length : 0,
    outputs: (Array.isArray(settings.provider_output) ? settings.provider_output : []).map((o) => {
      const x = (o ?? {}) as Record<string, unknown>;
      return {
        requestedSize: str(x.requested_image_size), providerWidth: n(x.provider_returned_width), providerHeight: n(x.provider_returned_height),
        providerMime: str(x.provider_mime), providerBytes: n(x.provider_bytes),
        storedWidth: n(x.stored_width), storedHeight: n(x.stored_height), storedBytes: n(x.stored_bytes), transformed: b(x.transformed_after_provider),
        providerSha256: str(x.provider_sha256), storedSha256: str(x.stored_sha256), storedEqual: b(x.stored_equals_provider),
        imageParts: n(x.provider_image_parts), thoughtSkipped: n(x.provider_thought_images_skipped), finishReason: str(x.provider_finish_reason),
      };
    }),
    inputs: inputs.map((i) => {
      const x = (i ?? {}) as Record<string, unknown>;
      const w = n(x.width), h = n(x.height);
      const megapixels = w && h ? Math.round((w * h) / 10_000) / 100 : null;
      return {
        mime: str(x.mime) ?? "?", bytes: n(x.bytes) ?? 0, width: w, height: h,
        sourceSha256: str(x.source_sha256) ?? "", sentSha256: str(x.sent_sha256) ?? "", transform: str(x.transform) ?? "?",
        megapixels, lowResolution: megapixels !== null && megapixels < LOW_SOURCE_MEGAPIXELS,
      };
    }),
  };
}
