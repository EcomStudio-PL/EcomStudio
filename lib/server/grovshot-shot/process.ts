import "server-only";
import { createHash } from "node:crypto";
import type { Client } from "@/lib/services/workspace";
import { P, itemOf } from "@/lib/grovshot-v2/steps";
import type {
  ExperimentView, NodeStatus, PhotoRef, ProcessData, ProcessEdge, ProcessNode, RunSummary, ShotPlanView, StepDetail, StepRef,
} from "@/lib/grovshot-shot/process-types";
import { forVision } from "@/lib/server/grovshot-v2/media";
import { fitForClaude } from "@/lib/ai/engine/vision";
import { prepareReferenceImage } from "@/lib/server/reference-image";

/**
 * GROVBASE SHOT → the admin's PROCESS VIEW, built from what is stored.
 *
 * Reads the order's run and step rows (admin-only by their RLS) with the
 * admin's own session — nothing here is reachable by a customer: every route
 * using it checks the admin role on the server first, and the rows refuse
 * anyone else anyway. Nothing is reconstructed and called "sent": a step
 * without an observed network-boundary payload is flagged `no_boundary`.
 */

const POS_WRITE = P.write;
const ITEM = { product: 0, scenes: 10, assemble: 30 } as const;
const ROWS = 5;
const IMAGE_GUARD_MICROS = 10_000;

type Row = {
  run_id: string; position: number; item_index: number; status: string; attempts: number | null; duration_ms: number | null;
  provider_slug: string | null; model: string | null; input_tokens: number | null; output_tokens: number | null;
  cost_usd_micros: number | null; cost_basis: string | null; error_code: string | null; output: unknown;
  started_at: string | null; finished_at: string | null;
};
type RunRow = {
  id: string; run_kind: string; status: string; error: string | null; created_at: string; finished_at: string | null;
  user_id: string | null; workspace_id: string | null; input: unknown; progress: unknown; api_cost_usd_micros: number | null;
  cost_unknown: number | null; engine_version: string | null;
};

const STEP_COLUMNS = "run_id, position, item_index, status, attempts, duration_ms, provider_slug, model, input_tokens, output_tokens, cost_usd_micros, cost_basis, error_code, output, started_at, finished_at";
const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const str = (x: unknown): string => (typeof x === "string" ? x : "");

export async function readRunRow(supabase: Client, runId: string): Promise<RunRow | null> {
  const { data } = await supabase.from("ai_engine_runs")
    .select("id, run_kind, status, error, created_at, finished_at, user_id, workspace_id, input, progress, api_cost_usd_micros, cost_unknown, engine_version")
    .eq("id", runId).maybeSingle();
  const r = data as RunRow | null;
  return r && obj(r.input).pipeline === "lifestyle" ? r : null;
}

export async function readRunSteps(supabase: Client, runId: string): Promise<Row[]> {
  const { data } = await supabase.from("ai_engine_step_runs").select(STEP_COLUMNS).eq("run_id", runId)
    .order("position").order("item_index").limit(500);
  return (data ?? []) as unknown as Row[];
}

export async function readStepDetail(supabase: Client, runId: string, pos: number, item: number): Promise<StepDetail | null> {
  const { data } = await supabase.from("ai_engine_step_runs").select(STEP_COLUMNS).eq("run_id", runId).eq("position", pos).eq("item_index", item).maybeSingle();
  const r = data as unknown as Row | null;
  if (!r) return null;
  return {
    pos: r.position, item: r.item_index, status: r.status, attempts: r.attempts ?? 0, ms: r.duration_ms, provider: r.provider_slug, model: r.model,
    inputTokens: r.input_tokens, outputTokens: r.output_tokens, costMicros: r.cost_usd_micros, costBasis: r.cost_basis, error: r.error_code,
    startedAt: r.started_at, finishedAt: r.finished_at, output: r.output,
  };
}

const ref = (r: Row): StepRef => ({ pos: r.position, item: r.item_index, status: r.status, error: r.error_code });

