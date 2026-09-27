/**
 * PROMPT STORAGE — Vault-held prompt key (migration 0130), end to end.
 *
 * The REAL admin actions (save draft, publish, restore, read), the REAL runtime
 * (resolveEngine / resolveSystemPrompt, runEngineImageTool, the generator's
 * hybrid path, the workflow loader) run against an in-memory Supabase that
 * models what matters here: RLS on ai_tool_prompts (admin only), the 0071
 * version functions, the proof-of-server token gate and the Vault-held key.
 * The only billed call, runGeneration, is replaced at bundle time and records
 * the exact prompt that would reach the provider.
 *
 * Production has NO APP_ENCRYPTION_KEY, so this suite runs without one unless
 * a case sets it on purpose (the legacy rows). The SQL half — the real
 * get-or-create under concurrency, grants, RLS, the reserved vault namespace —
 * is scripts/prompt-vault-sql-tests.sh on a real Postgres.
 *
 * Run: npm run test:promptvault
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { encryptWith } from "@/lib/server/crypto";
import { dispatchToken, promptKeyToken } from "@/lib/server/server-token";
import { resetPromptKeyCache } from "@/lib/server/prompt-vault";
import { withKeyStates } from "@/lib/server/prompt-vault-admin";
import { resolveEngine, resolveSystemPrompt } from "@/lib/server/ai-engine";
import { loadWorkflow } from "@/lib/server/engine/workflow-store";
import { runEngineImageTool, prepareGeneratorEngine } from "@/lib/server/engine/tool-run";
import { compileForTool } from "@/lib/server/engine/runtime";
import { TOOL_VARIABLES, sampleValues } from "@/lib/ai/prompt-variables";
import { readPromptHistory } from "@/lib/services/ai-tools";
import {
  publishPromptVersionAction, readPromptBodyAction, restorePromptVersionAction, savePromptAction,
} from "@/app/actions/ai-tools";
import { compilePreviewAction, readWorkflowAction, saveWorkflowAction } from "@/app/actions/ai-engine";
import { generationCalls } from "./stubs/ai-engine-generation";
import type { Client } from "@/lib/services/workspace";

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${name}`);
  else { failed++; console.log(`  ✗ ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail).slice(0, 400)}`}`); }
};
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/* ── environment: exactly production's shape ─────────────────────────────*/
// A server key (proof of server) and NO encryption key in the environment.
process.env.GROVBASE_SERVER_KEY = "grovbase-test-server-key-0000000000000000";
delete process.env.APP_ENCRYPTION_KEY;
delete process.env.GROVBASE_INTEGRATIONS_ENCRYPTION_KEY;

/* ── in-memory Supabase ───────────────────────────────────────────────────*/

type Row = Record<string, unknown>;
const VAULT_NAME = "grovbase.prompts.master_key_v1";
const PIN_NAME = "grovbase.prompts.server_verifier_v1";
const ADMIN = "00000000-0000-4000-8000-00000000000a";
const CUSTOMER = "00000000-0000-4000-8000-00000000000c";

type Db = {
  user: string | null;
  tables: Record<string, Row[]>;
  vault: Map<string, string>;
  keyCalls: number;
  keyCreations: number;
  keyReturns: string[];
  rpcLog: { name: string; args: Row }[];
};

/** Tables whose rows only an admin may see or write (RLS, migrations 0070/0126/0107). */
const ADMIN_ONLY = new Set(["ai_tool_prompts", "ai_tool_workflows", "ai_tool_workflow_steps", "app_settings", "audit_logs"]);

function isAdmin(db: Db): boolean {
  return !!db.user && db.tables.profiles.some((p) => p.id === db.user && p.role === "admin");
}
function dispatchHash(db: Db): string | null {
  const row = db.tables.app_settings.find((r) => r.key === "notifications");
  return ((row?.value as Row | undefined)?.dispatch_hash as string | undefined) ?? null;
}
function tokenOk(db: Db, token: unknown): boolean {
  const h = dispatchHash(db);
  return !!h && typeof token === "string" && sha(token) === h;
}
const uuid = () => {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

function query(db: Db, table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let order: { col: string; asc: boolean } | null = null;
  let limit: number | null = null;
  let mode: "select" | "update" | "delete" = "select";
  let patch: Row = {};
  const visible = () => {
    if (ADMIN_ONLY.has(table) && !isAdmin(db)) return [] as Row[];
    return (db.tables[table] ??= []);
  };
  const rows = () => {
    let out = visible().filter((r) => filters.every((f) => f(r)));
    if (order) { const o = order; out = [...out].sort((a, b) => (a[o.col] as number) > (b[o.col] as number) ? (o.asc ? 1 : -1) : (o.asc ? -1 : 1)); }
    if (limit !== null) out = out.slice(0, limit);
    return out;
  };
  const run = () => {
    if (mode === "update") {
      if (ADMIN_ONLY.has(table) && !isAdmin(db)) return { data: null, error: { code: "42501", message: "rls" } };
      for (const r of rows()) Object.assign(r, patch);
      return { data: null, error: null };
    }
    if (mode === "delete") {
      if (ADMIN_ONLY.has(table) && !isAdmin(db)) return { data: null, error: { code: "42501", message: "rls" } };
      const kill = new Set(rows());
      db.tables[table] = (db.tables[table] ?? []).filter((r) => !kill.has(r));
      return { data: null, error: null };
    }
    return { data: rows().map((r) => ({ ...r })), error: null };
  };
  const self = {
    select: () => self,
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return self; },
    in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return self; },
    gte: () => self,
    order: (c: string, o?: { ascending?: boolean }) => { order = { col: c, asc: o?.ascending !== false }; return self; },
    limit: (n: number) => { limit = n; return self; },
    maybeSingle: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
    single: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    update: (p: Row) => { mode = "update"; patch = p; return self; },
    delete: () => { mode = "delete"; return self; },
    insert: (input: Row | Row[]) => {
      if (ADMIN_ONLY.has(table) && table !== "audit_logs" && !isAdmin(db)) {
        const err = { data: null, error: { code: "42501", message: "rls" } };
        return { select: () => ({ single: async () => err }), then: (res: (v: unknown) => unknown) => Promise.resolve(err).then(res) };
      }
      const list = (Array.isArray(input) ? input : [input]).map((r) => ({ id: uuid(), ...r }));
      (db.tables[table] ??= []).push(...list);
      const ok = { data: list, error: null };
      return { select: () => ({ single: async () => ({ data: list[0], error: null }) }), then: (res: (v: unknown) => unknown) => Promise.resolve(ok).then(res) };
    },
    upsert: async (r: Row) => {
      if (ADMIN_ONLY.has(table) && !isAdmin(db)) return { data: null, error: { code: "42501", message: "rls" } };
      const t = (db.tables[table] ??= []);
      const k = table === "app_settings" ? "key" : table === "ai_tools" ? "tool_key" : "id";
      const hit = t.find((x) => x[k] === r[k]);
      if (hit) Object.assign(hit, r); else t.push({ ...r });
      return { data: null, error: null };
    },
  };
  return self;
}

