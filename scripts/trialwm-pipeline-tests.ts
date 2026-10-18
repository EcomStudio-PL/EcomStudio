/**
 * TRIAL WATERMARK — THE PIPELINE. npm run test:trialwm:pipeline
 *
 *   E  the engine on real pixels: variant choice and its threshold edge, the
 *      scale cap at the asset's 3328 px, dimensions and format kept (JPEG,
 *      PNG, WebP), an EXIF-rotated photo, an alpha cutout, the metadata read
 *      back per format (PNG iTXt with its CRC), determinism, refusals, and the
 *      time a 4K Retusz file and four 2K images take (R35)
 *   C  the original at rest: seal/open and key wrap/unwrap round trips, and
 *      every tampering refused
 *   D  the decision fails closed (R2): errors, one retry on a transient one,
 *      malformed answers, null only off production
 *   P  stash / release / openTrialSource against a recording database
 *   G  runGeneration: the trial path (marked file at the normal path, the
 *      clean bytes sealed and decryptable to the exact delivered bytes,
 *      derivatives from the marked file, attach with the asset id), every
 *      failure skips and refunds, no clean byte ever reaches generation-assets,
 *      Retusz keeps its delivery and its postprocess, the off and paid paths
 *      stay byte-identical to today, the time budget
 *   M  Miniaturka: a trial composition delivered marked, its failures
 *      refunded and released, and the clean pass behind a marked Retusz tile
 *      in every state (R14)
 *   W  Workflow ON refuses a trial workspace before anything starts (R27)
 *   R  the paid tools refuse a trial workspace before the free run or a
 *      credit (D1)
 *   S  the structural pins: hook placement, lazy engine, file tracing
 *
 * Mocks only — no network, no database, no provider.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { crc32 } from "node:zlib";
import sharp from "sharp";
import { PREVIEW_EDGE, PREVIEW_QUALITY, THUMB_EDGE, THUMB_QUALITY, previewPathFor, thumbPathFor } from "@/lib/thumbs";
import { googleAdapter } from "@/lib/ai/providers/google";
import type { GenerationRequest } from "@/lib/ai/types";
import { runGeneration, type GenerateInput } from "@/lib/server/generation";
import { advanceThumbnailRun, startThumbnailRun, type ThumbnailDeps } from "@/lib/server/thumbnail/run";
import { callSunburst, type SunburstCallInput, type SunburstOutcome } from "@/lib/server/thumbnail/sunburst";
import { finishThumbnail, verifyThumbnail } from "@/lib/server/thumbnail/finish";
import { THUMBNAIL_OPERATION, quoteTotal } from "@/lib/thumbnail/config";
import type { RetouchInput, RetouchResult } from "@/lib/server/retouch";
import { deliverRetouch } from "@/lib/server/retouch-delivery";
import { runEngineImageTool, isPending } from "@/lib/server/engine/tool-run";
import { runTool } from "@/lib/server/image-tools";
import { TOOLS } from "@/lib/images/tools";
import type { EngineConfig } from "@/lib/server/ai-engine";
import {
  TRIAL_WATERMARK_TEXT, TRIAL_WATERMARK_TEXT_ASCII, TrialWatermarkError, applyTrialWatermark, markGeometry,
} from "@/lib/server/trial-watermark/engine";
import { TRIAL_WATERMARK_ASSET_HEIGHT, TRIAL_WATERMARK_ASSET_WIDTH } from "@/lib/server/trial-watermark/asset";
import { TrialOriginalCryptoError, newOriginalKey, openOriginal, sealOriginal } from "@/lib/server/trial-watermark/crypto";
import { TrialKeyError, kekFingerprint, unwrapOriginalKey, wrapOriginalKey } from "@/lib/server/trial-watermark/keys";
import {
  TRIAL_ORIGINALS_BUCKET, decideTrialWatermark, openTrialSource, releaseTrialOriginal, sealTrialOutput, stashTrialOriginal,
  type TrialMarked,
} from "@/lib/server/trial-watermark/pipeline";
import { TRIAL_WATERMARK_DEFAULTS, parseTrialWatermarkConfig, serializeTrialWatermarkConfig } from "@/lib/trial-watermark/config";
import { db, freshDb, id, iso, type Row } from "./stubs/thumb-db";
import { flushAfter } from "./stubs/trialwm-stubs";

let failures = 0;
let passed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else {
    failures++;
    const d = detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)?.slice(0, 400)}`;
    console.log(`  ✗ ${name}${d}`);
  }
}

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "99999999-9999-4999-8999-999999999999";
const USER = "22222222-2222-4222-8222-222222222222";
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const CFG = { ...TRIAL_WATERMARK_DEFAULTS, enabled: true };
const CONFIG_ROW = serializeTrialWatermarkConfig(CFG);

/* ══ pixels ══════════════════════════════════════════════════════════════*/

async function solid(w: number, h: number, rgb: [number, number, number], fmt: "png" | "jpeg" | "webp" = "png", alpha?: number): Promise<Buffer> {
  const img = sharp({ create: { width: w, height: h, channels: alpha === undefined ? 3 : 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], ...(alpha === undefined ? {} : { alpha }) } } });
  return fmt === "png" ? img.png().toBuffer() : fmt === "jpeg" ? img.jpeg({ quality: 92 }).toBuffer() : img.webp({ quality: 90 }).toBuffer();
}

/** A busy picture (a gradient with noise): pixels a mark visibly changes. */
async function busy(w: number, h: number, fmt: "png" | "jpeg" | "webp" = "png", seed = 1): Promise<Buffer> {
  const raw = Buffer.alloc(w * h * 3);
  let s = seed;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const i = (y * w + x) * 3;
      raw[i] = (x * 255 / w + (s & 15)) & 255;
      raw[i + 1] = (y * 255 / h) & 255;
      raw[i + 2] = ((x + y) * 3 + (s >> 8 & 31)) & 255;
    }
  }
  const img = sharp(raw, { raw: { width: w, height: h, channels: 3 } });
  return fmt === "png" ? img.png().toBuffer() : fmt === "jpeg" ? img.jpeg({ quality: 92 }).toBuffer() : img.webp({ quality: 90 }).toBuffer();
}

/** PNG chunks, CRC-checked. */
function pngChunks(png: Buffer): { type: string; data: Buffer; crcOk: boolean }[] {
  const out: { type: string; data: Buffer; crcOk: boolean }[] = [];
  let p = 8;
  while (p + 12 <= png.length) {
    const len = png.readUInt32BE(p);
    const type = png.toString("latin1", p + 4, p + 8);
    const data = png.subarray(p + 8, p + 8 + len);
    const crc = png.readUInt32BE(p + 8 + len);
    out.push({ type, data, crcOk: (crc32(png.subarray(p + 4, p + 8 + len)) >>> 0) === crc });
    p += 12 + len;
    if (type === "IEND") break;
  }
  return out;
}

const derive = (bytes: Buffer, edge: number, quality: number) => sharp(bytes, { failOn: "none" })
  .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true }).webp({ quality }).toBuffer();

/* ══ the recording database (over the shared in-memory world) ════════════*/

type Reply = { data: unknown; error: { code?: string; message: string } | null };
type TrialRow = Row & {
  id: string; workspace_id: string; status: string; object_path: string; marked_path: string | null;
  clean_sha256: string; clean_mime: string; unlocked_path: string | null;
};

const T = {
  calls: [] as { name: string; args: Row }[],
  decide: ((): Reply => ({ data: { mode: "off", reason: "disabled", config: {} }, error: null })) as (a: Row) => Reply,
  rows: new Map<string, TrialRow>(),
  keys: new Map<string, { wrapped: string; fp: string }>(),
  reserveError: null as Reply["error"],
  reserveReply: null as null | ((a: Row) => Reply),
  attachError: null as Reply["error"],
  sourceError: null as Reply["error"],
  sourceByUnlocked: false,
  uploadFail: null as null | ((bucket: string, path: string) => boolean),
  removeFail: false,
  uploads: [] as { bucket: string; path: string; opts: Row; bytes: Buffer }[],
  removes: [] as { bucket: string; paths: string[] }[],
  downloads: [] as { bucket: string; path: string }[],
  derivatives: [] as Row[],
  models: [] as Row[],
  services: [] as Row[],
  settings: [] as Row[],
};

const trialCalls = (name: string) => T.calls.filter((c) => c.name === name);
const decideOf = (mode: string, reason: string) => () => ({ data: { mode, reason, config: CONFIG_ROW }, error: null });

function fresh() {
  const d = freshDb();
  d.wallet.workspace_id = WS;
  d.env.config = {
    model: "gpt-image-2.5-sunburst", size: "2048x2048", quality: "high", max_photos: 10, timeout_ms: 200000,
    finish: { target: 2560, margin_percent: 3, brightness_percent: 5, kernel: "lanczos3", format: "png" },
    token_prices: { text_input: 5, cached_text_input: 1.25, image_input: 8, cached_image_input: 2, image_output: 30, text_output: null },
  };
  d.env.promptText = "Linia 1\nLinia 2";
  T.calls = []; T.rows = new Map(); T.keys = new Map();
  T.decide = decideOf("off", "disabled");
  T.reserveError = null; T.reserveReply = null; T.attachError = null; T.sourceError = null; T.sourceByUnlocked = false;
  T.uploadFail = null; T.removeFail = false; T.uploads = []; T.removes = []; T.downloads = []; T.derivatives = [];
  T.models = [MODEL]; T.services = TOOLS.map((t) => ({ slug: t.service, credits_cost: 1, enabled: true, maintenance_mode: false }));
  T.settings = [];
  delete process.env.VERCEL_ENV;
  return d;
}

