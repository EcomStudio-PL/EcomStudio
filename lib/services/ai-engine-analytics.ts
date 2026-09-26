import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { MIN_SAMPLE, qualityScore } from "@/lib/ai/knowledge-ranking";

type Client = SupabaseClient<Database>;

/**
 * ENGINE ANALYTICS — admin-only reads (ai_engine_runs, generation_feedback
 * and knowledge_examples are admin-readable under RLS). Numbers are counted,
 * never estimated: totals are exact counts; averages, votes and scene
 * statistics come from the latest 1000 runs of the last 90 days.
 */

export type EngineRunRow = {
  id: string;
  createdAt: string;
  mode: string;
  status: string;
  error: string | null;
  engineVersion: string | null;
  promptVersion: number | null;
  workflowVersion: number | null;
  modelLabel: string | null;
  modelId: string | null;
  steps: { n: number; name: string; op: string; status: string; ms: number; attempts: number; error?: string; reason?: string }[];
  knowledgeIds: string[];
  sceneExampleId: string | null;
  credits: number | null;
  costUsdMicros: number | null;
  durationMs: number | null;
  jobId: string | null;
  sessionId: string | null;
  feedback: "like" | "dislike" | null;
};

export type ExampleStat = {
  id: string;
  setId: string;
  scene: string | null;
  category: string | null;
  usage: number;
  likes: number;
  dislikes: number;
  score: number;
  sampleOk: boolean;
};

export type EngineAnalytics = {
  runs: number;
  ok: number;
  failed: number;
  blocked: number;
  likes: number;
  dislikes: number;
  workflowRuns: number;
  workflowOk: number;
  avgCredits: number | null;
  avgDurationMs: number | null;
  topExamples: ExampleStat[];
  bestScenes: { scene: string; likes: number; dislikes: number }[];
  worstScenes: { scene: string; likes: number; dislikes: number }[];
  reasons: Record<string, number>;
};

const DAYS = 90;
/** PostgREST returns at most 1000 rows per request. */
const SAMPLE_ROWS = 1000;
const CHUNK = 100;

export async function readEngineRuns(supabase: Client, toolKey: string, limit = 30): Promise<EngineRunRow[]> {
  const { data } = await supabase.from("ai_engine_runs")
    .select("id, created_at, mode, status, error, engine_version, prompt_version, workflow_version, model_label, model_id, steps, knowledge_example_ids, scene_example_id, credits, api_cost_usd_micros, duration_ms, job_id, prompt_session_id")
    .eq("tool_key", toolKey).order("created_at", { ascending: false }).limit(limit);
  const rows = data ?? [];
  const jobIds = rows.map((r) => r.job_id).filter(Boolean) as string[];
  const { data: votes } = jobIds.length
    ? await supabase.from("generation_feedback").select("generation_job_id, verdict")
        .in("generation_job_id", jobIds).in("verdict", ["like", "dislike"])
    : { data: [] as { generation_job_id: string; verdict: string }[] };
  const byJob = new Map<string, { like: number; dislike: number }>();
  for (const v of votes ?? []) {
    const c = byJob.get(v.generation_job_id) ?? { like: 0, dislike: 0 };
    if (v.verdict === "like") c.like++; else c.dislike++;
    byJob.set(v.generation_job_id, c);
  }
  return rows.map((r) => {
    const c = r.job_id ? byJob.get(r.job_id) : undefined;
    return {
      id: r.id, createdAt: r.created_at, mode: r.mode, status: r.status, error: r.error,
      engineVersion: r.engine_version, promptVersion: r.prompt_version, workflowVersion: r.workflow_version,
      modelLabel: r.model_label, modelId: r.model_id,
      steps: Array.isArray(r.steps) ? (r.steps as EngineRunRow["steps"]) : [],
      knowledgeIds: r.knowledge_example_ids ?? [], sceneExampleId: r.scene_example_id,
      credits: r.credits, costUsdMicros: r.api_cost_usd_micros, durationMs: r.duration_ms,
      jobId: r.job_id, sessionId: r.prompt_session_id,
      feedback: c ? (c.like >= c.dislike ? "like" : "dislike") : null,
    };
  });
}

