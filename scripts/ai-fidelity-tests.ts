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
import { buildGeminiImageRequest, geminiImageSize } from "@/lib/ai/providers/google-request";
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
        upload: async (path: string) => { db.uploads.push(`${bucket}/${path}`); return { error: null }; },
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
    candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: outPng } }] } }],
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

  console.log("\nT11 / T12 ASPECT RATIO — none imposed on 'Oryginalny'; a chosen one sent exactly");
  {
    const db = freshDb(); db.files.set("w/r/src.jpg", photo);
    g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3 });
    const auto = await retouch(db, "w/r/src.jpg", { format: "original" });
    check("original (3:2 photo): imageConfig carries NO aspectRatio", sent[0]?.body.generationConfig.imageConfig.aspectRatio === undefined, sent[0]?.body.generationConfig);
    check("recorded: requested auto → sent null", auto.pr?.aspect_ratio_requested === "auto" && auto.pr?.aspect_ratio_sent === null, auto.pr);
    const expl = await retouch(db, "w/r/src.jpg", { format: "4:5" });
    check("chosen 4:5 → imageConfig.aspectRatio '4:5'", sent[0]?.body.generationConfig.imageConfig.aspectRatio === "4:5");
    check("recorded: requested 4:5 → sent 4:5", expl.pr?.aspect_ratio_requested === "4:5" && expl.pr?.aspect_ratio_sent === "4:5");
    const odd = await retouch(db, "w/r/src.jpg", { format: "7:3" });
    check("a ratio the model does not list falls back to 'original' (nothing sent), not to a guess", sent[0]?.body.generationConfig.imageConfig.aspectRatio === undefined && odd.res.ok);
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

  console.log("\nBuilt-in instruction (nothing published) — also sent exactly, without the generic lock");
  {
    const db = freshDb(); db.files.set("w/r/src.jpg", photo);
    g.__fidelityEngine = engine({ systemPrompt: null, promptVersion: null });
    const { pr } = await retouch(db, "w/r/src.jpg");
    const text = sent[0] ? textOf(sent[0])[0]?.text ?? "" : "";
    check("built-in Retusz text starts with its own task and carries no appended lock", text.startsWith("[ZADANIE]") && !text.includes("camera and mood are creative") && pr?.fidelity_appended === false, text.slice(0, 60));
    g.__fidelityEngine = engine({ systemPrompt: null, promptVersion: 7 });
    const refused = await retouch(db, "w/r/src.jpg");
    check("a published version that cannot be read is refused — never silently replaced by the built-in", !refused.res.ok && sent.length === 0 && (refused.res as { error?: string }).error === "prompt_unavailable");
    g.__fidelityEngine = null;
    const blind = await retouch(db, "w/r/src.jpg");
    check("the configuration cannot be read at all → refused, not run on the built-in", !blind.res.ok && sent.length === 0 && (blind.res as { error?: string }).error === "prompt_unavailable", blind.res);
    const stepBlind = await retouchStepConfig(fakeSupabase(db) as unknown as FakeClient);
    g.__fidelityEngine = engine({ systemPrompt: null, promptVersion: 7 });
    const stepLocked = await retouchStepConfig(fakeSupabase(db) as unknown as FakeClient);
    g.__fidelityEngine = engine({ systemPrompt: EXACT, promptVersion: 3 });
    const stepOk = await retouchStepConfig(fakeSupabase(db) as unknown as FakeClient);
    check("Workflow 'retouch' step: same rule (unreadable → refused; published → that exact text)",
      !stepBlind.ok && stepBlind.error === "prompt_unavailable" && !stepLocked.ok && stepLocked.error === "prompt_unavailable"
      && stepOk.ok && stepOk.prompt === EXACT && stepOk.modelId === PRO_ID);
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

  console.log("\nGENERATOR — customer-facing scenes keep the Product Lock");
  {
    const db = freshDb(); db.files.set("w/g/p.jpg", photo);
    g.__fidelityEngine = engine({ toolKey: "generator", mode: "hybrid", systemPrompt: "Studio packshot instruction.", promptVersion: 2 });
    const plain = await prepareGeneratorEngine(fakeSupabase(db) as unknown as FakeClient, "u", "w", {
      userPrompt: "na marmurowym blacie", negative: null, productDescription: "Kubek 300 ml", aspectRatio: "1:1", resolution: "1K", referencePaths: ["w/g/p.jpg"],
    });
    check("hybrid template without {{fidelity_rules}} → product_lock policy", plain.ok && plain.promptPolicy === "product_lock");
    g.__fidelityEngine = engine({ toolKey: "generator", mode: "hybrid", systemPrompt: "Instr.\n{{fidelity_rules}}", promptVersion: 3 });
    const placed = await prepareGeneratorEngine(fakeSupabase(db) as unknown as FakeClient, "u", "w", {
      userPrompt: "x", negative: null, productDescription: null, aspectRatio: "1:1", resolution: "1K", referencePaths: [],
    });
    check("…the admin placed {{fidelity_rules}} → exact (no second copy)", placed.ok && placed.promptPolicy === "exact");
    sent = [];
    const gen = await runGeneration(fakeSupabase(db) as unknown as FakeClient, "u", "w", {
      modelId: PRO_ID, prompt: "na marmurowym blacie", enginePrompt: plain.ok ? plain.enginePrompt ?? undefined : undefined,
      promptPolicy: plain.ok ? plain.promptPolicy : undefined, productDescription: "Kubek 300 ml",
      aspectRatio: "1:1", resolution: "1K", quantity: 1, referencePaths: ["w/g/p.jpg"], referenceImageIds: [],
    });
    const text = sent[0] ? textOf(sent[0])[0]?.text ?? "" : "";
    check("generator run: engine text, then the Product Lock and the customer's product text",
      gen.ok && text.startsWith("Studio packshot instruction.") && text.includes(buildFidelityInstructions().slice(0, 40)) && text.includes("Kubek 300 ml"), text.slice(0, 80));
    sent = [];
    await runGeneration(fakeSupabase(db) as unknown as FakeClient, "u", "w", {
      modelId: PRO_ID, prompt: "zwykły prompt klienta", aspectRatio: "1:1", resolution: "1K", quantity: 1, referencePaths: ["w/g/p.jpg"], referenceImageIds: [],
    });
    check("a caller that asks for nothing gets product_lock (exact is opt-in only)", (sent[0] ? textOf(sent[0])[0]?.text ?? "" : "").includes(buildFidelityInstructions().slice(0, 40)));
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
    check("config: IMAGE_EDIT, original → not sent, sizes 1K/2K/4K sent as chosen, 120 s, 1 attempt",
      m.config.operation === "IMAGE_EDIT" && m.config.ratioWhenOriginal === "input_photo"
      && m.config.sizes.map((s) => `${s.resolution}=${s.sent}`).join() === "1K=1K,2K=2K,4K=4K"
      && m.config.timeoutMs === 120_000 && m.config.maxAttempts === 1, m.config);
    check("the manifest carries no prompt text", !JSON.stringify(m).includes("GROVBASE_EXACT"));
    check("workflow OFF is reported as such", m.workflowEnabled === false);
    // …and after a real run it shows what that run recorded.
    db.files.set("w/r/src.jpg", photo);
    await retouch(db, "w/r/src.jpg");
    const m2 = await buildRequestManifest(fakeSupabase(db) as unknown as FakeClient, "retouch", { modelId: PRO_ID, fallbackId: null });
    check("last run: google / gemini-3-pro-image, text = current published, photo hash kept",
      m2.lastRun?.identifier === "gemini-3-pro-image" && m2.lastRun.matchesPublished === true && m2.lastRun.inputs[0]?.sentSha256 === PHOTO_SHA && m2.lastRun.ratioSent === null, m2.lastRun);
  }

  g.__fidelityEngine = null;
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
  console.log("All image fidelity tests passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
