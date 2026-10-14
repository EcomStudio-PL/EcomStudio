/** In-memory twin of lib/server/engine/workflow-store.ts for the Miniaturka
 *  tests: the 0129 lease and step semantics, nothing else. */
import type { Json } from "@/lib/database.types";
import { db, iso } from "./thumb-db";

export type RunRow = {
  id: string; tool_key: string; workspace_id: string | null; user_id: string | null; job_id: string | null;
  status: string; run_kind: string; usage_event_id: string | null; workflow_id: string | null;
  workflow_version: number | null; input: Json; outputs: Json; progress: Json; expected_outputs: number | null;
  credits: number | null; error: string | null; created_at: string; finished_at: string | null;
  knowledge_example_ids: string[];
};
export type StepRunRow = {
  position: number; item_index: number; status: string; attempts: number; provider_slug: string | null;
  model: string | null; input_tokens: number | null; output_tokens: number | null; units: number | null;
  unit_kind: string | null; cost_usd_micros: number | null; cost_basis: string; error_code: string | null;
  output: Json | null; duration_ms: number | null; step_name: string | null; operation: string;
};
export type StepBegin =
  | { state: "run"; attempts: number }
  | { state: "done"; output: Json | null; provider: string | null; model: string | null }
  | { state: "busy" | "not_owner" }
  | { state: "failed" | "skipped"; error: string | null };
export type StepResult = {
  status: "succeeded" | "failed" | "skipped"; attempts: number; providerSlug?: string | null; model?: string | null;
  inputTokens?: number | null; outputTokens?: number | null; units?: number | null;
  unitKind?: "image" | "second" | "request" | "page" | null;
  cost: { basis: "actual" | "estimated"; usdMicros: number } | { basis: "unknown" };
  errorCode?: string | null; output?: Json | null; durationMs: number;
};

const OPEN = new Set(["queued", "running"]);
const t = () => db().now;

export async function readRun(_s: unknown, runId: string): Promise<RunRow | null> {
  const r = db().runs.get(runId);
  return r ? (JSON.parse(JSON.stringify(r)) as RunRow) : null;
}

export async function claimRun(_s: unknown, runId: string, owner: string, leaseSeconds: number) {
  const r = db().runs.get(runId);
  if (!r) return { claimed: false, reason: "not_found" };
  const locked = typeof r.locked_until === "number" && (r.locked_until as number) > t() && r.lease_owner !== owner;
  if (!OPEN.has(String(r.status))) return { claimed: false, reason: "finished", status: r.status };
  if (locked) return { claimed: false, reason: "busy", status: r.status };
  r.locked_until = t() + Math.min(Math.max(leaseSeconds, 10), 900) * 1000;
  r.lease_owner = owner;
  r.invocations = Number(r.invocations ?? 0) + 1;
  if (r.status === "queued") r.status = "running";
  return { claimed: true, status: r.status };
}

export async function patchRun(_s: unknown, runId: string, owner: string, patch: Record<string, Json | undefined>): Promise<boolean> {
  const r = db().runs.get(runId);
  if (!r || !OPEN.has(String(r.status)) || r.lease_owner !== owner) return false;
  const status = typeof patch.status === "string" ? patch.status : null;
  if (status) r.status = status;
  if ("error" in patch) r.error = patch.error ? String(patch.error).slice(0, 80) : null;
  for (const k of ["job_id", "outputs", "progress", "credits", "api_cost_usd_micros", "cost_unknown", "model_label", "duration_ms"]) {
    if (k in patch && patch[k] !== undefined) r[k] = patch[k];
  }
  if (status && ["ok", "partial", "failed", "blocked"].includes(status)) { r.locked_until = null; r.finished_at = iso(t()); }
  else if ("lease_seconds" in patch) r.locked_until = t() + Math.max(10, Number(patch.lease_seconds)) * 1000;
  return true;
}

export async function readStepRuns(_s: unknown, runId: string): Promise<StepRunRow[]> {
  return JSON.parse(JSON.stringify(db().steps.filter((s) => s.run_id === runId)
    .sort((a, b) => (Number(a.position) - Number(b.position)) || (Number(a.item_index) - Number(b.item_index))))) as StepRunRow[];
}

export async function beginStep(_s: unknown, runId: string, owner: string, position: number, item: number,
  name: string, operation: string, leaseSeconds: number): Promise<StepBegin> {
  const r = db().runs.get(runId);
  if (!r || !OPEN.has(String(r.status)) || r.lease_owner !== owner) return { state: "not_owner" };
  let s = db().steps.find((x) => x.run_id === runId && x.position === position && x.item_index === item);
  if (!s) {
    s = { run_id: runId, position, item_index: item, step_name: name, operation, status: "pending", attempts: 0, output: null, error_code: null };
    db().steps.push(s);
  }
  if (s.status === "succeeded") return { state: "done", output: (s.output ?? null) as Json, provider: null, model: null };
  if (s.status === "failed" || s.status === "skipped") return { state: s.status as "failed", error: (s.error_code as string) ?? null };
  if (s.status === "running" && typeof s.locked_until === "number" && (s.locked_until as number) > t()) return { state: "busy" };
  const prev = Number(s.attempts);
  s.status = "running";
  s.attempts = Math.min(20, prev + 1);
  s.started_at = s.started_at ?? iso(t());
  s.locked_until = t() + Math.min(Math.max(leaseSeconds, 10), 900) * 1000;
  return { state: "run", attempts: prev };
}

export async function finishStep(_s: unknown, runId: string, owner: string, position: number, item: number, res: StepResult): Promise<boolean> {
  const r = db().runs.get(runId);
  if (!r || r.lease_owner !== owner) return false;
  const s = db().steps.find((x) => x.run_id === runId && x.position === position && x.item_index === item);
  if (!s || s.status === "succeeded") return false;
  s.status = res.status;
  s.attempts = Math.max(Number(s.attempts), res.attempts);
  s.provider_slug = res.providerSlug ?? null;
  s.model = res.model ?? null;
  s.input_tokens = res.inputTokens ?? null;
  s.output_tokens = res.outputTokens ?? null;
  s.cost_basis = res.cost.basis;
  s.cost_usd_micros = res.cost.basis === "unknown" ? null : res.cost.usdMicros;
  s.error_code = res.status === "failed" ? (res.errorCode ?? "error") : null;
  s.output = res.status === "succeeded" ? JSON.parse(JSON.stringify(res.output ?? null)) : null;
  s.locked_until = null;
  return true;
}
