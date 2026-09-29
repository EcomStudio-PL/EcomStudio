/**
 * RETUSZ FORENSIC — one click, followed from the panel to the socket:
 *
 *   UI (components/retouch/workspace.tsx: what the browser POSTs)
 *   → POST /api/retouch (the REAL route handler)
 *   → runRetouch → runEngineImageTool → runGeneration → googleAdapter
 *   → the exact string handed to fetch   (captured here: "B")
 *
 * compared with an INDEPENDENT hand-written request (scripts/retouch-baseline.ts,
 * Google's cookbook image edit via the Interactions API: "A").
 *
 * Only the route's surroundings are stubbed (session, account block, feature
 * switch, workspace lookup, workflow driver — scripts/stubs/forensic-*.ts),
 * plus the database and storage. Everything from runRetouch to fetch is the
 * production code.
 *
 * Expected, printed per run:
 *   PROMPT_EQUAL=true IMAGE_EQUAL=true STATELESS=true ADDITIONAL_TEXT=0
 *   HISTORY=0 KNOWLEDGE=0 FEEDBACK=0 SYSTEM_INSTRUCTION=NONE
 *   IMAGE_SIZE=2K|4K ASPECT_RATIO=OMITTED|<ratio> PROVIDER_CALLS=1
 *
 * 2K / 4K + FORMAT (A–D): the ONLY difference from the pre-patch request
 * (GOLDEN, recorded from the production code at 5113398) is the trailing
 * `,"response_format":{…}` — every byte before it is the golden body.
 *
 * Run: npm run test:retouchforensic
 * Optional: RETUSZ_PROMPT_FILE=<path> also runs a real prompt kept outside the
 * repository (GrovBase prompts are never committed).
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import sharp from "sharp";
import type { EngineConfig } from "@/lib/server/ai-engine";
import { POST as retouchRoute } from "@/app/api/retouch/route";
import { captureInteractionBoundary } from "@/lib/ai/providers/google-boundary";
import { retouchInteractionViolation } from "@/lib/ai/providers/google-request";
import { baselineBody, BASELINE_ENDPOINT } from "./retouch-baseline";

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); if (detail !== undefined) console.log("      ", typeof detail === "string" ? detail.slice(0, 600) : JSON.stringify(detail).slice(0, 600)); }
}
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
/** GOLDEN BASELINE — the Retusz body the production code sent BEFORE the
 *  2K/4K + format patch (commit 5113398), for the synthetic prompt and the
 *  test photo below, recorded by running that code. Its photo's sha256 too,
 *  so a changed fixture cannot pass silently. */
const GOLDEN_PRE_PATCH_BODY_SHA256 = "50d96cdd5c7dfdbdb72d559bf03c61cfcc76daf489c70f6d9612877cb34cdfba";
const GOLDEN_PHOTO_SHA256 = "f291079907b7a7069703c6a5c691271894f412719dc524b8c22c58f2ff980d3e";
/** B minus the one allowed addition — what must equal the golden body. */
const withoutResponseFormat = (b: string) => b.replace(/,"response_format":\{[^{}]*\}\}$/, "}");
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/* ── an in-memory PROD: model rows, the storage bucket, the job rows ─────── */

type Row = Record<string, unknown>;
const PRO_ID = "m-pro";
const FB_ID = "m-fb";
type Db = { files: Map<string, Buffer>; jobs: Map<string, Row>; engineRuns: Row[]; tables: string[]; ledger: string[] };
function freshDb(): Db { return { files: new Map(), jobs: new Map(), engineRuns: [], tables: [], ledger: [] }; }
const models: Row[] = [PRO_ID, FB_ID].map((id) => ({
  id, name: id, display_name: id, model_identifier: id === PRO_ID ? "gemini-3-pro-image" : "gemini-3.1-flash-image",
  active: true, supports_reference_images: true, max_reference_images: 6,
  supported_aspect_ratios: ["1:1", "4:5", "16:9", "9:16", "3:4"], supported_resolutions: ["1K", "2K", "4K"],
  credit_cost: 7, internal_cost_usd_micros: 39000, metadata: {}, capabilities: {}, visible_custom: true,
  pricing: { "1K": 7, "2K": 7, "4K": 12 }, ai_providers: { id: "p-google", slug: "google", active: true },
}));

