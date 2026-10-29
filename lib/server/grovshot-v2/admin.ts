import "server-only";
import type { Client } from "@/lib/services/workspace";
import { billingFrom } from "@/lib/images/pricing";
import { readPromptHistory, type PromptVersionRow } from "@/lib/services/ai-tools";
import { withKeyStates } from "@/lib/server/prompt-vault-admin";
import { GROVSHOT_V2_FLAG, GROVSHOT_V2_KEYS, type GrovshotStageKey } from "@/lib/grovshot-v2/stages";
import { readEngineState, type EngineState } from "@/lib/server/grovshot-v2/settings";
import { economicsFor, type V2Economics } from "@/lib/server/grovshot-v2/rollout";
import { P as P_ADMIN } from "@/lib/server/grovshot-v2/run";

/**
 * GROVBASE SHOT V2 — what the admin tab shows (admin session only; the page
 * is behind the /admin guard). Versions, prices, codes and timings — never a
 * prompt body (the editors open one by version id, on request), never a
 * sealed stage, never a customer's photo or description.
 */

export type FlagView = { exists: boolean; enabled: boolean; roles: string[]; plans: string[]; rollout: number | null };

export type V2StageRow = { key: GrovshotStageKey; published: number | null; drafts: number };

export type V2RoundView = {
  round: number; status: string; decision: string | null; images: number; reissued: number;
  verdicts: string[]; rejecting: string[]; retry: string | null; costUsdMicros: number | null;
  executor: string | null; error: string | null;
};
export type V2ShotView = {
  n: number; state: "delivered" | "not_delivered" | "open"; reason: string | null;
  rounds: V2RoundView[]; charges: number; released: number;
};
export type V2RunView = {
  id: string; kind: string; status: string; error: string | null; createdAt: string; durationMs: number | null;
  credits: number; costUsdMicros: number | null; costUnknown: number; ordered: number; planned: number | null;
  recipe: string | null; engineVersion: string | null; versions: Partial<Record<GrovshotStageKey, number>>;
  notes: string[]; stages: { name: string; status: string; ms: number | null; executor: string | null; cached: boolean; error: string | null; costUsdMicros: number | null }[];
  shots: V2ShotView[];
  /** Test runs only: the delivered test images (signed for the admin). */
  results: string[];
};

export type GrovshotAdmin = {
  state: Pick<EngineState, "ready" | "blockers" | "textBackends"> & {
    model: { identifier: string; resolutions: string[]; ratios: string[]; pricing: Record<string, number> } | null;
    configOk: boolean;
  };
  stages: V2StageRow[];
  flag: FlagView;
  economics: V2Economics | null;
  runs: V2RunView[];
};

export async function readGrovshotAdmin(supabase: Client): Promise<GrovshotAdmin> {
  const [state, { data: billingRow }, { data: flagRow }, histories, runs] = await Promise.all([
    readEngineState(supabase),
    supabase.from("app_settings").select("value").eq("key", "billing").maybeSingle(),
    supabase.from("feature_flags").select("enabled, roles, plans, rollout_percent").eq("flag", GROVSHOT_V2_FLAG).maybeSingle(),
    Promise.all(GROVSHOT_V2_KEYS.map((k) => readPromptHistory(supabase, k))),
    readRecentRuns(supabase),
  ]);
  const stages: V2StageRow[] = GROVSHOT_V2_KEYS.map((key, i) => ({
    key,
    published: histories[i].find((v) => v.status === "published")?.version ?? null,
    drafts: histories[i].filter((v) => v.status === "draft").length,
  }));
  return {
    state: {
      ready: state.ready, blockers: state.blockers, textBackends: state.textBackends,
      model: state.model ? {
        identifier: state.model.identifier, resolutions: state.model.resolutions, ratios: state.model.ratios, pricing: state.model.pricing,
      } : null,
      configOk: state.config !== null,
    },
    stages,
    flag: {
      exists: Boolean(flagRow), enabled: flagRow?.enabled === true, roles: flagRow?.roles ?? [], plans: flagRow?.plans ?? [],
      rollout: flagRow?.rollout_percent ?? null,
    },
    economics: economicsFor(state, billingFrom(billingRow?.value)),
    runs,
  };
}

/** One stage key's versions, for its editor (no body). */
export async function readStageVersions(supabase: Client, key: GrovshotStageKey): Promise<PromptVersionRow[]> {
  return readPromptHistory(supabase, key).then((h) => withKeyStates(supabase, h));
}

type StepRow = {
  run_id: string; position: number; item_index: number; status: string; attempts: number; duration_ms: number | null;
  provider_slug: string | null; model: string | null; cost_usd_micros: number | null; cost_basis: string; error_code: string | null;
  output: unknown;
};

const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string | null => (typeof x === "string" && x ? x : null);
const executorOf = (s: StepRow) => [s.provider_slug, s.model].filter(Boolean).join(" / ") || null;
const STAGE_NAMES: Record<string, string> = { "1:-1": "validate", "2:-1": "card", "3:0": "plan", "3:1": "replan", "4:-1": "mirror" };

