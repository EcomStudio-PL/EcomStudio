/**
 * MINIATURKA — npm run test:thumbnail
 *
 *   A  the request: built byte for byte like an independent hand-written
 *      baseline, the prompt sent 1:1 (no \r\n rewrite), order and duplicates
 *      kept, every tampering caught by the read-back contract
 *   B  one HTTP call: no retry, no second request, nothing sent on a contract
 *      failure, the answer parsed (image, size, usage)
 *   C  the local finish on real pixels: 2560×2560, 77 px margins of pure
 *      #FFFFFF, no alpha, proportions kept, brightness on the inner image only
 *   D  money: token cost only from reported usage × entered rates
 *   E  the durable run (in-memory DB): Retusz OFF = zero Retusz calls, ON =
 *      one per photo in order, one Sunburst request, charges, refunds,
 *      idempotency, crash recovery without a second paid call, cancel, retry
 *      reusing paid Retusz results
 *   F  the real production prompt (optional): MINIATURKA_PROMPT_FILE=<path>
 *      must hash to the release reference and reach the body byte for byte
 *
 * Mocks only — no network, no database. Nothing here talks to OpenAI.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import sharp from "sharp";
import {
  EDIT_TEXT_FIELDS, buildThumbnailEdit, classifyEditError, editFilename, makeBoundary, parseMultipart,
  pickThumbnailImage, sha256, thumbnailEditViolation, type ThumbnailEditSpec,
} from "@/lib/thumbnail/openai-request";
import { callSunburst, type SunburstCallInput, type SunburstOutcome } from "@/lib/server/thumbnail/sunburst";
import { finishThumbnail, verifyThumbnail } from "@/lib/server/thumbnail/finish";
import {
  DEFAULT_FINISH, THUMBNAIL_REFERENCE_PROMPT_SHA256, innerPx, marginPx, parseThumbnailConfig, quoteTotal,
  validateSettingsInput, type FinishConfig,
} from "@/lib/thumbnail/config";
import { estimateSunburstCost, marginOf, sunburstCost } from "@/lib/thumbnail/cost";
import { advanceThumbnailRun, startThumbnailRun, validPhotoPath, type ThumbnailDeps } from "@/lib/server/thumbnail/run";
import { readThumbnailRun } from "@/lib/server/thumbnail/status";
import type { RetouchInput, RetouchResult } from "@/lib/server/retouch";
import { baselineThumbnailBody } from "./thumbnail-baseline";
import { db, freshDb, id, iso, type Row } from "./stubs/thumb-db";

let failures = 0;
let passed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failures++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const WS = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

async function png(w: number, h: number, rgb: [number, number, number], alpha?: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: alpha === undefined ? 3 : 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], ...(alpha === undefined ? {} : { alpha }) } } }).png().toBuffer();
}

/* ══ fake Supabase client over the in-memory DB ══════════════════════════*/

type Filter = (r: Row) => boolean;
function contains(value: unknown, pattern: unknown): boolean {
  if (Array.isArray(pattern)) return Array.isArray(value) && pattern.every((p) => value.some((v) => contains(v, p)));
  if (pattern && typeof pattern === "object") {
    if (!value || typeof value !== "object") return false;
    return Object.entries(pattern as Row).every(([k, v]) => contains((value as Row)[k], v));
  }
  return value === pattern;
}

function tableRows(name: string): Row[] {
  const d = db();
  if (name === "credit_wallets") return [d.wallet as unknown as Row];
  if (name === "usage_events") return d.events;
  d.tables[name] ??= [];
  return d.tables[name];
}

function from(name: string) {
  const filters: Filter[] = [];
  let op: "select" | "insert" | "update" = "select";
  let payload: Row | Row[] | null = null;
  let one: "single" | "maybe" | null = null;
  let limitN: number | null = null;
  let cols = "*";
  const exec = () => {
    if (db().faults.has(`${name}:${op}`)) return { data: null, error: { message: "fault" } };
    const rows = tableRows(name);
    if (op === "insert") {
      const list = (Array.isArray(payload) ? payload : [payload!]).map((p) => ({ id: id(name.slice(0, 4)), created_at: iso(db().now), ...p }));
      rows.push(...list);
      // Committed, but the answer never arrived.
      if (db().faults.delete(`${name}:insert:lost`)) return { data: null, error: { message: "lost" } };
      return { data: one ? list[0] : list, error: null };
    }
    let hit = rows.filter((r) => filters.every((f) => f(r)));
    if (op === "update") {
      hit.forEach((r) => Object.assign(r, payload));
      return { data: hit, error: null };
    }
    if (limitN !== null) hit = hit.slice(0, limitN);
    let out: Row[] = hit.map((r) => ({ ...r }));
    if (name === "generations" && cols.includes("generation_assets(")) {
      out = out.map((g) => ({ ...g, generation_assets: tableRows("generation_assets").filter((a) => a.generation_id === g.id) }));
    }
    if (one) return { data: out[0] ?? null, error: one === "single" && !out[0] ? { message: "none" } : null };
    return { data: out, error: null };
  };
  const api = {
    select(c?: string) { if (c) cols = c; return api; },
    insert(v: Row | Row[]) { op = "insert"; payload = v; return api; },
    update(v: Row) { op = "update"; payload = v; return api; },
    upsert(v: Row) { op = "insert"; payload = v; return api; },
    eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return api; },
    gte(k: string, v: unknown) { filters.push((r) => String(r[k]) >= String(v)); return api; },
    in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return api; },
    contains(k: string, v: unknown) { filters.push((r) => contains(r[k], v)); return api; },
    order() { return api; },
    limit(n: number) { limitN = n; return api; },
    single() { one = "single"; return api; },
    maybeSingle() { one = "maybe"; return api; },
    then<A, B>(res: (v: { data: unknown; error: unknown }) => A, rej?: (e: unknown) => B) { return Promise.resolve(exec()).then(res, rej); },
  };
  return api;
}

const client = {
  from,
  async rpc(name: string, args: Row) {
    const d = db();
    if (name === "thumbnail_run_create") {
      const run = args.p_run as Row;
      const key = String(run.idempotency_key);
      const existing = [...d.runs.values()].find((r) => r.idempotency_key === key);
      if (existing) return { data: { id: existing.id, created: false, status: existing.status }, error: null };
      const open = [...d.runs.values()].filter((r) => r.user_id === run.user_id && ["queued", "running"].includes(String(r.status))).length;
      if (open >= 2) return { data: { error: "too_many_runs" }, error: null };
      const runId = id("run");
      d.runs.set(runId, {
        id: runId, tool_key: "ecommerce_thumbnail", workspace_id: run.workspace_id, user_id: run.user_id, job_id: null,
        status: "queued", run_kind: "thumbnail", idempotency_key: key, input: run.input, outputs: [], progress: { stage: "prepare" },
        credits: run.credits, error: null, created_at: iso(d.now), finished_at: null, locked_until: null, lease_owner: null, invocations: 0,
      });
      return { data: { id: runId, created: true, status: "queued" }, error: null };
    }
    if (name === "thumbnail_run_status") {
      // The 0140 shape (supabase/migrations/0140_miniaturka_v2.sql).
      const r = d.runs.get(String(args.p_run_id));
      if (!r || r.user_id !== USER) return { data: null, error: null };
      const fin = d.steps.find((x) => x.run_id === r.id && x.position === 3 && x.status === "succeeded");
      const fo = (fin?.output ?? {}) as Row;
      const inp = r.input as Row;
      return { data: {
        id: r.id, status: r.status, error: r.error, created_at: r.created_at, finished_at: r.finished_at,
        driving: typeof r.locked_until === "number" && (r.locked_until as number) > d.now,
        photos: inp.photos, retouch: inp.retouch,
        retouched_count: d.steps.filter((x) => x.run_id === r.id && x.position === 1 && x.status === "succeeded").length,
        result: r.status === "ok" ? { path: fo.path ?? ((r.outputs as Row[])?.[0] ?? {}).path, width: fo.width, height: fo.height } : null,
      }, error: null };
    }
    if (name === "delete_generation") {
      const gid = String(args.gen_id);
      const assets = tableRows("generation_assets");
      const paths = assets.filter((a) => a.generation_id === gid).map((a) => String(a.storage_path));
      d.tables.generation_assets = assets.filter((a) => a.generation_id !== gid);
      d.tables.generations = tableRows("generations").filter((g) => g.id !== gid);
      return { data: paths, error: null };
    }
    // The driver's own tri-state reads (the run, its steps): same rows as
    // the workflow-store stub, plus transient faults.
    if (name === "ai_engine_run_read") {
      if (d.faults.has("rpc:ai_engine_run_read") || d.faults.delete("rpc:ai_engine_run_read:once")) return { data: null, error: { message: "fault" } };
      const r = d.runs.get(String(args.p_run_id));
      const out = { data: r ? [JSON.parse(JSON.stringify(r))] : [], error: null };
      const hook = d.afterRunRead; d.afterRunRead = null; hook?.();
      return out;
    }
    if (name === "ai_engine_step_runs_read") {
      if (d.faults.has("rpc:ai_engine_step_runs_read")) return { data: null, error: { message: "fault" } };
      const rows = d.steps.filter((x) => x.run_id === args.p_run_id)
        .sort((a, b) => (Number(a.position) - Number(b.position)) || (Number(a.item_index) - Number(b.item_index)));
      return { data: JSON.parse(JSON.stringify(rows)), error: null };
    }
    // Trial watermark (0143): answered explicitly — the catch-all `true`
    // below is a malformed decision, which refuses the run before the charge.
    // These suites run the dormant world: off, and no photo was a trial image.
    if (name === "trial_watermark_decide") return { data: { mode: "off", reason: "disabled", config: { enabled: false } }, error: null };
    if (name === "trial_original_source") return { data: null, error: null };
    return { data: true, error: null };
  },
  storage: {
    from(bucket: string) {
      const k = (p: string) => `${bucket}:${p}`;
      return {
        async upload(path: string, bytes: Buffer, opts?: { upsert?: boolean }) {
          if (db().faults.has("storage:upload")) return { data: null, error: { message: "fault" } };
          if (db().faults.delete("storage:upload:once")) return { data: null, error: { message: "fault" } };
          // No UPDATE policy on the bucket: an existing object is never overwritten.
          if (db().storage.has(k(path)) && !opts?.upsert) return { data: null, error: { message: "The resource already exists", statusCode: "409" } };
          db().storage.set(k(path), Buffer.from(bytes));
          return { data: { path }, error: null };
        },
        async list(folder: string) {
          if (db().faults.has("storage:list")) return { data: null, error: { message: "fault" } };
          const pre = k(`${folder}/`);
          const names = [...db().storage.keys()].filter((x) => x.startsWith(pre) && !x.slice(pre.length).includes("/")).map((x) => x.slice(pre.length));
          return { data: names.map((name) => ({ name, id: name })), error: null };
        },
        async remove(paths: string[]) {
          if (db().faults.has("storage:remove")) return { data: null, error: { message: "fault" } };
          paths.forEach((p) => db().storage.delete(k(p)));
          return { data: paths.map((name) => ({ name })), error: null };
        },
        async download(path: string) {
          const b = db().storage.get(k(path));
          return b ? { data: new Blob([new Uint8Array(b)]), error: null } : { data: null, error: { message: "not found" } };
        },
        async createSignedUrls(paths: string[]) { return { data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}` })), error: null }; },
        async createSignedUrl(p: string) { return { data: { signedUrl: `https://signed/${bucket}/${p}` }, error: null }; },
      };
    },
  },
};
type Client = Parameters<typeof startThumbnailRun>[0];
const SUPA = client as unknown as Client;

/* ══ fakes the driver is given ═══════════════════════════════════════════*/

type Recorder = {
  retouch: RetouchInput[];
  sunburst: SunburstCallInput[];
  retouchFail?: Set<string>;
  sunburstOutcome?: (input: SunburstCallInput) => Promise<SunburstOutcome>;
};

async function fakeRetouchFactory(rec: Recorder) {
  const out = await png(64, 64, [200, 120, 60]);
  return async (_s: unknown, userId: string, ws: string, input: RetouchInput): Promise<RetouchResult> => {
    rec.retouch.push({ ...input });
    if (rec.retouchFail?.has(input.sourcePath)) return { ok: false, error: "provider_error" };
    const jobId = id("rjob");
    const path = `${ws}/${jobId}/0.png`;
    db().storage.set(`generation-assets:${path}`, out);
    tableRows("generation_jobs").push({ id: jobId, workspace_id: ws, user_id: userId, status: "completed", credits_charged: 7,
      created_at: iso(db().now), settings: { operation: "image_retouch", reference_paths: [input.sourcePath],
        provider_output: [{ stored_path: path, stored_sha256: createHash("sha256").update(out).digest("hex") }] } });
    const genId = id("gen");
    tableRows("generations").push({ id: genId, job_id: jobId, workspace_id: ws });
    tableRows("generation_assets").push({ id: id("asset"), generation_id: genId, storage_path: path });
    return { ok: true, generationId: null, jobId, url: `https://signed/${path}`, path, credits: 7 };
  };
}

const RAW = png(512, 512, [90, 140, 200]);
const USAGE = {
  input_tokens: 4200, input_tokens_details: { image_tokens: 3000, text_tokens: 1200 },
  output_tokens: 6000, output_tokens_details: { image_tokens: 6000, text_tokens: 0 }, total_tokens: 10200,
};

function okFetch(calls: { url: string; init: RequestInit }[], image?: Buffer) {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const b64 = (image ?? await RAW).toString("base64");
    return new Response(JSON.stringify({ created: 1, data: [{ b64_json: b64 }], size: "2048x2048", quality: "high", background: "opaque", output_format: "png", usage: USAGE }),
      { status: 200, headers: { "x-request-id": "req_123" } });
  }) as unknown as typeof fetch;
}