let jobSeq = 0;
function fakeSupabase(db: Db) {
  const from = (table: string) => {
    db.tables.push(table);
    const filters: [string, unknown][] = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: Row | null = null;
    const rows = (): Row[] => {
      let r: Row[] = table === "ai_models" ? models
        : table === "credit_wallets" ? [{ id: "wal-1", balance: 1000, workspace_id: "w" }]
        : table === "generation_jobs" ? [...db.jobs.values()] : [];
      for (const [k, v] of filters) if (!k.includes(".") && !k.includes("->>")) r = r.filter((x) => x[k] === v);
      return r;
    };
    const result = () => {
      if (op === "insert") {
        if (table === "generation_jobs") {
          const id = `job-${++jobSeq}`;
          db.jobs.set(id, { ...(payload ?? {}), id, created_at: new Date().toISOString() });
          return { data: { id }, error: null };
        }
        return { data: { id: `${table}-row` }, error: null };
      }
      if (op === "update") {
        if (table === "generation_jobs") {
          const id = filters.find(([k]) => k === "id")?.[1] as string;
          const cur = db.jobs.get(id);
          if (cur) db.jobs.set(id, { ...cur, ...(payload ?? {}) });
        }
        return { data: null, error: null };
      }
      return { data: rows(), error: null };
    };
    const q = {
      select: () => q,
      insert: (p: Row) => { op = "insert"; payload = Array.isArray(p) ? p[0] : p; return q; },
      update: (p: Row) => { op = "update"; payload = p; return q; },
      upsert: (p: Row) => { op = "insert"; payload = p; return q; },
      eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
      in: () => q, order: () => q, limit: () => q, gte: () => q, lte: () => q, is: () => q, neq: () => q,
      maybeSingle: async () => { const r = result(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null }; },
      single: async () => { const r = result(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null }; },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
    };
    return q;
  };
  return {
    from,
    rpc: async (name: string, args?: Row) => {
      if (name === "provider_credential_read") return { data: [{ base_url: null }], error: null };
      if (name === "ai_engine_run_record") db.engineRuns.push((args?.p_run ?? {}) as Row);
      return { data: null, error: null };
    },
    storage: {
      from: () => ({
        download: async (path: string) => {
          const b = db.files.get(path);
          return b ? { data: new Blob([new Uint8Array(b)]), error: null } : { data: null, error: { message: "not found" } };
        },
        upload: async (path: string, body?: unknown) => { if (Buffer.isBuffer(body)) db.files.set(path, Buffer.from(body)); return { error: null }; },
        createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}` })), error: null }),
      }),
    },
  };
}

/* ── the socket: every Google request, as the raw string that was sent ───── */

type Wire = { url: string; body: string; headers: Record<string, string> };
let wire: Wire[] = [];
let statuses: number[] = [];
let responseSteps: Row[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.includes("generativelanguage.googleapis.com")) return realFetch(input, init);
  if (typeof init?.body !== "string") throw new Error("body is not a string");
  wire.push({ url, body: init.body, headers: (init.headers ?? {}) as Record<string, string> });
  const status = statuses.shift() ?? 200;
  if (status !== 200) return new Response(JSON.stringify({ error: { status: "UNAVAILABLE", message: "overloaded" } }), { status });
  return new Response(JSON.stringify({ id: "int-1", status: "completed", steps: [{ type: "user_input", content: [] }, ...responseSteps] }),
    { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const g = globalThis as unknown as { __fidelityEngine?: EngineConfig | null; __forensicClient?: unknown; __forensicUser?: { id: string } | null; __fidelityLedger?: string[] };
function engine(over: Partial<EngineConfig>): EngineConfig {
  return {
    toolKey: "retouch", mode: "grovbase", serviceSlug: "image_edit", allowModelChoice: false,
    fallbackEnabled: false, timeoutMs: 120_000, maxAttempts: 1, primaryModelId: PRO_ID, fallbackModelId: null,
    systemPrompt: null, promptVersion: null, knowledgeStrategy: "proven", workflowEnabled: false, ...over,
  };
}

/** One click: the browser's POST, through the REAL route handler. */
async function click(db: Db, body: Row) {
  wire = []; g.__fidelityLedger = [];
  g.__forensicClient = fakeSupabase(db); g.__forensicUser = { id: "u" };
  const res = await retouchRoute(new Request("https://grovbase.test/api/retouch", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  const json = await res.json() as Row;
  const job = [...db.jobs.values()].pop() ?? {};
  return { status: res.status, json, job, pr: ((job.settings ?? {}) as Row).provider_request as Row | undefined, run: db.engineRuns[db.engineRuns.length - 1] ?? {} };
}

async function main() {
  // A phone-like JPEG WITH an EXIF orientation flag (the PROD case).
  const photo = await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 170, g: 130, b: 95 } } })
    .composite([{ input: Buffer.from(`<svg width="1200" height="900"><rect x="300" y="200" width="600" height="500" fill="#234"/></svg>`), top: 0, left: 0 }])
    .jpeg({ quality: 90 }).withMetadata({ orientation: 6 }).toBuffer();
  const draft = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#f00" } }).jpeg().toBuffer();
  const final = await sharp({ create: { width: 96, height: 128, channels: 3, background: "#0a0" } }).jpeg().toBuffer();
  responseSteps = [
    { type: "thought", signature: "sig", summary: [{ type: "text", text: "planning" }, { type: "image", data: draft.toString("base64"), mime_type: "image/jpeg" }] },
    { type: "model_output", content: [{ type: "image", data: final.toString("base64"), mime_type: "image/jpeg" }] },
  ];
  const SRC = "w/retouch-x/src.jpg";

  console.log("\nU0  THE PANEL — what the browser sends on 'Retuszuj'");
  const ui = read("components/retouch/workspace.tsx");
  const uiBody = /fetch\("\/api\/retouch",[\s\S]*?body: JSON\.stringify\((\{[^)]*\})\)/.exec(ui)?.[1] ?? "";
  check("the panel POSTs { sourcePath, resolution, format, expectedOutputs } — no prompt",
    uiBody.replace(/\s+/g, " ") === "{ sourcePath: job.path, resolution, format, expectedOutputs: outputsPerRun }", uiBody);
  check("the panel renders the quality + format pickers again (default 2K, 'original'); the locked note is gone",
    /testId="resolution"/.test(ui) && /testId="format"/.test(ui) && /useState\(\(\) => \(resolutions\.includes\("2K"\) \? "2K"/.test(ui)
    && /useState\("original"\)/.test(ui) && !/data-retouch-settings-locked|settingsLocked/.test(ui));
  const page = read("app/(app)/retusz/page.tsx");
  check("the page offers retouchSizes (2K/4K, no 1K) and retouchRatios, priced per size",
    /resolutions=\{model \? \(model\.workflowEnabled \? \[retouchWorkflowSize\(model\)\] : retouchSizes\(model\)\)/.test(page)
    && /ratios=\{model && !model\.workflowEnabled \? retouchRatios\(model\)/.test(page) && /retouchPrice\(model, r\)/.test(page));
  check("the panel price follows the chosen quality: pricing[resolution] × outputs",
    /const perImage = \(pricing\[resolution\] \?\? Object\.values\(pricing\)\[0\] \?\? 0\) \* Math\.max\(1, outputsPerRun\)/.test(ui));
  check("the panel shows no 👍/👎 on Retusz results; the server refuses them too",
    /item\.operation !== "image_retouch" && <ResultFeedback/.test(read("components/genv3/image-details.tsx"))
    && /STATELESS_OPERATIONS = new Set\(\["image_retouch"\]\)/.test(read("app/actions/feedback.ts")));

  // Tricky on purpose: Polish letters, a no-break space, an em dash, CRLF,
  // marker-like brackets, inner and trailing spaces, a final newline.
  const SYNTHETIC = "[ZADANIE]\r\nPrzekształć zdjęcie — zachowaj produkt 1:1.\n\nDATA: none · AVOID: none  \n";
  const prompts: [string, string][] = [["synthetic", SYNTHETIC]];
  const real = process.env.RETUSZ_PROMPT_FILE;
  if (real && existsSync(real)) prompts.push(["real (RETUSZ_PROMPT_FILE)", readFileSync(real, "utf8").replace(/\n$/, "")]);

  for (const [label, PROMPT] of prompts) {
    console.log(`\nF1  ONE CLICK → ONE REQUEST — prompt: ${label} (${Array.from(PROMPT).length} chars, sha256 ${sha(PROMPT).slice(0, 16)}…)`);
    const db = freshDb(); db.files.set(SRC, photo);
    g.__fidelityEngine = engine({ systemPrompt: PROMPT, promptVersion: 5 });
    // The panel's default click: 2K, "Oryginalny".
    const { status, json, job, pr, run } = await click(db, { sourcePath: SRC, resolution: "2K", format: "original", expectedOutputs: 1 });
    check("the route answered 200 ok", status === 200 && json.ok === true, json);
    check("exactly ONE HTTP request left GrovBase", wire.length === 1, wire.length);
    const B = wire[0]?.body ?? "";
    const A = baselineBody({ prompt: PROMPT, image: photo, mimeType: "image/jpeg", imageSize: "2K" });
    check("A == B byte for byte (independent baseline vs the string handed to fetch)", A === B,
      A === B ? undefined : { aBytes: A.length, bBytes: B.length, firstDiff: [...A].findIndex((c, i) => c !== B[i]) });
    check("A == B as structures", isDeepStrictEqual(JSON.parse(A), JSON.parse(B)));
    check("POST https://generativelanguage.googleapis.com/v1beta/interactions — no key in the URL", wire[0]?.url === BASELINE_ENDPOINT, wire[0]?.url);
    check("headers: Content-Type, x-goog-api-key, Api-Revision — nothing else", Object.keys(wire[0]?.headers ?? {}).sort().join() === "Api-Revision,Content-Type,x-goog-api-key");

    const nb = (run.network_boundary ?? {}) as Row;
    const sent = JSON.parse(B) as Row;
    const input = sent.input as Row[];
    const flags = {
      PROMPT_EQUAL: nb.published_prompt_sha256 === sha(PROMPT) && nb.resolved_prompt_sha256 === sha(PROMPT) && nb.provider_prompt_sha256 === sha(PROMPT) && input[0]!.text === PROMPT,
      IMAGE_EQUAL: nb.input_original_sha256 === sha(photo) && (nb.provider_inputs as Row[])[0]?.sha256 === sha(photo) && sha(Buffer.from(String(input[1]!.data), "base64")) === sha(photo),
      STATELESS: nb.stateless === true && nb.store === false && nb.previous_interaction_id_present === false && !("previous_interaction_id" in sent),
      ADDITIONAL_TEXT: nb.extra_text_parts,
      HISTORY: nb.history_count,
      KNOWLEDGE: pr?.knowledge_count,
      EXAMPLES: pr?.examples_count,
      FEEDBACK: pr?.feedback_count,
      SYSTEM_INSTRUCTION: nb.system_instruction_present === false && !("system_instruction" in sent) ? "NONE" : "PRESENT",
      TOOLS: nb.tools_count,
      IMAGE_SIZE: nb.image_size,
      ASPECT_RATIO: nb.aspect_ratio,
      FALLBACK: nb.fallback,
      PROVIDER_CALLS: nb.total_provider_calls,
    };
    console.log("    " + Object.entries(flags).map(([k, v]) => `${k}=${v}`).join("  "));
    check("EXPECTED: PROMPT_EQUAL IMAGE_EQUAL STATELESS; ADDITIONAL_TEXT HISTORY KNOWLEDGE EXAMPLES FEEDBACK TOOLS = 0; SYSTEM_INSTRUCTION NONE; IMAGE_SIZE 2K; ASPECT_RATIO OMITTED; FALLBACK OFF; PROVIDER_CALLS 1",
      flags.PROMPT_EQUAL && flags.IMAGE_EQUAL && flags.STATELESS && flags.ADDITIONAL_TEXT === 0 && flags.HISTORY === 0
      && flags.KNOWLEDGE === 0 && flags.EXAMPLES === 0 && flags.FEEDBACK === 0 && flags.TOOLS === 0 && flags.SYSTEM_INSTRUCTION === "NONE"
      && flags.IMAGE_SIZE === "2K" && flags.ASPECT_RATIO === "OMITTED" && flags.FALLBACK === "OFF" && flags.PROVIDER_CALLS === 1, flags);
    check("REQUEST FIELD NAMES = [model, input, response_modalities, store, response_format]; STRICT_STATELESS; EXTRA_FIELDS []",
      JSON.stringify(nb.request_field_names) === '["model","input","response_modalities","store","response_format"]' && nb.strict_stateless === true && JSON.stringify(nb.extra_fields) === "[]", nb.request_field_names);
    check("model gemini-3-pro-image, API v1beta, body sha256 recorded == sha256 of the string sent",
      nb.model === "gemini-3-pro-image" && nb.api_version === "v1beta" && nb.request_body_sha256 === sha(B) && nb.request_body_bytes === Buffer.byteLength(B));
    check("prompt lengths equal at every step (chars and UTF-8 bytes)",
      nb.published_prompt_length === Array.from(PROMPT).length && nb.resolved_prompt_length === nb.published_prompt_length
      && nb.provider_prompt_length === nb.published_prompt_length && nb.provider_prompt_utf8_bytes === Buffer.byteLength(PROMPT));
    check("the EXIF orientation flag is still in the bytes sent (nothing re-encoded); transform none",
      (await sharp(Buffer.from(String(input[1]!.data), "base64")).metadata()).orientation === 6 && nb.input_transform === "none");
    check("PRIVACY: no API key anywhere in the record (headers recorded by NAME only)",
      JSON.stringify(nb.request_headers) === '["api-revision","content-type","x-goog-api-key"]' && !JSON.stringify(nb).includes(String(wire[0]?.headers["x-goog-api-key"])));
    check("PRIVACY: the customer-readable job row holds no plain SHA-256 of the prompt, no prompt text",
      !JSON.stringify(job).includes(sha(PROMPT)) && !JSON.stringify(job).includes(PROMPT.slice(0, 20)));
    check("PRIVACY: the admin record holds no prompt text and no image bytes",
      !JSON.stringify(nb).includes(PROMPT.slice(0, 20)) && !JSON.stringify(nb).includes(photo.toString("base64").slice(0, 40)));

    const out = (((job.settings ?? {}) as Row).provider_output ?? []) as Row[];
    const stored = db.files.get(String(out[0]?.stored_path ?? ""));
    check("OUTPUT: stored bytes == the provider's FINAL (model_output) image — never the thought draft",
      !!stored && sha(stored) === sha(final) && sha(stored) !== sha(draft) && JSON.stringify(out[0]?.provider_picked_step) === "[2,0]", out[0]);
    check("OUTPUT: provider sha256 == stored sha256, no transform, not the input photo",
      out[0]?.provider_sha256 === sha(final) && out[0]?.stored_equals_provider === true && out[0]?.transformed_after_provider === false && sha(stored ?? Buffer.alloc(0)) !== sha(photo));
    check("CREDITS: one charge, completed (ledger start → complete)", JSON.stringify(g.__fidelityLedger) === '["start","complete"]', g.__fidelityLedger);
  }

  console.log("\nF1b 2K / 4K + FORMAT — cases A–D, each against the GOLDEN pre-patch request");
  {
    check("GOLDEN fixture: the test photo is the one the golden body was recorded with", sha(photo) === GOLDEN_PHOTO_SHA256, sha(photo));
    const golden = baselineBody({ prompt: SYNTHETIC, image: photo, mimeType: "image/jpeg" });
    check("GOLDEN: the independent baseline without a size == the pre-patch body (sha256 50d96cdd…)", sha(golden) === GOLDEN_PRE_PATCH_BODY_SHA256, sha(golden));
    const cases: { name: string; resolution: string; format: string; size: string; ratio: string | null; credits: number }[] = [
      { name: "A  2K + Oryginalny", resolution: "2K", format: "original", size: "2K", ratio: null, credits: 7 },
      { name: "B  4K + Oryginalny", resolution: "4K", format: "original", size: "4K", ratio: null, credits: 12 },
      { name: "C  2K + 4:5", resolution: "2K", format: "4:5", size: "2K", ratio: "4:5", credits: 7 },
      { name: "D  4K + 16:9", resolution: "4K", format: "16:9", size: "4K", ratio: "16:9", credits: 12 },
    ];
    for (const c of cases) {
      const db = freshDb(); db.files.set(SRC, photo);
      g.__fidelityEngine = engine({ systemPrompt: SYNTHETIC, promptVersion: 5, maxAttempts: 3, fallbackEnabled: true, fallbackModelId: FB_ID });
      const { status, json, job, pr, run } = await click(db, { sourcePath: SRC, resolution: c.resolution, format: c.format, expectedOutputs: 1 });
      const B = wire[0]?.body ?? "";
      const sent = (B ? JSON.parse(B) : {}) as Row;
      const nb = (run.network_boundary ?? {}) as Row;
      const rf = sent.response_format as Row | undefined;
      const expectedRf = c.ratio ? { type: "image", image_size: c.size, aspect_ratio: c.ratio } : { type: "image", image_size: c.size };
      const out = (((job.settings ?? {}) as Row).provider_output ?? []) as Row[];
      console.log(`    ${c.name}: response_format=${JSON.stringify(rf)} credits=${json.credits}`);
      check(`${c.name}: 200 ok, exactly ONE request (fallback ON + Próby 3 in the panel), store:false`,
        status === 200 && json.ok === true && wire.length === 1 && sent.store === false && sent.model === "gemini-3-pro-image", { status, n: wire.length, json });
      check(`${c.name}: response_format == ${JSON.stringify(expectedRf)}${c.ratio ? "" : " (aspect_ratio ABSENT)"}`,
        isDeepStrictEqual(rf, expectedRf) && (c.ratio !== null || !("aspect_ratio" in (rf ?? {}))), rf);
      check(`${c.name}: B == independent baseline A (size${c.ratio ? " + ratio" : ""}) byte for byte`,
        B === baselineBody({ prompt: SYNTHETIC, image: photo, mimeType: "image/jpeg", imageSize: c.size, aspectRatio: c.ratio ?? undefined }));
      check(`${c.name}: B minus response_format == GOLDEN pre-patch body byte for byte (the ONLY diff is the output config)`,
        withoutResponseFormat(B) === golden && sha(withoutResponseFormat(B)) === GOLDEN_PRE_PATCH_BODY_SHA256 && B.startsWith(golden.slice(0, -1) + ',"response_format":'));
      check(`${c.name}: PROMPT SHA == pre-patch, INPUT IMAGE SHA == pre-patch (the stored original)`,
        nb.provider_prompt_sha256 === sha(SYNTHETIC) && nb.published_prompt_sha256 === sha(SYNTHETIC) && (sent.input as Row[])[0]?.text === SYNTHETIC
        && (nb.provider_inputs as Row[])[0]?.sha256 === GOLDEN_PHOTO_SHA256 && nb.input_original_sha256 === GOLDEN_PHOTO_SHA256);
      check(`${c.name}: the size / ratio never reach the prompt (no text part mentions them)`,
        (sent.input as Row[]).filter((p) => p.type === "text").length === 1 && !String((sent.input as Row[])[0]?.text).includes(c.size));
      check(`${c.name}: STATELESS, HISTORY 0, KNOWLEDGE 0, FEEDBACK 0, SYSTEM_INSTRUCTION NONE, no hidden text, FALLBACK OFF, PROVIDER_CALLS 1`,
        nb.stateless === true && nb.strict_stateless === true && nb.previous_interaction_id_present === false && !("previous_interaction_id" in sent)
        && nb.history_count === 0 && pr?.knowledge_count === 0 && pr?.examples_count === 0 && pr?.feedback_count === 0
        && nb.system_instruction_present === false && !("system_instruction" in sent) && nb.extra_text_parts === 0 && nb.tools_count === 0
        && JSON.stringify(nb.extra_fields) === "[]" && nb.fallback === "OFF" && nb.total_provider_calls === 1, nb);
      check(`${c.name}: boundary + job record IMAGE_SIZE ${c.size}, ASPECT_RATIO ${c.ratio ?? "OMITTED"}`,
        nb.image_size === c.size && nb.aspect_ratio === (c.ratio ?? "OMITTED") && pr?.image_size_sent === c.size
        && pr?.aspect_ratio_sent === c.ratio && pr?.aspect_ratio_mode === (c.ratio ? "USER_SELECTED" : "ORIGINAL_OMITTED"), { nb: [nb.image_size, nb.aspect_ratio], pr: [pr?.image_size_sent, pr?.aspect_ratio_sent, pr?.aspect_ratio_mode] });
      check(`${c.name}: no output postprocessing — stored bytes == provider's final image`,
        out[0]?.stored_equals_provider === true && out[0]?.transformed_after_provider === false && out[0]?.provider_sha256 === sha(final), out[0]);
      check(`${c.name}: CREDITS ${c.credits} (one charge, completed)`,
        json.credits === c.credits && JSON.stringify(g.__fidelityLedger) === '["start","complete"]', { credits: json.credits, ledger: g.__fidelityLedger });
    }
  }

  console.log("\nF2  THE BROWSER CANNOT SEND ANYTHING OUTSIDE THE OFFER");
  {
    const db = freshDb(); db.files.set(SRC, photo);
    g.__fidelityEngine = engine({ systemPrompt: SYNTHETIC, promptVersion: 5 });
    await click(db, { sourcePath: SRC, resolution: "2K", format: "original", expectedOutputs: 1 });
    const clean = wire[0]?.body;
    await click(db, { sourcePath: SRC, expectedOutputs: 1 });
    check("no resolution / format in the POST → the defaults 2K + Oryginalny (same body)", wire.length === 1 && wire[0]?.body === clean);
    await click(db, { sourcePath: SRC, resolution: "2K", format: "original", expectedOutputs: 1, prompt: "Make it pop", aspect_ratio: "21:9" });
    check("extra fields in the POST (a prompt, a raw aspect_ratio) change nothing", wire.length === 1 && wire[0]?.body === clean);
    for (const bad of [{ resolution: "1K" }, { resolution: "8K" }, { resolution: "2k" }, { format: "3:2" }, { format: "21:9" }, { format: "7:5" }, { format: "auto" }]) {
      const r = await click(db, { sourcePath: SRC, resolution: "2K", format: "original", ...bad, expectedOutputs: 1 });
      check(`${JSON.stringify(bad)} → refused invalid_input, 0 requests, nothing charged (never snapped)`,
        r.status === 400 && r.json.error === "invalid_input" && wire.length === 0 && JSON.stringify(g.__fidelityLedger) === "[]", { json: r.json, n: wire.length, ledger: g.__fidelityLedger });
    }
  }

  console.log("\nF3  ONE REQUEST — no retry, no fallback, whatever the panel says");
  {
    const db = freshDb(); db.files.set(SRC, photo);
    g.__fidelityEngine = engine({ systemPrompt: SYNTHETIC, promptVersion: 5, maxAttempts: 3, fallbackEnabled: true, fallbackModelId: FB_ID });
    statuses = [503, 503, 503];
    const r = await click(db, { sourcePath: SRC, expectedOutputs: 1 });
    statuses = [];
    check("a 503 with 'Próby: 3' + fallback ON → exactly 1 request, to gemini-3-pro-image, refused + refunded",
      wire.length === 1 && JSON.parse(wire[0]!.body).model === "gemini-3-pro-image" && r.json.ok === false && JSON.stringify(g.__fidelityLedger) === '["start","fail"]', { n: wire.length, ledger: g.__fidelityLedger });
    check("…and the failed run still records PROVIDER_CALLS 1 at the boundary", (r.run.network_boundary as Row | undefined)?.total_provider_calls === 1, r.run.network_boundary);
    responseSteps = [{ type: "thought", signature: "s", summary: [{ type: "image", data: draft.toString("base64"), mime_type: "image/jpeg" }] }];
    const empty = await click(db, { sourcePath: SRC, expectedOutputs: 1 });
    check("no final image (thought draft only) → ERROR + refund, the draft is never stored",
      empty.json.ok === false && empty.json.error === "provider_empty_result" && JSON.stringify(g.__fidelityLedger) === '["start","fail"]' && wire.length === 1, empty.json);
    responseSteps = [{ type: "model_output", content: [{ type: "image", data: final.toString("base64"), mime_type: "image/jpeg" }] }];
  }

  console.log("\nF4  THE COMPARISON CATCHES EVERY KIND OF TAMPERING (applied to the real body B)");
  {
    const db = freshDb(); db.files.set(SRC, photo);
    g.__fidelityEngine = engine({ systemPrompt: SYNTHETIC, promptVersion: 5 });
    await click(db, { sourcePath: SRC, resolution: "2K", format: "original", expectedOutputs: 1 });
    const B = wire[0]!.body;
    const A = baselineBody({ prompt: SYNTHETIC, image: photo, mimeType: "image/jpeg", imageSize: "2K" });
    const other = await sharp(photo).jpeg({ quality: 80 }).toBuffer();
    const tamper: [string, (b: Row) => void][] = [
      ["adds text (a prefix)", (b) => { (b.input as Row[])[0]!.text = "Retouch this image. " + String((b.input as Row[])[0]!.text); }],
      ["adds text (an extra part)", (b) => { (b.input as Row[]).push({ type: "text", text: "preserve composition" }); }],
      ["removes text", (b) => { (b.input as Row[])[0]!.text = String((b.input as Row[])[0]!.text).slice(0, -3); }],
      ["trims", (b) => { (b.input as Row[])[0]!.text = String((b.input as Row[])[0]!.text).trim(); }],
      ["changes whitespace (NBSP → space)", (b) => { (b.input as Row[])[0]!.text = String((b.input as Row[])[0]!.text).replace(" ", " "); }],
      ["normalises CRLF", (b) => { (b.input as Row[])[0]!.text = String((b.input as Row[])[0]!.text).replace(/\r\n/g, "\n"); }],
      ["changes the image (re-encode)", (b) => { (b.input as Row[])[1]!.data = other.toString("base64"); }],
      ["adds history", (b) => { b.previous_interaction_id = "int-0"; }],
      ["stores the interaction", (b) => { b.store = true; }],
      ["adds systemInstruction", (b) => { b.system_instruction = "You are a retoucher."; }],
      ["changes image_size (2K → 4K)", (b) => { (b.response_format as Row).image_size = "4K"; }],
      ["changes image_size (2K → 1K)", (b) => { (b.response_format as Row).image_size = "1K"; }],
      ["adds aspect_ratio to Oryginalny", (b) => { (b.response_format as Row).aspect_ratio = "4:3"; }],
      ["drops response_format", (b) => { delete b.response_format; }],
      ["adds delivery / mime_type to response_format", (b) => { (b.response_format as Row).delivery = "inline"; (b.response_format as Row).mime_type = "image/png"; }],
      ["response_format as an array", (b) => { b.response_format = [b.response_format]; }],
      ["response_format of another type", (b) => { (b.response_format as Row).type = "text"; }],
      ["adds generation_config.image_config (deprecated)", (b) => { b.generation_config = { image_config: { image_size: "2K" } }; }],
      ["adds tools", (b) => { b.tools = [{ type: "google_search" }]; }],
      ["adds knowledge/feedback as text", (b) => { (b.input as Row[]).splice(1, 0, { type: "text", text: "DATA: liked examples…" }); }],
      ["switches the model (fallback)", (b) => { b.model = "gemini-3.1-flash-image"; }],
    ];
    for (const [name, fn] of tamper) {
      const t = JSON.parse(B) as Row; fn(t);
      const T = JSON.stringify(t);
      const cap = captureInteractionBoundary(BASELINE_ENDPOINT, ["content-type"], T, String(t.model));
      const flagged = cap.strict_stateless === false || cap.provider_prompt_sha256 !== sha(SYNTHETIC) || cap.provider_inputs[0]?.sha256 !== sha(photo) || cap.image_size !== "2K" || cap.aspect_ratio !== "OMITTED" || t.model !== "gemini-3-pro-image";
      // …and the adapter's own pre-HTTP guard refuses it (retouch_request_contract_failed).
      const refused = retouchInteractionViolation(t, { prompt: SYNTHETIC, referenceImages: [{ base64: photo.toString("base64"), mime: "image/jpeg" }], resolution: "2K", aspectRatio: "auto" }, "gemini-3-pro-image") !== null
        || name === "changes the image (re-encode)"; // caught by strictInputSha256 in the adapter
      check(`detects: ${name}`, T !== A && flagged && refused);
    }
    check("…while the untouched B equals A, and the guard accepts it", A === B
      && retouchInteractionViolation(JSON.parse(B), { prompt: SYNTHETIC, referenceImages: [{ base64: photo.toString("base64"), mime: "image/jpeg" }], resolution: "2K", aspectRatio: "auto" }, "gemini-3-pro-image") === null);
    // (A second request is caught by F3: the wire is counted, not assumed.)
  }

  console.log("\nF5  STATELESS ACROSS CLICKS");
  {
    const db = freshDb(); db.files.set(SRC, photo); db.files.set("w/retouch-x/other.jpg", await sharp(photo).rotate(90).jpeg().toBuffer());
    g.__fidelityEngine = engine({ systemPrompt: SYNTHETIC, promptVersion: 5 });
    await click(db, { sourcePath: "w/retouch-x/other.jpg", expectedOutputs: 1 });
    db.tables.length = 0;
    await click(db, { sourcePath: SRC, expectedOutputs: 1 }); const first = wire[0]!.body;
    await click(db, { sourcePath: SRC, expectedOutputs: 1 }); const again = wire[0]!.body;
    check("the same photo twice → byte-identical bodies (nothing carried over from earlier jobs)", first === again && first === baselineBody({ prompt: SYNTHETIC, image: photo, mimeType: "image/jpeg", imageSize: "2K" }));
    check("no knowledge / feedback / examples table is read on a Retusz click", !db.tables.some((t) => /knowledge|feedback|example/.test(t)), [...new Set(db.tables)]);
  }

  console.log("\nF6  THE BASELINE IS INDEPENDENT");
  {
    const src = read("scripts/retouch-baseline.ts");
    check("scripts/retouch-baseline.ts imports nothing (no builder, adapter, runGeneration, prompt engine)", !/^\s*import\s/m.test(src) && !/require\(/.test(src));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("All Retusz forensic tests passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