export async function readRecentRuns(supabase: Client, opts: { kind?: "grovshot" | "grovshot_test"; ids?: string[]; limit?: number } = {}): Promise<V2RunView[]> {
  let q = supabase.from("ai_engine_runs")
    .select("id, run_kind, status, error, created_at, duration_ms, credits, api_cost_usd_micros, cost_unknown, expected_outputs, progress, engine_version, input")
    .in("run_kind", opts.kind ? [opts.kind] : ["grovshot", "grovshot_test"])
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 15);
  if (opts.ids) q = q.in("id", opts.ids);
  const { data: runs } = await q;
  const list = runs ?? [];
  if (list.length === 0) return [];
  const { data: steps } = await supabase.from("ai_engine_step_runs")
    .select("run_id, position, item_index, status, attempts, duration_ms, provider_slug, model, cost_usd_micros, cost_basis, error_code, output")
    .in("run_id", list.map((r) => r.id)).order("position").order("item_index").limit(3000);
  const byRun = new Map<string, StepRow[]>();
  for (const s of (steps ?? []) as unknown as StepRow[]) byRun.set(s.run_id, [...(byRun.get(s.run_id) ?? []), s]);

  // A test run's delivered images live in the admin's own test folder.
  const testPaths = list.filter((r) => r.run_kind === "grovshot_test").flatMap((r) =>
    (byRun.get(r.id) ?? []).filter((s) => s.position === P_ADMIN.settle && s.status === "succeeded")
      .map((s) => str(obj(s.output).path)).filter((p): p is string => Boolean(p)));
  const { data: signed } = testPaths.length
    ? await supabase.storage.from("generation-assets").createSignedUrls(testPaths, 900)
    : { data: [] as { path: string | null; signedUrl: string }[] };
  const urlOf = new Map((signed ?? []).map((u) => [u.path, u.signedUrl]));

  return list.map((r) => {
    const st = byRun.get(r.id) ?? [];
    const progress = obj(r.progress);
    const input = obj(r.input);
    const stagesIn = obj(input.stages);
    const versions = Object.fromEntries(GROVSHOT_V2_KEYS.flatMap((k) => {
      const v = obj(stagesIn[k]).version;
      return typeof v === "number" ? [[k, v]] : [];
    })) as Partial<Record<GrovshotStageKey, number>>;
    const planned = typeof progress.planned === "number" ? progress.planned : null;
    const shotCount = Math.max(0, Math.min(10, planned ?? (r.status === "queued" || r.status === "running" ? r.expected_outputs ?? 0 : 0)));
    const shots: V2ShotView[] = Array.from({ length: shotCount }, (_, n) => {
      const inShot = (pos: number) => st.filter((s) => s.position === pos && s.item_index >= n * 5 && s.item_index < n * 5 + 5);
      const settle = st.find((s) => s.position === P_ADMIN.settle && s.item_index === n);
      const charges = inShot(P_ADMIN.charge).filter((c) => c.status === "succeeded");
      const released = charges.filter((c) => st.find((d) => d.position === P_ADMIN.deliver && d.item_index === c.item_index)?.status === "failed").length;
      return {
        n: n + 1,
        state: settle?.status === "succeeded" ? "delivered" : settle?.status === "failed" ? "not_delivered" : "open",
        reason: settle?.status === "failed" ? settle.error_code : null,
        charges: charges.length, released,
        rounds: inShot(P_ADMIN.round).map((s) => {
          const o = obj(s.output);
          const cands = arr(o.candidates).map(obj);
          const retry = obj(o.retry);
          return {
            round: s.item_index - n * 5, status: s.status, decision: str(o.decision),
            images: cands.filter((c) => c.ok === true).length,
            reissued: cands.filter((c) => c.reissued === true).length,
            verdicts: cands.map((c) => str(c.verdict) ?? (c.ok ? "—" : str(c.error) ?? "no_image")),
            rejecting: [...new Set(cands.flatMap((c) => arr(c.rejecting).map((f) => str(obj(f).category)).filter((x): x is string => Boolean(x))))],
            retry: str(retry.mode),
            costUsdMicros: typeof o.cost_usd_micros === "number" ? o.cost_usd_micros : s.cost_usd_micros,
            executor: executorOf(s), error: s.error_code,
          };
        }),
      };
    });
    return {
      id: r.id, kind: r.run_kind, status: r.status, error: r.error || null, createdAt: r.created_at, durationMs: r.duration_ms,
      credits: r.credits ?? 0, costUsdMicros: r.api_cost_usd_micros === null ? null : Number(r.api_cost_usd_micros),
      costUnknown: r.cost_unknown ?? 0, ordered: r.expected_outputs ?? 0, planned,
      recipe: str(progress.recipe), engineVersion: r.engine_version, versions,
      notes: arr(progress.notes).map((x) => str(obj(x).code)).filter((x): x is string => Boolean(x)),
      stages: st.filter((s) => STAGE_NAMES[`${s.position}:${s.item_index}`]).map((s) => ({
        name: STAGE_NAMES[`${s.position}:${s.item_index}`], status: s.status, ms: s.duration_ms,
        executor: executorOf(s), cached: obj(s.output).cached === true, error: s.error_code,
        costUsdMicros: s.cost_basis === "unknown" ? null : s.cost_usd_micros,
      })),
      shots,
      results: r.run_kind === "grovshot_test"
        ? st.filter((s) => s.position === P_ADMIN.settle && s.status === "succeeded")
            .map((s) => urlOf.get(str(obj(s.output).path) ?? "")).filter((u): u is string => Boolean(u))
        : [],
    };
  });
}