function trialRpc(name: string, a: Row): Reply | undefined {
  switch (name) {
    case "trial_watermark_decide": return T.decide(a);
    case "trial_original_reserve": {
      if (T.reserveError) return { data: null, error: T.reserveError };
      if (T.reserveReply) return T.reserveReply(a);
      const oid = String(a.p_id);
      const row: TrialRow = {
        id: oid, workspace_id: String(a.p_workspace_id), job_id: a.p_job_id ?? null, operation: a.p_operation,
        marked_path: (a.p_marked_path as string | null) ?? null, status: "pending",
        clean_sha256: String(a.p_clean_sha256), clean_mime: String(a.p_clean_mime), clean_bytes: a.p_clean_bytes,
        width: a.p_width, height: a.p_height, watermark: a.p_watermark,
        object_path: `${a.p_workspace_id}/${oid}.bin`, asset_id: null, marked_sha256: null, unlocked_path: null,
      };
      T.rows.set(oid, row);
      T.keys.set(oid, { wrapped: String(a.p_wrapped_key), fp: String(a.p_kek_fp) });
      return { data: { id: oid, object_path: row.object_path }, error: null };
    }
    case "trial_original_attach": {
      if (T.attachError) return { data: null, error: T.attachError };
      const r = T.rows.get(String(a.p_original_id));
      if (!r || r.status !== "pending") return { data: { ok: false, error: "not_pending" }, error: null };
      Object.assign(r, { status: "locked", asset_id: a.p_asset_id, marked_path: a.p_marked_path, marked_sha256: a.p_marked_sha256 });
      return { data: { ok: true, expires_at: "2026-11-13T12:00:00Z" }, error: null };
    }
    case "trial_original_release": {
      const r = T.rows.get(String(a.p_original_id));
      // 0143: the path comes back only for a row released now or before.
      if (!r) return { data: { object_path: null, state: "not_found" }, error: null };
      if (r.status === "pending") { r.status = "orphaned"; T.keys.delete(r.id); }
      return { data: { object_path: r.status === "orphaned" ? r.object_path : null, state: r.status }, error: null };
    }
    case "trial_originals_mark_purged": {
      const paths = a.p_paths as string[];
      let n = 0;
      for (const r of T.rows.values()) if (paths.includes(r.object_path) && !T.keys.has(r.id)) { r.purged_at = iso(db().now); n++; }
      return { data: n, error: null };
    }
    case "trial_original_source": {
      if (T.sourceError) return { data: null, error: T.sourceError };
      const ws = String(a.p_workspace_id);
      const p = String(a.p_marked_path);
      const r = [...T.rows.values()].find((x) => x.workspace_id === ws && String(x.marked_path ?? "").split("/")[0] === ws
        && (x.marked_path === p || (T.sourceByUnlocked && x.unlocked_path === p)));
      if (!r) return { data: null, error: null };
      const key = ["pending", "locked", "unlocking"].includes(r.status) ? T.keys.get(r.id) : undefined;
      return {
        data: {
          status: r.status, original_id: r.id, object_path: r.object_path,
          wrapped_key: key?.wrapped ?? null, kek_fp: key?.fp ?? null,
          clean_sha256: r.clean_sha256, clean_mime: r.clean_mime, unlocked_path: r.unlocked_path,
        },
        error: null,
      };
    }
  }
  return undefined;
}

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
  if (name === "ai_models") return T.models;
  if (name === "provider_health") return [];
  if (name === "service_catalog") return T.services;
  if (name === "app_settings") return T.settings;
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
    // A joined filter ("ai_providers.active") is the join's business here.
    eq(k: string, v: unknown) { if (!k.includes(".")) filters.push((r) => r[k] === v); return api; },
    neq() { return api; }, is() { return api; }, lt() { return api; },
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

async function rpc(name: string, args: Row): Promise<Reply> {
  const d = db();
  T.calls.push({ name, args: { ...args } });
  const trial = trialRpc(name, args);
  if (trial) return trial;
  switch (name) {
    case "provider_credential_read": return { data: [{ base_url: null }], error: null };
    case "usage_event_refund_partial": {
      const ev = d.events.find((e) => e.id === args.p_event_id && e.status === "pending" && e.refunded === 0);
      if (!ev) return { data: null, error: null };
      ev.refunded = args.p_amount; d.wallet.balance += Number(args.p_amount);
      return { data: "tx-1", error: null };
    }
    case "set_asset_derivatives": T.derivatives.push({ ...args }); return { data: true, error: null };
    case "thumbnail_run_create": {
      const run = args.p_run as Row;
      const key = String(run.idempotency_key);
      const existing = [...d.runs.values()].find((r) => r.idempotency_key === key);
      if (existing) return { data: { id: existing.id, created: false, status: existing.status }, error: null };
      const runId = id("run");
      d.runs.set(runId, {
        id: runId, tool_key: "ecommerce_thumbnail", workspace_id: run.workspace_id, user_id: run.user_id, job_id: null,
        status: "queued", run_kind: "thumbnail", idempotency_key: key, input: run.input, outputs: [], progress: { stage: "prepare" },
        credits: run.credits, error: null, created_at: iso(d.now), finished_at: null, locked_until: null, lease_owner: null, invocations: 0,
      });
      return { data: { id: runId, created: true, status: "queued" }, error: null };
    }
    case "ai_engine_run_read": {
      const r = d.runs.get(String(args.p_run_id));
      return { data: r ? [JSON.parse(JSON.stringify(r))] : [], error: null };
    }
    case "ai_engine_step_runs_read": {
      const rows = d.steps.filter((x) => x.run_id === args.p_run_id)
        .sort((a, b) => (Number(a.position) - Number(b.position)) || (Number(a.item_index) - Number(b.item_index)));
      return { data: JSON.parse(JSON.stringify(rows)), error: null };
    }
    case "delete_generation": {
      const gid = String(args.gen_id);
      const assets = tableRows("generation_assets");
      const paths = assets.filter((a) => a.generation_id === gid).map((a) => String(a.storage_path));
      d.tables.generation_assets = assets.filter((a) => a.generation_id !== gid);
      d.tables.generations = tableRows("generations").filter((g) => g.id !== gid);
      return { data: paths, error: null };
    }
    default: return { data: null, error: null };
  }
}