/** The answer the engine used for a text step (lifestyle.ts stageRows' rule). */
export function chosenRow(rows: Row[]): Row | null {
  const ok = rows.filter((r) => r.status === "succeeded" && obj(r.output).usable !== false);
  if (ok.length === 0) return null;
  const last = rows[rows.length - 1];
  const errs = (r: Row) => arr(obj(r.output).errors).length;
  if (last?.status === "succeeded" && obj(last.output).usable !== false && errs(last) === 0) return last;
  return ok.slice().sort((a, b) => errs(a) - errs(b) || b.item_index - a.item_index)[0];
}

function groupStatus(rows: Row[]): NodeStatus {
  if (rows.length === 0) return "pending";
  if (rows.some((r) => r.status === "running" || r.status === "pending")) return "running";
  const chosen = chosenRow(rows);
  if (!chosen) return "failed";
  return rows.length > 1 || arr(obj(chosen.output).errors).length > 0 ? "warning" : "ok";
}

function costOf(rows: Row[]): { micros: number | null; unknown: boolean } {
  let micros = 0;
  let unknown = false;
  for (const r of rows) {
    if (r.cost_basis === "unknown" || r.cost_usd_micros === null) { if (r.status !== "pending") unknown = unknown || r.cost_basis === "unknown"; }
    else micros += r.cost_usd_micros;
  }
  return { micros: rows.length ? micros : null, unknown };
}

const hasBoundary = (r: Row) => obj(obj(r.output).boundary).requests !== undefined;

function textNode(id: string, kind: ProcessNode["kind"], key: string, col: number, rows: Row[]): ProcessNode {
  const c = costOf(rows);
  const chosen = chosenRow(rows);
  const flags: string[] = [];
  if (rows.length > 1) flags.push("repeat");
  if (rows.some((r) => r.status === "succeeded") && !rows.some(hasBoundary)) flags.push("no_boundary");
  if (chosen && arr(obj(chosen.output).errors).length) flags.push("violations");
  return {
    id, kind, title: { key }, status: groupStatus(rows), col, row: 0,
    ms: rows.reduce((s, r) => s + (r.duration_ms ?? 0), 0) || null, costMicros: c.micros, costUnknown: c.unknown,
    model: (chosen ?? rows[rows.length - 1])?.model ?? null, attempts: rows.length, thumb: null, shot: null, steps: rows.map(ref), flags,
  };
}

