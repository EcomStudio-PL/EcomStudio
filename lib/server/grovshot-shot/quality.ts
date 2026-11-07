import "server-only";
import type { Client } from "@/lib/services/workspace";
import { P } from "@/lib/grovshot-v2/steps";

/**
 * GROVBASE SHOT → Jakość (admin). Every figure is computed from what the
 * engine stored — runs, their step rows, the customers' reports — over a
 * stated window; nothing is estimated and an unknown cost is UNKNOWN, never 0.
 *
 * DEFINITIONS (shown in the panel):
 *   regeneration share = regeneration orders of a shot ÷ shots DELIVERED by
 *     the original orders (customer orders only; tests excluded);
 *   report share       = reports ÷ delivered shots;
 *   image calls per delivered photo = Nano Banana Pro calls (every attempt,
 *     retries included) ÷ delivered photos;
 *   technical error share = image calls that failed for a technical reason
 *     (timeout, 5xx, 429, lost) ÷ all image calls.
 */

export type QualityRow = {
  key: string; orders: number; delivered: number; regens: number; reports: number;
  regenShare: number | null; reportShare: number | null;
};
export type CostRow = { key: string; orders: number; delivered: number; knownMicros: number; unknownCalls: number; perOrderMicros: number | null; perPhotoMicros: number | null };
export type ReportView = {
  id: string; createdAt: string; reason: string; comment: string | null; runId: string; shot: number; kbVersion: number | null;
  recipe: string | null; kind: string | null; imageUrl: string | null; prompt: string | null; planShot: unknown; card: unknown;
  versions: { generationId: string; createdAt: string; url: string | null }[];
};
export type QualityData = {
  window: { from: string; to: string };
  totals: { orders: number; delivered: number; regens: number; reports: number; imageCalls: number; techErrors: number; retries: number };
  byRecipe: QualityRow[];
  byKind: QualityRow[];
  byKb: QualityRow[];
  costs: { overall: CostRow; byKb: CostRow[]; byModel: { model: string; calls: number; knownMicros: number; unknownCalls: number }[] };
  reports: ReportView[];
  runs: { id: string; createdAt: string; status: string; kb: number | null; recipe: string | null; shots: number; delivered: number; costMicros: number | null; unknown: number }[];
};

type Run = { id: string; created_at: string; status: string; run_kind: string; input: Record<string, unknown>; api_cost_usd_micros: number | null; cost_unknown: number | null; workspace_id: string };
type Step = { run_id: string; position: number; item_index: number; status: string; error_code: string | null; output: unknown; cost_usd_micros: number | null; cost_basis: string; model: string | null; provider_slug: string | null };

const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const arr = (v: unknown) => (Array.isArray(v) ? v : []);
const TECH = new Set(["provider_timeout", "provider_rate_limited", "provider_error", "provider_unreachable", "round_lost"]);