const storage = {
  from(bucket: string) {
    const k = (p: string) => `${bucket}:${p}`;
    return {
      async upload(path: string, bytes: Buffer, opts: Row = {}) {
        T.uploads.push({ bucket, path, opts: { ...opts }, bytes: Buffer.from(bytes) });
        if (T.uploadFail?.(bucket, path)) return { data: null, error: { message: "fault" } };
        if (db().storage.has(k(path)) && !opts.upsert) return { data: null, error: { message: "The resource already exists", statusCode: "409" } };
        db().storage.set(k(path), Buffer.from(bytes));
        return { data: { path }, error: null };
      },
      async list(folder: string) {
        const pre = k(`${folder}/`);
        const names = [...db().storage.keys()].filter((x) => x.startsWith(pre) && !x.slice(pre.length).includes("/")).map((x) => x.slice(pre.length));
        return { data: names.map((name) => ({ name, id: name })), error: null };
      },
      async remove(paths: string[]) {
        T.removes.push({ bucket, paths: [...paths] });
        if (T.removeFail) return { data: null, error: { message: "fault" } };
        paths.forEach((p) => db().storage.delete(k(p)));
        return { data: paths.map((name) => ({ name })), error: null };
      },
      async download(path: string) {
        T.downloads.push({ bucket, path });
        const b = db().storage.get(k(path));
        return b ? { data: new Blob([new Uint8Array(b)]), error: null } : { data: null, error: { message: "not found" } };
      },
      async createSignedUrls(paths: string[]) { return { data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${bucket}/${p}` })), error: null }; },
      async createSignedUrl(p: string) { return { data: { signedUrl: `https://signed/${bucket}/${p}` }, error: null }; },
    };
  },
};

const client = { from, rpc, storage };
type Client = Parameters<typeof runGeneration>[0];
const SUPA = client as unknown as Client;

const stored = (bucket: string, path: string) => db().storage.get(`${bucket}:${path}`) ?? null;
const bucketObjects = (bucket: string) => [...db().storage.entries()].filter(([k]) => k.startsWith(`${bucket}:`)).map(([k, v]) => ({ path: k.slice(bucket.length + 1), bytes: v }));

/** The clean bytes a stash holds, opened the way an unlock would. */
function openStash(originalId: string): Buffer | null {
  const row = T.rows.get(originalId);
  const key = T.keys.get(originalId);
  const blob = row ? stored(TRIAL_ORIGINALS_BUCKET, row.object_path) : null;
  if (!row || !key || !blob) return null;
  try {
    return openOriginal(blob, unwrapOriginalKey(key.wrapped, key.fp, originalId), row.workspace_id, originalId);
  } catch {
    return null;
  }
}

/* ══ the provider (the real Google adapter object, answering from memory) ═*/

const MODEL: Row = {
  id: "m-1", active: true, name: "Nano Banana Pro", model_identifier: "gemini-3-pro-image",
  supported_resolutions: ["1K", "2K", "4K"], supported_aspect_ratios: ["1:1", "3:4", "4:5", "16:9", "9:16"],
  supports_reference_images: true, max_reference_images: 6, credit_cost: 5, pricing: { "1K": 5, "2K": 7, "4K": 12 },
  metadata: {}, visible_custom: true, internal_cost_usd_micros: 134000,
  ai_providers: { id: "prov-g", slug: "google", active: true },
};

let providerImages: { bytes: Buffer; mime: string }[] = [];
let providerCalls: GenerationRequest[] = [];
let onGenerate: (() => void) | null = null;
(googleAdapter as { generate: typeof googleAdapter.generate }).generate = async (_model, req) => {
  providerCalls.push(req);
  onGenerate?.();
  return { images: providerImages.map((p) => ({ base64: p.bytes.toString("base64"), mime: p.mime })) };
};

const PHOTO = `${WS}/products/photo.png`;
async function seedPhoto() {
  db().storage.set(`product-images:${PHOTO}`, await busy(320, 240, "png", 7));
}

function generate(over: Partial<GenerateInput> = {}) {
  return runGeneration(SUPA, USER, WS, {
    modelId: "m-1", prompt: "Produkt na białym tle", aspectRatio: "1:1", resolution: "1K", quantity: 2,
    referencePaths: [PHOTO], referenceImageIds: [], ...over,
  });
}

const jobRow = (jobId: string) => tableRows("generation_jobs").find((j) => j.id === jobId) as Row | undefined;
const outputOf = (jobId: string) => ((jobRow(jobId)?.settings as Row | undefined)?.provider_output ?? []) as Row[];
const gaUploads = () => T.uploads.filter((u) => u.bucket === "generation-assets");

/* ══ E · the engine ══════════════════════════════════════════════════════*/

async function sectionE() {
  console.log("\nE. THE ENGINE — on real pixels");
  const P = CFG;

  const white = await applyTrialWatermark(await solid(800, 600, [255, 255, 255]), P);
  const black = await applyTrialWatermark(await solid(800, 600, [0, 0, 0]), P);
  check("E1 a white region → the dark variant; a black one → the asset's white", white.info.variant === "dark" && black.info.variant === "light",
    { white: white.info.variant, black: black.info.variant });
  const g140 = await applyTrialWatermark(await solid(600, 600, [140, 140, 140]), P);
  const g141 = await applyTrialWatermark(await solid(600, 600, [141, 141, 141]), P);
  check("E2 around the 0.55 default: grey 140 (0.549) light, grey 141 (0.553) dark", g140.info.variant === "light" && g141.info.variant === "dark",
    { l140: g140.info.luminance, l141: g141.info.luminance });
  const edgeAt = await applyTrialWatermark(await solid(300, 300, [0, 0, 0]), { ...P, luminanceThreshold: 0 });
  const edgeAbove = await applyTrialWatermark(await solid(300, 300, [1, 1, 1]), { ...P, luminanceThreshold: 0 });
  check("E3 the threshold edge: a luminance EQUAL to it stays light, anything above turns dark", edgeAt.info.luminance === 0
    && edgeAt.info.variant === "light" && edgeAbove.info.variant === "dark", { at: edgeAt.info, above: edgeAbove.info.luminance });

  const geo = markGeometry(2000, 1000, 0.5);
  check("E4 the mark: width = share of the SHORTER side, proportions of the asset, centred",
    geo.markWidth === 500 && geo.markHeight === Math.round(500 * TRIAL_WATERMARK_ASSET_HEIGHT / TRIAL_WATERMARK_ASSET_WIDTH)
    && geo.left === 750 && geo.top === Math.floor((1000 - geo.markHeight) / 2), geo);
  const big = await applyTrialWatermark(await solid(3800, 3800, [30, 60, 90]), { ...P, widthRatio: 0.9 });
  check("E5 the scale is capped at the 3328 px asset (never enlarged): 0.9 × 3800 → 3328, scale 1",
    big.info.markWidth === TRIAL_WATERMARK_ASSET_WIDTH && big.info.markHeight === TRIAL_WATERMARK_ASSET_HEIGHT && big.info.scale === 1, big.info);

  for (const fmt of ["jpeg", "png", "webp"] as const) {
    const input = await busy(640, 480, fmt);
    const out = await applyTrialWatermark(input, P);
    const m = await sharp(out.bytes).metadata();
    check(`E6 ${fmt}: same format, same size, a different file`, m.format === fmt && m.width === 640 && m.height === 480
      && out.mime === `image/${fmt}` && out.info.format === fmt && !out.bytes.equals(input), { format: m.format, w: m.width, h: m.height });
    const exif = m.exif ?? Buffer.alloc(0);
    const xmp = m.xmp ?? Buffer.alloc(0);
    check(`E7 ${fmt}: EXIF ImageDescription (ASCII), XPComment (the en dash) and XMP read back exactly`,
      exif.includes(Buffer.from(TRIAL_WATERMARK_TEXT_ASCII, "latin1")) && exif.includes(Buffer.from(TRIAL_WATERMARK_TEXT, "utf16le"))
      && xmp.toString("utf8").includes(TRIAL_WATERMARK_TEXT), { exif: exif.length, xmp: xmp.length });
    if (fmt === "png") {
      const chunks = pngChunks(out.bytes);
      const itxt = chunks.filter((c) => c.type === "iTXt" && c.data.subarray(0, 12).toString("latin1") === "Description\0");
      const text = itxt[0] ? itxt[0].data.subarray(12 + 4).toString("utf8") : "";
      check("E8 png: an iTXt Description chunk right after IHDR, CRC valid, the exact UTF-8 text",
        itxt.length === 1 && itxt[0].crcOk && chunks[1]?.type === "iTXt" && text === TRIAL_WATERMARK_TEXT && chunks.every((c) => c.crcOk),
        { types: chunks.map((c) => c.type), text });
      // Outside the mark and its glow, a lossless file keeps every pixel.
      const a = await sharp(input).extract({ left: 0, top: 0, width: 40, height: 40 }).raw().toBuffer();
      const b = await sharp(out.bytes).removeAlpha().extract({ left: 0, top: 0, width: 40, height: 40 }).raw().toBuffer();
      check("E9 png: pixels outside the mark and glow are untouched", a.equals(b));
    }
  }

  const rotated = await sharp(await busy(300, 200, "jpeg")).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const rot = await applyTrialWatermark(rotated, P);
  const rm = await sharp(rot.bytes).metadata();
  check("E10 an EXIF-rotated photo is marked upright: 300×200 + orientation 6 → 200×300, no rotation flag left",
    rm.width === 200 && rm.height === 300 && (rm.orientation === undefined || rm.orientation === 1) && rot.info.width === 200 && rot.info.height === 300,
    { w: rm.width, h: rm.height, o: rm.orientation });

  const cut = await sharp({ create: { width: 400, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await solid(80, 80, [200, 30, 30]), left: 0, top: 0 }]).png().toBuffer();
  const cm = await applyTrialWatermark(cut, P);
  const cmeta = await sharp(cm.bytes).metadata();
  const corner = await sharp(cm.bytes).extract({ left: 390, top: 290, width: 5, height: 5 }).raw().toBuffer();
  const square = await sharp(cm.bytes).extract({ left: 10, top: 10, width: 4, height: 4 }).raw().toBuffer();
  check("E11 an alpha cutout keeps its alpha: transparent stays transparent, the product untouched",
    cmeta.hasAlpha === true && cmeta.channels === 4 && corner.every((v, i) => (i % 4 === 3 ? v === 0 : true))
    && square[0] === 200 && square[1] === 30 && square[3] === 255, { alpha: cmeta.hasAlpha, ch: cmeta.channels });

  const d1 = await applyTrialWatermark(await busy(500, 500, "jpeg", 3), P);
  const d2 = await applyTrialWatermark(await busy(500, 500, "jpeg", 3), P);
  check("E12 deterministic: the same input and parameters give the same bytes", d1.bytes.equals(d2.bytes));

  const refusals: string[] = [];
  for (const [label, input] of [
    ["tiff", await sharp(await solid(64, 64, [1, 2, 3])).tiff().toBuffer()],
    ["garbage", Buffer.from("not an image at all")],
    ["10 px", await solid(10, 10, [9, 9, 9])],
  ] as const) {
    try { await applyTrialWatermark(input, P); refusals.push(`${label}:none`); } catch (e) { refusals.push(`${label}:${e instanceof TrialWatermarkError ? e.code : "other"}`); }
  }
  check("E13 refusals THROW: unsupported_format, unreadable, too_small", refusals.join(",") === "tiff:unsupported_format,garbage:unreadable,10 px:too_small", refusals);
  const via = await sealTrialOutput(await sharp(await solid(64, 64, [1, 2, 3])).tiff().toBuffer(), CFG);
  check("E14 the pipeline's sealTrialOutput turns a refusal into null (the image is not delivered)", via === null);

  // R35: what a trial image costs in time (sequential, as generation.ts does it).
  const k4 = await busy(4096, 2752, "jpeg", 11);
  let t = Date.now();
  const m4 = await applyTrialWatermark(k4, P);
  const ms4k = Date.now() - t;
  const twoK = await Promise.all([0, 1, 2, 3].map((i) => busy(2048, 2048, "png", 20 + i)));
  t = Date.now();
  for (const b of twoK) await applyTrialWatermark(b, P);
  const ms2k = Date.now() - t;
  console.log(`  · timing: 4K Retusz JPEG (4096×2752) ${ms4k} ms; four 2K PNGs (2048²) ${ms2k} ms in sequence`);
  check("E15 a 4K mark and four 2K marks fit easily inside the trial budget (< 25 s each)", ms4k < 25_000 && ms2k < 25_000 && m4.info.width === 4096);
}

/* ══ C · the original at rest ════════════════════════════════════════════*/

function sectionC() {
  console.log("\nC. THE ORIGINAL AT REST — seal, wrap, tamper");
  const clean = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 7) & 255));
  const oid = randomUUID();
  const dek = newOriginalKey();
  const blob = sealOriginal(clean, dek, WS, oid);
  check("C1 seal → open returns the exact bytes; the blob is not the plaintext", openOriginal(blob, dek, WS, oid).equals(clean)
    && blob.subarray(0, 5).toString("latin1") === "GBWM1" && !blob.includes(clean.subarray(0, 64)));
  const codeOf = (f: () => unknown) => { try { f(); return "none"; } catch (e) { return e instanceof TrialOriginalCryptoError || e instanceof TrialKeyError ? e.code : "other"; } };
  const flipped = Buffer.from(blob); flipped[flipped.length - 1] ^= 1;
  const badMagic = Buffer.from(blob); badMagic[0] = 0x58;
  check("C2 tampered ciphertext / another workspace / another original → auth_failed; bad magic → bad_blob; short key → bad_key",
    codeOf(() => openOriginal(flipped, dek, WS, oid)) === "auth_failed"
    && codeOf(() => openOriginal(blob, dek, OTHER_WS, oid)) === "auth_failed"
    && codeOf(() => openOriginal(blob, dek, WS, randomUUID())) === "auth_failed"
    && codeOf(() => openOriginal(badMagic, dek, WS, oid)) === "bad_blob"
    && codeOf(() => openOriginal(blob, dek.subarray(0, 16), WS, oid)) === "bad_key");
  const w = wrapOriginalKey(dek, oid);
  check("C3 the key wraps to exactly 80 base64 chars with the server key's 16-hex fingerprint, and unwraps to the same key",
    w.wrapped.length === 80 && /^[0-9a-f]{16}$/.test(w.fingerprint) && w.fingerprint === kekFingerprint()
    && unwrapOriginalKey(w.wrapped, w.fingerprint, oid).equals(dek), w);
  const raw = Buffer.from(w.wrapped, "base64"); raw[30] ^= 1;
  check("C4 a wrapped key for another original / a tampered one → bad_wrapped_key; a foreign fingerprint → kek_mismatch",
    codeOf(() => unwrapOriginalKey(w.wrapped, w.fingerprint, randomUUID())) === "bad_wrapped_key"
    && codeOf(() => unwrapOriginalKey(raw.toString("base64"), w.fingerprint, oid)) === "bad_wrapped_key"
    && codeOf(() => unwrapOriginalKey(w.wrapped, "0123456789abcdef", oid)) === "kek_mismatch");
}

/* ══ D · the decision ════════════════════════════════════════════════════*/

