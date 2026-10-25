/**
 * MINIATURKA × RETUSZ — TEST C: the Retusz request Miniaturka makes is the
 * request /retusz makes, byte for byte.
 *
 *   /retusz:     the panel's POST → the REAL /api/retouch route → runRetouch
 *   Miniaturka:  runRetouch called with EXACTLY the arguments
 *                lib/server/thumbnail/run.ts passes (read from that file)
 *
 * Both reach the real production code from runRetouch to fetch; only the
 * database, storage, session and the socket are faked (the same seams as
 * scripts/retouch-forensic-tests.ts). The string each hands to fetch is
 * captured and compared: same endpoint, same headers, same body bytes —
 * same prompt SHA-256, same image SHA-256, no extra field. And both equal
 * the independent hand-written baseline (scripts/retouch-baseline.ts).
 *
 * Mocks only — no network. Run: npm run test:thumbnailparity
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { EngineConfig } from "@/lib/server/ai-engine";
import { POST as retouchRoute } from "@/app/api/retouch/route";
import { runRetouch, RETOUCH_DEFAULT_RESOLUTION } from "@/lib/server/retouch";
import { baselineBody, BASELINE_ENDPOINT } from "./retouch-baseline";

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); if (detail !== undefined) console.log("      ", typeof detail === "string" ? detail.slice(0, 600) : JSON.stringify(detail).slice(0, 600)); }
}
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
process.env.GROVBASE_SERVER_KEY = process.env.GROVBASE_SERVER_KEY ?? "parity-test-key-0123456789abcdef0123456789abcd";

type Row = Record<string, unknown>;
const PRO_ID = "m-pro";
const models: Row[] = [{
  id: PRO_ID, name: PRO_ID, display_name: PRO_ID, model_identifier: "gemini-3-pro-image",
  active: true, supports_reference_images: true, max_reference_images: 6,
  supported_aspect_ratios: ["1:1", "4:5", "16:9", "9:16", "3:4"], supported_resolutions: ["1K", "2K", "4K"],
  credit_cost: 7, internal_cost_usd_micros: 39000, metadata: {}, capabilities: {}, visible_custom: true,
  pricing: { "1K": 7, "2K": 7, "4K": 12 }, ai_providers: { id: "p-google", slug: "google", active: true },
}];

type Db = { files: Map<string, Buffer>; jobs: Map<string, Row>; engineRuns: Row[] };
let jobSeq = 0;
function fakeSupabase(db: Db) {
  const from = (table: string) => {
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

/* ── the socket ───────────────────────────────────────────────────────────*/
type Wire = { url: string; body: string; headers: Record<string, string> };
let wire: Wire[] = [];
let responseSteps: Row[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.includes("generativelanguage.googleapis.com")) {
    if (url.includes("api.openai.com")) throw new Error("an OpenAI request during Retusz");
    return realFetch(input, init);
  }
  if (typeof init?.body !== "string") throw new Error("body is not a string");
  wire.push({ url, body: init.body, headers: (init.headers ?? {}) as Record<string, string> });
  return new Response(JSON.stringify({ id: "int-1", status: "completed", steps: [{ type: "user_input", content: [] }, ...responseSteps] }),
    { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const g = globalThis as unknown as {
  __fidelityEngine?: EngineConfig | null; __forensicClient?: unknown; __forensicUser?: { id: string } | null; __fidelityLedger?: string[];
  /** The next/server stub's `after()` queue (scripts/stubs/forensic-next-server.ts). */
  __afterQueue?: ((() => unknown) | Promise<unknown>)[];
};
/** Generacje w toku V2: the route answers at acceptance and finishes the
 *  same call after its response — run that part before looking at the wire. */
async function drainAfter() {
  const queue = g.__afterQueue ?? [];
  while (queue.length > 0) {
    const task = queue.shift()!;
    await (typeof task === "function" ? task() : task);
  }
}
const engine = (prompt: string): EngineConfig => ({
  toolKey: "retouch", mode: "grovbase", serviceSlug: "image_edit", allowModelChoice: false,
  fallbackEnabled: false, timeoutMs: 120_000, maxAttempts: 1, primaryModelId: PRO_ID, fallbackModelId: null,
  systemPrompt: prompt, promptVersion: 6, knowledgeStrategy: "proven", workflowEnabled: false,
});

async function main() {
  console.log("\nC0  WHAT MINIATURKA PASSES TO RETUSZ (read from the driver itself)");
  const runTs = read("lib/server/thumbnail/run.ts");
  const call = /ctx\.deps\.runRetouch\(supabase, ctx\.userId, ctx\.workspaceId, (\{[^}]*\})\)/.exec(runTs)?.[1]?.replace(/\s+/g, " ").replace(/,\s*\}$/, " }") ?? "";
  check("Miniaturka calls runRetouch(supabase, user, workspace, { sourcePath: photo, resolution, format: \"original\", quotedOutputs: 1 })",
    call === "{ sourcePath: photo, resolution: input.retouch_resolution, format: \"original\", quotedOutputs: 1 }", call);
  check("…the production runRetouch — the same module /api/retouch imports",
    /import \{ runRetouch, type RetouchInput, type RetouchResult \} from "@\/lib\/server\/retouch";/.test(runTs)
    && /DEFAULT_DEPS: ThumbnailDeps = \{ runRetouch,/.test(runTs)
    && /import \{ runRetouch \} from "@\/lib\/server\/retouch";/.test(read("app/api/retouch/route.ts")));
  check("…its resolution is Retusz's own default (the /retusz panel's default)",
    /resolution: RETOUCH_DEFAULT_RESOLUTION/.test(read("lib/server/thumbnail/settings.ts")) && RETOUCH_DEFAULT_RESOLUTION === "2K"
    && /retouch_resolution: state\.retouch\.available \? state\.retouch\.resolution/.test(runTs));
  check("…and the photo it passes is the stored upload, unchanged (the path, never bytes it prepared)",
    /const photo = input\.photos\[i\];/.test(runTs));
  check("Miniaturka never sends its own prompt, an OpenAI request or a second image to Retusz",
    !/prompt/.test(call) && !/images|image:/.test(call));

  // A phone photo with an EXIF orientation flag, and a large 1280-px web JPEG.
  const phone = await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 170, g: 130, b: 95 } } })
    .composite([{ input: Buffer.from(`<svg width="1200" height="900"><rect x="300" y="200" width="600" height="500" fill="#234"/></svg>`), top: 0, left: 0 }])
    .jpeg({ quality: 90 }).withMetadata({ orientation: 6 }).toBuffer();
  const web = await sharp({ create: { width: 1280, height: 724, channels: 3, background: { r: 30, g: 90, b: 160 } } }).jpeg({ quality: 70 }).toBuffer();
  const out = await sharp({ create: { width: 96, height: 128, channels: 3, background: "#0a0" } }).jpeg().toBuffer();
  responseSteps = [{ type: "model_output", content: [{ type: "image", data: out.toString("base64"), mime_type: "image/jpeg" }] }];
  const PROMPT = "[RETUSZ]\r\nZachowaj produkt 1:1 — opakowanie, napisy, liczba elementów.\n\nDATA: none  \n";

  for (const [label, photo] of [["phone JPEG with EXIF orientation", phone], ["1280-px web JPEG", web]] as const) {
    console.log(`\nC1  THE SAME PHOTO, THE SAME PROMPT — ${label}`);
    const SRC = "w/thumbnail-x/photo.jpg";
    g.__fidelityEngine = engine(PROMPT);
    g.__forensicUser = { id: "u" };

    // A: the /retusz panel's default click through the REAL route.
    const dbA: Db = { files: new Map([[SRC, photo]]), jobs: new Map(), engineRuns: [] };
    wire = []; g.__fidelityLedger = []; g.__forensicClient = fakeSupabase(dbA);
    const res = await retouchRoute(new Request("https://grovbase.test/api/retouch", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourcePath: SRC, resolution: "2K", format: "original", expectedOutputs: 1 }),
    }));
    await drainAfter();
    const wireA = wire;
    check("/retusz: the route accepted the click (202) and sent one request", res.status === 202 && wireA.length === 1, { status: res.status, n: wireA.length });

    // B: exactly Miniaturka's call.
    const dbB: Db = { files: new Map([[SRC, photo]]), jobs: new Map(), engineRuns: [] };
    wire = []; g.__fidelityLedger = []; g.__forensicClient = fakeSupabase(dbB);
    const supabaseB = fakeSupabase(dbB) as unknown as Parameters<typeof runRetouch>[0];
    const r = await runRetouch(supabaseB, "u", "w", { sourcePath: SRC, resolution: RETOUCH_DEFAULT_RESOLUTION, format: "original", quotedOutputs: 1 });
    const wireB = wire;
    check("Miniaturka: runRetouch succeeded with one request", r.ok === true && wireB.length === 1, { r, n: wireB.length });

    const a = wireA[0]; const b = wireB[0];
    check("same endpoint (POST …/v1beta/interactions)", a?.url === b?.url && a?.url === BASELINE_ENDPOINT, { a: a?.url, b: b?.url });
    check("same headers", JSON.stringify(Object.keys(a?.headers ?? {}).sort()) === JSON.stringify(Object.keys(b?.headers ?? {}).sort()));
    check("same body, byte for byte", a?.body === b?.body, { a: a?.body.length, b: b?.body.length });
    check("…equal to the independent hand-written baseline", b?.body === baselineBody({ prompt: PROMPT, image: photo, mimeType: "image/jpeg" }));
    const sent = JSON.parse(b?.body ?? "{}") as Row;
    const input = (sent.input ?? []) as Row[];
    check("model gemini-3-pro-image, store:false, fields [model,input,response_modalities,store] — nothing else",
      sent.model === "gemini-3-pro-image" && sent.store === false && JSON.stringify(Object.keys(sent)) === JSON.stringify(["model", "input", "response_modalities", "store"]));
    check("prompt SHA-256 identical (the published Retusz prompt, 1:1)", sha(String(input[0]?.text)) === sha(PROMPT));
    check("image SHA-256 identical (the stored bytes, no resize, no recompression)",
      sha(Buffer.from(String(input[1]?.data), "base64")) === sha(photo));
    check("no size, no aspect ratio, no system instruction, no history", !/image_size|aspect_ratio|system_instruction|previous_interaction_id|generation_config/.test(b?.body ?? ""));
  }

  console.log(`\n${failed === 0 ? "All" : `${failed} OF`} Miniaturka × Retusz parity tests ${failed === 0 ? "passed" : "FAILED"} (${passed} passed).`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