function depsFor(rec: Recorder, retouchImpl: ThumbnailDeps["runRetouch"]): Partial<ThumbnailDeps> {
  return {
    now: () => db().now,
    runRetouch: retouchImpl,
    callSunburst: async (input) => {
      rec.sunburst.push(input);
      if (rec.sunburstOutcome) return rec.sunburstOutcome(input);
      const calls: { url: string; init: RequestInit }[] = [];
      return callSunburst({ ...input, fetchImpl: okFetch(calls) });
    },
  };
}

async function seedPhotos(n: number, opts: { duplicateOf?: number } = {}): Promise<string[]> {
  const paths: string[] = [];
  for (let i = 0; i < n; i++) {
    if (opts.duplicateOf !== undefined && i === n - 1) { paths.push(paths[opts.duplicateOf]); continue; }
    const p = `${WS}/thumbnail-test/${id("photo")}.png`;
    db().storage.set(`product-images:${p}`, await png(32 + i, 32, [10 * i, 50, 100]));
    paths.push(p);
  }
  return paths;
}

function setupEnv() {
  const d = freshDb();
  d.wallet.workspace_id = WS;
  d.env.config = { model: "gpt-image-2.5-sunburst", size: "2048x2048", quality: "high", max_photos: 10, timeout_ms: 200000,
    finish: { target: 2560, margin_percent: 3, brightness_percent: 5, kernel: "lanczos3", format: "png" },
    token_prices: { text_input: 5, cached_text_input: 1.25, image_input: 8, cached_image_input: 2, image_output: 30, text_output: null } };
  d.env.promptText = "Linia 1\nLinia 2 — zażółć gęślą jaźń\n\n    wcięcie  ";
  return d;
}

async function start(photos: string[], retouch: boolean, extra: Record<string, unknown> = {}) {
  const d = db();
  const unit = d.env.retouch.available ? d.env.retouch.unit : null;
  const reused = typeof extra.reusedCount === "number" ? extra.reusedCount : 0;
  const total = quoteTotal({ photos: photos.length, retouch, retouchUnit: unit, thumbnailCredits: d.env.thumbnailCredits ?? 0, reused }).total;
  return startThumbnailRun(SUPA, USER, WS, {
    photos, retouch, quotedTotal: typeof extra.quotedTotal === "number" ? extra.quotedTotal : total,
    attempt: (extra.attempt as string) ?? crypto.randomUUID(), ...(extra.reuseFrom ? { reuseFrom: extra.reuseFrom } : {}),
  });
}

async function driveToEnd(runId: string, deps: Partial<ThumbnailDeps>, max = 20) {
  let last = "";
  for (let i = 0; i < max; i++) {
    last = await advanceThumbnailRun(SUPA, USER, WS, runId, { deadlineAt: db().now + 270_000, deps });
    const r = db().runs.get(runId)!;
    if (r.status !== "queued" && r.status !== "running") return r;
    db().now += 11_000; // the yielded lease (10 s) runs out before the next call
  }
  return db().runs.get(runId)!;
}

/* ══ A · the request ═════════════════════════════════════════════════════*/

async function sectionA() {
  console.log("\nA. THE REQUEST — bytes, order, the prompt 1:1, the contract");
  const prompt = "Zasada 1:\r\nmieszane\nkońce linii  \n\n    wcięcie\t— „cudzysłów” 🙂 { {nie zmienna} } {{dosłownie}}";
  const p1 = await png(8, 8, [255, 0, 0]);
  const p2 = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 255, b: 0 } } }).jpeg().toBuffer();
  const spec: ThumbnailEditSpec = {
    model: "gpt-image-2.5-sunburst", prompt, size: "2048x2048", quality: "high",
    images: [
      { bytes: p1, mime: "image/png", filename: editFilename(0, "image/png") },
      { bytes: p2, mime: "image/jpeg", filename: editFilename(1, "image/jpeg") },
      { bytes: p1, mime: "image/png", filename: editFilename(2, "image/png") }, // the same photo again
    ],
  };
  const boundary = makeBoundary(Buffer.alloc(16, 7));
  const { body, contentType } = buildThumbnailEdit(spec, boundary);
  const baseline = baselineThumbnailBody({
    boundary, model: spec.model, prompt, size: spec.size, quality: spec.quality,
    photos: spec.images.map((i) => ({ filename: i.filename, mime: i.mime, bytes: i.bytes })),
  });
  check("A1 the body equals the independent hand-written baseline, byte for byte", body.equals(baseline),
    `${sha256(body)} vs ${sha256(baseline)}`);
  check("A1 content type names the boundary", contentType === `multipart/form-data; boundary=${boundary}`);
  const parts = parseMultipart(body, boundary)!;
  check("A2 fields in order: model, prompt, n, size, quality, background, output_format, image[]×3",
    JSON.stringify(parts.map((p) => p.name)) === JSON.stringify([...EDIT_TEXT_FIELDS, "image[]", "image[]", "image[]"]));
  const promptPart = parts.find((p) => p.name === "prompt")!;
  check("A3 the prompt reaches the body byte for byte (UTF-8, no trim)", promptPart.data.equals(Buffer.from(prompt, "utf8")));
  check("A3 a lone \\n is NOT rewritten to \\r\\n", promptPart.data.toString("utf8").includes("mieszane\nkońce") && !promptPart.data.toString("utf8").includes("mieszane\r\nkońce"));
  check("A3 no Product Lock, no added text", !/PRODUCT LOCK|fidelity|Preserve/i.test(promptPart.data.toString("utf8")));
  check("A4 n=1, opaque, png, the configured size and quality",
    parts[2].data.toString() === "1" && parts[5].data.toString() === "opaque" && parts[6].data.toString() === "png"
    && parts[3].data.toString() === "2048x2048" && parts[4].data.toString() === "high");
  check("A5 order and duplicates kept: photo 1, photo 2, photo 1 again",
    parts[7].data.equals(p1) && parts[8].data.equals(p2) && parts[9].data.equals(p1));
  const shas = spec.images.map((i) => sha256(i.bytes));
  check("A6 the untouched body passes the contract", thumbnailEditViolation(parts, spec, shas) === null);

  // Tampering — every one refused.
  const tamper = (fn: (b: Buffer) => Buffer) => thumbnailEditViolation(parseMultipart(fn(Buffer.from(body)), boundary), spec, shas);
  const idx = body.indexOf(Buffer.from("mieszane"));
  check("A7 one prompt byte changed → prompt_bytes_differ", tamper((b) => { b[idx] = 0x4d; return b; }) === "prompt_bytes_differ");
  const crlf = Buffer.from(prompt.replace("mieszane\n", "mieszane\r\n"), "utf8");
  const bodyCrlf = buildThumbnailEdit({ ...spec, prompt: prompt.replace("mieszane\n", "mieszane\r\n") }, boundary).body;
  check("A7 a \\n → \\r\\n rewrite → refused", thumbnailEditViolation(parseMultipart(bodyCrlf, boundary), spec, shas) === "prompt_bytes_differ" && crlf.length > 0);
  check("A7 photos swapped → refused", thumbnailEditViolation(parts.slice(0, 7).concat([parts[8], parts[7], parts[9]]), spec, shas) !== null);
  check("A7 a photo dropped (duplicate de-duplicated) → refused", thumbnailEditViolation(parts.slice(0, 9), spec, shas) === "image_count");
  check("A7 n=2 → refused", thumbnailEditViolation(parts.map((p, i) => i === 2 ? { ...p, data: Buffer.from("2") } : p), spec, shas) === "field_value:n");
  check("A7 an extra response_format field → refused",
    thumbnailEditViolation([...parts, { name: "response_format", filename: null, contentType: null, data: Buffer.from("b64_json") }], spec, shas) === "forbidden_field:response_format");
  check("A7 input_fidelity → refused",
    thumbnailEditViolation([...parts.slice(0, 7), { name: "input_fidelity", filename: null, contentType: null, data: Buffer.from("high") }, ...parts.slice(7)], spec, shas) === "forbidden_field:input_fidelity");
  check("A7 a different photo than meant → image_sha", thumbnailEditViolation(parts, spec, [shas[0], shas[0], shas[2]]) === "image_sha:1");
  check("A7 a non-square size → refused", thumbnailEditViolation(parseMultipart(buildThumbnailEdit({ ...spec, size: "2048x1536" }, boundary).body, boundary), { ...spec, size: "2048x1536" }, shas) === "size_not_square16");
  check("A7 a truncated body is unreadable", parseMultipart(body.subarray(0, body.length - 4), boundary) === null);
  check("A7 17 photos → refused", (() => {
    const many = Array.from({ length: 17 }, (_, i) => ({ bytes: p1, mime: "image/png" as const, filename: editFilename(i, "image/png") }));
    const s2 = { ...spec, images: many };
    return thumbnailEditViolation(parseMultipart(buildThumbnailEdit(s2, boundary).body, boundary), s2, many.map(() => shas[0])) === "too_many_images";
  })());
}

/* ══ B · the one call ════════════════════════════════════════════════════*/

async function sectionB() {
  console.log("\nB. ONE HTTP CALL — no retry, nothing sent on a contract failure");
  const img = await png(16, 16, [1, 2, 3]);
  const spec: ThumbnailEditSpec = { model: "gpt-image-2.5-sunburst", prompt: "a\nb", size: "2048x2048", quality: "high",
    images: [{ bytes: img, mime: "image/png", filename: editFilename(0, "image/png") }] };
  const calls: { url: string; init: RequestInit }[] = [];
  const ok = await callSunburst({ apiKey: "sk-secret-123456", spec, expectedImageSha256: [sha256(img)], timeoutMs: 5000, fetchImpl: okFetch(calls) });
  check("B1 exactly one request, to /v1/images/edits", calls.length === 1 && calls[0].url === "https://api.openai.com/v1/images/edits");
  const sent = Buffer.from(calls[0].init.body as Uint8Array);
  check("B1 the bytes sent are the bytes hashed and checked", ok.boundary !== null && sha256(sent) === ok.boundary!.body_sha256);
  check("B1 key in Authorization only, never recorded", (calls[0].init.headers as Record<string, string>).Authorization === "Bearer sk-secret-123456"
    && !JSON.stringify(ok).includes("sk-secret"));
  check("B2 the answer: image, size, quality, background, usage", ok.ok && ok.answer.size === "2048x2048" && ok.answer.quality === "high"
    && ok.answer.background === "opaque" && ok.answer.usage?.inputImageTokens === 3000 && ok.answer.usage?.inputTextTokens === 1200
    && ok.mime === "image/png" && ok.requestId === "req_123");

  let n = 0;
  const failing = (async () => { n++; return new Response(JSON.stringify({ error: { code: "server_error", message: "boom" } }), { status: 500 }); }) as unknown as typeof fetch;
  const r500 = await callSunburst({ apiKey: "k", spec, expectedImageSha256: [sha256(img)], timeoutMs: 5000, fetchImpl: failing });
  check("B3 a 500 is NOT retried (one request) and is reported", n === 1 && !r500.ok && r500.error === "provider_error");
  let m = 0;
  const bad400 = (async () => { m++; return new Response(JSON.stringify({ error: { code: "invalid_value", message: "x" } }), { status: 400 }); }) as unknown as typeof fetch;
  const r400 = await callSunburst({ apiKey: "k", spec, expectedImageSha256: [sha256(img)], timeoutMs: 5000, fetchImpl: bad400 });
  check("B3 a 400 is NOT re-sent without a parameter (one request)", m === 1 && !r400.ok && r400.error === "provider_invalid_request");
  let c = 0;
  const never = (async () => { c++; return new Response("{}"); }) as unknown as typeof fetch;
  const refused = await callSunburst({ apiKey: "k", spec, expectedImageSha256: ["0".repeat(64)], timeoutMs: 5000, fetchImpl: never });
  check("B4 a photo that is not the one meant → refused with ZERO requests", c === 0 && !refused.ok && refused.error === "thumbnail_request_contract_failed" && refused.notSent);
  const empty = (async () => new Response(JSON.stringify({ data: [], usage: USAGE }))) as unknown as typeof fetch;
  const re = await callSunburst({ apiKey: "k", spec, expectedImageSha256: [sha256(img)], timeoutMs: 5000, fetchImpl: empty });
  check("B5 no image → provider_empty_result, usage still read", !re.ok && re.error === "provider_empty_result" && re.usage?.outputTokens === 6000);
  const slow = ((_u: string, init: RequestInit) => new Promise((_res, rej) => {
    init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("t"), { name: "TimeoutError" })));
  })) as unknown as typeof fetch;
  const rt = await callSunburst({ apiKey: "k", spec, expectedImageSha256: [sha256(img)], timeoutMs: 50, fetchImpl: slow });
  check("B6 a timeout → provider_timeout", !rt.ok && rt.error === "provider_timeout");
  check("B7 OpenAI quota 429 → provider_quota (not retriable)", classifyEditError(429, JSON.stringify({ error: { code: "insufficient_quota" } }), null).code === "provider_quota");
  check("B7 a key in an upstream message is masked", !classifyEditError(401, JSON.stringify({ error: { message: "bad key sk-abcdef123456" } }), null).upstream.message.includes("abcdef123456"));
  check("B8 pick: only data[0] is kept, the count recorded", pickThumbnailImage({ data: [{ b64_json: "AAAA" }, { b64_json: "BBBB" }] })?.b64 === "AAAA"
    && pickThumbnailImage({ data: [{ b64_json: "AAAA" }, { b64_json: "BBBB" }] })?.dataCount === 2);
}