async function sectionD() {
  console.log("\nD. THE DECISION — fail closed (R2)");
  fresh();
  const decide = (credits = 7) => decideTrialWatermark(SUPA, { workspaceId: WS, credits });
  T.decide = () => ({ data: { mode: "trial", reason: "trial", config: { ...CONFIG_ROW, width_ratio: 0.3, opacity: 7 } }, error: null });
  let r = await decide(7.9);
  const a = trialCalls("trial_watermark_decide")[0]?.args ?? {};
  check("D1 trial: mode, reason, config parsed (a valid value kept, an out-of-range one back to its default)",
    !("error" in r) && r.mode === "trial" && r.reason === "trial" && r.config.widthRatio === 0.3 && r.config.opacity === TRIAL_WATERMARK_DEFAULTS.opacity, r);
  check("D2 the call: the server token, this workspace, whole credits", a.p_token === "server-token" && a.p_workspace_id === WS && a.p_credits === 7, a);
  T.calls = [];
  await decide(-3);
  check("D3 negative credits are sent as 0", trialCalls("trial_watermark_decide")[0]?.args.p_credits === 0);
  for (const mode of ["off", "paid"]) {
    T.decide = decideOf(mode, mode === "off" ? "disabled" : "subscription");
    r = await decide();
    check(`D4 ${mode} is honoured as given`, !("error" in r) && r.mode === mode);
  }

  const run = async (replies: (Reply | "throw")[]) => {
    T.calls = [];
    let i = 0;
    T.decide = () => {
      const x = replies[Math.min(i++, replies.length - 1)];
      if (x === "throw") throw new Error("socket hang up");
      return x;
    };
    const out = await decide();
    return { out, n: trialCalls("trial_watermark_decide").length };
  };
  const ok: Reply = { data: { mode: "paid", reason: "subscription", config: CONFIG_ROW }, error: null };
  let x = await run([{ data: null, error: { code: "PGRST202", message: "Could not find the function" } }]);
  check("D5 a missing function (PGRST202) → trial_check_failed, not retried", "error" in x.out && x.out.error === "trial_check_failed" && x.n === 1, x);
  x = await run([{ data: null, error: { code: "42883", message: "function does not exist" } }]);
  check("D6 42883 → trial_check_failed, not retried", "error" in x.out && x.n === 1, x);
  x = await run([{ data: null, error: { code: "42501", message: "forbidden" } }]);
  check("D7 a refusal (forbidden) → trial_check_failed, not retried", "error" in x.out && x.n === 1, x);
  x = await run([{ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }, ok]);
  check("D8 a transient error (statement timeout) is tried once more — and the second answer stands", !("error" in x.out) && x.out.mode === "paid" && x.n === 2, x);
  x = await run([{ data: null, error: { message: "fetch failed" } }, { data: null, error: { message: "fetch failed" } }, ok]);
  check("D9 two transient errors → trial_check_failed after exactly 2 calls", "error" in x.out && x.n === 2, x);
  x = await run(["throw", ok]);
  check("D10 a thrown network error counts as transient (retried once)", !("error" in x.out) && x.n === 2, x);
  for (const [label, data] of [["true", true], ["a string", "trial"], ["mode maybe", { mode: "maybe", reason: "x" }],
    ["no reason", { mode: "trial" }], ["an array", [{ mode: "off", reason: "disabled" }]]] as const) {
    x = await run([{ data, error: null }, ok]);
    check(`D11 malformed (${label}) → trial_check_failed, never retried into an answer`, "error" in x.out && x.n === 1, x);
  }
  x = await run([{ data: null, error: null }]);
  check("D12 null outside production → off (reason unavailable): the frozen fakes stay green", !("error" in x.out) && x.out.mode === "off" && x.out.reason === "unavailable", x);
  process.env.VERCEL_ENV = "preview";
  x = await run([{ data: null, error: null }]);
  check("D13 null on a preview deployment → off", !("error" in x.out) && x.out.mode === "off");
  process.env.VERCEL_ENV = "production";
  x = await run([{ data: null, error: null }]);
  check("D14 null IN PRODUCTION → trial_check_failed", "error" in x.out && x.out.error === "trial_check_failed", x);
  delete process.env.VERCEL_ENV;
}

/* ══ P · stash / release / source ════════════════════════════════════════*/

async function sectionP() {
  console.log("\nP. STASH, RELEASE, SOURCE");
  fresh();
  const clean = await busy(300, 200, "png", 5);
  const marked = (await sealTrialOutput(clean, CFG))!;
  const markedPath = `${WS}/job-1/0.png`;
  let st = await stashTrialOriginal(SUPA, { workspaceId: WS, jobId: "job-1", operation: "generator", markedPath, clean, marked });
  const res = trialCalls("trial_original_reserve")[0]?.args ?? {};
  const blobUp = T.uploads.find((u) => u.bucket === TRIAL_ORIGINALS_BUCKET);
  check("P1 reserve: a server-chosen id, the marked path, a wrapped key (80) + fingerprint, the clean file's hash, format, size",
    !!st && res.p_id === st.originalId && /^[0-9a-f-]{36}$/.test(String(res.p_id)) && res.p_marked_path === markedPath
    && String(res.p_wrapped_key).length === 80 && /^[0-9a-f]{16}$/.test(String(res.p_kek_fp))
    && res.p_clean_sha256 === sha(clean) && res.p_clean_mime === "image/png" && res.p_clean_bytes === clean.length
    && res.p_width === 300 && res.p_height === 200 && res.p_operation === "generator" && res.p_job_id === "job-1", res);
  check("P2 the mark's parameters go to the original's row, and they name no path",
    (res.p_watermark as Row)?.variant !== undefined && !JSON.stringify(res.p_watermark).includes("/"), res.p_watermark);
  check("P3 the blob: trial-originals, at the path the database chose, octet-stream, never over an existing object",
    !!blobUp && blobUp.path === `${WS}/${st?.originalId}.bin` && blobUp.opts.contentType === "application/octet-stream" && blobUp.opts.upsert === false, blobUp?.opts);
  check("P4 …and it opens (unwrap + AES-GCM) to the exact clean bytes", !!st && openStash(st.originalId)?.equals(clean) === true);

  fresh();
  T.reserveError = { code: "42501", message: "forbidden" };
  st = await stashTrialOriginal(SUPA, { workspaceId: WS, jobId: "j", operation: "generator", markedPath, clean, marked });
  check("P5 reserve refused → null, nothing uploaded", st === null && T.uploads.length === 0);

  fresh();
  T.reserveReply = (a) => ({ data: { id: randomUUID(), object_path: `${a.p_workspace_id}/x.bin` }, error: null });
  st = await stashTrialOriginal(SUPA, { workspaceId: WS, jobId: "j", operation: "generator", markedPath, clean, marked });
  check("P6 an answer naming ANOTHER id → released, null, nothing uploaded", st === null && trialCalls("trial_original_release").length === 1 && T.uploads.length === 0);
  fresh();
  T.reserveReply = (a) => ({ data: { id: a.p_id, object_path: `${OTHER_WS}/${a.p_id}.bin` }, error: null });
  st = await stashTrialOriginal(SUPA, { workspaceId: WS, jobId: "j", operation: "generator", markedPath, clean, marked });
  check("P7 an object path outside the workspace → released, null, nothing uploaded", st === null && trialCalls("trial_original_release").length === 1 && T.uploads.length === 0);

  fresh();
  T.uploadFail = (b) => b === TRIAL_ORIGINALS_BUCKET;
  st = await stashTrialOriginal(SUPA, { workspaceId: WS, jobId: "j", operation: "generator", markedPath, clean, marked });
  const row = [...T.rows.values()][0];
  check("P8 the blob upload fails → the row released (orphaned, key gone), the object removed, null",
    st === null && row?.status === "orphaned" && !T.keys.has(row.id) && T.removes.some((r) => r.bucket === TRIAL_ORIGINALS_BUCKET && r.paths[0] === row.object_path));

  fresh();
  st = await stashTrialOriginal(SUPA, { workspaceId: WS, jobId: "j", operation: "generator", markedPath, clean, marked });
  await releaseTrialOriginal(SUPA, st!.originalId);
  const purged = trialCalls("trial_originals_mark_purged")[0]?.args.p_paths as string[] | undefined;
  check("P9 release: orphaned + key destroyed, the blob removed, and only what storage confirmed is marked purged",
    T.rows.get(st!.originalId)?.status === "orphaned" && stored(TRIAL_ORIGINALS_BUCKET, st!.objectPath) === null
    && purged?.length === 1 && purged[0] === st!.objectPath && T.rows.get(st!.originalId)?.purged_at !== undefined);
  fresh();
  st = await stashTrialOriginal(SUPA, { workspaceId: WS, jobId: "j", operation: "generator", markedPath, clean, marked });
  T.removeFail = true;
  await releaseTrialOriginal(SUPA, st!.originalId);
  check("P10 a removal that fails is NOT marked purged (left for the cron)", trialCalls("trial_originals_mark_purged").length === 0);
  fresh();
  st = await stashTrialOriginal(SUPA, { workspaceId: WS, jobId: "j", operation: "generator", markedPath, clean, marked });
  T.rows.get(st!.originalId)!.status = "locked";
  await releaseTrialOriginal(SUPA, st!.originalId, st!.objectPath);
  check("P10b a row the database does not release (locked) keeps its blob, even when the caller knows the path",
    stored(TRIAL_ORIGINALS_BUCKET, st!.objectPath) !== null && T.removes.length === 0 && T.rows.get(st!.originalId)?.status === "locked");

  // openTrialSource, every state.
  fresh();
  st = await stashTrialOriginal(SUPA, { workspaceId: WS, jobId: "j", operation: "image_retouch", markedPath, clean, marked });
  const r0 = T.rows.get(st!.originalId)!;
  r0.status = "locked";
  const open = (allowLocked: boolean, p = markedPath) => openTrialSource(SUPA, { workspaceId: WS, markedPath: p, allowLocked });
  const nonePath = await open(true, `${WS}/never/0.png`);
  check("P11 a path that never was a trial image → none (definitive)", nonePath.kind === "none");
  T.calls = [];
  T.downloads = [];
  const locked = await open(false);
  check("P12 locked, caller not a trial run → locked (nothing downloaded)", locked.kind === "locked"
    && T.downloads.length === 0 && trialCalls("trial_original_source").length === 1);
  const cleanSrc = await open(true);
  check("P13 locked, a trial run → the clean bytes, verified", cleanSrc.kind === "clean" && cleanSrc.bytes.equals(clean) && cleanSrc.sha256 === sha(clean) && cleanSrc.mime === "image/png");
  r0.status = "pending";
  check("P14 pending is openable too (a heal still pending)", (await open(true)).kind === "clean");
  r0.status = "unlocking";
  check("P15 unlocking (inside its lease) is openable too", (await open(true)).kind === "clean");
  r0.status = "locked";
  const realSha = r0.clean_sha256;
  r0.clean_sha256 = "0".repeat(64);
  const mism = await open(true);
  check("P16 a clean hash that does not match the database's → unavailable", mism.kind === "unavailable");
  r0.clean_sha256 = realSha;
  const blobKey = `${TRIAL_ORIGINALS_BUCKET}:${r0.object_path}`;
  const good = db().storage.get(blobKey)!;
  const bad = Buffer.from(good); bad[bad.length - 3] ^= 0x40;
  db().storage.set(blobKey, bad);
  check("P17 a tampered blob → unavailable (never the wrong bytes)", (await open(true)).kind === "unavailable");
  db().storage.set(blobKey, good);
  T.keys.delete(r0.id);
  check("P18 locked but its key already destroyed → unavailable", (await open(true)).kind === "unavailable");
  for (const s of ["expired", "deleted", "orphaned"]) {
    r0.status = s;
    const o = await open(true);
    check(`P19 ${s} → unavailable`, o.kind === "unavailable" && (o as { reason: string }).reason === s, o);
  }
  r0.status = "unlocked";
  r0.unlocked_path = `${WS}/j/u-${r0.id}.png`;
  db().storage.set(`generation-assets:${r0.unlocked_path}`, clean);
  const unl = await open(false);
  check("P20 unlocked → the unlocked library file, verified against the clean hash (any caller)", unl.kind === "clean" && unl.bytes.equals(clean) && unl.status === "unlocked");
  db().storage.set(`generation-assets:${r0.unlocked_path}`, marked.bytes);
  check("P21 unlocked file that is not the clean original → unavailable", (await open(false)).kind === "unavailable");
  r0.unlocked_path = `${OTHER_WS}/j/u-${r0.id}.png`;
  check("P22 an unlocked path outside the workspace → unavailable", (await open(false)).kind === "unavailable");
  T.sourceError = { code: "57014", message: "timeout" };
  T.calls = [];
  const err = await open(true);
  check("P23 a lookup that fails → unavailable, never none (after one retry)", err.kind === "unavailable" && trialCalls("trial_original_source").length === 2);
  T.sourceError = null;
  T.decide = decideOf("off", "disabled");
}

