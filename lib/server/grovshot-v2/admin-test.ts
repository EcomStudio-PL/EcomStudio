import "server-only";
import { createHash } from "node:crypto";
import type { Client } from "@/lib/services/workspace";
import { logAudit } from "@/lib/services/audit";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { openPrompt } from "@/lib/server/ai-engine";
import { unopenedError } from "@/lib/server/prompt-vault";
import { adminPromptKeyring } from "@/lib/server/prompt-vault-admin";
import { malformedPlaceholders } from "@/lib/ai/prompt-variables";
import { GROVSHOT_V2_KEYS, isGrovshotV2Key, type GrovshotStageKey } from "@/lib/grovshot-v2/stages";
import { grovshotTemplateProblems } from "@/lib/grovshot-v2/gate";
import { startGrovshotRun } from "@/lib/server/grovshot-v2/start";
import { driveGrovshotAfterResponse, type Chain } from "@/lib/server/grovshot-v2/drive";
import { readRecentRuns, type V2RunView } from "@/lib/server/grovshot-v2/admin";
import type { StageBody } from "@/lib/server/grovshot-v2/settings";

/**
 * GROVBASE SHOT V2 — „Test silnika” (an admin's real order on their own
 * photos, on the versions they picked, drafts included; recorded as a test
 * run, never charged, never in a library). Called by the admin-only route
 * app/api/admin/grovshot-v2/test — a route, not a server action, so the
 * whole engine is compiled once with the other routes and not again for the
 * admin page's actions (that doubled the build's memory).
 */

export type TestInput = {
  versions: Record<string, string>; photos: string[]; shots: number; aspectRatio: string; resolution: string;
  description: string; dimensions?: unknown;
  /** "prompts": Claude only, no image; "full": Claude + Nano Banana Pro + QC. */
  mode: "prompts" | "full";
  /** A full test makes paid image calls: the admin confirmed it, having seen
   *  its maximum budget. Refused without. */
  confirmed?: boolean;
};

/** A test order is small: 1–3 shots. */
export const TEST_MAX_SHOTS = 3;
type Result<T> = ({ ok: true } & T) | { ok: false; error: string; blockers?: string[] };

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export async function startAdminTest(supabase: Client, adminId: string, input: TestInput, chain: Chain): Promise<Result<{ runId: string }>> {
  if (input?.mode !== "prompts" && input?.mode !== "full") return { ok: false, error: "invalid_input" };
  if (!Number.isInteger(input.shots) || input.shots < 1 || input.shots > TEST_MAX_SHOTS) return { ok: false, error: "invalid_input" };
  if (input.mode === "full" && input.confirmed !== true) return { ok: false, error: "confirmation_required" };
  const workspace = await getCurrentWorkspace(supabase, adminId);
  if (!workspace) return { ok: false, error: "no_workspace" };
  const ids = GROVSHOT_V2_KEYS.map((k) => input.versions?.[k]);
  if (ids.some((id) => typeof id !== "string" || !id)) return { ok: false, error: "invalid_input" };
  const { data: rows } = await supabase.from("ai_tool_prompts")
    .select("id, tool_key, version, status, body_encrypted, body_iv, body_tag").in("id", ids as string[]);
  const ring = await adminPromptKeyring(supabase);
  const bodies = {} as Record<GrovshotStageKey, StageBody>;
  const problems: string[] = [];
  for (const key of GROVSHOT_V2_KEYS) {
    const row = (rows ?? []).find((r) => r.id === input.versions[key]);
    if (!row || row.tool_key !== key || !isGrovshotV2Key(row.tool_key) || (row.status !== "draft" && row.status !== "published")) {
      return { ok: false, error: "not_found" };
    }
    const opened = openPrompt(ring, row);
    if (opened === null) return { ok: false, error: unopenedError(ring) };
    // The same gate a publish passes: a test never runs on a text that
    // could not be published.
    if (grovshotTemplateProblems(key, opened.text).length > 0 || malformedPlaceholders(opened.text).length > 0) problems.push(key);
    bodies[key] = { key, version: row.version, text: opened.text, sha256: sha(opened.text) };
  }
  if (problems.length > 0) return { ok: false, error: "variable_unknown", blockers: problems };
  const result = await startGrovshotRun(supabase, adminId, workspace.id, {
    photos: input.photos, shots: input.shots, aspectRatio: input.aspectRatio, resolution: input.resolution,
    sessionType: "lifestyle", description: String(input.description ?? "").slice(0, 20_000), dimensions: input.dimensions ?? null,
  }, { test: { bodies, mode: input.mode } });
  if (!result.ok) return { ok: false, error: result.error, blockers: result.blockers };
  await logAudit(supabase, {
    actorId: adminId, action: "grovshot_v2.tested", entityType: "ai_engine_run", entityId: result.runId,
    after: { versions: Object.fromEntries(GROVSHOT_V2_KEYS.map((k) => [k, bodies[k].version])), shots: input.shots, mode: input.mode },
  });
  driveGrovshotAfterResponse(adminId, workspace.id, result.runId, Date.now(), chain);
  return { ok: true, runId: result.runId };
}

/** One test run as the admin sees it — and the admin's own idle one is picked up again. */
export async function readAdminTest(supabase: Client, adminId: string, runId: string, chain: Chain): Promise<Result<{ run: V2RunView; driving: boolean }>> {
  const [view] = await readRecentRuns(supabase, { kind: "grovshot_test", ids: [runId], limit: 1 });
  if (!view) return { ok: false, error: "not_found" };
  const { data: row } = await supabase.from("ai_engine_runs").select("user_id, workspace_id, locked_until")
    .eq("id", runId).eq("run_kind", "grovshot_test").maybeSingle();
  const driving = Boolean(row?.locked_until && Date.parse(row.locked_until) > Date.now());
  if ((view.status === "queued" || view.status === "running") && !driving && row?.user_id === adminId && row.workspace_id) {
    driveGrovshotAfterResponse(adminId, row.workspace_id, runId, Date.now(), chain);
  }
  return { ok: true, run: view, driving };
}