/** The 0071 prompt functions, the runtime read, the key door — the parts of
 *  the database this path talks to, with their authorisation. */
async function rpc(db: Db, name: string, a: Row): Promise<{ data: unknown; error: { message: string; code?: string } | null }> {
  db.rpcLog.push({ name, args: a });
  const prompts = db.tables.ai_tool_prompts;
  const nextVersion = (tool: string) => Math.max(0, ...prompts.filter((p) => p.tool_key === tool).map((p) => p.version as number)) + 1;
  switch (name) {
    case "prompt_master_key": {
      // Migration 0130: the key token is checked against the PIN; the
      // dispatch token only matters for the very first (pinning) call.
      db.keyCalls++;
      const forbidden = { data: null, error: { message: "forbidden", code: "P0001" } };
      const kt = a.p_key_token;
      if (typeof kt !== "string" || kt.length < 32) return forbidden;
      let pin = db.vault.get(PIN_NAME);
      if (!pin) {
        if (!tokenOk(db, a.p_token) || kt === a.p_token) return forbidden;
        pin = sha(kt); db.vault.set(PIN_NAME, pin);
      }
      if (pin !== sha(kt)) return forbidden;
      let key = db.vault.get(VAULT_NAME);
      if (!key) { key = randomBytes(32).toString("hex"); db.vault.set(VAULT_NAME, key); db.keyCreations++; }
      db.keyReturns.push(key);
      return { data: key, error: null };
    }
    case "ai_save_tool_prompt": {
      if (!isAdmin(db)) return { data: null, error: { message: "not_authorized" } };
      if (!db.tables.ai_tools.some((t) => t.tool_key === a.p_tool_key)) return { data: { ok: false, error: "unknown_tool" }, error: null };
      if (!String(a.p_body_encrypted ?? "").trim()) return { data: { ok: false, error: "empty_body" }, error: null };
      const version = nextVersion(a.p_tool_key as string);
      if (a.p_publish) for (const p of prompts) if (p.tool_key === a.p_tool_key && p.status === "published") p.status = "superseded";
      const id = uuid();
      prompts.push({
        id, tool_key: a.p_tool_key, version, status: a.p_publish ? "published" : "draft",
        body_encrypted: a.p_body_encrypted, body_iv: a.p_iv, body_tag: a.p_tag,
        summary: a.p_summary, reason: a.p_reason, source: a.p_source === "knowledge" ? "knowledge" : "manual",
        created_by: db.user, created_at: new Date().toISOString(), published_at: a.p_publish ? new Date().toISOString() : null,
      });
      return { data: { ok: true, id, version }, error: null };
    }
    case "ai_publish_tool_prompt": {
      if (!isAdmin(db)) return { data: null, error: { message: "not_authorized" } };
      const row = prompts.find((p) => p.id === a.p_id);
      if (!row) return { data: { ok: false, error: "not_found" }, error: null };
      if (row.status === "published") return { data: { ok: true, already: true }, error: null };
      for (const p of prompts) if (p.tool_key === row.tool_key && p.status === "published") p.status = "superseded";
      row.status = "published"; row.published_at = new Date().toISOString();
      if (a.p_reason) row.reason = a.p_reason;
      return { data: { ok: true, tool_key: row.tool_key }, error: null };
    }
    case "ai_restore_tool_prompt": {
      if (!isAdmin(db)) return { data: null, error: { message: "not_authorized" } };
      const src = prompts.find((p) => p.id === a.p_id);
      if (!src) return { data: { ok: false, error: "not_found" }, error: null };
      const version = nextVersion(src.tool_key as string);
      for (const p of prompts) if (p.tool_key === src.tool_key && p.status === "published") p.status = "superseded";
      prompts.push({ ...src, id: uuid(), version, status: "published", reason: a.p_reason ?? `restore v${src.version}`,
        created_by: db.user, published_at: new Date().toISOString() });
      return { data: { ok: true, version, from_version: src.version, tool_key: src.tool_key }, error: null };
    }
    case "ai_tool_runtime": {
      // Token-gated; an empty set, never an error, for a wrong token (0129).
      if (!tokenOk(db, a.p_token)) return { data: [], error: null };
      const tool = db.tables.ai_tools.find((t) => t.tool_key === a.p_tool_key);
      if (!tool) return { data: [], error: null };
      const p = prompts.find((x) => x.tool_key === a.p_tool_key && x.status === "published");
      return { data: [{
        tool_key: tool.tool_key, engine_mode: tool.engine_mode, service_slug: null, allow_model_choice: false,
        fallback_enabled: false, timeout_ms: 120000, max_attempts: 1, primary_model_id: null, fallback_model_id: null,
        prompt_encrypted: p?.body_encrypted ?? null, prompt_iv: p?.body_iv ?? null, prompt_tag: p?.body_tag ?? null,
        prompt_version: p?.version ?? null, knowledge_strategy: "proven", workflow_enabled: tool.workflow_enabled === true,
      }], error: null };
    }
    case "ai_save_tool_workflow": {
      if (!isAdmin(db)) return { data: null, error: { message: "not_authorized" } };
      const id = uuid();
      const version = Math.max(0, ...db.tables.ai_tool_workflows.filter((w) => w.tool_key === a.p_tool_key).map((w) => w.version as number)) + 1;
      if (a.p_publish) for (const w of db.tables.ai_tool_workflows) if (w.tool_key === a.p_tool_key && w.status === "published") w.status = "superseded";
      db.tables.ai_tool_workflows.push({ id, tool_key: a.p_tool_key, version, status: a.p_publish ? "published" : "draft", summary: a.p_summary, concurrency: a.p_concurrency, max_outputs: 1 });
      (a.p_steps as Row[]).forEach((s, i) => db.tables.ai_tool_workflow_steps.push({ id: uuid(), workflow_id: id, position: i + 1, condition: "always", ...s }));
      return { data: { ok: true, id, version }, error: null };
    }
    case "ai_tool_workflow_read": {
      if (!tokenOk(db, a.p_token)) return { data: [], error: null };
      const wf = db.tables.ai_tool_workflows.find((w) => w.tool_key === a.p_tool_key
        && (a.p_workflow_id ? w.id === a.p_workflow_id : w.status === "published"));
      if (!wf) return { data: [], error: null };
      const steps = db.tables.ai_tool_workflow_steps.filter((s) => s.workflow_id === wf.id);
      return { data: steps.map((s) => ({ workflow_id: wf.id, version: wf.version, status: wf.status, max_outputs: 1, concurrency: 3, ...s })), error: null };
    }
    case "ai_engine_run_record": db.tables.ai_engine_runs.push(a.p_run as Row); return { data: "run", error: null };
    case "knowledge_candidates": case "engine_rules_read": return { data: [], error: null };
    case "provider_credential_read": return { data: [], error: null };
    case "log_activity": return { data: null, error: null };
    default: return { data: null, error: { message: "unknown_rpc", code: "PGRST202" } };
  }
}