/* ══ G · runGeneration ═══════════════════════════════════════════════════*/

const PROVIDER_OUTPUT_KEYS_TODAY = [
  "requested_image_size", "provider_returned_width", "provider_returned_height", "provider_mime", "provider_bytes", "provider_sha256",
  "provider_image_parts", "provider_thought_images_skipped", "provider_finish_reason",
  "stored_width", "stored_height", "stored_bytes", "stored_sha256", "stored_equals_provider", "stored_path", "transformed_after_provider",
].sort().join(",");

async function sectionG() {
  console.log("\nG. runGeneration — the trial path, its failures, and the paths that must not change");
  const img0 = await busy(640, 480, "png", 41);
  const img1 = await busy(512, 768, "jpeg", 42);

  // ── off and paid: today's path, byte for byte ──
  const today: Record<string, { out: Row[]; files: Buffer[]; meta: Row; thumbs: Buffer[] }> = {};
  for (const mode of ["off", "paid"]) {
    fresh(); await seedPhoto();
    T.decide = decideOf(mode, mode === "off" ? "disabled" : "subscription");
    providerImages = [{ bytes: img0, mime: "image/png" }, { bytes: img1, mime: "image/jpeg" }];
    providerCalls = [];
    const r = await generate();
    await flushAfter();
    const jobId = r.ok ? r.jobId : "";
    const out = outputOf(jobId);
    const files = [stored("generation-assets", `${WS}/${jobId}/0.png`), stored("generation-assets", `${WS}/${jobId}/1.jpg`)];
    const start = db().usageCalls.find((c) => c.kind === "start");
    today[mode] = {
      out, files: files.filter((f): f is Buffer => !!f), meta: (start?.args.metadata ?? {}) as Row,
      thumbs: [stored("generation-assets", thumbPathFor(`${WS}/${jobId}/0.png`))].filter((f): f is Buffer => !!f),
    };
    check(`G1 ${mode}: both files stored at slot paths, EXACTLY the provider's bytes`, r.ok && files[0]?.equals(img0) === true && files[1]?.equals(img1) === true, r);
    check(`G2 ${mode}: provider_output is today's record — no trial key, no postprocess, stored === provider`,
      out.length === 2 && out.every((o) => Object.keys(o).sort().join(",") === PROVIDER_OUTPUT_KEYS_TODAY && o.stored_equals_provider === true && o.transformed_after_provider === false),
      out.map((o) => Object.keys(o).filter((k) => !PROVIDER_OUTPUT_KEYS_TODAY.includes(k))));
    check(`G3 ${mode}: nothing reaches trial-originals, no trial RPC but the decision`,
      bucketObjects(TRIAL_ORIGINALS_BUCKET).length === 0 && T.calls.filter((c) => c.name.startsWith("trial_")).map((c) => c.name).join() === "trial_watermark_decide");
    const meta = (start?.args.metadata ?? {}) as Row;
    check(`G4 ${mode}: the usage row is stamped with the decision (server-built)`,
      meta.trial_watermark === mode && typeof meta.trial_watermark_reason === "string", meta);
    const t0 = stored("generation-assets", thumbPathFor(`${WS}/${jobId}/0.png`));
    check(`G5 ${mode}: the derivative is made from the stored (provider) bytes`, !!t0 && t0.equals(await derive(img0, THUMB_EDGE, THUMB_QUALITY)));
  }
  const strip = (o: Row) => JSON.stringify({ ...o, stored_path: null });
  check("G6 off and paid produce the identical record and files (byte-identical delivery)",
    today.off.out.map(strip).join() === today.paid.out.map(strip).join()
    && today.off.files.every((f, i) => f.equals(today.paid.files[i])) && today.off.thumbs[0]?.equals(today.paid.thumbs[0]) === true);

  // ── trial: marked at the normal path, clean sealed ──
  fresh(); await seedPhoto();
  T.decide = decideOf("trial", "trial");
  providerImages = [{ bytes: img0, mime: "image/png" }, { bytes: img1, mime: "image/jpeg" }];
  providerCalls = [];
  let r = await generate();
  await flushAfter();
  let jobId = r.ok ? r.jobId : "";
  const p0 = `${WS}/${jobId}/0.png`, p1 = `${WS}/${jobId}/1.jpg`;
  const f0 = stored("generation-assets", p0), f1 = stored("generation-assets", p1);
  const m0 = f0 ? await sharp(f0).metadata() : null;
  const m1 = f1 ? await sharp(f1).metadata() : null;
  check("G7 trial: ONE provider call, the request untouched (nothing about the mark reaches it)", providerCalls.length === 1
    && !JSON.stringify(providerCalls[0].prompt).includes("GrovBase"));
  check("G8 trial: both images delivered at the NORMAL paths, MARKED (not the provider's bytes), same format and size",
    r.ok && r.images.length === 2 && !!f0 && !!f1 && !f0.equals(img0) && !f1.equals(img1)
    && m0?.format === "png" && m0.width === 640 && m0.height === 480 && m1?.format === "jpeg" && m1.width === 512 && m1.height === 768,
    { r, m0: m0?.format, m1: m1?.format });
  const reserves = trialCalls("trial_original_reserve");
  const ids = reserves.map((c) => String(c.args.p_id));
  check("G9 trial: one original reserved per image, under the path its marked file got, for this job",
    reserves.length === 2 && reserves[0].args.p_marked_path === p0 && reserves[1].args.p_marked_path === p1
    && reserves.every((c) => c.args.p_job_id === jobId && c.args.p_operation === "generator"), reserves.map((c) => c.args.p_marked_path));
  check("G10 trial: each sealed blob opens to the EXACT clean (provider) bytes", openStash(ids[0])?.equals(img0) === true && openStash(ids[1])?.equals(img1) === true);
  const assets = tableRows("generation_assets").filter((a) => String(a.storage_path).startsWith(`${WS}/${jobId}/`));
  const attaches = trialCalls("trial_original_attach");
  check("G11 trial: attached with the asset id, the marked path and the marked file's hash → locked",
    attaches.length === 2 && attaches.every((c, i) => c.args.p_original_id === ids[i] && c.args.p_asset_id === assets[i]?.id
      && c.args.p_marked_path === [p0, p1][i] && c.args.p_marked_sha256 === sha([f0!, f1!][i]))
    && ids.every((x) => T.rows.get(x)?.status === "locked"), attaches.map((c) => c.args));
  const out = outputOf(jobId);
  check("G12 trial: provider_output says so — postprocess 'trial_watermark', trial_watermark: true, stored ≠ provider, the stored hash is the marked file's",
    out.length === 2 && out.every((o, i) => o.postprocess === "trial_watermark" && o.trial_watermark === true && o.stored_equals_provider === false
      && o.transformed_after_provider === true && o.stored_sha256 === sha([f0!, f1!][i]) && o.provider_sha256 === sha([img0, img1][i])), out);
  const settingsText = JSON.stringify(jobRow(jobId)?.settings ?? {});
  check("G13 trial: the member-readable job record carries NO mark parameters (R30)",
    !/"variant"|"luminance"|"glowRadiusPx"|"markWidth"|"opacity"/.test(settingsText));
  const thumb0 = stored("generation-assets", thumbPathFor(p0));
  const prev1 = stored("generation-assets", previewPathFor(p1));
  check("G14 trial: derivatives are made FROM THE MARKED file (thumb and preview)",
    !!thumb0 && thumb0.equals(await derive(f0!, THUMB_EDGE, THUMB_QUALITY)) && !thumb0.equals(await derive(img0, THUMB_EDGE, THUMB_QUALITY))
    && !!prev1 && prev1.equals(await derive(f1!, PREVIEW_EDGE, PREVIEW_QUALITY)) && T.derivatives.length === 2);
  const cleanSet = [img0, img1];
  check("G15 NO clean byte ever uploaded to generation-assets (files, derivatives, anything)",
    gaUploads().every((u) => !cleanSet.some((c) => u.bytes.equals(c))) && gaUploads().length === 6);
  // (A run of the clean file's entropy-coded tail: headers and standard
  // Huffman tables are legitimately shared by any two JPEGs.)
  check("G16 the clean bytes reach storage ONLY as ciphertext in trial-originals",
    T.uploads.filter((u) => cleanSet.some((c) => u.bytes.includes(c.subarray(c.length - 300, c.length - 236)))).length === 0
    && T.uploads.filter((u) => u.bucket === TRIAL_ORIGINALS_BUCKET).length === 2);
  check("G17 trial: charged once, nothing refunded", db().usageCalls.filter((c) => c.kind === "start").length === 1
    && trialCalls("trial_original_release").length === 0 && !T.calls.some((c) => c.name === "usage_event_refund_partial"));
  const startMeta = db().usageCalls.find((c) => c.kind === "start")?.args.metadata as Row | undefined;
  check("G18 trial: the usage row carries trial_watermark 'trial' and its reason", startMeta?.trial_watermark === "trial" && startMeta?.trial_watermark_reason === "trial");

  // ── failures: skipped and refunded, never clean ──
  const tiff = await sharp(await solid(64, 64, [5, 5, 5])).tiff().toBuffer();
  fresh(); await seedPhoto();
  T.decide = decideOf("trial", "trial");
  providerImages = [{ bytes: tiff, mime: "image/png" }, { bytes: img1, mime: "image/jpeg" }];
  r = await generate();
  jobId = r.ok ? r.jobId : "";
  const refund = T.calls.find((c) => c.name === "usage_event_refund_partial");
  check("G19 an image that cannot be marked is NOT delivered: skipped, its share refunded, the other delivered",
    r.ok && r.images.length === 1 && refund?.args.p_amount === 5 && stored("generation-assets", `${WS}/${jobId}/0.png`) === null
    && !gaUploads().some((u) => u.bytes.equals(tiff)), { r, refund: refund?.args });
  check("G20 the slot counter advanced past the skipped image: the next one is stored at /1.jpg (no path reuse)",
    stored("generation-assets", `${WS}/${jobId}/1.jpg`) !== null && trialCalls("trial_original_reserve").length === 1
    && trialCalls("trial_original_reserve")[0].args.p_marked_path === `${WS}/${jobId}/1.jpg`);

  for (const [label, setup] of [
    ["the original cannot be reserved", () => { T.reserveError = { code: "42501", message: "forbidden" }; }],
    ["the sealed blob cannot be uploaded", () => { T.uploadFail = (b) => b === TRIAL_ORIGINALS_BUCKET; }],
    ["the marked file cannot be uploaded", () => { T.uploadFail = (b, p) => b === "generation-assets" && !p.includes("_"); }],
  ] as const) {
    fresh(); await seedPhoto();
    T.decide = decideOf("trial", "trial");
    providerImages = [{ bytes: img0, mime: "image/png" }, { bytes: img1, mime: "image/jpeg" }];
    setup();
    r = await generate();
    const ev = db().events[0];
    const rows = [...T.rows.values()];
    check(`G21 ${label} → nothing delivered, storage_failed, the whole charge refunded`,
      !r.ok && r.error === "storage_failed" && ev?.status === "refunded" && db().wallet.balance === 1000
      && bucketObjects("generation-assets").length === 0, { r, ev: ev?.status });
    check(`G22 ${label} → no original is left pending or openable`,
      rows.every((x) => x.status === "orphaned" && !T.keys.has(x.id)) && bucketObjects(TRIAL_ORIGINALS_BUCKET).length === 0,
      rows.map((x) => x.status));
  }

  fresh(); await seedPhoto();
  T.decide = decideOf("trial", "trial");
  T.attachError = { message: "fetch failed" };
  providerImages = [{ bytes: img0, mime: "image/png" }];
  r = await generate({ quantity: 1 });
  check("G23 an attach that fails does not undo a delivery: the marked file is in the library, its original stays pending for the sweep",
    r.ok && r.images.length === 1 && [...T.rows.values()][0]?.status === "pending" && trialCalls("trial_original_attach").length === 1);

  fresh(); await seedPhoto();
  T.decide = () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
  providerImages = [{ bytes: img0, mime: "image/png" }];
  providerCalls = [];
  r = await generate();
  check("G24 the decision unavailable → trial_check_failed: no job, no charge, no provider call",
    !r.ok && r.error === "trial_check_failed" && tableRows("generation_jobs").length === 0
    && db().usageCalls.length === 0 && providerCalls.length === 0, r);

  // ── Retusz: the delivery first, then the mark ──
  fresh(); await seedPhoto();
  T.decide = decideOf("trial", "trial");
  const provider = await busy(96, 128, "jpeg", 9);
  providerImages = [{ bytes: provider, mime: "image/jpeg" }];
  r = await generate({ quantity: 1, aspectRatio: "auto", resolution: "2K", strictSingleImage: true, promptFirst: true, operation: "image_retouch" });
  jobId = r.ok ? r.jobId : "";
  const expected = await deliverRetouch(provider, "image/jpeg", "2K", "auto");
  const ro = outputOf(jobId)[0] ?? {};
  const rid = String(trialCalls("trial_original_reserve")[0]?.args.p_id ?? "");
  const rfile = stored("generation-assets", String(ro.stored_path ?? ""));
  const rmeta = rfile ? await sharp(rfile).metadata() : null;
  check("G25 Retusz trial: the DELIVERED 2K file is what is marked — its size kept, its own postprocess kept, trial_watermark: true",
    r.ok && ro.postprocess === expected.postprocess && ro.trial_watermark === true && ro.delivered_width === expected.width
    && ro.stored_width === expected.width && ro.stored_height === expected.height && rmeta?.width === expected.width && rmeta?.height === expected.height
    && ro.provider_sha256 === sha(provider), { ro, expected: { w: expected.width, h: expected.height, p: expected.postprocess } });
  check("G26 Retusz trial: the original is the exact delivered file (never the provider's raw image)", openStash(rid)?.equals(expected.bytes) === true
    && trialCalls("trial_original_reserve")[0]?.args.p_operation === "image_retouch");
  check("G27 Retusz trial: the marked file is not the delivered one", !!rfile && !rfile.equals(expected.bytes));

  // ── the time budget (R35) ──
  fresh(); await seedPhoto();
  T.decide = decideOf("trial", "trial");
  providerImages = [{ bytes: img0, mime: "image/png" }, { bytes: img1, mime: "image/jpeg" }];
  const realNow = Date.now;
  onGenerate = () => { const shift = 270_000; Date.now = () => realNow() + shift; };
  try {
    r = await generate();
  } finally {
    Date.now = realNow;
    onGenerate = null;
  }
  check("G28 past the trial budget (265 s into the route) no image is begun: nothing stored, the charge refunded",
    !r.ok && r.error === "storage_failed" && db().events[0]?.status === "refunded" && trialCalls("trial_original_reserve").length === 0, r);
}

