import "server-only";
import type { Client } from "@/lib/services/workspace";
import { logAudit } from "@/lib/services/audit";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { openPrompt, sealPrompt } from "@/lib/server/ai-engine";
import { adminPromptKeyring } from "@/lib/server/prompt-vault-admin";
import { malformedPlaceholders } from "@/lib/ai/prompt-variables";
import { findTokenPrice } from "@/lib/ai/usage-cost";
import { GROVSHOT_V2_KEYS, type GrovshotStageKey } from "@/lib/grovshot-v2/stages";
import { grovshotTemplateProblems } from "@/lib/grovshot-v2/gate";
import { STAGE_ROLES, parseEngineConfig, type EngineConfig, type StageModel, type StageRole } from "@/lib/grovshot-v2/config";
import { specDraft } from "@/lib/server/grovshot-v2/seed";
import { roleBackends } from "@/lib/server/grovshot-v2/backends";
import { readKnowledgeSnapshot } from "@/lib/server/grovshot-v2/knowledge";
import { imageUnitPrice, readEngineState, type EngineState } from "@/lib/server/grovshot-v2/settings";
import { ROLE_CALL_TOKENS, imageTokenCost } from "@/lib/server/grovshot-v2/rollout";
import { startAdminTest, TEST_MAX_SHOTS } from "@/lib/server/grovshot-v2/admin-test";
import type { Chain } from "@/lib/server/grovshot-v2/drive";

/**
 * GROVBASE SHOT V2 — „Autokonfiguracja” (/admin/ai/prompts → Silnik V2): the
 * admin's ordinary steps, done once, in order, by the server with the
 * admin's own session — so the Vault key that seals a stage text never
 * leaves the server and every write goes through the same database
 * functions, gates and audit as the editor:
 *
 *   1. a stage with NO published version gets the specification's text as a
 *      draft (ai_save_tool_prompt) — an existing draft with the same text is
 *      reused; a stage an admin already published is NEVER touched;
 *   2. every draft passes the publish gate (layout, variables, the config
 *      JSON, every role's model usable) — one failure and nothing is
 *      published;
 *   3. the drafts are published (ai_publish_tool_prompt), the config last;
 *   4. optionally, admin tests within the limit the admin confirmed: a
 *      prompt test on the published versions (A), the same on a config
 *      DRAFT with the stronger model for the card and the plan (B — never
 *      published, only compared), and a one-shot full test with images (C).
 *      Each test's worst case is computed before anything starts (every
 *      Claude call at its max output, every paid image the config allows);
 *      the tests whose sum exceeds the limit are not started.
 *
 * Prices, the margin gate, the flag and the knowledge base are not touched.
 */

export const AUTOPILOT_SUMMARY = "Autokonfiguracja GrovShot V2 (specyfikacja)";
const VARIANT_B_SUMMARY = "Autokonfiguracja · wariant testowy B (Opus 5.5: karta + plan) — tylko do porównania";
/** Variant B: the stronger model where the spec says quality is decided. */
export const VARIANT_B_MODELS: Partial<Record<StageRole, StageModel>> = {
  card: { provider: "anthropic", model: "claude-opus-5-5", effort: "medium" },
  plan: { provider: "anthropic", model: "claude-opus-5-5", effort: "high" },
};
/** The stage call's own max_tokens (lib/ai/engine/vision.ts). */
const MAX_OUTPUT_TOKENS = 16_000;
const MAX_LIMIT_USD = 20;

export type AutopilotInput = {
  reason: string;
  /** The spending limit the admin confirmed, USD (tests only). */
  limitUsd: number;
  tests: "none" | "prompts" | "prompts_full";
  /** Storage paths in the admin's workspace; empty = the newest upload set. */
  photos?: string[];
  description?: string;
};

export type AutopilotStep = { key: string; status: "done" | "kept" | "skipped" | "failed"; detail?: string };
export type AutopilotRun = { label: "A" | "B" | "C"; mode: "prompts" | "full"; shots: number; worstUsdMicros: number; runId: string | null; error?: string };
export type AutopilotReport = { ok: boolean; error?: string; steps: AutopilotStep[]; runs: AutopilotRun[]; photos: string[]; limitUsdMicros: number };

type Row = { id: string; tool_key: string; version: number; status: string; summary: string | null; body_encrypted: string; body_iv: string; body_tag: string };

/** Tokens one photo can cost a Claude call at the vision edge (1536 px square ≈ w·h/750). */
const IMAGE_TOKENS = 3_200;