function makeDb(): Db {
  const db: Db = {
    user: ADMIN,
    tables: {
      profiles: [{ id: ADMIN, role: "admin", full_name: "Admin", email: "a@x" }, { id: CUSTOMER, role: "user", full_name: "K", email: "k@x" }],
      ai_tools: ["retouch", "generator", "prompts", "fashion_flat_lay"].map((k) => ({
        tool_key: k, engine_mode: k === "generator" ? "hybrid" : "grovbase", workflow_enabled: false,
      })),
      ai_tool_prompts: [], ai_tool_workflows: [], ai_tool_workflow_steps: [],
      // The dispatch hash the server published (ensureDispatchHash).
      app_settings: [{ key: "notifications", value: { dispatch_hash: sha(dispatchToken() ?? "") } }],
      audit_logs: [], ai_engine_runs: [], credit_wallets: [{ workspace_id: "ws-1", balance: 100 }],
    },
    vault: new Map(),
    keyCalls: 0, keyCreations: 0, keyReturns: [], rpcLog: [],
  };
  return db;
}

function client(db: Db): Client {
  return {
    auth: { getUser: async () => ({ data: { user: db.user ? { id: db.user } : null }, error: null }) },
    from: (t: string) => query(db, t),
    rpc: (n: string, a: Row) => rpc(db, n, a ?? {}),
    storage: { from: () => ({ download: async () => ({ data: null, error: { message: "none" } }), list: async () => ({ data: [] }) }) },
  } as unknown as Client;
}

function install(db: Db): Client {
  const c = client(db);
  (globalThis as unknown as { __apiFakeDb: unknown }).__apiFakeDb = c;
  return c;
}

/** Everything written to the console during a block — where a leaked prompt,
 *  key or ciphertext would show up in a server log. */
async function captureLogs<T>(fn: () => Promise<T>): Promise<{ value: T; logs: string }> {
  const out: string[] = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  const grab = (...args: unknown[]) => { out.push(args.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" ")); };
  console.log = grab; console.error = grab; console.warn = grab; console.info = grab;
  try { return { value: await fn(), logs: out.join("\n") }; }
  finally { Object.assign(console, orig); }
}