/* ══ M · Miniaturka ══════════════════════════════════════════════════════*/

type Recorder = { retouch: RetouchInput[]; sunburst: SunburstCallInput[] };
const RAW = sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 90, g: 140, b: 200 } } }).png().toBuffer();
const USAGE = {
  input_tokens: 4200, input_tokens_details: { image_tokens: 3000, text_tokens: 1200 },
  output_tokens: 6000, output_tokens_details: { image_tokens: 6000, text_tokens: 0 }, total_tokens: 10200,
};
function okFetch(image?: Buffer) {
  return (async () => {
    const b64 = (image ?? await RAW).toString("base64");
    return new Response(JSON.stringify({ created: 1, data: [{ b64_json: b64 }], size: "2048x2048", quality: "high", background: "opaque", output_format: "png", usage: USAGE }),
      { status: 200, headers: { "x-request-id": "req_123" } });
  }) as unknown as typeof fetch;
}
function depsFor(rec: Recorder, runRetouch: ThumbnailDeps["runRetouch"], extra: Partial<ThumbnailDeps> = {}): Partial<ThumbnailDeps> {
  return {
    now: () => db().now,
    runRetouch,
    callSunburst: async (input) => { rec.sunburst.push(input); return callSunburst({ ...input, fetchImpl: okFetch() }); },
    ...extra,
  };
}
const noRetouch: ThumbnailDeps["runRetouch"] = async () => { throw new Error("no Retusz expected"); };

async function seedPhotos(n: number): Promise<string[]> {
  const paths: string[] = [];
  for (let i = 0; i < n; i++) {
    const p = `${WS}/thumbnail-test/${id("photo")}.png`;
    db().storage.set(`product-images:${p}`, await solid(32 + i, 32, [10 * i, 50, 100]));
    paths.push(p);
  }
  return paths;
}
async function startRun(photos: string[], retouch: boolean) {
  const d = db();
  const unit = d.env.retouch.available ? d.env.retouch.unit : null;
  const total = quoteTotal({ photos: photos.length, retouch, retouchUnit: unit, thumbnailCredits: d.env.thumbnailCredits ?? 0 }).total;
  const s = await startThumbnailRun(SUPA, USER, WS, { photos, retouch, quotedTotal: total, attempt: randomUUID() });
  if (!s.ok) throw new Error(`start failed: ${s.error}`);
  return s.runId;
}
async function driveToEnd(runId: string, deps: Partial<ThumbnailDeps>) {
  for (let i = 0; i < 20; i++) {
    await advanceThumbnailRun(SUPA, USER, WS, runId, { deadlineAt: db().now + 270_000, deps });
    const r = db().runs.get(runId)!;
    if (r.status !== "queued" && r.status !== "running") return r;
    db().now += 11_000;
  }
  return db().runs.get(runId)!;
}
const composeStarts = () => db().usageCalls.filter((c) => c.kind === "start" && c.args.serviceSlug === "tool_thumbnail");
const composeJobs = () => tableRows("generation_jobs").filter((j) => (j.settings as Row | null)?.operation === THUMBNAIL_OPERATION);

type PassState = "none" | "locked" | "unlocked" | "unlocked_repointed" | "unlocked_bad" | "expired" | "deleted" | "orphaned";

/** A Retusz pass as the TRIAL pipeline leaves it: the marked tile in the
 *  library, its clean original sealed and recorded (in the given state). */
function trialRetouch(rec: Recorder, state: PassState, clean: Buffer) {
  return async (_s: unknown, userId: string, ws: string, input: RetouchInput): Promise<RetouchResult> => {
    rec.retouch.push({ ...input });
    const jobId = id("rjob");
    const markedPath = `${ws}/${jobId}/0.png`;
    let file = clean;
    let resultPath = markedPath;
    if (state !== "none") {
      const marked = (await sealTrialOutput(clean, CFG)) as TrialMarked;
      file = marked.bytes;
      const st = await stashTrialOriginal(SUPA, { workspaceId: ws, jobId, operation: "image_retouch", markedPath, clean, marked });
      const row = T.rows.get(st!.originalId)!;
      row.status = "locked";
      if (state.startsWith("unlocked")) {
        row.status = "unlocked";
        row.unlocked_path = `${ws}/${jobId}/u-${row.id}.png`;
        T.keys.delete(row.id);
        db().storage.set(`generation-assets:${row.unlocked_path}`, state === "unlocked_bad" ? file : clean);
        // R13: an unlock repoints the step output to the clean file.
        if (state === "unlocked_repointed") resultPath = row.unlocked_path;
      } else if (state !== "locked") {
        row.status = state;
        T.keys.delete(row.id);
      }
    }
    db().storage.set(`generation-assets:${markedPath}`, file);
    tableRows("generation_jobs").push({ id: jobId, workspace_id: ws, user_id: userId, status: "completed", credits_charged: 7,
      created_at: iso(db().now), settings: { operation: "image_retouch", reference_paths: [input.sourcePath],
        provider_output: [{ stored_path: markedPath, stored_sha256: sha(file) }] } });
    const genId = id("gen");
    tableRows("generations").push({ id: genId, job_id: jobId, workspace_id: ws });
    tableRows("generation_assets").push({ id: id("asset"), generation_id: genId, storage_path: resultPath });
    return { ok: true, generationId: null, jobId, url: `https://signed/${resultPath}`, path: resultPath, credits: 7 };
  };
}