/**
 * The most a test can cost: every Claude call of the order at the model's
 * published token price — twice the projected text input, every photo the
 * call reads at its largest, and the call's full max output — plus (full
 * test) every paid image the config allows for each shot. Null when a model
 * has no published price — then nothing is started.
 */
export function testWorstCase(state: EngineState, config: EngineConfig, shots: number, mode: "prompts" | "full", resolution: string, photos: number): number | null {
  const images: Record<StageRole, number> = { validate: photos, card: photos, plan: 0, prompt: 0, qc: config.limits.max_refs_per_shot + 1 };
  const call = (role: StageRole): number | null => {
    const m = config.models[role];
    const p = m ? findTokenPrice(state.tokenPrices, m.provider, m.model) : null;
    if (!p) return null;
    const input = ROLE_CALL_TOKENS[role].input * 2 + images[role] * IMAGE_TOKENS;
    return Math.ceil((input * p.inputPerMTok + MAX_OUTPUT_TOKENS * p.outputPerMTok) / 1_000_000);
  };
  const counts: Record<StageRole, number> = {
    validate: 1, card: 1, plan: 1 + config.limits.replans,
    prompt: shots * (1 + (mode === "full" ? config.retry.max_rounds : 0)),
    qc: mode === "full" ? shots * config.limits.max_paid_images_per_shot * (1 + config.qc.reask) : 0,
  };
  let total = 0;
  for (const role of STAGE_ROLES) {
    if (counts[role] === 0) continue;
    const c = call(role);
    if (c === null) return null;
    total += c * counts[role];
  }
  if (mode === "full") {
    const unit = imageUnitPrice(state, resolution);
    const tokens = imageTokenCost(state, config);
    if (unit === null || tokens === null) return null;
    total += shots * config.limits.max_paid_images_per_shot * (unit + tokens);
  }
  return total;
}

const IMAGE = /\.(jpe?g|png|webp)$/i;

/** The admin's newest upload set (2–10 photos of one folder) in their own workspace. */
async function newestPhotoSet(supabase: Client, workspaceId: string): Promise<string[]> {
  const bucket = supabase.storage.from("product-images");
  const { data: folders } = await bucket.list(workspaceId, { limit: 100 });
  let best: { at: string; paths: string[] } | null = null;
  for (const f of (folders ?? []).filter((x) => !x.id && /^(adhoc|gsv2-test-input)-?/.test(x.name)).slice(0, 60)) {
    const { data: files } = await bucket.list(`${workspaceId}/${f.name}`, { limit: 20, sortBy: { column: "created_at", order: "asc" } });
    const imgs = (files ?? []).filter((x) => x.id && IMAGE.test(x.name));
    if (imgs.length < 2 || imgs.length > 10) continue;
    const at = imgs.map((x) => x.created_at ?? "").sort().pop() ?? "";
    if (!best || at > best.at) best = { at, paths: imgs.map((x) => `${workspaceId}/${f.name}/${x.name}`) };
  }
  return best?.paths ?? [];
}

