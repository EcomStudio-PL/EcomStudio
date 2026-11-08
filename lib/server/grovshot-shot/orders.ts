import "server-only";
import type { Client } from "@/lib/services/workspace";
import { P } from "@/lib/grovshot-v2/steps";

/**
 * GROVBASE SHOT → Zlecenia: every lifestyle order (customers' and admins'
 * tests, regenerations, experiments) from the existing run and step rows —
 * no second order system. Admin-only by the caller and by the rows' RLS.
 */

export type ShotOrderRow = {
  id: string; createdAt: string; kind: string; status: string; error: string | null;
  customer: string | null; customerId: string | null;
  ordered: number; delivered: number; retries: number;
  engineVersion: string | null; kbVersion: number | null;
  costMicros: number | null; costUnknown: number;
  regenOf: string | null; experimentOf: string | null; testMode: string | null;
};

const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : {});

export async function readShotOrders(supabase: Client, limit = 150): Promise<ShotOrderRow[]> {
  const { data: runs } = await supabase.from("ai_engine_runs")
    .select("id, created_at, run_kind, status, error, user_id, engine_version, api_cost_usd_micros, cost_unknown, input->shots, input->kb, input->regen, input->experiment, input->test_mode")
    .in("run_kind", ["grovshot", "grovshot_test"]).eq("input->>pipeline", "lifestyle")
    .order("created_at", { ascending: false }).limit(limit);
  const rows = (runs ?? []) as unknown as {
    id: string; created_at: string; run_kind: string; status: string; error: string | null; user_id: string | null; engine_version: string | null;
    api_cost_usd_micros: number | null; cost_unknown: number | null; shots: unknown; kb: unknown; regen: unknown; experiment: unknown; test_mode: unknown;
  }[];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const { data: steps } = await supabase.from("ai_engine_step_runs")
    .select("run_id, position, item_index, state:output->>state")
    .in("run_id", ids).in("position", [P.card, P.plan, P.round, P.settle, P.write]).limit(20_000);
  const per = new Map<string, { position: number; item_index: number; state: string | null }[]>();
  for (const s of (steps ?? []) as unknown as { run_id: string; position: number; item_index: number; state: string | null }[]) {
    const l = per.get(s.run_id) ?? [];
    l.push(s);
    per.set(s.run_id, l);
  }
  const people = [...new Set(rows.map((r) => r.user_id).filter((x): x is string => Boolean(x)))];
  const { data: profiles } = people.length ? await supabase.from("profiles").select("id, email").in("id", people) : { data: [] };
  const email = new Map(((profiles ?? []) as { id: string; email: string | null }[]).map((p) => [p.id, p.email]));
  return rows.map((r) => {
    const s = per.get(r.id) ?? [];
    const count = (pos: number, from: number, to: number) => s.filter((x) => x.position === pos && x.item_index >= from && x.item_index < to).length;
    const textRetries = [count(P.card, 0, 5), count(P.plan, 0, 5), count(P.write, 0, 5), count(P.write, 10, 15)].reduce((a, n) => a + Math.max(0, n - 1), 0);
    const roundsPerShot = new Map<number, number>();
    for (const x of s) if (x.position === P.round) roundsPerShot.set(Math.floor(x.item_index / 5), (roundsPerShot.get(Math.floor(x.item_index / 5)) ?? 0) + 1);
    const imageRetries = [...roundsPerShot.values()].reduce((a, n) => a + Math.max(0, n - 1), 0);
    const regen = obj(r.regen);
    const exp = obj(r.experiment);
    return {
      id: r.id, createdAt: r.created_at, kind: r.run_kind, status: r.status, error: r.error,
      customer: r.user_id ? email.get(r.user_id) ?? null : null, customerId: r.user_id,
      ordered: Number(r.shots) || 0, delivered: s.filter((x) => x.position === P.settle && x.state === "delivered").length,
      retries: textRetries + imageRetries, engineVersion: r.engine_version, kbVersion: Number(obj(r.kb).version) || null,
      costMicros: r.api_cost_usd_micros, costUnknown: r.cost_unknown ?? 0,
      regenOf: typeof regen.source_run_id === "string" ? regen.source_run_id : null,
      experimentOf: typeof exp.source_run_id === "string" ? exp.source_run_id : null,
      testMode: typeof r.test_mode === "string" ? r.test_mode : null,
    };
  });
}