async function sectionM() {
  console.log("\nM. MINIATURKA — the trial composition and its clean sources");

  // M1 — Retusz OFF, a trial workspace: delivered marked.
  fresh();
  T.decide = decideOf("trial", "trial");
  let rec: Recorder = { retouch: [], sunburst: [] };
  let runId = await startRun(await seedPhotos(2), false);
  let run = await driveToEnd(runId, depsFor(rec, noRetouch));
  const asset = tableRows("generation_assets").find((a) => (a.metadata as Row | undefined)?.tool !== undefined);
  const path = String(asset?.storage_path ?? "");
  const file = stored("generation-assets", path);
  const reserve = trialCalls("trial_original_reserve")[0]?.args;
  const oid = String(reserve?.p_id ?? "");
  const cleanFin = oid ? openStash(oid) : null;
  const finCheck = cleanFin ? await verifyThumbnail(cleanFin, 2560, 77) : null;
  const job = composeJobs()[0];
  const po = (((job?.settings as Row | undefined)?.provider_output ?? []) as Row[])[0] ?? {};
  const fin = db().steps.find((s) => s.run_id === runId && s.position === 3 && s.status === "succeeded");
  const delivered = (fin?.output ?? {}) as Row;
  check("M1 run ok, ONE Sunburst request, ONE charge, closed", run.status === "ok" && rec.sunburst.length === 1 && composeStarts().length === 1
    && db().usageCalls.some((c) => c.kind === "complete"), { status: run.status, error: run.error });
  check("M2 the library file is MARKED: 2560×2560 like the finish, but not the finish's bytes",
    !!file && !!cleanFin && !file.equals(cleanFin) && (await sharp(file).metadata()).width === 2560 && (await sharp(file).metadata()).height === 2560);
  check("M3 the clean original is the exact finished file (2560², white margin verified), sealed with no marked path yet",
    !!finCheck && finCheck.size && finCheck.marginWhite && reserve?.p_marked_path === null && reserve?.p_operation === THUMBNAIL_OPERATION
    && reserve?.p_job_id === job?.id, { finCheck, reserve: reserve?.p_marked_path });
  check("M4 attached to the library asset with the marked path and hash → locked",
    trialCalls("trial_original_attach")[0]?.args.p_asset_id === asset?.id && trialCalls("trial_original_attach")[0]?.args.p_marked_path === path
    && trialCalls("trial_original_attach")[0]?.args.p_marked_sha256 === sha(file ?? Buffer.alloc(0)) && T.rows.get(oid)?.status === "locked");
  check("M5 markJobCompleted with the MARKED hash; a flag, never the mark's parameters, on the job",
    po.stored_sha256 === sha(file ?? Buffer.alloc(0)) && po.trial_watermark === true && Array.isArray(po.postprocess)
    && (po.postprocess as string[]).at(-1) === "trial_watermark" && !/"variant"|"luminance"/.test(JSON.stringify(job?.settings ?? {})), po);
  check("M6 the delivered record names the marked file (path, hash, bytes)",
    delivered.path === path && delivered.sha256 === sha(file ?? Buffer.alloc(0)) && delivered.bytes === file?.length && delivered.trial_watermark === true);
  const t = stored("generation-assets", thumbPathFor(path));
  check("M7 derivatives from the MARKED file", !!t && !!file && t.equals(await derive(file, THUMB_EDGE, THUMB_QUALITY))
    && !!cleanFin && !t.equals(await derive(cleanFin, THUMB_EDGE, THUMB_QUALITY)));
  check("M8 no clean byte in generation-assets; the composition's usage row stamped 'trial'",
    !!cleanFin && gaUploads().every((u) => !u.bytes.equals(cleanFin)) && (composeStarts()[0]?.args.metadata as Row)?.trial_watermark === "trial");

  // M9 — the mark cannot be made → watermark_failed, refunded, nothing kept.
  fresh();
  T.decide = decideOf("trial", "trial");
  rec = { retouch: [], sunburst: [] };
  const tiff = await sharp(await solid(64, 64, [1, 1, 1])).tiff().toBuffer();
  runId = await startRun(await seedPhotos(1), false);
  run = await driveToEnd(runId, depsFor(rec, noRetouch, {
    finish: async (raw, cfg) => ({ ...(await finishThumbnail(raw, cfg)), bytes: tiff }),
  }));
  check("M9 a mark that cannot be made → watermark_failed: refunded, no library row, no file, nothing reserved",
    run.status === "failed" && run.error === "watermark_failed" && db().events[0]?.status === "refunded"
    && tableRows("generation_assets").length === 0 && bucketObjects("generation-assets").length === 0 && T.rows.size === 0, { error: run.error });

  // M10 — the original cannot be kept → storage_failed.
  fresh();
  T.decide = decideOf("trial", "trial");
  T.reserveError = { code: "42501", message: "forbidden" };
  rec = { retouch: [], sunburst: [] };
  runId = await startRun(await seedPhotos(1), false);
  run = await driveToEnd(runId, depsFor(rec, noRetouch));
  check("M10 the original cannot be kept → storage_failed, refunded, nothing in the library",
    run.status === "failed" && run.error === "storage_failed" && db().events[0]?.status === "refunded" && tableRows("generation_assets").length === 0, run.error);

  // M11 — a failure AFTER the stash releases it.
  fresh();
  T.decide = decideOf("trial", "trial");
  db().faults.add("generation_assets:insert");
  rec = { retouch: [], sunburst: [] };
  runId = await startRun(await seedPhotos(1), false);
  run = await driveToEnd(runId, depsFor(rec, noRetouch));
  const row = [...T.rows.values()][0];
  check("M11 a library failure after the stash → library_failed, refunded, the original released and its blob removed",
    run.status === "failed" && run.error === "library_failed" && db().events[0]?.status === "refunded"
    && row?.status === "orphaned" && !T.keys.has(row.id) && bucketObjects(TRIAL_ORIGINALS_BUCKET).length === 0
    && trialCalls("trial_originals_mark_purged").length === 1, { error: run.error, status: row?.status });

  // M12 — no decision → refused before the charge.
  fresh();
  T.decide = () => ({ data: null, error: { code: "PGRST202", message: "missing" } });
  rec = { retouch: [], sunburst: [] };
  runId = await startRun(await seedPhotos(1), false);
  run = await driveToEnd(runId, depsFor(rec, noRetouch));
  check("M12 the decision unavailable → trial_check_failed: no composition job, no charge, no request",
    run.status === "failed" && run.error === "trial_check_failed" && composeJobs().length === 0 && composeStarts().length === 0 && rec.sunburst.length === 0, run.error);

  // M13 — off: today's delivery (the finish's own bytes, no trial call but the decision).
  fresh();
  rec = { retouch: [], sunburst: [] };
  runId = await startRun(await seedPhotos(1), false);
  run = await driveToEnd(runId, depsFor(rec, noRetouch));
  const offAsset = tableRows("generation_assets")[0];
  const offFile = stored("generation-assets", String(offAsset?.storage_path ?? ""));
  const offPo = (((composeJobs()[0]?.settings as Row | undefined)?.provider_output ?? []) as Row[])[0] ?? {};
  check("M13 off: delivered as today — the stored file is the finish (hash recorded), no trial flag, nothing reserved",
    run.status === "ok" && !!offFile && offPo.stored_sha256 === sha(offFile) && offPo.trial_watermark === undefined
    && !(offPo.postprocess as string[]).includes("trial_watermark") && T.rows.size === 0
    && T.calls.filter((c) => c.name.startsWith("trial_")).every((c) => c.name === "trial_watermark_decide"));

  // M14+ — Retusz ON: the clean pass behind a marked tile.
  const clean = await solid(64, 64, [200, 120, 60]);
  const cases: { state: PassState; compose: "trial" | "paid"; expect: string; sentClean?: boolean; byUnlocked?: boolean }[] = [
    { state: "none", compose: "paid", expect: "ok", sentClean: true },
    { state: "locked", compose: "trial", expect: "ok", sentClean: true },
    { state: "locked", compose: "paid", expect: "source_locked" },
    { state: "unlocked", compose: "paid", expect: "ok", sentClean: true },
    { state: "unlocked_repointed", compose: "paid", expect: "ok", sentClean: true },
    { state: "unlocked_repointed", compose: "trial", expect: "ok", sentClean: true, byUnlocked: true },
    { state: "unlocked_bad", compose: "paid", expect: "source_unavailable" },
    { state: "expired", compose: "trial", expect: "source_unavailable" },
    { state: "deleted", compose: "trial", expect: "source_unavailable" },
    { state: "orphaned", compose: "paid", expect: "source_unavailable" },
  ];
  for (const c of cases) {
    fresh();
    T.decide = decideOf(c.compose, c.compose);
    T.sourceByUnlocked = c.byUnlocked === true;
    rec = { retouch: [], sunburst: [] };
    runId = await startRun(await seedPhotos(1), true);
    run = await driveToEnd(runId, depsFor(rec, trialRetouch(rec, c.state, clean)));
    const sent = rec.sunburst[0]?.spec.images[0]?.bytes;
    const label = `${c.state}${c.byUnlocked ? " (found by its unlocked path)" : ""}, composition ${c.compose}`;
    if (c.expect === "ok") {
      const step = db().steps.find((s) => s.run_id === runId && s.position === 2 && s.status === "succeeded");
      const inp = (((step?.output as Row | undefined)?.request as Row | undefined)?.inputs as Row[] | undefined)?.[0] ?? {};
      check(`M14 ${label} → the model is sent the CLEAN pass`, run.status === "ok" && rec.sunburst.length === 1 && !!sent && sent.equals(clean),
        { status: run.status, error: run.error });
      if (c.state !== "none") {
        check(`M15 ${label} → the admin record verifies the CLEAN hash, never the marked one`,
          inp.retouch_stored_sha256 === sha(clean) && inp.retouch_verified === true, inp);
      }
    } else {
      check(`M16 ${label} → ${c.expect}: refused before the charge, no request`, run.status === "failed" && run.error === c.expect
        && composeStarts().length === 0 && rec.sunburst.length === 0
        // A locked original is not even fetched for a composition that may not open it.
        && (c.expect !== "source_locked" || !T.downloads.some((x) => x.bucket === TRIAL_ORIGINALS_BUCKET)), { status: run.status, error: run.error });
    }
  }
  fresh();
  T.decide = decideOf("trial", "trial");
  rec = { retouch: [], sunburst: [] };
  runId = await startRun(await seedPhotos(1), true);
  T.sourceError = { message: "fetch failed" };
  run = await driveToEnd(runId, depsFor(rec, trialRetouch(rec, "locked", clean)));
  check("M17 the source lookup failing → source_unavailable (never 'not a trial image'), nothing charged",
    run.status === "failed" && run.error === "source_unavailable" && composeStarts().length === 0 && rec.sunburst.length === 0, run.error);
}

/* ══ W · Workflow ON ═════════════════════════════════════════════════════*/

const gx = globalThis as unknown as {
  __fidelityEngine?: EngineConfig | null;
  __trialWorkflow?: Row | null;
  __trialWorkflowStarts?: Row[];
};