export async function readProcess(supabase: Client, runId: string): Promise<ProcessData | null> {
  const run = await readRunRow(supabase, runId);
  if (!run) return null;
  const input = obj(run.input);
  const progress = obj(run.progress);
  const steps = await readRunSteps(supabase, runId);
  const at = (pos: number, from: number, to: number) => steps.filter((s) => s.position === pos && s.item_index >= from && s.item_index < to);
  const one = (pos: number, item: number) => steps.find((s) => s.position === pos && s.item_index === item) ?? null;

  const photoPaths = arr(input.photos).map(str);
  const pin = obj(one(P.validate, -1)?.output);
  const shas = arr(pin.photo_shas ?? input.photo_shas).map((x) => (typeof x === "string" ? x : null));
  const signed = photoPaths.length
    ? (await supabase.storage.from("product-images").createSignedUrls(photoPaths, 3600)).data ?? []
    : [];
  const photos: PhotoRef[] = photoPaths.map((path, i) => ({ n: i + 1, path, url: signed[i]?.signedUrl ?? null, sha256: shas[i] ?? null }));

  // The plan the engine used, with what it broke.
  const planRows = at(P.plan, 0, ROWS);
  const planChosen = chosenRow(planRows);
  const viol = arr(progress.plan_violations).map(obj);
  const plan: ShotPlanView[] = arr(obj(obj(planChosen?.output).raw).ujecia).map(obj).map((u) => {
    const numer = Number(u.numer) || 0;
    return {
      numer, typ: str(u.typ), opis: str(u.opis), referencje: arr(u.referencje).map((x) => Number(String(x).replace(/\D/g, "")) || 0).filter(Boolean),
      kadr: str(u.kadr), ludzie: str(u.ludzie), swiatlo: str(u.swiatlo_typ) || str(u.swiatlo), miejsce: str(u.miejsce), kierunek: str(u.kierunek),
      caly_produkt: u.caly_produkt === true,
      violations: viol.filter((v) => arr(v.shots).map(Number).includes(numer)).map((v) => str(v.code)),
    };
  });

  const nodes: ProcessNode[] = [];
  const edges: ProcessEdge[] = [];
  const experimentOf = str(obj(input.experiment).source_run_id) || null;
  const regenOf = str(obj(input.regen).source_run_id) || null;
  const derived = Boolean(experimentOf || regenOf);
  nodes.push({
    id: "form", kind: "form", title: { key: "gsp.node.form" }, status: "ok", col: 0, row: 0, ms: null, costMicros: null, costUnknown: false,
    model: null, attempts: 0, thumb: photos[0]?.url ?? null, shot: null, steps: [], flags: [],
  });
  let prev = "form";
  let col = 1;
  if (!derived) {
    const groups: [string, ProcessNode["kind"], string, Row[]][] = [
      ["card", "card", "gsp.node.card", at(P.card, 0, ROWS)],
      ["plan", "plan", "gsp.node.plan", planRows],
      ["product", "product", "gsp.node.product", at(POS_WRITE, ITEM.product, ITEM.product + ROWS)],
      ["scenes", "scenes", "gsp.node.scenes", at(POS_WRITE, ITEM.scenes, ITEM.scenes + ROWS)],
    ];
    for (const [id, kind, key, rows] of groups) {
      if (rows.length === 0 && id !== "card") continue;
      nodes.push(textNode(id, kind, key, col++, rows));
      edges.push({ from: prev, to: id, kind: "flow" });
      prev = id;
    }
  }

  // The shots and their generation calls.
  const asm = obj(one(POS_WRITE, ITEM.assemble)?.output);
  const asmShots = arr(asm.shots).map(obj);
  const shotNumbers = asmShots.length ? asmShots.map((s) => Number(s.numer)) : plan.map((s) => s.numer);
  const deliveries = new Map<number, string>();
  for (let n = 0; n < shotNumbers.length; n++) {
    const settle = obj(one(P.settle, n)?.output);
    let path = str(settle.path);
    if (!path) {
      const d = steps.filter((s) => s.position === P.deliver && s.status === "succeeded" && s.item_index >= itemOf(n, 0) && s.item_index < itemOf(n + 1, 0));
      path = str(obj(d[d.length - 1]?.output).path);
    }
    if (path) deliveries.set(n, path);
  }

  // The admin's experiments on this order.
  const { data: expRows } = experimentOf ? { data: [] } : await supabase.from("ai_engine_runs")
    .select("id, status, error, created_at, api_cost_usd_micros, input")
    .eq("run_kind", "grovshot_test").eq("input->experiment->>source_run_id", runId).order("created_at").limit(100);
  const exps = (expRows ?? []) as { id: string; status: string; error: string | null; created_at: string; api_cost_usd_micros: number | null; input: unknown }[];
  const expSettles = exps.length
    ? ((await supabase.from("ai_engine_step_runs").select("run_id, output").in("run_id", exps.map((e) => e.id)).eq("position", P.settle).eq("item_index", 0)).data ?? []) as { run_id: string; output: unknown }[]
    : [];
  const { data: published } = exps.length
    ? await supabase.from("generation_assets").select("metadata").in("metadata->>experiment_run_id", exps.map((e) => e.id))
    : { data: [] };
  const publishedIds = new Set(((published ?? []) as { metadata: unknown }[]).map((p) => str(obj(p.metadata).experiment_run_id)));
  for (const e of expSettles) { const p = str(obj(e.output).path); if (p) deliveries.set(-1 - exps.findIndex((x) => x.id === e.run_id), p); }

  const paths = [...new Set(deliveries.values())];
  const assetUrls = paths.length ? (await supabase.storage.from("generation-assets").createSignedUrls(paths, 3600)).data ?? [] : [];
  const urlOf = (p: string | undefined) => (p ? assetUrls[paths.indexOf(p)]?.signedUrl ?? null : null);

  const shotCol = col;
  let maxRounds = 0;
  shotNumbers.forEach((numer, n) => {
    const settleRow = one(P.settle, n);
    const settle = obj(settleRow?.output);
    const rounds = steps.filter((s) => s.position === P.round && s.item_index >= itemOf(n, 0) && s.item_index < itemOf(n + 1, 0));
    maxRounds = Math.max(maxRounds, rounds.length);
    const state = str(settle.state);
    const status: NodeStatus = state === "delivered" ? "ok" : settleRow ? "failed" : rounds.some((r) => r.status === "running" || r.status === "pending") ? "running" : "pending";
    const sid = `shot-${numer}`;
    const planned = plan.find((s) => s.numer === numer);
    const flags: string[] = [];
    if (planned?.violations.length) flags.push("violations");
    const asmShot = asmShots.find((s) => Number(s.numer) === numer);
    if (str(asmShot?.pattern) === "detail") flags.push("detail");
    nodes.push({
      id: sid, kind: "shot", title: { key: "gsp.node.shot", values: { n: numer } }, status, col: shotCol, row: n,
      ms: null, costMicros: null, costUnknown: false, model: null, attempts: rounds.length, thumb: urlOf(deliveries.get(n)), shot: numer,
      steps: settleRow ? [ref(settleRow)] : [], flags,
    });
    edges.push({ from: prev, to: sid, kind: "flow" });
    let from = sid;
    rounds.forEach((r, k) => {
      const o = obj(r.output);
      const check = obj(o.reference_check);
      const f: string[] = [];
      if (!hasBoundary(r)) f.push("no_boundary");
      if (check.ok === false) f.push("ref_mismatch");
      const ok = o.ok === true;
      const rid = `round-${numer}-${k}`;
      nodes.push({
        id: rid, kind: "round", title: { key: k === 0 ? "gsp.node.round" : "gsp.node.retry", values: { k: k + 1 } },
        status: r.status === "running" || r.status === "pending" ? "running" : ok ? "ok" : "failed",
        col: shotCol + 1 + k, row: n, ms: r.duration_ms, costMicros: r.cost_basis === "unknown" ? null : r.cost_usd_micros,
        costUnknown: r.cost_basis === "unknown", model: r.model, attempts: 1,
        thumb: ok && k === rounds.length - 1 ? urlOf(deliveries.get(n)) : null, shot: numer, steps: [ref(r)], flags: f,
      });
      edges.push({ from, to: rid, kind: k === 0 ? "flow" : "retry" });
      from = rid;
    });
  });

  const experiments: ExperimentView[] = exps.map((e, j) => {
    const ex = obj(obj(e.input).experiment);
    return {
      id: e.id, shot: Number(ex.shot) || 0, status: e.status, createdAt: e.created_at, costMicros: e.api_cost_usd_micros,
      references: arr(ex.references).map(Number), imageUrl: urlOf(deliveries.get(-1 - j)), published: publishedIds.has(e.id), error: e.error,
    };
  });
  const perShot = new Map<number, number>();
  experiments.forEach((e) => {
    const n = shotNumbers.indexOf(e.shot);
    if (n < 0) return;
    const k = perShot.get(e.shot) ?? 0;
    perShot.set(e.shot, k + 1);
    const id = `exp-${e.id}`;
    nodes.push({
      id, kind: "experiment", title: { key: "gsp.node.experiment", values: { k: k + 1 } },
      status: e.status === "ok" ? "ok" : e.status === "queued" || e.status === "running" ? "running" : "failed",
      col: shotCol + 1 + Math.max(1, maxRounds) + k, row: n, ms: null, costMicros: e.costMicros, costUnknown: false, model: null, attempts: 1,
      thumb: e.imageUrl, shot: e.shot, steps: [], flags: e.published ? ["published"] : [], runId: e.id,
    });
    edges.push({ from: `shot-${e.shot}`, to: id, kind: "experiment" });
  });

  // The customer behind the order.
  let email: string | null = null;
  if (run.user_id) {
    const { data: prof } = await supabase.from("profiles").select("email").eq("id", run.user_id).maybeSingle();
    email = (prof as { email?: string | null } | null)?.email ?? null;
  }
  const textGroups = [at(P.card, 0, ROWS), planRows, at(POS_WRITE, ITEM.product, ITEM.product + ROWS), at(POS_WRITE, ITEM.scenes, ITEM.scenes + ROWS)];
  const imageRetries = shotNumbers.reduce((s, _, n) => s + Math.max(0, steps.filter((x) => x.position === P.round && x.item_index >= itemOf(n, 0) && x.item_index < itemOf(n + 1, 0)).length - 1), 0);
  const unit = num(pin.unit_price_usd_micros);
  const summary: RunSummary = {
    id: run.id, kind: run.run_kind, status: run.status, error: run.error, createdAt: run.created_at, finishedAt: run.finished_at,
    customer: { id: run.user_id, email }, workspaceId: run.workspace_id,
    ordered: Number(input.shots) || shotNumbers.length, delivered: [...Array(shotNumbers.length).keys()].filter((n) => str(obj(one(P.settle, n)?.output).state) === "delivered").length,
    engineVersion: run.engine_version ?? (str(input.engine_version) || null), kbVersion: num(obj(input.kb).version),
    costMicros: run.api_cost_usd_micros, costUnknown: run.cost_unknown ?? 0,
    retries: textGroups.reduce((s, g) => s + Math.max(0, g.length - 1), 0) + imageRetries,
    ratio: str(input.aspect_ratio) || null, resolution: str(input.resolution) || null,
    description: str(input.description), legacyNotes: str(input.notes),
    testMode: str(input.test_mode) || null, regenOf, experimentOf,
    experimentEstimateMicros: unit !== null ? unit + IMAGE_GUARD_MICROS : null,
    hasBoundary: steps.some(hasBoundary),
  };
  return { run: summary, photos, plan, nodes, edges, experiments };
}

