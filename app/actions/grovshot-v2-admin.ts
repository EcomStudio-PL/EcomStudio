"use server";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { openPrompt, sealPrompt } from "@/lib/server/ai-engine";
import { PromptKeyError, unopenedError } from "@/lib/server/prompt-vault";
import { adminPromptKeyring } from "@/lib/server/prompt-vault-admin";
import { malformedPlaceholders } from "@/lib/ai/prompt-variables";
import { GROVSHOT_V2_KEYS, isGrovshotV2Key, type GrovshotStageKey } from "@/lib/grovshot-v2/stages";
import { grovshotTemplateProblems } from "@/lib/grovshot-v2/gate";
import { specDraft } from "@/lib/server/grovshot-v2/seed";
import { startGrovshotRun } from "@/lib/server/grovshot-v2/start";
import { driveGrovshotAfterResponse } from "@/lib/server/grovshot-v2/drive";
import { readRecentRuns, type V2RunView } from "@/lib/server/grovshot-v2/admin";
import type { StageBody } from "@/lib/server/grovshot-v2/settings";

/**
 * GROVBASE SHOT V2 — the admin's actions on its tab (/admin/ai/prompts →
 * Silnik V2). Admin only, checked on every call; every write is audited.
 *
 *   · „Wczytaj szkice ze specyfikacji” — saves the spec's texts as DRAFTS of
 *     the six stage keys (never published by code; the admin reviews,
 *     edits and publishes each one through the ordinary versioned editor);
 *   · „Test silnika” — a REAL order on the admin's own photos, on the
 *     versions the admin picked (drafts included), recorded as a test run
 *     (grovshot_test): never charged, never in a library.
 */

type Result = { ok: boolean; error?: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("id, role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}

function failure(e: unknown): string {
  if (e instanceof PromptKeyError) return "prompt_key_unavailable";
  if (e instanceof Error && (e.message === "unauthenticated" || e.message === "not_admin")) return "forbidden";
  return "generic";
}

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export async function seedSpecDraftsAction(reason: string): Promise<Result & { saved?: number }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const why = reason.trim();
    if (!why) return { ok: false, error: "reason_required" };
    const ring = await adminPromptKeyring(supabase);
    let saved = 0;
    const versions: Record<string, number> = {};
    for (const key of GROVSHOT_V2_KEYS) {
      const sealed = sealPrompt(ring, specDraft(key));
      const { data, error } = await supabase.rpc("ai_save_tool_prompt", {
        p_tool_key: key, p_body_encrypted: sealed.ciphertext, p_iv: sealed.iv, p_tag: sealed.authTag,
        p_summary: "Szkic ze specyfikacji (GrovShot V2)", p_reason: why, p_source: "manual", p_publish: false,
      });
      const result = (error ? null : data) as { ok?: boolean; version?: number } | null;
      if (!result?.ok) return { ok: false, error: "generic", saved };
      saved++;
      if (typeof result.version === "number") versions[key] = result.version;
    }
    await logAudit(supabase, {
      actorId: adminId, action: "grovshot_v2.drafts_seeded", entityType: "ai_tool", entityId: "prompts",
      after: { reason: why, versions },
    });
    // The GrovShot page is the dynamic tool route.
    revalidatePath("/admin/ai/[tool]", "page");
    return { ok: true, saved };
  } catch (e) { return { ok: false, error: failure(e) }; }
}

async function chainFor(supabase: Awaited<ReturnType<typeof createClient>>) {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const { data: { session } } = await supabase.auth.getSession();
  return host && session?.access_token ? { origin: `${proto}://${host}`, token: session.access_token } : null;
}

export async function startGrovshotTestAction(input: {
  versions: Record<string, string>; photos: string[]; shots: number; aspectRatio: string; resolution: string;
  description: string; dimensions?: unknown;
}): Promise<Result & { runId?: string; blockers?: string[] }> {
  try {
    const { supabase, adminId } = await requireAdmin();
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
    }, { test: { bodies } });
    if (!result.ok) return { ok: false, error: result.error, blockers: result.blockers };
    await logAudit(supabase, {
      actorId: adminId, action: "grovshot_v2.tested", entityType: "ai_engine_run", entityId: result.runId,
      after: { versions: Object.fromEntries(GROVSHOT_V2_KEYS.map((k) => [k, bodies[k].version])), shots: input.shots },
    });
    driveGrovshotAfterResponse(supabase, adminId, workspace.id, result.runId, Date.now(), await chainFor(supabase));
    return { ok: true, runId: result.runId };
  } catch (e) { return { ok: false, error: failure(e) }; }
}

/** One test run as the admin sees it — and an idle one is picked up again. */
export async function readGrovshotTestAction(runId: string): Promise<Result & { run?: V2RunView; driving?: boolean }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!/^[0-9a-f-]{36}$/i.test(runId)) return { ok: false, error: "invalid_input" };
    const [view] = await readRecentRuns(supabase, { kind: "grovshot_test", ids: [runId], limit: 1 });
    if (!view) return { ok: false, error: "not_found" };
    const { data: row } = await supabase.from("ai_engine_runs").select("user_id, workspace_id, locked_until")
      .eq("id", runId).eq("run_kind", "grovshot_test").maybeSingle();
    const driving = Boolean(row?.locked_until && Date.parse(row.locked_until) > Date.now());
    // Only the admin's OWN test run is ever driven from here.
    if ((view.status === "queued" || view.status === "running") && !driving && row?.user_id === adminId && row.workspace_id) {
      driveGrovshotAfterResponse(supabase, adminId, row.workspace_id, runId, Date.now(), await chainFor(supabase));
    }
    return { ok: true, run: view, driving };
  } catch (e) { return { ok: false, error: failure(e) }; }
}
