/**
 * WORKFLOW ENGINE v2 — runtime behaviour tests WF1–WF17 (+ retry classes,
 * resume, double submit, prompt-leak probe).
 *
 * The REAL runtime runs: lib/server/engine/{workflow,workflow-exec,
 * workflow-store,image-call,tool-run}.ts, lib/ai/workflow-{def,values}.ts,
 * the usage/ledger client code and the cost maths. What is replaced at bundle
 * time (package.json "test:workflow2") is only what would spend money or needs
 * a network: the image adapters (scripts/stubs/wf-generation.ts), the text
 * chain (wf-vision.ts), the reference download and the server token.
 *
 * The database is an in-memory model of the 0129 functions — claim, begin,
 * finish, patch, the ledger's start/complete/fail/partial refund — written to
 * the SAME rules as the SQL (lease owner, never overwrite a success, pending-
 * only completion, one partial refund). The SQL itself is proven on a real
 * Postgres by scripts/workflow-v2-sql-tests.sh; this suite proves the runtime
 * drives it correctly.
 */
import { readFileSync } from "node:fs";
import { encryptSecret } from "@/lib/server/crypto";
import { driveWorkflowRun, startWorkflowRun } from "@/lib/server/engine/workflow";
import { runEngineImageTool, isPending } from "@/lib/server/engine/tool-run";
import { loadWorkflow } from "@/lib/server/engine/workflow-store";
import { validateWorkflow, blankStep, type WorkflowStepDef } from "@/lib/ai/workflow-def";
import { isRetriable } from "@/lib/ai/workflow-values";
import { fakeModels, imageCalls, modelScript, generationCalls, resetGeneration } from "./stubs/wf-generation";
import { visionCalls, visionControl } from "./stubs/wf-vision";
import type { Client } from "@/lib/services/workspace";

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${name}`);
  else { failed++; console.log(`  ✗ ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail).slice(0, 400)}`}`); }
};
const read = (p: string) => readFileSync(p, "utf8");

const PROBE = "GROVBASE_WORKFLOW_SECRET_PROBE_92671";
const WS = "11111111-1111-4111-8111-111111111111";
const USER = "user-1";

/* ── in-memory database ───────────────────────────────────────────────────*/

type Row = Record<string, unknown>;
type Db = {
  tables: Record<string, Row[]>;
  storage: Map<string, Buffer>;
  wallet: { id: string; balance: number };
  workflows: { id: string; tool_key: string; version: number; status: string; max_outputs: number; concurrency: number; steps: WorkflowStepDef[] }[];
  tool: { workflow_enabled: boolean; engine_mode: string; prompt: string | null };
  events: Row[];
  providerCalls: Row[];
  unitPrices: Row[];
  tokenPrices: Row[];
  rpc: string[];
};

let idSeq = 0;
const uuid = () => { idSeq++; return `00000000-0000-4000-8000-${String(idSeq).padStart(12, "0")}`; };
const now = () => Date.now();

function newDb(): Db {
  return {
    tables: { generation_jobs: [], generations: [], generation_assets: [], notifications: [], ai_engine_runs: [], ai_engine_step_runs: [], provider_health: [] },
    storage: new Map(), wallet: { id: "wallet-1", balance: 1000 },
    workflows: [], tool: { workflow_enabled: false, engine_mode: "grovbase", prompt: null },
    events: [], providerCalls: [], rpc: [],
    unitPrices: [], tokenPrices: [],
  };
}

function query(db: Db, table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let pendingInsert: Row[] | null = null;
  let pendingUpdate: Row | null = null;
  const rows = () => {
    if (table === "credit_wallets") return [{ id: db.wallet.id, balance: db.wallet.balance, workspace_id: WS }];
    return db.tables[table] ?? (db.tables[table] = []);
  };
  const run = () => {
    if (pendingInsert) {
      const list = rows();
      const inserted = pendingInsert.map((r) => ({ id: uuid(), created_at: new Date().toISOString(), ...r }));
      list.push(...inserted);
      return inserted;
    }
    const hit = rows().filter((r) => filters.every((f) => f(r)));
    if (pendingUpdate) { for (const r of hit) Object.assign(r, pendingUpdate); }
    return hit;
  };
  const self: Record<string, unknown> = {
    select: () => self,
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return self; },
    neq: (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return self; },
    in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return self; },
    gte: () => self, order: () => self, limit: () => self, is: () => self,
    insert: (r: Row | Row[]) => { pendingInsert = Array.isArray(r) ? r : [r]; return self; },
    update: (p: Row) => { pendingUpdate = p; return self; },
    upsert: async () => ({ error: null }),
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    single: async () => { const r = run()[0]; return { data: r ?? null, error: r ? null : { message: "none" } }; },
    then: (res: (v: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: run(), error: null }).then(res),
  };
  return self;
}