/* ══ an image as it was sent — re-derived and proven by its hash ══════════*/

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

export type SentImageResult =
  | { ok: true; bytes: Buffer; mime: string; sha256: string; photo: number; verified: true }
  | { ok: false; error: "not_found" | "no_boundary" | "photo_unavailable" | "not_reproducible"; photo?: number; originalPath?: string };

/**
 * Image `n` (1-based) of request `req` of a step: the order photo it was made
 * from (the step's own mapping), transformed exactly as the engine does for
 * that provider (Claude: forVision → fitForClaude; Nano Banana Pro:
 * prepareReferenceImage), and returned ONLY if its SHA-256 equals the one
 * observed at the network boundary — otherwise the original is not passed
 * off as what was sent.
 */
export async function sentImage(supabase: Client, runId: string, pos: number, item: number, req: number, n: number): Promise<SentImageResult> {
  const run = await readRunRow(supabase, runId);
  const detail = run ? await readStepDetail(supabase, runId, pos, item) : null;
  if (!run || !detail) return { ok: false, error: "not_found" };
  const out = obj(detail.output);
  const requests = arr(obj(out.boundary).requests).map(obj);
  const request = requests[req];
  const image = arr(request?.images).map(obj).find((i) => Number(i.n) === n);
  if (!request || !image) return { ok: false, error: "no_boundary" };
  const isRound = pos === P.round;
  const photo = isRound
    ? Number(obj(arr(out.references_prepared).map(obj).find((r) => Number(r.n) === n)).photo) || 0
    : Number(arr(out.image_photos)[n - 1]) || 0;
  const path = arr(obj(run.input).photos).map(str)[photo - 1];
  if (!photo || !path) return { ok: false, error: "not_found" };
  const { data: blob } = await supabase.storage.from("product-images").download(path);
  if (!blob) return { ok: false, error: "photo_unavailable", photo, originalPath: path };
  const original = Buffer.from(await blob.arrayBuffer());
  let bytes: Buffer;
  let mime: string;
  if (isRound) {
    const p = await prepareReferenceImage(original, path);
    bytes = Buffer.from(p.base64, "base64"); mime = p.mime;
  } else {
    const v = await fitForClaude(await forVision(original));
    bytes = Buffer.from(v.base64, "base64"); mime = v.mime;
  }
  const h = sha(bytes);
  if (h !== str(image.sha256)) return { ok: false, error: "not_reproducible", photo, originalPath: path };
  return { ok: true, bytes, mime, sha256: h, photo, verified: true };
}