export async function readEngineAnalytics(supabase: Client, toolKey: string, setIds: string[]): Promise<EngineAnalytics> {
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  // Totals are COUNTED in the database (exact counts); averages and the vote
  // join use the latest SAMPLE_ROWS runs, which the view states.
  const countRuns = async (filter: { status?: string; mode?: string }) => {
    let qb = supabase.from("ai_engine_runs").select("id", { count: "exact", head: true })
      .eq("tool_key", toolKey).gte("created_at", since);
    if (filter.status) qb = qb.eq("status", filter.status);
    if (filter.mode) qb = qb.eq("mode", filter.mode);
    const { count } = await qb;
    return count ?? 0;
  };
  const [total, okCount, failedCount, blockedCount, wfTotal, wfOk, { data: runsData }] = await Promise.all([
    countRuns({}), countRuns({ status: "ok" }), countRuns({ status: "failed" }), countRuns({ status: "blocked" }),
    countRuns({ mode: "workflow" }), countRuns({ mode: "workflow", status: "ok" }),
    supabase.from("ai_engine_runs")
      .select("status, mode, credits, duration_ms, job_id, prompt_session_id")
      .eq("tool_key", toolKey).gte("created_at", since)
      .order("created_at", { ascending: false }).limit(SAMPLE_ROWS),
  ]);
  const runs = runsData ?? [];

  // The jobs this tool produced: direct (runs.job_id) and, for GrovShot, the
  // concept jobs generated from its sessions. IN lists are chunked so no
  // request URL grows past what PostgREST accepts.
  const jobIds = new Set(runs.map((r) => r.job_id).filter(Boolean) as string[]);
  const sessionIds = [...new Set(runs.map((r) => r.prompt_session_id).filter(Boolean) as string[])];
  for (let i = 0; i < sessionIds.length; i += CHUNK) {
    const { data: jobs } = await supabase.from("generation_jobs").select("id")
      .in("prompt_session_id", sessionIds.slice(i, i + CHUNK)).limit(1000);
    for (const j of jobs ?? []) jobIds.add(j.id);
  }
  let likes = 0; let dislikes = 0;
  const reasons: Record<string, number> = {};
  const ids = [...jobIds];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data: votes } = await supabase.from("generation_feedback").select("verdict, issues")
      .in("generation_job_id", ids.slice(i, i + CHUNK)).in("verdict", ["like", "dislike"]);
    for (const v of votes ?? []) {
      if (v.verdict === "like") likes++; else dislikes++;
      for (const r of v.issues ?? []) reasons[r] = (reasons[r] ?? 0) + 1;
    }
  }

  const ok = runs.filter((r) => r.status === "ok");
  const credits = ok.map((r) => r.credits).filter((c): c is number => typeof c === "number");
  const durations = ok.map((r) => r.duration_ms).filter((c): c is number => typeof c === "number");

  // Knowledge quality — examples in the sets assigned to this tool.
  let topExamples: ExampleStat[] = [];
  const sceneAgg = new Map<string, { likes: number; dislikes: number }>();
  if (setIds.length) {
    const { data: ex } = await supabase.from("knowledge_examples")
      .select("id, set_id, scene, product_category, usage_count, positive_count, negative_count, result_rating")
      .in("set_id", setIds.slice(0, CHUNK)).eq("review_status", "approved").eq("enabled", true).limit(SAMPLE_ROWS);
    const stats = (ex ?? []).map((e) => ({
      id: e.id, setId: e.set_id, scene: e.scene, category: e.product_category,
      usage: e.usage_count, likes: e.positive_count, dislikes: e.negative_count,
      score: qualityScore({ resultRating: e.result_rating, positiveCount: e.positive_count, negativeCount: e.negative_count }),
      sampleOk: e.positive_count + e.negative_count >= MIN_SAMPLE,
    }));
    topExamples = [...stats].sort((a, b) => b.score - a.score || b.usage - a.usage).slice(0, 8);
    for (const s of stats) {
      const key = s.scene?.trim().slice(0, 120);
      if (!key) continue;
      const a = sceneAgg.get(key) ?? { likes: 0, dislikes: 0 };
      a.likes += s.likes; a.dislikes += s.dislikes;
      sceneAgg.set(key, a);
    }
  }
  // Scenes are ranked only once they have a minimum number of votes — a scene
  // with one 👍 is not "the best scene".
  const scenes = [...sceneAgg.entries()]
    .filter(([, v]) => v.likes + v.dislikes >= MIN_SAMPLE)
    .map(([scene, v]) => ({ scene, ...v, rate: (v.likes + 1) / (v.likes + v.dislikes + 2) }));
  const bestScenes = [...scenes].sort((a, b) => b.rate - a.rate).slice(0, 3).map(({ scene, likes: l, dislikes: d }) => ({ scene, likes: l, dislikes: d }));
  const worstScenes = [...scenes].sort((a, b) => a.rate - b.rate).slice(0, 3).map(({ scene, likes: l, dislikes: d }) => ({ scene, likes: l, dislikes: d }));

  return {
    runs: total,
    ok: okCount,
    failed: failedCount,
    blocked: blockedCount,
    likes, dislikes,
    workflowRuns: wfTotal,
    workflowOk: wfOk,
    avgCredits: credits.length ? credits.reduce((a, b) => a + b, 0) / credits.length : null,
    avgDurationMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    topExamples, bestScenes, worstScenes, reasons,
  };
}
