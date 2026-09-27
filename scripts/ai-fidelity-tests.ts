/**
 * IMAGE FIDELITY — what a Retusz run really sends to Google.
 *
 * The real chain, not a description of it:
 *   runRetouch → runEngineImageTool → runGeneration → googleAdapter
 *   → buildGeminiImageRequest → fetch(generativelanguage.googleapis.com)
 * with only the edges faked: the database (an in-memory Supabase double), the
 * prompt decryption (resolveEngine returns the test's configuration — the
 * vault itself is test:promptvault), the provider key, the credit ledger and
 * the network (global fetch records the exact body and answers like Gemini).
 *
 * Every check reads the BODY THAT WOULD LEAVE THE SERVER: its text part, its
 * inline image bytes, its imageConfig, the URL's model id — and the request
 * record stored on the job (generation_jobs.settings.provider_request).
 *
 * Run: npm run test:fidelity
 */
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { EngineConfig } from "@/lib/server/ai-engine";
import { runRetouch, retouchStepConfig, RETOUCH_MODEL_IDENTIFIER, RETOUCH_OPERATION } from "@/lib/server/retouch";
import { promptDigest } from "@/lib/server/prompt-digest";
import { FASHION_MODEL_IDENTIFIER } from "@/lib/server/fashion";
import { callImageModel } from "@/lib/server/engine/image-call";
import { prepareGeneratorEngine } from "@/lib/server/engine/tool-run";
import { runGeneration } from "@/lib/server/generation";
import { GEMINI_IMAGE_ASPECT_RATIOS, buildGeminiImageRequest, geminiImageSize, pickGeminiFinalImage } from "@/lib/ai/providers/google-request";
import { resolveOriginalAspectRatio } from "@/lib/ai/aspect-ratio";
import { RATIO_SHAPE, type AspectRatio } from "@/lib/ai/types";
import { buildFidelityInstructions } from "@/lib/ai/product-lock";
import { compileTemplate, TOOL_VARIABLES } from "@/lib/ai/prompt-variables";
import { prepareReferenceImage } from "@/lib/server/reference-image";
import { buildRequestManifest } from "@/lib/server/engine/request-manifest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); if (detail !== undefined) console.log("      ", typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 600)); }
}
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/* ── the in-memory database ───────────────────────────────────────────────*/

type Row = Record<string, unknown>;
type Db = {
  models: Row[];
  files: Map<string, Buffer>;
  jobs: Map<string, Row>;
  tables: string[];              // every table touched, in order
  rpcs: string[];
  uploads: string[];
};

const PRO_ID = "m-pro";
const NB2_ID = "m-nb2";
function freshDb(): Db {
  const provider = { id: "p-google", slug: "google", active: true };
  const base = {
    active: true, supports_reference_images: true, max_reference_images: 6,
    supported_aspect_ratios: ["1:1", "4:5", "16:9", "9:16", "3:4"], supported_resolutions: ["1K", "2K", "4K"],
    credit_cost: 7, internal_cost_usd_micros: 39000, metadata: {}, capabilities: {}, visible_custom: true,
    ai_providers: provider,
  };
  return {
    models: [
      { ...base, id: PRO_ID, name: "Nano Banana Pro", display_name: "Nano Banana Pro", model_identifier: "gemini-3-pro-image", pricing: { "1K": 7, "2K": 7, "4K": 12 } },
      { ...base, id: NB2_ID, name: "Nano Banana 2", display_name: "Nano Banana 2", model_identifier: "gemini-3.1-flash-image", pricing: { "1K": 4, "2K": 5, "4K": 8 } },
    ],
    files: new Map(), jobs: new Map(), tables: [], rpcs: [], uploads: [],
  };
}