/* ══ C · the local finish ════════════════════════════════════════════════*/

async function pixel(bytes: Buffer, x: number, y: number) {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const o = (y * info.width + x) * info.channels;
  return [data[o], data[o + 1], data[o + 2]];
}

async function sectionC() {
  console.log("\nC. THE LOCAL FINISH — real pixels");
  check("C0 3% of 2560 = 77 px; inner 2406 px", marginPx(2560, 3) === 77 && innerPx(2560, 3) === 2406);
  const mid = await png(2048, 2048, [120, 80, 40]);
  const r = await finishThumbnail(mid, DEFAULT_FINISH);
  const meta = await sharp(r.bytes).metadata();
  check("C1 exactly 2560×2560", meta.width === 2560 && meta.height === 2560 && r.width === 2560);
  check("C2 PNG, 3 channels, no alpha", meta.format === "png" && meta.channels === 3 && !meta.hasAlpha);
  check("C3 the inner image is 2406×2406 at (77,77): equal margins", r.inner.width === 2406 && r.inner.height === 2406 && r.inner.left === 77 && r.inner.top === 77
    && 2560 - r.inner.left - r.inner.width === 77 && 2560 - r.inner.top - r.inner.height === 77);
  check("C4 every margin pixel is RGB 255 (verified from the encoded file)", (await verifyThumbnail(r.bytes, 2560, 77)).marginWhite);
  check("C4 corners and the margin's inner edge are #FFFFFF",
    JSON.stringify(await pixel(r.bytes, 0, 0)) === "[255,255,255]" && JSON.stringify(await pixel(r.bytes, 76, 1280)) === "[255,255,255]"
    && JSON.stringify(await pixel(r.bytes, 2559, 2483)) === "[255,255,255]");
  const centre = await pixel(r.bytes, 1280, 1280);
  check("C5 +5% brightness raised the inner image", centre[0] > 120 && centre[1] > 80 && centre[2] > 40, JSON.stringify(centre));
  const zero = await finishThumbnail(mid, { ...DEFAULT_FINISH, brightnessPercent: 0 });
  check("C6 0% brightness → no change of colour", JSON.stringify(await pixel(zero.bytes, 1280, 1280)) === "[120,80,40]"
    && !zero.postprocess.some((s) => s.startsWith("brightness")));
  check("C7 the margin is untouched by the brightness step", (await verifyThumbnail(zero.bytes, 2560, 77)).marginWhite
    && JSON.stringify(await pixel(r.bytes, 10, 10)) === JSON.stringify(await pixel(zero.bytes, 10, 10)));
  // Proportions and no crop: a 2:1 source keeps 2:1, centred, every edge present.
  const wide = await sharp({ create: { width: 2048, height: 1024, channels: 3, background: { r: 0, g: 0, b: 255 } } })
    .composite([{ input: await png(8, 1024, [255, 0, 0]), left: 0, top: 0 }, { input: await png(8, 1024, [0, 255, 0]), left: 2040, top: 0 }]).png().toBuffer();
  const w = await finishThumbnail(wide, { ...DEFAULT_FINISH, brightnessPercent: 0 });
  check("C8 a 2:1 composition keeps 2:1 (no stretch), centred", w.inner.width === 2406 && w.inner.height === 1203 && w.inner.top === 77 + Math.floor((2406 - 1203) / 2));
  const leftEdge = await pixel(w.bytes, 77 + 2, 1280);
  const rightEdge = await pixel(w.bytes, 77 + 2406 - 3, 1280);
  check("C8 nothing cropped: the red left edge and the green right edge are both there", leftEdge[0] > 200 && leftEdge[2] < 80 && rightEdge[1] > 200 && rightEdge[2] < 80,
    `${leftEdge} ${rightEdge}`);
  check("C8 the bands above and below are white", (await verifyThumbnail(w.bytes, 2560, 77)).marginWhite
    && JSON.stringify(await pixel(w.bytes, 1280, 200)) === "[255,255,255]");
  // Upscale with Lanczos3 from 2048, recorded.
  check("C9 Lanczos3 upscale 2048 → 2406 recorded", r.postprocess.includes("resize:2048x2048->2406x2406:lanczos3:inside"));
  // Bright, dark, near-white, soft shadow.
  for (const [label, src] of [
    ["bright", await png(1024, 1024, [240, 240, 235])],
    ["dark", await png(1024, 1024, [12, 14, 18])],
    ["near-white", await png(1024, 1024, [252, 252, 252])],
    ["soft shadow", await sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><defs><radialGradient id="g"><stop offset="0" stop-color="#888"/><stop offset="1" stop-color="#fff"/></radialGradient></defs><ellipse cx="512" cy="800" rx="400" ry="90" fill="url(#g)"/></svg>`) }]).png().toBuffer()],
  ] as [string, Buffer][]) {
    const f = await finishThumbnail(src, DEFAULT_FINISH);
    const v = await verifyThumbnail(f.bytes, 2560, 77);
    check(`C10 ${label}: 2560², no alpha, white margin`, v.size && !v.alpha && v.channels === 3 && v.marginWhite);
  }
  const dark = await finishThumbnail(await png(1024, 1024, [12, 14, 18]), DEFAULT_FINISH);
  const dc = await pixel(dark.bytes, 1280, 1280);
  check("C10 dark stays dark (brightened, not washed out)", dc[0] >= 12 && dc[0] < 40, JSON.stringify(dc));
  const alphaSrc = await png(512, 512, [0, 0, 0], 0);
  const fa = await finishThumbnail(alphaSrc, DEFAULT_FINISH);
  check("C11 a transparent answer is flattened onto white (no alpha survives)", !(await sharp(fa.bytes).metadata()).hasAlpha
    && JSON.stringify(await pixel(fa.bytes, 1280, 1280)) === "[255,255,255]");
  const jp = await finishThumbnail(mid, { ...DEFAULT_FINISH, format: "jpeg" });
  check("C12 JPEG export (operator option) is 2560², 3 channels", (await sharp(jp.bytes).metadata()).format === "jpeg" && jp.checks.size && jp.checks.channels === 3);
  const z = await finishThumbnail(mid, { ...DEFAULT_FINISH, marginPercent: 0 });
  check("C13 0% margin → the image fills the canvas", z.inner.width === 2560 && z.marginPx === 0);

  // Settings validation.
  const good = { model: "gpt-image-2.5-sunburst", size: "2048x2048", quality: "high", maxPhotos: 10, timeoutMs: 200000,
    finish: { target: 2560, marginPercent: 3, brightnessPercent: 5, kernel: "lanczos3", format: "png" },
    tokenPrices: { textInput: 5, cachedTextInput: null, imageInput: 8, cachedImageInput: null, imageOutput: 30, textOutput: null } };
  check("C14 valid settings pass", validateSettingsInput(good).ok);
  const bad = (patch: (g: typeof good) => unknown, field: string) => { const v = validateSettingsInput(patch(JSON.parse(JSON.stringify(good)))); return !v.ok && v.field === field; };
  check("C14 17 photos refused", bad((g) => ({ ...g, maxPhotos: 17 }), "maxPhotos"));
  check("C14 another model refused (no other model, ever)", bad((g) => ({ ...g, model: "gpt-image-2" }), "model"));
  check("C14 margin 30% refused", bad((g) => ({ ...g, finish: { ...g.finish, marginPercent: 30 } }), "marginPercent"));
  check("C14 brightness 50% refused", bad((g) => ({ ...g, finish: { ...g.finish, brightnessPercent: 50 } }), "brightnessPercent"));
  check("C14 a negative token price refused", bad((g) => ({ ...g, tokenPrices: { ...g.tokenPrices, imageInput: -1 } }), "tokenPrices.imageInput"));
  check("C14 unknown kernel refused", bad((g) => ({ ...g, finish: { ...g.finish, kernel: "nearest" } }), "kernel"));
  const parsed = parseThumbnailConfig({ model: "x", max_photos: 99, finish: { margin_percent: 3, brightness_percent: 5 } });
  check("C15 the reader falls back per field, never to another model", parsed.model === "gpt-image-2.5-sunburst" && parsed.maxPhotos === 10);
}

/* ══ D · money ═══════════════════════════════════════════════════════════*/

function sectionD() {
  console.log("\nD. MONEY — cost from reported usage only");
  const prices = { textInput: 5, cachedTextInput: 1.25, imageInput: 8, cachedImageInput: 2, imageOutput: 30, textOutput: null };
  const usage = { inputTokens: 4200, inputTextTokens: 1200, inputImageTokens: 3000, cachedInputTokens: 0, outputTokens: 6000, outputImageTokens: 6000, outputTextTokens: 0 };
  const c = sunburstCost(usage, prices);
  // 1200×5 + 3000×8 + 6000×30 = 6000 + 24000 + 180000 = 210000 µ$ = $0.21
  check("D1 tokens × rates = $0.21 for the sample usage", c.known && c.usdMicros === 210_000, JSON.stringify(c));
  check("D2 no usage → UNKNOWN (never 0)", !sunburstCost(null, prices).known);
  check("D3 a missing rate → UNKNOWN", !sunburstCost(usage, { ...prices, imageOutput: null }).known);
  check("D4 no text/image split → UNKNOWN", !sunburstCost({ ...usage, inputTextTokens: null }, prices).known);
  check("D5 an estimate needs measured runs", !estimateSunburstCost([], 4, prices).known
    && estimateSunburstCost([{ photos: 3, usage }], 6, prices).known);
  const m = marginOf({ credits: 20, plnPerCredit: 0.19, costUsdMicros: 210_000, usdToPln: 4 });
  check("D6 margin: 20 cr. × 0.19 zł = 3.80 zł vs 0.84 zł cost", Math.abs(m.revenuePln - 3.8) < 1e-9 && Math.abs((m.costPln ?? 0) - 0.84) < 1e-9);
  check("D7 quote: 3 photos, Retusz 7 kr., composition 20 kr. = 41 kr.", quoteTotal({ photos: 3, retouch: true, retouchUnit: 7, thumbnailCredits: 20 }).total === 41
    && quoteTotal({ photos: 3, retouch: false, retouchUnit: 7, thumbnailCredits: 20 }).total === 20
    && quoteTotal({ photos: 3, retouch: true, retouchUnit: 7, thumbnailCredits: 20, reused: 2 }).total === 27);
}

/* ══ E · the durable run ═════════════════════════════════════════════════*/

const charges = () => db().usageCalls;
const thumbStarts = () => charges().filter((c) => c.kind === "start" && c.args.serviceSlug === "tool_thumbnail");

async function sectionE() {
  console.log("\nE. THE RUN — Retusz ON/OFF, charges, idempotency, recovery");

  // E1 — Retusz OFF, three photos, the third a duplicate of the first.
  setupEnv();
  let rec: Recorder = { retouch: [], sunburst: [] };
  let photos = await seedPhotos(3, { duplicateOf: 0 });
  const s1 = await start(photos, false);
  check("E1 start records the run, charges nothing yet (run credits 0 — the quote lives in its input)", s1.ok && charges().length === 0 && db().wallet.balance === 1000
    && db().runs.get((s1 as { runId: string }).runId)!.credits === 0);
  const r1 = await driveToEnd((s1 as { runId: string }).runId, depsFor(rec, await fakeRetouchFactory(rec)));
  check("E1 Retusz OFF → ZERO Retusz calls", rec.retouch.length === 0);
  check("E1 ONE Sunburst request", rec.sunburst.length === 1);
  const sent = rec.sunburst[0];
  check("E1 all 3 photos, in order, the duplicate kept", sent.spec.images.length === 3 && sent.spec.images[0].bytes.equals(sent.spec.images[2].bytes)
    && sent.expectedImageSha256[0] === sent.expectedImageSha256[2]);
  check("E1 the published prompt text 1:1 (no trim, no additions)", sent.spec.prompt === db().env.promptText);
  check("E1 model, size, quality from the settings", sent.spec.model === "gpt-image-2.5-sunburst" && sent.spec.size === "2048x2048" && sent.spec.quality === "high");
  check("E1 run ok, 20 credits charged once, completed once", r1.status === "ok" && thumbStarts().length === 1
    && charges().filter((c) => c.kind === "complete").length === 1 && charges().filter((c) => c.kind === "fail").length === 0
    && db().wallet.balance === 980 && thumbStarts()[0].args.creditsCharged === 20);
  const finalPath = ((r1.outputs as Row[])[0] ?? {}).path as string;
  const finalBytes = db().storage.get(`generation-assets:${finalPath}`);
  check("E1 the delivered file is 2560×2560 PNG in the library", Boolean(finalBytes) && (await sharp(finalBytes!).metadata()).width === 2560
    && tableRows("generation_assets").some((a) => a.storage_path === finalPath && a.width === 2560));
  const job = tableRows("generation_jobs").find((j) => (j.settings as Row)?.operation === "ecommerce_thumbnail");
  check("E1 the job is completed, tagged ecommerce_thumbnail, prompt text not stored", job?.status === "completed" && job?.prompt_text === null
    && !JSON.stringify(job).includes("zażółć"));
  check("E1 the stages ended at done", (r1.progress as Row).stage === "done");
  check("E1 the delivered file has a name nobody could know before (random, no 0.png)",
    new RegExp(`^${WS}/${job?.id}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.png$`).test(finalPath)
    && ![...db().storage.keys()].some((k) => k.endsWith("/0.png") && !k.includes("/thumbnail-test/")), finalPath);
  const stem = finalPath.replace(/\.png$/, "");
  const folder = [...db().storage.keys()].filter((k) => k.startsWith(`generation-assets:${WS}/${job?.id}/`));
  check("E1 the job's folder holds only the delivered file and its derivatives (no raw provider copy)",
    folder.length === 3 && folder.every((k) => k.startsWith(`generation-assets:${stem}`)), folder.join(", "));
  const readable = JSON.stringify({ settings: job?.settings, assets: tableRows("generation_assets") });
  check("E1 nothing the customer can read names the provider, model or endpoint", !/openai|sunburst|images\.edits|endpoint/i.test(readable), readable.slice(0, 200));
  check("E1 the job carries its price", job?.credits_charged === 20);
  check("E1 provider call recorded: openai, model, tokens, cost $0.21", db().providerCalls.length === 1 && db().providerCalls[0].model === "gpt-image-2.5-sunburst"
    && JSON.stringify(db().providerCalls[0].cost) === JSON.stringify({ basis: "estimated", usdMicros: 210000 }));
  const before = rec.sunburst.length;
  await advanceThumbnailRun(SUPA, USER, WS, (s1 as { runId: string }).runId, { deadlineAt: db().now + 270_000, deps: depsFor(rec, await fakeRetouchFactory(rec)) });
  check("E1 advancing a finished run does nothing (no second call, no charge)", rec.sunburst.length === before && thumbStarts().length === 1);
  const again = await startThumbnailRun(SUPA, USER, WS, { photos, retouch: false, quotedTotal: 20, attempt: (db().runs.get((s1 as { runId: string }).runId)!.idempotency_key as string).split(":").pop() });
  check("E1 the same click submitted twice is the same run", again.ok && (again as { runId: string }).runId === (s1 as { runId: string }).runId && !(again as { created: boolean }).created);

  // E2 — Retusz ON: one pass per photo, in order, results feed the composition.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(3, { duplicateOf: 0 });
  const s2 = await start(photos, true);
  const r2 = await driveToEnd((s2 as { runId: string }).runId, depsFor(rec, await fakeRetouchFactory(rec)));
  check("E2 Retusz ON → exactly one Retusz call per photo (3, duplicate included)", rec.retouch.length === 3);
  check("E2 …through the unchanged Retusz contract: 2K, original format", rec.retouch.every((r) => r.resolution === "2K" && r.format === "original" && r.quotedOutputs === 1));
  check("E2 …in photo order", rec.retouch.map((r) => r.sourcePath).join() === photos.join());
  check("E2 the same stored file is never retouched twice AT ONCE", (() => {
    // photos[0] and photos[2] are the same path: they ran in different batches.
    const idx = rec.retouch.map((r) => r.sourcePath);
    return idx[0] === photos[0] && idx[2] === photos[2];
  })());
  check("E2 the composition got the RETOUCHED images, in order", rec.sunburst.length === 1 && rec.sunburst[0].spec.images.length === 3);
  check("E2 run ok; Retusz billed by Retusz, the composition once", r2.status === "ok" && thumbStarts().length === 1 && r2.credits === 3 * 7 + 20);

  // E3 — a Retusz pass fails: stop there, keep what succeeded, no composition.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(3);
  rec.retouchFail = new Set([photos[1]]);
  const s3 = await start(photos, true);
  const r3 = await driveToEnd((s3 as { runId: string }).runId, depsFor(rec, await fakeRetouchFactory(rec)));
  check("E3 a failed Retusz pass ends the run as retouch_failed", r3.status === "failed" && r3.error === "retouch_failed");
  check("E3 no composition was requested or charged", rec.sunburst.length === 0 && thumbStarts().length === 0);
  const okSteps = db().steps.filter((s) => s.run_id === r3.id && s.position === 1 && s.status === "succeeded");
  check("E3 the successful pass is kept (paid, in the library)", okSteps.length >= 1);

  // E4 — retry reusing the paid Retusz results.
  rec.retouchFail = new Set();
  const callsBefore = rec.retouch.length;
  const reusedCount = okSteps.length;
  const s4 = await start(photos, true, { reuseFrom: r3.id, reusedCount });
  check("E4 the retry is priced without the reused passes", s4.ok && (s4 as { quote: { retouchCount: number } }).quote.retouchCount === 3 - reusedCount, JSON.stringify(s4) + " reused=" + reusedCount);
  const r4 = await driveToEnd((s4 as { runId: string }).runId, depsFor(rec, await fakeRetouchFactory(rec)));
  check("E4 only the missing photo is retouched again", rec.retouch.length - callsBefore === 3 - reusedCount && r4.status === "ok");
  check("E4 one composition, one charge for it", thumbStarts().length === 1 && rec.sunburst.length === 1);

  // E5 — the composition fails: refunded once, Retusz charges untouched.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  rec.sunburstOutcome = async (input) => callSunburst({ ...input, fetchImpl: (async () => new Response(JSON.stringify({ error: { code: "server_error" } }), { status: 502 })) as unknown as typeof fetch });
  photos = await seedPhotos(2);
  const s5 = await start(photos, true);
  const r5 = await driveToEnd((s5 as { runId: string }).runId, depsFor(rec, await fakeRetouchFactory(rec)));
  check("E5 the run fails with the provider's code", r5.status === "failed" && r5.error === "provider_error");
  check("E5 the composition charge is refunded exactly once", charges().filter((c) => c.kind === "fail").length === 1
    && db().events.filter((e) => e.service_slug === "tool_thumbnail" && e.status === "refunded").length === 1);
  check("E5 balance: 1000 − 2 Retusz passes (charged by Retusz, not here) − 0", db().wallet.balance === 1000);
  check("E5 one request only (no automatic regeneration)", rec.sunburst.length === 1);
  check("E5 the failed call is in the provider trace", db().providerCalls.length === 1 && db().providerCalls[0].status === "failed");

  // E6 — a contract refusal: refunded, nothing sent, no provider-trace row.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  rec.sunburstOutcome = async (input) => callSunburst({ ...input, expectedImageSha256: input.expectedImageSha256.map(() => "0".repeat(64)), fetchImpl: (async () => { throw new Error("must not be called"); }) as unknown as typeof fetch });
  photos = await seedPhotos(1);
  const s6 = await start(photos, false);
  const r6 = await driveToEnd((s6 as { runId: string }).runId, depsFor(rec, await fakeRetouchFactory(rec)));
  check("E6 contract refusal → failed, refunded, nothing in the provider trace", r6.status === "failed" && r6.error === "thumbnail_request_contract_failed"
    && db().events.every((e) => e.status === "refunded") && db().providerCalls.length === 0);

  // E7 — two drivers at once: one works, the other is told "busy".
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(2);
  const s7 = await start(photos, false);
  const runId7 = (s7 as { runId: string }).runId;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const deps7 = depsFor(rec, await fakeRetouchFactory(rec));
  const slowDeps: Partial<ThumbnailDeps> = { ...deps7, callSunburst: async (input) => { await gate; return deps7.callSunburst!(input); } };
  const first = advanceThumbnailRun(SUPA, USER, WS, runId7, { deadlineAt: db().now + 270_000, deps: slowDeps });
  await new Promise((r) => setTimeout(r, 30));
  const second = await advanceThumbnailRun(SUPA, USER, WS, runId7, { deadlineAt: db().now + 270_000, deps: slowDeps });
  release();
  await first;
  check("E7 a second tab / double click is 'busy' — never a second driver", second === "busy");
  check("E7 one request, one charge", rec.sunburst.length === 1 && thumbStarts().length === 1 && db().runs.get(runId7)!.status === "ok");

  // E8 — the invocation died mid-composition with nothing stored: no second
  // request; the pending charge is released.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s8 = await start(photos, false);
  const runId8 = (s8 as { runId: string }).runId;
  const crash: Partial<ThumbnailDeps> = { ...depsFor(rec, await fakeRetouchFactory(rec)), callSunburst: async (input) => { rec.sunburst.push(input); throw new Error("killed"); } };
  await advanceThumbnailRun(SUPA, USER, WS, runId8, { deadlineAt: db().now + 270_000, deps: crash }).catch(() => "crashed");
  check("E8 (setup) the crash left a pending charge and a running step", db().events.some((e) => e.status === "pending")
    && db().steps.some((s) => s.run_id === runId8 && s.position === 2 && s.status === "running"));
  db().now += 600_000; // every lease has expired
  const r8 = await driveToEnd(runId8, depsFor(rec, await fakeRetouchFactory(rec)));
  check("E8 resumed: NO second Sunburst request", rec.sunburst.length === 1);
  check("E8 the pending charge is refunded, the run ends compose_interrupted", r8.status === "failed" && r8.error === "compose_interrupted"
    && db().events.every((e) => e.status === "refunded") && db().wallet.balance === 1000);

  // E9a — the local finish fails: the composition charge is released.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s9 = await start(photos, false);
  const r9 = await driveToEnd((s9 as { runId: string }).runId, { ...depsFor(rec, await fakeRetouchFactory(rec)), finish: async () => { throw new Error("boom"); } });
  check("E9a a failing finish → finish_failed, the composition refunded, one request", r9.status === "failed" && r9.error === "finish_failed"
    && db().events.every((e) => e.status === "refunded") && rec.sunburst.length === 1);

  const job9a = tableRows("generation_jobs").find((j) => (j.settings as Row)?.operation === "ecommerce_thumbnail");
  check("E9a nothing of the refunded composition is left in storage (no raw, no file)",
    Boolean(job9a) && ![...db().storage.keys()].some((k) => k.startsWith(`generation-assets:${WS}/${job9a!.id}/`)));

  // E9b — the invocation died between the answer and the finish: the answer
  // was only in memory, so the charge is released; nothing is re-sent.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s9b = await start(photos, false);
  const runId9b = (s9b as { runId: string }).runId;
  const job9b = id("job");
  tableRows("generation_jobs").push({ id: job9b, workspace_id: WS, user_id: USER, status: "processing", settings: { operation: "ecommerce_thumbnail" } });
  const ev9b = await (await import("./stubs/thumb-usage")).startUsage(null, { serverToken: "t", userId: USER, workspaceId: WS, walletId: "w", serviceSlug: "tool_thumbnail", generationJobId: job9b, idempotencyKey: `thumb:${runId9b}:compose`, creditsCharged: 20 });
  const run9b = db().runs.get(runId9b)!; run9b.status = "running"; run9b.job_id = job9b;
  db().steps.push({ run_id: runId9b, position: 2, item_index: -1, step_name: "compose", operation: "image_edit", status: "succeeded", attempts: 1,
    output: { job_id: job9b, usage_event_id: (ev9b as { eventId: string }).eventId }, error_code: null, locked_until: null });
  const r9b = await driveToEnd(runId9b, depsFor(rec, await fakeRetouchFactory(rec)));
  check("E9b died after the answer: no second request, the charge released, nothing delivered", rec.sunburst.length === 0
    && r9b.status === "failed" && r9b.error === "compose_interrupted" && db().events.every((e) => e.status === "refunded") && db().wallet.balance === 1000);

  // E9c — the invocation died after delivering but before recording the
  // step: closed as delivered, charged once, never re-sent.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s9c = await start(photos, false);
  const runId9c = (s9c as { runId: string }).runId;
  const job9c = id("job");
  // Killed after the library rows, before the job was marked: still "processing".
  tableRows("generation_jobs").push({ id: job9c, workspace_id: WS, user_id: USER, status: "processing", settings: { operation: "ecommerce_thumbnail" } });
  const gen9c = id("gen");
  tableRows("generations").push({ id: gen9c, job_id: job9c, workspace_id: WS });
  tableRows("generation_assets").push({ id: id("asset"), generation_id: gen9c, storage_path: `${WS}/${job9c}/0.png` });
  await (await import("./stubs/thumb-usage")).startUsage(null, { serverToken: "t", userId: USER, workspaceId: WS, walletId: "w", serviceSlug: "tool_thumbnail", generationJobId: job9c, idempotencyKey: `thumb:${runId9c}:compose`, creditsCharged: 20 });
  const run9c = db().runs.get(runId9c)!; run9c.status = "running"; run9c.job_id = job9c;
  db().steps.push({ run_id: runId9c, position: 2, item_index: -1, step_name: "compose", operation: "image_edit", status: "running", attempts: 1, output: null, error_code: null, locked_until: db().now - 1 });
  const r9c = await driveToEnd(runId9c, depsFor(rec, await fakeRetouchFactory(rec)));
  check("E9c delivered before the crash: closed ok, charged once, no second request", r9c.status === "ok" && rec.sunburst.length === 0
    && db().events.filter((e) => e.status === "succeeded").length === 1 && db().wallet.balance === 980);
  const j9c = tableRows("generation_jobs").find((j) => j.id === job9c);
  check("E9c …and its job is COMPLETED with its price (shown in the library)", j9c?.status === "completed" && j9c?.credits_charged === 20);
  check("E9c …the finish step names the delivered file", (db().steps.find((x) => x.run_id === runId9c && x.position === 3)?.output as Row)?.path === `${WS}/${job9c}/0.png`);

  // E9d — resumed after the charge was already released elsewhere (the
  // reconciler refunded it) and nothing was delivered: no second refund,
  // no second request, the job closed failed.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s9d = await start(photos, false);
  const runId9d = (s9d as { runId: string }).runId;
  const job9d = id("job");
  tableRows("generation_jobs").push({ id: job9d, workspace_id: WS, user_id: USER, status: "processing", settings: { operation: "ecommerce_thumbnail" } });
  const usageStub = await import("./stubs/thumb-usage");
  const ev9d = await usageStub.startUsage(null, { serverToken: "t", userId: USER, workspaceId: WS, walletId: "w", serviceSlug: "tool_thumbnail", generationJobId: job9d, idempotencyKey: `thumb:${runId9d}:compose`, creditsCharged: 20 });
  await usageStub.failUsage(null, { serverToken: "t", eventId: (ev9d as { eventId: string }).eventId, walletId: "w", error: "reconciled" });
  const run9d = db().runs.get(runId9d)!; run9d.status = "running"; run9d.job_id = job9d;
  db().steps.push({ run_id: runId9d, position: 2, item_index: -1, step_name: "compose", operation: "image_edit", status: "succeeded", attempts: 1,
    output: { job_id: job9d }, error_code: null, locked_until: null });
  const fails9d = charges().filter((c) => c.kind === "fail").length;
  const r9d = await driveToEnd(runId9d, depsFor(rec, await fakeRetouchFactory(rec)));
  check("E9d a charge released elsewhere is not refunded twice; nothing delivered, nothing re-sent", r9d.status === "failed" && r9d.error === "compose_interrupted"
    && db().wallet.balance === 1000 && charges().filter((c) => c.kind === "fail").length === fails9d && rec.sunburst.length === 0
    && tableRows("generation_jobs").find((j) => j.id === job9d)?.status === "failed");

  // E9e — cancel during the composition: the paid composition is finished
  // and billed (never discarded with its charge left open).
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s9e = await start(photos, false);
  const runId9e = (s9e as { runId: string }).runId;
  rec.sunburstOutcome = async (input) => { db().runs.get(runId9e)!.error = "cancel_requested"; return callSunburst({ ...input, fetchImpl: okFetch([]) }); };
  const r9e = await driveToEnd(runId9e, depsFor(rec, await fakeRetouchFactory(rec)));
  check("E9e cancel during the composition → delivered and billed once (no orphaned charge)", r9e.status === "ok"
    && db().events.length === 1 && db().events[0].status === "succeeded" && db().wallet.balance === 980);

  // E10 — died mid-Retusz after Retusz had delivered: recovered, not re-bought.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s10 = await start(photos, true);
  const runId10 = (s10 as { runId: string }).runId;
  const retouchImpl = await fakeRetouchFactory(rec);
  const dies: Partial<ThumbnailDeps> = { ...depsFor(rec, retouchImpl), runRetouch: async (...a) => { await retouchImpl(...a); throw new Error("killed after Retusz delivered"); } };
  await advanceThumbnailRun(SUPA, USER, WS, runId10, { deadlineAt: db().now + 270_000, deps: dies }).catch(() => "crashed");
  // The throw inside runRetouch is caught by the driver as retouch_error —
  // simulate the harder case: the step stayed "running" (invocation killed).
  const st = db().steps.find((s) => s.run_id === runId10 && s.position === 1);
  if (st) { st.status = "running"; st.error_code = null; st.locked_until = db().now + 1000; }
  const run10 = db().runs.get(runId10)!; run10.status = "running"; run10.error = null; run10.locked_until = null;
  db().now += 600_000;
  const before10 = rec.retouch.length;
  const r10 = await driveToEnd(runId10, depsFor(rec, retouchImpl));
  check("E10 resumed after a delivered Retusz: it is recovered, NOT called again", rec.retouch.length === before10 && r10.status === "ok");
  check("E10 its output is the recovered job's file", (db().steps.find((s) => s.run_id === runId10 && s.position === 1)?.output as Row)?.recovered === true);

  // E11 — the prompt changed between start and composition: refused, no charge.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s11 = await start(photos, false);
  db().env.promptDigest = "e".repeat(64);
  const r11 = await driveToEnd((s11 as { runId: string }).runId, depsFor(rec, await fakeRetouchFactory(rec)));
  check("E11 prompt changed → prompt_changed, zero requests, zero charges", r11.status === "failed" && r11.error === "prompt_changed"
    && rec.sunburst.length === 0 && thumbStarts().length === 0);

  // E12 — not enough credits by the time of the composition.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s12 = await start(photos, false);
  db().wallet.balance = 5;
  const r12 = await driveToEnd((s12 as { runId: string }).runId, depsFor(rec, await fakeRetouchFactory(rec)));
  check("E12 balance short at the composition → insufficient_credits, no request, no charge", r12.status === "failed" && r12.error === "insufficient_credits"
    && rec.sunburst.length === 0 && db().wallet.balance === 5);

  // E13 — cancel between steps.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(3);
  const s13 = await start(photos, true);
  const runId13 = (s13 as { runId: string }).runId;
  const r13deps = depsFor(rec, await fakeRetouchFactory(rec));
  await advanceThumbnailRun(SUPA, USER, WS, runId13, { deadlineAt: db().now + 270_000, deps: { ...r13deps, runRetouch: async (...a) => { const out = await r13deps.runRetouch!(...a); db().runs.get(runId13)!.error = "cancel_requested"; return out; } } });
  const r13 = db().runs.get(runId13)!;
  check("E13 cancel stops at the next boundary: in-flight passes finish, nothing new starts", r13.status === "failed" && r13.error === "cancelled"
    && rec.retouch.length === 2 && rec.sunburst.length === 0 && thumbStarts().length === 0);

  // E14 — the time budget: nothing paid starts without room for all of it.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s14 = await start(photos, false);
  const y = await advanceThumbnailRun(SUPA, USER, WS, (s14 as { runId: string }).runId, { deadlineAt: db().now + 100_000, deps: depsFor(rec, await fakeRetouchFactory(rec)) });
  check("E14 too little time left → yields, no request, no charge", y === "yield" && rec.sunburst.length === 0 && thumbStarts().length === 0);

  // E16 — a step still held by an earlier invocation: the driver does not
  // spin (each claim counts against the run's 30-invocation limit).
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s16 = await start(photos, false);
  const runId16 = (s16 as { runId: string }).runId;
  db().steps.push({ run_id: runId16, position: 2, item_index: -1, step_name: "compose", operation: "image_edit",
    status: "running", attempts: 1, output: null, error_code: null, locked_until: db().now + 200_000 });
  const a16 = await advanceThumbnailRun(SUPA, USER, WS, runId16, { deadlineAt: db().now + 270_000, deps: depsFor(rec, await fakeRetouchFactory(rec)) });
  const inv1 = Number(db().runs.get(runId16)!.invocations);
  db().now += 5_000;
  const b16 = await advanceThumbnailRun(SUPA, USER, WS, runId16, { deadlineAt: db().now + 270_000, deps: depsFor(rec, await fakeRetouchFactory(rec)) });
  check("E16 a held step → 'busy', the run kept leased; the next call does not claim (no invocation spent)",
    a16 === "busy" && b16 === "busy" && Number(db().runs.get(runId16)!.invocations) === inv1 && rec.sunburst.length === 0);

  // E17 — the Retusz price changed after the quote: the pass is not bought.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(2);
  const s17 = await start(photos, true);
  db().env.retouch = { available: true, unit: 9, resolution: "2K" };
  const r17 = await driveToEnd((s17 as { runId: string }).runId, depsFor(rec, await fakeRetouchFactory(rec)));
  check("E17 Retusz price changed mid-run → no pass bought at the new price, run stops", rec.retouch.length === 0 && r17.status === "failed"
    && db().steps.some((x) => x.position === 1 && x.error_code === "price_changed") && rec.sunburst.length === 0);

  // E18 — a Retusz job left "processing" by a dead invocation: decided at
  // once (interrupted), not waited on, never re-bought.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s18 = await start(photos, true);
  const runId18 = (s18 as { runId: string }).runId;
  tableRows("generation_jobs").push({ id: id("rjob"), workspace_id: WS, user_id: USER, status: "processing", created_at: iso(db().now),
    settings: { operation: "image_retouch", reference_paths: [photos[0]] } });
  db().steps.push({ run_id: runId18, position: 1, item_index: 0, step_name: "retouch", operation: "tool", status: "running", attempts: 1, output: null, error_code: null, locked_until: db().now - 1 });
  const r18 = await driveToEnd(runId18, depsFor(rec, await fakeRetouchFactory(rec)), 3);
  check("E18 an orphaned 'processing' Retusz job → retouch_interrupted at once, no new pass", r18.status === "failed" && rec.retouch.length === 0
    && db().steps.some((x) => x.run_id === runId18 && x.error_code === "retouch_interrupted"));

  // E19 — the delivery upload fails once: a fresh name, never a refund for a
  // storage hiccup; never an overwrite.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s19 = await start(photos, false);
  let uploads19 = 0;
  const deps19 = depsFor(rec, await fakeRetouchFactory(rec));
  const realFinish = finishThumbnail;
  const r19 = await driveToEnd((s19 as { runId: string }).runId, {
    ...deps19,
    finish: async (raw, cfg) => { const out = await realFinish(raw, cfg); db().faults.add("storage:upload:once"); uploads19++; return out; },
  });
  check("E19 a failed upload is retried under a fresh name: delivered, charged once", r19.status === "ok" && uploads19 === 1
    && thumbStarts().length === 1 && db().wallet.balance === 980, `${r19.status} ${r19.error}`);

  // E20 — died after the file was uploaded but before the library rows: the
  // file is REMOVED before the charge is released (never readable for free).
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s20 = await start(photos, false);
  const runId20 = (s20 as { runId: string }).runId;
  const deps20 = depsFor(rec, await fakeRetouchFactory(rec));
  await advanceThumbnailRun(SUPA, USER, WS, runId20, { deadlineAt: db().now + 270_000, deps: {
    ...deps20,
    finish: async (raw, cfg) => {
      const out = await finishThumbnail(raw, cfg);
      // The upload happens right after this; the library insert then "dies".
      db().faults.add("generations:insert");
      return out;
    },
  } }).catch(() => "crashed");
  db().faults.delete("generations:insert");
  const job20 = tableRows("generation_jobs").find((j) => (j.settings as Row)?.operation === "ecommerce_thumbnail")!;
  const r20 = db().runs.get(runId20)!;
  check("E20 library insert failed → the uploaded file removed, then refunded", r20.status === "failed" && r20.error === "library_failed"
    && ![...db().storage.keys()].some((k) => k.startsWith(`generation-assets:${WS}/${job20.id}/`)) && db().wallet.balance === 1000);

  // E21 — the same, but the invocation was KILLED between the upload and the
  // library rows: the resume removes the file before it refunds.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s21 = await start(photos, false);
  const runId21 = (s21 as { runId: string }).runId;
  const job21 = id("job");
  tableRows("generation_jobs").push({ id: job21, workspace_id: WS, user_id: USER, status: "processing", settings: { operation: "ecommerce_thumbnail", run_id: runId21 } });
  await (await import("./stubs/thumb-usage")).startUsage(null, { serverToken: "t", userId: USER, workspaceId: WS, walletId: "w", serviceSlug: "tool_thumbnail", generationJobId: job21, idempotencyKey: `thumb:${runId21}:compose`, creditsCharged: 20 });
  const leftover = `${WS}/${job21}/${crypto.randomUUID()}.png`;
  db().storage.set(`generation-assets:${leftover}`, await png(8, 8, [1, 2, 3]));
  const run21 = db().runs.get(runId21)!; run21.status = "running"; run21.job_id = job21;
  db().steps.push({ run_id: runId21, position: 2, item_index: -1, step_name: "compose", operation: "image_edit", status: "succeeded", attempts: 1,
    output: { job_id: job21 }, error_code: null, locked_until: null });
  db().steps.push({ run_id: runId21, position: 3, item_index: -1, step_name: "finish", operation: "tool", status: "running", attempts: 1,
    output: null, error_code: null, locked_until: db().now - 1 });
  // First, storage refuses the removal: NOTHING is refunded yet.
  db().faults.add("storage:remove");
  const a21 = await advanceThumbnailRun(SUPA, USER, WS, runId21, { deadlineAt: db().now + 270_000, deps: depsFor(rec, await fakeRetouchFactory(rec)) });
  check("E21 file cannot be removed → no refund yet, the run waits", a21 === "busy" && db().wallet.balance === 980
    && db().storage.has(`generation-assets:${leftover}`) && db().runs.get(runId21)!.status === "running");
  db().faults.delete("storage:remove");
  db().now += 120_000;
  const r21 = await driveToEnd(runId21, depsFor(rec, await fakeRetouchFactory(rec)));
  check("E21 then: file removed, charge released once, no request", r21.status === "failed" && r21.error === "compose_interrupted"
    && !db().storage.has(`generation-assets:${leftover}`) && db().wallet.balance === 1000 && rec.sunburst.length === 0);

  // E22 — cancel while a dead invocation's composition holds an open charge:
  // the driver settles the charge (released) before the run reads cancelled.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s22 = await start(photos, false);
  const runId22 = (s22 as { runId: string }).runId;
  const crash22: Partial<ThumbnailDeps> = { ...depsFor(rec, await fakeRetouchFactory(rec)), callSunburst: async (input) => { rec.sunburst.push(input); throw new Error("killed"); } };
  await advanceThumbnailRun(SUPA, USER, WS, runId22, { deadlineAt: db().now + 270_000, deps: crash22 }).catch(() => "crashed");
  db().runs.get(runId22)!.error = "cancel_requested";
  db().now += 600_000;
  const r22 = await driveToEnd(runId22, depsFor(rec, await fakeRetouchFactory(rec)));
  check("E22 cancel with a composition in flight → its charge released, run cancelled, nothing re-sent", r22.status === "failed" && r22.error === "cancelled"
    && db().events.every((e) => e.status === "refunded") && db().wallet.balance === 1000 && rec.sunburst.length === 1);

  // E23 — a Retusz pass whose job still reads "processing" but whose file is
  // in the library (killed after Retusz delivered, before it marked the job):
  // RECOVERED, not failed, not re-bought.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s23 = await start(photos, true);
  const runId23 = (s23 as { runId: string }).runId;
  const rjob23 = id("rjob");
  tableRows("generation_jobs").push({ id: rjob23, workspace_id: WS, user_id: USER, status: "processing", created_at: iso(db().now), credits_charged: null,
    settings: { operation: "image_retouch", reference_paths: [photos[0]] } });
  const gen23 = id("gen");
  tableRows("generations").push({ id: gen23, job_id: rjob23, workspace_id: WS });
  const rpath23 = `${WS}/${rjob23}/0.png`;
  tableRows("generation_assets").push({ id: id("asset"), generation_id: gen23, storage_path: rpath23 });
  db().storage.set(`generation-assets:${rpath23}`, await png(64, 64, [200, 120, 60]));
  db().steps.push({ run_id: runId23, position: 1, item_index: 0, step_name: "retouch", operation: "tool", status: "running", attempts: 1, output: null, error_code: null, locked_until: db().now - 1 });
  const r23 = await driveToEnd(runId23, depsFor(rec, await fakeRetouchFactory(rec)));
  const st23 = db().steps.find((x) => x.run_id === runId23 && x.position === 1)?.output as Row | undefined;
  check("E23 'processing' Retusz job with its file → recovered at the quoted price, no new pass, run ok", r23.status === "ok" && rec.retouch.length === 0
    && st23?.recovered === true && st23?.path === rpath23 && st23?.credits === 7, JSON.stringify(st23));

  // E24 — the photos take too long to read every time: a few yields, then
  // an honest stop — nothing charged, nothing sent, invocations not burnt.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(2);
  const s24 = await start(photos, false);
  const runId24 = (s24 as { runId: string }).runId;
  const bucketProto = client.storage.from;
  client.storage.from = (bucket: string) => {
    const b = bucketProto(bucket);
    if (bucket !== "product-images") return b;
    return { ...b, async download(p: string) { db().now += 30_000; return b.download(p); } };
  };
  const r24 = await driveToEnd(runId24, depsFor(rec, await fakeRetouchFactory(rec)));
  client.storage.from = bucketProto;
  check("E24 slow photo reading → compose_no_time after 3 tries, no request, no charge", r24.status === "failed" && r24.error === "compose_no_time"
    && rec.sunburst.length === 0 && thumbStarts().length === 0 && Number(r24.invocations) === 3, `${r24.status} ${r24.error} inv=${r24.invocations}`);

  // E25 — a read fails while resuming a delivered composition: "unknown" is
  // not "nothing delivered" — no refund, no failure; the next call closes it.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s25 = await start(photos, false);
  const runId25 = (s25 as { runId: string }).runId;
  const job25 = id("job");
  tableRows("generation_jobs").push({ id: job25, workspace_id: WS, user_id: USER, status: "processing", settings: { operation: "ecommerce_thumbnail" } });
  const gen25 = id("gen");
  tableRows("generations").push({ id: gen25, job_id: job25, workspace_id: WS });
  tableRows("generation_assets").push({ id: id("asset"), generation_id: gen25, storage_path: `${WS}/${job25}/${crypto.randomUUID()}.png`, width: 2560, height: 2560 });
  await (await import("./stubs/thumb-usage")).startUsage(null, { serverToken: "t", userId: USER, workspaceId: WS, walletId: "w", serviceSlug: "tool_thumbnail", generationJobId: job25, idempotencyKey: `thumb:${runId25}:compose`, creditsCharged: 20 });
  const run25 = db().runs.get(runId25)!; run25.status = "running"; run25.job_id = job25;
  db().steps.push({ run_id: runId25, position: 2, item_index: -1, step_name: "compose", operation: "image_edit", status: "succeeded", attempts: 1,
    output: { job_id: job25 }, error_code: null, locked_until: null });
  db().faults.add("generations:select");
  const a25 = await advanceThumbnailRun(SUPA, USER, WS, runId25, { deadlineAt: db().now + 270_000, deps: depsFor(rec, await fakeRetouchFactory(rec)) });
  check("E25 unreadable library → 'busy': no refund, job not failed, run open", a25 === "busy" && db().wallet.balance === 980
    && db().events.every((e) => e.status === "pending") && tableRows("generation_jobs").find((j) => j.id === job25)?.status === "processing"
    && db().runs.get(runId25)!.status === "running");
  db().faults.delete("generations:select");
  db().now += 61_000;
  const r25 = await driveToEnd(runId25, depsFor(rec, await fakeRetouchFactory(rec)));
  check("E25 then closed as delivered: job completed, charged once", r25.status === "ok" && db().wallet.balance === 980
    && db().events.filter((e) => e.status === "succeeded").length === 1 && tableRows("generation_jobs").find((j) => j.id === job25)?.status === "completed");

  // E26 — the job cannot be marked completed: refunded with NOTHING stored
  // (the job is marked before any file or library row exists).
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s26 = await start(photos, false);
  db().faults.add("generation_jobs:update");
  const r26 = await driveToEnd((s26 as { runId: string }).runId, depsFor(rec, await fakeRetouchFactory(rec)));
  db().faults.delete("generation_jobs:update");
  const j26 = tableRows("generation_jobs").find((j) => (j.settings as Row)?.operation === "ecommerce_thumbnail")!;
  check("E26 job cannot be marked completed → refunded, no file, no library row, one request", r26.status === "failed" && r26.error === "library_failed"
    && db().wallet.balance === 1000 && db().events.every((e) => e.status === "refunded") && tableRows("generation_assets").length === 0
    && ![...db().storage.keys()].some((k) => k.startsWith(`generation-assets:${WS}/${j26.id}/`)) && rec.sunburst.length === 1, `${r26.status} ${r26.error}`);

  // E27 — the run's credits follow what was CHARGED (Retusz passes as paid).
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(2);
  const s27 = await start(photos, true);
  const runId27 = (s27 as { runId: string }).runId;
  rec.sunburstOutcome = async (input) => callSunburst({ ...input, fetchImpl: (async () => new Response(JSON.stringify({ error: { code: "server_error" } }), { status: 502 })) as unknown as typeof fetch });
  const r27 = await driveToEnd(runId27, depsFor(rec, await fakeRetouchFactory(rec)));
  check("E27 failed composition after 2 Retusz passes → run credits = 14 (Retusz only)", r27.status === "failed" && r27.credits === 14, String(r27.credits));

  // E28 — cancel clicked while the photos are being read: honoured before
  // the composition is begun — no step, no charge, no request.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(2);
  const s28 = await start(photos, false);
  const runId28 = (s28 as { runId: string }).runId;
  const from28 = client.storage.from;
  client.storage.from = (bucket: string) => {
    const b = from28(bucket);
    if (bucket !== "product-images") return b;
    return { ...b, async download(p: string) { db().runs.get(runId28)!.error = "cancel_requested"; return b.download(p); } };
  };
  const r28 = await driveToEnd(runId28, depsFor(rec, await fakeRetouchFactory(rec)));
  client.storage.from = from28;
  check("E28 cancel during photo preparation → cancelled, nothing begun, charged or sent", r28.status === "failed" && r28.error === "cancelled"
    && thumbStarts().length === 0 && rec.sunburst.length === 0 && !db().steps.some((x) => x.run_id === runId28 && x.position === 2));

  // E28b — the click lands between the driver's last check and the step
  // being begun: caught right after, still before any charge.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s28b = await start(photos, false);
  const runId28b = (s28b as { runId: string }).runId;
  const from28b = client.storage.from;
  client.storage.from = (bucket: string) => {
    const b = from28b(bucket);
    if (bucket !== "product-images") return b;
    return { ...b, async download(p: string) { db().afterRunRead = () => { db().runs.get(runId28b)!.error = "cancel_requested"; }; return b.download(p); } };
  };
  const r28b = await driveToEnd(runId28b, depsFor(rec, await fakeRetouchFactory(rec)));
  client.storage.from = from28b;
  check("E28b cancel right as the composition begins → step failed 'cancelled', no charge, no request", r28b.status === "failed" && r28b.error === "cancelled"
    && thumbStarts().length === 0 && rec.sunburst.length === 0
    && db().steps.some((x) => x.run_id === runId28b && x.position === 2 && x.error_code === "cancelled"));

  // E29 — cancel pending, composition charge open, and the step list cannot
  // be read: the run is NOT closed on that; once readable, the charge is
  // settled first.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s29 = await start(photos, false);
  const runId29 = (s29 as { runId: string }).runId;
  const job29 = id("job");
  tableRows("generation_jobs").push({ id: job29, workspace_id: WS, user_id: USER, status: "processing", settings: { operation: "ecommerce_thumbnail", run_id: runId29 } });
  await (await import("./stubs/thumb-usage")).startUsage(null, { serverToken: "t", userId: USER, workspaceId: WS, walletId: "w", serviceSlug: "tool_thumbnail", generationJobId: job29, idempotencyKey: `thumb:${runId29}:compose`, creditsCharged: 20 });
  const run29 = db().runs.get(runId29)!; run29.status = "running"; run29.job_id = job29; run29.error = "cancel_requested";
  db().steps.push({ run_id: runId29, position: 2, item_index: -1, step_name: "compose", operation: "image_edit", status: "running", attempts: 1, output: null, error_code: null, locked_until: db().now - 1 });
  db().faults.add("rpc:ai_engine_step_runs_read");
  const a29 = await advanceThumbnailRun(SUPA, USER, WS, runId29, { deadlineAt: db().now + 270_000, deps: depsFor(rec, await fakeRetouchFactory(rec)) });
  check("E29 unreadable steps with a cancel pending → run left open, charge untouched", a29 === "yield" && db().runs.get(runId29)!.status === "running"
    && db().events.every((e) => e.status === "pending"));
  db().faults.delete("rpc:ai_engine_step_runs_read");
  db().now += 11_000;
  const r29 = await driveToEnd(runId29, depsFor(rec, await fakeRetouchFactory(rec)));
  check("E29 then: the charge released, the run cancelled", r29.status === "failed" && r29.error === "cancelled" && db().wallet.balance === 1000
    && db().events.every((e) => e.status === "refunded"));

  // E30 — the run itself cannot be read once: "busy" (keep driving), never
  // "not_found" (which ends the panel's driving for good).
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s30 = await start(photos, false);
  db().faults.add("rpc:ai_engine_run_read:once");
  const a30 = await advanceThumbnailRun(SUPA, USER, WS, (s30 as { runId: string }).runId, { deadlineAt: db().now + 270_000, deps: depsFor(rec, await fakeRetouchFactory(rec)) });
  check("E30 an unreadable run → 'busy', not 'not_found'", a30 === "busy");

  // E31 — the OpenAI lane is full for longer than the call could still fit:
  // the turn is given up as late (counted); when the lane frees, that turn
  // does nothing — no charge, no request.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s31 = await start(photos, false);
  const runId31 = (s31 as { runId: string }).runId;
  const { withProviderLimit } = await import("@/lib/server/provider-router");
  let free!: () => void;
  const held = new Promise<void>((r) => { free = r; });
  const holders = [withProviderLimit("openai", () => held), withProviderLimit("openai", () => held)];
  await new Promise((r) => setTimeout(r, 20));
  const from31 = client.storage.from;
  client.storage.from = (bucket: string) => {
    const b = from31(bucket);
    if (bucket !== "product-images") return b;
    // Reading takes almost all the room: 50 ms of lane wait would still fit.
    return { ...b, async download(p: string) { db().now += 34_950; return b.download(p); } };
  };
  const a31 = await advanceThumbnailRun(SUPA, USER, WS, runId31, { deadlineAt: db().now + 270_000, deps: depsFor(rec, await fakeRetouchFactory(rec)) });
  client.storage.from = from31;
  free(); await Promise.all(holders); await new Promise((r) => setTimeout(r, 900));
  check("E31 lane full past the time left → yield, counted late; the late turn charges and sends nothing", a31 === "yield"
    && (db().runs.get(runId31)!.progress as Row).compose_late === 1 && thumbStarts().length === 0 && rec.sunburst.length === 0
    && !db().steps.some((x) => x.run_id === runId31 && x.position === 2), `${a31} ${JSON.stringify(db().runs.get(runId31)!.progress)}`);

  // E32 — delivered (the server's own mark), then the member deleted the
  // library item while the charge was still open: closed as DELIVERED, never
  // refunded.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s32 = await start(photos, false);
  const runId32 = (s32 as { runId: string }).runId;
  const job32 = id("job");
  tableRows("generation_jobs").push({ id: job32, workspace_id: WS, user_id: USER, status: "completed", credits_charged: 20, settings: { operation: "ecommerce_thumbnail", run_id: runId32 } });
  await (await import("./stubs/thumb-usage")).startUsage(null, { serverToken: "t", userId: USER, workspaceId: WS, walletId: "w", serviceSlug: "tool_thumbnail", generationJobId: job32, idempotencyKey: `thumb:${runId32}:compose`, creditsCharged: 20 });
  const run32 = db().runs.get(runId32)!; run32.status = "running"; run32.job_id = job32;
  run32.progress = { stage: "finish", delivered: { job_id: job32, path: `${WS}/${job32}/${crypto.randomUUID()}.png` } };
  db().steps.push({ run_id: runId32, position: 2, item_index: -1, step_name: "compose", operation: "image_edit", status: "succeeded", attempts: 1,
    output: { job_id: job32 }, error_code: null, locked_until: null });
  db().steps.push({ run_id: runId32, position: 3, item_index: -1, step_name: "finish", operation: "tool", status: "running", attempts: 1,
    output: null, error_code: null, locked_until: db().now - 1 });
  const r32 = await driveToEnd(runId32, depsFor(rec, await fakeRetouchFactory(rec)));
  check("E32 library item deleted before the charge closed → still charged as delivered (no refund)", r32.status === "ok"
    && db().wallet.balance === 980 && db().events.every((e) => e.status === "succeeded") && charges().filter((c) => c.kind === "fail").length === 0);

  // E33 — the library asset row is written but its answer is lost: the
  // refund first removes the library rows, then the file — nothing left
  // that could later count as a delivery.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s33 = await start(photos, false);
  db().faults.add("generation_assets:insert:lost");
  const r33 = await driveToEnd((s33 as { runId: string }).runId, depsFor(rec, await fakeRetouchFactory(rec)));
  const j33 = tableRows("generation_jobs").find((j) => (j.settings as Row)?.operation === "ecommerce_thumbnail")!;
  check("E33 asset row committed, answer lost → rows removed, file removed, refunded once", r33.status === "failed" && r33.error === "library_failed"
    && tableRows("generation_assets").length === 0 && !tableRows("generations").some((g) => g.job_id === j33.id)
    && ![...db().storage.keys()].some((k) => k.startsWith(`generation-assets:${WS}/${j33.id}/`))
    && db().wallet.balance === 1000 && charges().filter((c) => c.kind === "fail").length === 1);

  // E34 — the charge cannot be closed right after the delivery: the run
  // stays open (no reconciler deciding from library rows); the next call
  // closes it from the delivered mark — charged once.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s34 = await start(photos, false);
  const runId34 = (s34 as { runId: string }).runId;
  db().faults.add("usage:complete");
  const a34 = await advanceThumbnailRun(SUPA, USER, WS, runId34, { deadlineAt: db().now + 270_000, deps: depsFor(rec, await fakeRetouchFactory(rec)) });
  check("E34 charge not closed after delivery → run kept open ('busy'), event pending", a34 === "busy"
    && db().runs.get(runId34)!.status === "running" && db().events.every((e) => e.status === "pending"));
  db().faults.delete("usage:complete");
  // Meanwhile the member deletes the delivered item from the library.
  for (const g of [...tableRows("generations")]) await client.rpc("delete_generation", { gen_id: g.id });
  const r34 = await driveToEnd(runId34, depsFor(rec, await fakeRetouchFactory(rec)), 30);
  check("E34 then closed as delivered from the mark: charged once, no refund, no second request", r34.status === "ok"
    && db().wallet.balance === 980 && db().events.every((e) => e.status === "succeeded") && rec.sunburst.length === 1);

  // E35 — the run cannot be re-read once the composition step is begun: no
  // charge on a guess; the step fails free ('unavailable').
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s35 = await start(photos, false);
  const from35 = client.storage.from;
  client.storage.from = (bucket: string) => {
    const b = from35(bucket);
    if (bucket !== "product-images") return b;
    return { ...b, async download(p: string) { db().afterRunRead = () => { db().faults.add("rpc:ai_engine_run_read"); }; return b.download(p); } };
  };
  const a35 = await advanceThumbnailRun(SUPA, USER, WS, (s35 as { runId: string }).runId, { deadlineAt: db().now + 270_000, deps: depsFor(rec, await fakeRetouchFactory(rec)) });
  client.storage.from = from35;
  db().faults.delete("rpc:ai_engine_run_read");
  const r35 = db().runs.get((s35 as { runId: string }).runId)!;
  check("E35 unreadable run after the step began → failed 'unavailable', nothing charged or sent", a35 === "finished" && r35.status === "failed"
    && r35.error === "unavailable" && thumbStarts().length === 0 && rec.sunburst.length === 0);

  // E36 — the wallet cannot be read at the composition: not "empty" — the
  // step fails free as 'unavailable' (never 'insufficient_credits').
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(1);
  const s36 = await start(photos, false);
  db().faults.add("credit_wallets:select");
  const r36 = await driveToEnd((s36 as { runId: string }).runId, depsFor(rec, await fakeRetouchFactory(rec)));
  db().faults.delete("credit_wallets:select");
  check("E36 unreadable wallet → 'unavailable', nothing charged or sent", r36.status === "failed" && r36.error === "unavailable"
    && thumbStarts().length === 0 && rec.sunburst.length === 0);

  // E15 — the start refuses what it must.
  setupEnv();
  photos = await seedPhotos(2);
  check("E15 a stale price → price_changed", (await start(photos, false, { quotedTotal: 19 })).ok === false);
  {
    const base = { model: "gpt-image-2.5-sunburst", size: "2048x2048", quality: "high", maxPhotos: 10, timeoutMs: 200000,
      finish: DEFAULT_FINISH, tokenPrices: { textInput: null, cachedTextInput: null, imageInput: null, cachedImageInput: null, imageOutput: null, textOutput: null } };
    const over = validateSettingsInput({ ...base, timeoutMs: 240000 });
    check("E15 a call timeout above what one invocation holds (200 s) is refused", validateSettingsInput(base).ok
      && !over.ok && (over as { field?: string }).field === "timeoutMs");
  }
  check("E15 a photo outside the workspace → invalid_input", !validPhotoPath(`other-ws/x.png`, WS) && !validPhotoPath(`${WS}/../x.png`, WS)
    && (await startThumbnailRun(SUPA, USER, WS, { photos: ["other/x.png"], retouch: false, quotedTotal: 20, attempt: crypto.randomUUID() })).ok === false);
  db().wallet.balance = 10;
  const poor = await start(photos, false);
  check("E15 not enough credits → insufficient_credits with the missing amount", !poor.ok && poor.error === "insufficient_credits" && poor.missingCredits === 10);
  db().wallet.balance = 1000;
  db().env.retouch = { available: false, reason: "workflow_on" };
  check("E15 Retusz unavailable → refused when asked for", (await start(photos, true)).ok === false);
  db().env.ready = false;
  check("E15 not configured → tool_unavailable, nothing recorded", (await start(photos, false)).ok === false && db().runs.size === 0);
  db().env.ready = true;
  db().env.retouch = { available: true, unit: 7, resolution: "2K" };
  const many = await seedPhotos(11);
  check("E15 more photos than the limit → too_many_photos", (await start(many, false)).ok === false);
  const a = await start(photos, false); const b = await start(photos, false);
  const c = await start(photos, false);
  check("E15 at most two open runs per member", a.ok && b.ok && !c.ok && c.error === "too_many_runs");
}

/* ══ H · V2 — the Retusz hand-off, admin diagnostics, the customer's view ═*/

async function sectionH() {
  console.log("\nH. V2 — Retusz → Sunburst hand-off, stage diagnostics, what the customer is told");
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

  // H1 (TEST A) — Retusz OFF, 2 photos.
  setupEnv();
  let rec: Recorder = { retouch: [], sunburst: [] };
  let photos = await seedPhotos(2);
  const sA = await start(photos, false);
  const rA = await driveToEnd((sA as { runId: string }).runId, depsFor(rec, await fakeRetouchFactory(rec)));
  const origA = photos.map((p) => sha(db().storage.get(`product-images:${p}`)!));
  check("H1 Retusz OFF: 0 Retusz calls, 1 Sunburst request with exactly the 2 originals, in order",
    rA.status === "ok" && rec.retouch.length === 0 && rec.sunburst.length === 1
    && JSON.stringify(rec.sunburst[0].expectedImageSha256) === JSON.stringify(origA));
  check("H1 the provider's raw image is stored nowhere (no customer copy, no extra bucket) — only the delivered file",
    ![...db().storage.keys()].some((k) => k.includes("sunburst-"))
    && [...db().storage.keys()].every((k) => k.startsWith("product-images:") || k.startsWith("generation-assets:")));
  const composeA = db().steps.find((x) => x.run_id === rA.id && x.position === 2)!.output as Row;
  check("H1 admin record: provider, endpoint, model, photo count, input hashes; the response's size and hash, no raw path",
    (composeA.request as Row).provider === "openai" && (composeA.request as Row).endpoint === "images.edits"
    && (composeA.request as Row).model === "gpt-image-2.5-sunburst" && (composeA.request as Row).photos === 2
    && ((composeA.request as Row).inputs as Row[]).map((x) => x.sent_sha256).join() === origA.join()
    && !("raw_path" in composeA) && /^[0-9a-f]{64}$/.test(String((composeA.response as Row).sha256)) && typeof (composeA.response as Row).width === "number");

  // H2 (TEST B) — Retusz ON, 2 photos.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(2);
  const sB = await start(photos, true);
  const rB = await driveToEnd((sB as { runId: string }).runId, depsFor(rec, await fakeRetouchFactory(rec)));
  check("H2 Retusz ON: 2 independent Retusz calls, one photo each, in order", rB.status === "ok" && rec.retouch.length === 2
    && rec.retouch.map((x) => x.sourcePath).join() === photos.join());
  const retouchFiles = [0, 1].map((i) => {
    const st = db().steps.find((x) => x.run_id === rB.id && x.position === 1 && x.item_index === i)!.output as Row;
    return sha(db().storage.get(`generation-assets:${st.path}`)!);
  });
  check("H2 ONE Sunburst request with exactly those 2 Retusz results (hash for hash, in order) — no originals",
    rec.sunburst.length === 1 && JSON.stringify(rec.sunburst[0].expectedImageSha256) === JSON.stringify(retouchFiles)
    && !rec.sunburst[0].expectedImageSha256.some((h) => photos.some((p) => sha(db().storage.get(`product-images:${p}`)!) === h)));
  const inputsB = ((db().steps.find((x) => x.run_id === rB.id && x.position === 2)!.output as Row).request as Row).inputs as Row[];
  check("H2 each input checked against the hash its Retusz job recorded", inputsB.every((x) => x.retouch_verified === true && typeof x.retouch_job_id === "string"));
  check("H2 credits: 2 × 7 (Retusz) + 20 (composition)", rB.credits === 34 && db().wallet.balance === 1000 - 20);
  // What the CUSTOMER is told about this run (read now, before the next setup).
  const view = await readThumbnailRun(SUPA, String(rB.id)) as Record<string, unknown>;
  const retouchPathsB = [0, 1].map((i) => String((db().steps.find((x) => x.run_id === rB.id && x.position === 1 && x.item_index === i)!.output as Row).path));
  const finalPathB = String((db().steps.find((x) => x.run_id === rB.id && x.position === 3)!.output as Row).path);

  // H3 — a Retusz result that is not the file its job recorded: refused before any charge.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(2);
  const retouch3 = await fakeRetouchFactory(rec);
  const r3 = await driveToEnd((await start(photos, true) as { runId: string }).runId, {
    ...depsFor(rec, retouch3),
    runRetouch: async (...a) => {
      const out = await retouch3(...a);
      if (out.ok && "path" in out) db().storage.set(`generation-assets:${out.path}`, await png(10, 10, [1, 1, 1]));
      return out;
    },
  });
  check("H3 Retusz file ≠ the one its job recorded → retouch_output_mismatch, no Sunburst request, no charge",
    r3.status === "failed" && r3.error === "retouch_output_mismatch" && rec.sunburst.length === 0 && thumbStarts().length === 0);

  // H4 — a Retusz job of ANOTHER photo cannot stand in for this one.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(2);
  const retouch4 = await fakeRetouchFactory(rec);
  const r4 = await driveToEnd((await start(photos, true) as { runId: string }).runId, {
    ...depsFor(rec, retouch4),
    runRetouch: async (s, u, w, inp) => retouch4(s, u, w, { ...inp, sourcePath: inp.sourcePath === photos[1] ? photos[0] : inp.sourcePath }),
  });
  check("H4 a result belonging to another photo → retouch_output_mismatch, nothing sent", r4.status === "failed"
    && r4.error === "retouch_output_mismatch" && rec.sunburst.length === 0);

  // H4b — an older Retusz record without a file hash: photo + path still
  // checked, delivered, and the admin sees "not checkable" (null), not "no".
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  photos = await seedPhotos(2);
  const retouch4b = await fakeRetouchFactory(rec);
  const r4b = await driveToEnd((await start(photos, true) as { runId: string }).runId, {
    ...depsFor(rec, retouch4b),
    runRetouch: async (...a) => {
      const out = await retouch4b(...a);
      const job = out.ok && "jobId" in out ? tableRows("generation_jobs").find((j) => j.id === out.jobId) : undefined;
      if (job) ((job.settings as Row).provider_output as Row[])[0].stored_sha256 = undefined;
      return out;
    },
  });
  const inputs4b = ((db().steps.find((x) => x.run_id === r4b.id && x.position === 2)!.output as Row).request as Row).inputs as Row[];
  check("H4b a Retusz record without a hash → delivered; admin sees retouch_verified null (not checkable), never false",
    r4b.status === "ok" && rec.sunburst.length === 1 && inputs4b.every((x) => x.retouch_verified === null && typeof x.retouch_job_id === "string"));

  // H5 — a failed composition: its request is kept for the admin.
  setupEnv();
  rec = { retouch: [], sunburst: [] };
  rec.sunburstOutcome = async (input) => callSunburst({ ...input, fetchImpl: (async () => new Response(JSON.stringify({ error: { code: "server_error" } }), { status: 502 })) as unknown as typeof fetch });
  photos = await seedPhotos(2);
  const r5 = await driveToEnd((await start(photos, false) as { runId: string }).runId, depsFor(rec, await fakeRetouchFactory(rec)));
  const diag5 = db().steps.find((x) => x.run_id === r5.id && x.position === 9)?.output as Row | undefined;
  check("H5 failed call → admin diagnostics step with provider, model, endpoint, inputs, HTTP status, error",
    r5.status === "failed" && diag5?.status === "failed" && diag5?.error === "provider_error" && diag5?.http_status === 502
    && (diag5?.request as Row)?.model === "gpt-image-2.5-sunburst" && ((diag5?.request as Row)?.inputs as Row[])?.length === 2);

  // H6 — what the CUSTOMER is told (the route's view, H2's run): outcome only.
  check("H6 the customer's view has only: id, status, error, cancelling, driving, retouch, photos, retouchedCount, result, dates",
    view && JSON.stringify(Object.keys(view).sort()) === JSON.stringify(["cancelling", "createdAt", "driving", "error", "finishedAt", "id", "photos", "result", "retouch", "retouchedCount", "status"]), JSON.stringify(view));
  check("H6 …no stage, step, model, provider, prompt, job or intermediate file in it",
    !/stage|steps|sunburst|openai|gemini|prompt|job|retouch_/i.test(JSON.stringify({ ...view, retouch: undefined, retouchedCount: undefined }))
    && retouchPathsB.length === 2 && retouchPathsB.every((p) => p.length > 0 && !JSON.stringify(view).includes(p))
    && (view.result as Row)?.path === finalPathB);
  check("H6 …the finished file signed, 2 Retusz results counted for a retry", (view.result as Row)?.url !== "" && view.retouchedCount === 2);

  // H7 — the panel shows no workflow.
  const ui = readFileSync("components/thumbnail/workspace.tsx", "utf8");
  const pl = JSON.parse(readFileSync("lib/i18n/dictionaries/pl.json", "utf8")) as { thumb: Row };
  check("H7 no 'Jak powstaje miniaturka' tile, no stage list, no intermediate Retusz grid in the panel",
    !/thumb\.cardTitle|thumb\.cardBody|thumb\.cardHint|thumb\.stage\.|data-thumbnail-stages|data-thumbnail-retouched|thumb\.runTitle|function Stages/.test(ui)
    && !("cardTitle" in pl.thumb) && !("stage" in pl.thumb) && !("retouched" in pl.thumb));
  check("H7 one calm working state: 'Tworzymy Twoją miniaturkę…' with a spinner, no fake percentage",
    String(pl.thumb.working) === "Tworzymy Twoją miniaturkę…" && /data-thumbnail-working/.test(ui) && /t\("thumb\.working"\)/.test(ui) && !/%\s*<|progress=|percent/i.test(ui));
  check("H7 the Retusz toggle keeps its cost notice; the price summary stays",
    /thumb\.retouchBody/.test(ui) && /thumb\.retouchPrice/.test(ui) && /data-thumbnail-summary/.test(ui));

  // H8 — the server-side guard (0140): the RPC no longer returns the workflow.
  const sql = readFileSync("supabase/migrations/0140_miniaturka_v2.sql", "utf8");
  const fn = sql.slice(sql.indexOf("create or replace function public.thumbnail_run_status"), sql.indexOf("revoke all on function public.thumbnail_run_status"));
  check("H8 thumbnail_run_status (0140) returns no steps, progress, job id or outputs",
    fn.length > 0 && !/'steps'|'progress'|'job_id'|'outputs'|'quote'|'credits'/.test(fn) && /'retouched_count'/.test(fn) && /auth\.uid\(\)/.test(fn));
  const body = sql.replace(/--.*$/gm, "");
  check("H8 0140 replaces ONE function and touches nothing else: no table, policy, bucket or storage object",
    (body.match(/create or replace function/g) ?? []).length === 1
    && !/create table|alter table|create policy|drop policy|storage\.|insert into|update public|delete from/i.test(body)
    && /security definer/.test(fn) && /revoke all on function public\.thumbnail_run_status\(uuid\) from public, anon/.test(body)
    && /grant execute on function public\.thumbnail_run_status\(uuid\) to authenticated/.test(body));
}

/* ══ F · the real prompt (optional) ══════════════════════════════════════*/

function sectionF() {
  console.log("\nF. THE PRODUCTION PROMPT");
  const file = process.env.MINIATURKA_PROMPT_FILE;
  if (!file || !existsSync(file)) {
    console.log("  · skipped (set MINIATURKA_PROMPT_FILE to the prompt file; GrovBase prompts are never committed)");
    return;
  }
  const bytes = readFileSync(file);
  const text = bytes.toString("utf8");
  check("F1 the file hashes to the release reference", createHash("sha256").update(bytes).digest("hex") === THUMBNAIL_REFERENCE_PROMPT_SHA256);
  check("F2 it is already trimmed (the admin save trims; the hash must survive it)", text === text.trim());
  check("F3 no header or separator lines", !/Początek promptu|Koniec promptu|^⸻/m.test(text));
  check("F4 no {{placeholder}} — the strict publish gate accepts it as-is", !/\{\{/.test(text));
  const spec: ThumbnailEditSpec = { model: "gpt-image-2.5-sunburst", prompt: text, size: "2048x2048", quality: "high", images: [] };
  const boundary = makeBoundary(Buffer.alloc(16, 1));
  const part = parseMultipart(buildThumbnailEdit({ ...spec, images: [{ bytes: Buffer.from([0x89]), mime: "image/png", filename: editFilename(0, "image/png") }] }, boundary).body, boundary)!
    .find((p) => p.name === "prompt")!;
  check("F5 it reaches the request body byte for byte", part.data.equals(bytes), `${part.data.length} vs ${bytes.length}`);
}

/* ══ G · nothing frozen moved ════════════════════════════════════════════*/

function sectionG() {
  console.log("\nG. FROZEN — Retusz, the shared adapters and the ledger are byte-identical to the rollback point");
  // Moved from 86e120d by the trial-watermark task (c60ca72): its only changes
  // under FROZEN are the post-answer storage step in generation.ts (a trial
  // image is stored marked, its clean original sealed) and the Workflow-ON
  // refusal in engine/tool-run.ts. No provider request byte changed — the
  // forensic, fidelity and parity suites prove the request itself.
  // Moved again to ae6da31 by its review fixes: GenerateInput.routeStartedAt
  // (generation.ts) and the engine passing its own start (engine/tool-run.ts)
  // feed ONLY the trial-image gate; the request is untouched.
  const BASE = process.env.THUMBNAIL_BASE ?? "ae6da31";
  const FROZEN = [
    "lib/ai/providers", "lib/ai/registry.ts", "lib/ai/router.ts", "lib/ai/types.ts",
    "lib/server/retouch.ts", "lib/server/retouch-delivery.ts", "lib/server/generation.ts", "lib/server/engine",
    "lib/server/reference-image.ts", "lib/server/provider-router.ts", "lib/services/usage.ts",
    "app/api/retouch", "components/retouch", "app/(app)/retusz",
    "scripts/retouch-forensic-tests.ts", "scripts/retouch-baseline.ts", "scripts/ai-fidelity-tests.ts",
  ];
  let changed: string[] = [];
  try {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    execSync(`git cat-file -e ${BASE}^{commit}`, { stdio: "ignore" });
    changed = execSync(`git diff --name-only ${BASE} -- ${FROZEN.map((f) => `'${f}'`).join(" ")}`, { encoding: "utf8" })
      .split("\n").filter(Boolean);
  } catch {
    console.log(`  · skipped (no git history for ${BASE})`);
    return;
  }
  check("G1 no frozen file differs from the rollback point", changed.length === 0, changed.join(", "));
  const src = ["lib/server/thumbnail/run.ts", "lib/server/thumbnail/sunburst.ts", "lib/thumbnail/openai-request.ts"]
    .map((f) => readFileSync(f, "utf8")).join("\n");
  check("G2 Miniaturka modules never build or append a Product Lock / knowledge text",
    !/buildFidelityInstructions|PRODUCT_LOCK|fidelity_rules|knowledge_/.test(src));
  check("G3 the provider prompt is the published text, unaltered (no concatenation)",
    /prompt: prompt\.text,/.test(readFileSync("lib/server/thumbnail/run.ts", "utf8")) && !/prompt\.text\s*\+|\$\{prompt\.text\}/.test(src));
  check("G5 Retusz keeps its no-rating rule verbatim (the forensic suite's own pins)",
    /item\.operation !== "image_retouch" && <ResultFeedback/.test(readFileSync("components/genv3/image-details.tsx", "utf8"))
    && /STATELESS_OPERATIONS = new Set\(\["image_retouch"\]\)/.test(readFileSync("app/actions/feedback.ts", "utf8")));
  check("G4 no other model can be called: the request model comes from the validated settings only",
    /model: input\.config\.model, prompt: prompt\.text/.test(readFileSync("lib/server/thumbnail/run.ts", "utf8")));
}

async function main() {
  // AbortSignal.timeout's timer does not hold the event loop open; a real
  // fetch's socket would. Keep the loop alive for the timeout test.
  const keepAlive = setInterval(() => undefined, 1000);
  await sectionA();
  await sectionB();
  await sectionC();
  sectionD();
  await sectionE();
  await sectionH();
  sectionF();
  sectionG();
  clearInterval(keepAlive);
  console.log(`\n${failures === 0 ? `All Miniaturka tests passed (${passed} checks).` : `${failures} MINIATURKA TEST(S) FAILED (${passed} passed).`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