export async function readQuality(supabase: Client, days = 90): Promise<QualityData> {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const { data: runRows } = await supabase.from("ai_engine_runs")
    .select("id, created_at, status, run_kind, input, api_cost_usd_micros, cost_unknown, workspace_id")
    .eq("run_kind", "grovshot").eq("input->>pipeline", "lifestyle").gte("created_at", from.toISOString())
    .order("created_at", { ascending: false }).limit(500);
  const runs = (runRows ?? []) as unknown as Run[];
  const roots = runs.filter((r) => !obj(r.input).regen);
  const regens = runs.filter((r) => obj(r.input).regen);
  const ids = runs.map((r) => r.id);
  const steps: Step[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabase.from("ai_engine_step_runs")
      .select("run_id, position, item_index, status, error_code, output, cost_usd_micros, cost_basis, model, provider_slug")
      .in("run_id", ids.slice(i, i + 100)).in("position", [P.card, P.plan, P.write, P.round, P.settle]).limit(5000);
    steps.push(...((data ?? []) as unknown as Step[]));
  }
  const of = (runId: string) => steps.filter((s) => s.run_id === runId);
  const lastOk = (xs: Step[]) => [...xs].sort((a, b) => b.item_index - a.item_index).find((s) => s.status === "succeeded" && obj(s.output).usable !== false);
  const recipeOf = (runId: string) => {
    const c = lastOk(of(runId).filter((s) => s.position === P.card));
    const r = obj(obj(c?.output).raw).przepis_stylu;
    return typeof r === "string" ? r : null;
  };
  const planOf = (runId: string) => arr(obj(obj(lastOk(of(runId).filter((s) => s.position === P.plan))?.output).raw).ujecia).map(obj);
  const deliveredShots = (runId: string) => of(runId).filter((s) => s.position === P.settle && s.status === "succeeded").map((s) => s.item_index + 1);
  const kbOf = (r: Run) => Number(obj(obj(r.input).kb).version) || null;

  const { data: reportRows } = await supabase.from("grovshot_shot_reports")
    .select("id, created_at, reason, comment, run_id, shot, generation_id, kb_version").gte("created_at", from.toISOString())
    .order("created_at", { ascending: false }).limit(300);
  const reportsAll = (reportRows ?? []) as { id: string; created_at: string; reason: string; comment: string | null; run_id: string; shot: number; generation_id: string | null; kb_version: number | null }[];

  // ── shares by recipe, shot kind, knowledge version ──
  type Acc = { orders: Set<string>; delivered: number; regens: number; reports: number };
  const acc = new Map<string, Map<string, Acc>>([["recipe", new Map()], ["kind", new Map()], ["kb", new Map()]]);
  const bump = (dim: string, key: string, f: (a: Acc) => void) => {
    const m = acc.get(dim)!;
    if (!m.has(key)) m.set(key, { orders: new Set(), delivered: 0, regens: 0, reports: 0 });
    f(m.get(key)!);
  };
  for (const r of roots) {
    const recipe = recipeOf(r.id) ?? "—";
    const kb = `v${kbOf(r) ?? "?"}`;
    const plan = planOf(r.id);
    for (const n of deliveredShots(r.id)) {
      const kind = String(plan.find((x) => Number(x.numer) === n)?.typ ?? "—");
      const regenCount = regens.filter((g) => obj(obj(g.input).regen).source_run_id === r.id && Number(obj(obj(g.input).regen).shot) === n).length;
      const reportCount = reportsAll.filter((x) => x.run_id === r.id && x.shot === n).length;
      for (const [dim, key] of [["recipe", recipe], ["kind", kind], ["kb", kb]] as const) {
        bump(dim, key, (a) => { a.orders.add(r.id); a.delivered++; a.regens += regenCount; a.reports += reportCount; });
      }
    }
  }
  const rows = (dim: string): QualityRow[] => [...acc.get(dim)!.entries()].map(([key, a]) => ({
    key, orders: a.orders.size, delivered: a.delivered, regens: a.regens, reports: a.reports,
    regenShare: a.delivered ? a.regens / a.delivered : null, reportShare: a.delivered ? a.reports / a.delivered : null,
  })).sort((x, y) => y.delivered - x.delivered);

  // ── costs ──
  const rounds = steps.filter((s) => s.position === P.round);
  const imageCalls = rounds.length;
  const techErrors = rounds.filter((s) => TECH.has(String(obj(s.output).error ?? s.error_code ?? ""))).length;
  const retries = rounds.filter((s) => s.item_index % 5 > 0).length;
  const costRow = (key: string, rs: Run[]): CostRow => {
    const delivered = rs.reduce((n, r) => n + deliveredShots(r.id).length, 0);
    const known = rs.reduce((n, r) => n + (r.api_cost_usd_micros ?? 0), 0);
    const unknown = rs.reduce((n, r) => n + (r.cost_unknown ?? 0), 0);
    return {
      key, orders: rs.length, delivered, knownMicros: known, unknownCalls: unknown,
      // UNKNOWN (null) as soon as one call of the group had no price.
      perOrderMicros: unknown > 0 || rs.length === 0 ? null : Math.round(known / rs.length),
      perPhotoMicros: unknown > 0 || delivered === 0 ? null : Math.round(known / delivered),
    };
  };
  const finished = runs.filter((r) => r.status !== "queued" && r.status !== "running");
  const kbKeys = [...new Set(finished.map((r) => `v${kbOf(r) ?? "?"}`))];
  const models = new Map<string, { calls: number; knownMicros: number; unknownCalls: number }>();
  for (const s of steps.filter((x) => (x.position === P.card || x.position === P.plan || (x.position === P.write && x.item_index < 30) || x.position === P.round) && x.status !== "pending")) {
    const k = s.model ?? "—";
    const m = models.get(k) ?? { calls: 0, knownMicros: 0, unknownCalls: 0 };
    m.calls++;
    if (s.cost_basis === "unknown" || s.cost_usd_micros === null) m.unknownCalls++; else m.knownMicros += s.cost_usd_micros;
    models.set(k, m);
  }

  // ── reports with their evidence ──
  const reports: ReportView[] = [];
  for (const x of reportsAll.slice(0, 60)) {
    const plan = planOf(x.run_id);
    const asm = of(x.run_id).find((s) => s.position === P.write && s.item_index === 30 && s.status === "succeeded");
    const prompt = arr(obj(asm?.output).shots).map(obj).find((p) => Number(p.numer) === x.shot);
    const card = obj(lastOk(of(x.run_id).filter((s) => s.position === P.card))?.output).raw ?? null;
    const runIds = [x.run_id, ...regens.filter((g) => obj(obj(g.input).regen).source_run_id === x.run_id && Number(obj(obj(g.input).regen).shot) === x.shot).map((g) => g.id)];
    const { data: jobs } = await supabase.from("generation_jobs").select("id, settings").in("settings->>run_id", runIds).limit(20);
    // The order's own job of this shot, and every job of its regenerations.
    const jobIds = (jobs ?? []).filter((j) => String(obj(j.settings).run_id) !== x.run_id || Number(obj(j.settings).shot) === x.shot).map((j) => j.id);
    const { data: gens } = jobIds.length ? await supabase.from("generations").select("id, created_at, generation_assets(storage_path)").in("job_id", jobIds).order("created_at") : { data: [] };
    const versions: ReportView["versions"] = [];
    for (const g of (gens ?? []) as { id: string; created_at: string; generation_assets: { storage_path: string }[] }[]) {
      const path = g.generation_assets?.[0]?.storage_path;
      const { data: signed } = path ? await supabase.storage.from("generation-assets").createSignedUrl(path, 3600) : { data: null };
      versions.push({ generationId: g.id, createdAt: g.created_at, url: signed?.signedUrl ?? null });
    }
    reports.push({
      id: x.id, createdAt: x.created_at, reason: x.reason, comment: x.comment, runId: x.run_id, shot: x.shot, kbVersion: x.kb_version,
      recipe: recipeOf(x.run_id), kind: String(plan.find((p) => Number(p.numer) === x.shot)?.typ ?? "") || null,
      imageUrl: versions.find((v) => v.generationId === x.generation_id)?.url ?? versions[versions.length - 1]?.url ?? null,
      prompt: typeof prompt?.text === "string" ? prompt.text : null, planShot: plan.find((p) => Number(p.numer) === x.shot) ?? null, card, versions,
    });
  }

  return {
    window: { from: from.toISOString(), to: to.toISOString() },
    totals: {
      orders: roots.length, delivered: roots.reduce((n, r) => n + deliveredShots(r.id).length, 0), regens: regens.length,
      reports: reportsAll.length, imageCalls, techErrors, retries,
    },
    byRecipe: rows("recipe"), byKind: rows("kind"), byKb: rows("kb"),
    costs: {
      overall: costRow("all", finished),
      byKb: kbKeys.map((k) => costRow(k, finished.filter((r) => `v${kbOf(r) ?? "?"}` === k))),
      byModel: [...models.entries()].map(([model, m]) => ({ model, ...m })).sort((a, b) => b.calls - a.calls),
    },
    reports,
    runs: runs.slice(0, 100).map((r) => ({
      id: r.id, createdAt: r.created_at, status: r.status, kb: kbOf(r), recipe: recipeOf(r.id), shots: Number(obj(r.input).shots) || 0,
      delivered: deliveredShots(r.id).length, costMicros: (r.cost_unknown ?? 0) > 0 ? null : r.api_cost_usd_micros, unknown: r.cost_unknown ?? 0,
    })),
  };
}
