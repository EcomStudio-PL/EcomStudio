/**
 * RETUSZ FORENSIC — the real path from "Retuszuj" to the socket, compared with
 * an INDEPENDENT hand-written request (scripts/retouch-baseline.ts).
 *
 *   B = the exact string GrovBase hands to fetch, captured here, after
 *       runRetouch → runEngineImageTool → runGeneration → googleAdapter.
 *   A = baselineBody(): the same prompt, the same file, the same size — built
 *       without a single line of application code.
 *
 * A and B are compared as bytes and as structures. The admin-only
 * network-boundary record is checked against B, and the stored output against
 * the provider's final (non-thought) image.
 *
 * Run: npm run test:retouchforensic
 * Optional: RETUSZ_PROMPT_FILE=<path> also runs the chain with a real prompt
 * kept outside the repository (GrovBase prompts are never committed).
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import sharp from "sharp";
import type { EngineConfig } from "@/lib/server/ai-engine";
import { runRetouch } from "@/lib/server/retouch";
import { captureGeminiBoundary } from "@/lib/ai/providers/google-boundary";
import { baselineBody, BASELINE_ENDPOINT } from "./retouch-baseline";

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); if (detail !== undefined) console.log("      ", typeof detail === "string" ? detail.slice(0, 600) : JSON.stringify(detail).slice(0, 600)); }
}
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/* ── an in-memory PROD: one model row, the storage bucket, the job rows ───*/

type Row = Record<string, unknown>;
const PRO_ID = "m-pro";
const FB_ID = "m-fb";
type Db = { files: Map<string, Buffer>; jobs: Map<string, Row>; engineRuns: Row[]; tables: string[] };
function freshDb(): Db { return { files: new Map(), jobs: new Map(), engineRuns: [], tables: [] }; }
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
type FakeClient = Parameters<typeof runRetouch>[0];

/* ── the socket: every Google request, as the raw string that was sent ────*/