let jobSeq = 0;
function fakeSupabase(db: Db) {
  const from = (table: string) => {
    db.tables.push(table);
    const filters: [string, unknown][] = [];
    let inFilter: [string, unknown[]] | null = null;
    let op: "select" | "insert" | "update" = "select";
    let payload: Row | Row[] | null = null;
    const rowsFor = (): Row[] => {
      let rows: Row[] = [];
      if (table === "ai_models") rows = db.models;
      else if (table === "credit_wallets") rows = [{ id: "wal-1", balance: 1000, workspace_id: "w" }];
      else if (table === "generation_jobs") rows = [...db.jobs.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      else if (table === "app_settings") rows = [];
      for (const [k, v] of filters) {
        if (k.includes(".")) continue;          // joined-table filters (ai_providers.active) — the double keeps providers active
        if (k.includes("->>")) {
          const [col, key] = k.split("->>");
          rows = rows.filter((r) => ((r[col!] ?? {}) as Row)[key!] === v);
          continue;
        }
        rows = rows.filter((r) => r[k] === v);
      }
      if (inFilter) { const [k, vs] = inFilter; rows = rows.filter((r) => vs.includes(r[k])); }
      return rows;
    };
    const result = () => {
      if (op === "insert") {
        const row = Array.isArray(payload) ? payload[0] : payload;
        if (table === "generation_jobs") {
          const id = `job-${++jobSeq}`;
          db.jobs.set(id, { ...(row ?? {}), id, created_at: new Date(Date.now() + jobSeq).toISOString() });
          return { data: { id }, error: null };
        }
        return { data: { id: `${table}-row` }, error: null };
      }
      if (op === "update") {
        if (table === "generation_jobs") {
          const id = filters.find(([k]) => k === "id")?.[1] as string;
          const cur = db.jobs.get(id);
          if (cur) db.jobs.set(id, { ...cur, ...(payload as Row) });
        }
        return { data: null, error: null };
      }
      return { data: rowsFor(), error: null };
    };
    const q = {
      select: () => q,
      insert: (p: Row | Row[]) => { op = "insert"; payload = p; return q; },
      update: (p: Row) => { op = "update"; payload = p; return q; },
      upsert: (p: Row) => { op = "insert"; payload = p; return q; },
      eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
      in: (k: string, vs: unknown[]) => { inFilter = [k, vs]; return q; },
      order: () => q, limit: () => q, gte: () => q, lte: () => q, is: () => q, neq: () => q,
      maybeSingle: async () => { const r = result(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null }; },
      single: async () => { const r = result(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null }; },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
    };
    return q;
  };
  return {
    from,
    rpc: async (name: string) => {
      db.rpcs.push(name);
      if (name === "provider_credential_read") return { data: [{ base_url: null }], error: null };
      return { data: null, error: null };
    },
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          const b = db.files.get(path);
          return b ? { data: new Blob([new Uint8Array(b)]), error: null } : { data: null, error: { message: "not found" } };
        },
        // Keeps what was written, so a read-back sees exactly the uploaded bytes.
        upload: async (path: string, body?: unknown) => {
          db.uploads.push(`${bucket}/${path}`);
          if (Buffer.isBuffer(body)) db.files.set(path, Buffer.from(body));
          return { error: null };
        },
        createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}` })), error: null }),
      }),
    },
  };
}
type FakeClient = Parameters<typeof runRetouch>[0];

/* ── the network ─────────────────────────────────────────────────────────*/

type Sent = { url: string; body: {
  contents: { role: string; parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] }[];
  generationConfig: { responseModalities: string[]; imageConfig: { aspectRatio?: string; imageSize?: string }; [k: string]: unknown };
  [k: string]: unknown;
} };
let sent: Sent[] = [];
let script: number[] = [];      // HTTP statuses to answer, in order (200 = an image)
let outPng = "";
/** When set, the parts of the next successful Gemini answers (thought drafts etc.). */
let responseParts: Record<string, unknown>[] | null = null;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.includes("generativelanguage.googleapis.com")) return realFetch(input, init);
  sent.push({ url, body: JSON.parse(String(init?.body)) });
  const status = script.shift() ?? 200;
  if (status !== 200) {
    return new Response(JSON.stringify({ error: { status: "UNAVAILABLE", message: "overloaded", details: [{ retryDelay: "0.01s" }] } }), { status });
  }
  return new Response(JSON.stringify({
    candidates: [{ finishReason: "STOP", content: { parts: responseParts ?? [{ inlineData: { mimeType: "image/png", data: outPng } }] } }],
    usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 1200 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

/* ── helpers ─────────────────────────────────────────────────────────────*/

const g = globalThis as unknown as { __fidelityEngine?: EngineConfig | null };
function engine(over: Partial<EngineConfig> = {}): EngineConfig {
  return {
    toolKey: "retouch", mode: "grovbase", serviceSlug: "image_edit", allowModelChoice: false,
    fallbackEnabled: false, timeoutMs: 120_000, maxAttempts: 1,
    primaryModelId: PRO_ID, fallbackModelId: null,
    systemPrompt: null, promptVersion: null, knowledgeStrategy: "proven", workflowEnabled: false,
    ...over,
  };
}
const textOf = (s: Sent) => s.body.contents[0]!.parts.filter((p): p is { text: string } => "text" in p);
const imagesOf = (s: Sent) => s.body.contents[0]!.parts.filter((p): p is { inlineData: { mimeType: string; data: string } } => "inlineData" in p);

async function retouch(db: Db, source: string, opts: { format?: string; resolution?: string } = {}) {
  sent = [];
  const res = await runRetouch(fakeSupabase(db) as unknown as FakeClient, "u", "w", {
    sourcePath: source, resolution: opts.resolution ?? "2K", format: opts.format ?? "original",
  } as Parameters<typeof runRetouch>[3]);
  const job = [...db.jobs.values()].pop();
  const pr = ((job?.settings ?? {}) as Row).provider_request as Row | undefined;
  return { res, job, pr };
}

async function main() {
  // A real photograph-shaped test image: 1500×1000 (3:2 — a shape NOT in the
  // model's ratio list, the case the old snapping reframed).
  const photo = await sharp({ create: { width: 1500, height: 1000, channels: 3, background: { r: 180, g: 120, b: 90 } } })
    .composite([{ input: Buffer.from(`<svg width="1500" height="1000"><rect x="400" y="250" width="700" height="500" fill="#224"/></svg>`), top: 0, left: 0 }])
    .jpeg({ quality: 92 }).toBuffer();
  outPng = (await sharp({ create: { width: 64, height: 43, channels: 3, background: "#888" } }).png().toBuffer()).toString("base64");
  const PHOTO_SHA = sha(photo);

  const EXACT = "GROVBASE_EXACT_PROMPT_TEST_92761\n\nKeep the exact product, camera position, perspective, proportions and composition of the supplied reference image unchanged. Only perform the requested cleanup.";

  console.log("\n§17 / T5 EXACTNESS — the published prompt reaches Google byte for byte");
  {
    const db = freshDb(); db.files.set("w/retouch-1/src.jpg", photo);
    g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3 });
    const { res, pr } = await retouch(db, "w/retouch-1/src.jpg");
    check("the run succeeded", res.ok, res);
    check("exactly one request was sent", sent.length === 1, sent.length);
    const texts = sent[0] ? textOf(sent[0]) : [];
    check("the body has exactly ONE text part", texts.length === 1, texts.length);
    check("final text === published prompt (byte for byte)", texts[0]?.text === EXACT, texts[0]?.text);
    check("sha256(final text) === sha256(published)", sha(texts[0]?.text ?? "") === sha(EXACT));
    check("no Product Lock text anywhere in the body", !JSON.stringify(sent[0]?.body).includes("PRODUCT LOCK") && !JSON.stringify(sent[0]?.body).includes("camera and mood are creative"));
    check("no systemInstruction, no thinking/mediaResolution/sampling override",
      !("systemInstruction" in (sent[0]?.body ?? {})) && Object.keys(sent[0]?.body.generationConfig ?? {}).sort().join() === "imageConfig,responseModalities");
    check("the job records policy exact, nothing appended, the digest of exactly the published text",
      pr?.prompt_policy === "exact" && pr?.fidelity_appended === false && pr?.prompt_digest === promptDigest(EXACT) && pr?.prompt_chars === Array.from(EXACT).length, pr);
    check("…and that digest is keyed — not a bare SHA-256 anyone could test guesses against", typeof pr?.prompt_digest === "string" && pr?.prompt_digest !== sha(EXACT));
  }

  console.log("\nT6 VARIABLES — only what the admin wrote is expanded");
  {
    const db = freshDb(); db.files.set("w/r/src.jpg", photo);
    g.__fidelityEngine = engine({ systemPrompt: "TEST {{fidelity_rules}}", promptVersion: 4 });
    await retouch(db, "w/r/src.jpg");
    const text = sent[0] ? textOf(sent[0])[0]?.text : undefined;
    check("'TEST {{fidelity_rules}}' → 'TEST ' + the lock, nothing more", text === `TEST ${buildFidelityInstructions()}`, text?.slice(0, 120));
    const db2 = freshDb(); db2.files.set("w/r/src.jpg", photo);
    g.__fidelityEngine = engine({ systemPrompt: "Retusz: {{tool_name}}.\n\n\n\nFormat {{aspect_ratio}}, {{resolution}}.", promptVersion: 5 });
    await retouch(db2, "w/r/src.jpg");
    const t2 = sent[0] ? textOf(sent[0])[0]?.text : undefined;
    check("system variables are substituted and the admin's blank lines are kept", t2 === "Retusz: retouch.\n\n\n\nFormat auto, 2K.", t2);
    const defs = TOOL_VARIABLES.fashion_flat_lay ?? [];
    const gaps: [string, Record<string, string>, string][] = [
      ["A {{hint?}}\n\n\n\nB", {}, "A \n\nB"],
      ["A\n\n{{hint?}}\n\nB", {}, "A\n\nB"],
      ["{{hint?}}\n\nText\n\n\n\nkeep", {}, "Text\n\n\n\nkeep"],
      ["Text\n\n\n\nkeep\n\n{{hint?}}", {}, "Text\n\n\n\nkeep"],
      ["  lead {{tool_name}} trail  ", { tool_name: "iron" }, "  lead iron trail  "],
      ["A\n\n{{hint?}}\n\n{{knowledge_scene?}}\n\nB", {}, "A\n\nB"],
    ];
    const gapFail = gaps.filter(([t, v, want]) => { const r = compileTemplate(t, defs, v); return !r.ok || r.text !== want; });
    check("only the gap an EMPTIED optional variable leaves is closed; the admin's other spacing stays", gapFail.length === 0, gapFail);
  }

  console.log("\nT7 NO HIDDEN KNOWLEDGE — nothing is fetched or injected unless a knowledge variable is placed");
  {
    const db = freshDb(); db.files.set("w/r/src.jpg", photo);
    g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3 });
    await retouch(db, "w/r/src.jpg");
    check("no knowledge table was read", !db.tables.some((t) => /knowledge/.test(t)), db.tables);
    check("no text/vision model was called (the only network call is the image edit)", sent.length === 1);
  }

  console.log("\nT8 / §18 THE PHOTO — the bytes uploaded are the bytes Google gets");
  {
    const db = freshDb(); db.files.set("w/r/src.jpg", photo);
    g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3 });
    const { pr } = await retouch(db, "w/r/src.jpg");
    const imgs = sent[0] ? imagesOf(sent[0]) : [];
    const sentBytes = Buffer.from(imgs[0]?.inlineData.data ?? "", "base64");
    check("one inline image, before the text (Google's edit order)", imgs.length === 1 && "inlineData" in (sent[0]?.body.contents[0]!.parts[0] ?? {}));
    check("sha256(sent bytes) === sha256(uploaded file)", sha(sentBytes) === PHOTO_SHA);
    check("no resize: same length, same 1500×1000", sentBytes.length === photo.length && (await sharp(sentBytes).metadata()).width === 1500);
    check("MIME from the bytes: image/jpeg", imgs[0]?.inlineData.mimeType === "image/jpeg");
    const input = (pr?.inputs as Row[] | undefined)?.[0];
    check("the job records source = sent hash, transform none, 1500×1000",
      input?.source_sha256 === PHOTO_SHA && input?.sent_sha256 === PHOTO_SHA && input?.transform === "none" && input?.width === 1500, input);

    const png = await sharp(photo).png().toBuffer();
    const misnamed = await prepareReferenceImage(png, "shot.jpg");
    check("a PNG named .jpg is sent as image/png, bytes untouched", misnamed.mime === "image/png" && misnamed.sha256 === sha(png) && misnamed.transform === "none");
    const sideways = await sharp(photo).withMetadata({ orientation: 6 }).jpeg({ quality: 95 }).toBuffer();
    const upright = await prepareReferenceImage(sideways, "phone.jpg");
    check("…and the rotated photo is not blown up (≤ 1.5× the stored size)", upright.bytes <= sideways.length * 1.5, { stored: sideways.length, sent: upright.bytes });
    check("EXIF-rotated photo: rotation baked in (1000×1500), recorded as exif_orientation",
      upright.transform === "exif_orientation" && upright.width === 1000 && upright.height === 1500 && upright.sourceSha256 === sha(sideways) && upright.sha256 !== upright.sourceSha256, upright.transform);
    const big = await sharp({ create: { width: 3000, height: 3000, channels: 3, background: "#123" } }).png({ compressionLevel: 0 }).toBuffer();
    const bigRef = await prepareReferenceImage(big, "big.png");
    check("a large original (>6 MB) is sent whole, not dropped or shrunk", big.length > 6 * 1024 * 1024 && bigRef.bytes === big.length && bigRef.transform === "none", big.length);
  }

  console.log("\nT9 MODEL — the stable Gemini 3 Pro Image id, never a Flash / 2.5 model");
  {
    check("Retusz default id is gemini-3-pro-image", RETOUCH_MODEL_IDENTIFIER === "gemini-3-pro-image");
    check("Moda default id is gemini-3-pro-image", FASHION_MODEL_IDENTIFIER === "gemini-3-pro-image");
    const db = freshDb(); db.files.set("w/r/src.jpg", photo);
    g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3 });
    const { pr } = await retouch(db, "w/r/src.jpg");
    check("the URL calls models/gemini-3-pro-image:generateContent", /\/v1beta\/models\/gemini-3-pro-image:generateContent\?/.test(sent[0]?.url ?? ""), sent[0]?.url.replace(/key=[^&]+/, "key=…"));
    check("the job names google / gemini-3-pro-image / its model row", pr?.provider === "google" && pr?.model_identifier === "gemini-3-pro-image" && pr?.model_id === PRO_ID, pr);
    const mig = read("supabase/migrations/0131_gemini_stable_model_ids.sql");
    check("migration 0131 renames in place (no insert, no delete)", /update public\.ai_models/.test(mig) && !/insert into public\.ai_models|delete from public\.ai_models/i.test(mig));
  }

  console.log("\nT10 OPERATION — a real image edit");
  {
    const db = freshDb(); db.files.set("w/r/src.jpg", photo);
    g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3 });
    const { pr } = await retouch(db, "w/r/src.jpg");
    check("recorded operation IMAGE_EDIT with the photo attached", pr?.operation === "IMAGE_EDIT" && imagesOf(sent[0]!).length === 1);
    check("responseModalities is exactly [IMAGE]", JSON.stringify(sent[0]?.body.generationConfig.responseModalities) === '["IMAGE"]');
    const db2 = freshDb();
    g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3 });
    const gone = await retouch(db2, "w/r/missing.jpg");
    check("a source that cannot be read is refused — never sent as text-to-image", !gone.res.ok && sent.length === 0 && (gone.res as { error?: string }).error === "source_unavailable", gone.res);
  }

  console.log("\nT11 / T12 ASPECT RATIO — 'Oryginalny' = the photo's own shape, stated; a chosen one sent exactly");
  {
    const db = freshDb(); db.files.set("w/r/src.jpg", photo);
    g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3 });
    const auto = await retouch(db, "w/r/src.jpg", { format: "original" });
    check("original (1500×1000 photo): imageConfig.aspectRatio '3:2' — derived from the photo, never left to the model", sent[0]?.body.generationConfig.imageConfig.aspectRatio === "3:2", sent[0]?.body.generationConfig);
    check("recorded: requested auto → ORIGINAL_DERIVED 1500×1000 (1.5) → sent 3:2",
      auto.pr?.aspect_ratio_requested === "auto" && auto.pr?.aspect_ratio_sent === "3:2" && auto.pr?.aspect_ratio_mode === "ORIGINAL_DERIVED"
      && auto.pr?.source_width === 1500 && auto.pr?.source_height === 1000 && auto.pr?.source_aspect_ratio === 1.5 && auto.pr?.resolved_aspect_ratio === "3:2", auto.pr);
    const expl = await retouch(db, "w/r/src.jpg", { format: "4:5" });
    check("chosen 4:5 → imageConfig.aspectRatio '4:5'", sent[0]?.body.generationConfig.imageConfig.aspectRatio === "4:5");
    check("recorded: requested 4:5 → sent 4:5, mode USER_SELECTED", expl.pr?.aspect_ratio_requested === "4:5" && expl.pr?.aspect_ratio_sent === "4:5" && expl.pr?.aspect_ratio_mode === "USER_SELECTED");
    const odd = await retouch(db, "w/r/src.jpg", { format: "7:3" });
    check("a ratio the model does not list falls back to 'Oryginalny' (the photo's 3:2), not to a guess", sent[0]?.body.generationConfig.imageConfig.aspectRatio === "3:2" && odd.res.ok && odd.pr?.aspect_ratio_mode === "ORIGINAL_DERIVED");
  }

  console.log("\nT13 SIZE — the size picked is the size Google is asked for");
  {
    for (const size of ["1K", "2K", "4K"]) {
      const db = freshDb(); db.files.set("w/r/src.jpg", photo);
      g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3 });
      const { pr } = await retouch(db, "w/r/src.jpg", { resolution: size });
      check(`${size} → imageConfig.imageSize '${size}' (recorded ${size})`, sent[0]?.body.generationConfig.imageConfig.imageSize === size && pr?.image_size_sent === size && pr?.resolution === size, sent[0]?.body.generationConfig);
    }
    check("a single-size model (2.5 Flash Image) is never sent imageSize", geminiImageSize({ supported_resolutions: ["1K"] }, "1K") === null);
  }

  console.log("\nT14 FALLBACK OFF / RETRIES — the panel's settings are what happens");
  {
    const db = freshDb(); db.files.set("w/r/src.jpg", photo);
    g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3, maxAttempts: 1, fallbackEnabled: false, fallbackModelId: NB2_ID });
    script = [503];
    const one = await retouch(db, "w/r/src.jpg");
    check("fallback OFF + 1 attempt: a 503 is NOT retried and NO other model is called", !one.res.ok && sent.length === 1 && sent.every((s) => s.url.includes("/gemini-3-pro-image:")), sent.map((s) => s.url.replace(/\?.*/, "")));
    check("…the failure records fallback_used false, max_attempts 1", one.pr?.fallback_used === false && one.pr?.max_attempts === 1, one.pr);
    script = [503, 200];
    g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3, maxAttempts: 2 });
    const two = await retouch(db, "w/r/src.jpg");
    check("2 attempts: a 503 is retried once, on the SAME model, same body", two.res.ok && sent.length === 2 && sent[0]!.url === sent[1]!.url && JSON.stringify(sent[0]!.body) === JSON.stringify(sent[1]!.body));
    script = [400];
    g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3, maxAttempts: 3 });
    const bad = await retouch(db, "w/r/src.jpg");
    check("a 400 (bad request) is never retried", !bad.res.ok && sent.length === 1);
    script = [];
    g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3, maxAttempts: 3 });
    const ok = await retouch(db, "w/r/src.jpg");
    check("a successful result is never re-rolled (one request)", ok.res.ok && sent.length === 1);
    check("the panel's timeout reaches the request (120 s recorded, adapter cap 180 s)", ok.pr?.call_timeout_ms === 120_000 && Number(ok.pr?.adapter_ceiling_ms) >= 180_000, ok.pr);
    g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3, timeoutMs: 5_000 });
    const short = await retouch(db, "w/r/src.jpg");
    check("a 5 s panel limit is raised to the 30 s floor (an image call cannot answer sooner)", short.res.ok && short.pr?.call_timeout_ms === 30_000, short.pr?.call_timeout_ms);
    script = [503, 503, 200];
    g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3, maxAttempts: 1, fallbackEnabled: true, fallbackModelId: NB2_ID });
    const fb = await retouch(db, "w/r/src.jpg");
    check("fallback ON: primary gets its 1 attempt, then the fallback (with its own retries) serves",
      fb.res.ok && sent.length === 3 && /gemini-3-pro-image:/.test(sent[0]!.url) && /gemini-3\.1-flash-image:/.test(sent[2]!.url)
      && fb.pr?.fallback_used === true && fb.pr?.model_identifier === "gemini-3.1-flash-image", sent.map((s) => s.url.replace(/\?.*/, "")));
    script = [];
    check("the Google adapter uses the tool's timeout, not a fixed 90 s", /timeoutFor\(req\.callTimeoutMs \?\? GOOGLE_CALL_CAP_MS/.test(read("lib/ai/providers/google.ts")) && !/90_000/.test(read("lib/ai/providers/google.ts")));
  }

  console.log("\nT15 TRUTH LOGGING — the job says who answered and with what");
  {
    const db = freshDb(); db.files.set("w/r/src.jpg", photo);
    g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3 });
    const { job, pr } = await retouch(db, "w/r/src.jpg");
    const want = ["provider", "model_identifier", "model_id", "fallback_used", "operation", "prompt_policy", "fidelity_appended",
      "prompt_chars", "prompt_digest", "aspect_ratio_requested", "aspect_ratio_sent", "resolution", "image_size_sent", "inputs",
      "call_timeout_ms", "max_attempts", "budget_ms"];
    check("provider_request carries every field", want.every((k) => pr && k in pr), want.filter((k) => !(pr && k in pr)));
    check("job row: model and provider of who served", job?.model_id === PRO_ID && job?.provider_slug === "google");
    check("the record holds no prompt text and no image bytes", !JSON.stringify(pr).includes("GROVBASE_EXACT") && JSON.stringify(pr).length < 2000);
    check("the job is filed under the Retusz operation", ((job?.settings ?? {}) as Row).operation === RETOUCH_OPERATION);
  }

  console.log("\nTEST F — nothing published: PROMPT_NOT_CONFIGURED, 0 provider calls, 0 credits (no built-in prompt exists)");
  {
    const db = freshDb(); db.files.set("w/r/src.jpg", photo);
    const ledger = (globalThis as unknown as { __fidelityLedger?: string[] });
    ledger.__fidelityLedger = [];
    g.__fidelityEngine = engine({ systemPrompt: null, promptVersion: null });
    const none = await retouch(db, "w/r/src.jpg");
    check("nothing published → prompt_unconfigured, no request, no charge",
      !none.res.ok && (none.res as { error?: string }).error === "prompt_unconfigured" && sent.length === 0 && (ledger.__fidelityLedger ?? []).length === 0, none.res);
    g.__fidelityEngine = null;
    const blind = await retouch(db, "w/r/src.jpg");
    check("configuration unreadable → refused, no request, no charge", !blind.res.ok && sent.length === 0 && (ledger.__fidelityLedger ?? []).length === 0, blind.res);
    g.__fidelityEngine = engine({ systemPrompt: null, promptVersion: 7 });
    const locked = await retouch(db, "w/r/src.jpg");
    check("published version unreadable → prompt_unavailable, no request", !locked.res.ok && sent.length === 0 && (locked.res as { error?: string }).error === "prompt_unavailable");
    check("the code holds no built-in Retusz text", !/\[ZADANIE\]|RETOUCH_PROMPT|builtInPrompt/.test(read("lib/server/retouch.ts") + read("lib/server/engine/tool-run.ts")));
    const stepNone = await retouchStepConfig(fakeSupabase(db) as unknown as FakeClient);
    g.__fidelityEngine = engine({ systemPrompt: null, promptVersion: null });
    const stepEmpty = await retouchStepConfig(fakeSupabase(db) as unknown as FakeClient);
    g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3 });
    const stepOk = await retouchStepConfig(fakeSupabase(db) as unknown as FakeClient);
    check("Workflow 'retouch' step: same rule (no published prompt → refused; published → that exact text)",
      !stepNone.ok && !stepEmpty.ok && stepEmpty.error === "prompt_unconfigured" && stepOk.ok && stepOk.prompt === EXACT);
    g.__fidelityEngine = engine({ systemPrompt: "Make the entire machine red.", promptVersion: 9 });
    await retouch(db, "w/r/src.jpg");
    check("Retusz does not know it is 'Retusz': 'Make the entire machine red.' goes out alone", textOf(sent[0]!)[0]?.text === "Make the entire machine red.");
  }

  console.log("\nONE Gemini implementation — Workflow's image step goes through the same builder");
  {
    const db = freshDb();
    sent = [];
    const r = await callImageModel(fakeSupabase(db) as unknown as FakeClient, {
      candidateModelIds: [PRO_ID], prompt: EXACT, references: [{ base64: photo.toString("base64"), mime: "image/jpeg" }],
      aspectRatio: "auto", resolution: "2K", maxAttempts: 1, deadlineAt: Date.now() + 200_000, unitPrices: [],
    });
    check("workflow step: same URL, text === step prompt, no ratio, 2K", r.ok && /gemini-3-pro-image:generateContent/.test(sent[0]?.url ?? "")
      && textOf(sent[0]!)[0]?.text === EXACT && sent[0]!.body.generationConfig.imageConfig.aspectRatio === undefined && sent[0]!.body.generationConfig.imageConfig.imageSize === "2K");
    const one = buildGeminiImageRequest({ supported_resolutions: ["1K", "2K", "4K"] }, { prompt: EXACT, aspectRatio: "auto", resolution: "2K", referenceImages: [{ base64: "QQ==", mime: "image/png" }] });
    check("the builder is the adapter's body (same JSON)", JSON.stringify(one.body) === JSON.stringify({
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/png", data: "QQ==" } }, { text: EXACT }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { imageSize: "2K" } },
    }));
    const adapters = ["lib/ai/providers/google.ts", "lib/ai/providers/openai.ts", "lib/ai/providers/fal.ts"].map(read).join("\n");
    check("no adapter appends fidelityInstructions to the prompt", !/fidelityInstructions\}/.test(adapters) && !/prompt\}\\n\\n\$\{req\.productLock/.test(adapters));
    check("no other file builds a Gemini generateContent body", !/responseModalities/.test(read("lib/server/engine/image-call.ts") + read("lib/server/retouch.ts") + read("lib/server/fashion.ts") + read("lib/server/generation.ts")));
  }

  console.log("\nTEST A — user prompt (Własny prompt) is a strict passthrough");
  {
    const db = freshDb(); db.files.set("w/g/p.jpg", photo);
    sent = [];
    const gen = await runGeneration(fakeSupabase(db) as unknown as FakeClient, "u", "w", {
      modelId: PRO_ID, prompt: "TEST_USER_92761", productDescription: "Kubek 300 ml",
      aspectRatio: "1:1", resolution: "1K", quantity: 1, referencePaths: ["w/g/p.jpg"], referenceImageIds: [],
    });
    check("provider text === 'TEST_USER_92761' (no lock, no product text, no GrovShot context)", gen.ok && textOf(sent[0]!)[0]?.text === "TEST_USER_92761", textOf(sent[0]!)[0]?.text);
    sent = [];
    await runGeneration(fakeSupabase(db) as unknown as FakeClient, "u", "w", {
      modelId: PRO_ID, prompt: "Place this product on a marble table.", inspirationPaths: ["w/g/p.jpg"], markedImagePath: "w/g/p.jpg",
      aspectRatio: "1:1", resolution: "1K", quantity: 1, referencePaths: ["w/g/p.jpg"], referenceImageIds: [],
    });
    check("extra images attached → still the prompt alone (no attachment notes)", textOf(sent[0]!)[0]?.text === "Place this product on a marble table.");
    check("no module appends the lock to a final prompt", !/buildFidelityInstructions/.test(read("lib/server/generation.ts") + read("lib/server/engine/tool-run.ts") + read("lib/server/engine/image-call.ts")));
  }

  console.log("\nTESTS B–E — GrovBase template: only explicit variables");
  {
    const db = freshDb(); db.files.set("w/r/src.jpg", photo);
    g.__fidelityEngine = engine({ systemPrompt: "TEST_GB_92761", promptVersion: 1 });
    await retouch(db, "w/r/src.jpg");
    check("B: no variables → 'TEST_GB_92761' exactly", textOf(sent[0]!)[0]?.text === "TEST_GB_92761");
    const c = compileTemplate("ABC\n{{scene}}\nXYZ", TOOL_VARIABLES.prompts ?? [], { scene: "WOODEN TABLE" });
    check("C: explicit variable → 'ABC\\nWOODEN TABLE\\nXYZ' (value only, no wrapper)", c.ok && c.text === "ABC\nWOODEN TABLE\nXYZ", c);
    g.__fidelityEngine = engine({ systemPrompt: "ABC", promptVersion: 1 });
    await retouch(db, "w/r/src.jpg");
    check("D: no {{fidelity_rules}} → 'ABC', no fidelity anywhere", textOf(sent[0]!)[0]?.text === "ABC");
    g.__fidelityEngine = engine({ systemPrompt: "ABC\n{{fidelity_rules}}", promptVersion: 1 });
    await retouch(db, "w/r/src.jpg");
    check("E: {{fidelity_rules}} placed → 'ABC\\n' + the resolved rules", textOf(sent[0]!)[0]?.text === `ABC\n${buildFidelityInstructions()}`);
    g.__fidelityEngine = engine({ toolKey: "generator", mode: "hybrid", systemPrompt: "Studio instruction.", promptVersion: 2 });
    const noSlot = await prepareGeneratorEngine(fakeSupabase(db) as unknown as FakeClient, "u", "w", {
      userPrompt: "x", negative: null, productDescription: null, aspectRatio: "1:1", resolution: "1K", referencePaths: [],
    });
    check("generator template without {{user_prompt}} → refused (GrovBase never decides where the customer's words go)", !noSlot.ok && noSlot.error === "prompt_unconfigured");
    g.__fidelityEngine = engine({ toolKey: "generator", mode: "hybrid", systemPrompt: "Studio: {{user_prompt}}", promptVersion: 3 });
    const slot = await prepareGeneratorEngine(fakeSupabase(db) as unknown as FakeClient, "u", "w", {
      userPrompt: "na marmurze", negative: "napisy", productDescription: null, aspectRatio: "1:1", resolution: "1K", referencePaths: [],
    });
    check("generator template with {{user_prompt}} → exactly the compiled template (negative not added without {{negative_prompt}})", slot.ok && slot.enginePrompt === "Studio: na marmurze", slot);
    g.__fidelityEngine = null;
  }

  console.log("\nTEST G — 2K vs 4K: the requests differ ONLY in imageSize");
  {
    const bodies: Record<string, unknown>[] = [];
    const recs: Row[] = [];
    for (const size of ["2K", "4K"]) {
      const db = freshDb(); db.files.set("w/r/src.jpg", photo);
      g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3 });
      const { pr } = await retouch(db, "w/r/src.jpg", { resolution: size });
      bodies.push(JSON.parse(JSON.stringify(sent[0]!.body)));
      recs.push(pr as Row);
    }
    const strip = (b: Record<string, unknown>) => { const c = JSON.parse(JSON.stringify(b)); delete c.generationConfig.imageConfig.imageSize; return JSON.stringify(c); };
    check("bodies identical except imageConfig.imageSize (2K vs 4K)", strip(bodies[0]!) === strip(bodies[1]!)
      && (bodies[0] as { generationConfig: { imageConfig: { imageSize: string } } }).generationConfig.imageConfig.imageSize === "2K"
      && (bodies[1] as { generationConfig: { imageConfig: { imageSize: string } } }).generationConfig.imageConfig.imageSize === "4K");
    const same = ["provider", "model_identifier", "operation", "prompt_digest", "aspect_ratio_sent", "fallback_used"].every((k) => JSON.stringify(recs[0]![k]) === JSON.stringify(recs[1]![k]));
    check("records: same provider, model, operation, prompt digest, ratio, fallback=false; same input hash", same && recs[0]!.fallback_used === false
      && JSON.stringify((recs[0]!.inputs as Row[])[0]!.sent_sha256) === JSON.stringify((recs[1]!.inputs as Row[])[0]!.sent_sha256));
  }

  console.log("\nOUTPUT MANIFEST — the stored file IS the provider's output");
  {
    const db = freshDb(); db.files.set("w/r/src.jpg", photo);
    g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3 });
    const { job } = await retouch(db, "w/r/src.jpg", { resolution: "4K" });
    const out = (((job?.settings ?? {}) as Row).provider_output as Row[] | undefined)?.[0];
    const provided = Buffer.from(outPng, "base64");
    check("provider_output: requested 4K, provider WxH = stored WxH, bytes equal, not transformed",
      out?.requested_image_size === "4K" && out?.provider_returned_width === out?.stored_width && out?.provider_returned_height === out?.stored_height
      && out?.provider_bytes === provided.length && out?.stored_bytes === provided.length && out?.provider_sha256 === sha(provided) && out?.transformed_after_provider === false, out);
  }

  console.log("\nTHOUGHT IMAGES — the FINAL render is kept, never an interim draft (Gemini 3 Pro Image thinks before it draws)");
  {
    const draft = async (color: string) => (await sharp({ create: { width: 32, height: 32, channels: 3, background: color } }).png().toBuffer()).toString("base64");
    const [d1, d2, fin] = [await draft("#f00"), await draft("#0f0"), await draft("#00f")];
    const db = freshDb(); db.files.set("w/r/src.jpg", photo);
    g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3 });
    // The shape Google documents: thought text, up to two thought images, then the final image.
    responseParts = [
      { text: "Planning the composition…", thought: true },
      { inlineData: { mimeType: "image/png", data: d1 }, thought: true },
      { inlineData: { mimeType: "image/png", data: d2 }, thought: true },
      { inlineData: { mimeType: "image/png", data: fin }, thoughtSignature: "sig" },
    ];
    const { res, job } = await retouch(db, "w/r/src.jpg");
    const out = (((job?.settings ?? {}) as Row).provider_output as Row[] | undefined)?.[0];
    check("the stored image is the FINAL one (not the first draft)", res.ok && out?.provider_sha256 === sha(Buffer.from(fin, "base64")) && out?.provider_sha256 !== sha(Buffer.from(d1, "base64")), out);
    check("recorded: 3 image parts, 2 drafts skipped, finishReason STOP", out?.provider_image_parts === 3 && out?.provider_thought_images_skipped === 2 && out?.provider_finish_reason === "STOP", out);
    responseParts = [{ inlineData: { mimeType: "image/png", data: d1 }, thought: true }];
    const onlyDraft = await retouch(db, "w/r/src.jpg");
    check("a response with ONLY drafts is empty → refused and refunded, a draft is never delivered",
      !onlyDraft.res.ok && (onlyDraft.res as { error?: string }).error === "provider_empty_result" && sent.length === 1, onlyDraft.res);
    responseParts = [{ inlineData: { mimeType: "image/png", data: d1 } }, { inlineData: { mimeType: "image/png", data: fin } }];
    const two = await retouch(db, "w/r/src.jpg");
    const out2 = (((two.job?.settings ?? {}) as Row).provider_output as Row[] | undefined)?.[0];
    check("two unflagged images → the LAST one (Google's final image comes last)", out2?.provider_sha256 === sha(Buffer.from(fin, "base64")), out2);
    responseParts = null;
    check("the adapter no longer takes the first inlineData part", !/parts\?\.find\(\(p\) => p\.inlineData\)/.test(read("lib/ai/providers/google.ts")) && /pickGeminiFinalImage\(json\)/.test(read("lib/ai/providers/google.ts")));
  }

  console.log("\nORIGINAL RATIO — resolveOriginalAspectRatio: the photo's nearest OFFICIAL Gemini ratio");
  {
    const R = GEMINI_IMAGE_ASPECT_RATIOS;
    const table: [number, number, AspectRatio][] = [
      [933, 700, "4:3"], [1200, 1200, "1:1"], [1500, 1000, "3:2"], [1000, 1500, "2:3"], [1000, 1250, "4:5"],
      [1250, 1000, "5:4"], [1920, 1080, "16:9"], [1080, 1920, "9:16"],
      // non-standard shapes, incl. the PROD sources
      [853, 700, "5:4"], [1280, 1024, "5:4"], [1280, 871, "3:2"], [576, 1280, "9:16"], [315, 699, "9:16"], [1080, 1350, "4:5"],
      [2560, 1080, "21:9"], [3000, 1000, "21:9"], [1000, 3000, "9:16"], [4000, 3000, "4:3"], [3024, 4032, "3:4"], [1000, 1001, "1:1"], [1, 1, "1:1"],
    ];
    const bad = table.filter(([w, h, want]) => resolveOriginalAspectRatio(w, h, R) !== want).map(([w, h, want]) => `${w}×${h}: got ${resolveOriginalAspectRatio(w, h, R)}, want ${want}`);
    check(`table (${table.length} shapes incl. 933×700 → 4:3) maps to the nearest official ratio`, bad.length === 0, bad);
    check("the official list is exactly Gemini's 10 image ratios", [...R].sort().join() === ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"].sort().join(), R);
    const exact = R.filter((r) => { const s = RATIO_SHAPE[r as Exclude<AspectRatio, "auto">]; return [1, 7, 113].some((k) => resolveOriginalAspectRatio(s.w * k, s.h * k, R) !== r); });
    check("every official ratio, at any scale, resolves to itself (not a special-cased if/else)", exact.length === 0, exact);
    // Monotonic: as the photo gets wider, the resolved ratio never gets narrower.
    const val = (r: AspectRatio | null) => { const s = RATIO_SHAPE[r as Exclude<AspectRatio, "auto">]; return s.w / s.h; };
    let prev = 0; let mono = true;
    for (let w = 100; w <= 5000; w += 7) { const v = val(resolveOriginalAspectRatio(w, 1000, R)); if (v < prev) mono = false; prev = v; }
    check("monotonic across 700 widths (100…5000 × 1000)", mono);
    const reversed = [...R].reverse();
    let orderFree = true;
    for (let i = 0; i < 500; i++) { const w = 200 + ((i * 7919) % 4800), h = 200 + ((i * 104729) % 4800); if (resolveOriginalAspectRatio(w, h, R) !== resolveOriginalAspectRatio(w, h, reversed)) orderFree = false; }
    check("deterministic: 500 shapes give the same answer whatever the list order (no hidden tie reliance)", orderFree);
    check("unknown / invalid size → null (nothing derived, nothing sent)", [[0, 700], [933, 0], [NaN, 5], [-3, 4]].every(([w, h]) => resolveOriginalAspectRatio(w, h, R) === null));
    check("an engine without an official list derives nothing", resolveOriginalAspectRatio(933, 700, []) === null);

    // The PROD case end-to-end: 933×700 PNG, Oryginalny, 2K and 4K.
    const prodShape = await sharp({ create: { width: 933, height: 700, channels: 3, background: "#a86" } }).png().toBuffer();
    const bodies: Sent["body"][] = []; const recs: Row[] = [];
    for (const size of ["2K", "4K"]) {
      const db = freshDb(); db.files.set("w/r/prod.png", prodShape);
      g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3 });
      const { pr } = await retouch(db, "w/r/prod.png", { resolution: size, format: "original" });
      bodies.push(JSON.parse(JSON.stringify(sent[0]!.body))); recs.push(pr as Row);
    }
    check("933×700 + Oryginalny → aspectRatio '4:3' at 2K AND at 4K", bodies.every((b) => b.generationConfig.imageConfig.aspectRatio === "4:3"), bodies.map((b) => b.generationConfig));
    const noSize = (b: Sent["body"]) => { const c = JSON.parse(JSON.stringify(b)); delete c.generationConfig.imageConfig.imageSize; return JSON.stringify(c); };
    check("…and the 2K/4K bodies differ ONLY in imageSize", noSize(bodies[0]!) === noSize(bodies[1]!) && bodies[0]!.generationConfig.imageConfig.imageSize === "2K" && bodies[1]!.generationConfig.imageConfig.imageSize === "4K");
    check("recorded: ORIGINAL_DERIVED, 933×700, 1.332857 → 4:3 (both sizes)", recs.every((r) => r.aspect_ratio_mode === "ORIGINAL_DERIVED" && r.source_width === 933 && r.source_height === 700 && r.source_aspect_ratio === 1.332857 && r.resolved_aspect_ratio === "4:3"), recs);
    check("the photo itself is not touched (bytes sent === bytes uploaded)", sha(Buffer.from(imagesOf({ url: "", body: bodies[0]! })[0]!.inlineData.data, "base64")) === sha(prodShape));

    // EXIF: a phone photo stored sideways is judged as the customer sees it.
    const sideways = await sharp(photo).withMetadata({ orientation: 6 }).jpeg({ quality: 95 }).toBuffer();
    const dbS = freshDb(); dbS.files.set("w/r/side.jpg", sideways);
    g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3 });
    const side = await retouch(dbS, "w/r/side.jpg", { format: "original" });
    check("EXIF-rotated 1500×1000 (shown 1000×1500) → 2:3", sent[0]?.body.generationConfig.imageConfig.aspectRatio === "2:3" && side.pr?.source_width === 1000, side.pr);

    // Scope: only a caller that asks for it derives. The generator's "auto" is unchanged.
    const dbG = freshDb(); dbG.files.set("w/g/p.jpg", photo); sent = [];
    const gen = await runGeneration(fakeSupabase(dbG) as unknown as FakeClient, "u", "w", {
      modelId: PRO_ID, prompt: "x", aspectRatio: "auto", resolution: "2K", quantity: 1, referencePaths: ["w/g/p.jpg"], referenceImageIds: [],
    });
    const genPr = ((([...dbG.jobs.values()].pop()?.settings ?? {}) as Row).provider_request ?? {}) as Row;
    check("generator 'auto' (no originalAspect): still no ratio sent, mode UNSET", gen.ok && sent[0]?.body.generationConfig.imageConfig.aspectRatio === undefined && genPr.aspect_ratio_mode === "UNSET", genPr);
  }

  console.log("\nTHINKING — pickGeminiFinalImage edge cases (pure, no API call)");
  {
    const img = (id: string, thought?: boolean) => ({ inlineData: { mimeType: "image/png", data: id }, ...(thought ? { thought: true } : {}) });
    const txt = (t: string, thought?: boolean) => ({ text: t, ...(thought ? { thought: true } : {}) });
    const pick = (parts: Record<string, unknown>[]) => pickGeminiFinalImage({ candidates: [{ finishReason: "STOP", content: { parts } }] });
    const cases: [string, Record<string, unknown>[], string | null][] = [
      ["[thought image, final image] → final", [img("T1", true), img("F")], "F"],
      ["[thought image, thought image, final image] → final", [img("T1", true), img("T2", true), img("F")], "F"],
      ["[text thought, image thought, final image] → final", [txt("plan", true), img("T1", true), img("F")], "F"],
      ["[thought image only] → none (fail + refund)", [img("T1", true)], null],
      ["[final image only] → final", [img("F")], "F"],
      ["[text, final image] → final", [txt("Here it is"), img("F")], "F"],
      ["[final image, trailing thought image] → the non-thought one", [img("F"), img("T9", true)], "F"],
      ["[two non-thought images] → the LAST (the render that follows any earlier output)", [img("A"), img("F")], "F"],
      ["[thought text only] → none", [txt("thinking", true)], null],
      ["[image part with empty data] → none", [{ inlineData: { mimeType: "image/png", data: "" } }], null],
    ];
    for (const [name, parts, want] of cases) {
      const r = pick(parts);
      check(name, (r.image?.data ?? null) === want, r);
    }
    const counted = pick([txt("plan", true), img("T1", true), img("T2", true), img("F")]);
    check("counts: 3 image parts, 2 drafts skipped, finishReason STOP", counted.imageParts === 3 && counted.thoughtImages === 2 && counted.finishReason === "STOP", counted);
    check("no candidates → none", pickGeminiFinalImage({}).image === null && pickGeminiFinalImage({ candidates: [] }).image === null);
  }

  console.log("\nMEDIA RESOLUTION — nothing lowers the input; the field is left UNSPECIFIED (the model default)");
  {
    const db = freshDb(); db.files.set("w/r/src.jpg", photo);
    g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3 });
    await retouch(db, "w/r/src.jpg");
    const b = sent[0]!.body;
    check("no mediaResolution in generationConfig", !("mediaResolution" in b.generationConfig));
    check("the image part carries only { inlineData: { mimeType, data } } (no per-part mediaResolution)",
      JSON.stringify(Object.keys(b.contents[0]!.parts[0]!)) === '["inlineData"]' && JSON.stringify(Object.keys((b.contents[0]!.parts[0] as { inlineData: Row }).inlineData).sort()) === '["data","mimeType"]');
    const src = ["lib", "app", "components"].map((d) => {
      // Assignments or enum values in code — not the admin panel's label key "mediaResolution".
      try { return require("node:child_process").execSync(`grep -rnE "MEDIA_RESOLUTION_|mediaResolution\\s*:|media_resolution" --include=*.ts --include=*.tsx ${d} || true`, { cwd: process.cwd() }).toString(); } catch { return ""; }
    }).join("");
    check("no code sets mediaResolution (LOW/MEDIUM or any value) anywhere in lib/app/components", src.trim() === "", src);
  }
  console.log("\n§9 PROVIDER PARITY HARNESS — full GrovBase Retusz path vs a minimal hand-written Google request (no paid call)");
  {
    const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon)
      : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as Row).sort().map((k) => [k, canon((v as Row)[k])])) : v;
    const eq = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
    // The PROD photo shape (933×700, PNG) and the 3:2 test photo. For
    // "Oryginalny" the reference is given the ratio a person would pick for
    // that photo by hand (933×700 is 4:3; 1500×1000 is 3:2), written literally.
    const prodShape = await sharp({ create: { width: 933, height: 700, channels: 3, background: "#a86" } }).png().toBuffer();
    const cases: { name: string; src: Buffer; mime: string; resolution: string; format: string; imageConfig: Row }[] = [
      { name: "933×700 2K, Oryginalny", src: prodShape, mime: "image/png", resolution: "2K", format: "original", imageConfig: { aspectRatio: "4:3", imageSize: "2K" } },
      { name: "933×700 4K, Oryginalny", src: prodShape, mime: "image/png", resolution: "4K", format: "original", imageConfig: { aspectRatio: "4:3", imageSize: "4K" } },
      { name: "1500×1000 2K, Oryginalny", src: photo, mime: "image/jpeg", resolution: "2K", format: "original", imageConfig: { aspectRatio: "3:2", imageSize: "2K" } },
      { name: "1500×1000 4K, Oryginalny", src: photo, mime: "image/jpeg", resolution: "4K", format: "original", imageConfig: { aspectRatio: "3:2", imageSize: "4K" } },
      { name: "1500×1000 1K, 4:5", src: photo, mime: "image/jpeg", resolution: "1K", format: "4:5", imageConfig: { aspectRatio: "4:5", imageSize: "1K" } },
    ];
    for (const cs of cases) {
      const db = freshDb(); db.files.set("w/r/src.jpg", cs.src);
      g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3 });
      await retouch(db, "w/r/src.jpg", { resolution: cs.resolution, format: cs.format });
      const A = sent[0]!;
      // B — what a person would send by hand, straight from Google's REST
      // image-edit example: the same photo bytes, the same prompt, the same
      // model, the same size/ratio. Written out literally, NOT via the builder.
      const B = {
        url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent",
        body: {
          contents: [{ role: "user", parts: [{ inlineData: { mimeType: cs.mime, data: cs.src.toString("base64") } }, { text: EXACT }] }],
          generationConfig: { responseModalities: ["IMAGE"], imageConfig: cs.imageConfig },
        },
      };
      const noKey = (u: string) => u.replace(/\?.*$/, "");      // secrets normalised away
      const aImg = imagesOf(A)[0]?.inlineData;
      const flags = {
        PROMPT_EQUAL: textOf(A).length === 1 && textOf(A)[0]!.text === EXACT,
        INPUT_SHA_EQUAL: !!aImg && sha(Buffer.from(aImg.data, "base64")) === sha(cs.src) && aImg.mimeType === cs.mime,
        MODEL_EQUAL: noKey(A.url) === B.url,
        ASPECT_RATIO_EQUAL: A.body.generationConfig.imageConfig.aspectRatio === B.body.generationConfig.imageConfig.aspectRatio,
        IMAGE_SIZE_EQUAL: A.body.generationConfig.imageConfig.imageSize === B.body.generationConfig.imageConfig.imageSize,
        GENERATION_CONFIG_EQUAL: eq(A.body.generationConfig, B.body.generationConfig),
        PARTS_EQUAL: eq(A.body.contents, B.body.contents),
        BODY_EQUAL: eq(A.body, B.body) && Object.keys(A.body).sort().join() === "contents,generationConfig",
      };
      console.log(`    ${cs.name}: ${Object.entries(flags).map(([k, v]) => `${k}=${v}`).join("  ")}`);
      check(`parity ${cs.name}: every invariant true`, Object.values(flags).every(Boolean), flags);
    }
  }

  console.log("\n§15 CHECKLIST A–L");
  {
    const one = async (systemPrompt: string | null, opts: { resolution?: string; format?: string } = {}) => {
      const db = freshDb(); db.files.set("w/r/src.jpg", photo);
      g.__fidelityEngine = engine({ systemPrompt, promptVersion: systemPrompt === null ? null : 3 });
      const r = await retouch(db, "w/r/src.jpg", opts);
      return { ...r, text: sent[0] ? textOf(sent[0])[0]?.text : undefined, body: sent[0]?.body, calls: sent.length };
    };
    const a = await one(EXACT);
    check("A. publishedPrompt === finalPrompt (no variables)", a.text === EXACT);
    const padded = "\n  Retusz.\n\n";
    const ap = await one(padded);
    check("A. …byte for byte, leading/trailing whitespace included (nothing trims it)", ap.text === padded, JSON.stringify(ap.text));
    const b = await one("X {{fidelity_rules}} Y");
    check("B. {{fidelity_rules}}: only that placeholder changes", b.text === `X ${buildFidelityInstructions()} Y`);
    const c = await one("X Y");
    check("C. no {{fidelity_rules}}: no Product Lock text in the final prompt", c.text === "X Y" && !(c.text ?? "").includes(buildFidelityInstructions().slice(0, 40)));
    const ledger = (globalThis as unknown as { __fidelityLedger?: string[] });
    ledger.__fidelityLedger = [];
    const d = await one(null);
    check("D. no prompt: PROMPT_NOT_CONFIGURED, 0 provider calls, 0 credits", !d.res.ok && (d.res as { error?: string }).error === "prompt_unconfigured" && d.calls === 0 && (ledger.__fidelityLedger ?? []).length === 0);
    {
      const db = freshDb(); db.files.set("w/g/p.jpg", photo); sent = [];
      const USER = "  Mój prompt:\n\n— ZOSTAW kubek dokładnie tak 1:1 —  ";
      await runGeneration(fakeSupabase(db) as unknown as FakeClient, "u", "w", {
        modelId: PRO_ID, prompt: USER, aspectRatio: "1:1", resolution: "1K", quantity: 1, referencePaths: ["w/g/p.jpg"], referenceImageIds: [],
      });
      check("E. user prompt: exact string equality (whitespace, dashes, Polish letters kept)", textOf(sent[0]!)[0]?.text === USER, textOf(sent[0]!)[0]?.text);
    }
    check("F. input: sha(upload) === sha(provider input)", sha(Buffer.from(imagesOf({ url: "", body: a.body! })[0]!.inlineData.data, "base64")) === PHOTO_SHA);
    check("G. Google payload parity — see §9 above (all invariants true)", true);
    const h2 = await one(EXACT, { resolution: "2K" }); const h4 = await one(EXACT, { resolution: "4K" });
    const drop = (x: unknown) => { const cc = JSON.parse(JSON.stringify(x)); delete cc.generationConfig.imageConfig.imageSize; return JSON.stringify(cc); };
    check("H. 2K/4K: the only difference is imageSize", drop(h2.body) === drop(h4.body) && h2.body!.generationConfig.imageConfig.imageSize === "2K" && h4.body!.generationConfig.imageConfig.imageSize === "4K");
    check("I. Oryginalny: aspectRatio = the photo's own shape (1500×1000 → 3:2), identical at 2K and 4K",
      a.body!.generationConfig.imageConfig.aspectRatio === "3:2" && h2.body!.generationConfig.imageConfig.aspectRatio === "3:2" && h4.body!.generationConfig.imageConfig.aspectRatio === "3:2");
    const out = (((a.job?.settings ?? {}) as Row).provider_output as Row[] | undefined)?.[0];
    const url = (a.res as { url?: string }).url ?? "";
    check("J. output: provider SHA === SHA read back from storage (the file Pobierz serves), same path",
      out?.stored_sha256 === out?.provider_sha256 && out?.stored_equals_provider === true && out?.stored_sha256 === sha(Buffer.from(outPng, "base64"))
      && url.endsWith(String(out?.stored_path)) && !/thumb|preview|render\/image/.test(url), { out, url });
    {
      const db = freshDb(); db.files.set("w/r/src.jpg", photo);
      g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3, maxAttempts: 3, fallbackEnabled: false, fallbackModelId: NB2_ID });
      script = [503, 503, 503];
      await retouch(db, "w/r/src.jpg");
      script = [];
      check("K. fallback OFF: every attempt on gemini-3-pro-image, never another model", sent.length === 3 && sent.every((x) => /\/gemini-3-pro-image:generateContent/.test(x.url)));
    }
    const code = ["lib/server/retouch.ts", "lib/server/engine/tool-run.ts", "lib/server/generation.ts", "lib/server/engine/image-call.ts",
      "lib/ai/providers/google.ts", "lib/ai/providers/google-request.ts", "lib/ai/providers/openai.ts", "lib/ai/providers/fal.ts",
      "lib/server/concept-generation.ts", "lib/server/engine/workflow.ts", "app/api/generate/route.ts", "app/api/generations/regenerate/route.ts"].map(read).join("\n");
    const legacy = [/RETOUCH_PROMPT\s*=/, /builtInPrompt/, /composeProviderText/, /appendCustomerBlock/, /wrapData/, /fidelityInstructions\}/,
      /prompt\.trim\(\)\s*[,\]]/, /enginePrompt\.trim\(\)\s*:/];
    // Request fields live only in the builder + adapters (a "seed" elsewhere is the knowledge sampler's, never sent).
    const wire = ["lib/ai/providers/google.ts", "lib/ai/providers/google-request.ts", "lib/ai/providers/openai.ts", "lib/ai/providers/fal.ts"].map(read).join("\n");
    const sampling = [/systemInstruction\s*:/, /temperature\s*:/, /topP\s*:/, /topK\s*:/, /\bseed\s*:/, /thinkingConfig\s*:/, /mediaResolution\s*:/];
    const hits = [...legacy.filter((re) => re.test(code)), ...sampling.filter((re) => re.test(wire))].map(String);
    check("L. regression search: no RETOUCH_PROMPT, no legacy append helper, no sampling/system fields in the image path", hits.length === 0, hits);
    g.__fidelityEngine = null;
  }

  console.log("\nADMIN MANIFEST (Testuj konfigurację) — computed, no paid call");
  {
    const db = freshDb();
    db.jobs.clear();
    g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3 });
    sent = [];
    const m = await buildRequestManifest(fakeSupabase(db) as unknown as FakeClient, "retouch", { modelId: PRO_ID, fallbackId: null });
    check("no provider call was made", sent.length === 0);
    check("model google / Nano Banana Pro / gemini-3-pro-image, fallback off", m.model?.provider === "google" && m.model.name === "Nano Banana Pro" && m.model.identifier === "gemini-3-pro-image" && m.fallback === null, m.model);
    check("prompt: published v3, exact, identical, sha matches, nothing appended, no knowledge",
      m.prompt.source === "published" && m.prompt.version === 3 && m.prompt.policy === "exact" && m.prompt.identical === true
      && m.prompt.sha256 === sha(EXACT) && m.prompt.appended.length === 0 && m.prompt.knowledge.length === 0, m.prompt);
    check("config: IMAGE_EDIT, original → derived from the photo, sizes 1K/2K/4K sent as chosen, 120 s, 1 attempt",
      m.config.operation === "IMAGE_EDIT" && m.config.ratioWhenOriginal === "original_derived"
      && m.config.sizes.map((s) => `${s.resolution}=${s.sent}`).join() === "1K=1K,2K=2K,4K=4K"
      && m.config.timeoutMs === 120_000 && m.config.maxAttempts === 1, m.config);
    check("the manifest carries no prompt text", !JSON.stringify(m).includes("GROVBASE_EXACT"));
    check("workflow OFF is reported as such", m.workflowEnabled === false);
    // …and after a real run it shows what that run recorded.
    db.files.set("w/r/src.jpg", photo);
    await retouch(db, "w/r/src.jpg");
    const m2 = await buildRequestManifest(fakeSupabase(db) as unknown as FakeClient, "retouch", { modelId: PRO_ID, fallbackId: null });
    check("last run: google / gemini-3-pro-image, text = current published, photo hash kept",
      m2.lastRun?.identifier === "gemini-3-pro-image" && m2.lastRun.matchesPublished === true && m2.lastRun.inputs[0]?.sentSha256 === PHOTO_SHA && m2.lastRun.ratioSent === "3:2", m2.lastRun);
    check("last run: aspect mode ORIGINAL_DERIVED, 1.5 → 3:2; input 1.5 MP, not flagged low",
      m2.lastRun?.aspectMode === "ORIGINAL_DERIVED" && m2.lastRun.sourceAspect === 1.5 && m2.lastRun.resolvedAspect === "3:2"
      && m2.lastRun.inputs[0]?.megapixels === 1.5 && m2.lastRun.inputs[0]?.lowResolution === false, m2.lastRun);
  }

  g.__fidelityEngine = null;
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
  console.log("All image fidelity tests passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