/** The 0129 functions, same rules as the SQL. */
function rpc(db: Db, name: string, a: Record<string, unknown>): { data: unknown; error: null | { message: string } } {
  db.rpc.push(name);
  const runs = db.tables.ai_engine_runs;
  const steps = db.tables.ai_engine_step_runs;
  const leaseOk = (r: Row) => !r.locked_until || (r.locked_until as number) < now();
  switch (name) {
    case "ai_tool_runtime": {
      const p = db.tool.prompt ? encryptSecret(db.tool.prompt) : null;
      return { data: [{
        tool_key: a.p_tool_key, engine_mode: db.tool.engine_mode, service_slug: null, allow_model_choice: false,
        fallback_enabled: false, timeout_ms: 120000, max_attempts: 1, primary_model_id: null, fallback_model_id: null,
        prompt_encrypted: p?.ciphertext ?? null, prompt_iv: p?.iv ?? null, prompt_tag: p?.authTag ?? null,
        prompt_version: p ? 1 : null, knowledge_strategy: "proven", workflow_enabled: db.tool.workflow_enabled,
      }], error: null };
    }
    case "ai_tool_workflow_read": {
      const wf = a.p_workflow_id
        ? db.workflows.find((w) => w.id === a.p_workflow_id && w.tool_key === a.p_tool_key)
        : db.workflows.find((w) => w.status === "published" && w.tool_key === a.p_tool_key);
      if (!wf) return { data: [], error: null };
      return { data: wf.steps.map((s, i) => {
        const e = encryptSecret(s.prompt.trim() || " ");
        return {
          workflow_id: wf.id, version: wf.version, status: wf.status, max_outputs: wf.max_outputs, concurrency: wf.concurrency,
          position: i + 1, name: s.name, enabled: s.enabled, operation: s.operation, output_kind: s.outputKind, use_images: s.inputImage !== "none",
          model_id: s.modelId, fallback_model_id: s.fallbackModelId, text_provider: s.textProvider, text_model: s.textModel,
          timeout_ms: s.timeoutMs, max_attempts: s.maxAttempts, condition: s.condition, output_name: s.outputName,
          input_image: s.inputImage, for_each: s.forEach, item_name: s.itemName, max_items: s.maxItems, tool_slug: s.toolSlug,
          on_error: s.onError, on_item_error: s.onItemError, prompt_encrypted: e.ciphertext, prompt_iv: e.iv, prompt_tag: e.authTag,
        };
      }), error: null };
    }
    case "ai_engine_run_create": {
      const r = a.p_run as Row;
      const existing = runs.find((x) => x.idempotency_key && x.idempotency_key === r.idempotency_key);
      if (existing) return { data: { id: existing.id, created: false, status: existing.status }, error: null };
      const row: Row = {
        id: uuid(), tool_key: r.tool_key, workspace_id: r.workspace_id, user_id: r.user_id, job_id: r.job_id ?? null,
        status: "queued", run_kind: r.run_kind === "workflow_test" ? "workflow_test" : "workflow", idempotency_key: r.idempotency_key,
        usage_event_id: r.usage_event_id ?? null, workflow_id: r.workflow_id, workflow_version: r.workflow_version,
        input: r.input, outputs: [], progress: {}, expected_outputs: r.expected_outputs, credits: r.credits,
        error: null, created_at: new Date().toISOString(), finished_at: null, knowledge_example_ids: [],
        locked_until: null, lease_owner: null, steps: [], api_cost_usd_micros: null, cost_unknown: 0,
      };
      runs.push(row);
      return { data: { id: row.id, created: true, status: "queued" }, error: null };
    }
    case "ai_engine_run_claim": {
      const r = runs.find((x) => x.id === a.p_run_id);
      if (!r) return { data: { claimed: false, reason: "not_found" }, error: null };
      if (!["queued", "running"].includes(r.status as string)) return { data: { claimed: false, reason: "finished", status: r.status }, error: null };
      if (!leaseOk(r) && r.lease_owner !== a.p_owner) return { data: { claimed: false, reason: "busy", status: r.status }, error: null };
      r.lease_owner = a.p_owner; r.locked_until = now() + Number(a.p_lease_seconds) * 1000;
      if (r.status === "queued") r.status = "running";
      return { data: { claimed: true, status: r.status }, error: null };
    }
    case "ai_engine_run_patch": {
      const r = runs.find((x) => x.id === a.p_run_id);
      const p = a.p_patch as Row;
      if (!r || !["queued", "running"].includes(r.status as string) || r.lease_owner !== a.p_owner) return { data: false, error: null };
      for (const k of ["status", "error", "outputs", "progress", "steps", "api_cost_usd_micros", "cost_unknown", "model_label", "duration_ms", "knowledge_example_ids"]) {
        if (k in p) r[k] = p[k];
      }
      if (["ok", "partial", "failed", "blocked"].includes(p.status as string)) { r.locked_until = null; r.finished_at = new Date().toISOString(); }
      else if ("lease_seconds" in p) r.locked_until = now() + Number(p.lease_seconds) * 1000;
      return { data: true, error: null };
    }
    case "ai_engine_step_begin": {
      const r = runs.find((x) => x.id === a.p_run_id);
      if (!r || !["queued", "running"].includes(r.status as string) || r.lease_owner !== a.p_owner) return { data: { state: "not_owner" }, error: null };
      let s = steps.find((x) => x.run_id === a.p_run_id && x.position === a.p_position && x.item_index === a.p_item);
      if (!s) { s = { run_id: a.p_run_id, position: a.p_position, item_index: a.p_item, step_name: a.p_name, operation: a.p_operation, status: "pending", attempts: 0, cost_basis: "unknown", cost_usd_micros: null }; steps.push(s); }
      if (s.status === "succeeded") return { data: { state: "done", output: s.output, provider: s.provider_slug, model: s.model }, error: null };
      if (s.status === "failed" || s.status === "skipped") return { data: { state: s.status, error: s.error_code }, error: null };
      if (s.status === "running" && (s.locked_until as number) > now()) return { data: { state: "busy" }, error: null };
      s.status = "running"; s.locked_until = now() + Number(a.p_lease_seconds) * 1000;
      return { data: { state: "run", attempts: s.attempts }, error: null };
    }
    case "ai_engine_step_finish": {
      const r = runs.find((x) => x.id === a.p_run_id);
      if (!r || r.lease_owner !== a.p_owner) return { data: false, error: null };
      const s = steps.find((x) => x.run_id === a.p_run_id && x.position === a.p_position && x.item_index === a.p_item);
      if (!s || s.status === "succeeded") return { data: false, error: null };
      const res = a.p_result as Row;
      Object.assign(s, {
        status: res.status, attempts: res.attempts, provider_slug: res.provider_slug, model: res.model,
        input_tokens: res.input_tokens, output_tokens: res.output_tokens, units: res.units, unit_kind: res.unit_kind,
        cost_basis: res.cost_usd_micros == null ? "unknown" : res.cost_basis, cost_usd_micros: res.cost_usd_micros ?? null,
        error_code: res.status === "failed" ? res.error_code : null, output: res.status === "succeeded" ? res.output : null,
        duration_ms: res.duration_ms, locked_until: null,
      });
      return { data: true, error: null };
    }
    case "ai_engine_run_read": return { data: runs.filter((x) => x.id === a.p_run_id), error: null };
    case "ai_engine_step_runs_read": return { data: steps.filter((x) => x.run_id === a.p_run_id), error: null };
    case "ai_engine_run_status": {
      const r = runs.find((x) => x.id === a.p_run_id && x.user_id === USER && x.run_kind === "workflow");
      return { data: r ? { id: r.id, status: r.status, progress: r.progress, outputs: r.outputs, error: r.error, job_id: r.job_id, tool_key: r.tool_key, credits: r.credits } : null, error: null };
    }
    /* ── ledger ── */
    case "usage_event_start": {
      const key = a.p_idempotency_key as string | null;
      if (key && db.events.some((e) => e.idempotency_key === key)) return { data: [{ status: "duplicate_request", event_id: null }], error: null };
      const credits = Number(a.p_credits ?? 0);
      if (db.wallet.balance < credits) return { data: [{ status: "insufficient_credits", event_id: null }], error: null };
      db.wallet.balance -= credits;
      const ev = { id: uuid(), status: "pending", credits_charged: credits, refunded: 0, idempotency_key: key, provider_slug: a.p_provider_slug ?? null, model_slug: a.p_model_slug ?? null, metadata: a.p_metadata, generation_job_id: a.p_generation_job_id, actual_api_cost_usd_micros: 0, result_count: 0 };
      db.events.push(ev);
      return { data: [{ status: "ok", event_id: ev.id }], error: null };
    }
    case "usage_event_complete": {
      const ev = db.events.find((e) => e.id === a.p_event_id && e.status === "pending");
      if (!ev) return { data: null, error: null };
      ev.status = "succeeded"; ev.result_count = a.p_result_count; ev.actual_api_cost_usd_micros = a.p_api_cost_usd_micros;
      if ("p_provider_slug" in a) {
        const meta = { ...(ev.metadata as Row) };
        if (ev.provider_slug !== a.p_provider_slug || ev.model_slug !== a.p_model_slug) { meta.requested_provider = ev.provider_slug; meta.requested_model = ev.model_slug; }
        if (a.p_provider_slug == null) meta.executor_unknown = true;
        ev.metadata = meta; ev.provider_slug = a.p_provider_slug; ev.model_slug = a.p_model_slug;
      }
      ev.idempotency_key = null;
      return { data: null, error: null };
    }
    case "usage_event_fail": {
      const ev = db.events.find((e) => e.id === a.p_event_id && e.status === "pending");
      if (!ev) return { data: null, error: null };
      db.wallet.balance += (ev.credits_charged as number) - (ev.refunded as number);
      ev.status = "refunded"; ev.idempotency_key = null;
      return { data: null, error: null };
    }
    case "usage_event_refund_partial": {
      const ev = db.events.find((e) => e.id === a.p_event_id && e.status === "pending" && e.refunded === 0);
      if (!ev) return { data: null, error: null };
      ev.refunded = a.p_amount; db.wallet.balance += Number(a.p_amount);
      return { data: "tx-1", error: null };
    }
    case "ai_provider_call_record": { db.providerCalls.push(...(a.p_calls as Row[])); return { data: (a.p_calls as Row[]).length, error: null }; }
    case "ai_token_prices_read": return { data: db.tokenPrices, error: null };
    case "ai_unit_prices_read": return { data: db.unitPrices, error: null };
    default: return { data: null, error: null };
  }
}