type Wire = { url: string; body: string };
let wire: Wire[] = [];
let statuses: number[] = [];
let responseParts: Row[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.includes("generativelanguage.googleapis.com")) return realFetch(input, init);
  if (typeof init?.body !== "string") throw new Error("body is not a string");
  wire.push({ url, body: init.body });
  const status = statuses.shift() ?? 200;
  if (status !== 200) return new Response(JSON.stringify({ error: { status: "UNAVAILABLE", message: "overloaded" } }), { status });
  return new Response(JSON.stringify({
    candidates: [{ finishReason: "STOP", content: { parts: responseParts } }],
    usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 1200 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const g = globalThis as unknown as { __fidelityEngine?: EngineConfig | null };
function engine(over: Partial<EngineConfig>): EngineConfig {
  return {
    toolKey: "retouch", mode: "grovbase", serviceSlug: "image_edit", allowModelChoice: false,
    fallbackEnabled: false, timeoutMs: 120_000, maxAttempts: 1, primaryModelId: PRO_ID, fallbackModelId: null,
    systemPrompt: null, promptVersion: null, knowledgeStrategy: "proven", workflowEnabled: false, ...over,
  };
}

async function run(db: Db, path: string, opts: { format: string; resolution: string }) {
  wire = [];
  const res = await runRetouch(fakeSupabase(db) as unknown as FakeClient, "u", "w", { sourcePath: path, ...opts });
  const job = [...db.jobs.values()].pop() ?? {};
  return { res, job, engineRun: db.engineRuns[db.engineRuns.length - 1] ?? {} };
}

async function main() {
  // A phone-like JPEG WITH an EXIF orientation flag (the PROD case).
  const photo = await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 170, g: 130, b: 95 } } })
    .composite([{ input: Buffer.from(`<svg width="1200" height="900"><rect x="300" y="200" width="600" height="500" fill="#234"/></svg>`), top: 0, left: 0 }])
    .jpeg({ quality: 90 }).withMetadata({ orientation: 6 }).toBuffer();
  const draft = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#f00" } }).jpeg().toBuffer();
  const final = await sharp({ create: { width: 96, height: 128, channels: 3, background: "#0a0" } }).jpeg().toBuffer();
  responseParts = [
    { text: "thinking…", thought: true },
    { inlineData: { mimeType: "image/jpeg", data: draft.toString("base64") }, thought: true },
    { inlineData: { mimeType: "image/jpeg", data: final.toString("base64") } },
  ];

  // Tricky on purpose: Polish letters, a no-break space, an en dash, CRLF,
  // brackets that look like markers, trailing spaces and a final newline.
  const SYNTHETIC = "[ZADANIE]\r\nPrzekształć zdjęcie — zachowaj produkt 1:1.\n\nDATA: none · AVOID: none  \n";
  const prompts: [string, string][] = [["synthetic", SYNTHETIC]];
  const real = process.env.RETUSZ_PROMPT_FILE;
  if (real && existsSync(real)) prompts.push(["real (RETUSZ_PROMPT_FILE)", readFileSync(real, "utf8").replace(/\n$/, "")]);

  for (const [label, PROMPT] of prompts) {
    console.log(`\nF1–F7  2K + ORYGINALNY — prompt: ${label} (${Array.from(PROMPT).length} chars, sha256 ${sha(PROMPT).slice(0, 16)}…)`);
    const db = freshDb(); db.files.set("w/retouch-x/src.jpg", photo);
    g.__fidelityEngine = engine({ systemPrompt: PROMPT, promptVersion: 5 });
    const { res, job, engineRun } = await run(db, "w/retouch-x/src.jpg", { format: "original", resolution: "2K" });
    check("the run succeeded", res.ok, res);
    check("exactly ONE HTTP request left GrovBase", wire.length === 1, wire.length);
    const B = wire[0]?.body ?? "";
    const A = baselineBody({ prompt: PROMPT, image: photo, mimeType: "image/jpeg", imageSize: "2K" });
    check("A == B byte for byte (independent baseline vs the string handed to fetch)", A === B,
      A === B ? undefined : { aBytes: A.length, bBytes: B.length, firstDiff: [...A].findIndex((c, i) => c !== B[i]) });
    check("A == B as structures", isDeepStrictEqual(JSON.parse(A), JSON.parse(B)));
    check("endpoint == the documented one (+ ?key=, never in the body)", (wire[0]?.url ?? "").split("?")[0] === BASELINE_ENDPOINT && !B.includes("test-key"), wire[0]?.url.split("?")[0]);

    const nb = (engineRun.network_boundary ?? {}) as Row;
    check("the engine run carries the network-boundary record", Object.keys(nb).length > 0, engineRun);
    check("PROMPT: published sha256 == resolved sha256 == provider sha256 == sha256(prompt)",
      nb.published_prompt_sha256 === sha(PROMPT) && nb.resolved_prompt_sha256 === sha(PROMPT) && nb.provider_prompt_sha256 === sha(PROMPT), nb);
    check("PROMPT: lengths equal at every step (chars and UTF-8 bytes)",
      nb.published_prompt_length === Array.from(PROMPT).length && nb.resolved_prompt_length === nb.published_prompt_length
      && nb.provider_prompt_length === nb.published_prompt_length && nb.provider_prompt_utf8_bytes === Buffer.byteLength(PROMPT));
    const inputs = (nb.provider_inputs ?? []) as Row[];
    check("IMAGE: stored original sha256 == sha256 inside the HTTP body == upload", nb.input_original_sha256 === sha(photo) && inputs[0]?.sha256 === sha(photo) && inputs.length === 1, { nb: nb.input_original_sha256, sent: inputs[0]?.sha256 });
    check("IMAGE: same byte count, mime image/jpeg, transform none", nb.input_original_bytes === photo.length && inputs[0]?.bytes === photo.length && inputs[0]?.mime_type === "image/jpeg" && nb.input_transform === "none");
    const sentImg = Buffer.from((JSON.parse(B).contents[0].parts[1].inlineData.data as string), "base64");
    check("IMAGE: the EXIF orientation flag is still in the bytes sent (nothing re-encoded)", (await sharp(sentImg).metadata()).orientation === 6);
    check("REQUEST: body sha256 recorded == sha256 of the string sent", nb.request_body_sha256 === sha(B) && nb.request_body_bytes === Buffer.byteLength(B));
    check("REQUEST: model gemini-3-pro-image, API v1beta, endpoint recorded without the key",
      nb.model === "gemini-3-pro-image" && nb.api_version === "v1beta" && nb.endpoint === BASELINE_ENDPOINT && !JSON.stringify(nb).includes("key="), { m: nb.model, v: nb.api_version, e: nb.endpoint });
    check("REQUEST: 1 content, role user, parts [text, inlineData], 1 text + 1 image, history 0",
      nb.contents_length === 1 && JSON.stringify(nb.roles) === '["user"]' && JSON.stringify(nb.parts_order) === '["text","inlineData"]'
      && nb.text_parts_count === 1 && nb.image_parts_count === 1 && nb.history_count === 0, nb);
    check("REQUEST: no systemInstruction, tools, toolConfig, safetySettings, cachedContent",
      !nb.system_instruction_present && !nb.tools_present && !nb.tool_config_present && !nb.safety_settings_present && !nb.cached_content_present);
    check("REQUEST: EXTRA_FIELDS = [], EXTRA_TEXT_PARTS = 0, STRICT_STATELESS = true",
      JSON.stringify(nb.extra_fields) === "[]" && nb.extra_text_parts === 0 && nb.strict_stateless === true, nb.extra_fields);
    check("CONFIG: generationConfig EXACTLY {responseModalities:[IMAGE], imageConfig:{imageSize:2K}} — no aspectRatio",
      JSON.stringify(nb.generation_config) === '{"responseModalities":["IMAGE"],"imageConfig":{"imageSize":"2K"}}', nb.generation_config);
    check("PRIVACY: the customer-readable job row holds no plain SHA-256 of the prompt and no prompt text",
      !JSON.stringify(job).includes(sha(PROMPT)) && !JSON.stringify(job).includes(PROMPT.slice(0, 20)));
    check("PRIVACY: the admin record holds no prompt text and no image bytes",
      !JSON.stringify(nb).includes(PROMPT.slice(0, 20)) && !JSON.stringify(nb).includes(photo.toString("base64").slice(0, 40)));

    const out = (((job.settings ?? {}) as Row).provider_output ?? []) as Row[];
    const stored = db.files.get(String(out[0]?.stored_path ?? ""));
    check("OUTPUT: 1 candidate, 3 parts (thought text, thought image, final image), part #2 kept",
      out[0]?.provider_candidates === 1 && (out[0]?.provider_parts as Row[] | undefined)?.length === 3 && out[0]?.provider_picked_part_index === 2, out[0]);
    check("OUTPUT: stored bytes == the provider's FINAL image, byte for byte (never the draft)", !!stored && sha(stored) === sha(final) && sha(stored) !== sha(draft));
    check("OUTPUT: provider sha256 == stored sha256, no transform after the provider",
      out[0]?.provider_sha256 === sha(final) && out[0]?.stored_equals_provider === true && out[0]?.transformed_after_provider === false);
    check("OUTPUT: the input photo is not what was stored (no blend/composite with the original)", !!stored && sha(stored) !== sha(photo));
  }

  console.log("\nF8  A CHOSEN FORMAT is sent exactly (3:4, 2K)");
  {
    const db = freshDb(); db.files.set("w/r/src.jpg", photo);
    g.__fidelityEngine = engine({ systemPrompt: SYNTHETIC, promptVersion: 5 });
    await run(db, "w/r/src.jpg", { format: "3:4", resolution: "2K" });
    const A = baselineBody({ prompt: SYNTHETIC, image: photo, mimeType: "image/jpeg", imageSize: "2K", aspectRatio: "3:4" });
    check("A == B byte for byte with aspectRatio 3:4", wire[0]?.body === A);
  }

  console.log("\nF9  ONE ATTEMPT, NO FALLBACK");
  {
    const db = freshDb(); db.files.set("w/r/src.jpg", photo);
    // Even with a fallback row assigned but fallback OFF, and a retriable 503:
    g.__fidelityEngine = engine({ systemPrompt: SYNTHETIC, promptVersion: 5, fallbackModelId: FB_ID, fallbackEnabled: false });
    statuses = [503, 200, 200];
    const { res, engineRun } = await run(db, "w/r/src.jpg", { format: "original", resolution: "2K" });
    statuses = [];
    check("a 503 is NOT retried and NOT sent to another model — exactly 1 request", wire.length === 1 && !res.ok, { n: wire.length, res });
    check("the only request went to gemini-3-pro-image", (wire[0]?.url ?? "").includes("/models/gemini-3-pro-image:generateContent"));
    const nb = (engineRun.network_boundary ?? {}) as Row;
    check("…and the failed run still records what crossed the boundary", nb.request_body_sha256 === sha(wire[0]?.body ?? ""), nb);
  }

  console.log("\nF10 THE CAPTURE IS NOT A RUBBER STAMP — it reads the string, not the builder");
  {
    const body = JSON.parse(baselineBody({ prompt: "p", image: photo, mimeType: "image/jpeg", imageSize: "2K" }));
    body.systemInstruction = { parts: [{ text: "hidden" }] };
    body.contents[0].parts.push({ text: "appended" });
    body.generationConfig.temperature = 0.2;
    body.contents.unshift({ role: "model", parts: [{ text: "earlier turn" }] });
    const nb = captureGeminiBoundary(`${BASELINE_ENDPOINT}?key=SECRET`, JSON.stringify(body), "gemini-3-pro-image");
    check("systemInstruction, an extra text part, a sampling knob and a history turn are all reported",
      nb.system_instruction_present && nb.extra_text_parts === 1 && nb.history_count === 1
      && nb.extra_fields.includes("systemInstruction") && nb.extra_fields.includes("generationConfig.temperature") && nb.strict_stateless === false, nb);
    check("the API key never lands in the record", !JSON.stringify(nb).includes("SECRET"));
  }

  console.log("\nF11 THE BASELINE IS INDEPENDENT");
  {
    const src = readFileSync(join(process.cwd(), "scripts/retouch-baseline.ts"), "utf8");
    check("scripts/retouch-baseline.ts imports nothing (no builder, adapter, runGeneration, prompt engine)", !/^\s*import\s/m.test(src) && !/require\(/.test(src));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