async function sectionW() {
  console.log("\nW. WORKFLOW ON — a trial workspace is refused before anything starts (R27)");
  const engine = (over: Partial<EngineConfig> = {}): EngineConfig => ({
    toolKey: "retouch", mode: "grovbase", serviceSlug: "image_edit", allowModelChoice: false,
    fallbackEnabled: false, timeoutMs: 120_000, maxAttempts: 1, primaryModelId: "m-1", fallbackModelId: null,
    systemPrompt: null, promptVersion: null, knowledgeStrategy: "proven", workflowEnabled: true, ...over,
  });
  const run = () => runEngineImageTool(SUPA, USER, WS, {
    toolKey: "retouch", hint: "", referencePaths: [PHOTO],
    generation: { modelId: "m-1", aspectRatio: "1:1", resolution: "1K", quantity: 1, referenceImageIds: [] }, expectedCost: 7,
  });
  const published = { id: "wf-1", version: 3, status: "published", maxOutputs: 1, concurrency: 1, legacy: false, steps: [] };
  for (const [mode, expect] of [["trial", "trial_workflow_unavailable"], ["error", "trial_check_failed"]] as const) {
    fresh();
    gx.__fidelityEngine = engine();
    gx.__trialWorkflow = published;
    gx.__trialWorkflowStarts = [];
    T.decide = mode === "error" ? () => ({ data: null, error: { code: "PGRST202", message: "missing" } }) : decideOf("trial", "trial");
    providerCalls = [];
    const r = await run();
    check(`W1 decision ${mode} → ${expect}: no run started, no image call, no charge`,
      !r.ok && r.error === expect && gx.__trialWorkflowStarts.length === 0 && providerCalls.length === 0 && db().usageCalls.length === 0
      && trialCalls("trial_watermark_decide")[0]?.args.p_credits === 7, r);
  }
  fresh();
  gx.__fidelityEngine = engine();
  gx.__trialWorkflow = published;
  gx.__trialWorkflowStarts = [];
  T.decide = decideOf("paid", "subscription");
  let r = await run();
  check("W2 paid → the workflow run is started as before (pending)", r.ok && isPending(r) && gx.__trialWorkflowStarts.length === 1, r);
  fresh();
  gx.__fidelityEngine = engine();
  gx.__trialWorkflow = { ...published, status: "draft" };
  gx.__trialWorkflowStarts = [];
  r = await run();
  check("W3 Workflow ON with nothing published: the guard is not consulted (the single path decides inside runGeneration)",
    !r.ok && r.error === "prompt_unconfigured" && trialCalls("trial_watermark_decide").length === 0);
  gx.__fidelityEngine = null;
  gx.__trialWorkflow = null;
}

/* ══ R · the paid tools ══════════════════════════════════════════════════*/

let fetchCalls = 0;
async function sectionR() {
  console.log("\nR. PAID TOOLS — a trial workspace is refused before the free run or a credit (D1)");
  const out = await sharp({ create: { width: 64, height: 48, channels: 4, background: { r: 250, g: 250, b: 250, alpha: 1 } } }).png().toBuffer();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalls++;
    return new Response(new Uint8Array(out), { status: 200, headers: { "content-type": "image/png", "x-request-id": "req_1" } });
  }) as typeof fetch;
  process.env.PHOTOROOM_API_KEY = "live_key_abc";
  const jpeg = await solid(400, 300, [200, 40, 40], "jpeg");
  const runRemoveBg = () => runTool(SUPA, USER, WS, { tool: "remove_bg", settings: { format: "png" }, file: jpeg, mime: "image/jpeg", idempotencyKey: `k-${randomUUID()}` });
  try {
    for (const [mode, expect] of [["trial", "trial_tool_unavailable"], ["error", "trial_check_failed"]] as const) {
      fresh();
      T.settings = [{ key: "free_tools", value: { remove_bg: { enabled: true, limit: 10 } } }];
      T.decide = mode === "error" ? () => ({ data: null, error: { code: "PGRST202", message: "missing" } }) : decideOf("trial", "trial");
      fetchCalls = 0;
      const r = await runRemoveBg();
      check(`R1 decision ${mode} → ${expect}: 0 provider calls, 0 credits, the free run neither claimed nor released`,
        !r.ok && r.error === expect && fetchCalls === 0 && db().usageCalls.length === 0 && db().wallet.balance === 1000
        && !T.calls.some((c) => c.name === "claim_free_tool_run" || c.name === "release_free_tool_run"), r);
    }
    fresh();
    T.settings = [{ key: "free_tools", value: { remove_bg: { enabled: true, limit: 10 } } }];
    T.decide = decideOf("paid", "paid_credits");
    fetchCalls = 0;
    const r = await runRemoveBg();
    check("R2 paid → the tool runs as before (one provider call, the free allowance consulted)",
      r.ok && fetchCalls === 1 && T.calls.some((c) => c.name === "claim_free_tool_run"), r);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.PHOTOROOM_API_KEY;
  }
}

/* ══ S · structure ═══════════════════════════════════════════════════════*/

function sectionS() {
  console.log("\nS. STRUCTURE — where the hooks sit");
  const read = (f: string) => readFileSync(f, "utf8");
  const gen = read("lib/server/generation.ts");
  const iDecide = gen.indexOf("const trial = await decideTrialWatermark(");
  check("S1 generation.ts decides right after the wallet check, before the product, the job and the charge",
    iDecide > gen.indexOf('error: "insufficient_credits", missingCredits: cost - wallet.balance')
    && iDecide < gen.indexOf('from("products").insert(') && iDecide < gen.indexOf('from("generation_jobs").insert(')
    && iDecide < gen.indexOf("const usage = await startUsage("));
  const loop = gen.slice(gen.indexOf("for (const img of result.images) {"));
  check("S2 the slot is taken before any `continue`, and the mark comes after the Retusz delivery",
    loop.indexOf("const slot = idx++;") < loop.indexOf("continue;") && loop.indexOf("deliverRetouch(") < loop.indexOf("sealTrialOutput(")
    && loop.indexOf("sealTrialOutput(") < loop.indexOf('.upload(path, bytes, { contentType: mime, upsert: true })'));
  const tr = read("lib/server/engine/tool-run.ts");
  const wfBlock = tr.slice(tr.indexOf('if (workflow && workflow.status === "published") {'), tr.indexOf("const started = await startWorkflowRun("));
  check("S3 tool-run.ts: the guard sits inside the published-workflow branch, before startWorkflowRun",
    /decideTrialWatermark\(/.test(wfBlock) && /trial_workflow_unavailable/.test(wfBlock));
  const all = read("lib/server/image-tools.ts");
  const paid = all.slice(all.indexOf("async function runPaid("), all.indexOf("export async function runToolProviderStep("));
  const iGuard = paid.indexOf("decideTrialWatermark(");
  check("S4 runPaid: refused after no_provider/provider_sandbox, before the free allowance, the wallet and startUsage",
    iGuard > paid.indexOf('error: "no_provider"') && iGuard > paid.indexOf('error: "provider_sandbox"')
    && iGuard < paid.indexOf("freeToolRules(supabase)") && iGuard < paid.indexOf('from("credit_wallets")') && iGuard < paid.indexOf("startUsage(supabase"));
  check("S5 …and tool-status's own ordering pins still hold",
    paid.indexOf('if (!picked) return { ok: false, error: "no_provider" };') < paid.indexOf("freeToolRules(supabase)")
    && paid.indexOf('if (sandbox && !input.viewerIsAdmin) return { ok: false, error: "provider_sandbox" };') < paid.indexOf("startUsage(supabase"));
  const run = read("lib/server/thumbnail/run.ts");
  const compose = run.slice(run.indexOf("async function composeStep("), run.indexOf("async function inLane("));
  check("S6 Miniaturka decides in the free phase: before the photos are read (and so before the job insert and the charge)",
    compose.indexOf("decideTrialWatermark(") > 0 && compose.indexOf("decideTrialWatermark(") < compose.indexOf("preparePhotos("));
  const call = /ctx\.deps\.runRetouch\(supabase, ctx\.userId, ctx\.workspaceId, (\{[^}]*\})\)/.exec(run)?.[1]?.replace(/\s+/g, " ").replace(/,\s*\}$/, " }") ?? "";
  check("S7 the runRetouch call object is byte-identical (parity C0)",
    call === "{ sourcePath: photo, resolution: input.retouch_resolution, format: \"original\", quotedOutputs: 1 }", call);
  check("S8 Miniaturka keeps its G2–G4 pins", !/buildFidelityInstructions|PRODUCT_LOCK|fidelity_rules|knowledge_/.test(run)
    && /prompt: prompt\.text,/.test(run) && /model: input\.config\.model, prompt: prompt\.text/.test(run));
  const deliver = run.slice(run.indexOf("async function deliver("), run.indexOf("async function resumeFinish("));
  check("S9 deliver(): the mark after the finish, before markJobCompleted / storeNew; derivatives from the stored bytes",
    deliver.indexOf("ctx.deps.finish(") < deliver.indexOf("sealTrialOutput(") && deliver.indexOf("stashTrialOriginal(") < deliver.indexOf("markJobCompleted(")
    && deliver.indexOf("markJobCompleted(") < deliver.indexOf("storeNew(") && /derivatives\(supabase, asset\.id, path, out\.bytes\)/.test(deliver));
  const pipe = read("lib/server/trial-watermark/pipeline.ts");
  check("S10 pipeline.ts loads the engine lazily (the trial branch only) and imports nothing else of it but types",
    /await import\("\.\/engine"\)/.test(pipe) && !/^import \{[^}]*\} from "\.\/engine";/m.test(pipe) && /^import type \{[^}]*\} from "\.\/engine";/m.test(pipe));
  const nc = read("next.config.mjs");
  check("S11 next.config.mjs traces the asset PNG into every function", /outputFileTracingIncludes:\s*\{\s*'\/\*\*': \['\.\/lib\/server\/trial-watermark\/assets\/\*\.png'\]/.test(nc));
  check("S12 no producer writes the mark's parameters onto a job row", !/trial_watermark: marked\.info|trial_watermark: info/.test(gen + run));
}

async function main() {
  console.log("TRIAL WATERMARK — pipeline");
  // The key wrap needs the server secret (scripts/stubs/thumb-server-token).
  const cfg = parseTrialWatermarkConfig(CONFIG_ROW);
  if (!cfg.enabled) throw new Error("config round trip");
  await sectionE();
  sectionC();
  await sectionD();
  await sectionP();
  await sectionG();
  await sectionM();
  await sectionW();
  await sectionR();
  sectionS();
  console.log(failures === 0 ? `\nAll trial-watermark pipeline tests passed (${passed} passed).` : `\n${failures} TRIAL-WATERMARK PIPELINE TEST(S) FAILED (${passed} passed).`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