function client(db: Db): Client {
  return {
    from: (t: string) => query(db, t),
    rpc: async (name: string, args: Record<string, unknown>) => rpc(db, name, args ?? {}),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, bytes: Buffer) => { db.storage.set(`${bucket}/${path}`, Buffer.from(bytes)); return { error: null }; },
        download: async (path: string) => {
          const b = db.storage.get(`${bucket}/${path}`);
          return b ? { data: new Blob([new Uint8Array(b)]), error: null } : { data: null, error: { message: "missing" } };
        },
        createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}` })), error: null }),
      }),
    },
  } as unknown as Client;
}

/* ── fixtures ─────────────────────────────────────────────────────────────*/

const step = (op: WorkflowStepDef["operation"], out: string, patch: Partial<WorkflowStepDef> = {}): WorkflowStepDef =>
  ({ ...blankStep(op, out, `${op}-${out}`), maxAttempts: 1, ...patch });

function publish(db: Db, steps: WorkflowStepDef[], version = 1, concurrency = 3): string {
  const v = validateWorkflow("retouch", { steps, concurrency });
  if (!v.ok) throw new Error(`fixture invalid: ${JSON.stringify(v)}`);
  for (const w of db.workflows) if (w.status === "published") w.status = "superseded";
  const id = uuid();
  db.workflows.push({ id, tool_key: "retouch", version, status: "published", max_outputs: v.maxOutputs, concurrency, steps });
  return id;
}

function setup() {
  resetGeneration();
  visionCalls.length = 0; visionControl.fail = []; visionControl.handler = () => ({ output: "OUT" });
  fakeModels.clear();
  fakeModels.set("m-main", { providerSlug: "google", identifier: "gemini-3-pro-image-preview", costMicros: 40_000 });
  fakeModels.set("m-back", { providerSlug: "openai", identifier: "gpt-image-1", costMicros: 60_000 });
  const db = newDb();
  db.storage.set(`product-images/${WS}/in/photo.jpg`, Buffer.from("CUSTOMER_PHOTO"));
  db.tokenPrices = [{ provider_slug: "openai", model: "gpt-5", input_usd_micros_per_mtok: 1_000_000, output_usd_micros_per_mtok: 2_000_000, cached_input_usd_micros_per_mtok: null }];
  return db;
}

async function start(db: Db, over: { hint?: string; test?: boolean } = {}) {
  const wf = await loadWorkflow(client(db), "retouch", null);
  if (!wf) throw new Error("no workflow");
  return startWorkflowRun(client(db), USER, WS, {
    toolKey: "retouch", workflow: wf, hint: over.hint ?? "", referencePaths: [`${WS}/in/photo.jpg`],
    aspectRatio: "1:1", resolution: "1K", quality: null, toolModelId: "m-main", toolFallbackId: null,
    unitCredits: 10, operation: "image_retouch", knowledgeStrategy: "proven", test: over.test,
  });
}
const drive = (db: Db, runId: string, ms = 250_000) => driveWorkflowRun(client(db), runId, { deadlineAt: Date.now() + ms });
const runOf = (db: Db, id: string) => db.tables.ai_engine_runs.find((r) => r.id === id)!;
const stepsOf = (db: Db, id: string) => db.tables.ai_engine_step_runs.filter((r) => r.run_id === id);

/* ── tests ────────────────────────────────────────────────────────────────*/

async function main() {
  console.log("WF1 — Workflow OFF is exactly the old path");
  {
    const db = setup();
    db.tool = { workflow_enabled: false, engine_mode: "grovbase", prompt: "PUBLISHED PROMPT" };
    publish(db, [step("image_edit", "wynik", { prompt: "WF PROMPT" })]);
    const r = await runEngineImageTool(client(db), USER, WS, {
      toolKey: "retouch", builtInPrompt: "BUILT-IN", hint: "", referencePaths: [`${WS}/in/photo.jpg`],
      generation: { modelId: "m-main", aspectRatio: "1:1", resolution: "1K", quantity: 1, referenceImageIds: [] }, expectedCost: 10,
    });
    check("WF1 OFF: one runGeneration call with the published prompt, no run, no workflow read",
      r.ok && !isPending(r) && generationCalls.length === 1 && generationCalls[0].prompt === "PUBLISHED PROMPT"
      && db.tables.ai_engine_runs.length === 0 && !db.rpc.includes("ai_tool_workflow_read"));
    db.tool.workflow_enabled = true;
    const r2 = await runEngineImageTool(client(db), USER, WS, {
      toolKey: "retouch", builtInPrompt: "BUILT-IN", hint: "", referencePaths: [`${WS}/in/photo.jpg`],
      generation: { modelId: "m-main", aspectRatio: "1:1", resolution: "1K", quantity: 1, referenceImageIds: [] }, expectedCost: 10,
    });
    check("WF1 ON: the run is started (pending), charged once, and runGeneration is NOT called",
      r2.ok && isPending(r2) && generationCalls.length === 1 && db.events.length === 1, { r2, gen: generationCalls.length, ev: db.events.length });
  }

  console.log("WF2/WF3/WF16 — order, output → input, version on the run");
  {
    const db = setup();
    visionControl.handler = (req) => ({ output: req.system.startsWith("ANALIZA") ? "ANALIZA_WYNIK" : "OPIS_WYNIK" });
    publish(db, [
      step("image_edit", "clean_image", { prompt: "Oczyść tło" }),
      step("ai_text", "product_analysis", { inputImage: "clean_image", prompt: "ANALIZA produktu" }),
      step("image_generation", "final", { inputImage: "clean_image", prompt: "Scena na podstawie {{product_analysis}}" }),
    ], 7);
    const s = await start(db);
    check("start ok", s.ok, s);
    if (!s.ok) return;
    const out = await drive(db, s.runId);
    const run = runOf(db, s.runId);
    check("WF2 steps ran in order: image edit → text → image generation",
      out === "ok" && imageCalls.length === 2 && visionCalls.length === 1
      && imageCalls[0].prompt.startsWith("Oczyść tło") && imageCalls[1].at >= imageCalls[0].at, { out, calls: imageCalls.map((c) => c.prompt.slice(0, 20)) });
    const step1Img = stepsOf(db, s.runId).find((x) => x.position === 1)!.output as { image: { path: string } };
    const stored = db.storage.get(`generation-assets/${step1Img.image.path}`)!;
    check("WF3 step 2 received step 1's IMAGE as its input", visionCalls[0].images[0]?.base64 === stored.toString("base64"));
    check("WF3 step 3 received step 1's image AND step 2's text (fenced as DATA)",
      imageCalls[1].refs[0]?.base64 === stored.toString("base64") && imageCalls[1].prompt.includes("ANALIZA_WYNIK") && imageCalls[1].prompt.includes("DANE_KLIENTA"));
    check("WF16 the workflow version is saved on the run", run.workflow_version === 7);
    check("every text step carries the Product Lock rules as its system policy", visionCalls.every((v) => v.system.includes("PRODUCT LOCK")));
    check("…and the customer gets one result as a generation asset of the job",
      db.tables.generation_assets.length === 1 && (run.outputs as unknown[]).length === 1);
  }

  console.log("WF4 — a missing required input stops BEFORE the next provider call");
  {
    const db = setup();
    visionControl.fail = ["analysis_bad_request"];
    publish(db, [
      step("ai_text", "notes", { prompt: "Notatki", onError: "continue" }),
      step("image_edit", "final", { prompt: "Edytuj wg {{notes}}" }),
    ]);
    const s = await start(db);
    if (!s.ok) { check("start", false, s); return; }
    const before = db.wallet.balance;
    const out = await drive(db, s.runId);
    const st2 = stepsOf(db, s.runId).find((x) => x.position === 2);
    check("WF4 the image step never called a provider", imageCalls.length === 0);
    check("WF4 it failed with variable_missing, and the run failed", st2?.error_code === "variable_missing" && out === "failed", { st2, out });
    check("WF4 …and the customer's credits came back in full", db.wallet.balance === before + 10 && db.events[0].status === "refunded");
  }

  console.log("WF5 — step 2 fails → step 3 never starts");
  {
    const db = setup();
    modelScript.set("m-main", ["ok", "invalid"]);
    publish(db, [
      step("image_edit", "a", { prompt: "A" }), step("image_edit", "b", { inputImage: "a", prompt: "B" }),
      step("image_edit", "c", { inputImage: "b", prompt: "C" }),
    ]);
    const s = await start(db);
    if (!s.ok) return;
    const out = await drive(db, s.runId);
    check("WF5 two provider calls, the third step never started", imageCalls.length === 2 && !stepsOf(db, s.runId).some((x) => x.position === 3), imageCalls.length);
    check("WF5 run failed, full refund", out === "failed" && db.events[0].status === "refunded");
    check("retry policy: an invalid request is NOT retried (1 call on step 2)", imageCalls.filter((c) => c.prompt.startsWith("B")).length === 1);
  }

  console.log("WF6/WF7 — retry never charges twice, never duplicates the ledger");
  {
    const db = setup();
    modelScript.set("m-main", ["rate_limited", "ok"]);
    publish(db, [step("image_edit", "final", { prompt: "X", maxAttempts: 3 })]);
    const s = await start(db);
    if (!s.ok) return;
    const afterCharge = db.wallet.balance;
    const out = await drive(db, s.runId, 600_000);
    check("WF6 the 429 was retried and the run succeeded", out === "ok" && imageCalls.length === 2, { out, n: imageCalls.length });
    check("WF6 exactly one charge (no second debit on retry)", db.events.length === 1 && db.wallet.balance === afterCharge && db.events[0].credits_charged === 10);
    const again = await drive(db, s.runId);
    check("WF7 driving a finished run again changes nothing (no call, no event)", again === "ok" && imageCalls.length === 2 && db.events.length === 1);
    check("WF7 the event is completed exactly once with the delivered count", db.events[0].status === "succeeded" && db.events[0].result_count === 1);
    check("the provider trace has both requests (failed + succeeded), linked to the ONE event and the run",
      db.providerCalls.length === 2 && db.providerCalls.every((c) => c.usage_event_id === db.events[0].id && c.run_ref === s.runId));
  }
  {
    const db = setup();
    publish(db, [step("image_edit", "final", { prompt: "X" })]);
    const a = await start(db);
    const b = await start(db);
    check("double click while pending → second is already_running, one charge", a.ok && !b.ok && b.error === "already_running" && db.events.length === 1, b);
  }

  console.log("WF8/WF9/WF17 — fan-out: exactly N children, partial marked, parallel without races");
  {
    const db = setup();
    visionControl.handler = () => ({ items: ["scena 1", "scena 2", "scena 3", "scena 4", "scena 5"] });
    modelScript.set("m-main", ["ok", "ok", "invalid", "ok", "ok"]);
    publish(db, [
      step("ai_text", "scene_prompts", { outputKind: "list", maxItems: 5, prompt: "Zaproponuj sceny" }),
      step("image_generation", "scenes", { forEach: "scene_prompts", itemName: "scene_prompt", maxItems: 5, prompt: "Scena: {{scene_prompt}}" }),
    ], 1, 5);
    const s = await start(db);
    if (!s.ok) return;
    check("the customer is charged for 5 results up front", db.events[0].credits_charged === 50 && s.expected === 5);
    const [d1, d2] = await Promise.all([drive(db, s.runId), drive(db, s.runId)]);
    const kids = stepsOf(db, s.runId).filter((x) => x.position === 2);
    check("WF17 a second concurrent driver gets 'busy' and does nothing", [d1, d2].includes("busy"), [d1, d2]);
    check("WF8 exactly 5 child executions (items 0..4), 5 provider calls", kids.length === 5 && imageCalls.length === 5
      && JSON.stringify(kids.map((k) => k.item_index).sort()) === "[0,1,2,3,4]");
    const overlap = imageCalls.some((c, i) => imageCalls.some((o, j) => j !== i && Math.abs(o.at - c.at) < 10));
    check("WF17 children really ran in parallel", overlap);
    check("each child got its own item", new Set(imageCalls.map((c) => c.prompt.match(/scena \d/)?.[0])).size === 5);
    const run = runOf(db, s.runId);
    check("WF9 the failed item is marked, the run is PARTIAL with 4 results",
      run.status === "partial" && kids.filter((k) => k.status === "failed").length === 1 && (run.outputs as unknown[]).length === 4);
    check("WF9 the undelivered result is refunded (1 × 10), the rest completed",
      db.events[0].refunded === 10 && db.events[0].status === "succeeded" && db.events[0].result_count === 4);
  }

  console.log("WF10 — the executor that REALLY answered is recorded");
  {
    const db = setup();
    modelScript.set("m-main", ["quota"]);
    publish(db, [step("image_edit", "final", { prompt: "X", modelId: "m-main", fallbackModelId: "m-back" })]);
    const s = await start(db);
    if (!s.ok) return;
    await drive(db, s.runId);
    const st = stepsOf(db, s.runId)[0];
    check("WF10 the step records the FALLBACK's provider/model", st.provider_slug === "openai" && st.model === "gpt-image-1", st);
    const ev = db.events[0];
    check("WF10 the ledger names the real executor; nothing requested was invented",
      ev.provider_slug === "openai" && ev.model_slug === "gpt-image-1" && (ev.metadata as Row).requested_provider === null);
    check("WF10 the asset carries the executor too", (db.tables.generation_assets[0].metadata as Row).provider === "openai");
  }

  console.log("WF11 — run cost = sum of the real step costs; unpriced stays UNKNOWN");
  {
    const db = setup();
    visionControl.handler = () => ({ output: "T" });
    publish(db, [
      step("ai_text", "t", { prompt: "T" }),
      step("image_edit", "final", { prompt: "X {{t}}" }),
    ]);
    const s = await start(db);
    if (!s.ok) return;
    await drive(db, s.runId);
    const st = stepsOf(db, s.runId);
    const sum = st.reduce((a, x) => a + Number(x.cost_usd_micros ?? 0), 0);
    const run = runOf(db, s.runId);
    check("WF11 text step priced from tokens (1000 in, 200 out)", st[0].cost_usd_micros === 1000 + 400, st[0].cost_usd_micros);
    check("WF11 image step priced from the model's per-image cost", st[1].cost_usd_micros === 40_000);
    check("WF11 run total = sum of steps; the ledger gets the same number",
      run.api_cost_usd_micros === sum && db.events[0].actual_api_cost_usd_micros === sum && run.cost_unknown === 0);
    // Unpriced: a model without a cost and no unit price.
    const db2 = setup();
    fakeModels.set("m-main", { providerSlug: "google", identifier: "gemini-x", costMicros: null });
    publish(db2, [step("image_edit", "final", { prompt: "X" })]);
    const s2 = await start(db2);
    if (!s2.ok) return;
    await drive(db2, s2.runId);
    const st2 = stepsOf(db2, s2.runId)[0];
    check("WF11 an unpriced image stays UNKNOWN (never 0.00) and the run says so",
      st2.cost_basis === "unknown" && st2.cost_usd_micros === null && runOf(db2, s2.runId).cost_unknown === 1);
    db2.unitPrices = [{ provider_slug: "google", model: "gemini-x", unit_kind: "image", resolution: "*", quality: "*", usd_micros_per_unit: 134_000 }];
    publish(db2, [step("image_edit", "final", { prompt: "Y" })], 2);
    const s3 = await start(db2);
    if (!s3.ok) return;
    await drive(db2, s3.runId);
    check("…and a unit price makes it known", stepsOf(db2, s3.runId)[0].cost_usd_micros === 134_000);
  }

  console.log("WF12/WF13 — a draft changes nothing; publish switches; a run stays pinned");
  {
    const db = setup();
    publish(db, [step("image_edit", "final", { prompt: "WERSJA 1" })], 1);
    db.workflows.push({ id: uuid(), tool_key: "retouch", version: 2, status: "draft", max_outputs: 1, concurrency: 3, steps: [step("image_edit", "final", { prompt: "SZKIC 2" })] });
    const s = await start(db);
    if (!s.ok) return;
    // publish v3 while the run is queued
    publish(db, [step("image_edit", "final", { prompt: "WERSJA 3" })], 3);
    await drive(db, s.runId);
    check("WF12 a draft never reached production, and a publish mid-run did not change the run",
      imageCalls.length === 1 && imageCalls[0].prompt.startsWith("WERSJA 1"), imageCalls.map((c) => c.prompt.slice(0, 10)));
    const s2 = await start(db, { hint: "inny" });
    if (!s2.ok) return;
    await drive(db, s2.runId);
    check("WF13 after publishing, a new run uses the new version", imageCalls[1]?.prompt.startsWith("WERSJA 3") && runOf(db, s2.runId).workflow_version === 3);
    check("WF14 rollback = a NEW published copy of an old version (SQL: ai_restore_tool_workflow, proven in workflow-v2-sql-tests)",
      /insert into public\.ai_tool_workflows[\s\S]*'published'[\s\S]*from public\.ai_tool_workflow_steps where workflow_id = v_src\.id/.test(read("supabase/migrations/0129_workflow_engine_v2.sql")));
  }

  console.log("Resume — an invocation that runs out of time continues in the next one");
  {
    const db = setup();
    publish(db, [step("image_edit", "a", { prompt: "A" }), step("image_edit", "final", { inputImage: "a", prompt: "B" })]);
    const s = await start(db);
    if (!s.ok) return;
    const first = await drive(db, s.runId, 20_000); // less than the start threshold
    check("with no time left the run yields (still running) and calls nothing", first === "running" && imageCalls.length === 0, first);
    runOf(db, s.runId).locked_until = null; // the lease expired
    const second = await drive(db, s.runId);
    check("the next invocation finishes it", second === "ok" && imageCalls.length === 2);
    runOf(db, s.runId).status = "running"; runOf(db, s.runId).locked_until = null;
    const n = imageCalls.length;
    await drive(db, s.runId);
    check("a succeeded step is never executed (or paid) twice on resume", imageCalls.length === n);
    runOf(db, s.runId).status = "ok";
  }

  console.log("Retry classes");
  {
    for (const [code, flag, want] of [
      ["provider_rate_limited", true, true], ["provider_timeout", true, true], ["provider_error", true, true],
      ["analysis_overloaded", true, true], ["output_invalid", undefined, true],
      ["provider_invalid_request", false, false], ["content_policy", false, false], ["provider_auth_failed", false, false],
      ["provider_quota", false, false], ["insufficient_credits", undefined, false], ["variable_missing", undefined, false],
      ["analysis_bad_request", false, false], ["analysis_unavailable", true, false],
    ] as const) {
      check(`${code} → ${want ? "retried" : "not retried"}`, isRetriable(code, flag) === want);
    }
  }

  console.log("WF15 / §26 — the prompt never leaks to the customer");
  {
    const db = setup();
    visionControl.handler = () => ({ items: ["s1", "s2"] });
    publish(db, [
      step("ai_text", "scene_prompts", { outputKind: "list", maxItems: 2, prompt: `${PROBE} lista scen` }),
      step("image_generation", "scenes", { forEach: "scene_prompts", itemName: "scene_prompt", maxItems: 2, prompt: `${PROBE} {{scene_prompt}}` }),
    ]);
    db.tool.workflow_enabled = true;
    const pending = await runEngineImageTool(client(db), USER, WS, {
      toolKey: "retouch", builtInPrompt: null, hint: "", referencePaths: [`${WS}/in/photo.jpg`],
      generation: { modelId: "m-main", aspectRatio: "1:1", resolution: "1K", quantity: 1, referenceImageIds: [], operation: "image_retouch" }, expectedCost: 10,
    });
    if (!isPending(pending)) { check("pending", false, pending); return; }
    await drive(db, pending.runId);
    const status = rpc(db, "ai_engine_run_status", { p_run_id: pending.runId }).data;
    const customerVisible = JSON.stringify({
      pending, status, jobs: db.tables.generation_jobs, assets: db.tables.generation_assets,
      notifications: db.tables.notifications, events: db.events,
    });
    check("WF15 zero probe hits in the start response, status RPC, job, assets, notifications, ledger", !customerVisible.includes(PROBE));
    check("…the admin trace and the provider trace carry no prompt either",
      !JSON.stringify(db.tables.ai_engine_runs).includes(PROBE) && !JSON.stringify(db.providerCalls).includes(PROBE));
    check("…while the provider really received it (the probe is not vacuous)", imageCalls.some((c) => c.prompt.includes(PROBE)));
    check("the status RPC exposes no step, model or output text", status !== null && !("steps" in (status as Row)) && !JSON.stringify(status).includes("gemini"));
    check("another user cannot read the run's status", (() => {
      const r = db.tables.ai_engine_runs.find((x) => x.id === pending.runId)!; r.user_id = "someone-else";
      const s = rpc(db, "ai_engine_run_status", { p_run_id: pending.runId }).data; r.user_id = USER; return s === null;
    })());
  }

  console.log("Admin test run");
  {
    const db = setup();
    publish(db, [step("image_edit", "final", { prompt: "X" })]);
    const s = await start(db, { test: true });
    if (!s.ok) return;
    await drive(db, s.runId);
    check("a test run charges nothing, creates no job, and traces as workflow_test",
      db.events.length === 0 && db.tables.generation_jobs.length === 0 && db.providerCalls.every((c) => c.consumer === "workflow_test")
      && runOf(db, s.runId).status === "ok");
  }

  console.log("Guards in the code");
  {
    const def = read("lib/ai/workflow-def.ts");
    check("no forward references: only EARLIER outputs are variables", /steps\.slice\(0, index\)/.test(def));
    check("a tool step runs the tool's single call, never a workflow (no recursion)",
      !/runEngineImageTool|startWorkflowRun|driveWorkflowRun/.test(read("lib/server/engine/workflow-exec.ts")));
    check("the customer route reads no workflow, step, model or prompt field",
      !/body\.(workflow|steps|modelId|prompt|system|enginePrompt)/.test(read("app/api/retouch/route.ts") + read("app/api/fashion/route.ts") + read("app/api/engine/runs/[id]/route.ts")));
    check("the status route answers from the customer-scoped RPC only", /ai_engine_run_status/.test(read("app/api/engine/runs/[id]/route.ts"))
      && !/from\("ai_engine_(step_)?runs"\)/.test(read("app/api/engine/runs/[id]/route.ts")));
    check("no artificial step/scene limits in the builder (MAX_STEPS 50, MAX_ITEMS 50)",
      /MAX_STEPS = 50/.test(def) && /MAX_ITEMS = 50/.test(def));
  }

  console.log(failed === 0 ? "\nAll workflow v2 runtime tests passed." : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

void main().catch((e) => { console.error(e); process.exit(1); });