export async function runAutopilot(supabase: Client, adminId: string, input: AutopilotInput, chain: Chain): Promise<AutopilotReport> {
  const steps: AutopilotStep[] = [];
  const runs: AutopilotRun[] = [];
  const reason = String(input?.reason ?? "").trim().slice(0, 300);
  const limit = Number(input?.limitUsd);
  const tests = input?.tests === "prompts" || input?.tests === "prompts_full" ? input.tests : "none";
  const limitUsdMicros = Number.isFinite(limit) && limit > 0 && limit <= MAX_LIMIT_USD ? Math.round(limit * 1_000_000) : 0;
  const fail = (error: string): AutopilotReport => ({ ok: false, error, steps, runs, photos: [], limitUsdMicros });
  if (!reason) return fail("reason_required");
  if (tests !== "none" && limitUsdMicros === 0) return fail("invalid_input");

  const ring = await adminPromptKeyring(supabase);
  if (!ring.canSeal) return fail("prompt_key_unavailable");
  const { data: rowsRaw } = await supabase.from("ai_tool_prompts")
    .select("id, tool_key, version, status, summary, body_encrypted, body_iv, body_tag")
    .in("tool_key", [...GROVSHOT_V2_KEYS]).in("status", ["draft", "published"]).order("version", { ascending: false });
  const rows = (rowsRaw ?? []) as Row[];

  // 1 · drafts from the specification, only where nothing is published.
  const toPublish: { key: GrovshotStageKey; id: string; text: string }[] = [];
  const published: Partial<Record<GrovshotStageKey, { id: string; text: string; version: number }>> = {};
  for (const key of GROVSHOT_V2_KEYS) {
    const own = rows.filter((r) => r.tool_key === key);
    const live = own.find((r) => r.status === "published");
    if (live) {
      const opened = openPrompt(ring, live);
      if (!opened) return fail("prompt_key_unavailable");
      published[key] = { id: live.id, text: opened.text, version: live.version };
      steps.push({ key: `draft:${key}`, status: "kept", detail: `v${live.version}` });
      continue;
    }
    const text = specDraft(key);
    const same = own.filter((r) => r.status === "draft").find((r) => openPrompt(ring, r)?.text === text);
    if (same) {
      toPublish.push({ key, id: same.id, text });
      steps.push({ key: `draft:${key}`, status: "skipped", detail: `v${same.version}` });
      continue;
    }
    const sealed = sealPrompt(ring, text);
    const { data, error } = await supabase.rpc("ai_save_tool_prompt", {
      p_tool_key: key, p_body_encrypted: sealed.ciphertext, p_iv: sealed.iv, p_tag: sealed.authTag,
      p_summary: AUTOPILOT_SUMMARY, p_reason: reason, p_source: "manual", p_publish: false,
    });
    const saved = (error ? null : data) as { ok?: boolean; id?: string; version?: number } | null;
    if (!saved?.ok || !saved.id) return fail(`draft_failed:${key}`);
    toPublish.push({ key, id: saved.id, text });
    steps.push({ key: `draft:${key}`, status: "done", detail: `v${saved.version}` });
  }

  // 2 · the publish gate for every draft — all pass, or nothing is published.
  for (const d of toPublish) {
    const problems = [...grovshotTemplateProblems(d.key, d.text), ...malformedPlaceholders(d.text).map((p) => `placeholder:${p}`)];
    if (problems.length > 0) {
      steps.push({ key: `gate:${d.key}`, status: "failed", detail: problems.slice(0, 5).join(", ") });
      return fail("gate_failed");
    }
  }
  const configText = toPublish.find((d) => d.key === "grovshot_v2_config")?.text ?? published.grovshot_v2_config?.text ?? "";
  const parsed = parseEngineConfig(configText);
  if (!parsed.ok) { steps.push({ key: "gate:models", status: "failed", detail: parsed.errors.slice(0, 5).join(", ") }); return fail("config_invalid"); }
  const backends = await roleBackends(supabase, parsed.config.models).catch(() => null);
  const unusable = (backends?.status ?? []).filter((r) => !r.usable).map((r) => `${r.role}:${r.primary.state}`);
  if (!backends || unusable.length > 0) { steps.push({ key: "gate:models", status: "failed", detail: unusable.join(", ") || "unreadable" }); return fail("analysis_unavailable"); }
  steps.push({ key: "gate:models", status: "done", detail: STAGE_ROLES.map((r) => `${r}=${parsed.config.models[r].model}${parsed.config.models[r].effort ? `·${parsed.config.models[r].effort}` : ""}`).join(" ") });

  // 3 · publish, the config last (the order every stage reads its roles from).
  for (const d of toPublish) {
    const { data, error } = await supabase.rpc("ai_publish_tool_prompt", { p_id: d.id, p_reason: reason });
    const out = (error ? null : data) as { ok?: boolean; error?: string } | null;
    if (!out?.ok) { steps.push({ key: `publish:${d.key}`, status: "failed", detail: out?.error ?? "generic" }); return fail("publish_failed"); }
    await logAudit(supabase, {
      actorId: adminId, action: "ai_tool.prompt_published", entityType: "ai_tool_prompt", entityId: d.id,
      after: { reason, autopilot: true, tool_key: d.key },
    });
    published[d.key] = { id: d.id, text: d.text, version: 0 };
    steps.push({ key: `publish:${d.key}`, status: "done" });
  }

  // The expert knowledge the orders will seal (published, not changed here).
  const snapshot = await readKnowledgeSnapshot(supabase, { preview: false });
  steps.push(snapshot && snapshot !== "unreadable"
    ? { key: "knowledge", status: "kept", detail: `v${snapshot.version} · ${snapshot.rules.length}` }
    : { key: "knowledge", status: "failed", detail: snapshot === "unreadable" ? "unreadable" : "unpublished" });

  // 4 · tests, within the confirmed limit.
  let photos: string[] = [];
  if (tests !== "none") {
    const workspace = await getCurrentWorkspace(supabase, adminId);
    if (!workspace) return { ok: false, error: "no_workspace", steps, runs, photos, limitUsdMicros };
    photos = (input.photos ?? []).filter((p) => typeof p === "string" && p.startsWith(`${workspace.id}/`)).slice(0, 10);
    if (photos.length === 0) photos = await newestPhotoSet(supabase, workspace.id);
    if (photos.length === 0) { steps.push({ key: "tests", status: "failed", detail: "no_photos" }); return { ok: false, error: "no_photos", steps, runs, photos, limitUsdMicros }; }
    const state = await readEngineState(supabase);
    const ratio = state.model?.ratios.includes("4:5") ? "4:5" : state.model?.ratios[0] ?? "";
    const resolution = state.model?.resolutions.includes("2K") ? "2K" : state.model?.resolutions[0] ?? "";
    const base = Object.fromEntries(GROVSHOT_V2_KEYS.map((k) => [k, published[k]!.id])) as Record<GrovshotStageKey, string>;

    // Variant B: the published config with the stronger card and plan — a draft, never published.
    const textB = JSON.stringify({ ...JSON.parse(configText) as Record<string, unknown>, models: { ...parsed.config.models, ...VARIANT_B_MODELS } }, null, 2);
    const parsedB = parseEngineConfig(textB);
    let configB: string | null = null;
    if (parsedB.ok) {
      const existing = rows.filter((r) => r.tool_key === "grovshot_v2_config" && r.status === "draft").find((r) => openPrompt(ring, r)?.text === textB);
      if (existing) configB = existing.id;
      else {
        const sealed = sealPrompt(ring, textB);
        const { data } = await supabase.rpc("ai_save_tool_prompt", {
          p_tool_key: "grovshot_v2_config", p_body_encrypted: sealed.ciphertext, p_iv: sealed.iv, p_tag: sealed.authTag,
          p_summary: VARIANT_B_SUMMARY, p_reason: reason, p_source: "manual", p_publish: false,
        });
        configB = ((data ?? null) as { id?: string } | null)?.id ?? null;
      }
    }

    const shots = Math.min(3, TEST_MAX_SHOTS);
    const plans: { label: AutopilotRun["label"]; mode: AutopilotRun["mode"]; shots: number; config: EngineConfig; versions: Record<string, string> }[] = [
      { label: "A", mode: "prompts", shots, config: parsed.config, versions: base },
      ...(configB && parsedB.ok ? [{ label: "B" as const, mode: "prompts" as const, shots, config: parsedB.config, versions: { ...base, grovshot_v2_config: configB } }] : []),
      ...(tests === "prompts_full" ? [{ label: "C" as const, mode: "full" as const, shots: 1, config: parsed.config, versions: base }] : []),
    ];
    let committed = 0;
    for (const p of plans) {
      const bound = testWorstCase(state, p.config, p.shots, p.mode, resolution, photos.length);
      if (bound === null) { runs.push({ label: p.label, mode: p.mode, shots: p.shots, worstUsdMicros: 0, runId: null, error: "price_unknown" }); continue; }
      if (committed + bound > limitUsdMicros) { runs.push({ label: p.label, mode: p.mode, shots: p.shots, worstUsdMicros: bound, runId: null, error: "over_limit" }); continue; }
      const started = await startAdminTest(supabase, adminId, {
        versions: p.versions, photos, shots: p.shots, aspectRatio: ratio, resolution,
        description: String(input.description ?? ""), mode: p.mode, confirmed: p.mode === "full", knowledge: "active",
      }, chain);
      if (started.ok) { committed += bound; runs.push({ label: p.label, mode: p.mode, shots: p.shots, worstUsdMicros: bound, runId: started.runId }); }
      else runs.push({ label: p.label, mode: p.mode, shots: p.shots, worstUsdMicros: bound, runId: null, error: started.error });
    }
    steps.push({ key: "tests", status: runs.some((r) => r.runId) ? "done" : "failed", detail: `${runs.filter((r) => r.runId).length}/${runs.length}` });
  }

  await logAudit(supabase, {
    actorId: adminId, action: "grovshot_v2.autopilot", entityType: "ai_tool", entityId: "grovshot_v2",
    after: { reason, limit_usd_micros: limitUsdMicros, tests, steps, runs, photos: photos.length },
  });
  return { ok: true, steps, runs, photos, limitUsdMicros };
}