const genInput = { modelId: "m-1", aspectRatio: "1:1" as const, resolution: "2K" as const, quantity: 1, referenceImageIds: [],
  promptOrigin: "ecomstudio" as const, costOverride: 7, operation: "fashion_flat_lay" };

async function main() {
  const MARKER = "GROVBASE_PROMPT_SECRET_PROBE_40417";

  console.log("0. no environment key at all — the production condition");
  check("APP_ENCRYPTION_KEY is not set", !process.env.APP_ENCRYPTION_KEY);
  check("the server token exists (GROVBASE_SERVER_KEY only)", typeof dispatchToken() === "string");

  console.log("\n1. SAVE DRAFT → refresh → the text is still there");
  let db = makeDb(); let supa = install(db); resetPromptKeyCache();
  const T1 = "TEST GROVBASE {{product_description}} {{user_prompt}}";
  const saved = await savePromptAction({ toolKey: "generator", body: T1, summary: null, reason: null, publish: false });
  check("T1 save draft succeeds with no env key", saved.ok === true && saved.version === 1, saved);
  check("T1 the Vault key was created once, by the server", db.keyCreations === 1 && db.vault.has(VAULT_NAME));
  resetPromptKeyCache(); // a "refresh": another server instance, nothing cached
  const history = await readPromptHistory(supa, "generator");
  check("T1 after refresh the draft is in the history", history.length === 1 && history[0].status === "draft" && history[0].version === 1);
  const reread = await readPromptBodyAction(history[0].id);
  check("T1 after refresh the body reads back 1:1", reread.ok && reread.body === T1 && reread.legacy === false, reread);

  console.log("\n2. PUBLISH (opis: Retusz 1.0 · powód: Test systemu promptów)");
  const pub = await savePromptAction({ toolKey: "generator", body: T1, summary: "Retusz 1.0", reason: "Test systemu promptów", publish: true });
  check("T2 publish succeeds", pub.ok === true && pub.version === 2, pub);
  const draftPub = await publishPromptVersionAction(history[0].id, "Test systemu promptów");
  check("T2 publishing the stored draft from the history works too", draftPub.ok === true && draftPub.version === 1, draftPub);
  const rows = db.tables.ai_tool_prompts.filter((p) => p.tool_key === "generator");
  check("T2 exactly one published version, the rest superseded", rows.filter((r) => r.status === "published").length === 1
    && rows.find((r) => r.version === 1)?.status === "published" && rows.find((r) => r.version === 2)?.status === "superseded");
  const restoreV2 = await restorePromptVersionAction(rows.find((r) => r.version === 2)!.id as string, "rollback test");
  check("T2 rollback copies v2 FORWARD as v3 (history untouched)", restoreV2.ok === true && restoreV2.version === 3
    && db.tables.ai_tool_prompts.find((p) => p.tool_key === "generator" && p.version === 2)?.status === "superseded", restoreV2);

  console.log("\n3. THE DATABASE ROW");
  const live = db.tables.ai_tool_prompts.find((p) => p.tool_key === "generator" && p.status === "published")!;
  const ct = String(live.body_encrypted);
  check("T3 the record exists, published, with version", !!live && live.version === 3 && live.status === "published");
  check("T3 ciphertext, iv and tag are not empty", ct.length > 0 && String(live.body_iv).length > 0 && String(live.body_tag).length > 0);
  check("T3 the plaintext is not in the row (nor base64 of it)", !JSON.stringify(live).includes("TEST GROVBASE")
    && !JSON.stringify(live).includes(Buffer.from("TEST GROVBASE").toString("base64").slice(0, 16)));
  check("T3 iv is a fresh 12-byte nonce per save", Buffer.from(String(live.body_iv), "base64").length === 12
    && new Set(db.tables.ai_tool_prompts.filter((p) => p.tool_key === "generator").slice(0, 2).map((p) => p.body_iv)).size === 2);
  const keyHex = db.vault.get(VAULT_NAME)!;
  check("T3 the key is not stored anywhere but the vault", !JSON.stringify(db.tables).includes(keyHex));

  console.log("\n4. resolveSystemPrompt / resolveEngine — the runtime read");
  resetPromptKeyCache();
  db.user = CUSTOMER; // runtime runs inside the CUSTOMER's session
  const eng = await resolveEngine(supa, "generator");
  check("T4 the engine opens the published body exactly", eng?.systemPrompt === T1 && eng?.promptVersion === 3, eng?.systemPrompt);
  check("T4 resolveSystemPrompt returns the same text", (await resolveSystemPrompt(supa, "generator")) === T1);

  console.log("\n5. VARIABLES");
  db.user = ADMIN;
  const prev = await compilePreviewAction({ toolKey: "generator", body: T1 });
  check("T5 compile preview fills {{product_description}} with its sample", prev.ok && prev.text?.includes(String(sampleValues(TOOL_VARIABLES.generator).product_description ?? "")) === true, prev);
  const comp = compileForTool(T1, TOOL_VARIABLES.generator, { product_description: "Czerwony kubek ceramiczny", user_prompt: "na stole" });
  check("T5 runtime compile renders the customer value as data", comp.ok && comp.text.startsWith("TEST GROVBASE") && comp.text.includes("Czerwony kubek ceramiczny"), comp);
  db.user = CUSTOMER;
  const hybrid = await prepareGeneratorEngine(supa, CUSTOMER, "ws-1", {
    userPrompt: "Kubek na drewnianym stole", negative: null, productDescription: "Czerwony kubek ceramiczny",
    aspectRatio: "1:1", resolution: "1K", referencePaths: [],
  });
  check("T5 the generator's real hybrid path compiles the PUBLISHED prompt with {{product_description}}",
    hybrid.ok && (hybrid.enginePrompt ?? "").startsWith("TEST GROVBASE") && (hybrid.enginePrompt ?? "").includes("Czerwony kubek ceramiczny")
    && (hybrid.enginePrompt ?? "").includes("Kubek na drewnianym stole"), hybrid.ok ? hybrid.enginePrompt : hybrid);
  db.user = ADMIN;
  const retouchPub = await savePromptAction({ toolKey: "retouch", body: "RETUSZ {{product_description}}", summary: null, reason: "x", publish: true });
  check("T5 Retusz has no {{product_description}}: publish refused by the existing variable gate, never saved",
    retouchPub.ok === false && retouchPub.error === "variable_unknown"
    && !db.tables.ai_tool_prompts.some((p) => p.tool_key === "retouch"), retouchPub);
  const retouchOk = await savePromptAction({ toolKey: "retouch", body: "RETUSZ v1 {{tool_name}} {{aspect_ratio}} {{fidelity_rules?}}", summary: "Retusz 1.0", reason: "Test systemu promptów", publish: true });
  check("T5 Retusz with its own variables publishes", retouchOk.ok === true, retouchOk);

  console.log("\n6/7/8. WHO CAN READ WHAT");
  // A router request can ask for one segment and skip the layouts above it,
  // so the admin layout is not a lock for a page that decrypts with the
  // SERVER's authority (RLS lets a customer read their own ciphertext). Every
  // admin page that opens prompt content must check the role itself, before
  // it fetches or opens anything.
  const pages: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f === "page.tsx") pages.push(p); } };
  walk("app/admin");
  const decrypting = pages.filter((p) => /promptKeyring\(|adminPromptKeyring\(|decryptConceptPayload\(|\.open\(\{/.test(readFileSync(p, "utf8")));
  const gated = decrypting.filter((p) => {
    const src = readFileSync(p, "utf8");
    const gate = src.search(/profile\?\.role !== "admin"\) notFound\(\)/);
    const firstRead = Math.min(...[/\.from\("/, /promptKeyring\(/, /decryptConceptPayload\(/].map((r) => { const i = src.search(r); return i < 0 ? Infinity : i; }));
    return gate >= 0 && gate < firstRead;
  });
  check("T6 every admin page that opens prompt content checks the admin role itself, before any read", decrypting.length >= 1
    && gated.length === decrypting.length, { decrypting, gated });
  const anyId = String(db.tables.ai_tool_prompts[0].id);
  db.user = null;
  const anonRead = await readPromptBodyAction(anyId);
  const anonSave = await savePromptAction({ toolKey: "generator", body: "x", summary: null, reason: null, publish: false });
  check("T7 logged out: read → forbidden, no body", anonRead.ok === false && anonRead.error === "forbidden" && anonRead.body === undefined, anonRead);
  check("T7 logged out: save → forbidden", anonSave.ok === false && anonSave.error === "forbidden");
  check("T7 logged out: the table itself returns nothing (RLS)", ((await supa.from("ai_tool_prompts").select("*")).data ?? []).length === 0);
  db.user = CUSTOMER;
  const custRead = await readPromptBodyAction(anyId);
  const custPub = await publishPromptVersionAction(anyId, "x");
  const custRestore = await restorePromptVersionAction(anyId, "x");
  const custPreview = await compilePreviewAction({ toolKey: "generator", body: MARKER });
  check("T8 customer: read → forbidden, no body", custRead.ok === false && custRead.error === "forbidden" && !JSON.stringify(custRead).includes("TEST GROVBASE"));
  check("T8 customer: publish / restore / preview refused", custPub.ok === false && custRestore.ok === false && custPreview.ok === false);
  check("T8 customer: direct select of prompt rows is empty (RLS)", ((await supa.from("ai_tool_prompts").select("body_encrypted")).data ?? []).length === 0);
  check("T8 customer: the runtime read without the server token returns nothing",
    ((await supa.rpc("ai_tool_runtime", { p_tool_key: "generator", p_token: "guess" })).data as unknown[]).length === 0);
  const keyTry = await supa.rpc("prompt_master_key", { p_token: "guess", p_key_token: "guess".repeat(8) });
  check("T8 customer: the key door refuses a guessed token", keyTry.error?.message === "forbidden" && keyTry.data === null);
  db.user = ADMIN;
  // The dispatch token is reachable from an admin session (it sits in Vault
  // for the newsletter worker) — it must not open the key door.
  const adminDispatch = await supa.rpc("prompt_master_key", { p_token: dispatchToken(), p_key_token: dispatchToken() ?? "" });
  check("T8 even an ADMIN session holding the dispatch token gets no key", adminDispatch.error?.message === "forbidden" && adminDispatch.data === null);

  console.log("\n9. ADMIN save / publish / restore — covered above; history carries no body");
  const hist = await withKeyStates(supa, await readPromptHistory(supa, "generator"));
  check("T9 history rows carry key state, never a body or ciphertext", hist.every((v) => v.keyState === "vault")
    && !JSON.stringify(hist).includes(ct) && !JSON.stringify(hist).includes("TEST GROVBASE"));

  console.log("\n10. 40 000 characters — Polish, emoji, markdown, JSON, quotes, newlines, {{variables}}");
  const unit = "## Zasady 🎯\n- Zachowaj **dokładny** kształt — „cudzysłów”, 'apostrof', \"quote\" ✅\n```json\n{\"klucz\": \"wartość ąęłńóśźż\", \"n\": [1,2]}\n```\n{{product_description}} {{user_prompt?}} {{aspect_ratio}} 👩🏽‍🔧 ";
  let big = "";
  while (Array.from(big + unit).length <= 40000) big += unit;
  const pad = 40000 - Array.from(big).length;
  big = (big + "x".repeat(pad)).trim();
  big = big + "y".repeat(40000 - Array.from(big).length);
  check("T10 the fixture is exactly 40 000 characters (code points), more UTF-16 units", Array.from(big).length === 40000 && big.length > 40000, [Array.from(big).length, big.length]);
  const bigSave = await savePromptAction({ toolKey: "generator", body: big, summary: "40k", reason: "40k test", publish: true });
  check("T10 a 40 000-character prompt with emoji saves and publishes", bigSave.ok === true, bigSave);
  const bigRow = db.tables.ai_tool_prompts.find((p) => p.tool_key === "generator" && p.status === "published")!;
  const bigRead = await readPromptBodyAction(String(bigRow.id));
  check("T10 read back byte-for-byte", bigRead.ok && bigRead.body === big);
  resetPromptKeyCache();
  db.user = CUSTOMER;
  check("T10 the runtime opens it byte-for-byte", (await resolveEngine(supa, "generator"))?.systemPrompt === big);
  db.user = ADMIN;
  const tooBig = await savePromptAction({ toolKey: "generator", body: big + "z", summary: null, reason: null, publish: false });
  check("T10 40 001 characters is refused as too_long", tooBig.ok === false && tooBig.error === "too_long");

  console.log("\n11. OLD PROMPTS — sealed with APP_ENCRYPTION_KEY");
  const LEGACY_KEY = "b".repeat(64); // throwaway, never a real one
  const legacySealed = encryptWith(LEGACY_KEY, "STARY PROMPT {{tool_name}}");
  db.tables.ai_tool_prompts.push(
    { id: "legacy-pub", tool_key: "fashion_flat_lay", version: 1, status: "published", body_encrypted: legacySealed.ciphertext,
      body_iv: legacySealed.iv, body_tag: legacySealed.authTag, summary: "stary", reason: "old", source: "manual", created_by: ADMIN, created_at: "2026-08-01", published_at: "2026-08-01" },
    { id: "legacy-draft", tool_key: "fashion_flat_lay", version: 2, status: "draft", body_encrypted: legacySealed.ciphertext,
      body_iv: legacySealed.iv, body_tag: legacySealed.authTag, summary: "stary szkic", reason: null, source: "manual", created_by: ADMIN, created_at: "2026-08-02", published_at: null },
  );
  // (B) the old key is GONE — production today.
  const states = await withKeyStates(supa, await readPromptHistory(supa, "fashion_flat_lay"));
  check("T11 a row whose key is gone is marked unreadable for the admin", states.every((s) => s.keyState === "unreadable"), states.map((s) => s.keyState));
  const unreadable = await readPromptBodyAction("legacy-pub");
  check("T11 opening it says so (legacy_unreadable), never a crash or an empty body", unreadable.ok === false && unreadable.error === "legacy_unreadable");
  const pubUnreadable = await publishPromptVersionAction("legacy-draft", "x");
  const resUnreadable = await restorePromptVersionAction("legacy-pub", "x");
  check("T11 it cannot be published or restored (would run nothing)", pubUnreadable.error === "legacy_unreadable" && resUnreadable.error === "legacy_unreadable");
  check("T11 the old rows were not deleted or blanked", db.tables.ai_tool_prompts.filter((p) => p.tool_key === "fashion_flat_lay").every((p) => p.body_encrypted === legacySealed.ciphertext));
  const fresh = await savePromptAction({ toolKey: "fashion_flat_lay", body: "NOWY PROMPT {{tool_name}} {{hint?}}", summary: "nowy", reason: "Test systemu promptów", publish: true });
  check("T11 a NEW version saves and publishes despite the unreadable ones", fresh.ok === true && fresh.version === 3, fresh);
  // (A) the old key IS present: readable, and moved to the Vault key on publish.
  process.env.APP_ENCRYPTION_KEY = LEGACY_KEY;
  const legacyRead = await readPromptBodyAction("legacy-draft");
  check("T11 with the old key present the old body opens (legacy)", legacyRead.ok && legacyRead.body === "STARY PROMPT {{tool_name}}" && legacyRead.legacy === true);
  const moved = await publishPromptVersionAction("legacy-draft", "przeniesienie do sejfu");
  const movedRow = db.tables.ai_tool_prompts.find((p) => p.tool_key === "fashion_flat_lay" && p.status === "published")!;
  check("T11 publishing it re-seals the SAME text under the Vault key as a new version", moved.ok === true && moved.version === 4
    && movedRow.body_encrypted !== legacySealed.ciphertext, moved);
  const oldDraft = db.tables.ai_tool_prompts.find((p) => p.id === "legacy-draft");
  check("T11 the legacy draft stays in history, bytes untouched, closed (superseded)", oldDraft?.body_encrypted === legacySealed.ciphertext
    && oldDraft?.status === "superseded", oldDraft?.status);
  const again = await publishPromptVersionAction("legacy-draft", "drugi raz");
  check("T11 the same legacy draft cannot be published a second time", again.ok === false && again.error === "not_draft"
    && db.tables.ai_tool_prompts.filter((p) => p.tool_key === "fashion_flat_lay").length === 4, again);
  delete process.env.APP_ENCRYPTION_KEY;
  resetPromptKeyCache();
  const movedRead = await readPromptBodyAction(String(movedRow.id));
  check("T11 the moved version opens WITHOUT the old key", movedRead.ok && movedRead.body === "STARY PROMPT {{tool_name}}" && movedRead.legacy === false);

  console.log("\n12. A REAL TOOL — the engine takes the published prompt to the provider layer");
  generationCalls.length = 0;
  await savePromptAction({ toolKey: "fashion_flat_lay", body: `${MARKER} Połóż produkt płasko. {{tool_name}} {{hint?}}`, summary: "12", reason: "T12", publish: true });
  db.user = CUSTOMER; resetPromptKeyCache();
  const { value: toolRun, logs } = await captureLogs(() => runEngineImageTool(supa, CUSTOMER, "ws-1", {
    toolKey: "fashion_flat_lay", hint: "Ułóż rękawy", referencePaths: ["ws-1/a.jpg"],
    generation: genInput, expectedCost: 7,
  }));
  const sent = generationCalls[0]?.prompt ?? "";
  check("T12 the run reached the provider layer (runGeneration called once)", toolRun.ok === true && generationCalls.length === 1, toolRun);
  check("T12 the provider received the PUBLISHED prompt, compiled", sent.startsWith(`${MARKER} Połóż produkt płasko. fashion_flat_lay`) && sent.includes("Ułóż rękawy"), sent.slice(0, 160));
  check("T12 the engine trace names the published version", db.tables.ai_engine_runs.some((r) => r.tool_key === "fashion_flat_lay" && r.prompt_version === 5));
  check("T6 the customer's result carries no prompt text, no key, no ciphertext",
    !JSON.stringify(toolRun).includes(MARKER) && !JSON.stringify(toolRun).includes(keyHex));
  check("T6 nothing in the server log carries the prompt or the key", !logs.includes(MARKER) && !logs.includes(keyHex) && !logs.includes("Połóż produkt"));

  console.log("\n12b. WORKFLOW step prompts use the same key");
  db.user = ADMIN;
  // Two steps that need no model assignment: an AI TEXT step (the prompt
  // under test) and an existing GrovBase tool as the final image step.
  const wfSave = await saveWorkflowAction({
    toolKey: "fashion_flat_lay", concurrency: 1, summary: "wf", reason: "wf", publish: true,
    steps: [
      { name: "Opis", enabled: true, operation: "ai_text", outputKind: "text", outputName: "opis",
        inputImage: "customer", forEach: null, itemName: null, maxItems: null, modelId: null, fallbackModelId: null,
        textProvider: null, textModel: null, toolSlug: null, timeoutMs: 60000, maxAttempts: 1, onError: "stop", onItemError: "continue",
        condition: "always", prompt: `${MARKER} krok workflow {{tool_name}}` },
      { name: "Retusz", enabled: true, operation: "tool", outputKind: "image", outputName: "wynik",
        inputImage: "customer", forEach: null, itemName: null, maxItems: null, modelId: null, fallbackModelId: null,
        textProvider: null, textModel: null, toolSlug: "retouch", timeoutMs: 60000, maxAttempts: 1, onError: "stop", onItemError: "continue",
        condition: "always", prompt: "" },
    ],
  });
  const wfId = db.tables.ai_tool_workflows[0]?.id as string | undefined;
  const wfSteps = db.tables.ai_tool_workflow_steps;
  check("T12b workflow save seals its step prompts with no env key", wfSave.ok === true && !!wfId, wfSave);
  check("T12b the stored steps are ciphertext only", wfSteps.length === 2 && !JSON.stringify(wfSteps).includes(MARKER)
    && wfSteps.every((st) => typeof st.prompt_encrypted === "string" && String(st.prompt_encrypted).length > 0));
  const back = await readWorkflowAction(wfId ?? "none");
  check("T12b the editor reads the step back 1:1", back.ok && back.steps?.[0]?.prompt === `${MARKER} krok workflow {{tool_name}}`, back);
  db.user = CUSTOMER; resetPromptKeyCache();
  const loaded = await loadWorkflow(supa, "fashion_flat_lay", null);
  check("T12b the runtime loader opens it (customer session, server token)", loaded?.steps[0]?.prompt === `${MARKER} krok workflow {{tool_name}}`
    && loaded?.steps.length === 2, loaded?.steps.map((x) => x.name));

  console.log("\n13. THE KEY DOOR");
  db = makeDb(); supa = install(db); resetPromptKeyCache();
  await Promise.all(Array.from({ length: 10 }, () => savePromptAction({ toolKey: "generator", body: "rownolegle", summary: null, reason: null, publish: false })));
  check("13 ten concurrent first saves converge on ONE key (and one pin)", db.keyCreations === 1 && new Set(db.keyReturns).size === 1
    && [...db.vault.keys()].sort().join() === [PIN_NAME, VAULT_NAME].sort().join());
  const callsBefore = db.keyCalls;
  await savePromptAction({ toolKey: "generator", body: "cache", summary: null, reason: null, publish: false });
  check("13 the key is cached per server instance (no Vault round trip per save)", db.keyCalls === callsBefore);
  // A stale dispatch hash (server key rotated): the admin path republishes
  // it and retries — the editor is never dead because of it.
  db = makeDb(); supa = install(db); resetPromptKeyCache();
  (db.tables.app_settings[0].value as Row).dispatch_hash = sha("an-old-token");
  const healed = await savePromptAction({ toolKey: "generator", body: "po rotacji", summary: null, reason: null, publish: false });
  check("13 a stale server hash self-heals on the admin save", healed.ok === true && dispatchHash(db) === sha(dispatchToken() ?? ""), healed);
  // No way to reach the key at all → an honest, specific error; the draft
  // stays in the editor (nothing written).
  db = makeDb(); supa = install(db); resetPromptKeyCache();
  const saveKey = process.env.GROVBASE_SERVER_KEY;
  delete process.env.GROVBASE_SERVER_KEY;
  const noKey = await savePromptAction({ toolKey: "generator", body: "bez klucza", summary: null, reason: null, publish: false });
  process.env.GROVBASE_SERVER_KEY = saveKey;
  check("13 no reachable key → prompt_key_unavailable, nothing stored", noKey.ok === false && noKey.error === "prompt_key_unavailable"
    && db.tables.ai_tool_prompts.length === 0, noKey);
  check("13 the error names no key, no ciphertext", !JSON.stringify(noKey).match(/[0-9a-f]{64}/));

  console.log("\n13b. THE PIN — an admin session can reach the dispatch token, never the key");
  db = makeDb(); supa = install(db); resetPromptKeyCache();
  db.user = CUSTOMER;
  const custFirst = await supa.rpc("prompt_master_key", { p_token: "guess", p_key_token: "c".repeat(64) });
  check("13b nothing pinned yet: a customer cannot pin (no server proof)", custFirst.error?.message === "forbidden" && !db.vault.has(PIN_NAME));
  db.user = ADMIN;
  const same = await supa.rpc("prompt_master_key", { p_token: dispatchToken(), p_key_token: dispatchToken() ?? "" });
  check("13b the dispatch token can never be pinned as the key token", same.error?.message === "forbidden" && !db.vault.has(PIN_NAME));
  const first = await savePromptAction({ toolKey: "generator", body: "pierwszy", summary: null, reason: null, publish: false });
  check("13b the server's first call pins sha256(prompt-key token)", first.ok === true && db.vault.get(PIN_NAME) === sha(promptKeyToken() ?? ""));
  // An admin session forges the published dispatch hash for a token it
  // picked — the generic proof-of-server accepts that; the key door must not.
  (db.tables.app_settings[0].value as Row).dispatch_hash = sha("x".repeat(40));
  const forged = await supa.rpc("prompt_master_key", { p_token: "x".repeat(40), p_key_token: "y".repeat(40) });
  const forgedSame = await supa.rpc("prompt_master_key", { p_token: "x".repeat(40), p_key_token: "x".repeat(40) });
  check("13b a forged dispatch hash opens nothing once pinned", forged.data === null && forgedSame.data === null
    && forged.error?.message === "forbidden" && db.vault.get(PIN_NAME) === sha(promptKeyToken() ?? ""));
  // …and the server is not affected by it: the pin, not the hash, is checked.
  resetPromptKeyCache();
  const stillWorks = await readPromptBodyAction(String(db.tables.ai_tool_prompts[0].id));
  check("13b the server still opens prompts with the dispatch hash stale/forged", stillWorks.ok === true && stillWorks.body === "pierwszy", stillWorks);
  // A rotated server secret: the key is unavailable (honestly reported, the
  // stored rows are NOT called lost) until the operator clears the pin.
  (db.tables.app_settings[0].value as Row).dispatch_hash = sha(dispatchToken() ?? "");
  const rotateKey = process.env.GROVBASE_SERVER_KEY;
  process.env.GROVBASE_SERVER_KEY = "grovbase-test-server-key-ROTATED-00000000";
  resetPromptKeyCache();
  const rotatedSave = await savePromptAction({ toolKey: "generator", body: "po rotacji", summary: null, reason: null, publish: false });
  const rotatedRead = await readPromptBodyAction(String(db.tables.ai_tool_prompts[0].id));
  const rotatedStates = await withKeyStates(supa, await readPromptHistory(supa, "generator"));
  check("13b after a server-key rotation the save says prompt_key_unavailable", rotatedSave.ok === false && rotatedSave.error === "prompt_key_unavailable", rotatedSave);
  check("13b …and an intact prompt is NOT reported as lost (no legacy_unreadable)", rotatedRead.ok === false && rotatedRead.error === "prompt_key_unavailable", rotatedRead);
  check("13b …and the history shows no 'unreadable' badge for intact rows", rotatedStates.every((v) => v.keyState === undefined), rotatedStates.map((v) => v.keyState));
  db.vault.delete(PIN_NAME); // select public.prompt_key_unpin(); — the operator, in the SQL editor
  resetPromptKeyCache();
  const repinned = await readPromptBodyAction(String(db.tables.ai_tool_prompts[0].id));
  check("13b after the operator unpins, the new server identity pins and every prompt opens", repinned.ok === true && repinned.body === "pierwszy"
    && db.vault.get(PIN_NAME) === sha(promptKeyToken() ?? ""), repinned);
  process.env.GROVBASE_SERVER_KEY = rotateKey;
  resetPromptKeyCache();

  console.log(failed ? `\n${failed} FAILED` : "\nAll prompt-vault tests passed.");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
